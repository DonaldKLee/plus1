/**
 * MongoDB Atlas persistence for meeting sessions.
 *
 * The in-memory Map in meetTranscribe.ts is still the source of truth while a
 * session is live; this module mirrors it into Atlas so transcripts, the
 * goose's decisions, and the operator notes survive a backend restart and the
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
  status: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  notes: string[];
  lines: StoredLine[];
  decisions: StoredDecision[];
  lineCount: number;
  /** Flattened transcript, so Atlas can text-index the whole conversation. */
  transcript: string;
}

const COLLECTION = "meetings";

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
      client = new MongoClient(uri, { appName: "plus1-goose" });
      await client.connect();
      const database = client.db(envOptional("MONGODB_DB") ?? "plus1");
      const meetings = database.collection<MeetingDoc>(COLLECTION);
      // Recent-first listing, plus full-text search over the transcript.
      await meetings.createIndex({ createdAt: -1 }).catch(() => {});
      await meetings
        .createIndex({ transcript: "text", meetCode: "text" }, { name: "transcript_text" })
        .catch(() => {});
      console.log(`[store] connected to MongoDB (db: ${database.databaseName})`);
      return database;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
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

export function meetCodeOf(url: string): string {
  return url.replace(/^https?:\/\/meet\.google\.com\//i, "").split("?")[0] ?? url;
}

/** Write the whole session document (upsert). Called on create and on flush. */
export async function saveMeeting(doc: Omit<MeetingDoc, "updatedAt" | "transcript" | "meetCode" | "lineCount">): Promise<void> {
  const col = await meetings();
  if (!col) return;
  const full: MeetingDoc = {
    ...doc,
    meetCode: meetCodeOf(doc.meetUrl),
    lineCount: doc.lines.length,
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
  gooseLines: number;
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
  const gooseRows = await safe("meetingStats.goose", () =>
    col
      .aggregate<{ _id: null; gooseLines: number }>([
        { $project: { agentLines: { $filter: { input: "$lines", as: "l", cond: "$$l.agent" } } } },
        { $group: { _id: null, gooseLines: { $sum: { $size: "$agentLines" } } } },
      ])
      .toArray(),
  );
  const r = rows?.[0];
  return {
    meetings: r?.meetings ?? 0,
    lines: r?.lines ?? 0,
    gooseLines: gooseRows?.[0]?.gooseLines ?? 0,
    totalDurationMs: r?.totalDurationMs ?? 0,
  };
}

export async function closeStore(): Promise<void> {
  const c = client;
  client = null;
  dbPromise = null;
  if (c) await c.close().catch(() => {});
}
