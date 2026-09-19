import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bytesToInt16, rms } from "@plus1/liveavatar";
import { ElevenLabsTts, normalizeText } from "../src/elevenlabs.js";
import { VoiceError } from "../src/errors.js";
import { MockElevenLabs } from "./mock-elevenlabs.js";

let mock: MockElevenLabs;
beforeEach(async () => { mock = new MockElevenLabs(); await mock.start(); });
afterEach(() => mock.stop());
const make = (o: Partial<ConstructorParameters<typeof ElevenLabsTts>[0]> = {}) => new ElevenLabsTts({ apiKey: "el-key", baseUrl: mock.baseUrl, ...o });

describe("ElevenLabsTts", () => {
  it("requests pcm_24000 on the stream endpoint with the goose voice settings and streams aligned chunks", async () => {
    const tts = make({ voiceId: "v1" });
    const chunks: Uint8Array[] = [];
    for await (const c of tts.synthesize("hey, what are we working on today?", { signal: new AbortController().signal })) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length % 2 === 0)).toBe(true);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    expect(total).toBe(34 * 60 * 48); // chars x ms x bytes/ms
    const req = mock.requests[0]!;
    expect(req.path).toBe("/v1/text-to-speech/v1/stream?output_format=pcm_24000");
    expect(req.headers["xi-api-key"]).toBe("el-key");
    expect(req.body).toMatchObject({ text: "hey, what are we working on today?", model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.55, speed: 1.04 } });
    expect(tts.charsUsed).toBe(34);
  });

  it("re-aligns odd-sized network chunks so samples are never torn", async () => {
    mock.oddChunks = true;
    const pcm = await make().synthesizeAll("twelve chars");
    expect(pcm.length % 2).toBe(0);
    const s = bytesToInt16(pcm);
    expect(rms(s)).toBeGreaterThan(0.1);
    let jumps = 0; for (let i = 1; i < s.length; i++) if (Math.abs(s[i]! - s[i - 1]!) > 6000) jumps++;
    expect(jumps).toBe(0); // a torn stream would be full of discontinuities
  });

  it("abort mid-stream stops quietly (barge-in)", async () => {
    mock.chunkDelayMs = 40;
    const ctl = new AbortController();
    let got = 0;
    for await (const c of make().synthesize("a fairly long sentence that takes a while to stream out completely", { signal: ctl.signal })) { got += c.length; if (got > 4800) ctl.abort(); }
    expect(got).toBeLessThan(65 * 60 * 48);
  });

  it("abort before the request produces nothing and makes no call", async () => {
    const ctl = new AbortController(); ctl.abort();
    const out = await make().synthesizeAll("hi", ctl.signal);
    expect(out.length).toBe(0);
    expect(mock.requests.length).toBe(0);
  });

  it("maps 401 -> AUTH and 402/429 -> QUOTA", async () => {
    const bad = new ElevenLabsTts({ apiKey: "wrong", baseUrl: mock.baseUrl });
    const e1 = await bad.synthesizeAll("x").catch((e) => e);
    expect(e1).toBeInstanceOf(VoiceError); expect(e1.code).toBe("AUTH"); expect(e1.status).toBe(401);
    mock.status = 429;
    const e2 = await make().synthesizeAll("x").catch((e) => e);
    expect(e2.code).toBe("QUOTA"); expect(e2.isQuota).toBe(true);
  });

  it("times out when no audio arrives", async () => {
    mock.stallFirstByteMs = 500;
    const e = await make({ firstByteTimeoutMs: 100 }).synthesizeAll("x").catch((e) => e);
    expect(e).toBeInstanceOf(VoiceError); expect(e.code).toBe("TIMEOUT");
  });

  it("skips empty text and lists voices", async () => {
    expect((await make().synthesizeAll("   ")).length).toBe(0);
    expect(mock.requests.length).toBe(0);
    const voices = await make().listVoices();
    expect(voices[0]).toMatchObject({ voice_id: "v1", name: "Daniel" });
  });
});

describe("normalizeText", () => {
  it("strips markdown, code and urls; collapses whitespace", () => {
    expect(normalizeText("  **on it**, see https://docs.google.com/x  \n\n`now`")).toBe("on it, see the link now");
    expect(normalizeText("```json\n{}\n``` done")).toBe("done");
  });
});
