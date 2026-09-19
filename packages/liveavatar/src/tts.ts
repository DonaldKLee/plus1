/**
 * The seam between plus1's voice layer and the avatar. `packages/voice` should
 * implement `TextToSpeech`; the avatar only ever sees 24 kHz mono s16le PCM.
 */
import { LiveAvatarAudioError } from "./errors.js";
import { LIVEAVATAR_SAMPLE_RATE, synthTone, toLiveAvatarPcm, wavToLiveAvatarPcm, type PcmFormat } from "./pcm.js";

export interface TextToSpeech {
  /**
   * Synthesise `text` as a stream of PCM chunks, 24 kHz mono s16le.
   * Chunks may be any size; the speaker re-chunks for the wire.
   * Honour `signal` — barge-in aborts synthesis mid-stream.
   */
  synthesize(text: string, opts: { signal: AbortSignal }): AsyncIterable<Uint8Array>;
}

/**
 * Stand-in TTS that produces a tone whose length tracks the text. Lets the whole
 * pipeline (brain → rig → LiveAvatar → LiveKit → Meet) run with no TTS key.
 */
export class ToneTts implements TextToSpeech {
  constructor(private readonly opts: { msPerWord?: number; hz?: number; chunkMs?: number } = {}) {}
  async *synthesize(text: string, { signal }: { signal: AbortSignal }): AsyncIterable<Uint8Array> {
    const words = Math.max(1, text.trim().split(/\s+/).length);
    const total = words * (this.opts.msPerWord ?? 320);
    const chunkMs = this.opts.chunkMs ?? 250;
    for (let t = 0; t < total && !signal.aborted; t += chunkMs) {
      yield synthTone(Math.min(chunkMs, total - t), { hz: this.opts.hz ?? 180 + (words % 5) * 20, fadeMs: 5 });
      await new Promise((r) => setTimeout(r, chunkMs / 4)); // faster than real time, like a real TTS
    }
  }
}

/** Parse a `Content-Type` into a PCM format if it describes raw PCM we can use. */
export function pcmFormatFromContentType(ct: string | null): PcmFormat | null {
  if (!ct) return null;
  const [mime, ...params] = ct.toLowerCase().split(";").map((s) => s.trim());
  const p = Object.fromEntries(params.map((kv) => kv.split("=").map((s) => s.trim()) as [string, string]));
  const rate = Number(p.rate ?? p["sample-rate"] ?? p.sample_rate ?? LIVEAVATAR_SAMPLE_RATE);
  const channels = Number(p.channels ?? 1);
  if (mime === "audio/l16" || mime === "audio/pcm" || mime === "audio/x-pcm" || mime === "audio/raw") {
    return { sampleRate: rate, channels, encoding: "s16le" };
  }
  if (mime === "audio/f32le" || mime === "audio/x-f32le") return { sampleRate: rate, channels, encoding: "f32le" };
  return null;
}

/**
 * Fetch an audio URL (the HLD's `agent.speak.audioUrl`) as LiveAvatar PCM.
 * Accepts WAV (any rate/channels, 16-bit or float) or raw PCM with a
 * descriptive content-type. Rejects compressed formats with a clear message —
 * decode those upstream, or better, have TTS emit `pcm_24000` directly.
 */
export async function fetchAudioAsPcm(url: string, opts: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<Uint8Array> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const res = await f(url, { signal: opts.signal });
  if (!res.ok) throw new LiveAvatarAudioError(`fetching ${url} failed with HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ct = res.headers.get("content-type");
  const looksWav = bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  if (looksWav) return wavToLiveAvatarPcm(bytes);
  const fmt = pcmFormatFromContentType(ct);
  if (fmt) return toLiveAvatarPcm(bytes, fmt);
  throw new LiveAvatarAudioError(
    `cannot use audio from ${url} (content-type ${ct ?? "unknown"}); need WAV or raw PCM (audio/L16;rate=24000). Compressed formats must be decoded upstream.`,
  );
}
