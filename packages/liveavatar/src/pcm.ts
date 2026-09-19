/**
 * PCM helpers. LiveAvatar wants PCM 16-bit signed little-endian, 24 kHz, mono.
 * Everything here is pure, synchronous, and dependency-free so it can be unit
 * tested and reused from `packages/voice`.
 */
import { LiveAvatarAudioError } from "./errors.js";

export const LIVEAVATAR_SAMPLE_RATE = 24_000;
export const BYTES_PER_SAMPLE = 2;
export const BYTES_PER_SECOND = LIVEAVATAR_SAMPLE_RATE * BYTES_PER_SAMPLE; // 48 000

/** First chunk is short to minimise time-to-first-frame; later chunks are 1 s (matches the official SDK). */
export const FIRST_CHUNK_BYTES = Math.round(BYTES_PER_SECOND * 0.4); // 19 200
export const CHUNK_BYTES = BYTES_PER_SECOND; // 48 000
/** Documented hard ceiling per WebSocket packet (before base64). */
export const MAX_PACKET_BYTES = 1_000_000;

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  /** "s16le" (Int16) or "f32le" (Float32). */
  encoding: "s16le" | "f32le";
}

export const LIVEAVATAR_FORMAT: PcmFormat = { sampleRate: LIVEAVATAR_SAMPLE_RATE, channels: 1, encoding: "s16le" };

export function durationMs(byteLength: number): number {
  return (byteLength / BYTES_PER_SECOND) * 1000;
}

export function bytesForMs(ms: number): number {
  const bytes = Math.round((ms / 1000) * BYTES_PER_SECOND);
  return bytes - (bytes % BYTES_PER_SAMPLE);
}

// Node's Buffer, when present, is much faster than the atob/btoa loops. Typed loosely so this file compiles for the browser too.
declare const Buffer: undefined | { from(data: string | ArrayBuffer, enc?: string, off?: number, len?: number): Uint8Array & { toString(enc: string): string } };

/** Decode a base64 string to bytes (Node and browser). */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes to base64 (Node and browser). */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return (Buffer as unknown as { from(b: ArrayBufferLike, o: number, l: number): { toString(e: string): string } }).from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** View bytes as Int16 samples regardless of alignment. */
export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const even = bytes.byteLength - (bytes.byteLength % 2);
  if (bytes.byteOffset % 2 === 0) return new Int16Array(bytes.buffer, bytes.byteOffset, even / 2);
  const copy = new Uint8Array(even);
  copy.set(bytes.subarray(0, even));
  return new Int16Array(copy.buffer);
}

export function int16ToBytes(samples: Int16Array): Uint8Array {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}

export function float32ToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]!));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out;
}

/** Average interleaved channels down to mono. */
export function downmixToMono(samples: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) acc += samples[i * channels + c]!;
    out[i] = Math.round(acc / channels);
  }
  return out;
}

/**
 * Resample mono Int16 PCM with linear interpolation. Good enough for speech
 * headed into a lipsync model (no audible artefacts at 16k/22.05k/44.1k/48k →
 * 24k). If you need better, resample at the TTS provider — most can emit 24k.
 */
export function resampleLinear(samples: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  if (fromRate <= 0 || toRate <= 0) throw new LiveAvatarAudioError(`bad sample rates ${fromRate}→${toRate}`);
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(samples[i0]! * (1 - frac) + samples[i1]! * frac);
  }
  return out;
}

/** Convert arbitrary PCM to the LiveAvatar format. */
export function toLiveAvatarPcm(bytes: Uint8Array, format: PcmFormat): Uint8Array {
  let samples: Int16Array;
  if (format.encoding === "f32le") {
    const even = bytes.byteLength - (bytes.byteLength % 4);
    const f32 =
      bytes.byteOffset % 4 === 0
        ? new Float32Array(bytes.buffer, bytes.byteOffset, even / 4)
        : new Float32Array(new Uint8Array(bytes.subarray(0, even)).buffer);
    samples = float32ToInt16(f32);
  } else {
    samples = bytesToInt16(bytes);
  }
  samples = downmixToMono(samples, format.channels);
  samples = resampleLinear(samples, format.sampleRate, LIVEAVATAR_SAMPLE_RATE);
  return int16ToBytes(samples);
}

export interface WavInfo {
  format: PcmFormat;
  /** Byte offset of the PCM data. */
  dataOffset: number;
  dataLength: number;
}

/** Parse a RIFF/WAVE header. Supports PCM (1), IEEE float (3) and WAVE_FORMAT_EXTENSIBLE (0xFFFE). */
export function parseWavHeader(bytes: Uint8Array): WavInfo {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (bytes.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new LiveAvatarAudioError("not a RIFF/WAVE file");
  }
  let off = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (off + 8 <= bytes.byteLength) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      let audioFormat = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const sampleRate = dv.getUint32(body + 4, true);
      const bits = dv.getUint16(body + 14, true);
      if (audioFormat === 0xfffe && size >= 26) audioFormat = dv.getUint16(body + 24, true); // extensible: subformat GUID's first 2 bytes
      fmt = { audioFormat, channels, sampleRate, bits };
    } else if (id === "data") {
      if (!fmt) throw new LiveAvatarAudioError("WAV data chunk before fmt chunk");
      const encoding = fmt.audioFormat === 3 && fmt.bits === 32 ? "f32le" : fmt.audioFormat === 1 && fmt.bits === 16 ? "s16le" : null;
      if (!encoding) throw new LiveAvatarAudioError(`unsupported WAV format ${fmt.audioFormat} / ${fmt.bits}-bit (need 16-bit PCM or 32-bit float)`);
      const dataLength = Math.min(size, bytes.byteLength - body);
      return { format: { sampleRate: fmt.sampleRate, channels: fmt.channels, encoding }, dataOffset: body, dataLength };
    }
    off = body + size + (size % 2); // chunks are word-aligned
  }
  throw new LiveAvatarAudioError("WAV file has no data chunk");
}

/** Decode a WAV file into LiveAvatar PCM (24 kHz mono s16le). */
export function wavToLiveAvatarPcm(wav: Uint8Array): Uint8Array {
  const info = parseWavHeader(wav);
  return toLiveAvatarPcm(wav.subarray(info.dataOffset, info.dataOffset + info.dataLength), info.format);
}

/** Wrap LiveAvatar PCM in a WAV header (handy for debugging / caching fillers on disk). */
export function liveAvatarPcmToWav(pcm: Uint8Array): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  w(0, "RIFF"); dv.setUint32(4, 36 + pcm.byteLength, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, LIVEAVATAR_SAMPLE_RATE, true); dv.setUint32(28, BYTES_PER_SECOND, true);
  dv.setUint16(32, BYTES_PER_SAMPLE, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}

/** Root-mean-square level of a PCM buffer, 0..1. Used by tests and the silence watchdog. */
export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < samples.length; i++) { const v = samples[i]! / 32768; acc += v * v; }
  return Math.sqrt(acc / samples.length);
}

/**
 * Synthesise a test tone (24 kHz mono s16le). Used by the smoke script and the
 * mock TTS so we can exercise the whole pipeline with no TTS provider.
 */
export function synthTone(ms: number, opts: { hz?: number; gain?: number; fadeMs?: number } = {}): Uint8Array {
  const hz = opts.hz ?? 220;
  const gain = opts.gain ?? 0.3;
  const fade = Math.max(0, Math.min(ms / 2, opts.fadeMs ?? 20));
  const n = Math.round((ms / 1000) * LIVEAVATAR_SAMPLE_RATE);
  const out = new Int16Array(n);
  const fadeN = Math.round((fade / 1000) * LIVEAVATAR_SAMPLE_RATE);
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < fadeN) env = i / fadeN;
    else if (i > n - fadeN) env = (n - i) / fadeN;
    out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / LIVEAVATAR_SAMPLE_RATE) * gain * env * 32767);
  }
  return int16ToBytes(out);
}

/** Concatenate byte arrays. */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}
