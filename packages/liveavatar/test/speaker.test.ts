import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../src/logger.js";
import { CHUNK_BYTES, FIRST_CHUNK_BYTES, synthTone } from "../src/pcm.js";
import { LiveAvatarSocket } from "../src/socket.js";
import { speakUtterance } from "../src/speaker.js";
import { MockLiveAvatar } from "./mock-liveavatar.js";

let mock: MockLiveAvatar;
let socket: LiveAvatarSocket;
beforeEach(async () => {
  mock = new MockLiveAvatar({ speed: 0.02 });
  await mock.start();
  socket = new LiveAvatarSocket({ logger: silentLogger, pingIntervalMs: 0 });
  await socket.connect(mock.wsUrl);
});
afterEach(async () => { socket.close(); await mock.stop(); });

const speaks = () => mock.wsMessages.filter((m) => m.type === "agent.speak");

describe("speakUtterance", () => {
  it("chunks a buffer 400ms-then-1s, same event_id throughout, then speak_end, and completes", async () => {
    const pcm = synthTone(2600); // 124 800 bytes → 19 200 + 48 000 + 48 000 + 9 600
    let first = 0; let started = 0;
    const u = speakUtterance(socket, pcm, { onFirstChunk: () => first++, onStarted: () => started++ }, silentLogger);
    const r = await u.done;
    expect(r.outcome).toBe("completed");
    expect(r.bytesSent).toBe(pcm.byteLength);
    expect(r.startLatencyMs).not.toBeNull();
    expect(first).toBe(1); expect(started).toBe(1);
    const sizes = speaks().map((m) => Buffer.from(m.audio, "base64").length);
    expect(sizes).toEqual([FIRST_CHUNK_BYTES, CHUNK_BYTES, CHUNK_BYTES, 9_600]);
    expect(new Set(speaks().map((m) => m.event_id))).toEqual(new Set([u.id]));
    const end = mock.wsMessages.find((m) => m.type === "agent.speak_end");
    expect(end.event_id).toBe(u.id);
    expect(Buffer.concat(mock.utterances[0]!.chunks)).toEqual(Buffer.from(pcm));
  });

  it("streams from an async source, flushing partial chunks when the source is slow", async () => {
    async function* slow() {
      yield synthTone(120); // 5 760 bytes < first chunk → waits for idle flush
      await new Promise((r) => setTimeout(r, 400));
      yield synthTone(120);
    }
    const u = speakUtterance(socket, slow(), { idleFlushMs: 60, minFlushMs: 50 }, silentLogger);
    const r = await u.done;
    expect(r.outcome).toBe("completed");
    expect(r.bytesSent).toBe(11_520);
    expect(speaks().length).toBe(2); // one partial flush per yield
  });

  it("handles odd-length chunks without corrupting sample alignment", async () => {
    const pcm = synthTone(500);
    const parts = [pcm.subarray(0, 1001), pcm.subarray(1001, 5000), pcm.subarray(5000)];
    const u = speakUtterance(socket, parts, {}, silentLogger);
    const r = await u.done;
    expect(r.outcome).toBe("completed");
    expect(Buffer.concat(mock.utterances[0]!.chunks)).toEqual(Buffer.from(pcm));
  });

  it("interrupt stops sending, sends agent.interrupt with the utterance id, and resolves immediately", async () => {
    const pcm = synthTone(20_000); // 20 s; lead is 3 s so pacing kicks in after ~3 s of audio
    const u = speakUtterance(socket, pcm, { leadSeconds: 1 }, silentLogger);
    await new Promise((r) => setTimeout(r, 80));
    const t0 = Date.now();
    u.interrupt();
    const r = await u.done;
    expect(Date.now() - t0).toBeLessThan(50);
    expect(r.outcome).toBe("interrupted");
    expect(r.bytesSent).toBeLessThan(pcm.byteLength); // pacing held audio back → little to discard server-side
    expect(r.bytesSent).toBeLessThanOrEqual(FIRST_CHUNK_BYTES + CHUNK_BYTES * 2);
    await new Promise((r) => setTimeout(r, 30));
    const intr = mock.wsMessages.find((m) => m.type === "agent.interrupt");
    expect(intr.event_id).toBe(u.id);
    expect(mock.wsMessages.some((m) => m.type === "agent.speak_end")).toBe(false);
  });

  it("paces sends to real time after the lead", async () => {
    // 3 s of audio, 0.5 s lead: 0.4+1.0 go out at t=0, the next 1.0 at ~0.9 s, the last 0.6 at ~1.9 s.
    const pcm = synthTone(3_000);
    const t0 = Date.now();
    const u = speakUtterance(socket, pcm, { leadSeconds: 0.5 }, silentLogger);
    await new Promise((r) => setTimeout(r, 300));
    const early = u.bytesSent;
    expect(early).toBeLessThan(pcm.byteLength);
    const r = await u.done;
    expect(r.outcome).toBe("completed");
    expect(Date.now() - t0).toBeGreaterThan(1_700);
  });

  it("reports empty for an empty source", async () => {
    const r = await speakUtterance(socket, new Uint8Array(0), {}, silentLogger).done;
    expect(r.outcome).toBe("empty");
    expect(speaks().length).toBe(0);
  });

  it("fails cleanly on a server error event", async () => {
    mock.setOptions({ errorOnSpeak: true });
    const r = await speakUtterance(socket, synthTone(300), {}, silentLogger).done;
    expect(r.outcome).toBe("failed");
    expect(r.error?.message).toMatch(/mock speak failure/);
  });

  it("fails when the socket closes mid-utterance", async () => {
    const u = speakUtterance(socket, synthTone(10_000), { leadSeconds: 0.2 }, silentLogger);
    await new Promise((r) => setTimeout(r, 50));
    mock.dropSockets();
    const r = await u.done;
    expect(r.outcome).toBe("failed");
  });

  it("gives up if speak_ended never comes", async () => {
    // Speed 0 → mock never finishes; grace tiny.
    mock.setOptions({ speed: 100 });
    const r = await speakUtterance(socket, synthTone(100), { graceMs: 150 }, silentLogger).done;
    expect(r.outcome).toBe("failed");
    expect(r.error?.message).toMatch(/timed out/);
  });
});
