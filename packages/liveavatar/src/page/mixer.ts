/**
 * The mic bus. Avatar audio → avatarGain → dest. SFX (honk, PCM) → sfxGain → dest.
 * Also owns the Chrome workaround: a remote WebRTC audio track is silent to
 * WebAudio unless it is also being played by a media element, so we keep a
 * hidden <audio> attached (volume configurable, 0 by default).
 */
import { bytesToInt16 } from "../pcm.js";
import type { MediaBus } from "./fake-media.js";
import { report } from "./events.js";
import { reportPlayFailure } from "./avatar-media.js";

const RAMP_S = 0.012;

export class Mixer {
  private readonly avatarGain: GainNode;
  private readonly sfxGain: GainNode;
  private readonly analyser: AnalyserNode;
  private avatarSource: MediaStreamAudioSourceNode | null = null;
  private monitor: HTMLAudioElement | null = null;
  private muted = false;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private duckDepth = 0;
  private lastNonSilentAt = 0;
  private silenceWarned = false;
  private readonly levelBuf: Float32Array<ArrayBuffer>;

  constructor(private readonly bus: MediaBus, private monitorVolume: number) {
    const { ctx, dest } = bus;
    this.avatarGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.levelBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.avatarGain.connect(this.analyser);
    this.analyser.connect(dest);
    this.sfxGain.connect(dest);
  }

  get isMuted(): boolean { return this.muted; }

  setMonitorVolume(v: number): void {
    this.monitorVolume = v;
    if (this.monitor) this.monitor.volume = Math.max(0, Math.min(1, v));
  }

  attachAvatarTrack(track: MediaStreamTrack): void {
    this.detachAvatarTrack();
    const stream = new MediaStream([track]);
    this.avatarSource = this.bus.ctx.createMediaStreamSource(stream);
    this.avatarSource.connect(this.avatarGain);

    const el = document.createElement("audio");
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    el.style.display = "none";
    el.dataset.plus1Avatar = "1"; // lets the room audio tap skip the goose's own playback
    el.volume = Math.max(0, Math.min(1, this.monitorVolume));
    el.srcObject = stream;
    document.documentElement.appendChild(el);
    el.play().catch((err) => reportPlayFailure("monitor element", err));
    this.monitor = el;

    this.lastNonSilentAt = performance.now();
    this.silenceWarned = false;
    this.startLevelMeter();
  }

  detachAvatarTrack(): void {
    this.stopLevelMeter();
    if (this.avatarSource) { try { this.avatarSource.disconnect(); } catch {} this.avatarSource = null; }
    if (this.monitor) { this.monitor.pause(); this.monitor.srcObject = null; this.monitor.remove(); this.monitor = null; }
  }

  /** Instant-ish mute with a tiny ramp to avoid a click. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyAvatarGain();
  }

  private applyAvatarGain(): void {
    const target = this.muted ? 0 : 1 - this.duckDepth * 0.8;
    const now = this.bus.ctx.currentTime;
    this.avatarGain.gain.cancelScheduledValues(now);
    this.avatarGain.gain.setTargetAtTime(target, now, RAMP_S);
  }

  /** Lower the avatar under an SFX, then restore. */
  private duck(durationMs: number): void {
    this.duckDepth = 1;
    this.applyAvatarGain();
    setTimeout(() => { this.duckDepth = 0; this.applyAvatarGain(); }, durationMs);
  }

  /** Play PCM 24 kHz mono s16le into the mic bus. Resolves when playback ends. */
  async playPcm(pcm: Uint8Array, opts: { duck?: boolean } = {}): Promise<void> {
    const samples = bytesToInt16(pcm);
    if (samples.length === 0) return;
    const ctx = this.bus.ctx;
    const buf = ctx.createBuffer(1, samples.length, 24_000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i]! / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.sfxGain);
    if (opts.duck ?? true) this.duck(buf.duration * 1000);
    await this.playSource(src);
  }

  /**
   * A goose honk, synthesised: a sawtooth with a falling pitch, pushed through
   * a nasal bandpass, with a fast tremolo and a hard stop. Roughly 650 ms.
   */
  async honk(opts: { durationMs?: number; duck?: boolean } = {}): Promise<void> {
    const ctx = this.bus.ctx;
    const dur = Math.max(150, opts.durationMs ?? 650) / 1000;
    const t0 = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(330, t0);
    osc.frequency.exponentialRampToValueAtTime(240, t0 + dur * 0.7);
    osc.frequency.exponentialRampToValueAtTime(200, t0 + dur);
    const osc2 = ctx.createOscillator(); // rough second voice a fifth down for body
    osc2.type = "square";
    osc2.frequency.setValueAtTime(165, t0);
    osc2.frequency.exponentialRampToValueAtTime(120, t0 + dur);
    const nasal = ctx.createBiquadFilter();
    nasal.type = "bandpass"; nasal.frequency.value = 900; nasal.Q.value = 2.2;
    const body = ctx.createBiquadFilter();
    body.type = "lowpass"; body.frequency.value = 2600;
    const trem = ctx.createOscillator(); trem.frequency.value = 28;
    const tremDepth = ctx.createGain(); tremDepth.gain.value = 0.35;
    const vca = ctx.createGain();
    vca.gain.setValueAtTime(0, t0);
    vca.gain.linearRampToValueAtTime(0.8, t0 + 0.03);
    vca.gain.setValueAtTime(0.8, t0 + dur - 0.06);
    vca.gain.linearRampToValueAtTime(0, t0 + dur);
    const mix2 = ctx.createGain(); mix2.gain.value = 0.35;
    osc.connect(nasal); osc2.connect(mix2); mix2.connect(nasal);
    nasal.connect(body); body.connect(vca); vca.connect(this.sfxGain);
    trem.connect(tremDepth); tremDepth.connect(vca.gain);
    if (opts.duck ?? true) this.duck(dur * 1000);
    report({ kind: "honk", done: false });
    osc.start(t0); osc2.start(t0); trem.start(t0);
    osc.stop(t0 + dur + 0.02); osc2.stop(t0 + dur + 0.02); trem.stop(t0 + dur + 0.02);
    await new Promise<void>((resolve) => { osc.onended = () => resolve(); });
    for (const n of [osc, osc2, trem, nasal, body, vca, mix2, tremDepth]) { try { n.disconnect(); } catch {} }
    report({ kind: "honk", done: true });
  }

  private playSource(src: AudioBufferSourceNode): Promise<void> {
    return new Promise((resolve) => { src.onended = () => { try { src.disconnect(); } catch {} resolve(); }; src.start(); });
  }

  /** Report avatar RMS ~5×/s and warn if the track is attached but silent for a long stretch. */
  private startLevelMeter(): void {
    this.stopLevelMeter();
    this.levelTimer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(this.levelBuf);
      let acc = 0;
      for (let i = 0; i < this.levelBuf.length; i++) acc += this.levelBuf[i]! * this.levelBuf[i]!;
      const rms = Math.sqrt(acc / this.levelBuf.length);
      report({ kind: "audioLevel", rms });
      if (rms > 0.004) { this.lastNonSilentAt = performance.now(); if (this.silenceWarned) { this.silenceWarned = false; report({ kind: "log", level: "info", message: "avatar audio flowing again" }); } }
    }, 200);
  }

  /** Called by the bridge while the avatar is supposed to be talking. */
  checkSilence(talking: boolean): void {
    if (!talking || this.muted || !this.avatarSource) return;
    if (performance.now() - this.lastNonSilentAt > 2_500 && !this.silenceWarned) {
      this.silenceWarned = true;
      report({ kind: "warning", code: "AUDIO_SILENT", message: "avatar reports talking but no audio reached the mic bus for 2.5s (remote track not feeding WebAudio?)" });
      // Self-heal attempt: kick the monitor element, which is what keeps Chrome delivering remote audio to WebAudio.
      if (this.monitor) { this.monitor.volume = Math.max(this.monitor.volume, 0.01); void this.monitor.play().catch(() => {}); }
    }
  }

  private stopLevelMeter(): void {
    if (this.levelTimer) { clearInterval(this.levelTimer); this.levelTimer = null; }
  }
}
