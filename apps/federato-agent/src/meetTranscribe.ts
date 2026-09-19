/**
 * Send a goose: join a Google Meet in a local Playwright Chrome, tap every
 * remote audio stream via Web Audio, and stream the PCM to Gemini's Live API
 * (a persistent WebSocket) for real-time transcription. Lines stream to the
 * dashboard over SSE (see server.ts), updating live as each person speaks.
 *
 * The runner makes no decisions — this only joins, captures, transcribes.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import type { BrowserContext, Page } from "playwright-core";
import { env } from "./env.js";
import { joinMeet, launchMeetChrome } from "./meetPresent.js";
import {
  decideAction,
  elevenLabsConfigured,
  postToMeetChat,
  runTool,
  speakIntoMeet,
  type Decision,
} from "./agentBrain.js";

// Auto-act tuning.
const CONFIDENCE_THRESHOLD = Number(process.env.BRAIN_CONFIDENCE ?? 0.7);
const ACTION_COOLDOWN_MS = 9000; // min gap between the goose acting
const BRAIN_DEBOUNCE_MS = 700; // wait for the line to settle before deciding
const BRAIN_MIN_INTERVAL_MS = 4000; // cap how often we call Gemini to read the room
const SPEAK_TAIL_MS = 1500; // ignore transcript for a bit after we speak

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
  agent?: boolean; // the goose's own voice, heard back through the mic loop
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
  speakingUntil?: number; // ignore transcript + brain while we're talking
}

const sessions = new Map<string, Session>();

function emit(s: Session, event: string, data: unknown): void {
  s.bus.emit("event", { event, data });
}

function setStatus(s: Session, status: SessionStatus, error?: string): void {
  s.status = status;
  if (error) s.error = error;
  emit(s, "status", { status, error, notes: s.notes });
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
}

export function listSessions() {
  return [...sessions.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((s) => ({
      id: s.id,
      meetUrl: s.meetUrl,
      status: s.status,
      createdAt: s.createdAt,
      error: s.error,
      lineCount: s.lines.length,
    }));
}

export function getSession(id: string) {
  const s = sessions.get(id);
  if (!s) return undefined;
  return {
    id: s.id,
    meetUrl: s.meetUrl,
    status: s.status,
    createdAt: s.createdAt,
    error: s.error,
    notes: s.notes,
    lines: s.lines,
    decisions: s.decisions,
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
export function startMeetTranscription(meetUrl: string): { sessionId: string } {
  const id = randomUUID();
  const session: Session = {
    id,
    meetUrl,
    status: "joining",
    createdAt: new Date().toISOString(),
    notes: [],
    lines: [],
    decisions: [],
    bus: new EventEmitter(),
  };
  session.bus.setMaxListeners(50);
  sessions.set(id, session);

  void runSession(session).catch(async (e) => {
    note(session, `crashed: ${(e as Error).message}`);
    setStatus(session, "error", (e as Error).message);
    await closeContext(session); // quit the Chrome window on crash
  });

  return { sessionId: id };
}

export async function stopSession(id: string): Promise<boolean> {
  const s = sessions.get(id);
  if (!s) return false;
  setStatus(s, "ended");
  await closeContext(s);
  return true;
}

async function runSession(s: Session): Promise<void> {
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
  await page.goto(s.meetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  note(s, `Opened Meet ${s.meetUrl}`);
  setStatus(s, "joining");

  const joined = await joinMeet(page, s.notes, { muted: false });
  if (!joined) {
    setStatus(s, "error", s.notes[s.notes.length - 1] ?? "Could not join the meeting.");
    await closeContext(s); // quit the Chrome window if we couldn't get in
    return;
  }
  note(s, "Joined the meeting.");

  s.startedAt = Date.now();
  if (!elevenLabsConfigured()) {
    note(s, "No ELEVENLABS_API_KEY set — the goose can chat and use tools, but can't speak aloud yet.");
  }
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
  // Words captured while (or just after) the goose spoke are its own voice
  // looping back through the mic — mark them and don't let the brain react.
  const speaking = s.speakingUntil ? Date.now() < s.speakingUntil + SPEAK_TAIL_MS : false;
  if (speaking) line.agent = true;
  emit(s, "line", line);

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
const NAME_RE = /\bplus[\s-]?(one|1)\b/i;
const REQUEST_RE =
  /\b(can|could|would|will|please|draft|write|send|email|schedule|book|check|look\s?up|find|search|summar|remind|add|create|what('?s| is| are)|who('?s| is)|when|where|how|why|should we|do we)\b/i;

function worthConsidering(s: Session): boolean {
  const recent = s.lines.filter((l) => !l.partial && !l.agent).slice(-2);
  const text = recent.map((l) => l.text).join(" ");
  if (!text.trim()) return false;
  return NAME_RE.test(text) || text.includes("?") || REQUEST_RE.test(text);
}

function transcriptWindow(s: Session, maxLines = 14): string {
  return s.lines
    .filter((l) => !l.partial)
    .slice(-maxLines)
    .map((l) => `[${l.agent ? "plus one" : "speaker"}] ${l.text}`)
    .join("\n");
}

async function runBrain(s: Session): Promise<void> {
  if (s.status !== "listening" || s.brainBusy) return;
  if (s.speakingUntil && Date.now() < s.speakingUntil) return;
  if (s.lastActionAt && Date.now() - s.lastActionAt < ACTION_COOLDOWN_MS) return;
  // Cap Gemini read frequency to stay within rate limits on busy meetings.
  if (s.lastBrainAt && Date.now() - s.lastBrainAt < BRAIN_MIN_INTERVAL_MS) return;
  // Only consult the LLM when a line actually looks actionable.
  if (!worthConsidering(s)) return;

  s.brainBusy = true;
  s.lastBrainAt = Date.now();
  try {
    const decision = await decideAction(transcriptWindow(s));
    const record: DecisionRecord = {
      ...decision,
      id: randomUUID(),
      t: s.startedAt ? Date.now() - s.startedAt : 0,
      at: new Date().toISOString(),
    };

    const willAct =
      decision.act &&
      decision.action !== "none" &&
      decision.confidence >= CONFIDENCE_THRESHOLD;

    if (willAct) {
      record.outcome = "acting";
      s.decisions.push(record);
      emit(s, "decision", record);
      s.lastActionAt = Date.now();
      record.outcome = await executeDecision(s, decision);
      emit(s, "decision", record); // update with the real outcome
    } else {
      // Still surface the reasoning so the operator sees the goose thinking.
      record.outcome = decision.action === "none" ? "held" : "below threshold";
      s.decisions.push(record);
      emit(s, "decision", record);
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
    note(s, `Speaking: "${d.say}"`);
    // Reserve a speaking window so we ignore our own voice in the transcript.
    s.speakingUntil = Date.now() + estimateSpeechMs(d.say);
    const res = await speakIntoMeet(page, d.say);
    s.speakingUntil = Date.now() + 800; // small tail after playback finishes
    note(s, res.note);
    return res.ok ? (res.routedIntoMeet ? "spoke into meeting" : "spoke locally") : `speak failed: ${res.note}`;
  }

  if (d.action === "tool" && d.tool?.name) {
    note(s, `Calling tool: ${d.tool.name}(${d.tool.query ?? ""})`);
    const result = await runTool(d.tool.name, d.tool.query);
    note(s, `Tool result: ${result}`);
    // Share the tool's answer with the room via chat.
    await postToMeetChat(page, `plus one — ${result}`);
    return `tool: ${result}`;
  }

  return "nothing to do";
}

function estimateSpeechMs(text: string): number {
  // ~15 characters per second of speech, min 2s.
  return Math.max(2000, Math.ceil(text.length / 15) * 1000);
}

async function startAudioCapture(page: Page, s: Session): Promise<void> {
  let lastTap = -1;
  let warnedSilent = false;

  await page.exposeFunction("__plus1Audio", (b64: string, taps: number) => {
    if (taps !== lastTap) {
      lastTap = taps;
      note(s, `Tapped ${taps} audio stream${taps === 1 ? "" : "s"} in the room.`);
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
            tap(v);
          },
        });
      }
      const scan = () =>
        document.querySelectorAll("audio,video").forEach((el) => {
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
