/**
 * REST client for api.liveavatar.com. Thin, typed, and boring on purpose:
 * every response is validated with the zod schemas in ./schemas.ts.
 */
import { LiveAvatarApiError, LiveAvatarError, LiveAvatarTimeoutError } from "./errors.js";
import { defaultLogger, type Logger } from "./logger.js";
import {
  GetAvatarResponse,
  GetSessionResponse,
  KeepAliveRequest,
  ListAvatarsResponse,
  ListVoicesResponse,
  LiteSessionTokenRequest,
  NullDataResponse,
  SessionTokenResponse,
  StartSessionResponse,
  StopSessionRequest,
  type AvatarSummary,
  type SessionEntry,
  type SessionStopReason,
  type SessionTokenData,
  type StartSessionData,
  type VoiceSummary,
} from "./schemas.js";
import type { z } from "zod";

export const LIVEAVATAR_API_URL = "https://api.liveavatar.com";

export interface LiveAvatarClientOptions {
  apiKey: string;
  /** Override for tests / proxies. Default https://api.liveavatar.com */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per-request timeout. Default 15 s. */
  timeoutMs?: number;
  /** Retries for idempotent calls on 429/5xx/network errors. Default 2. */
  retries?: number;
  logger?: Logger;
}

export type Auth = { apiKey: true } | { bearer: string };

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  auth: Auth;
  /** Whether a retry is safe. */
  idempotent: boolean;
}

export class LiveAvatarClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly log: Logger;

  constructor(opts: LiveAvatarClientOptions) {
    if (!opts.apiKey) throw new LiveAvatarError("NO_API_KEY", "LiveAvatarClient needs an apiKey (LIVEAVATAR_API_KEY)");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? LIVEAVATAR_API_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.retries = opts.retries ?? 2;
    this.log = opts.logger ?? defaultLogger;
  }

  // ───────────── sessions ─────────────

  /** Mint a LITE-mode session token. Only the API key can do this; never ship the key to a browser. */
  async createLiteSessionToken(req: Omit<LiteSessionTokenRequest, "mode">): Promise<SessionTokenData> {
    const body = LiteSessionTokenRequest.parse({ mode: "LITE", ...req });
    const res = await this.request(SessionTokenResponse, {
      method: "POST",
      path: "/v1/sessions/token",
      body,
      auth: { apiKey: true },
      idempotent: true, // an unused token is harmless
    });
    return res.data;
  }

  /** Start the session: LiveAvatar spins up the avatar and returns LiveKit + WebSocket credentials. */
  async startSession(sessionToken: string): Promise<StartSessionData> {
    const res = await this.request(StartSessionResponse, {
      method: "POST",
      path: "/v1/sessions/start",
      auth: { bearer: sessionToken },
      idempotent: false,
    });
    return res.data;
  }

  /** Stop a session. Prefers the session token; falls back to the API key. */
  async stopSession(args: { sessionId: string; sessionToken?: string; reason?: SessionStopReason }): Promise<void> {
    const body = StopSessionRequest.parse({ session_id: args.sessionId, reason: args.reason ?? "USER_CLOSED" });
    await this.request(NullDataResponse, {
      method: "POST",
      path: "/v1/sessions/stop",
      body,
      auth: args.sessionToken ? { bearer: args.sessionToken } : { apiKey: true },
      idempotent: true,
    });
  }

  /** REST heartbeat. The WebSocket `session.keep_alive` is the primary one; this is the belt to its braces. */
  async keepAlive(args: { sessionId: string; sessionToken?: string }): Promise<void> {
    const body = KeepAliveRequest.parse({ session_id: args.sessionId });
    await this.request(NullDataResponse, {
      method: "POST",
      path: "/v1/sessions/keep-alive",
      body,
      auth: args.sessionToken ? { bearer: args.sessionToken } : { apiKey: true },
      idempotent: true,
    });
  }

  async getSession(sessionId: string): Promise<SessionEntry | null> {
    const res = await this.request(GetSessionResponse, {
      method: "GET",
      path: `/v1/sessions/${encodeURIComponent(sessionId)}`,
      auth: { apiKey: true },
      idempotent: true,
    });
    return res.data ?? null;
  }

  // ───────────── catalogue ─────────────

  async listPublicAvatars(opts: { page?: number; pageSize?: number } = {}): Promise<AvatarSummary[]> {
    const res = await this.request(ListAvatarsResponse, {
      method: "GET",
      path: `/v1/avatars/public?${qs({ page: opts.page ?? 1, page_size: opts.pageSize ?? 100 })}`,
      auth: { apiKey: true },
      idempotent: true,
    });
    return res.data.results;
  }

  async listUserAvatars(opts: { page?: number; pageSize?: number } = {}): Promise<AvatarSummary[]> {
    const res = await this.request(ListAvatarsResponse, {
      method: "GET",
      path: `/v1/avatars?${qs({ page: opts.page ?? 1, page_size: opts.pageSize ?? 100 })}`,
      auth: { apiKey: true },
      idempotent: true,
    });
    return res.data.results;
  }

  async getAvatar(avatarId: string): Promise<AvatarSummary | null> {
    const res = await this.request(GetAvatarResponse, {
      method: "GET",
      path: `/v1/avatars/${encodeURIComponent(avatarId)}`,
      auth: { apiKey: true },
      idempotent: true,
    });
    return res.data ?? null;
  }

  async listVoices(opts: { page?: number; pageSize?: number; voiceType?: "public" | "private" } = {}): Promise<VoiceSummary[]> {
    const res = await this.request(ListVoicesResponse, {
      method: "GET",
      path: `/v1/voices?${qs({ page: opts.page ?? 1, page_size: opts.pageSize ?? 100, voice_type: opts.voiceType ?? "public" })}`,
      auth: { apiKey: true },
      idempotent: true,
    });
    return res.data.results;
  }

  // ───────────── plumbing ─────────────

  private async request<S extends z.ZodTypeAny>(schema: S, opts: RequestOptions): Promise<z.infer<S>> {
    const attempts = opts.idempotent ? this.retries + 1 : 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        const backoff = 300 * 2 ** (attempt - 1) + Math.random() * 200;
        this.log.warn(`retrying ${opts.method} ${opts.path} in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${attempts})`);
        await new Promise((r) => setTimeout(r, backoff));
      }
      try {
        return await this.once(schema, opts);
      } catch (err) {
        lastErr = err;
        const transient =
          (err instanceof LiveAvatarApiError && err.isTransient) ||
          err instanceof LiveAvatarTimeoutError ||
          (err instanceof TypeError); // fetch network failure
        if (!transient) throw err;
      }
    }
    throw lastErr;
  }

  private async once<S extends z.ZodTypeAny>(schema: S, opts: RequestOptions): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if ("bearer" in opts.auth) headers.authorization = `Bearer ${opts.auth.bearer}`;
    else headers["x-api-key"] = this.apiKey;
    if (opts.body !== undefined) headers["content-type"] = "application/json";

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${opts.path}`, {
        method: opts.method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctl.signal,
      });
    } catch (err) {
      if (ctl.signal.aborted) throw new LiveAvatarTimeoutError(`${opts.method} ${opts.path}`, this.timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) throw new LiveAvatarApiError(opts.path, res.status, text);

    let json: unknown;
    try {
      json = text.length ? JSON.parse(text) : {};
    } catch {
      throw new LiveAvatarApiError(opts.path, res.status, text, `LiveAvatar ${opts.path} returned non-JSON body`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new LiveAvatarApiError(opts.path, res.status, text, `LiveAvatar ${opts.path} response failed validation: ${parsed.error.message}`);
    }
    return parsed.data;
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.set(k, String(v));
  return u.toString();
}
