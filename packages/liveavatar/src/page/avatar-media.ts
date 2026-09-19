/**
 * Joins the LiveAvatar-provisioned LiveKit room as the "client" participant and
 * hands the avatar's tracks to the painter (video) and mixer (audio).
 */
import { ConnectionState, RemoteParticipant, Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { AVATAR_PARTICIPANT_IDENTITY, type PageConnectParams, type PageMediaState } from "../page-protocol.js";
import { log, report } from "./events.js";
import type { Mixer } from "./mixer.js";
import type { Painter } from "./painter.js";

/** play() rejections caused by our own teardown (AbortError) are noise; anything else is a real autoplay problem. */
export function reportPlayFailure(what: string, err: unknown): void {
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError") { log.debug(`${what} play() aborted by teardown`); return; }
  report({ kind: "warning", code: "AUTOPLAY_BLOCKED", message: `${what} play() rejected: ${String(err)}` });
}

/** If nobody named "heygen" shows up in this long, accept the first participant that publishes video. */
const IDENTITY_FALLBACK_MS = 6_000;

export class AvatarMedia {
  private room: Room | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private videoTrack: RemoteTrack | null = null;
  private audioTrack: RemoteTrack | null = null;
  private _state: PageMediaState = "idle";
  private connectedAt = 0;
  /** Track sids already wired, so a TrackSubscribed event racing our initial publication sweep doesn't double-attach. */
  private readonly seen = new Set<string>();

  constructor(private readonly painter: Painter, private readonly mixer: Mixer) {}

  get state(): PageMediaState { return this._state; }
  get hasVideo(): boolean { return !!this.videoTrack; }
  get hasAudio(): boolean { return !!this.audioTrack; }

  async connect(params: PageConnectParams): Promise<{ video: boolean; audio: boolean }> {
    await this.disconnect(true);
    this.seen.clear();
    this.setState("connecting", "livekit");
    const room = new Room({
      adaptiveStream: false, // we always want the full frame; there's no layout to adapt to
      dynacast: false,
      disconnectOnPageLeave: true,
    });
    this.room = room;
    this.connectedAt = performance.now();

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => this.onTrack(track, participant));
    room.on(RoomEvent.TrackUnsubscribed, (track) => this.onTrackGone(track));
    room.on(RoomEvent.ParticipantConnected, (p) => log.debug(`participant joined: ${p.identity}`));
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      log.warn(`participant left: ${p.identity}`);
      if (this.isAvatar(p)) this.setState("reconnecting", "avatar participant left");
    });
    room.on(RoomEvent.Reconnecting, () => this.setState("reconnecting", "livekit reconnecting"));
    room.on(RoomEvent.Reconnected, () => { if (this.videoTrack && this.audioTrack) this.setState("live", "livekit reconnected"); });
    room.on(RoomEvent.Disconnected, (reason) => {
      if (this.room !== room) return;
      log.warn(`livekit disconnected: ${String(reason)}`);
      this.painter.detach(true); // hold the last frame; Node will bring a new session
      this.mixer.detachAvatarTrack();
      this.videoTrack = this.audioTrack = null;
      this.setState("failed", `livekit disconnected: ${String(reason)}`);
    });
    room.on(RoomEvent.MediaDevicesError, (e) => report({ kind: "error", message: `media devices error: ${e.message}` }));

    try {
      await room.connect(params.livekitUrl, params.livekitToken, { autoSubscribe: true });
    } catch (err) {
      this.setState("failed", `connect failed: ${(err as Error).message}`);
      throw err;
    }
    log.info(`joined livekit room ${room.name} as ${room.localParticipant.identity}; remotes=${[...room.remoteParticipants.values()].map((p) => p.identity).join(",") || "none"}`);

    // Tracks may already be published if the avatar beat us into the room.
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.track && pub.isSubscribed) this.onTrack(pub.track, p);
      }
    }

    const timeoutMs = params.trackTimeoutMs ?? 30_000;
    await this.waitForTracks(timeoutMs);
    const result = { video: this.hasVideo, audio: this.hasAudio };
    if (result.video && result.audio) this.setState("live");
    else this.setState(result.video || result.audio ? "live" : "failed", `tracks video=${result.video} audio=${result.audio}`);
    return result;
  }

  async disconnect(holdFrame = false): Promise<void> {
    const room = this.room;
    this.room = null;
    this.videoTrack = this.audioTrack = null;
    this.mixer.detachAvatarTrack();
    this.painter.detach(holdFrame);
    if (this.videoEl) { this.videoEl.pause(); this.videoEl.srcObject = null; this.videoEl.remove(); this.videoEl = null; }
    if (room) {
      room.removeAllListeners();
      if (room.state !== ConnectionState.Disconnected) await room.disconnect(true).catch(() => {});
    }
    if (!holdFrame) this.setState("idle");
  }

  private isAvatar(p: RemoteParticipant): boolean {
    if (p.identity === AVATAR_PARTICIPANT_IDENTITY) return true;
    // Fallback: after a grace period, any remote that publishes video is our avatar (there's only ever one).
    return performance.now() - this.connectedAt > IDENTITY_FALLBACK_MS && [...p.trackPublications.values()].some((t) => t.kind === Track.Kind.Video);
  }

  private onTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    const sid = track.sid ?? `${participant.identity}:${track.kind}`;
    if (this.seen.has(sid)) return;
    if (participant.identity !== AVATAR_PARTICIPANT_IDENTITY) {
      log.debug(`track from ${participant.identity} (${track.kind}); avatar identity is "${AVATAR_PARTICIPANT_IDENTITY}"`);
      if (!this.isAvatar(participant)) return;
    }
    this.seen.add(sid);
    if (track.kind === Track.Kind.Video) {
      const el = document.createElement("video");
      el.muted = true; el.autoplay = true; el.playsInline = true;
      el.dataset.plus1Avatar = "1"; // lets the room audio tap skip the plus1's own playback
      el.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px";
      track.attach(el);
      document.documentElement.appendChild(el);
      el.play().catch((err) => reportPlayFailure("video", err));
      if (this.videoEl) { this.videoEl.remove(); }
      this.videoEl = el;
      this.videoTrack = track;
      this.painter.attach(el);
      log.info(`avatar video subscribed (${track.sid})`);
    } else if (track.kind === Track.Kind.Audio) {
      this.audioTrack = track;
      this.mixer.attachAvatarTrack(track.mediaStreamTrack);
      log.info(`avatar audio subscribed (${track.sid})`);
    }
    report({ kind: "tracks", video: this.hasVideo, audio: this.hasAudio });
    if (this.hasVideo && this.hasAudio && this._state === "connecting") this.setState("live");
  }

  private onTrackGone(track: RemoteTrack): void {
    if (track.sid) this.seen.delete(track.sid);
    if (track === this.videoTrack) { this.videoTrack = null; this.painter.detach(true); }
    if (track === this.audioTrack) { this.audioTrack = null; this.mixer.detachAvatarTrack(); }
    report({ kind: "tracks", video: this.hasVideo, audio: this.hasAudio });
  }

  private waitForTracks(timeoutMs: number): Promise<void> {
    if (this.hasVideo && this.hasAudio) return Promise.resolve();
    return new Promise((resolve) => {
      const started = performance.now();
      const t = setInterval(() => {
        if ((this.hasVideo && this.hasAudio) || performance.now() - started > timeoutMs || !this.room) { clearInterval(t); resolve(); }
      }, 100);
    });
  }

  private setState(state: PageMediaState, detail?: string): void {
    if (this._state === state && !detail) return;
    this._state = state;
    report({ kind: "state", state, detail });
  }
}
