/**
 * MongoDB Atlas persistence for meeting sessions.
 *
 * The in-memory Map in meetTranscribe.ts is still the source of truth while a
 * session is live; this module mirrors it into Atlas so transcripts, the
 * plus1's decisions, and the operator notes survive a backend restart and the
 * dashboard has real history instead of an empty list.
 *
 * Everything here degrades to a no-op when MONGODB_URI is unset, so the repo
 * still runs with no database configured.
 */

import { MongoClient, type Collection, type Db } from "mongodb";
import { envOptional } from "./env.js";

export interface StoredLine {
  id: string;
  t: number;
  at: string;
  text: string;
  agent?: boolean;
  speaker?: string;
}

export interface StoredDecision {
  id: string;
  t: number;
  at: string;
  act: boolean;
  action: string;
  confidence: number;
  reason: string;
  say?: string;
  chatMessage?: string;
  tool?: { name: string; query?: string };
  outcome?: string;
}

export interface MeetingDoc {
  _id: string; // the session id
  meetUrl: string;
  meetCode: string;
  /** What the meeting is for, typed by the operator when sending the plus1. */
  purpose?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  notes: string[];
  lines: StoredLine[];
  decisions: StoredDecision[];
  /** Standing instructions and facts the agent was told to hold onto. */
  memory?: string[];
  /** Slot-filling state: active task, collected params, what's still missing. */
  state?: {
    activeTask: string;
    collected: Record<string, string>;
    missing: string[];
    completed: string[];
  };
  lineCount: number;
  /** First substantive thing said — the label for meetings with no purpose. */
  preview?: string;
  /** Flattened transcript, so Atlas can text-index the whole conversation. */
  transcript: string;
}

const COLLECTION = "meetings";
const SETTINGS = "settings";
/** Single settings document: there is one plus1 per deployment. */
const plus1_SETTINGS_ID = "plus1";

let client: MongoClient | null = null;
let dbPromise: Promise<Db> | null = null;
let warned = false;

export function storeEnabled(): boolean {
  return Boolean(envOptional("MONGODB_URI"));
}

/** Connect lazily; one client for the process. Returns null when unconfigured. */
async function db(): Promise<Db | null> {
  const uri = envOptional("MONGODB_URI");
  if (!uri) {
    if (!warned) {
      warned = true;
      console.log("[store] MONGODB_URI not set — meetings are in-memory only.");
    }
    return null;
  }
  if (!dbPromise) {
    dbPromise = (async () => {
      client = new MongoClient(uri, { appName: "plus1-plus1" });
      await client.connect();
      const database = client.db(envOptional("MONGODB_DB") ?? "plus1");
      const meetings = database.collection<MeetingDoc>(COLLECTION);
      // Recent-first listing, plus full-text search over purpose + transcript.
      await meetings.createIndex({ createdAt: -1 }).catch(() => {});
      await ensureTextIndex(meetings);
      console.log(`[store] connected to MongoDB (db: ${database.databaseName})`);
      return database;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/**
 * Mongo refuses to change a text index's keys under the same name, so when the
 * shape changes (adding `purpose`) drop the old one and rebuild. Only one text
 * index per collection is allowed, which is why this has to be a replace.
 */
async function ensureTextIndex(col: Collection<MeetingDoc>): Promise<void> {
  const keys = { purpose: "text", transcript: "text", meetCode: "text" } as const;
  try {
    await col.createIndex(keys, { name: "transcript_text" });
  } catch (e) {
    const code = (e as { code?: number }).code;
    // 85 IndexOptionsConflict, 86 IndexKeySpecsConflict — an older shape exists.
    if (code !== 85 && code !== 86) return;
    try {
      await col.dropIndex("transcript_text");
      await col.createIndex(keys, { name: "transcript_text" });
      console.log("[store] rebuilt the transcript text index to include purpose");
    } catch (inner) {
      console.warn(`[store] could not rebuild text index: ${(inner as Error).message}`);
    }
  }
}

async function meetings(): Promise<Collection<MeetingDoc> | null> {
  try {
    const database = await db();
    return database ? database.collection<MeetingDoc>(COLLECTION) : null;
  } catch (e) {
    console.warn(`[store] MongoDB unavailable: ${(e as Error).message}`);
    return null;
  }
}

/** Never let a storage hiccup take down a live meeting. */
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[store] ${label} failed: ${(e as Error).message}`);
    return null;
  }
}

/** The first human line long enough to describe the meeting, truncated. */
export function previewOf(lines: { text: string; agent?: boolean }[]): string | undefined {
  const first = lines.find((l) => !l.agent && l.text.trim().split(/\s+/).length >= 4);
  if (!first) return undefined;
  const t = first.text.trim();
  return t.length > 80 ? `${t.slice(0, 80).trimEnd()}…` : t;
}

export function meetCodeOf(url: string): string {
  return url.replace(/^https?:\/\/meet\.google\.com\//i, "").split("?")[0] ?? url;
}

/** Write the whole session document (upsert). Called on create and on flush. */
export async function saveMeeting(
  doc: Omit<MeetingDoc, "updatedAt" | "transcript" | "meetCode" | "lineCount" | "preview">,
): Promise<void> {
  const col = await meetings();
  if (!col) return;
  const full: MeetingDoc = {
    ...doc,
    meetCode: meetCodeOf(doc.meetUrl),
    lineCount: doc.lines.length,
    preview: previewOf(doc.lines),
    transcript: doc.lines.map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text)).join("\n"),
    updatedAt: new Date().toISOString(),
  };
  await safe("saveMeeting", () =>
    col.updateOne({ _id: doc._id }, { $set: full }, { upsert: true }),
  );
}

export interface MeetingSummary {
  id: string;
  meetUrl: string;
  purpose?: string;
  preview?: string;
  status: string;
  createdAt: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  lineCount: number;
  persisted: true;
  /** Set on search results: the matching snippet. */
  snippet?: string;
}

function toSummary(d: MeetingDoc): MeetingSummary {
  return {
    id: d._id,
    meetUrl: d.meetUrl,
    purpose: d.purpose,
    preview: d.preview,
    status: d.status,
    createdAt: d.createdAt,
    endedAt: d.endedAt,
    durationMs: d.durationMs,
    error: d.error,
    lineCount: d.lineCount ?? d.lines?.length ?? 0,
    persisted: true,
  };
}

export async function listMeetings(limit = 100): Promise<MeetingSummary[]> {
  const col = await meetings();
  if (!col) return [];
  const docs = await safe("listMeetings", () =>
    col
      .find({}, { projection: { lines: 0, decisions: 0, transcript: 0, notes: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray(),
  );
  return (docs ?? []).map(toSummary);
}

export async function getMeeting(id: string): Promise<MeetingDoc | null> {
  const col = await meetings();
  if (!col) return null;
  return (await safe("getMeeting", () => col.findOne({ _id: id }))) ?? null;
}

/** Rename a stored meeting (the operator relabelling it after the fact). */
export async function setMeetingPurpose(id: string, purpose: string): Promise<boolean> {
  const col = await meetings();
  if (!col) return false;
  const r = await safe("setMeetingPurpose", () =>
    col.updateOne(
      { _id: id },
      { $set: { purpose: purpose.trim(), updatedAt: new Date().toISOString() } },
    ),
  );
  return Boolean(r?.matchedCount);
}

export async function deleteMeeting(id: string): Promise<boolean> {
  const col = await meetings();
  if (!col) return false;
  const r = await safe("deleteMeeting", () => col.deleteOne({ _id: id }));
  return Boolean(r?.deletedCount);
}

/** Full-text search across every stored transcript (Atlas text index). */
export async function searchMeetings(q: string, limit = 25): Promise<MeetingSummary[]> {
  const col = await meetings();
  if (!col || !q.trim()) return [];
  const docs = await safe("searchMeetings", () =>
    col
      .find(
        { $text: { $search: q } },
        {
          projection: { lines: 0, decisions: 0, score: { $meta: "textScore" } },
        } as never,
      )
      .sort({ score: { $meta: "textScore" } } as never)
      .limit(limit)
      .toArray(),
  );
  const needle = q.trim().toLowerCase();
  return (docs ?? []).map((d) => {
    const summary = toSummary(d);
    const hit = (d.transcript ?? "")
      .split("\n")
      .find((line) => line.toLowerCase().includes(needle));
    if (hit) summary.snippet = hit.slice(0, 220);
    return summary;
  });
}

/** Aggregate stats for the dashboard header. */
export async function meetingStats(): Promise<{
  meetings: number;
  lines: number;
  plus1Lines: number;
  totalDurationMs: number;
} | null> {
  const col = await meetings();
  if (!col) return null;
  const rows = await safe("meetingStats", () =>
    col
      .aggregate<{ _id: null; meetings: number; lines: number; totalDurationMs: number }>([
        {
          $group: {
            _id: null,
            meetings: { $sum: 1 },
            lines: { $sum: { $ifNull: ["$lineCount", 0] } },
            totalDurationMs: { $sum: { $ifNull: ["$durationMs", 0] } },
          },
        },
      ])
      .toArray(),
  );
  const plus1Rows = await safe("meetingStats.plus1", () =>
    col
      .aggregate<{ _id: null; plus1Lines: number }>([
        { $project: { agentLines: { $filter: { input: "$lines", as: "l", cond: "$$l.agent" } } } },
        { $group: { _id: null, plus1Lines: { $sum: { $size: "$agentLines" } } } },
      ])
      .toArray(),
  );
  const r = rows?.[0];
  return {
    meetings: r?.meetings ?? 0,
    lines: r?.lines ?? 0,
    plus1Lines: plus1Rows?.[0]?.plus1Lines ?? 0,
    totalDurationMs: r?.totalDurationMs ?? 0,
  };
}

// ── plus1 settings ────────────────────────────────────────────────────────
// The plus1 tab used to keep its config in localStorage, so it lived in one
// browser and the backend only saw it when a meeting started. Stored here it
// follows the plus1 across browsers and restarts, and a session that joins
// without an explicit config picks these up.

export interface plus1SettingsDoc {
  _id: string;
  config: Record<string, unknown>;
  updatedAt: string;
}

/** The saved plus1 config, or null when nothing is stored yet. */
export async function getplus1Settings(): Promise<Record<string, unknown> | null> {
  const database = await db().catch(() => null);
  if (!database) return null;
  const doc = await safe("getplus1Settings", () =>
    database.collection<plus1SettingsDoc>(SETTINGS).findOne({ _id: plus1_SETTINGS_ID }),
  );
  return doc?.config ?? null;
}

/** Replace the saved plus1 config. Returns false when there is no database. */
export async function saveplus1Settings(config: Record<string, unknown>): Promise<boolean> {
  const database = await db().catch(() => null);
  if (!database) return false;
  const r = await safe("saveplus1Settings", () =>
    database.collection<plus1SettingsDoc>(SETTINGS).updateOne(
      { _id: plus1_SETTINGS_ID },
      { $set: { config, updatedAt: new Date().toISOString() } },
      { upsert: true },
    ),
  );
  return Boolean(r);
}

export async function closeStore(): Promise<void> {
  const c = client;
  client = null;
  dbPromise = null;
  if (c) await c.close().catch(() => {});
}
