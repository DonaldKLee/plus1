import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveAvatarStateError, LiveAvatarTimeoutError } from "../src/errors.js";
import { silentLogger } from "../src/logger.js";
import { LiveAvatarSocket } from "../src/socket.js";
import { MockLiveAvatar } from "./mock-liveavatar.js";

let mock: MockLiveAvatar;
beforeEach(async () => { mock = new MockLiveAvatar(); await mock.start(); });
afterEach(() => mock.stop());

describe("LiveAvatarSocket", () => {
  it("connects, waits for `connected`, then accepts commands", async () => {
    const s = new LiveAvatarSocket({ logger: silentLogger, pingIntervalMs: 0 });
    expect(() => s.send({ type: "session.keep_alive", event_id: "x" })).toThrow(LiveAvatarStateError);
    await s.connect(mock.wsUrl);
    expect(s.state).toBe("ready");
    s.sendBare("session.keep_alive");
    await new Promise((r) => setTimeout(r, 30));
    expect(mock.wsMessages.map((m) => m.type)).toEqual(["session.keep_alive"]);
    const closed = new Promise((r) => s.once("close", r));
    s.close();
    expect(await closed).toMatchObject({ expected: true });
  });

  it("rejects when the server never says connected", async () => {
    mock.setOptions({ neverConnect: true });
    const s = new LiveAvatarSocket({ logger: silentLogger, readyTimeoutMs: 150, pingIntervalMs: 0 });
    await expect(s.connect(mock.wsUrl)).rejects.toBeInstanceOf(LiveAvatarTimeoutError);
    expect(s.state).toBe("closed");
  });

  it("rejects on connection refused", async () => {
    const s = new LiveAvatarSocket({ logger: silentLogger, connectTimeoutMs: 500, pingIntervalMs: 0 });
    await expect(s.connect("ws://127.0.0.1:9/ws")).rejects.toThrow();
  });

  it("emits close with expected=false when the server drops us", async () => {
    const s = new LiveAvatarSocket({ logger: silentLogger, pingIntervalMs: 0 });
    await s.connect(mock.wsUrl);
    const closed = new Promise<any>((r) => s.once("close", r));
    mock.dropSockets(1011, "bye");
    expect(await closed).toMatchObject({ code: 1011, reason: "bye", expected: false });
  });

  it("waitFor rejects on server error events", async () => {
    const s = new LiveAvatarSocket({ logger: silentLogger, pingIntervalMs: 0 });
    await s.connect(mock.wsUrl);
    const p = s.waitFor((e) => e.type === "agent.speak_started", 1000, "start");
    s.send({ type: "agent.speak_end", event_id: "e" }); // harmless
    // Unknown command → error event
    (s as any).ws.send(JSON.stringify({ type: "agent.dance", event_id: "d" }));
    await expect(p).rejects.toThrow(/unknown type agent.dance/);
    s.close();
  });
});
