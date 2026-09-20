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
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { CACHE_DIR, envOptional } from "./env.js";
import { saveDocument, loadDocumentByDocId, loadDocumentByToken } from "./docStore.js";

export interface DocSpec {
  title: string;
  /** Small line under the title — date, author, meeting name. */
  subtitle?: string;
  /**
   * Markdown-lite body. Supported, because this is written by an LLM that
   * reaches for markdown whether you ask it to or not:
   *   `# H1`, `## H2`, `### H3`, `- bullet`, `* bullet`, `1. numbered`,
   *   `---` horizontal rule, `> quote`, blank line = paragraph break.
   * Inline `**bold**` is honored for whole-run spans; everything else is literal.
   */
  body: string;
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
 * The 14 standard PDF fonts are WinAnsi-encoded, and pdf-lib throws on any
 * character outside that set. An LLM writing "notes" will happily emit curly
 * quotes, en dashes, arrows and the occasional emoji, so normalize first —
 * otherwise PDF generation fails on perfectly reasonable input.
 */
export function toWinAnsi(s: string): string {
  const map: Record<string, string> = {
    "\u2018": "'", "\u2019": "'", "\u201A": ",", "\u201B": "'",
    "\u201C": '"', "\u201D": '"', "\u201E": '"',
    "\u2013": "-", "\u2014": "-", "\u2015": "-", "\u2212": "-",
    "\u2026": "...", "\u2022": "-", "\u00B7": "-", "\u25CF": "-", "\u25AA": "-",
    "\u2192": "->", "\u2190": "<-", "\u21D2": "=>", "\u2264": "<=", "\u2265": ">=",
    "\u00A0": " ", "\u2009": " ", "\u200A": " ", "\u202F": " ", "\u200B": "",
    "\u2713": "v", "\u2714": "v", "\u2717": "x", "\u2718": "x",
    "\uFE0F": "", // variation selector left behind by stripped emoji
  };
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018-\u201E\u2013-\u2015\u2212\u2026\u2022\u00B7\u25CF\u25AA\u2192\u2190\u21D2\u2264\u2265\u00A0\u2009\u200A\u202F\u200B\u2713\u2714\u2717\u2718\uFE0F]/g, (c) => map[c] ?? "")
    .replace(/\t/g, "    ")
    // Drop anything still outside printable Latin-1 (emoji, CJK, symbols).
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "")
    // Stripping a character mid-sentence leaves orphaned whitespace ("emoji ,
    // CJK ."). Tidy the seams so removals are invisible on the page. Runs of
    // spaces are left alone — they may be deliberate indentation.
    .replace(/ +([,.;:!?)\]])/g, "$1")
    .replace(/([([]) +/g, "$1")
    .replace(/[ ]+$/gm, "");
}

// ── layout constants ───────────────────────────────────────────────────────
const PAGE_W = 612; // US Letter, same as intactPdf.ts
const PAGE_H = 792;
const M = 56; // margin
const CONTENT_W = PAGE_W - M * 2;
const BOTTOM = M + 30; // leave room for the footer rule

const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.4, 0.4, 0.45);
const RULE = rgb(0.9, 0.9, 0.92);
const BRAND = rgb(0.86, 0.12, 0.12);

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  pages: number;
  footer: string;
}

/** Wrap by measured width, not character count — proportional fonts need it. */
function wrapMeasured(s: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxW) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    // A single word longer than the line (a URL, say) — hard-break it.
    if (font.widthOfTextAtSize(w, size) > maxW) {
      let chunk = "";
      for (const ch of w) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxW) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      cur = chunk;
    } else cur = w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawFooter(c: Ctx): void {
  const y = M + 14;
  c.page.drawLine({ start: { x: M, y: y + 10 }, end: { x: PAGE_W - M, y: y + 10 }, thickness: 1, color: RULE });
  c.page.drawText(c.footer, { x: M, y, size: 8, font: c.font, color: MUTED });
  const num = String(c.pages);
  c.page.drawText(num, {
    x: PAGE_W - M - c.font.widthOfTextAtSize(num, 8),
    y,
    size: 8,
    font: c.font,
    color: MUTED,
  });
}

function newPage(c: Ctx): void {
  drawFooter(c);
  c.page = c.doc.addPage([PAGE_W, PAGE_H]);
  c.pages += 1;
  c.y = PAGE_H - M;
}

/** Reserve vertical space, starting a new page when this block won't fit. */
function need(c: Ctx, h: number): void {
  if (c.y - h < BOTTOM) newPage(c);
}

function line(c: Ctx, s: string, opts: { size?: number; font?: PDFFont; color?: typeof INK; indent?: number; gap?: number } = {}): void {
  const size = opts.size ?? 11;
  const font = opts.font ?? c.font;
  const indent = opts.indent ?? 0;
  const lh = size * 1.45;
  for (const l of wrapMeasured(s, font, size, CONTENT_W - indent)) {
    need(c, lh);
    c.page.drawText(l, { x: M + indent, y: c.y - size, size, font, color: opts.color ?? INK });
    c.y -= lh;
  }
  if (opts.gap) c.y -= opts.gap;
}

/** Render the markdown-lite body. */
function renderBody(c: Ctx, body: string): void {
  const lines = toWinAnsi(body).split("\n");
  let prevBlank = true;

  for (const raw of lines) {
    const s = raw.trim();

    if (!s) {
      if (!prevBlank) c.y -= 6;
      prevBlank = true;
      continue;
    }
    prevBlank = false;

    // horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(s)) {
      need(c, 16);
      c.y -= 6;
      c.page.drawLine({ start: { x: M, y: c.y }, end: { x: PAGE_W - M, y: c.y }, thickness: 1, color: RULE });
      c.y -= 12;
      continue;
    }

    // headings
    const h = /^(#{1,3})\s+(.*)$/.exec(s);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 16 : level === 2 ? 13 : 11.5;
      need(c, size * 2.2);
      c.y -= level === 1 ? 10 : 8;
      line(c, stripInline(h[2]), { size, font: c.bold, gap: 3 });
      continue;
    }

    // blockquote
    const q = /^>\s?(.*)$/.exec(s);
    if (q) {
      const top = c.y;
      line(c, stripInline(q[1]), { size: 10.5, font: c.italic, color: MUTED, indent: 14 });
      c.page.drawLine({ start: { x: M + 3, y: c.y + 4 }, end: { x: M + 3, y: top - 2 }, thickness: 2, color: RULE });
      continue;
    }

    // bullets
    const b = /^[-*+]\s+(.*)$/.exec(s);
    if (b) {
      need(c, 16);
      c.page.drawText("-", { x: M + 6, y: c.y - 11, size: 11, font: c.font, color: MUTED });
      line(c, stripInline(b[1]), { indent: 20 });
      continue;
    }

    // numbered
    const n = /^(\d{1,2})[.)]\s+(.*)$/.exec(s);
    if (n) {
      need(c, 16);
      c.page.drawText(`${n[1]}.`, { x: M + 4, y: c.y - 11, size: 11, font: c.bold, color: MUTED });
      line(c, stripInline(n[2]), { indent: 24 });
      continue;
    }

    // a line that is entirely bold reads as a lead-in, so keep the weight
    const allBold = /^\*\*(.+)\*\*:?$/.exec(s);
    if (allBold) {
      line(c, stripInline(s), { font: c.bold });
      continue;
    }

    line(c, stripInline(s));
  }
}

/** Strip the inline markers we don't render as separate runs. */
function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)\*(?!\s)(.+?)(?<!\s)\*(?=\s|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)"); // keep the URL visible on paper
}

/**
 * Render a document to PDF and stash it. Returns the id the HTTP route serves.
 */
export async function renderDocPdf(spec: DocSpec): Promise<RenderedDoc> {
  gc();

  const title = toWinAnsi(spec.title || "Document").trim() || "Document";
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const c: Ctx = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - M,
    font,
    bold,
    italic,
    pages: 1,
    footer: toWinAnsi(spec.footer ?? `Generated by plus1 - ${new Date().toLocaleString("en-CA")}`),
  };

  doc.setTitle(title);
  doc.setProducer("plus1");
  doc.setCreationDate(new Date());

  // masthead
  c.page.drawText("plus1", { x: M, y: c.y - 16, size: 13, font: bold, color: BRAND });
  const stamp = new Date().toLocaleDateString("en-CA");
  c.page.drawText(stamp, {
    x: PAGE_W - M - font.widthOfTextAtSize(stamp, 10),
    y: c.y - 15,
    size: 10,
    font,
    color: MUTED,
  });
  c.y -= 40;

  line(c, title, { size: 22, font: bold });
  if (spec.subtitle?.trim()) {
    c.y -= 2;
    line(c, toWinAnsi(spec.subtitle), { size: 11, color: MUTED });
  }
  c.y -= 10;
  c.page.drawLine({ start: { x: M, y: c.y }, end: { x: PAGE_W - M, y: c.y }, thickness: 1, color: RULE });
  c.y -= 22;

  renderBody(c, spec.body ?? "");
  drawFooter(c); // the page we finished on

  const bytes = await doc.save();
  const id = randomUUID();
  // The share token is a bearer credential — anyone holding the link can read
  // the document — so it gets real entropy rather than reusing the render id.
  // 24 random bytes ≈ 192 bits, base64url so it's safe to paste anywhere.
  const token = randomBytes(24).toString("base64url");
  const filename = `${slugify(spec.filename ?? title)}.pdf`;

  store.set(id, { bytes, filename, title, token, at: Date.now() });
  tokens.set(token, id);

  // Mirror to Atlas so the link outlives this process. Awaited (it's a few KB)
  // but never allowed to fail the render — same posture as store.ts.
  await saveDocument({
    token,
    docId: id,
    filename,
    title,
    bytes,
    pages: c.pages,
    meetingId: spec.meetingId,
  }).catch(() => false);

  return {
    id,
    token,
    filename,
    pages: c.pages,
    bytes: bytes.length,
    pdfUrl: `/api/doc/${id}.pdf`,
    shareUrl: shareUrlFor(token),
  };
}
