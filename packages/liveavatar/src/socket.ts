/**
 * The LITE-mode event socket: a WebSocket to `ws_url` from POST /v1/sessions/start.
 * Commands go out as JSON; events come back as JSON. We never send a command
 * before the server says `session.state_updated: connected`.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { LiveAvatarSocketError, LiveAvatarStateError, LiveAvatarTimeoutError } from "./errors.js";
import { defaultLogger, type Logger } from "./logger.js";
import { ClientCommand, parseServerEvent, type ServerEvent } from "./schemas.js";

export interface SocketOptions {
  /** Time allowed for the TCP/TLS/WS handshake. Default 10 s. */
  connectTimeoutMs?: number;
  /** Time allowed after `open` for `session.state_updated: connected`. Default 15 s. */
  readyTimeoutMs?: number;
  /** WS ping cadence for dead-peer detection. 0 disables. Default 20 s. */
  pingIntervalMs?: number;
  /** How long to wait for a pong before declaring the peer dead. Default 10 s. */
  pongTimeoutMs?: number;
  logger?: Logger;
  /** Test seam. */
  WebSocketImpl?: typeof WebSocket;
}

export type SocketCloseInfo = { code: number; reason: string; expected: boolean };

export interface SocketEvents {
  event: [ServerEvent];
  error: [Error];
  close: [SocketCloseInfo];
}

export type SocketState = "idle" | "connecting" | "open" | "ready" | "closed";

export class LiveAvatarSocket extends EventEmitter<SocketEvents> {
  private ws: WebSocket | null = null;
  private _state: SocketState = "idle";
  private readonly opts: Required<Omit<SocketOptions, "WebSocketImpl" | "logger">>;
  private readonly log: Logger;
  private readonly WS: typeof WebSocket;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private closingExpected = false;
  private closeEmitted = false;

  constructor(options: SocketOptions = {}) {
    super();
    this.opts = {
      connectTimeoutMs: options.connectTimeoutMs ?? 10_000,
      readyTimeoutMs: options.readyTimeoutMs ?? 15_000,
      pingIntervalMs: options.pingIntervalMs ?? 20_000,
      pongTimeoutMs: options.pongTimeoutMs ?? 10_000,
    };
    this.log = options.logger ?? defaultLogger;
    this.WS = options.WebSocketImpl ?? WebSocket;
  }

  get state(): SocketState {
    return this._state;
  }

  get isReady(): boolean {
    return this._state === "ready" && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Connect and resolve once the server reports `connected`. Rejects (and closes) on any failure. */
  async connect(wsUrl: string): Promise<void> {
    if (this._state !== "idle") throw new LiveAvatarStateError(`socket.connect() called in state ${this._state}`);
    this._state = "connecting";
    const ws = new this.WS(wsUrl, { handshakeTimeout: this.opts.connectTimeoutMs });
    this.ws = ws;

    ws.on("message", (data: WebSocket.RawData, isBinary: boolean) => this.onMessage(data, isBinary));
    ws.on("error", (err: Error) => {
      this.log.warn("socket error", err.message);
      // connect() surfaces handshake errors via its rejection; only emit when someone listens, or Node throws.
      if (this.listenerCount("error") > 0) this.emit("error", err);
    });
    ws.on("close", (code: number, reasonBuf: Buffer) => this.onClose(code, reasonBuf.toString()));
    ws.on("pong", () => this.clearPongTimer());

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        this.teardown();
        reject(new LiveAvatarTimeoutError("WebSocket open", this.opts.connectTimeoutMs));
      }, this.opts.connectTimeoutMs);
      const onOpen = () => { cleanup(); resolve(); };
      const onErr = (err: Error) => { cleanup(); this.teardown(); reject(err); };
      const onClose = (code: number) => { cleanup(); reject(new LiveAvatarSocketError("closed_before_open", `closed with code ${code}`, null)); };
      const cleanup = () => { clearTimeout(timer); ws.off("open", onOpen); ws.off("error", onErr); ws.off("close", onClose); };
      ws.once("open", onOpen);
      ws.once("error", onErr);
      ws.once("close", onClose);
    });
    this._state = "open";

    // The server may say "new" first, then "connected". Wait for connected specifically.
    await this.waitFor(
      (e) => e.type === "session.state_updated" && e.state === "connected",
      this.opts.readyTimeoutMs,
      "session.state_updated: connected",
    ).catch((err) => { this.teardown(); throw err; });
    this._state = "ready";
    this.startPing();
    this.log.debug("socket ready");
  }

  /** Send a validated command. Throws if the socket isn't ready. */
  send(command: ClientCommand): void {
    if (!this.isReady || !this.ws) throw new LiveAvatarStateError(`cannot send ${command.type}: socket is ${this._state}`);
    const cmd = ClientCommand.parse(command);
    this.ws.send(JSON.stringify(cmd));
  }

  /** Convenience: send a bare command with a fresh event_id. */
  sendBare(type: "agent.interrupt" | "agent.start_listening" | "agent.stop_listening" | "session.keep_alive", eventId = randomUUID()): string {
    this.send({ type, event_id: eventId });
    return eventId;
  }

  /** Resolve with the first event matching `pred`, or reject after `timeoutMs`. Also rejects if the socket closes. */
  waitFor<T extends ServerEvent>(pred: (e: ServerEvent) => e is T, timeoutMs: number, what: string): Promise<T>;
  waitFor(pred: (e: ServerEvent) => boolean, timeoutMs: number, what: string): Promise<ServerEvent>;
  waitFor(pred: (e: ServerEvent) => boolean, timeoutMs: number, what: string): Promise<ServerEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new LiveAvatarTimeoutError(what, timeoutMs)); }, timeoutMs);
      const onEvent = (e: ServerEvent) => {
        if (e.type === "error") { cleanup(); reject(new LiveAvatarSocketError(e.error.type ?? null, e.error.message ?? null, e.error.event_id ?? null)); return; }
        if (pred(e)) { cleanup(); resolve(e); }
      };
      const onClose = (info: SocketCloseInfo) => { cleanup(); reject(new LiveAvatarSocketError("closed", `socket closed (${info.code} ${info.reason}) while waiting for ${what}`, null)); };
      const cleanup = () => { clearTimeout(timer); this.off("event", onEvent); this.off("close", onClose); };
      this.on("event", onEvent);
      this.on("close", onClose);
    });
  }

  /** Close deliberately. Emits `close` with expected=true. */
  close(code = 1000, reason = "client closed"): void {
    if (this._state === "closed") return;
    this.closingExpected = true;
    this.teardown(code, reason);
  }

  // ───────────── internals ─────────────

  private onMessage(data: WebSocket.RawData, isBinary: boolean): void {
    if (isBinary) { this.log.warn("ignoring binary frame from LiveAvatar socket"); return; }
    let event: ServerEvent;
    try {
      event = parseServerEvent(Array.isArray(data) ? Buffer.concat(data).toString() : data.toString());
    } catch (err) {
      this.log.warn("unparseable frame from LiveAvatar socket", err);
      return;
    }
    if (event.type === "unknown") this.log.debug("unknown event", event.rawType);
    if (event.type === "warning") this.log.warn("LiveAvatar warning", event.warning.type, event.warning.message);
    if (event.type === "error") this.log.error("LiveAvatar error", event.error.type, event.error.message);
    this.emit("event", event);
  }

  private onClose(code: number, reason: string): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.stopPing();
    this._state = "closed";
    this.ws = null;
    const expected = this.closingExpected;
    this.log.debug(`socket closed ${code} ${reason} expected=${expected}`);
    this.emit("close", { code, reason, expected });
  }

  private teardown(code = 1000, reason = ""): void {
    this.stopPing();
    const ws = this.ws;
    if (!ws) { this.onClose(code, reason); return; }
    this._state = "closed"; // no more sends from this instant; the close event follows when the handshake completes
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
      try { ws.close(code, reason); } catch { ws.terminate(); }
      // If the peer never answers the close handshake, don't hang forever.
      setTimeout(() => { if (!this.closeEmitted) { try { ws.terminate(); } catch { /* ignore */ } this.onClose(code, reason || "terminated"); } }, 2_000).unref?.();
    } else {
      try { ws.terminate(); } catch { /* ignore */ }
      this.onClose(code, reason);
    }
  }

  private startPing(): void {
    if (this.opts.pingIntervalMs <= 0) return;
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try { this.ws.ping(); } catch { return; }
      if (!this.pongTimer) {
        this.pongTimer = setTimeout(() => {
          this.pongTimer = null;
          this.log.warn("no pong from LiveAvatar socket; treating as dead");
          this.teardown(4000, "pong timeout");
        }, this.opts.pongTimeoutMs);
        this.pongTimer.unref?.();
      }
    }, this.opts.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  private clearPongTimer(): void {
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
  }

  private stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.clearPongTimer();
  }
}
