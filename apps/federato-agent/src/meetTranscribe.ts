/**
 * Send a goose: join a Google Meet in a local Playwright Chrome, tap every
 * remote audio stream via Web Audio, and transcribe ~5s chunks with Gemini.
 * Lines stream to the dashboard over SSE (see server.ts).
 *
 * The runner makes no decisions — this only joins, captures, transcribes.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import type { BrowserContext, Page } from "playwright-core";
import { env } from "./env.js";
import { joinMeet, launchMeetChrome } from "./meetPresent.js";

const TARGET_RATE = 16000; // Gemini wants 16kHz mono PCM
const CHUNK_MS = 5000;
const SILENCE_RMS = 0.006; // below this, skip the Gemini call
const GEMINI_MODEL = "gemini-2.0-flash";

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
  queue: Promise<void>;
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
    bus: new EventEmitter(),
    queue: Promise.resolve(),
  };
  session.bus.setMaxListeners(50);
  sessions.set(id, session);

  void runSession(session).catch((e) => {
    session.notes.push((e as Error).message);
    setStatus(session, "error", (e as Error).message);
  });

  return { sessionId: id };
}

export async function stopSession(id: string): Promise<boolean> {
  const s = sessions.get(id);
  if (!s) return false;
  setStatus(s, "ended");
  try {
    await s.context?.close();
  } catch {
    /* already gone */
  }
  return true;
}

async function runSession(s: Session): Promise<void> {
  const context = await launchMeetChrome();
  s.context = context;

  await context.grantPermissions(["microphone", "camera", "notifications"], {
    origin: "https://meet.google.com",
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(s.meetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  s.notes.push(`Opened Meet ${s.meetUrl}`);
  setStatus(s, "joining");

  const joined = await joinMeet(page, s.notes);
  if (!joined) {
    setStatus(s, "error", s.notes[s.notes.length - 1] ?? "Could not join the meeting.");
    return;
  }
  s.notes.push("Joined the meeting.");

  await startAudioCapture(page, s);
  s.startedAt = Date.now();
  setStatus(s, "listening");
}

async function startAudioCapture(page: Page, s: Session): Promise<void> {
  await page.exposeFunction("__plus1Audio", (b64: string, rms: number) => {
    // Serialize chunks so transcript lines stay in order even when a Gemini
    // call runs longer than the 5s chunk cadence.
    s.queue = s.queue.then(() => handleChunk(s, b64, rms)).catch((e) => {
      s.notes.push(`transcribe error: ${(e as Error).message}`);
    });
  });

  await page.evaluate(
    ({ targetRate, chunkMs }) => {
      const w = window as unknown as { __plus1Cap?: boolean; __plus1Audio: (b: string, r: number) => void };
      if (w.__plus1Cap) return;
      w.__plus1Cap = true;

      const ctx = new AudioContext();
      const bus = ctx.createGain();
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      let acc: Float32Array[] = [];
      const seen = new WeakSet<MediaStream>();

      const tap = (stream: MediaStream | null) => {
        try {
          if (!stream || seen.has(stream)) return;
          if (!stream.getAudioTracks || stream.getAudioTracks().length === 0) return;
          seen.add(stream);
          ctx.createMediaStreamSource(stream).connect(bus);
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
      new MutationObserver(scan).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

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
        let sum = 0;
        for (let i = 0; i < outLen; i++) {
          const sample = flat[Math.floor(i * ratio)] || 0;
          const v = Math.max(-1, Math.min(1, sample));
          out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / (outLen || 1));

        const bytes = new Uint8Array(out.buffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        w.__plus1Audio(btoa(bin), rms);
      }, chunkMs);
    },
    { targetRate: TARGET_RATE, chunkMs: CHUNK_MS },
  );

  s.notes.push("Listening to the room.");
}

async function handleChunk(s: Session, b64: string, rms: number): Promise<void> {
  if (s.status === "ended" || s.status === "error") return;
  if (rms < SILENCE_RMS) return; // silence — don't spend a Gemini call

  const pcm = Buffer.from(b64, "base64");
  const wav = pcmToWav(pcm, TARGET_RATE);
  const text = await transcribeWithGemini(wav);
  if (!text) return;

  const line: TranscriptLine = {
    id: randomUUID(),
    t: s.startedAt ? Date.now() - s.startedAt : 0,
    at: new Date().toISOString(),
    text,
  };
  s.lines.push(line);
  emit(s, "line", line);
}

async function transcribeWithGemini(wav: Buffer): Promise<string> {
  const key = env("GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Transcribe the meeting audio below verbatim into plain text. " +
              "Output only the spoken words, no timestamps or commentary. " +
              "If there is no intelligible speech, output exactly: [no speech]",
          },
          { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
        ],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 512 },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  if (!text || /^\[no speech\]$/i.test(text)) return "";
  return text;
}

/** Wrap raw 16-bit mono PCM in a minimal WAV container. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (mono, 16-bit)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}
