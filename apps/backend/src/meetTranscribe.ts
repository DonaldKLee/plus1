/**
 * Send a plus1: join a Google Meet in a local Playwright Chrome, tap every
 * remote audio stream via Web Audio, and stream the PCM to Gemini's Live API
 * (a persistent WebSocket) for real-time transcription. Lines stream to the
 * dashboard over SSE (see server.ts), updating live as each person speaks.
 *
 * The same session is also the plus1 on camera: a HeyGen LiveAvatar (packages/liveavatar) is
 * the tab's fake camera + mic. Voice is ElevenLabs TTS (packages/voice) and/or OpenAI Realtime
 * speech-to-speech, selected by TALK_BACKEND. The brain (agentBrain.ts) decides on the Gemini
 * path; OpenAI Realtime decides on its path. A room transcription fragment while the plus1 is
 * talking interrupts it (barge-in, HLD §5.5). The room audio tap skips the avatar's own playback
 * elements (data-plus1-avatar) so the plus1 never transcribes itself.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import type { BrowserContext, Page } from "playwright-core";
import { AvatarRig, LiveAvatarClient, type Emote } from "@plus1/liveavatar";
import { FillerCache, voiceFromEnv, type ElevenLabsTts, type FillerKind } from "@plus1/voice";
import { env, envOptional } from "./env.js";
import { plus1Config } from "./plus1Config.js";
import { emailPolicyFromConfig, defaultRecipient } from "./email.js";
import { joinMeet, launchMeetChrome, leaveMeetCall, listMeetParticipantNames, stampWorkTitle, WORK_TAB_TITLE } from "./meetPresent.js";
import { onJevLiveView, startWorkBrowser, attachWorkBrowser } from "./jevAgent.js";
import { onWorkHold, showWorkHold } from "./workHold.js";
import { registerMeetingMedia, unregisterMeetingMedia } from "./browserWork.js";
import {
  plus1_NAME,
  applyStateUpdate,
  decideAction,
  emptyState,
  guardrailClauses,
  postToMeetChat,
  recordCompletedAction,
  type Decision,
  type MeetingState,
  type ToolAccess,
} from "./agentBrain.js";
import { runToolChain } from "./tools.js";
import {
  getplus1Settings,
  getMeeting,
  listMeetings,
  previewOf,
  saveMeeting,
  setMeetingPurpose,
  storeEnabled,
} from "./store.js";
import {
  OpenAIRealtimeSession,
  realtimeInstructions,
  realtimeToolsFor,
  runRealtimeTool,
  talkBackendOf,
  type TalkBackend,
} from "./openaiRealtime.js";

/** Ignore transcription fragments this soon after the plus1 stopped: they're often its own tail. */
const BARGE_IN_GUARD_MS = 400;
/** Don't cut the plus1 off for a blip or background noise — only when someone is genuinely
 *  talking over it. Interrupt once the current human utterance reaches this many words. */
const BARGE_IN_MIN_WORDS = 3;

// Auto-act tuning.
const CONFIDENCE_THRESHOLD = Number(process.env.BRAIN_CONFIDENCE ?? 0.7);
const ACTION_COOLDOWN_MS = 9000; // min gap between acting unprompted in a room
const DIRECT_COOLDOWN_MS = 1200; // when spoken to directly, stay responsive
const BRAIN_DEBOUNCE_MS = 700; // wait for the line to settle before deciding
const BRAIN_RETRY_MS = 600; // re-check when the brain was busy or the avatar was mid-sentence
const BRAIN_MIN_INTERVAL_MS = 4000; // cap how often we call Gemini to read the room
const DIRECT_BRAIN_MIN_INTERVAL_MS = 1200; // ...but don't throttle a real conversation

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
  agent?: boolean; // a line the plus1 spoke (via the avatar)
  speaker?: string; // the plus1's name on its own lines
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
  workTask?: string; // optional jev prompt for the work browser
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
  currentSpeaker?: string; // best-effort active speaker name, read from the Meet DOM
  gapTimer?: ReturnType<typeof setTimeout>;
  // Brain / auto-act state.
  page?: Page; // the Meet tab, for chat + speak actions
  workPage?: Page; // Browserbase live-view tab the avatar presents
  workSessionId?: string;
  workLiveOff?: () => void;
  decisions: DecisionRecord[];
  brainTimer?: ReturnType<typeof setTimeout>;
  brainBusy?: boolean;
  lastBrainAt?: number;
  lastActionAt?: number;
  quotaNotedAt?: number;
  remoteStreams?: number; // tapped remote audio streams ≈ other participants
  // ── the plus1 on camera ──
  rig?: AvatarRig;
  tts?: ElevenLabsTts;
  fillers?: FillerCache;
  avatar: AvatarStatus;
  lastSpeechEndedAt: number;
  config?: SessionConfig; // from the dashboard's plus1 tab
  memory: string[]; // standing instructions + facts to honor every turn
  state: MeetingState; // slot filling: active task, collected params, what's missing
  muted?: boolean; // chat-only mode: keep listening, but type instead of speak
  /** Gemini Live + ElevenLabs, or OpenAI Realtime speech-to-speech. */
  talkBackend?: TalkBackend;
  openai?: OpenAIRealtimeSession;
  /** Rebuild Realtime instructions when participant names refresh. */
  openaiBuildInstructions?: (people: string[]) => string;
  /** OpenAI agent line currently streaming into the transcript. */
  openaiAgentLineId?: string;
}

/** Per-session plus1 configuration, sent from the dashboard on join. */
export interface SessionConfig {
  name?: string;
  persona?: string; // freeform personality / instructions / context, injected into the prompt
  autonomy?: number; // 0 = notetaker, 100 = action taker
  confidence?: number; // 0..100 — below this it asks instead of guessing
  guardrails?: {
    sendApproval?: boolean;
    groundClaims?: boolean;
    noComp?: boolean;
    noDeadlines?: boolean;
  };
  servers?: Record<string, boolean>;
  localAccess?: "read" | "write"; // when servers.local is on
  email?: { allowlist?: string | string[]; defaultTo?: string };
}

/** Configured display name, falling back to the code default. */
function nameOf(s: Session): string {
  return s.config?.name?.trim() || plus1_NAME;
}

/** Freeform persona / instructions the operator set, or empty. */
function personaOf(s: Session): string {
  return s.config?.persona?.trim() ?? "";
}

/** The operator's guardrail toggles, resolved to hard rules for the prompt. */
function guardrailsOf(s: Session): string[] {
  return guardrailClauses(s.config?.guardrails);
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

/** Which tools this session may use, from the plus1 config's server toggles. */
function toolAccessOf(s: Session): ToolAccess {
  const servers = s.config?.servers;
  const files: ToolAccess["files"] = !servers?.local
    ? "off"
    : s.config?.localAccess === "write"
      ? "write"
      : "read";
  return {
    federato: servers?.federato !== false,
    intact: servers?.intact !== false,
    files,
    email: servers?.email === true,
    docs: false, // doc_pdf disabled — Federato/Intact PDF tools only
    browser: true,
    // Default to requiring approval: an unset guardrail must not mean "just send it".
    sendApproval: false,
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
    memory: s.memory,
    state: s.state,
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
  unregisterMeetingMedia(s.id);
  s.workLiveOff?.();
  s.workLiveOff = undefined;
  if (s.gapTimer) clearTimeout(s.gapTimer);
  finalizeLine(s);

  // Hang up Meet first so other participants see the plus1 leave — not just a
  // frozen/dead LiveAvatar tile while Chrome stays in the call.
  const meetPage = s.page;
  if (meetPage && !meetPage.isClosed()) {
    const leaveNotes: string[] = [];
    try {
      await Promise.race([
        leaveMeetCall(meetPage, leaveNotes),
        new Promise<boolean>((r) => setTimeout(() => r(false), 8_000)),
      ]);
    } catch (e) {
      leaveNotes.push(`leave failed: ${(e as Error).message}`);
    }
    for (const msg of leaveNotes) note(s, msg);
  }

  try {
    s.live?.close();
  } catch {
    /* already closing */
  }
  s.live = undefined;
  s.liveReady = false;

  try {
    s.openai?.close();
  } catch {
    /* already closing */
  }
  s.openai = undefined;

  const rig = s.rig;
  s.rig = undefined;
  if (rig) await Promise.race([rig.stop().catch(() => {}), new Promise((r) => setTimeout(r, 5_000))]);

  s.page = undefined;
  s.workPage = undefined;
  const ctx = s.context;
  s.context = undefined;
  if (!ctx) return;
  try {
    await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 8_000))]);
  } catch {
    /* already gone */
  }
}

/** A note visible to the operator (SSE `note` event) plus the server console. */
function note(s: Session, msg: string): void {
  s.notes.push(msg);
  console.log(`[plus1 ${s.id.slice(0, 8)}] ${msg}`);
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
      talkBackend: s.talkBackend ?? talkBackendOf(),
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
  write("state", s.state);

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
  workTask?: string,
): { sessionId: string } {
  const id = randomUUID();
  const session: Session = {
    id,
    meetUrl,
    purpose: purpose?.trim() || undefined,
    workTask: workTask?.trim() || undefined,
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
    state: emptyState(),
    talkBackend: talkBackendOf(),
  };
  session.bus.setMaxListeners(50);
  sessions.set(id, session);
  persist(session, true);
  if (config) emailPolicyFromConfig(config as Record<string, unknown>);

  void runSession(session).catch(async (e) => {
    note(session, `crashed: ${(e as Error).message}`);
    setStatus(session, "error", (e as Error).message);
    await closeContext(session); // quit the Chrome window on crash
  });

  return { sessionId: id };
}

/**
 * Update a live session's plus1 config mid-meeting. The brain reads name /
 * autonomy / confidence / tool access fresh every turn, so a merge here takes
 * effect on the next decision — no rejoin needed. (The Meet display name is
 * fixed at join; everything else is live.)
 */
export function updateSessionConfig(id: string, patch: SessionConfig): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  s.config = { ...s.config, ...patch };
  emailPolicyFromConfig(s.config as Record<string, unknown>);
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
  // whatever the plus1 tab last saved to MongoDB.
  if (!s.config) {
    const stored = (await getplus1Settings()) as SessionConfig | null;
    if (stored) {
      s.config = stored;
      emailPolicyFromConfig(stored as Record<string, unknown>);
      note(s, `Loaded saved plus1 settings (name=${nameOf(s)}, autonomy=${autonomyOf(s)}).`);
    }
  } else {
    emailPolicyFromConfig(s.config as Record<string, unknown>);
  }

  const context = await launchMeetChrome({ purpose: "avatar" });
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

  // Work tab first so Chrome can auto-select it by title when the avatar Presents.
  const workPage = context.pages()[0] ?? (await context.newPage());
  s.workPage = workPage;
  await stampWorkTitle(workPage);
  note(s, `Work tab titled "${WORK_TAB_TITLE}" — will hold the Browserbase live view`);

  const page = await context.newPage();
  s.page = page;
  // OpenAI Realtime owns the voice — do not wire ElevenLabs speak/filler into
  // screenWatch, or the avatar will flip mid-call during browser_work.
  const openaiTalk = (s.talkBackend ?? talkBackendOf()) === "openai";
  registerMeetingMedia(s.id, {
    meetPage: page,
    workPage,
    note: (msg) => note(s, msg),
    speak: openaiTalk
      ? undefined
      : async (text) => {
          await sayInRoom(s, text);
        },
    filler: openaiTalk
      ? undefined
      : async (kind) => {
          await playFiller(s, kind);
        },
    busy: () => !!(s.rig?.isSpeaking || s.muted || s.openai?.isSpeaking),
  });

  // The plus1's face and voice. Must be prepared BEFORE navigating: the (tiny) init script
  // replaces getUserMedia so the camera/mic Meet acquires are the avatar canvas and mixer.
  const rig = await prepareAvatar(s, page);

  // Meet under automation doesn't always fire DOMContentLoaded for Playwright; commit is enough,
  // joinMeet waits for the elements it needs.
  await page.goto(s.meetUrl, { waitUntil: "commit", timeout: 30_000 }).catch((e) => note(s, `goto: ${(e as Error).message.split("\n")[0]} (continuing)`));
  note(s, `Opened Meet ${s.meetUrl}`);
  setStatus(s, "joining");

  const workNotes: string[] = [];
  workNotes.push = ((...items: string[]) => {
    for (const item of items) note(s, item);
    return Array.prototype.push.apply(workNotes, items as string[]);
  }) as typeof workNotes.push;
  const initialTask = s.workTask?.trim();

  // Pure fire-and-forget — nothing on the Meet/greet path ever awaits this.
  void (async () => {
    try {
      note(s, "Browserbase: starting in background…");
      const work = initialTask
        ? await startWorkBrowser(workNotes, initialTask)
        : await attachWorkBrowser(workNotes);
      if (s.status === "ended" || s.status === "error") return;
      s.workSessionId = work.sessionId;
      note(s, `Opening work tab → ${work.liveViewUrl}`);
      await workPage.goto(work.liveViewUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await stampWorkTitle(workPage);
      note(s, `Work tab ready ("${WORK_TAB_TITLE}"). Will Present only when asked to share.`);
    } catch (e) {
      note(s, `Work browser: ${(e as Error).message}`);
    }
  })();

  s.workLiveOff = onJevLiveView((url, sessionId) => {
    if (s.status === "ended" || s.status === "error") return;
    s.workSessionId = sessionId;
    note(s, `Work session moved → ${sessionId}; reloading live view`);
    void workPage
      .goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
      .then(() => stampWorkTitle(workPage))
      .catch((e) => note(s, `live-view reload: ${(e as Error).message}`));
  });
  const holdOff = onWorkHold(() => {
    if (s.status === "ended" || s.status === "error") return;
    void showWorkHold(workPage, (msg) => note(s, msg));
  });
  const prevClose = s.workLiveOff;
  s.workLiveOff = () => {
    prevClose?.();
    holdOff();
  };

  // Avatar + Realtime in parallel with join — do NOT await them before listening.
  const avatarUp = rig
    ? rig.start().then(() => note(s, "Avatar is live on the camera.")).catch((e) => note(s, `Avatar failed to start: ${(e as Error).message}`))
    : Promise.resolve();
  void avatarUp;

  s.talkBackend = talkBackendOf();
  if (s.talkBackend === "openai") {
    void connectOpenAIRealtime(s);
  }

  const joined = await joinMeet(page, s.notes, { muted: false, camera: rig ? "on" : "off", displayName: `${nameOf(s)} (plus1 AI)` });
  if (!joined) {
    setStatus(s, "error", s.notes[s.notes.length - 1] ?? "Could not join the meeting.");
    await closeContext(s);
    return;
  }
  note(s, "Joined the meeting.");
  page.on("load", () => void rig?.reattach());

  s.startedAt = Date.now();
  if (!rig) note(s, "No LIVEAVATAR_API_KEY — the plus1 can chat and use tools, but has no face or voice.");

  // Greet as soon as we're in — greetOpenAIAfterJoin waits on Realtime/avatar itself.
  if (s.talkBackend === "openai") {
    if (s.openai) void greetOpenAIAfterJoin(s);
    else openOpenAIRealtime(s);
  } else if (!s.live) {
    openLive(s);
  }
  await startAudioCapture(page, s);
  setStatus(s, "listening");
}

// ── OpenAI Realtime: speech-to-speech (TALK_BACKEND=openai) ────────────────

function openOpenAIRealtime(s: Session): void {
  void connectOpenAIRealtime(s).then(() => {
    if (s.openai && s.talkBackend === "openai") void greetOpenAIAfterJoin(s);
  });
}

/** Connect the Realtime WS (safe to call on the prejoin screen). No greeting yet. */
async function connectOpenAIRealtime(s: Session): Promise<void> {
  const key = envOptional("OPENAI_API_KEY");
  if (!key) {
    note(s, "TALK_BACKEND=openai but OPENAI_API_KEY is unset — using Gemini Live + ElevenLabs.");
    s.talkBackend = "legacy";
    openLive(s);
    return;
  }
  if (!s.rig) {
    note(s, "OpenAI Realtime needs LiveAvatar for voice output — using Gemini Live + ElevenLabs.");
    s.talkBackend = "legacy";
    openLive(s);
    return;
  }
  if (s.openai) return;

  const name = nameOf(s);
  emailPolicyFromConfig(s.config as Record<string, unknown>);
  const defaultEmailTo = defaultRecipient() ?? s.config?.email?.defaultTo;
  const access = toolAccessOf(s);

  const buildInstructions = (people: string[]) =>
    realtimeInstructions({
      name,
      purpose: s.purpose,
      memory: s.memory,
      muted: s.muted,
      access: toolAccessOf(s),
      participants: people,
      defaultEmailTo,
    });

  // Stash builder for post-join greet / name refreshes.
  s.openaiBuildInstructions = buildInstructions;

  const session = new OpenAIRealtimeSession({
    apiKey: key,
    model: envOptional("OPENAI_REALTIME_MODEL") ?? "gpt-realtime-2.1",
    voice: envOptional("OPENAI_REALTIME_VOICE") ?? "coral",
    name,
    instructions: buildInstructions([]),
    tools: realtimeToolsFor(access),
    greetOnReady: false,
    handlers: {
      onNote: (msg) => note(s, msg),
      onUserTranscript: (text, partial) => upsertUserTranscript(s, text, partial),
      onAgentTranscript: (text, partial) => upsertAgentTranscript(s, text, partial),
      onSpeakStart: (queue, label) => {
        if (!s.rig || s.muted) {
          queue.close();
          return { interrupt: () => undefined, done: Promise.resolve() };
        }
        const rig = s.rig;
        let current: { interrupt: () => void; done?: Promise<unknown> } | undefined;
        let cancelled = false;
        const done = (async () => {
          const ready = await rig.waitUntilReady(18_000);
          if (cancelled) {
            queue.close();
            return;
          }
          if (!ready) {
            queue.close();
            note(s, "OpenAI audio dropped — avatar never became ready");
            return;
          }
          try {
            const u = rig.speakPcm(queue, { label: label ?? "openai" });
            current = { interrupt: () => u.interrupt(), done: u.done };
            await u.done;
          } catch (e) {
            queue.close();
            note(s, `OpenAI audio dropped: ${(e as Error).message}`);
          }
        })();
        return {
          interrupt: () => {
            cancelled = true;
            current?.interrupt();
            queue.close();
          },
          done,
        };
      },
      onSpeakEnd: () => {
        s.lastSpeechEndedAt = Date.now();
      },
      onBargeIn: () => {
        s.rig?.interrupt();
        note(s, "Barge-in: human cut the plus1 off.");
      },
      onDecision: (d) => {
        const record: DecisionRecord = {
          act: true,
          action: d.action,
          confidence: 1,
          reason: d.reason,
          say: d.say,
          tool: d.tool,
          id: randomUUID(),
          t: s.startedAt ? Date.now() - s.startedAt : 0,
          at: new Date().toISOString(),
          outcome: d.outcome ?? "acting",
        };
        s.decisions.push(record);
        emit(s, "decision", record);
        persist(s);
      },
      onToolCall: (toolName, args) => runRealtimeTool(toolName, args, toolAccessOf(s), s.id),
      onShareUrl: async (url) => {
        if (!s.page) return;
        const ok = await postToMeetChat(s.page, url);
        note(s, ok ? "Posted share link to Meet chat." : "Meet chat post failed for share link.");
      },
    },
  });
  s.openai = session;
  session.connect();
  note(s, "Talk backend: OpenAI Realtime connecting (parallel with Meet join)…");
  // Do not await ready here — that was serializing join → ready → greet and
  // felt like "waiting for Browserbase". greetOpenAIAfterJoin waits itself.
  void session.waitUntilReady(15_000).then((ok) => {
    note(s, ok ? "OpenAI Realtime ready." : "OpenAI Realtime still connecting — will greet when ready.");
  });
}

/** After Meet join: scrape People DOM, then greet. */
async function greetOpenAIAfterJoin(s: Session): Promise<void> {
  const session = s.openai;
  if (!session || s.talkBackend !== "openai") return;
  const name = nameOf(s);
  const exclude = [name, "plus1"];
  const build =
    s.openaiBuildInstructions ??
    ((people: string[]) =>
      realtimeInstructions({
        name,
        purpose: s.purpose,
        memory: s.memory,
        muted: s.muted,
        access: toolAccessOf(s),
        participants: people,
        defaultEmailTo: defaultRecipient() ?? s.config?.email?.defaultTo,
      }));

  let people: string[] = [];
  if (s.page) {
    // One quick scrape — do not sit idle waiting for a People panel that we
    // refuse to open. Later refreshes still update instructions.
    people = await listMeetParticipantNames(s.page, { exclude });
  }

  const ok = await session.waitUntilReady(8_000);
  if (!ok || s.status === "ended" || s.status === "error") {
    note(s, "Skipped greeting — OpenAI Realtime not ready.");
    return;
  }
  if (s.rig) {
    const st = s.rig.sessionState;
    if (st !== "ready" && st !== "speaking") await s.rig.waitUntilReady(6_000);
  }
  if (!s.openai) return;
  if (s.status === "ended" || s.status === "error") return;

  s.openai.updateInstructions(build(people));
  if (people.length) note(s, `Participants: ${people.join(", ")}`);
  else note(s, "Participants: none in Meet DOM yet — greeting the room.");
  s.openai.requestGreeting({ participants: people });

  for (const delay of [2_000, 6_000, 12_000]) {
    setTimeout(() => {
      if (!s.page || s.status === "ended" || s.status === "error" || !s.openai) return;
      void listMeetParticipantNames(s.page, { exclude }).then((next) => {
        if (!s.openai || !next.length) return;
        s.openai.updateInstructions(build(next));
        note(s, `Participants: ${next.join(", ")}`);
      });
    }, delay);
  }
}

/** Room transcript from OpenAI input transcription. */
function upsertUserTranscript(s: Session, text: string, partial: boolean): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  // Realtime already barges via speech_started (with a cooldown). Don't also
  // cut from transcript fragments — that double-fired mid-sentence cutoffs.
  if (s.talkBackend !== "openai") {
    if (s.rig?.isSpeaking && Date.now() - s.lastSpeechEndedAt > BARGE_IN_GUARD_MS) {
      s.rig.interrupt();
    }
  }

  let line = s.currentLineId ? s.lines.find((l) => l.id === s.currentLineId) : undefined;
  if (!line || line.agent) {
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
  line.text = trimmed;
  line.partial = partial;
  emit(s, "line", line);
  if (!partial) {
    s.currentLineId = undefined;
    persist(s);
  }
}

/** Plus1 transcript from OpenAI output audio transcript. */
function upsertAgentTranscript(s: Session, text: string, partial: boolean): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  let line = s.openaiAgentLineId ? s.lines.find((l) => l.id === s.openaiAgentLineId) : undefined;
  if (!line) {
    line = {
      id: randomUUID(),
      t: s.startedAt ? Date.now() - s.startedAt : 0,
      at: new Date().toISOString(),
      text: trimmed,
      partial: true,
      agent: true,
      speaker: nameOf(s),
    };
    s.openaiAgentLineId = line.id;
    s.lines.push(line);
  } else {
    line.text = trimmed;
    line.partial = partial;
  }
  emit(s, "line", line);
  if (!partial) {
    s.openaiAgentLineId = undefined;
    persist(s);
  }
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

  // Barge-in: cut the plus1 off only when a human is *genuinely* talking over it — not for a
  // one-word blip or background noise. We wait until the current human utterance reaches a few
  // words, then interrupt immediately (mechanical, no decision).
  if (s.rig?.isSpeaking && Date.now() - s.lastSpeechEndedAt > BARGE_IN_GUARD_MS && frag.trim()) {
    const current = (s.currentLineId ? s.lines.find((l) => l.id === s.currentLineId)?.text : "") ?? "";
    const words = `${current} ${frag}`.trim().split(/\s+/).filter(Boolean).length;
    if (words >= BARGE_IN_MIN_WORDS) {
      s.rig.interrupt();
      s.openai?.bargeIn();
      note(s, `Barge-in: someone spoke over the plus1 ("${`${current} ${frag}`.trim().slice(0, 40)}").`);
    }
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
      // Whoever the Meet DOM last flagged as speaking gets this line.
      speaker: s.currentSpeaker,
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

function scheduleBrain(s: Session, delayMs = BRAIN_DEBOUNCE_MS): void {
  // OpenAI Realtime owns turn-taking + speech; do not run the Gemini HTTP brain.
  if (s.talkBackend === "openai") return;
  if (s.brainTimer) clearTimeout(s.brainTimer);
  s.brainTimer = setTimeout(() => void runBrain(s), delayMs);
}

// Cheap local gate so we only spend a Gemini call when a line plausibly needs
// the plus1 — a name mention, a question, or a request. Keeps us well within
// free-tier daily quotas and makes the brain react to real triggers.
const ADDRESSED_RE = /\bbob\b|\bplus1\b|\bplus[\s-]?(one|1)\b/i;
const REQUEST_RE =
  /\b(can|could|would|will|please|draft|write|send|email|schedule|book|check|look\s?up|find|search|summar|remind|add|create|what('?s| is| are)|who('?s| is)|when|where|how|why|should we|do we)\b/i;
// An open task floated to the room — cues the plus1 can volunteer for.
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

/** Addressed by the "plus1"/"plus one" aliases or the session's configured name. */
function isAddressed(s: Session, text: string): boolean {
  if (ADDRESSED_RE.test(text)) return true;
  const name = nameOf(s);
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(text);
}

function isOneOnOne(s: Session): boolean {
  // remoteStreams counts tapped remote audio streams ≈ other participants.
  // 1 other person → everything they say is directed at the plus1.
  return (s.remoteStreams ?? 0) <= 1;
}

function worthConsidering(s: Session): boolean {
  // In a 1:1, the other person is talking to the plus1 — consider every line.
  if (isOneOnOne(s)) return true;
  const recent = s.lines.filter((l) => !l.partial && !l.agent).slice(-2);
  const text = recent.map((l) => l.text).join(" ");
  if (!text.trim()) return false;
  // plus1's job is to catch mistakes and participate, so once it's balanced-or-higher,
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
  const me = nameOf(s).toLowerCase();
  return s.lines
    .filter((l) => !l.partial)
    .slice(-maxLines)
    .map((l) => `[${l.agent ? me : l.speaker || "speaker"}] ${l.text}`)
    .join("\n");
}

async function runBrain(s: Session): Promise<void> {
  if (s.status !== "listening") return;
  // OpenAI Realtime owns turn-taking + speech on that path.
  if (s.talkBackend === "openai") return;
  // Busy or mid-sentence: come back to it rather than dropping the turn. Barge-in
  // cuts the speech off if a human wants the floor, and then this fires.
  if (s.brainBusy || s.rig?.isSpeaking) {
    scheduleBrain(s, BRAIN_RETRY_MS);
    return;
  }

  // Spoken output-mode toggle: "mute / use the chat" ↔ "talk again". Persists.
  const latest = latestHumanText(s);
  const direct = isAddressed(s, latest) || isOneOnOne(s);

  // Cooldown keeps Bob from monologuing at a room — but when he's spoken to
  // directly (or it's a 1:1) it just made him unresponsive, which is fatal for
  // back-and-forth like "no, make it a 500 deductible". Direct speech gets a
  // much shorter floor.
  const cooldown = direct ? DIRECT_COOLDOWN_MS : ACTION_COOLDOWN_MS;
  if (s.lastActionAt && Date.now() - s.lastActionAt < cooldown) return;
  // Cap Gemini read frequency to stay within rate limits on busy meetings.
  const minInterval = direct ? DIRECT_BRAIN_MIN_INTERVAL_MS : BRAIN_MIN_INTERVAL_MS;
  if (s.lastBrainAt && Date.now() - s.lastBrainAt < minInterval) return;
  // Only consult the LLM when a line actually looks actionable.
  if (!worthConsidering(s)) return;

  if (direct) {
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
      persona: personaOf(s),
      guardrails: guardrailsOf(s),
      access: toolAccessOf(s),
      memory: s.memory,
      muted: s.muted,
      state: s.state,
    });
    rememberFrom(s, decision.remember);
    applyStateUpdate(s.state, decision.state);
    emit(s, "state", s.state);
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
      // Still surface the reasoning so the operator sees the plus1 thinking.
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
      console.log(`[plus1 ${s.id.slice(0, 8)}] brain busy, skipping: ${err.message}`);
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
    note(s, s.muted ? `Muted → chat: "${d.say}"` : `Speaking: "${d.say}"`);
    return (await sayInRoom(s, d.say)).outcome;
  }

  if (d.action === "tool" && d.tool?.name) {
    const t = d.tool;
    const access = toolAccessOf(s);
    const args = t.command ?? t.path ?? t.query ?? (t.details ? JSON.stringify(t.details) : "");

    // Never run a tool silently — say what's happening first (audio + transcript).
    const announced = d.say?.trim();
    if (announced) {
      note(s, `Announcing: "${announced}"`);
      try {
        await sayInRoom(s, announced);
      } catch (e) {
        // e.g. LiveAvatar socket dropped mid-utterance — carry on with the tool.
        note(s, `announce failed (${(e as Error).message}); running the tool anyway`);
      }
    }

    note(s, `Tool: ${t.name}(${args})`);
    // Graceful delay: a cached filler covers the dead air while the tool runs,
    // so the room never hears silence between the announcement and the answer.
    const filler = announced ? undefined : startFiller(s);

    // Run the chain: tool → narrate → maybe a follow-up tool (the narration asks for it)
    // → narrate again, capped. Every result and every query trace lands in the notes so
    // the operator can see WHY the goose looked where it looked.
    let lastResult = "";
    let shareUrl: string | undefined;
    const steps = await runToolChain(
      t,
      access,
      {
        transcript: () => transcriptWindow(s),
        name: nameOf(s),
        autonomy: autonomyOf(s),
        persona: personaOf(s),
        guardrails: guardrailsOf(s),
        channel: "meeting",
        memory: s.memory,
        muted: s.muted,
        state: s.state,
        meetingId: s.id,
      },
      {
        announce: async (say) => {
          note(s, `Follow-up: "${say}"`);
          try { await sayInRoom(s, say); } catch (e) { note(s, `announce failed (${(e as Error).message})`); }
        },
        onResult: (step) => {
          lastResult = step.result.text;
          if (step.result.shareUrl) shareUrl = step.result.shareUrl;
          note(s, `Tool result (${step.call.name}): ${step.result.text.slice(0, 400)}`);
          for (const line of step.result.trace ?? []) note(s, `  why: ${line}`);
          recordCompletedAction(s.state, `${step.call.name}(${step.args}) → ${step.result.text.slice(0, 160)}`);
          rememberFrom(s, step.reply.remember);
          applyStateUpdate(s.state, step.reply.state);
          emit(s, "state", s.state);
          if (step.reply.nextTool) note(s, `Deepening: ${step.reply.nextTool.name}(${step.reply.nextTool.query ?? ""})${step.reply.nextTool.reason ? ` — ${step.reply.nextTool.reason}` : ""}`);
        },
      },
      announced,
    );
    await filler;
    const last = steps[steps.length - 1];
    const reply = last?.reply.say.trim() || lastResult;
    const result = lastResult;

    const said = await sayInRoom(s, reply);

    // A share link is the deliverable, and nobody can act on a URL read aloud —
    // so it goes into the meeting chat verbatim, where everyone can click it.
    // This is the whole point of the public document server.
    if (shareUrl && page) {
      // The URL itself is the artifact — dump the whole tool result and
      // people have to hunt for a clickable link.
      await postToMeetChat(page, shareUrl);
    } else {
      // A spoken summary can't carry a breakdown (a quote's coverage lines, a file
      // listing). Drop the detail in the chat too, so nobody has to ask for it —
      // but only when it's genuinely more than what was just said out loud.
      const detailed = result.includes("\n") || result.length > 220;
      if (detailed && page && result.trim() !== reply.trim()) {
        await postToMeetChat(page, `${nameOf(s)} — ${result}`);
      }
    }

    persist(s);
    return said.delivered ? `tool: ${result}` : `tool ran but delivery failed: ${result}`;
  }

  return "nothing to do";
}

interface SaidResult {
  /** The room got it (out loud or in the chat). */
  delivered: boolean;
  /** Human-readable outcome for the decision record. */
  outcome: string;
}

/**
 * Say one line in the room: voice via the avatar rig, or the Meet text chat when
 * muted or when there's no avatar. Either way the line is recorded in s.lines so
 * it becomes part of the next brain turn's context.
 */
async function sayInRoom(s: Session, text: string): Promise<SaidResult> {
  const line = text.trim();
  if (!line) return { delivered: false, outcome: "nothing to say" };
  const page = s.page;

  // Realtime owns PCM + coral voice. Never call ElevenLabs `rig.say` here or the
  // avatar switches voices mid-meeting (screenWatch glances used to do this).
  if (s.talkBackend === "openai") {
    return { delivered: false, outcome: "openai owns voice; skipped elevenlabs" };
  }

  if (s.rig && !s.muted) {
    try {
      // say() rides out a session dying mid-sentence: it waits for the fresh
      // session and re-sends the line. A human interrupting still ends it for
      // good — being cut off is a decision, not a failure.
      const u = s.rig.say(line);
      plus1Line(s, line, u.done);
      const r = await u.done;
      if (r.outcome === "interrupted") return { delivered: true, outcome: "interrupted by a human" };
      if (r.outcome !== "dropped") {
        const retried = r.attempts > 1 ? ` (took ${r.attempts} tries)` : "";
        return { delivered: true, outcome: `spoke in the meeting${retried}` };
      }
      note(s, `avatar could not deliver it (${r.error?.message ?? "unknown"}); falling back to chat`);
    } catch (e) {
      note(s, `speak failed (${(e as Error).message}); falling back to chat`);
    }
  }

  if (!page) return { delivered: false, outcome: "no page" };
  const ok = await postToMeetChat(page, `${nameOf(s)}: ${line}`);
  if (ok) {
    // Chat still counts as having said it — keep it in the transcript.
    plus1Line(s, line, Promise.resolve({ outcome: "completed" }));
    return { delivered: true, outcome: s.muted ? "muted; posted to chat" : "posted to chat instead" };
  }
  note(s, `could not deliver to the room: "${line}"`);
  return { delivered: false, outcome: "delivery failed" };
}

/** Play a cached filler so a slow tool doesn't leave dead air. Never throws. */
function startFiller(s: Session): Promise<void> | undefined {
  if (s.talkBackend === "openai") return undefined;
  if (!s.rig || s.muted || !s.fillers) return undefined;
  return playFiller(s, "checking");
}

async function playFiller(s: Session, kind: FillerKind): Promise<void> {
  if (s.talkBackend === "openai") return;
  if (!s.rig || s.muted) return;
  const f = s.fillers?.pick(kind) ?? s.fillers?.pick("thinking") ?? s.fillers?.pick("ack");
  if (!f) return;
  try {
    const u = s.rig.speakPcm(f.pcm, { label: f.phrase });
    plus1Line(s, f.phrase, u.done);
    await u.done.catch(() => undefined);
  } catch {
    /* ignore */
  }
}

// ── The plus1 on camera (LiveAvatar + ElevenLabs) ─────────────────────────

function emitAvatar(s: Session): void {
  emit(s, "avatar", s.avatar);
}

/** Build the rig if LIVEAVATAR_API_KEY is set; otherwise the session is transcription + chat only. */
async function prepareAvatar(s: Session, page: Page): Promise<AvatarRig | undefined> {
  const apiKey = envOptional("LIVEAVATAR_API_KEY");
  const avatarId = envOptional("LIVEAVATAR_AVATAR_ID") ?? plus1Config.liveavatarAvatarId;
  if (!apiKey || !avatarId) return undefined;
  let tts: ElevenLabsTts | undefined;
  try {
    tts = voiceFromEnv();
    s.tts = tts;
    if (talkBackendOf() !== "openai") {
      s.fillers = new FillerCache({ tts, voiceKey: `${tts.voiceId}:${tts.model}` });
      const warmed = await s.fillers.warm();
      note(s, `Voice ready (${warmed.loaded} fillers cached, ${warmed.synthesized} synthesized).`);
    } else {
      note(s, "Voice ready (OpenAI Realtime PCM → LiveAvatar).");
    }
  } catch (e) {
    note(s, `ElevenLabs not configured (${(e as Error).message}); the plus1 has a face but no voice.`);
  }
  const rig = new AvatarRig({
    client: new LiveAvatarClient({ apiKey }),
    avatarId,
    sandbox: envOptional("LIVEAVATAR_SANDBOX") !== "0",
    tts,
    page: { label: nameOf(s) },
  });
  rig.on("sessionState", (st) => {
    s.avatar.session = st;
    emitAvatar(s);
    // Sessions have a hard max duration, so they expire and get replaced as a
    // matter of course. Surface it, since it briefly gates speech.
    if (st === "stopped") note(s, "Avatar session ended — bringing a fresh one up.");
  });
  rig.on("mediaState", (st) => { s.avatar.media = st; emitAvatar(s); });
  rig.on("speaking", (e) => {
    if (e.phase === "started") { s.avatar.speaking = true; emitAvatar(s); }
    if (e.phase === "ended") { s.avatar.speaking = false; s.lastSpeechEndedAt = Date.now(); emitAvatar(s); }
  });
  rig.on("warning", (w) => console.log(`[plus1 ${s.id.slice(0, 8)}] avatar warning: ${w}`));
  rig.on("error", (e) => console.log(`[plus1 ${s.id.slice(0, 8)}] avatar error: ${e.message}`));
  rig.on("ready", () => {
    if (s.startedAt) note(s, "Avatar session ready.");
  });
  rig.on("dead", (e) =>
    note(s, `Avatar gave up restarting: ${e.message}. Still listening; falling back to the chat.`),
  );
  s.rig = rig;
  await rig.prepare(page);
  return rig;
}

/** A transcript line for something the plus1 said, updated as it plays. */
function plus1Line(s: Session, text: string, done: Promise<{ outcome: string }>): void {
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
  plus1Line(s, text, u.done);
  return { id: u.id };
}

/** Instant cached filler while the planner (or the operator) thinks. */
export function fillerInSession(id: string, kind: FillerKind = "ack"): { id: string; phrase: string } | null {
  const { s, rig } = requireRig(id);
  if (s.talkBackend === "openai") return null;
  const f = s.fillers?.pick(kind);
  if (!f) return null;
  const u = rig.speakPcm(f.pcm, { label: f.phrase });
  plus1Line(s, f.phrase, u.done);
  return { id: u.id, phrase: f.phrase };
}

export function interruptSession(id: string): void {
  const { s, rig } = requireRig(id);
  rig.interrupt();
  s.openai?.bargeIn();
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

  await page.exposeFunction("__plus1Audio", (b64: string, taps: number, speaker?: string) => {
    if (taps !== lastTap) {
      lastTap = taps;
      s.remoteStreams = taps;
      note(
        s,
        `Tapped ${taps} audio stream${taps === 1 ? "" : "s"} in the room${taps <= 1 ? " — treating as a 1:1, will respond directly." : "."}`,
      );
    }
    if (s.talkBackend === "openai" && s.openai) {
      s.openai.appendMeetPcm16kBase64(b64);
      return;
    }
    // Who the Meet DOM says is speaking right now. Kept as the "current speaker"
    // so the next transcript line the stream produces can be attributed to them.
    const who = speaker?.trim();
    if (who) s.currentSpeaker = who;
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
        __plus1Audio: (b: string, taps: number, speaker?: string) => void;
        __plus1Diag: (m: string) => void;
      };
      if (w.__plus1Cap) return;
      w.__plus1Cap = true;

      // Best-effort active speaker, read from the Google Meet DOM. All remote
      // audio is mixed into one stream, so the name can't come from the audio —
      // it comes from Meet's own participant tiles. Reliable in a 1:1 (one other
      // person → that's the speaker); a good guess in a group (the tile Meet
      // flags as speaking); empty when unsure, so a line is never mislabelled.
      const isName = (t: string) => {
        const s = t.trim();
        if (!s || s.length > 40) return false;
        return !/^(you|presenting|is presenting|pinned|more options|muted|unmute|mute)$/i.test(s);
      };
      const nameOfTile = (tile: Element): string => {
        const nn = tile.querySelector("span.notranslate") as HTMLElement | null;
        if (nn && isName(nn.textContent || "")) return nn.textContent!.trim();
        const self = tile.querySelector("[data-self-name]") as HTMLElement | null;
        if (self) {
          const v = self.getAttribute("data-self-name") || self.textContent || "";
          if (isName(v)) return v.trim();
        }
        const aria = tile.getAttribute("aria-label") || "";
        if (isName(aria)) return aria.trim();
        return "";
      };
      const readSpeaker = (): string => {
        try {
          const tiles = Array.from(document.querySelectorAll("[data-participant-id]"));
          const byId = new Map<string, Element>();
          for (const t of tiles) {
            const id = t.getAttribute("data-participant-id");
            if (id && !byId.has(id)) byId.set(id, t);
          }
          const parts: { name: string; speaking: boolean; self: boolean }[] = [];
          for (const tile of byId.values()) {
            const self = !!tile.querySelector("[data-self-name]");
            const name = nameOfTile(tile);
            if (!name) continue;
            // Meet toggles a speaking ring / animated bars; class names are
            // obfuscated, so match loosely and fall back to aria.
            const speaking =
              !!tile.querySelector('[class*="peaking" i],[aria-label*="speaking" i]') ||
              tile.getAttribute("data-is-speaking") === "true";
            parts.push({ name, speaking, self });
          }
          const others = parts.filter((p) => !p.self);
          if (others.length === 0) return "";
          if (others.length === 1) return others[0].name; // 1:1 — unambiguous
          const sp = others.find((p) => p.speaking);
          return sp ? sp.name : "";
        } catch {
          return "";
        }
      };

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
            if (this.dataset && this.dataset.plus1Avatar) return; // the plus1's own voice/video, not the room
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
        w.__plus1Audio(btoa(bin), taps, readSpeaker());
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
