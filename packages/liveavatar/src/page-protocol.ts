/**
 * Contract between the Node side (`AvatarRig`) and the in-page bridge
 * (`window.__plus1Avatar`, built from `src/page`). Must compile under both
 * tsconfigs, so: types only, no runtime imports.
 */

export const PAGE_GLOBAL = "__plus1Avatar" as const;
/** Node-side callback the page reports events through (via Playwright exposeFunction). */
export const PAGE_EVENT_SINK = "__plus1AvatarEvent" as const;

/** Identity of the avatar participant in the LiveKit room (per the official SDK). */
export const AVATAR_PARTICIPANT_IDENTITY = "heygen" as const;

export interface PageMediaConfig {
  /** Canvas size = the fake camera's resolution. 1280×720 matches Meet's expectations. */
  width: number;
  height: number;
  fps: number;
  /** How the avatar video maps onto the canvas. */
  fit: "cover" | "contain";
  /** Backdrop colour used before the avatar is up and for letterboxing. */
  backdrop: string;
  /** Text shown on the placeholder frame while connecting (goose name). */
  label: string;
  /** Volume of the hidden monitor <audio> element (0 = silent locally, audio still reaches Meet). */
  monitorVolume: number;
  /** Whether to auto-install the getUserMedia override on load. */
  installFakeMedia: boolean;
}

export const DEFAULT_PAGE_MEDIA_CONFIG: PageMediaConfig = {
  width: 1280,
  height: 720,
  fps: 30,
  fit: "cover",
  backdrop: "#0b0f14",
  label: "plus1",
  monitorVolume: 0,
  installFakeMedia: true,
};

export interface PageConnectParams {
  livekitUrl: string;
  livekitToken: string;
  /** Milliseconds to wait for the avatar's tracks before giving up. */
  trackTimeoutMs?: number;
}

export type PageMediaState =
  | "idle" // nothing connected, placeholder showing
  | "connecting" // LiveKit connecting / waiting for tracks
  | "live" // avatar video + audio flowing into the canvas & mic
  | "reconnecting" // LiveKit dropped, holding last frame
  | "failed";

export type PageEvent =
  | { kind: "state"; state: PageMediaState; detail?: string }
  | { kind: "tracks"; video: boolean; audio: boolean }
  | { kind: "audioLevel"; rms: number }
  | { kind: "warning"; code: "AUDIO_SILENT" | "VIDEO_STALLED" | "GUM_NOT_INTERCEPTED" | "AUTOPLAY_BLOCKED"; message: string }
  | { kind: "error"; message: string }
  | { kind: "honk"; done: boolean }
  | { kind: "log"; level: "debug" | "info" | "warn"; message: string };

/** What the page exposes on `window.__plus1Avatar`. */
export interface PageBridgeApi {
  readonly version: string;
  configure(config: Partial<PageMediaConfig>): void;
  /** Install the getUserMedia override. Safe to call twice. Must run before Meet asks for media. */
  installFakeMedia(): { installed: boolean; reason?: string };
  connect(params: PageConnectParams): Promise<{ video: boolean; audio: boolean }>;
  disconnect(): Promise<void>;
  /** Mute/unmute the avatar's audio into the mic bus. Used for instant barge-in silence. */
  setAvatarMuted(muted: boolean): void;
  /** Play a honk into the mic bus (synthesised unless a URL was configured). */
  honk(opts?: { durationMs?: number; duck?: boolean }): Promise<void>;
  /** Play arbitrary PCM 24 kHz mono s16le (base64) straight into the mic bus, bypassing the avatar. */
  playPcm(base64: string, opts?: { duck?: boolean }): Promise<void>;
  getState(): { state: PageMediaState; video: boolean; audio: boolean; muted: boolean; fakeMediaInstalled: boolean };
  /** Data-URL PNG of the current canvas (for debugging via the console). */
  snapshot(): string;
}
