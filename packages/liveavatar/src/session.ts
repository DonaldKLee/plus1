/**
 * One LiveAvatar LITE session, start to stop:
 *   token → start → event socket → ready → (speak | interrupt | listening)* → stop
 *
 * Owns the keep-alive timers and enforces "one utterance at a time"; a new
 * speak() preempts the current one (that's the HLD's single SPEAKING state).
 * It does not know about Playwright or the page — see AvatarRig for that.
 */
import { EventEmitter } from "node:events";
import type { LiveAvatarClient } from "./client.js";
import { LiveAvatarStateError } from "./errors.js";
import { defaultLogger, type Logger } from "./logger.js";
import type { AvatarState, SessionStopReason, VideoQuality } from "./schemas.js";
import { LiveAvatarSocket, type SocketOptions } from "./socket.js";
import { speakUtterance, type PcmSource, type SpeakOptions, type Utterance, type UtteranceResult } from "./speaker.js";

export type SessionState = "idle" | "starting" | "ready" | "speaking" | "stopping" | "stopped";

export interface SessionMedia {
  sessionId: string;
  livekitUrl: string;
  livekitClientToken: string;
  livekitAgentToken: string | null;
  wsUrl: string;
  /** Seconds, if the server told us. */
  maxSessionDurationSec: number | null;
  startedAt: number;
}

export interface SessionOptions {
  client: LiveAvatarClient;
  avatarId: string;
  /** Free, ~1 minute, forces the Wayne avatar. Great for CI and smoke tests. */
  sandbox?: boolean;
  quality?: VideoQuality;
  maxSessionDurationSec?: number;
  /** WebSocket `session.keep_alive` cadence. Idle timeout upstream is 5 min. Default 60 s. */
  keepAliveMs?: number;
  /** REST keep-alive cadence (redundant path in case the socket is quietly broken). Default 4 min. 0 disables. */
  restKeepAliveMs?: number;
  socket?: SocketOptions;
  logger?: Logger;
}

export interface SessionEndInfo {
  reason: "client_stop" | "socket_closed" | "start_failed";
  error?: Error;
  /** Milliseconds the session was up. */
  uptimeMs: number;
}

export interface SessionEvents {
  state: [SessionState, SessionState];
  /** The avatar's own reported pose. */
  avatarState: [AvatarState | string];
  utteranceStarted: [Utterance];
  utteranceEnded: [UtteranceResult];
  warning: [{ type: string | null; message: string | null }];
  error: [Error];
  ended: [SessionEndInfo];
}

export class LiveAvatarSession extends EventEmitter<SessionEvents> {
  readonly options: SessionOptions;
  private readonly log: Logger;
  private _state: SessionState = "idle";
  private _media: SessionMedia | null = null;
  private sessionToken: string | null = null;
  /** Known as soon as the token is minted, so a failed start can still be stopped server-side. */
  private pendingSessionId: string | null = null;
  private socket: LiveAvatarSocket | null = null;
  private current: Utterance | null = null;
  private wsKeepAlive: ReturnType<typeof setInterval> | null = null;
  private restKeepAlive: ReturnType<typeof setInterval> | null = null;
  private endedEmitted = false;

  constructor(options: SessionOptions) {
    super();
    this.options = options;
    this.log = options.logger ?? defaultLogger;
  }

  get state(): SessionState { return this._state; }
  get media(): SessionMedia | null { return this._media; }
  get isReady(): boolean { return this._state === "ready" || this._state === "speaking"; }
  get currentUtterance(): Utterance | null { return this.current; }

  /** Create + start the session and connect the event socket. Resolves once commands are accepted. */
  async start(): Promise<SessionMedia> {
    if (this._state !== "idle") throw new LiveAvatarStateError(`session.start() called in state ${this._state}`);
    this.setState("starting");
    const { client, avatarId } = this.options;
    const t0 = Date.now();
    try {
      const token = await client.createLiteSessionToken({
        avatar_id: avatarId,
        is_sandbox: this.options.sandbox ?? false,
        video_settings: { encoding: "H264", quality: this.options.quality ?? "high" },
        ...(this.options.maxSessionDurationSec ? { max_session_duration: this.options.maxSessionDurationSec } : {}),
      });
      this.sessionToken = token.session_token;
      this.pendingSessionId = token.session_id;
      this.log.debug(`token minted for session ${token.session_id} (${Date.now() - t0}ms)`);

      const started = await client.startSession(token.session_token);
      if (!started.ws_url) {
        throw new LiveAvatarStateError("LiveAvatar did not return ws_url; the session token is not LITE mode");
      }
      this._media = {
        sessionId: started.session_id,
        livekitUrl: started.livekit_url,
        livekitClientToken: started.livekit_client_token,
        livekitAgentToken: started.livekit_agent_token ?? null,
        wsUrl: started.ws_url,
        maxSessionDurationSec: started.max_session_duration ?? null,
        startedAt: Date.now(),
      };
      this.log.debug(`session ${started.session_id} started (${Date.now() - t0}ms)`);

      const socket = new LiveAvatarSocket({ ...this.options.socket, logger: this.log });
      this.socket = socket;
      socket.on("event", (e) => {
        if (e.type === "agent.state_updated") this.emit("avatarState", e.new_state);
        else if (e.type === "warning") this.emit("warning", { type: e.warning.type ?? null, message: e.warning.message ?? null });
        else if (e.type === "session.state_updated" && e.state === "disconnected") this.log.warn("server reports session disconnected");
      });
      socket.on("error", (err) => this.emit("error", err));
      socket.on("close", (info) => {
        if (this._state === "stopping" || this._state === "stopped") return;
        this.log.warn(`event socket closed unexpectedly (${info.code} ${info.reason})`);
        void this.shutdown({ reason: "socket_closed", error: new Error(`LiveAvatar socket closed: ${info.code} ${info.reason}`) }, "USER_DISCONNECTED");
      });
      await socket.connect(started.ws_url);

      this.startKeepAlive();
      this.setState("ready");
      this.log.info(`LiveAvatar session ${started.session_id} ready in ${Date.now() - t0}ms`);
      return this._media;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.shutdown({ reason: "start_failed", error }, "SERVER_ERROR");
      throw error;
    }
  }

  /**
   * Speak PCM (24 kHz mono s16le). Preempts any utterance in progress.
   * Returns immediately; await `utterance.done` for the outcome.
   */
  speak(source: PcmSource, opts: SpeakOptions = {}): Utterance {
    if (!this.isReady || !this.socket) throw new LiveAvatarStateError(`speak() called in state ${this._state}`);
    if (this.current) this.current.interrupt();
    const utterance = speakUtterance(this.socket, source, opts, this.log);
    this.current = utterance;
    this.setState("speaking");
    this.emit("utteranceStarted", utterance);
    void utterance.done.then((result) => {
      if (this.current === utterance) {
        this.current = null;
        if (this._state === "speaking") this.setState("ready");
      }
      this.emit("utteranceEnded", result);
    });
    return utterance;
  }

  /** Barge-in. Safe to call when nothing is playing (sends a bare interrupt so the server clears any buffer). */
  interrupt(): void {
    if (this.current) { this.current.interrupt(); return; }
    if (this.socket?.isReady) {
      try { this.socket.sendBare("agent.interrupt"); } catch (err) { this.log.warn("bare interrupt failed", err); }
    }
  }

  /** Toggle the avatar's "listening" pose (the only emote LITE mode offers). */
  setListening(listening: boolean): void {
    if (!this.socket?.isReady) return;
    this.socket.sendBare(listening ? "agent.start_listening" : "agent.stop_listening");
  }

  /** Stop everything and tell the server. Idempotent. */
  async stop(reason: SessionStopReason = "USER_CLOSED"): Promise<void> {
    if (this._state === "stopped") return;
    await this.shutdown({ reason: "client_stop" }, reason);
  }

  // ───────────── internals ─────────────

  private setState(next: SessionState): void {
    const prev = this._state;
    if (prev === next) return;
    this._state = next;
    this.emit("state", next, prev);
  }

  private startKeepAlive(): void {
    const wsMs = this.options.keepAliveMs ?? 60_000;
    if (wsMs > 0) {
      this.wsKeepAlive = setInterval(() => {
        try { this.socket?.isReady && this.socket.sendBare("session.keep_alive"); } catch (err) { this.log.warn("ws keep-alive failed", err); }
      }, wsMs);
      this.wsKeepAlive.unref?.();
    }
    const restMs = this.options.restKeepAliveMs ?? 240_000;
    if (restMs > 0) {
      this.restKeepAlive = setInterval(() => {
        const m = this._media;
        if (!m) return;
        this.options.client.keepAlive({ sessionId: m.sessionId, sessionToken: this.sessionToken ?? undefined })
          .catch((err) => this.log.warn("REST keep-alive failed", err));
      }, restMs);
      this.restKeepAlive.unref?.();
    }
  }

  private async shutdown(info: Omit<SessionEndInfo, "uptimeMs">, stopReason: SessionStopReason): Promise<void> {
    if (this._state === "stopping" || this._state === "stopped") return;
    this.setState("stopping");
    if (this.wsKeepAlive) clearInterval(this.wsKeepAlive);
    if (this.restKeepAlive) clearInterval(this.restKeepAlive);
    this.wsKeepAlive = this.restKeepAlive = null;
    // On a dead socket the speaker sees the close itself and reports "failed", which is the honest outcome.
    if (info.reason !== "socket_closed") this.current?.interrupt();
    this.current = null;
    this.socket?.close();
    this.socket = null;
    const m = this._media;
    const sessionId = m?.sessionId ?? this.pendingSessionId;
    if (sessionId) {
      try {
        await this.options.client.stopSession({ sessionId, sessionToken: this.sessionToken ?? undefined, reason: stopReason });
      } catch (err) {
        this.log.warn("stopSession failed (session may already be gone)", err);
      }
    }
    this.setState("stopped");
    if (!this.endedEmitted) {
      this.endedEmitted = true;
      this.emit("ended", { ...info, uptimeMs: m ? Date.now() - m.startedAt : 0 });
    }
  }
}
