/**
 * zod schemas for the LiveAvatar wire surface (REST + LITE-mode WebSocket).
 *
 * These describe HeyGen's API, not plus1's own cross-process protocol; the
 * plus1 messages (agent.speak, agent.honk, …) live in `packages/protocol`.
 *
 * Response schemas are deliberately loose (`.loose()`) so that new fields the
 * API adds never break us. Request schemas are strict so we never send junk.
 *
 * Sources: https://docs.liveavatar.com/llms.txt (api-reference/sessions/*,
 * docs/lite-mode/events) plus the official web SDK and the pipecat client.
 */
import { z } from "zod";

// ───────────────────────────── shared enums ─────────────────────────────

export const VideoQuality = z.enum(["low", "medium", "high", "very_high"]);
export type VideoQuality = z.infer<typeof VideoQuality>;

/** VP8 is deprecated upstream; H264 is the default and what we send. */
export const VideoEncoding = z.enum(["H264", "VP8"]);
export type VideoEncoding = z.infer<typeof VideoEncoding>;

export const SessionStopReason = z.enum([
  "UNKNOWN",
  "USER_DISCONNECTED",
  "SERVER_ERROR",
  "IDLE_TIMEOUT",
  "NO_CREDITS",
  "USER_CLOSED",
  "AVATAR_DELETED",
  "MAX_DURATION_REACHED",
  "ZOMBIE_SESSION_REAP",
  "AGENT_HANG_UP",
  "DISPATCH_FAILED",
]);
export type SessionStopReason = z.infer<typeof SessionStopReason>;

// ───────────────────────────── REST requests ─────────────────────────────

export const VideoSettings = z
  .object({
    quality: VideoQuality.optional(),
    encoding: VideoEncoding.optional(),
  })
  .strict();
export type VideoSettings = z.infer<typeof VideoSettings>;

/** Bring-your-own LiveKit room (integration path 5). We don't use this by default. */
export const LiveKitConfig = z
  .object({
    livekit_url: z.string().min(1),
    livekit_room: z.string().min(1),
    livekit_client_token: z.string().min(1),
  })
  .strict();
export type LiveKitConfig = z.infer<typeof LiveKitConfig>;

/**
 * POST /v1/sessions/token body for LITE mode. LITE = LiveAvatar renders video
 * from audio we send; no STT/LLM/TTS on their side. This is the only mode
 * plus1 uses, because the brain must stay ours.
 */
export const LiteSessionTokenRequest = z
  .object({
    mode: z.literal("LITE"),
    avatar_id: z.string().min(1),
    is_sandbox: z.boolean().optional(),
    video_settings: VideoSettings.optional(),
    /** Seconds. Ceiling comes from the subscription tier. */
    max_session_duration: z.number().int().positive().optional(),
    livekit_config: LiveKitConfig.optional(),
  })
  .strict();
export type LiteSessionTokenRequest = z.infer<typeof LiteSessionTokenRequest>;

export const StopSessionRequest = z
  .object({
    session_id: z.string().min(1),
    reason: SessionStopReason.optional(),
  })
  .strict();
export type StopSessionRequest = z.infer<typeof StopSessionRequest>;

export const KeepAliveRequest = z.object({ session_id: z.string().min(1) }).strict();

// ───────────────────────────── REST responses ─────────────────────────────

/** Every LiveAvatar response is `{ code, message, data }`. */
export function apiEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z
    .object({
      code: z.number().optional(),
      message: z.string().nullable().optional(),
      data,
    })
    .loose();
}

export const SessionTokenData = z
  .object({
    session_id: z.string().min(1),
    session_token: z.string().min(1),
  })
  .loose();
export type SessionTokenData = z.infer<typeof SessionTokenData>;
export const SessionTokenResponse = apiEnvelope(SessionTokenData);

export const StartSessionData = z
  .object({
    session_id: z.string().min(1),
    livekit_url: z.string().min(1),
    livekit_client_token: z.string().min(1),
    livekit_agent_token: z.string().nullable().optional(),
    max_session_duration: z.number().nullable().optional(),
    /** WebSocket URL for LITE-mode commands. Present in LITE mode. */
    ws_url: z.string().nullable().optional(),
  })
  .loose();
export type StartSessionData = z.infer<typeof StartSessionData>;
export const StartSessionResponse = apiEnvelope(StartSessionData);

export const NullDataResponse = apiEnvelope(z.unknown().nullable().optional());

export const SessionEntry = z
  .object({
    id: z.string(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    duration: z.number().nullable().optional(),
    source: z.string().nullable().optional(),
    mode: z.string().nullable().optional(),
    is_sandbox: z.boolean().nullable().optional(),
    credits_consumed: z.number().nullable().optional(),
    end_at: z.string().nullable().optional(),
    end_reason: z.string().nullable().optional(),
  })
  .loose();
export type SessionEntry = z.infer<typeof SessionEntry>;
export const GetSessionResponse = apiEnvelope(SessionEntry.nullable());

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      count: z.number().optional(),
      next: z.string().nullable().optional(),
      previous: z.string().nullable().optional(),
      results: z.array(item),
    })
    .loose();

export const AvatarSummary = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    type: z.string().nullable().optional(), // IMAGE | VIDEO
    status: z.string().nullable().optional(), // ACTIVE | INIT | DEPLOYING | FAILED | …
    preview_url: z.string().nullable().optional(),
    default_voice: z
      .object({ id: z.string().nullable().optional(), name: z.string().nullable().optional() })
      .loose()
      .nullable()
      .optional(),
    is_1080p: z.boolean().nullable().optional(),
  })
  .loose();
export type AvatarSummary = z.infer<typeof AvatarSummary>;
export const ListAvatarsResponse = apiEnvelope(Paginated(AvatarSummary));
export const GetAvatarResponse = apiEnvelope(AvatarSummary.nullable());

export const VoiceSummary = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
  })
  .loose();
export type VoiceSummary = z.infer<typeof VoiceSummary>;
export const ListVoicesResponse = apiEnvelope(Paginated(VoiceSummary));

// ───────────────────────── LITE-mode WebSocket: commands ─────────────────────────
// Client → server. Audio is PCM 16-bit signed little-endian, 24 kHz, mono, base64.

export const SpeakCommand = z
  .object({
    type: z.literal("agent.speak"),
    event_id: z.string().min(1),
    audio: z.string().min(1),
  })
  .strict();

export const SpeakEndCommand = z
  .object({
    type: z.literal("agent.speak_end"),
    event_id: z.string().min(1),
    audio: z.string().optional(),
  })
  .strict();

export const InterruptCommand = z
  .object({ type: z.literal("agent.interrupt"), event_id: z.string().min(1) })
  .strict();

export const StartListeningCommand = z
  .object({ type: z.literal("agent.start_listening"), event_id: z.string().min(1) })
  .strict();

export const StopListeningCommand = z
  .object({ type: z.literal("agent.stop_listening"), event_id: z.string().min(1) })
  .strict();

export const KeepAliveCommand = z
  .object({ type: z.literal("session.keep_alive"), event_id: z.string().min(1) })
  .strict();

export const ClientCommand = z.discriminatedUnion("type", [
  SpeakCommand,
  SpeakEndCommand,
  InterruptCommand,
  StartListeningCommand,
  StopListeningCommand,
  KeepAliveCommand,
]);
export type ClientCommand = z.infer<typeof ClientCommand>;

// ───────────────────────── LITE-mode WebSocket: server events ─────────────────────────

const eventBase = {
  event_id: z.string().nullable().optional(),
  source_event_id: z.string().nullable().optional(),
};

export const SessionConnectionState = z.enum(["new", "connected", "disconnected"]);
export type SessionConnectionState = z.infer<typeof SessionConnectionState>;

export const AvatarState = z.enum(["idle", "listening", "talking"]);
export type AvatarState = z.infer<typeof AvatarState>;

/** Accept the documented enum but never choke on a value we haven't seen. */
const tolerant = <T extends z.ZodEnum<any>>(e: T) => z.union([e, z.string()]);

export const SessionStateUpdatedEvent = z
  .object({ type: z.literal("session.state_updated"), state: tolerant(SessionConnectionState), ...eventBase })
  .loose();

export const AgentStateUpdatedEvent = z
  .object({
    type: z.literal("agent.state_updated"),
    previous_state: tolerant(AvatarState).nullable().optional(),
    new_state: tolerant(AvatarState),
    ...eventBase,
  })
  .loose();

const bare = <T extends string>(t: T) => z.object({ type: z.literal(t), ...eventBase }).loose();

export const SpeakStartedEvent = bare("agent.speak_started");
export const SpeakEndedEvent = bare("agent.speak_ended");
export const SpeakInterruptedEvent = bare("agent.speak_interrupted");
export const AudioBufferAppendedEvent = bare("agent.audio_buffer_appended");
export const AudioBufferCommittedEvent = bare("agent.audio_buffer_committed");
export const AudioBufferClearedEvent = bare("agent.audio_buffer_cleared");

export const ErrorEvent = z
  .object({
    type: z.literal("error"),
    error: z
      .object({
        type: z.string().nullable().optional(), // invalid_request_error | server_error | video_starvation
        message: z.string().nullable().optional(),
        event_id: z.string().nullable().optional(),
      })
      .loose(),
    ...eventBase,
  })
  .loose();

export const WarningEvent = z
  .object({
    type: z.literal("warning"),
    warning: z
      .object({ type: z.string().nullable().optional(), message: z.string().nullable().optional() })
      .loose(),
    ...eventBase,
  })
  .loose();

export const KnownServerEvent = z.discriminatedUnion("type", [
  SessionStateUpdatedEvent,
  AgentStateUpdatedEvent,
  SpeakStartedEvent,
  SpeakEndedEvent,
  SpeakInterruptedEvent,
  AudioBufferAppendedEvent,
  AudioBufferCommittedEvent,
  AudioBufferClearedEvent,
  ErrorEvent,
  WarningEvent,
]);
export type KnownServerEvent = z.infer<typeof KnownServerEvent>;

export type UnknownServerEvent = {
  type: "unknown";
  rawType: string | null;
  raw: unknown;
  event_id?: string | null;
  source_event_id?: string | null;
};

export type ServerEvent = KnownServerEvent | UnknownServerEvent;

/**
 * Parse a raw WebSocket frame into a server event. Never throws on unfamiliar
 * event types (they come back as `{type:"unknown"}`); only throws if the frame
 * isn't JSON at all.
 */
export function parseServerEvent(raw: string | Uint8Array): ServerEvent {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  const json: unknown = JSON.parse(text);
  const known = KnownServerEvent.safeParse(json);
  if (known.success) return known.data;
  const obj = (json ?? {}) as Record<string, unknown>;
  return {
    type: "unknown",
    rawType: typeof obj.type === "string" ? obj.type : null,
    raw: json,
    event_id: typeof obj.event_id === "string" ? obj.event_id : null,
    source_event_id: typeof obj.source_event_id === "string" ? obj.source_event_id : null,
  };
}
