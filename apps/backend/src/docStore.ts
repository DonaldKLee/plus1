/**
 * MongoDB persistence for generated PDFs.
 *
 * docPdf.ts keeps the bytes in memory (fast path, source of truth for the life
 * of the process); this module mirrors them into Atlas so a share link keeps
 * working after a backend restart and outlives the in-memory TTL. Same contract
 * as store.ts: degrades to a no-op when MONGODB_URI is unset, and a storage
 * failure is logged, never fatal — a database hiccup must not stop the plus1
 * handing someone a PDF.
 *
 * WHY A PLAIN COLLECTION AND NOT GridFS: these documents are a few KB to a few
 * hundred KB, nowhere near the 16MB BSON document limit that GridFS exists to
 * work around. A single Binary field is simpler and needs no chunk bookkeeping.
 * If PDFs ever grow past ~10MB, switch to GridFS here and nothing else changes.
 *
 * Expiry is Mongo's job: a TTL index on `expiresAt` deletes documents on its
 * own, so an abandoned share link can't linger indefinitely and there's no
 * sweeper to write or forget to run.
 */
import { Binary, type Collection } from "mongodb";
import { sharedDb } from "./store.js";
import { envOptional } from "./env.js";

export interface DocumentDoc {
  /** The share token — high-entropy, and the only thing a link reveals. */
  _id: string;
  /** Internal render id, so the local dashboard route can find it too. */
  docId: string;
  filename: string;
  title: string;
  contentType: string;
  bytes: Binary;
  size: number;
  pages: number;
  /** The meeting this was generated in, when it came from one. */
  meetingId?: string;
  createdAt: Date;
  /** TTL index target — Mongo removes the document once this passes. */
  expiresAt: Date;
}

const COLLECTION = "documents";

/** How long a share link stays alive. Deliberately finite. */
export function shareTtlHours(): number {
  const raw = Number(envOptional("PUBLIC_DOC_TTL_HOURS") ?? 24);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

let indexed = false;

async function documents(): Promise<Collection<DocumentDoc> | null> {
  const database = await sharedDb();
  if (!database) return null;
  const col = database.collection<DocumentDoc>(COLLECTION);
  if (!indexed) {
    indexed = true;
    // expireAfterSeconds: 0 means "expire exactly at the date in this field".
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
    await col.createIndex({ docId: 1 }).catch(() => {});
  }
  return col;
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[docStore] ${label} failed: ${(e as Error).message}`);
    return null;
  }
}

export interface SaveDocInput {
  token: string;
  docId: string;
  filename: string;
  title: string;
  bytes: Uint8Array;
  pages: number;
  meetingId?: string;
}

/** Mirror a rendered PDF into Atlas. Fire-and-forget from the caller's view. */
export async function saveDocument(input: SaveDocInput): Promise<boolean> {
  const col = await documents();
  if (!col) return false;
  const now = new Date();
  const doc: DocumentDoc = {
    _id: input.token,
    docId: input.docId,
    filename: input.filename,
    title: input.title,
    contentType: "application/pdf",
    bytes: new Binary(Buffer.from(input.bytes)),
    size: input.bytes.length,
    pages: input.pages,
    meetingId: input.meetingId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + shareTtlHours() * 3600_000),
  };
  const r = await safe("saveDocument", () =>
    col.updateOne({ _id: input.token }, { $set: doc }, { upsert: true }),
  );
  return Boolean(r);
}

export interface LoadedDocument {
  token: string;
  docId: string;
  filename: string;
  title: string;
  bytes: Uint8Array;
  pages: number;
}

function toLoaded(d: DocumentDoc): LoadedDocument {
  return {
    token: d._id,
    docId: d.docId,
    filename: d.filename,
    title: d.title,
    bytes: new Uint8Array(d.bytes.buffer),
    pages: d.pages,
  };
}

/** Fetch by share token (the public route's lookup). */
export async function loadDocumentByToken(token: string): Promise<LoadedDocument | null> {
  const col = await documents();
  if (!col) return null;
  const d = await safe("loadDocumentByToken", () => col.findOne({ _id: token }));
  if (!d) return null;
  // A TTL index only sweeps every ~60s, so an expired doc can still be found.
  // Refuse it explicitly rather than serving something past its lifetime.
  if (d.expiresAt && d.expiresAt.getTime() < Date.now()) return null;
  return toLoaded(d);
}

/** Fetch by internal render id (the dashboard's local route). */
export async function loadDocumentByDocId(docId: string): Promise<LoadedDocument | null> {
  const col = await documents();
  if (!col) return null;
  const d = await safe("loadDocumentByDocId", () => col.findOne({ docId }));
  if (!d) return null;
  if (d.expiresAt && d.expiresAt.getTime() < Date.now()) return null;
  return toLoaded(d);
}

/** Revoke a share link immediately. */
export async function deleteDocument(token: string): Promise<boolean> {
  const col = await documents();
  if (!col) return false;
  const r = await safe("deleteDocument", () => col.deleteOne({ _id: token }));
  return Boolean(r?.deletedCount);
}
