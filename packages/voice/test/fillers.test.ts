import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { synthTone, type TextToSpeech } from "@plus1/liveavatar";
import { FillerCache } from "../src/fillers.js";

class CountingTts implements TextToSpeech {
  calls: string[] = [];
  async *synthesize(text: string) { this.calls.push(text); yield synthTone(120); }
}

const dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const only = (ack: string[], checking: string[] = []) => ({
  ack,
  checking,
  wait: [],
  unsure: [],
  thinking: [],
  loading: [],
});

describe("FillerCache", () => {
  it("synthesises once, persists WAVs, and reloads from disk with a voice-scoped key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fillers-")); dirs.push(dir);
    const tts = new CountingTts();
    const a = new FillerCache({ tts, dir, voiceKey: "daniel", phrases: only(["on it."], ["one sec."]) });
    expect(await a.warm()).toEqual({ loaded: 0, synthesized: 2 });
    expect(readdirSync(dir).filter((f) => f.endsWith(".wav"))).toHaveLength(2);

    const b = new FillerCache({ tts, dir, voiceKey: "daniel", phrases: only(["on it."], ["one sec."]) });
    expect(await b.warm()).toEqual({ loaded: 2, synthesized: 0 });
    expect(b.get("on it.")!.length).toBe(synthTone(120).length);

    const c = new FillerCache({ tts, dir, voiceKey: "george", phrases: only(["on it."]) });
    expect((await c.warm()).synthesized).toBe(1); // different voice -> different key
    expect(tts.calls).toHaveLength(3);
  });

  it("rotates picks and returns undefined for empty kinds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fillers-")); dirs.push(dir);
    const f = new FillerCache({ tts: new CountingTts(), dir, voiceKey: "v", phrases: only(["a", "b"]) });
    await f.warm();
    expect([f.pick("ack")!.phrase, f.pick("ack")!.phrase, f.pick("ack")!.phrase]).toEqual(["a", "b", "a"]);
    expect(f.pick("checking")).toBeUndefined();
  });
});
