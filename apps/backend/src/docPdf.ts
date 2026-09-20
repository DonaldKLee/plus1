/**
 * Turn text into a real PDF the plus1 can hand someone — meeting notes, a recap,
 * an action-item list, a one-pager, anything.
 *
 * This is the general-purpose sibling of intactPdf.ts (which renders one fixed
 * quote layout). Same storage contract as that module on purpose: render into an
 * in-memory store keyed by an opaque uuid with a TTL, hand back the id, and let
 * the Express route serve the bytes. Nothing touches the filesystem, so there's
 * no temp-file cleanup and no way for a stale artifact to leak into a later demo.
 *
 * Why pdf-lib and not headless Chromium: the only Chrome in this repo is the
 * headed, persistent, SingletonLock'd profile that joins Meet (meetPresent.ts).
 * Borrowing it mid-meeting to print a page would fight the live session, and a
 * second browser is a heavy dependency for text on a page. pdf-lib is pure JS
 * and already a backend dependency.
 */
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { CACHE_DIR, envOptional } from "./env.js";
import { saveDocument, loadDocumentByDocId, loadDocumentByToken } from "./docStore.js";
import { loadDocFonts, normalizeText, renderTemplate, type Figure } from "./docTemplate.js";
import { uploadPublicPdf } from "./appwriteDocs.js";

export type { Figure } from "./docTemplate.js";

export interface DocSpec {
  title: string;
  /** Small line under the title — date, author, meeting name. */
  subtitle?: string;
  /**
   * Markdown-lite body. Supported, because this is written by an LLM that
   * reaches for markdown whether you ask it to or not:
   *   `# H1` … `### H3`, `- bullet`, nested bullets, `1. numbered`,
   *   `- [ ] task` / `- [x] done`, `| tables |` with `|---:|` alignment,
   *   ```` ``` ```` fenced blocks, `> callout`, `---` rule, `**Term**: value`,
   *   and inline `**bold**`, `*italic*`, `` `code` ``, `[label](url)`.
   */
  body: string;
  /**
   * The numbers the reader came for, set as data above the prose. This is the
   * single biggest reason a generated document felt empty: figures written into
   * sentences are figures nobody can check.
   */
  figures?: Figure[];
  /** Footer note on every page. Defaults to a generated-by line. */
  footer?: string;
  /** Download filename (without .pdf). Derived from the title when omitted. */
  filename?: string;
  /** Meeting this came from, recorded alongside the stored document. */
  meetingId?: string;
}

export interface StoredDoc {
  bytes: Uint8Array;
  filename: string;
  title: string;
  /** Share token — what a public link carries. */
  token: string;
  /** Appwrite (or tunnel) URL, when we already uploaded this file. */
  shareUrl?: string;
  at: number;
}

export interface RenderedDoc {
  id: string;
  /** Share token, for the public /d/:token route. */
  token: string;
  filename: string;
  pages: number;
  bytes: number;
  /** Local path the dashboard uses. */
  pdfUrl: string;
  /** Publicly reachable URL — only set when public serving is configured. */
  shareUrl?: string;
}

const store = new Map<string, StoredDoc>();
const TTL_MS = 60 * 60 * 1000; // matches intactPdf.ts — an hour is plenty
const MAX_DOCS = 200; // a runaway agent shouldn't be able to eat the heap

function gc(): void {
  const now = Date.now();
  for (const [id, v] of store) if (now - v.at > TTL_MS) store.delete(id);
  // Still too many? Drop the oldest.
  if (store.size > MAX_DOCS) {
    const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [id] of oldest.slice(0, store.size - MAX_DOCS)) store.delete(id);
  }
}

/** Memory-only lookup. Prefer `loadDoc` — it also falls back to Mongo. */
export function getDocPdf(id: string): StoredDoc | undefined {
  return store.get(id);
}

/** Token → in-memory id, so the public route can resolve without a round trip. */
const tokens = new Map<string, string>();

/**
 * Where the public share links point. Resolution order:
 *   1. PUBLIC_BASE_URL — an explicit host (a deployment, or a named tunnel).
 *   2. cache/public-url.txt — written by `npm run tunnel`, so a quick tunnel
 *      needs no copy-paste into .env.
 * Undefined means public sharing is off and only local URLs are handed out.
 */
export function publicBaseUrl(): string | undefined {
  const explicit = envOptional("PUBLIC_BASE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    const cached = fs.readFileSync(path.join(CACHE_DIR, "public-url.txt"), "utf8").trim();
    if (/^https?:\/\//.test(cached)) return cached.replace(/\/+$/, "");
  } catch {
    /* no tunnel running */
  }
  return undefined;
}

/** The public URL for a token, or undefined when public sharing isn't set up. */
export function shareUrlFor(token: string): string | undefined {
  const mappedId = tokens.get(token);
  const cached = mappedId ? store.get(mappedId)?.shareUrl : undefined;
  if (cached) return cached;
  const base = publicBaseUrl();
  return base ? `${base}/d/${token}` : undefined;
}

/**
 * Find a document by in-memory id OR share token, falling back to Mongo so a
 * link survives a backend restart. Async because that fallback is a query.
 */
export async function loadDoc(idOrToken: string): Promise<StoredDoc | undefined> {
  const direct = store.get(idOrToken);
  if (direct) return direct;

  const mappedId = tokens.get(idOrToken);
  if (mappedId) {
    const viaToken = store.get(mappedId);
    if (viaToken) return viaToken;
  }

  // Not in memory — this process may have restarted since it was rendered.
  const fromDb =
    (await loadDocumentByToken(idOrToken)) ?? (await loadDocumentByDocId(idOrToken));
  if (!fromDb) return undefined;

  const restored: StoredDoc = {
    bytes: fromDb.bytes,
    filename: fromDb.filename,
    title: fromDb.title,
    token: fromDb.token,
    at: Date.now(),
  };
  // Warm the cache so repeat downloads don't re-query.
  store.set(fromDb.docId, restored);
  tokens.set(fromDb.token, fromDb.docId);
  return restored;
}

/**
 * The most recently rendered document. This exists so "email me that PDF" works
 * in one turn: the brain would otherwise have to carry a uuid across turns in
 * the transcript, which it does unreliably. `attachPdf: "last"` resolves here.
 */
export function lastDocId(): string | undefined {
  let newest: { id: string; at: number } | undefined;
  for (const [id, v] of store) if (!newest || v.at > newest.at) newest = { id, at: v.at };
  return newest?.id;
}

/** Turn a title into a safe download filename. */
export function slugify(s: string, fallback = "document"): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

/**
 * Render a document to PDF and stash it. Returns the id the HTTP route serves.
 *
 * The layout lives in docTemplate.ts; this function is the storage contract.
 */
export async function renderDocPdf(spec: DocSpec): Promise<RenderedDoc> {
  gc();

  const doc = await PDFDocument.create();
  const fonts = await loadDocFonts(doc);
  const title = normalizeText(spec.title || "Document", fonts.geist).trim() || "Document";

  doc.setTitle(title);
  doc.setAuthor("plus1");
  doc.setProducer("plus1");
  doc.setCreator("plus1");
  if (spec.subtitle?.trim()) doc.setSubject(normalizeText(spec.subtitle, fonts.geist));
  doc.setCreationDate(new Date());

  const pages = renderTemplate(doc, fonts, {
    title,
    subtitle: spec.subtitle,
    body: spec.body ?? "",
    figures: spec.figures,
    footer: spec.footer,
  });

  const bytes = await doc.save();
  const id = randomUUID();
  // The share token is a bearer credential — anyone holding the link can read
  // the document — so it gets real entropy rather than reusing the render id.
  // 24 random bytes ≈ 192 bits, base64url so it's safe to paste anywhere.
  const token = randomBytes(24).toString("base64url");
  const filename = `${slugify(spec.filename ?? title)}.pdf`;

  // Appwrite first — a real https URL people in Meet can click. Tunnel/Mongo
  // stay as fallback when Appwrite isn't set up.
  let shareUrl: string | undefined;
  try {
    shareUrl = await uploadPublicPdf(bytes, filename);
  } catch (e) {
    console.warn(`[doc] appwrite upload failed: ${(e as Error).message}`);
  }
  if (!shareUrl) shareUrl = shareUrlFor(token);

  store.set(id, { bytes, filename, title, token, shareUrl, at: Date.now() });
  tokens.set(token, id);

  // Mirror to Atlas so the link outlives this process. Awaited (it's a few KB)
  // but never allowed to fail the render — same posture as store.ts.
  await saveDocument({
    token,
    docId: id,
    filename,
    title,
    bytes,
    pages,
    meetingId: spec.meetingId,
  }).catch(() => false);

  return {
    id,
    token,
    filename,
    pages,
    bytes: bytes.length,
    pdfUrl: `/api/doc/${id}.pdf`,
    shareUrl,
  };
}
