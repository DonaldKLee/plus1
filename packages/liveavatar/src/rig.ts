/**
 * AvatarRig: the piece the runner talks to. It wires a LiveAvatar session to a
 * Playwright page so the avatar becomes the fake camera and mic in Google Meet.
 *
 *   const rig = new AvatarRig({ client, avatarId, tts });
 *   await rig.prepare(page);            // BEFORE page.goto(meetUrl)
 *   await page.goto(meetUrl); …join…
 *   await rig.start();                  // avatar is now on camera
 *   rig.speakText("on it");             // ← agent.speak from the control plane
 *   rig.interrupt();                    // ← barge-in
 *
 * The rig makes no decisions. It executes speak / interrupt / honk / emote.
 */
import { EventEmitter } from "node:events";
import type { LiveAvatarClient } from "./client.js";
import { LiveAvatarStateError } from "./errors.js";
import { defaultLogger, type Logger } from "./logger.js";
import { EARLY_BUNDLE, PAGE_BUNDLE } from "./page-bundle.generated.js";
import {
  DEFAULT_PAGE_MEDIA_CONFIG,
  PAGE_EVENT_SINK,
  PAGE_GLOBAL,
  type PageConnectParams,
  type PageEvent,
  type PageMediaConfig,
  type PageMediaState,
} from "./page-protocol.js";
import { bytesToBase64 } from "./pcm.js";
import type { VideoQuality } from "./schemas.js";
import { LiveAvatarSession, type SessionEndInfo, type SessionMedia } from "./session.js";
import type { PcmSource, SpeakOptions, Utterance, UtteranceResult, UtteranceOutcome } from "./speaker.js";
import { fetchAudioAsPcm, type TextToSpeech } from "./tts.js";

/** The slice of Playwright's Page we use, typed structurally so this package doesn't depend on playwright. */
export interface RigPage {
  // Loose on purpose: Playwright's real signatures are heavily generic; a real `Page` must satisfy this.
  // `(...args: any[])` so Playwright's overloaded generic methods are assignable.
  addInitScript(...args: any[]): Promise<unknown>;
  evaluate(...args: any[]): Promise<any>;
  exposeFunction(...args: any[]): Promise<unknown>;
}

/** The HLD's emote vocabulary, mapped onto what LITE mode can actually do. */
export type Emote = "thinking" | "typing" | "nod" | "honk" | "idle";

export interface AvatarRigOptions {
  client: LiveAvatarClient;
  avatarId: string;
  sandbox?: boolean;
  quality?: VideoQuality;
  maxSessionDurationSec?: number;
  /** Needed for speakText(). speakPcm()/speakUrl() work without it. */
  tts?: TextToSpeech;
  page?: Partial<PageMediaConfig>;
  /** Recreate the LiveAvatar session if it dies (max duration, server hiccup). Default true. */
  autoRestart?: boolean;
  /** Backoff between restart attempts, ms. Default [500, 1500, 4000, 8000]; the last value repeats. */
  restartBackoffMs?: number[];
  /** Give up restarting after this many consecutive failures. Default 8. */
  maxRestartAttempts?: number;
  /**
   * Rotate to a fresh session this long BEFORE the current one hits its max
   * duration, so the session dies while idle instead of mid-sentence. Sandbox
   * sessions only live ~1-2 minutes, which is what makes this essential.
   * Default 15 s. 0 disables.
   */
  renewLeadMs?: number;
  logger?: Logger;
}

export interface RigEvents {
  /** LiveAvatar session state. */
  sessionState: [LiveAvatarSession["state"]];
  /** In-page media state (what Meet actually sees). */
  mediaState: [PageMediaState, string | undefined];
  speaking: [{ id: string; label?: string; phase: "queued" | "started" | "ended"; result?: UtteranceResult }];
  /** New LiveKit credentials were plumbed into the page (first start or a restart). */
  sessionMedia: [SessionMedia];
  page: [PageEvent];
  warning: [string];
  error: [Error];
  /** The rig is ready to speak again after a restart or rotation. */
  ready: [];
  /** Auto-restart gave up. The runner should report meeting.error and leave or continue chat-only. */
  dead: [Error];
}

/** Outcome of a resilient say(): what the room actually heard. */
export interface SayResult {
  outcome: UtteranceOutcome | "dropped";
  /** How many times the line had to be sent before it landed. */
  attempts: number;
  error?: Error;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class AvatarRig extends EventEmitter<RigEvents> {
  private readonly opts: AvatarRigOptions;
  private readonly log: Logger;
  private page: RigPage | null = null;
  private session: LiveAvatarSession | null = null;
  private stopped = false;
  private restarting = false;
  private restartFailures = 0;
  private lastMediaState: PageMediaState = "idle";
  private ttsAbort: AbortController | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private rotating = false;

  constructor(opts: AvatarRigOptions) {
    super();
    this.opts = opts;
    this.log = opts.logger ?? defaultLogger;
  }

  get sessionState() { return this.session?.state ?? "idle"; }
  get mediaState(): PageMediaState { return this.lastMediaState; }
  get media(): SessionMedia | null { return this.session?.media ?? null; }
  get isSpeaking(): boolean { return this.session?.state === "speaking"; }

  /**
   * Install the getUserMedia override. Call before navigating to Meet: it must beat Meet's own
   * JavaScript so the camera and mic Meet acquires are our canvas and mixer. Only the tiny
   * early bundle goes in as an init script; a large init script stalls Meet's document load.
   * The heavy bridge is injected by start() (or lazily by any call) once the page has loaded.
   */
  async prepare(page: RigPage): Promise<void> {
    if (this.page) throw new LiveAvatarStateError("rig.prepare() called twice");
    this.page = page;
    await page.exposeFunction(PAGE_EVENT_SINK, (event: PageEvent) => this.onPageEvent(event));
    await page.addInitScript(`(() => { if (window.top !== window) return; window.__plus1AvatarConfig = ${JSON.stringify(this.pageConfig)}; ${EARLY_BUNDLE} })();`);
    this.log.debug("early fake-media script installed");
  }

  private get pageConfig(): PageMediaConfig {
    return { ...DEFAULT_PAGE_MEDIA_CONFIG, ...this.opts.page };
  }

  /** Inject the bridge into the loaded page if it isn't there (first start, or after a reload). */
  async ensureBridge(): Promise<void> {
    if (!this.page) throw new LiveAvatarStateError("no page attached");
    const present = await this.page.evaluate(`!!window[${JSON.stringify(PAGE_GLOBAL)}]`);
    if (present) return;
    await this.page.evaluate(`window.__plus1AvatarConfig = ${JSON.stringify(this.pageConfig)}; ${PAGE_BUNDLE}`);
    this.log.debug("page bridge injected");
  }

  /** Start the LiveAvatar session and connect the page to its LiveKit room. */
  async start(): Promise<SessionMedia> {
    if (!this.page) throw new LiveAvatarStateError("call rig.prepare(page) before rig.start()");
    if (this.session) throw new LiveAvatarStateError("rig already started");
    this.stopped = false;
    await this.ensureBridge();
    const media = await this.openSession();
    await this.connectPage(media);
    return media;
  }

  /**
   * Re-plumb the current session into the page after the page reloaded (Meet does this after
   * sign-in and on some errors). No-op if no session is up. Cheap to call on every `load`.
   */
  async reattach(): Promise<void> {
    const media = this.session?.media;
    if (!media || !this.session?.isReady) return;
    try {
      await this.connectPage(media);
      this.log.info("avatar re-attached to the reloaded page");
    } catch (err) {
      this.log.warn(`reattach failed: ${(err as Error).message}`);
    }
  }

  /**
   * Resolve once the rig can accept speech, or false if it didn't come back in
   * time. Covers the window where a session died and is being replaced.
   */
  async waitUntilReady(timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!this.stopped && Date.now() < deadline) {
      if (this.session?.isReady) return true;
      await sleep(200);
    }
    return Boolean(this.session?.isReady);
  }

  /**
   * Say a line and actually see it through — the durable counterpart to
   * speakText(). A LiveAvatar session has a hard max duration (about a minute in
   * sandbox), so sooner or later a socket WILL close mid-sentence. speakText()
   * reports that as a failed utterance and the line is simply lost; say() waits
   * for the replacement session and sends the line again.
   *
   * Only retried when the room heard little or nothing. If most of the line
   * already played, repeating it would be worse than dropping the tail.
   */
  say(
    text: string,
    opts: SpeakOptions & { retries?: number; readyTimeoutMs?: number; minDeliveredMs?: number } = {},
  ): { done: Promise<SayResult> } {
    return { done: this.sayAsync(text, opts) };
  }

  private async sayAsync(
    text: string,
    opts: SpeakOptions & { retries?: number; readyTimeoutMs?: number; minDeliveredMs?: number },
  ): Promise<SayResult> {
    const retries = opts.retries ?? 2;
    const minDelivered = opts.minDeliveredMs ?? 2_500;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      if (this.stopped) return { outcome: "dropped", attempts: attempt - 1, error: lastError };

      if (!(await this.waitUntilReady(opts.readyTimeoutMs ?? 20_000))) {
        lastError = new LiveAvatarStateError(`avatar not ready (session ${this.sessionState})`);
        continue;
      }

      let utt: Utterance;
      try {
        utt = this.speakText(text, opts);
      } catch (err) {
        // Lost the race with a session teardown; loop round and wait again.
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(300);
        continue;
      }

      const r = await utt.done;
      if (r.outcome === "completed" || r.outcome === "empty") return { outcome: r.outcome, attempts: attempt };
      // An interrupt is a deliberate decision by a human or the operator. Honour
      // it — retrying would be talking over someone on purpose.
      if (r.outcome === "interrupted") return { outcome: "interrupted", attempts: attempt };

      lastError = r.error;
      if (r.sentMs >= minDelivered) {
        // The room heard the substance of it; don't make everyone sit through it twice.
        this.emit("warning", `utterance cut off after ${Math.round(r.sentMs)}ms; not repeating it`);
        return { outcome: "completed", attempts: attempt, error: r.error };
      }
      if (attempt <= retries) {
        this.log.warn(`utterance failed after ${Math.round(r.sentMs)}ms (${r.error?.message ?? "unknown"}); retrying`);
        this.emit("warning", `avatar dropped a line mid-sentence; saying it again`);
      }
    }

    return { outcome: "dropped", attempts: retries + 1, error: lastError };
  }

  /** Speak text through the configured TTS. Preempts anything currently playing. */
  speakText(text: string, opts: SpeakOptions = {}): Utterance {
    const tts = this.opts.tts;
    if (!tts) throw new LiveAvatarStateError("speakText() needs a TextToSpeech in AvatarRigOptions.tts");
    this.ttsAbort?.abort();
    const abort = new AbortController();
    this.ttsAbort = abort;
    const utt = this.speakPcm(tts.synthesize(text, { signal: abort.signal }), { label: opts.label ?? text.slice(0, 60), ...opts });
    void utt.done.then(() => { abort.abort(); if (this.ttsAbort === abort) this.ttsAbort = null; });
    return utt;
  }

  /** Speak pre-rendered PCM (24 kHz mono s16le) — cached fillers, or audio the control plane produced. */
  speakPcm(source: PcmSource, opts: SpeakOptions = {}): Utterance {
    const session = this.requireSession();
    const utt = session.speak(source, {
      ...opts,
      onFirstChunk: () => { void this.pageCall("setAvatarMuted", false); opts.onFirstChunk?.(); },
      onStarted: () => { this.emit("speaking", { id: utt.id, label: opts.label, phase: "started" }); opts.onStarted?.(); },
    });
    this.emit("speaking", { id: utt.id, label: opts.label, phase: "queued" });
    void utt.done.then((result) => this.emit("speaking", { id: utt.id, label: opts.label, phase: "ended", result }));
    return utt;
  }

  /** Speak audio at a URL (the HLD's agent.speak.audioUrl). WAV or raw PCM. */
  async speakUrl(url: string, opts: SpeakOptions = {}): Promise<Utterance> {
    const pcm = await fetchAudioAsPcm(url);
    return this.speakPcm(pcm, { label: url, ...opts });
  }

  /** Barge-in: instant local mute, stop the pump, tell the server to clear. */
  interrupt(): void {
    this.ttsAbort?.abort();
    void this.pageCall("setAvatarMuted", true);
    this.session?.interrupt();
  }

  /** Honk. Plays in-page straight into the mic bus; optionally interrupts speech first. */
  async honk(opts: { interrupt?: boolean; durationMs?: number } = {}): Promise<void> {
    if (opts.interrupt ?? true) this.interrupt();
    await this.pageCall("honk", { durationMs: opts.durationMs ?? 650, duck: true });
  }

  /** Play PCM directly into Meet without going through the avatar (system sounds). */
  async playPcm(pcm: Uint8Array): Promise<void> {
    await this.pageCall("playPcm", bytesToBase64(pcm), { duck: true });
  }

  /**
   * Emotes, mapped to LITE-mode reality:
   *  thinking/typing → listening pose · idle → idle pose · honk → honk() · nod → no-op (lipsync model has no nod).
   */
  async emote(emote: Emote): Promise<void> {
    switch (emote) {
      case "thinking":
      case "typing":
        this.session?.setListening(true);
        return;
      case "idle":
        this.session?.setListening(false);
        return;
      case "honk":
        await this.honk({ interrupt: false });
        return;
      case "nod":
        return;
    }
  }

  /** Stop the session and clear the page back to the placeholder. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    this.ttsAbort?.abort();
    const s = this.session;
    this.session = null;
    await Promise.allSettled([s?.stop("USER_CLOSED"), this.pageCall("disconnect")]);
  }

  // ───────────── internals ─────────────

  private requireSession(): LiveAvatarSession {
    if (!this.session?.isReady) {
      throw new LiveAvatarStateError(`avatar not ready (session ${this.session?.state ?? "none"}); speech dropped`);
    }
    return this.session;
  }

  private async openSession(): Promise<SessionMedia> {
    const session = new LiveAvatarSession({
      client: this.opts.client,
      avatarId: this.opts.avatarId,
      sandbox: this.opts.sandbox,
      quality: this.opts.quality,
      maxSessionDurationSec: this.opts.maxSessionDurationSec,
      logger: this.log,
    });
    session.on("state", (s) => this.emit("sessionState", s));
    session.on("warning", (w) => this.emit("warning", `${w.type ?? "warning"}: ${w.message ?? ""}`));
    session.on("error", (e) => this.emit("error", e));
    session.on("ended", (info) => this.onSessionEnded(session, info));
    this.session = session;
    const media = await session.start();
    this.restartFailures = 0;
    this.emit("sessionMedia", media);
    this.scheduleRenewal(media);
    this.emit("ready");
    return media;
  }

  /**
   * Replace the session shortly before it hits its max duration. Without this the
   * session dies whenever it dies — usually halfway through a sentence, since
   * that's when the rig is busy. Rotating early means the expiry lands on an
   * idle rig and nobody in the meeting notices.
   */
  private scheduleRenewal(media: SessionMedia): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    const lead = this.opts.renewLeadMs ?? 15_000;
    const lifeSec = media.maxSessionDurationSec;
    if (!lead || !lifeSec) return;
    const delay = Math.max(5_000, lifeSec * 1000 - lead);
    this.log.debug(`session lives ${lifeSec}s; rotating in ${Math.round(delay / 1000)}s`);
    this.renewTimer = setTimeout(() => void this.rotate(media), delay);
    this.renewTimer.unref?.();
  }

  /** Swap in a fresh session, waiting for the current utterance to finish first. */
  private async rotate(expiring: SessionMedia): Promise<void> {
    if (this.stopped || this.rotating) return;
    if (this.session?.media?.sessionId !== expiring.sessionId) return; // already replaced
    this.rotating = true;
    try {
      // Let whatever is playing finish, but not past the session's actual expiry.
      const hardStop = expiring.startedAt + (expiring.maxSessionDurationSec ?? 60) * 1000 - 2_000;
      while (this.isSpeaking && Date.now() < hardStop && !this.stopped) await sleep(250);
      if (this.stopped) return;
      if (this.session?.media?.sessionId !== expiring.sessionId) return;

      const old = this.session;
      this.log.info(`rotating LiveAvatar session ${expiring.sessionId.slice(0, 8)} before it expires`);
      try {
        // openSession() overwrites this.session; the old session's `ended` handler
        // no-ops because it checks identity, so this won't trigger a restart.
        const media = await this.openSession();
        await this.connectPage(media);
        void old?.stop("USER_CLOSED").catch(() => {});
        this.log.info("LiveAvatar session rotated");
      } catch (err) {
        // Put the old session back if it's still alive, so we keep talking on it
        // until it really expires and the normal restart path takes over.
        if (old?.isReady && this.session !== old) {
          this.session = old;
          // Expiry is imminent, so retry shortly rather than a full lifetime out.
          if (this.renewTimer) clearTimeout(this.renewTimer);
          this.renewTimer = setTimeout(() => void this.rotate(expiring), 3_000);
          this.renewTimer.unref?.();
        }
        throw err;
      }
    } catch (err) {
      this.emit("warning", `session rotation failed: ${(err as Error).message}; falling back to restart`);
    } finally {
      this.rotating = false;
    }
  }

  private async connectPage(media: SessionMedia): Promise<void> {
    await this.ensureBridge();
    const params: PageConnectParams = { livekitUrl: media.livekitUrl, livekitToken: media.livekitClientToken, trackTimeoutMs: 30_000 };
    const tracks = await this.pageCall<{ video: boolean; audio: boolean }>("connect", params);
    if (!tracks.video || !tracks.audio) this.emit("warning", `avatar tracks incomplete: video=${tracks.video} audio=${tracks.audio}`);
  }

  private onSessionEnded(session: LiveAvatarSession, info: SessionEndInfo): void {
    if (this.session !== session) return; // an older session finishing after a restart
    this.session = null;
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    if (this.stopped || info.reason === "client_stop") return;
    this.log.warn(`LiveAvatar session ended (${info.reason}) after ${Math.round(info.uptimeMs / 1000)}s`);
    if (this.opts.autoRestart ?? true) void this.restart();
    else this.emit("dead", info.error ?? new Error(`session ended: ${info.reason}`));
  }

  private async restart(): Promise<void> {
    if (this.restarting || this.stopped) return;
    this.restarting = true;
    // Short first backoff: a session that hit its max duration can be replaced
    // immediately, and every ms here is dead air in the meeting.
    const backoffs = this.opts.restartBackoffMs ?? [500, 1_500, 4_000, 8_000];
    const max = this.opts.maxRestartAttempts ?? 8;
    try {
      while (!this.stopped) {
        const wait = backoffs[Math.min(this.restartFailures, backoffs.length - 1)] ?? 8_000;
        await new Promise((r) => setTimeout(r, wait));
        if (this.stopped) return;
        try {
          this.log.info(`restarting LiveAvatar session (attempt ${this.restartFailures + 1}/${max})`);
          const media = await this.openSession();
          await this.connectPage(media);
          this.log.info("LiveAvatar session restarted");
          return;
        } catch (err) {
          this.restartFailures++;
          this.log.warn(`restart failed: ${(err as Error).message}`);
          if (this.restartFailures >= max) {
            this.emit("dead", err instanceof Error ? err : new Error(String(err)));
            return;
          }
        }
      }
    } finally {
      this.restarting = false;
    }
  }

  private onPageEvent(event: PageEvent): void {
    this.emit("page", event);
    switch (event.kind) {
      case "state":
        this.lastMediaState = event.state;
        this.emit("mediaState", event.state, event.detail);
        break;
      case "warning":
        this.emit("warning", `${event.code}: ${event.message}`);
        break;
      case "error":
        this.emit("error", new Error(`page: ${event.message}`));
        break;
      case "log":
        (this.log[event.level] ?? this.log.debug)("page:", event.message);
        break;
      default:
        break;
    }
  }

  private async pageCall<R = unknown>(method: string, ...args: unknown[]): Promise<R> {
    if (!this.page) throw new LiveAvatarStateError("no page attached");
    const expr = `(async () => { const b = window[${JSON.stringify(PAGE_GLOBAL)}]; if (!b) throw new Error("plus1 avatar bridge not installed in page"); return await b[${JSON.stringify(method)}](...${JSON.stringify(args)}); })()`;
    try {
      try {
        return (await this.page.evaluate(expr)) as R;
      } catch (err) {
        if (!String((err as Error).message).includes("not installed")) throw err;
        await this.ensureBridge(); // page reloaded under us
        return (await this.page.evaluate(expr)) as R;
      }
    } catch (err) {
      this.log.warn(`page.${method} failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
