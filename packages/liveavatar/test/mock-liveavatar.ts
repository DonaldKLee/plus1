/**
 * In-process fake of api.liveavatar.com (REST) and the LITE-mode event socket.
 * Behaves like the real thing as documented: envelope responses, Bearer vs
 * X-API-KEY, `session.state_updated` handshake, utterance lifecycle events,
 * interrupt semantics, and a 1 MB packet cap.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

export interface MockCall { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: unknown }
export interface MockUtterance { id: string; chunks: Buffer[]; ended: boolean; interrupted: boolean }

export interface MockOptions {
  /** Real-time factor for simulated playback (0.05 = 20× faster than real time). */
  speed?: number;
  /** Send `new` before `connected`, with this delay. */
  handshakeDelayMs?: number;
  /** Fail token creation with this HTTP status the first N times. */
  failTokenTimes?: number;
  /** Never send `connected` (to test ready timeout). */
  neverConnect?: boolean;
  /** Reject speak with an error event. */
  errorOnSpeak?: boolean;
  /** Omit ws_url from start (simulates a FULL-mode token). */
  omitWsUrl?: boolean;
  /** Reject REST auth unless this key is used. */
  apiKey?: string;
}

export class MockLiveAvatar {
  readonly calls: MockCall[] = [];
  readonly utterances: MockUtterance[] = [];
  readonly wsMessages: any[] = [];
  readonly sockets = new Set<WebSocket>();
  readonly sessions = new Map<string, { token: string; started: boolean; stopped: boolean; stopReason?: string; keepAlives: number }>();
  private http!: Server;
  private wss!: WebSocketServer;
  private port = 0;
  private tokenFailures = 0;
  private opts: MockOptions;
  private sessionState = new Map<WebSocket, { current: MockUtterance | null; talking: boolean; timers: ReturnType<typeof setTimeout>[] }>();

  constructor(opts: MockOptions = {}) { this.opts = { speed: 0.05, handshakeDelayMs: 10, apiKey: "test-key", ...opts }; }

  get baseUrl(): string { return `http://127.0.0.1:${this.port}`; }
  get wsUrl(): string { return `ws://127.0.0.1:${this.port}/ws`; }

  setOptions(o: Partial<MockOptions>): void { Object.assign(this.opts, o); }

  async start(): Promise<void> {
    this.http = createServer((req, res) => void this.handle(req, res));
    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });
    this.wss.on("connection", (ws) => this.onSocket(ws));
    await new Promise<void>((r) => this.http.listen(0, "127.0.0.1", () => r()));
    this.port = (this.http.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const ws of this.sockets) { try { ws.terminate(); } catch {} }
    for (const st of this.sessionState.values()) st.timers.forEach(clearTimeout);
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.http.close(() => r()));
  }

  /** Server-initiated close of every socket (simulates max duration / server hiccup). */
  dropSockets(code = 1011, reason = "server went away"): void {
    for (const ws of this.sockets) ws.close(code, reason);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    const url = new URL(req.url ?? "/", this.baseUrl);
    this.calls.push({ method: req.method ?? "GET", path: url.pathname + url.search, headers: req.headers, body });
    const send = (status: number, payload: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
    const ok = (data: unknown) => send(200, { code: 100, message: "ok", data });

    const auth = req.headers.authorization;
    const key = req.headers["x-api-key"];
    const bearerSession = auth?.startsWith("Bearer ") ? [...this.sessions.entries()].find(([, s]) => s.token === auth.slice(7)) : undefined;
    const keyOk = key === this.opts.apiKey;

    if (url.pathname === "/v1/sessions/token" && req.method === "POST") {
      if (!keyOk) return send(401, { detail: "bad api key" });
      if (this.tokenFailures < (this.opts.failTokenTimes ?? 0)) { this.tokenFailures++; return send(503, { detail: "try later" }); }
      if (body?.mode !== "LITE") return send(422, { detail: [{ loc: ["body", "mode"], msg: "only LITE supported by mock" }] });
      const id = randomUUID(); const token = `tok_${id}`;
      this.sessions.set(id, { token, started: false, stopped: false, keepAlives: 0 });
      return ok({ session_id: id, session_token: token });
    }
    if (url.pathname === "/v1/sessions/start" && req.method === "POST") {
      if (!bearerSession) return send(401, { detail: "bad session token" });
      const [id, s] = bearerSession;
      if (s.started) return send(400, { code: 400, message: "already started", data: null });
      s.started = true;
      return send(201, { code: 100, message: "ok", data: {
        session_id: id, livekit_url: "wss://mock.livekit.cloud", livekit_client_token: `lk_client_${id}`, livekit_agent_token: `lk_agent_${id}`,
        max_session_duration: 600, ...(this.opts.omitWsUrl ? {} : { ws_url: `${this.wsUrl}?session=${id}` }),
      } });
    }
    if (url.pathname === "/v1/sessions/stop" && req.method === "POST") {
      if (!bearerSession && !keyOk) return send(401, { detail: "unauthenticated" });
      const s = this.sessions.get(body?.session_id);
      if (!s) return send(404, { detail: "no such session" });
      s.stopped = true; s.stopReason = body?.reason;
      return ok(null);
    }
    if (url.pathname === "/v1/sessions/keep-alive" && req.method === "POST") {
      if (!bearerSession && !keyOk) return send(401, { detail: "unauthenticated" });
      const s = this.sessions.get(body?.session_id);
      if (!s) return send(404, { detail: "no such session" });
      s.keepAlives++;
      return ok(null);
    }
    if (url.pathname.startsWith("/v1/sessions/") && req.method === "GET") {
      if (!keyOk) return send(401, {});
      const id = url.pathname.split("/").pop()!;
      const s = this.sessions.get(id);
      return ok(s ? { id, mode: "LITE", is_sandbox: false, duration: 12, extra_field: "ignored" } : null);
    }
    if (url.pathname === "/v1/avatars/public" && req.method === "GET") {
      return ok({ count: 1, next: null, previous: null, results: [{ id: "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a", name: "Wayne", type: "VIDEO", status: "ACTIVE", preview_url: "https://x/y.png", default_voice: { id: "v1", name: "Wayne" }, brand_new_field: 1 }] });
    }
    if (url.pathname === "/v1/voices" && req.method === "GET") {
      if (!keyOk) return send(401, {});
      return ok({ count: 1, results: [{ id: "v1", name: "Wayne", language: "en", gender: "male", tags: ["calm"] }] });
    }
    send(404, { detail: "not found" });
  }

  private onSocket(ws: WebSocket): void {
    this.sockets.add(ws);
    const st = { current: null as MockUtterance | null, talking: false, timers: [] as ReturnType<typeof setTimeout>[] };
    this.sessionState.set(ws, st);
    const emit = (o: Record<string, unknown>) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(o)); };
    const later = (ms: number, fn: () => void) => { const t = setTimeout(fn, ms); st.timers.push(t); return t; };

    emit({ type: "session.state_updated", state: "new", event_id: randomUUID() });
    if (!this.opts.neverConnect) later(this.opts.handshakeDelayMs ?? 10, () => emit({ type: "session.state_updated", state: "connected", event_id: randomUUID() }));

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      this.wsMessages.push(msg);
      switch (msg.type) {
        case "agent.speak": {
          if (this.opts.errorOnSpeak) { emit({ type: "error", error: { type: "server_error", message: "mock speak failure", event_id: msg.event_id } }); return; }
          const audio = Buffer.from(msg.audio, "base64");
          if (audio.length > 1_000_000) { emit({ type: "error", error: { type: "invalid_request_error", message: "packet too large", event_id: msg.event_id } }); return; }
          if (!st.current || st.current.ended) {
            st.current = { id: msg.event_id, chunks: [], ended: false, interrupted: false };
            this.utterances.push(st.current);
            later(5, () => {
              if (!st.current || st.current.interrupted) return;
              st.talking = true;
              emit({ type: "agent.state_updated", previous_state: "idle", new_state: "talking", event_id: randomUUID() });
              emit({ type: "agent.speak_started", event_id: st.current.id, source_event_id: st.current.id });
            });
          }
          st.current.chunks.push(audio);
          emit({ type: "agent.audio_buffer_appended", event_id: randomUUID(), source_event_id: msg.event_id });
          return;
        }
        case "agent.speak_end": {
          const u = st.current;
          if (!u) return;
          u.ended = true;
          emit({ type: "agent.audio_buffer_committed", event_id: randomUUID(), source_event_id: msg.event_id });
          const bytes = u.chunks.reduce((n, c) => n + c.length, 0);
          const playMs = (bytes / 48_000) * 1000 * (this.opts.speed ?? 0.05);
          later(playMs + 10, () => {
            if (u.interrupted) return;
            st.talking = false;
            emit({ type: "agent.speak_ended", event_id: u.id, source_event_id: u.id });
            emit({ type: "agent.state_updated", previous_state: "talking", new_state: "idle", event_id: randomUUID() });
          });
          return;
        }
        case "agent.interrupt": {
          const u = st.current;
          emit({ type: "agent.audio_buffer_cleared", event_id: randomUUID(), source_event_id: msg.event_id });
          if (u && !u.interrupted) {
            u.interrupted = true; u.ended = true;
            if (st.talking) { st.talking = false; emit({ type: "agent.speak_interrupted", event_id: u.id, source_event_id: u.id }); emit({ type: "agent.state_updated", previous_state: "talking", new_state: "idle", event_id: randomUUID() }); }
          }
          return;
        }
        case "agent.start_listening": emit({ type: "agent.state_updated", previous_state: "idle", new_state: "listening", event_id: randomUUID() }); return;
        case "agent.stop_listening": emit({ type: "agent.state_updated", previous_state: "listening", new_state: "idle", event_id: randomUUID() }); return;
        case "session.keep_alive": return;
        default: emit({ type: "error", error: { type: "invalid_request_error", message: `unknown type ${msg.type}`, event_id: msg.event_id } });
      }
    });
    ws.on("close", () => { this.sockets.delete(ws); st.timers.forEach(clearTimeout); this.sessionState.delete(ws); });
  }
}
