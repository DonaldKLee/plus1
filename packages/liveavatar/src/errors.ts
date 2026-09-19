/** Errors thrown by the LiveAvatar integration. All extend LiveAvatarError so callers can catch one type. */

export class LiveAvatarError extends Error {
  override readonly name: string = "LiveAvatarError";
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

/** A REST call returned a non-2xx status or an unparseable body. */
export class LiveAvatarApiError extends LiveAvatarError {
  override readonly name = "LiveAvatarApiError";
  readonly status: number;
  readonly path: string;
  readonly body: string;
  constructor(path: string, status: number, body: string, message?: string) {
    super("API_ERROR", message ?? `LiveAvatar ${path} failed with HTTP ${status}: ${truncate(body, 300)}`);
    this.status = status;
    this.path = path;
    this.body = body;
  }
  /** 401/403 → the key is wrong or the session token is stale. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
  /** 5xx or 429 → worth a retry later. */
  get isTransient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** The server-side event socket reported `error`. */
export class LiveAvatarSocketError extends LiveAvatarError {
  override readonly name = "LiveAvatarSocketError";
  readonly errorType: string | null;
  readonly eventId: string | null;
  constructor(errorType: string | null, message: string | null, eventId: string | null) {
    super("SOCKET_ERROR", `LiveAvatar socket error${errorType ? ` [${errorType}]` : ""}: ${message ?? "no message"}`);
    this.errorType = errorType;
    this.eventId = eventId;
  }
}

/** Something took too long: connect, "connected" handshake, speak_ended, … */
export class LiveAvatarTimeoutError extends LiveAvatarError {
  override readonly name = "LiveAvatarTimeoutError";
  constructor(what: string, ms: number) {
    super("TIMEOUT", `LiveAvatar: timed out after ${ms}ms waiting for ${what}`);
  }
}

/** Called something in a state that doesn't allow it (e.g. speak() before ready). */
export class LiveAvatarStateError extends LiveAvatarError {
  override readonly name = "LiveAvatarStateError";
  constructor(message: string) {
    super("BAD_STATE", message);
  }
}

/** Audio input wasn't PCM we can use. */
export class LiveAvatarAudioError extends LiveAvatarError {
  override readonly name = "LiveAvatarAudioError";
  constructor(message: string) {
    super("BAD_AUDIO", message);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
