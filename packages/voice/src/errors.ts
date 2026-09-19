export class VoiceError extends Error {
  override readonly name = "VoiceError";
  constructor(readonly code: "API_ERROR" | "QUOTA" | "AUTH" | "BAD_INPUT" | "ABORTED" | "TIMEOUT", message: string, readonly status?: number, readonly body?: string) {
    super(message);
  }
  /** 401/403: bad key. */
  get isAuth() { return this.code === "AUTH"; }
  /** 402/429 quota or rate limit: fall back to fillers / tone, don't retry in a tight loop. */
  get isQuota() { return this.code === "QUOTA"; }
}
