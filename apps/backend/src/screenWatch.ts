/**
 * Shannon looking at the screenshare.
 *
 * Gemini Live can take JPEG frames at ~1 FPS, but Shannon's voice is ElevenLabs
 * through LiveAvatar, and Meet already has a transcribe Live socket — a second
 * native-audio Live session would be a different voice. So we do the production
 * pattern used by LiveKit vision agents and Agora/Inworld fillers:
 *
 *   1. Screenshot the work tab on a slow tick (not 1 FPS).
 *   2. Skip Gemini if the frame barely changed (hash / byte-diff).
 *   3. Otherwise glance: one short spoken line, or silence.
 *   4. If the picture is stuck (spinner / blank), play a cached "um" / "still
 *      loading" filler after a delay, rotating, never stacked.
 *
 * Silence is safe. Over-narrating every click is the failure mode.
 */
import type { Page } from "playwright-core";
import type { FillerKind } from "@plus1/voice";
import { generateJson } from "./gemini.js";
import { screenshotWorkBrowser } from "./jevAgent.js";

export type ShareWatcher = {
  workPage?: Page;
  note: (msg: string) => void;
  speak: (text: string) => Promise<void>;
  filler: (kind: FillerKind) => Promise<void>;
  busy: () => boolean;
};

const TICK_MS = 2_800;
const GLANCE_GAP_MS = 4_500;
const FILLER_FIRST_MS = 4_000;
const FILLER_EVERY_MS = 9_000;
const MAX_FILLERS = 5;
const MAX_GLANCES = 18;

const GLANCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    speak: { type: "boolean" },
    say: { type: "string" },
    state: { type: "string", enum: ["loading", "working", "result", "same"] },
  },
  required: ["speak", "state"],
};

const GLANCE_PROMPT = `You are Shannon, on a live call, looking at a screen YOU are sharing. The image is the work browser right now.

Rules (this is how it feels human, not like a sports commentator):
- Silence is safe, not awkward. Prefer speak=false unless something NEW and concrete is on screen.
- One short spoken line, lowercase, contractions. Max ~14 words.
- Light human texture is good: "um...", "uh...", "hmm...", an ellipsis while thinking, "just waiting for this to load" when it's a spinner/blank/white page. Never stack fillers. Never say "tttttt".
- Name what you actually see (a map, a search result, a form, an error). Don't invent. Don't read URLs or IDs.
- state="loading" if spinner/blank/skeleton. state="result" if the task looks done on screen. state="working" if it's mid-task. state="same" if nothing worth mentioning changed.
- Never say you are looking at a screenshot or that you are an AI.`;

function frameChanged(prev: Buffer | undefined, next: Buffer): boolean {
  if (!prev) return true;
  if (Math.abs(prev.length - next.length) > Math.max(800, prev.length * 0.06)) return true;
  const n = Math.min(prev.length, next.length);
  const step = 24;
  let diff = 0;
  let samples = 0;
  for (let i = 64; i < n - 64; i += step) {
    samples++;
    if (prev[i] !== next[i]) diff++;
  }
  return samples > 0 && diff / samples > 0.1;
}

async function grabFrame(workPage?: Page): Promise<Buffer | undefined> {
  const cloud = await screenshotWorkBrowser();
  if (cloud && cloud.length > 800) return cloud;
  if (!workPage || workPage.isClosed()) return undefined;
  try {
    return await workPage.screenshot({ type: "jpeg", quality: 40, fullPage: false, timeout: 4_000 });
  } catch {
    return undefined;
  }
}

async function glance(task: string, jpeg: Buffer): Promise<{ speak: boolean; say: string; state: string }> {
  const model = process.env.GEMINI_VISION_MODEL || "gemini-flash-latest";
  const parsed = (await generateJson(
    GLANCE_PROMPT,
    `Task you are doing on this screen: ${task}\nWhat, if anything, do you say out loud right now?`,
    GLANCE_SCHEMA,
    0.4,
    model,
    [{ mimeType: "image/jpeg", data: jpeg.toString("base64") }],
  )) as { speak?: boolean; say?: string; state?: string };
  const say = (parsed.say ?? "").replace(/\s+/g, " ").trim();
  return {
    speak: parsed.speak === true && say.length > 0,
    say,
    state: parsed.state ?? "same",
  };
}

function delay(ms: number, until?: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    until?.finally(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** Cached um / still-loading while we don't have a picture yet (jev session spinning up). */
export async function humWhile(
  w: Pick<ShareWatcher, "filler" | "busy" | "note">,
  until: Promise<unknown>,
): Promise<void> {
  let stop = false;
  void until.finally(() => {
    stop = true;
  });
  let n = 0;
  while (!stop && n < MAX_FILLERS) {
    await delay(n === 0 ? FILLER_FIRST_MS : FILLER_EVERY_MS, until);
    if (stop || w.busy()) continue;
    const kind: FillerKind = n % 2 === 0 ? "thinking" : "loading";
    n++;
    try {
      w.note(`filler ${kind}`);
      await w.filler(kind);
    } catch {
      /* ignore */
    }
  }
}

/** Glance at the Present tab and talk when the picture actually changes. */
export async function watchShare(
  w: ShareWatcher,
  task: string,
  until: Promise<unknown>,
): Promise<string[]> {
  const heard: string[] = [];
  let stop = false;
  void until.finally(() => {
    stop = true;
  });

  let prev: Buffer | undefined;
  let lastVoiceAt = Date.now(); // announce just happened
  let lastGlanceAt = 0;
  let fillers = 0;
  let glances = 0;
  let lastState = "working";

  while (!stop) {
    await Promise.race([until, new Promise((r) => setTimeout(r, TICK_MS))]);
    if (stop) break;
    if (w.busy()) continue;

    let frame: Buffer | undefined;
    try {
      frame = await grabFrame(w.workPage);
    } catch (e) {
      w.note(`screen watch: ${(e as Error).message}`);
      continue;
    }
    if (!frame) continue;

    const changed = frameChanged(prev, frame);
    const quietFor = Date.now() - lastVoiceAt;
    prev = frame;

    if (changed && glances < MAX_GLANCES && Date.now() - lastGlanceAt >= GLANCE_GAP_MS) {
      lastGlanceAt = Date.now();
      glances++;
      try {
        const g = await glance(task, frame);
        lastState = g.state;
        if (stop || w.busy()) continue;
        if (g.speak && g.say) {
          w.note(`watching: "${g.say}" (${g.state})`);
          heard.push(g.say);
          await w.speak(g.say);
          lastVoiceAt = Date.now();
          continue;
        }
      } catch (e) {
        w.note(`glance: ${(e as Error).message}`);
      }
    }

    if (stop || w.busy()) continue;
    const wantFiller =
      fillers < MAX_FILLERS &&
      quietFor >= (fillers === 0 ? FILLER_FIRST_MS : FILLER_EVERY_MS) &&
      (lastState === "loading" || !changed);
    if (!wantFiller) continue;

    const kind: FillerKind = lastState === "loading" || fillers % 2 === 1 ? "loading" : "thinking";
    fillers++;
    try {
      w.note(`filler ${kind}`);
      await w.filler(kind);
      lastVoiceAt = Date.now();
    } catch {
      /* never strand the watch loop on TTS */
    }
  }

  return heard;
}
