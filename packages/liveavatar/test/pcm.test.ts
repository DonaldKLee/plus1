import { describe, expect, it } from "vitest";
import {
  BYTES_PER_SECOND, CHUNK_BYTES, FIRST_CHUNK_BYTES, base64ToBytes, bytesForMs, bytesToBase64, bytesToInt16, concatBytes, downmixToMono, durationMs,
  float32ToInt16, int16ToBytes, liveAvatarPcmToWav, parseWavHeader, resampleLinear, rms, synthTone, toLiveAvatarPcm, wavToLiveAvatarPcm,
} from "../src/pcm.js";

describe("pcm constants", () => {
  it("matches the official SDK chunking (400 ms then 1 s at 24 kHz s16 mono)", () => {
    expect(BYTES_PER_SECOND).toBe(48_000);
    expect(FIRST_CHUNK_BYTES).toBe(19_200);
    expect(CHUNK_BYTES).toBe(48_000);
    expect(durationMs(48_000)).toBe(1000);
    expect(bytesForMs(400)).toBe(19_200);
    expect(bytesForMs(1) % 2).toBe(0);
  });
});

describe("base64", () => {
  it("round-trips including unaligned views", () => {
    const raw = new Uint8Array([9, 1, 2, 3, 4, 5, 6, 7]);
    const view = raw.subarray(1); // odd byteOffset
    const b64 = bytesToBase64(view);
    expect(Buffer.from(b64, "base64")).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7]));
    expect(Array.from(base64ToBytes(b64))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("conversion", () => {
  it("bytesToInt16 copes with odd offsets and odd lengths", () => {
    const buf = new Uint8Array([0xff, 0x01, 0x00, 0x02, 0x00, 0xaa]);
    const s = bytesToInt16(buf.subarray(1)); // 5 bytes at odd offset → 2 samples
    expect(Array.from(s)).toEqual([1, 2]);
  });
  it("float32ToInt16 clamps", () => {
    expect(Array.from(float32ToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5])))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
  it("downmixes stereo", () => {
    expect(Array.from(downmixToMono(new Int16Array([100, 300, -100, 100]), 2))).toEqual([200, 0]);
  });
  it("resamples 48k → 24k to half the samples and preserves a tone's RMS", () => {
    const n = 48_000;
    const src = new Int16Array(n);
    for (let i = 0; i < n; i++) src[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 48_000) * 10_000);
    const out = resampleLinear(src, 48_000, 24_000);
    expect(out.length).toBe(24_000);
    expect(Math.abs(rms(out) - rms(src))).toBeLessThan(0.003);
  });
  it("toLiveAvatarPcm handles 16k mono → 24k", () => {
    const src = int16ToBytes(new Int16Array(16_000)); // 1 s
    const out = toLiveAvatarPcm(src, { sampleRate: 16_000, channels: 1, encoding: "s16le" });
    expect(out.byteLength).toBe(48_000);
  });
  it("is a no-op for already-correct audio", () => {
    const tone = synthTone(100);
    expect(toLiveAvatarPcm(tone, { sampleRate: 24_000, channels: 1, encoding: "s16le" })).toEqual(tone);
  });
});

describe("wav", () => {
  it("writes and parses its own header", () => {
    const pcm = synthTone(250, { hz: 440 });
    const wav = liveAvatarPcmToWav(pcm);
    const info = parseWavHeader(wav);
    expect(info.format).toEqual({ sampleRate: 24_000, channels: 1, encoding: "s16le" });
    expect(info.dataLength).toBe(pcm.byteLength);
    expect(wavToLiveAvatarPcm(wav)).toEqual(pcm);
  });
  it("skips unknown chunks (LIST) and handles float WAV", () => {
    // Build a 44.1k stereo float WAV with a LIST chunk before data.
    const frames = 441;
    const f32 = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) { f32[i * 2] = 0.5; f32[i * 2 + 1] = -0.5; }
    const data = new Uint8Array(f32.buffer);
    const list = new Uint8Array(8 + 5); const dv0 = new DataView(list.buffer);
    list.set([0x4c, 0x49, 0x53, 0x54]); dv0.setUint32(4, 5, true); // odd size → padding byte
    const head = new Uint8Array(12 + 24);
    const dv = new DataView(head.buffer);
    head.set([0x52, 0x49, 0x46, 0x46], 0); head.set([0x57, 0x41, 0x56, 0x45], 8);
    head.set([0x66, 0x6d, 0x74, 0x20], 12); dv.setUint32(16, 16, true); dv.setUint16(20, 3, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, 44_100, true); dv.setUint32(28, 44_100 * 8, true); dv.setUint16(32, 8, true); dv.setUint16(34, 32, true);
    const dataHead = new Uint8Array(8); const dv2 = new DataView(dataHead.buffer);
    dataHead.set([0x64, 0x61, 0x74, 0x61]); dv2.setUint32(4, data.byteLength, true);
    const wav = concatBytes([head, list, new Uint8Array(1), dataHead, data]);
    const info = parseWavHeader(wav);
    expect(info.format).toEqual({ sampleRate: 44_100, channels: 2, encoding: "f32le" });
    const out = bytesToInt16(wavToLiveAvatarPcm(wav));
    expect(out.length).toBe(Math.floor(frames / (44_100 / 24_000)));
    expect(Math.abs(out[10]!)).toBeLessThan(2); // L+R cancel
  });
  it("rejects non-wav", () => {
    expect(() => parseWavHeader(new Uint8Array(20))).toThrow(/RIFF/);
  });
});

describe("synthTone", () => {
  it("produces the right length with a fade", () => {
    const t = synthTone(1000, { gain: 0.5 });
    expect(t.byteLength).toBe(48_000);
    const s = bytesToInt16(t);
    expect(s[0]).toBe(0);
    expect(rms(s)).toBeGreaterThan(0.3);
  });
});
