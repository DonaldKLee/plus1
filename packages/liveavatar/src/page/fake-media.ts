/**
 * The getUserMedia override from HLD §5.2. The canvas *is* the camera; the
 * MediaStreamDestination *is* the mic. Must be installed before Meet's JS
 * runs (Playwright addInitScript does that).
 */
import type { PageMediaConfig } from "../page-protocol.js";
import { report } from "./events.js";

declare global {
  interface Window {
    __gooseCanvas?: HTMLCanvasElement;
    __audioCtx?: AudioContext;
    __audioDest?: MediaStreamAudioDestinationNode;
    __plus1AvatarConfig?: Partial<PageMediaConfig>;
    /** Set by the early bundle so the late bundle knows the override is already in place. */
    __plus1FakeMediaInstalled?: boolean;
  }
}

export interface MediaBus {
  canvas: HTMLCanvasElement;
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
  fps: number;
}

let bus: MediaBus | null = null;
let installed = false;
let gumCalls = 0;

export function getBus(config: PageMediaConfig): MediaBus {
  if (bus) return bus;
  // Adopt a bus the early bundle already created (its tracks are what Meet is holding).
  if (window.__gooseCanvas && window.__audioCtx && window.__audioDest) {
    bus = { canvas: window.__gooseCanvas, ctx: window.__audioCtx, dest: window.__audioDest, fps: config.fps };
    keepContextRunning(bus.ctx);
    return bus;
  }
  const canvas = document.createElement("canvas");
  canvas.width = config.width;
  canvas.height = config.height;
  const ctx = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
  const dest = ctx.createMediaStreamDestination();
  window.__gooseCanvas = canvas;
  window.__audioCtx = ctx;
  window.__audioDest = dest;
  bus = { canvas, ctx, dest, fps: config.fps };
  keepContextRunning(ctx);
  return bus;
}

export function fakeMediaInstalled(): boolean { return installed || window.__plus1FakeMediaInstalled === true; }
export function fakeMediaCalls(): number { return gumCalls; }

/** Install the override. Idempotent. Returns why it couldn't if it couldn't. */
export function installFakeMedia(config: PageMediaConfig): { installed: boolean; reason?: string } {
  if (installed || window.__plus1FakeMediaInstalled) { installed = true; getBus(config); return { installed: true }; }
  if (!navigator.mediaDevices) return { installed: false, reason: "navigator.mediaDevices missing (insecure context?)" };
  const b = getBus(config);
  const md = navigator.mediaDevices;

  const fakeStream = (constraints?: MediaStreamConstraints): MediaStream => {
    gumCalls++;
    const tracks: MediaStreamTrack[] = [];
    if (constraints?.video) {
      const t = b.canvas.captureStream(b.fps).getVideoTracks()[0];
      if (t) tracks.push(t);
    }
    if (constraints?.audio) {
      const t = b.dest.stream.getAudioTracks()[0];
      if (t) tracks.push(t.clone());
    }
    return new MediaStream(tracks);
  };

  const originalGum = md.getUserMedia.bind(md);
  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (!constraints?.video && !constraints?.audio) return originalGum(constraints);
    return fakeStream(constraints);
  };
  // Meet enumerates devices to build its pickers; give it exactly one camera and one mic.
  md.enumerateDevices = async () => {
    const mk = (kind: MediaDeviceKind, deviceId: string, label: string) =>
      ({ kind, deviceId, groupId: "plus1", label, toJSON() { return { kind, deviceId, groupId: "plus1", label }; } }) as MediaDeviceInfo;
    return [mk("videoinput", "plus1-camera", "plus1 avatar camera"), mk("audioinput", "plus1-mic", "plus1 avatar mic"), mk("audiooutput", "default", "Default")];
  };
  installed = true;
  window.__plus1FakeMediaInstalled = true;
  return { installed: true };
}

/** AudioContexts can start suspended under autoplay policy. Nudge them and shout if it sticks. */
function keepContextRunning(ctx: AudioContext): void {
  let warned = false;
  const tryResume = () => { if (ctx.state === "suspended") void ctx.resume().catch(() => {}); };
  for (const ev of ["click", "keydown", "pointerdown", "touchstart"]) document.addEventListener(ev, tryResume, { capture: true, passive: true });
  const timer = setInterval(() => {
    tryResume();
    if (ctx.state === "suspended" && !warned && performance.now() > 5_000) {
      warned = true;
      report({ kind: "warning", code: "AUTOPLAY_BLOCKED", message: "AudioContext is suspended; launch Chromium with --autoplay-policy=no-user-gesture-required" });
    }
    if (ctx.state === "running" && warned) warned = false;
  }, 1_000);
  window.addEventListener("pagehide", () => clearInterval(timer));
}
