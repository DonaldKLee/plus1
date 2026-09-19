/**
 * Send a goose: join a Google Meet in a local Playwright Chrome, tap every
 * remote audio stream via Web Audio, and stream the PCM to Gemini's Live API
 * (a persistent WebSocket) for real-time transcription. Lines stream to the
 * dashboard over SSE (see server.ts), updating live as each person speaks.
 *
 * The same session is also the goose on camera: a HeyGen LiveAvatar (packages/liveavatar) is
 * the tab's fake camera + mic, voiced by ElevenLabs (packages/voice). The brain (agentBrain.ts)
 * decides; the rig speaks. A room transcription fragment while the goose is talking interrupts
 * it (barge-in, HLD §5.5). The room audio tap skips the avatar's own playback elements
 * (data-plus1-avatar) so the goose never transcribes itself.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import type { BrowserContext, Page } from "playwright-core";
import { AvatarRig, LiveAvatarClient, type Emote } from "@plus1/liveavatar";
import { FillerCache, voiceFromEnv, type ElevenLabsTts, type FillerKind } from "@plus1/voice";
import { env, envOptional } from "./env.js";
import { joinMeet, launchMeetChrome } from "./meetPresent.js";
import { GOOSE_NAME, decideAction, postToMeetChat, type Decision, type ToolAccess } from "./agentBrain.js";
import { executeTool } from "./tools.js";
import {
  getGooseSettings,
  getMeeting,
  listMeetings,
  previewOf,
  saveMeeting,
  setMeetingPurpose,
  storeEnabled,
} from "./store.js";

/** Ignore transcription fragments this soon after the goose stopped: they're often its own tail. */
const BARGE_IN_GUARD_MS = 400;

// Auto-act tuning.
const CONFIDENCE_THRESHOLD = Number(process.env.BRAIN_CONFIDENCE ?? 0.7);
const ACTION_COOLDOWN_MS = 9000; // min gap between the goose acting
const BRAIN_DEBOUNCE_MS = 700; // wait for the line to settle before deciding
const BRAIN_MIN_INTERVAL_MS = 4000; // cap how often we call Gemini to read the room

// esbuild (via tsx) rewrites `function foo(){}` as `__name(function foo(){}, "foo")`.
// That helper lives in the Node module, not the page, so any function we inject
// with page.evaluate references an undefined `__name`. Seed a no-op shim first.
const NAME_SHIM = "window.__name = window.__name || function (t) { return t; };";

const TARGET_RATE = 16000; // Gemini Live wants 16kHz mono PCM
const FRAME_MS = 250; // how often the page ships an audio frame to Node
const LINE_GAP_MS = 1200; // finalize a transcript line after this much silence
// Dedicated real-time transcription model over the Live API (WebSocket). Billed
// by session, not per-request, so no RPM rate limits. Override if you like.
const LIVE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-3.5-transcribe-live";
const LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

// Node 22+ exposes a global WebSocket; type it loosely to avoid lib.dom.
const WS = (globalThis as { WebSocket: new (url: string) => LiveSocket }).WebSocket;
interface LiveSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}

export type SessionStatus =
  | "joining"
  | "waiting-admit"
  | "listening"
  | "ended"
  | "error";

export interface TranscriptLine {
  id: string;
  t: number; // ms since capture started
  at: string; // ISO wall clock
  text: string;
  partial?: boolean; // true while the line is still being spoken
  agent?: boolean; // a line the goose spoke (via the avatar)
  speaker?: string; // the goose's name on its own lines
}

export interface AvatarStatus {
  session: string; // LiveAvatar session state
  media: string; // in-page media state (what Meet sees)
  speaking: boolean;
}

export interface DecisionRecord extends Decision {
  id: string;
  t: number;
  at: string;
  outcome?: string; // what actually happened when we acted
}

interface Session {
  id: string;
  meetUrl: string;
  purpose?: string; // what the meeting is for — the dashboard's label for it
  status: SessionStatus;
  createdAt: string;
  startedAt?: number; // Date.now() when listening began
  error?: string;
  notes: string[];
  lines: TranscriptLine[];
  bus: EventEmitter;
  context?: BrowserContext;
  live?: LiveSocket; // Gemini Live WebSocket
  liveReady?: boolean;
  currentLineId?: string; // the line currently being built from the stream
  gapTimer?: ReturnType<typeof setTimeout>;
  // Brain / auto-act state.
  page?: Page; // the Meet tab, for chat + speak actions
  decisions: DecisionRecord[];
  brainTimer?: ReturnType<typeof setTimeout>;
  brainBusy?: boolean;
  lastBrainAt?: number;
  lastActionAt?: number;
  quotaNotedAt?: number;
  remoteStreams?: number; // tapped remote audio streams ≈ other participants
  // ── the goose on camera ──
  rig?: AvatarRig;
  tts?: ElevenLabsTts;
  fillers?: FillerCache;
  avatar: AvatarStatus;
  lastSpeechEndedAt: number;
  config?: SessionConfig; // from the dashboard's Goose tab
  memory: string[]; // standing instructions + facts to honor every turn
  muted?: boolean; // chat-only mode: keep listening, but type instead of speak
}

/** Per-session goose configuration, sent from the dashboard on join. */
export interface SessionConfig {
  name?: string;
  autonomy?: number; // 0 = notetaker, 100 = action taker
  confidence?: number; // 0..100 — below this it asks instead of guessing
  guardrails?: { sendApproval?: boolean; noComp?: boolean; noDeadlines?: boolean };
  servers?: Record<string, boolean>;
  localAccess?: "read" | "write"; // when servers.local is on
}

/** Configured display name, falling back to the code default. */
function nameOf(s: Session): string {
  return s.config?.name?.trim() || GOOSE_NAME;
}

/** Confidence threshold: the tab's 0..100 slider, or the env/default. */
function thresholdOf(s: Session): number {
  const c = s.config?.confidence;
  return typeof c === "number" ? Math.min(1, Math.max(0, c / 100)) : CONFIDENCE_THRESHOLD;
}

function autonomyOf(s: Session): number {
  const a = s.config?.autonomy;
  return typeof a === "number" ? a : 50;
}

/** Which tools this session may use, from the Goose config's server toggles. */
function toolAccessOf(s: Session): ToolAccess {
  const servers = s.config?.servers;
  const files: ToolAccess["files"] = !servers?.local
    ? "off"
    : s.config?.localAccess === "write"
      ? "write"
      : "read";
  return {
    federato: servers?.federato !== false,
    files,
  };
}

const sessions = new Map<string, Session>();

// ── MongoDB mirror ────────────────────────────────────────────────────────
// Live state stays in the Map above; every meaningful change is flushed to
// Atlas (debounced, so a chatty transcript is one write per second, not one
// per fragment). Storage failures are logged and never touch the meeting.
const PERSIST_DEBOUNCE_MS = 1000;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Snapshot a session as the document shape the store writes. */
function toDoc(s: Session) {
  const endedAt = s.status === "ended" || s.status === "error" ? new Date().toISOString() : undefined;
  return {
    _id: s.id,
    meetUrl: s.meetUrl,
    purpose: s.purpose,
    status: s.status,
    createdAt: s.createdAt,
    endedAt,
    durationMs: s.startedAt ? Date.now() - s.startedAt : undefined,
    error: s.error,
    notes: s.notes,
    // Only settled lines are worth storing; partials are rewritten constantly.
    lines: s.lines
      .filter((l) => !l.partial && l.text.trim())
      .map((l) => ({ id: l.id, t: l.t, at: l.at, text: l.text, agent: l.agent, speaker: l.speaker })),
    decisions: s.decisions,
  };
}

/** Queue a flush to Mongo. `now` skips the debounce (session start / end). */
function persist(s: Session, now = false): void {
  if (!storeEnabled()) return;
  const existing = persistTimers.get(s.id);
  if (existing) clearTimeout(existing);
  const flush = () => {
    persistTimers.delete(s.id);
    void saveMeeting(toDoc(s));
  };
  if (now) {
    flush();
    return;
  }
  persistTimers.set(s.id, setTimeout(flush, PERSIST_DEBOUNCE_MS));
}

function emit(s: Session, event: string, data: unknown): void {
  s.bus.emit("event", { event, data });
}

function setStatus(s: Session, status: SessionStatus, error?: string): void {
  s.status = status;
  if (error) s.error = error;
  emit(s, "status", { status, error, notes: s.notes });
  persist(s, true);
}

/** Tear down the Live socket, gap timer, and Chrome window (flushing the profile). */
async function closeContext(s: Session): Promise<void> {
  if (s.gapTimer) clearTimeout(s.gapTimer);
  finalizeLine(s);
  try {
    s.live?.close();
  } catch {
    /* already closing */
  }
  s.live = undefined;
  s.liveReady = false;

  const rig = s.rig;
  s.rig = undefined;
  if (rig) await rig.stop().catch(() => {});

  const ctx = s.context;
  s.context = undefined;
  if (!ctx) return;
  try {
    await ctx.close();
  } catch {
    /* already gone */
  }
}

/** A note visible to the operator (SSE `note` event) plus the server console. */
function note(s: Session, msg: string): void {
  s.notes.push(msg);
  console.log(`[goose ${s.id.slice(0, 8)}] ${msg}`);
  emit(s, "note", { msg });
  persist(s);
}

function summarize(s: Session) {
  return {
    id: s.id,
    meetUrl: s.meetUrl,
    purpose: s.purpose,
    preview: previewOf(s.lines.filter((l) => !l.partial)),
    status: s.status,
    createdAt: s.createdAt,
    durationMs: s.startedAt ? Date.now() - s.startedAt : undefined,
    error: s.error,
    lineCount: s.lines.length,
    live: true as const,
  };
}

/**
 * Every meeting the dashboard should see: the ones running in this process
 * plus everything Atlas remembers from previous runs. In-memory wins on id
 * collision, since it is the fresher copy.
 */
export async function listSessions() {
  const live = [...sessions.values()].map(summarize);
  const stored = await listMeetings();
  const liveIds = new Set(live.map((s) => s.id));
  const merged = [
    ...live,
    ...stored.filter((d) => !liveIds.has(d.id)).map((d) => ({ ...d, live: false as const })),
  ];
  return merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getSession(id: string) {
  const s = sessions.get(id);
  if (s) {
    return {
      id: s.id,
      meetUrl: s.meetUrl,
      purpose: s.purpose,
      status: s.status,
      createdAt: s.createdAt,
      error: s.error,
      notes: s.notes,
      lines: s.lines,
      decisions: s.decisions,
      live: true,
    };
  }
  const doc = await getMeeting(id);
  if (!doc) return undefined;
  return {
    id: doc._id,
    meetUrl: doc.meetUrl,
    purpose: doc.purpose,
    status: doc.status,
    createdAt: doc.createdAt,
    endedAt: doc.endedAt,
    durationMs: doc.durationMs,
    error: doc.error,
    notes: doc.notes ?? [],
    lines: doc.lines ?? [],
    decisions: doc.decisions ?? [],
    live: false,
  };
}

/** Subscribe an SSE client. Replays current state, then streams live events. */
export function subscribe(id: string, res: Response): boolean {
  const s = sessions.get(id);
  if (!s) return false;

  const write = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Catch the client up to the current state.
  write("status", { status: s.status, error: s.error, notes: s.notes });
  for (const line of s.lines) write("line", line);
  for (const d of s.decisions) write("decision", d);
  write("avatar", s.avatar);

  const onEvent = (msg: { event: string; data: unknown }) => {
    write(msg.event, msg.data);
  };
  s.bus.on("event", onEvent);

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
  res.on("close", () => {
    clearInterval(keepAlive);
    s.bus.off("event", onEvent);
  });
  return true;
}

/** Kick off a join + transcription session; returns immediately. */
export function startMeetTranscription(
  meetUrl: string,
  config?: SessionConfig,
  purpose?: string,
): { sessionId: string } {
  const id = randomUUID();
  const session: Session = {
    id,
    meetUrl,
    purpose: purpose?.trim() || undefined,
    status: "joining",
    createdAt: new Date().toISOString(),
    notes: [],
    lines: [],
    decisions: [],
    bus: new EventEmitter(),
    avatar: { session: "idle", media: "idle", speaking: false },
    lastSpeechEndedAt: 0,
    config,
    memory: [],
  };
  session.bus.setMaxListeners(50);
  sessions.set(id, session);
  persist(session, true);

  void runSession(session).catch(async (e) => {
    note(session, `crashed: ${(e as Error).message}`);
    setStatus(session, "error", (e as Error).message);
    await closeContext(session); // quit the Chrome window on crash
  });

  return { sessionId: id };
}

/**
 * Update a live session's goose config mid-meeting. The brain reads name /
 * autonomy / confidence / tool access fresh every turn, so a merge here takes
 * effect on the next decision — no rejoin needed. (The Meet display name is
 * fixed at join; everything else is live.)
 */
export function updateSessionConfig(id: string, patch: SessionConfig): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  s.config = { ...s.config, ...patch };
  note(s, `Config updated live (name=${nameOf(s)}, autonomy=${autonomyOf(s)}, files=${toolAccessOf(s).files}).`);
  return true;
}

/**
 * Relabel a meeting. Updates the live session when it is still running (which
 * re-persists it) and the stored document otherwise, so renaming works for
 * past meetings too.
 */
export async function renameSession(id: string, purpose: string): Promise<boolean> {
  const s = sessions.get(id);
  if (s) {
    s.purpose = purpose.trim() || undefined;
    persist(s, true);
    return true;
  }
  return setMeetingPurpose(id, purpose);
}

export async function stopSession(id: string): Promise<boolean> {
  const s = sessions.get(id);
  if (!s) return false;
  setStatus(s, "ended");
  await closeContext(s);
  return true;
}

async function runSession(s: Session): Promise<void> {
  // No config from the dashboard (e.g. a curl join, or a fresh browser)? Use
  // whatever the Goose tab last saved to MongoDB.
  if (!s.config) {
    const stored = (await getGooseSettings()) as SessionConfig | null;
    if (stored) {
      s.config = stored;
      note(s, `Loaded saved goose settings (name=${nameOf(s)}, autonomy=${autonomyOf(s)}).`);
    }
  }

  const context = await launchMeetChrome();
  s.context = context;

  // If the operator closes the Chrome window, end the session cleanly.
  context.on("close", () => {
    if (s.status !== "ended" && s.status !== "error") {
      note(s, "Chrome window closed — ending session.");
      setStatus(s, "ended");
    }
    s.context = undefined;
  });

  await context.grantPermissions(["microphone", "camera", "notifications"], {
    origin: "https://meet.google.com",
  });

  // tsx/esbuild wraps functions with a __name() helper that doesn't exist in
  // the browser; seed a shim so page.evaluate(fn) doesn't throw ReferenceError.
  await context.addInitScript({ content: NAME_SHIM });

  const page = context.pages()[0] ?? (await context.newPage());
  s.page = page;

  // The goose's face and voice. Must be prepared BEFORE navigating: the (tiny) init script
  // replaces getUserMedia so the camera/mic Meet acquires are the avatar canvas and mixer.
  const rig = await prepareAvatar(s, page);

  // Meet under automation doesn't always fire DOMContentLoaded for Playwright; commit is enough,
  // joinMeet waits for the elements it needs.
  await page.goto(s.meetUrl, { waitUntil: "commit", timeout: 30_000 }).catch((e) => note(s, `goto: ${(e as Error).message.split("\n")[0]} (continuing)`));
  note(s, `Opened Meet ${s.meetUrl}`);
  setStatus(s, "joining");

  // Start the avatar while the prejoin screen is up so the camera preview already shows it.
  const avatarUp = rig
    ? rig.start().then(() => note(s, "Avatar is live on the camera.")).catch((e) => note(s, `Avatar failed to start: ${(e as Error).message}`))
    : Promise.resolve();

  const joined = await joinMeet(page, s.notes, { muted: false, camera: rig ? "on" : "off", displayName: `${nameOf(s)} (plus1 AI)` });
  if (!joined) {
    setStatus(s, "error", s.notes[s.notes.length - 1] ?? "Could not join the meeting.");
    await closeContext(s); // quit the Chrome window if we couldn't get in
    return;
  }
  note(s, "Joined the meeting.");
  await avatarUp;
  // Meet reloads the tab after sign-in and on some errors; re-plumb the avatar when that happens.
  page.on("load", () => void rig?.reattach());

  s.startedAt = Date.now();
  if (!rig) note(s, "No LIVEAVATAR_API_KEY — the goose can chat and use tools, but has no face or voice.");
  openLive(s);
  await startAudioCapture(page, s);
  setStatus(s, "listening");
}

// ── Gemini Live: one WebSocket per session, streamed continuously ──────────

function openLive(s: Session): void {
  const key = env("GEMINI_API_KEY");
  let ws: LiveSocket;
  try {
    ws = new WS(`${LIVE_URL}?key=${key}`);
  } catch (e) {
    note(s, `Live connect failed: ${(e as Error).message}`);
    return;
  }
  s.live = ws;
  s.liveReady = false;

  ws.onopen = () =>
    ws.send(
      JSON.stringify({
        setup: { model: `models/${LIVE_MODEL}`, inputAudioTranscription: {} },
      }),
    );
  ws.onmessage = (ev) => void handleLiveMessage(s, ev.data);
  ws.onerror = (e) => note(s, `Live error: ${e?.message ?? "socket error"}`);
  ws.onclose = () => {
    s.liveReady = false;
    if (s.status === "listening") {
      note(s, "Live socket closed — reconnecting.");
      setTimeout(() => {
        if (s.status === "listening") openLive(s);
      }, 1000);
    }
  };
}

async function handleLiveMessage(s: Session, data: unknown): Promise<void> {
  let text: string;
  if (typeof data === "string") text = data;
  else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString();
  else if (data && typeof (data as Blob).arrayBuffer === "function")
    text = Buffer.from(await (data as Blob).arrayBuffer()).toString();
  else text = String(data);

  let m: {
    setupComplete?: unknown;
    serverContent?: {
      inputTranscription?: { text?: string };
      turnComplete?: boolean;
    };
  };
  try {
    m = JSON.parse(text);
  } catch {
    return;
  }

  if (m.setupComplete) {
    s.liveReady = true;
    note(s, "Live transcription connected.");
    return;
  }
  const frag = m.serverContent?.inputTranscription?.text;
  if (frag) appendFragment(s, frag);
  if (m.serverContent?.turnComplete) finalizeLine(s);
}

/** Append a streamed fragment to the in-progress line (creating it if needed). */
function appendFragment(s: Session, frag: string): void {
  if (s.gapTimer) clearTimeout(s.gapTimer);

  // Barge-in: a human is talking while the goose speaks → cut the goose off (mechanical, no decision).
  if (s.rig?.isSpeaking && Date.now() - s.lastSpeechEndedAt > BARGE_IN_GUARD_MS && frag.trim()) {
    s.rig.interrupt();
    note(s, `Barge-in: someone spoke over the goose ("${frag.trim().slice(0, 40)}").`);
  }

  let line = s.currentLineId
    ? s.lines.find((l) => l.id === s.currentLineId)
    : undefined;
  if (!line) {
    line = {
      id: randomUUID(),
      t: s.startedAt ? Date.now() - s.startedAt : 0,
      at: new Date().toISOString(),
      text: "",
      partial: true,
    };
    s.currentLineId = line.id;
    s.lines.push(line);
  }
  line.text += frag;
  emit(s, "line", line);

  // A pause in speech ends the line even if the model didn't send turnComplete.
  s.gapTimer = setTimeout(() => finalizeLine(s), LINE_GAP_MS);
}

/** Seal the current line so the next fragment starts a fresh one. */
function finalizeLine(s: Session): void {
  if (s.gapTimer) {
    clearTimeout(s.gapTimer);
    s.gapTimer = undefined;
  }
  if (!s.currentLineId) return;
  const line = s.lines.find((l) => l.id === s.currentLineId);
  s.currentLineId = undefined;
  if (!line) return;
  line.partial = false;
  emit(s, "line", line);
  persist(s);
  if (!line.agent) scheduleBrain(s);
}

// ── Brain: decide + act on the settled transcript ──────────────────────────

function scheduleBrain(s: Session): void {
  if (s.brainTimer) clearTimeout(s.brainTimer);
  s.brainTimer = setTimeout(() => void runBrain(s), BRAIN_DEBOUNCE_MS);
}

// Cheap local gate so we only spend a Gemini call when a line plausibly needs
// the goose — a name mention, a question, or a request. Keeps us well within
// free-tier daily quotas and makes the brain react to real triggers.
const ADDRESSED_RE = /\bgoose\b|\bplus[\s-]?(one|1)\b/i;
const REQUEST_RE =
  /\b(can|could|would|will|please|draft|write|send|email|schedule|book|check|look\s?up|find|search|summar|remind|add|create|what('?s| is| are)|who('?s| is)|when|where|how|why|should we|do we)\b/i;
// An open task floated to the room — cues the goose can volunteer for.
const OPEN_TASK_RE =
  /\b(can someone|could someone|who can|who wants|we should|we need to|someone needs to|let'?s|to-?do|action item|any volunteers|who'?s going to)\b/i;

// "mute / use the chat" and "unmute / talk again" — a spoken output-mode toggle.
const MUTE_RE =
  /\b(mute yourself|mute|be quiet|stay quiet|stop talking|stop speaking|don'?t talk|quit talking|use (the )?chat|just (use )?(the )?chat|chat only|type it|put it in (the )?chat)\b/i;
const UNMUTE_RE =
  /\b(unmute|you can talk|talk again|start talking|speak up|out loud|use your voice|voice again|talk to us)\b/i;

/** A spoken command to switch output mode, or null. Checked only when addressed. */
function detectModeCommand(text: string): "chat" | "voice" | null {
  if (UNMUTE_RE.test(text)) return "voice";
  if (MUTE_RE.test(text)) return "chat";
  return null;
}

function latestHumanText(s: Session): string {
  for (let i = s.lines.length - 1; i >= 0; i--) {
    const l = s.lines[i]!;
    if (!l.partial && !l.agent) return l.text;
  }
  return "";
}

const MEMORY_CAP = 24;
/** Merge new things-to-remember into the session's standing memory. */
function rememberFrom(s: Session, items?: string[]): void {
  if (!items?.length) return;
  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;
    if (s.memory.some((m) => m.toLowerCase() === item.toLowerCase())) continue;
    s.memory.push(item);
    note(s, `Remembering: "${item}"`);
  }
  if (s.memory.length > MEMORY_CAP) s.memory = s.memory.slice(-MEMORY_CAP);
}

/** Addressed by the "goose"/"plus one" aliases or the session's configured name. */
function isAddressed(s: Session, text: string): boolean {
  if (ADDRESSED_RE.test(text)) return true;
  const name = nameOf(s);
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(text);
}

function isOneOnOne(s: Session): boolean {
  // remoteStreams counts tapped remote audio streams ≈ other participants.
  // 1 other person → everything they say is directed at the goose.
  return (s.remoteStreams ?? 0) <= 1;
}

function worthConsidering(s: Session): boolean {
  // In a 1:1, the other person is talking to the goose — consider every line.
  if (isOneOnOne(s)) return true;
  const recent = s.lines.filter((l) => !l.partial && !l.agent).slice(-2);
  const text = recent.map((l) => l.text).join(" ");
  if (!text.trim()) return false;
  // Goose's job is to catch mistakes and participate, so once it's balanced-or-higher,
  // or it's holding a standing instruction to watch for something, weigh in on any
  // substantive line and let the planner decide whether it's actually welcome.
  const substantive = text.trim().split(/\s+/).length >= 3;
  if (substantive && (autonomyOf(s) >= 34 || s.memory.length > 0)) return true;
  return (
    isAddressed(s, text) ||
    text.includes("?") ||
    REQUEST_RE.test(text) ||
    OPEN_TASK_RE.test(text)
  );
}

function transcriptWindow(s: Session, maxLines = 14): string {
  return s.lines
    .filter((l) => !l.partial)
    .slice(-maxLines)
    .map((l) => `[${l.agent ? "goose" : "speaker"}] ${l.text}`)
    .join("\n");
}

async function runBrain(s: Session): Promise<void> {
  if (s.status !== "listening" || s.brainBusy) return;
  if (s.rig?.isSpeaking) return; // barge-in will stop us if a human wants the floor; decide afterwards
  if (s.lastActionAt && Date.now() - s.lastActionAt < ACTION_COOLDOWN_MS) return;
  // Cap Gemini read frequency to stay within rate limits on busy meetings.
  if (s.lastBrainAt && Date.now() - s.lastBrainAt < BRAIN_MIN_INTERVAL_MS) return;
  // Only consult the LLM when a line actually looks actionable.
  if (!worthConsidering(s)) return;

  // Spoken output-mode toggle: "mute / use the chat" ↔ "talk again". Persists.
  const latest = latestHumanText(s);
  if (isAddressed(s, latest) || isOneOnOne(s)) {
    const mode = detectModeCommand(latest);
    if (mode && s.muted !== (mode === "chat")) {
      s.muted = mode === "chat";
      note(s, s.muted ? "Muted — switching to chat-only (still listening)." : "Unmuted — talking out loud again.");
    }
  }

  s.brainBusy = true;
  s.lastBrainAt = Date.now();
  try {
    const decision = await decideAction(transcriptWindow(s), {
      oneOnOne: isOneOnOne(s),
      name: nameOf(s),
      autonomy: autonomyOf(s),
      access: toolAccessOf(s),
      memory: s.memory,
      muted: s.muted,
    });
    rememberFrom(s, decision.remember);
    const record: DecisionRecord = {
      ...decision,
      id: randomUUID(),
      t: s.startedAt ? Date.now() - s.startedAt : 0,
      at: new Date().toISOString(),
    };

    const willAct =
      decision.act &&
      decision.action !== "none" &&
      decision.confidence >= thresholdOf(s);

    if (willAct) {
      record.outcome = "acting";
      s.decisions.push(record);
      emit(s, "decision", record);
      s.lastActionAt = Date.now();
      record.outcome = await executeDecision(s, decision);
      emit(s, "decision", record); // update with the real outcome
      persist(s);
    } else {
      // Still surface the reasoning so the operator sees the goose thinking.
      record.outcome = decision.action === "none" ? "held" : "below threshold";
      s.decisions.push(record);
      emit(s, "decision", record);
      persist(s);
    }
  } catch (e) {
    const err = e as Error & { transient?: boolean; quota?: boolean };
    if (err.quota) {
      // Daily free-tier quota gone — surface it once so it's never silent.
      if (!s.quotaNotedAt || Date.now() - s.quotaNotedAt > 60_000) {
        s.quotaNotedAt = Date.now();
        note(
          s,
          "Gemini brain quota exhausted for today (free tier). Enable billing on the key, or set GEMINI_BRAIN_MODEL to another model.",
        );
      }
    } else if (err.transient) {
      // Gemini was momentarily overloaded — skip this read, try the next line.
      console.log(`[goose ${s.id.slice(0, 8)}] brain busy, skipping: ${err.message}`);
    } else {
      note(s, `brain error: ${err.message}`);
    }
  } finally {
    s.brainBusy = false;
  }
}

async function executeDecision(s: Session, d: Decision): Promise<string> {
  const page = s.page;
  if (!page) return "no page";

  if (d.action === "chat" && d.chatMessage) {
    note(s, `Posting to chat: "${d.chatMessage}"`);
    const ok = await postToMeetChat(page, d.chatMessage);
    return ok ? "posted to chat" : "chat send failed";
  }

  if (d.action === "speak" && d.say) {
    // Chat-only mode (asked to mute): type it instead of speaking.
    if (s.muted) {
      note(s, `Muted → chat: "${d.say}"`);
      const ok = await postToMeetChat(page, d.say);
      return ok ? "muted; posted to chat" : "muted; chat failed";
    }
    note(s, `Speaking: "${d.say}"`);
    if (!s.rig) {
      const ok = await postToMeetChat(page, `${nameOf(s)}: ${d.say}`);
      return ok ? "no avatar; posted to chat instead" : "no avatar and chat failed";
    }
    try {
      const u = s.rig.speakText(d.say);
      gooseLine(s, d.say, u.done);
      const r = await u.done;
      return r.outcome === "completed" ? "spoke in the meeting" : r.outcome === "interrupted" ? "interrupted by a human" : `speak ${r.outcome}: ${r.error?.message ?? ""}`;
    } catch (e) {
      return `speak failed: ${(e as Error).message}`;
    }
  }

  if (d.action === "tool" && d.tool?.name) {
    const t = d.tool;
    const access = toolAccessOf(s);

    // Never run a tool silently — say what's happening first (audio + transcript).
    if (d.say) {
      note(s, `Announcing: "${d.say}"`);
      try {
        if (s.rig && !s.muted) {
          const u = s.rig.speakText(d.say);
          gooseLine(s, d.say, u.done);
          await u.done;
        } else {
          await postToMeetChat(page, `${nameOf(s)}: ${d.say}`);
        }
      } catch (e) {
        // e.g. LiveAvatar socket dropped mid-utterance — carry on with the tool.
        note(s, `announce failed (${(e as Error).message}); running the tool anyway`);
      }
    }

    note(s, `Tool: ${t.name}(${t.command ?? t.path ?? t.query ?? ""})`);
    const result = await executeTool(t, access);
    note(s, `Tool result: ${result}`);
    // Share the tool's answer with the room via chat.
    await postToMeetChat(page, `goose — ${result}`);
    return `tool: ${result}`;
  }

  return "nothing to do";
}

// ── The goose on camera (LiveAvatar + ElevenLabs) ─────────────────────────

function emitAvatar(s: Session): void {
  emit(s, "avatar", s.avatar);
}

/** Build the rig if LIVEAVATAR_API_KEY is set; otherwise the session is transcription + chat only. */
async function prepareAvatar(s: Session, page: Page): Promise<AvatarRig | undefined> {
  const apiKey = envOptional("LIVEAVATAR_API_KEY");
  const avatarId = envOptional("LIVEAVATAR_AVATAR_ID");
  if (!apiKey || !avatarId) return undefined;
  let tts: ElevenLabsTts | undefined;
  try {
    tts = voiceFromEnv();
    s.tts = tts;
    s.fillers = new FillerCache({ tts, voiceKey: `${tts.voiceId}:${tts.model}` });
    const warmed = await s.fillers.warm();
    note(s, `Voice ready (${warmed.loaded} fillers cached, ${warmed.synthesized} synthesized).`);
  } catch (e) {
    note(s, `ElevenLabs not configured (${(e as Error).message}); the goose has a face but no voice.`);
  }
  const rig = new AvatarRig({
    client: new LiveAvatarClient({ apiKey }),
    avatarId,
    sandbox: envOptional("LIVEAVATAR_SANDBOX") !== "0",
    tts,
    page: { label: nameOf(s) },
  });
  rig.on("sessionState", (st) => { s.avatar.session = st; emitAvatar(s); });
  rig.on("mediaState", (st) => { s.avatar.media = st; emitAvatar(s); });
  rig.on("speaking", (e) => {
    if (e.phase === "started") { s.avatar.speaking = true; emitAvatar(s); }
    if (e.phase === "ended") { s.avatar.speaking = false; s.lastSpeechEndedAt = Date.now(); emitAvatar(s); }
  });
  rig.on("warning", (w) => console.log(`[goose ${s.id.slice(0, 8)}] avatar warning: ${w}`));
  rig.on("error", (e) => console.log(`[goose ${s.id.slice(0, 8)}] avatar error: ${e.message}`));
  rig.on("dead", (e) => note(s, `Avatar gave up restarting: ${e.message}`));
  s.rig = rig;
  await rig.prepare(page);
  return rig;
}

/** A transcript line for something the goose said, updated as it plays. */
function gooseLine(s: Session, text: string, done: Promise<{ outcome: string }>): void {
  const line: TranscriptLine = {
    id: randomUUID(),
    t: s.startedAt ? Date.now() - s.startedAt : 0,
    at: new Date().toISOString(),
    text,
    partial: true,
    agent: true,
    speaker: nameOf(s),
  };
  s.lines.push(line);
  emit(s, "line", line);
  void done.then((r) => {
    line.partial = false;
    if (r.outcome === "interrupted") line.text = `${text} …`;
    emit(s, "line", line);
    persist(s);
  });
}

function requireRig(id: string): { s: Session; rig: AvatarRig } {
  const s = sessions.get(id);
  if (!s) throw new Error("No such session");
  if (!s.rig) throw new Error("This session has no avatar (LIVEAVATAR_API_KEY not set)");
  return { s, rig: s.rig };
}

/** agent.speak from the operator/dashboard: text → ElevenLabs → avatar. Preempts whatever is playing. */
export function speakInSession(id: string, text: string): { id: string } {
  const { s, rig } = requireRig(id);
  const u = rig.speakText(text);
  gooseLine(s, text, u.done);
  return { id: u.id };
}

/** Instant cached filler while the planner (or the operator) thinks. */
export function fillerInSession(id: string, kind: FillerKind = "ack"): { id: string; phrase: string } | null {
  const { s, rig } = requireRig(id);
  const f = s.fillers?.pick(kind);
  if (!f) return null;
  const u = rig.speakPcm(f.pcm, { label: f.phrase });
  gooseLine(s, f.phrase, u.done);
  return { id: u.id, phrase: f.phrase };
}

export function interruptSession(id: string): void {
  requireRig(id).rig.interrupt();
}

export async function honkSession(id: string): Promise<void> {
  await requireRig(id).rig.honk();
}

export async function emoteSession(id: string, emote: Emote): Promise<void> {
  await requireRig(id).rig.emote(emote);
}

export function avatarStatus(id: string): AvatarStatus | undefined {
  return sessions.get(id)?.avatar;
}

async function startAudioCapture(page: Page, s: Session): Promise<void> {
  let lastTap = -1;
  let warnedSilent = false;

  await page.exposeFunction("__plus1Audio", (b64: string, taps: number) => {
    if (taps !== lastTap) {
      lastTap = taps;
      s.remoteStreams = taps;
      note(
        s,
        `Tapped ${taps} audio stream${taps === 1 ? "" : "s"} in the room${taps <= 1 ? " — treating as a 1:1, will respond directly." : "."}`,
      );
    }
    const ws = s.live;
    if (ws && ws.readyState === 1 && s.liveReady) {
      ws.send(
        JSON.stringify({
          realtimeInput: { audio: { data: b64, mimeType: "audio/pcm;rate=16000" } },
        }),
      );
    }
  });

  await page.exposeFunction("__plus1Diag", (msg: string) => note(s, msg));

  // Ensure the __name shim exists on THIS already-loaded document (a string
  // eval skips esbuild's wrapping) before we inject the transpiled function.
  await page.evaluate(NAME_SHIM);

  await page.evaluate(
    ({ targetRate, frameMs }) => {
      const w = window as unknown as {
        __plus1Cap?: boolean;
        __plus1Audio: (b: string, taps: number) => void;
        __plus1Diag: (m: string) => void;
      };
      if (w.__plus1Cap) return;
      w.__plus1Cap = true;

      const ctx = new AudioContext();
      // Programmatically-created contexts often start suspended; without this
      // the ScriptProcessor never fires and no audio is captured.
      void ctx.resume().then(() => w.__plus1Diag(`AudioContext ${ctx.state} @ ${ctx.sampleRate}Hz`));

      const bus = ctx.createGain();
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      let acc: Float32Array[] = [];
      let taps = 0;
      const seen = new WeakSet<MediaStream>();

      const tap = (stream: MediaStream | null) => {
        try {
          if (!stream || seen.has(stream)) return;
          if (!stream.getAudioTracks || stream.getAudioTracks().length === 0) return;
          seen.add(stream);
          ctx.createMediaStreamSource(stream).connect(bus);
          taps += 1;
        } catch {
          /* stream not tappable */
        }
      };

      // Intercept every future srcObject assignment (Meet attaches remote audio
      // to media elements as participants speak).
      const proto = HTMLMediaElement.prototype as unknown as object;
      const desc = Object.getOwnPropertyDescriptor(proto, "srcObject");
      if (desc && desc.set) {
        Object.defineProperty(proto, "srcObject", {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set(this: HTMLMediaElement, v: MediaStream | null) {
            desc.set!.call(this, v);
            if (this.dataset && this.dataset.plus1Avatar) return; // the goose's own voice/video, not the room
            tap(v);
          },
        });
      }
      const scan = () =>
        document.querySelectorAll("audio:not([data-plus1-avatar]),video:not([data-plus1-avatar])").forEach((el) => {
          const stream = (el as HTMLMediaElement).srcObject as MediaStream | null;
          if (stream) tap(stream);
        });
      scan();
      // Catch streams the setter hook missed (already-attached, or re-attached).
      new MutationObserver(scan).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      setInterval(scan, 3000);

      // ScriptProcessor only fires when connected to a destination; route it
      // through a muted gain so it never plays back to the room.
      bus.connect(proc);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      proc.connect(mute);
      mute.connect(ctx.destination);

      proc.onaudioprocess = (e: AudioProcessingEvent) => {
        acc.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      const rate = ctx.sampleRate;
      // Ship small 16kHz PCM frames continuously so Gemini Live transcribes in
      // real time (its own VAD handles silence and turn boundaries).
      setInterval(() => {
        if (acc.length === 0) return;
        const total = acc.reduce((n, a) => n + a.length, 0);
        const flat = new Float32Array(total);
        let o = 0;
        for (const a of acc) {
          flat.set(a, o);
          o += a.length;
        }
        acc = [];

        const ratio = rate / targetRate;
        const outLen = Math.floor(flat.length / ratio);
        const out = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const sample = flat[Math.floor(i * ratio)] || 0;
          const v = Math.max(-1, Math.min(1, sample));
          out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }

        const bytes = new Uint8Array(out.buffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        w.__plus1Audio(btoa(bin), taps);
      }, frameMs);
    },
    { targetRate: TARGET_RATE, frameMs: FRAME_MS },
  );

  note(s, "Listening to the room.");

  // If a while goes by with no audio streams hooked, tell the operator.
  setTimeout(() => {
    if (lastTap <= 0 && !warnedSilent && s.status === "listening") {
      warnedSilent = true;
      note(s, "No audio streams yet — is anyone unmuted? Still listening.");
    }
  }, 20_000);
}
