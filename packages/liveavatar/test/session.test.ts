import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveAvatarClient } from "../src/client.js";
import { LiveAvatarStateError } from "../src/errors.js";
import { silentLogger } from "../src/logger.js";
import { synthTone } from "../src/pcm.js";
import { LiveAvatarSession } from "../src/session.js";
import { MockLiveAvatar } from "./mock-liveavatar.js";

let mock: MockLiveAvatar;
beforeEach(async () => { mock = new MockLiveAvatar({ speed: 0.02 }); await mock.start(); });
afterEach(() => mock.stop());

const make = (over: Partial<ConstructorParameters<typeof LiveAvatarSession>[0]> = {}) =>
  new LiveAvatarSession({
    client: new LiveAvatarClient({ apiKey: "test-key", baseUrl: mock.baseUrl, logger: silentLogger }),
    avatarId: "av", sandbox: true, logger: silentLogger, keepAliveMs: 50, restKeepAliveMs: 80,
    socket: { pingIntervalMs: 0 }, ...over,
  });

describe("LiveAvatarSession", () => {
  it("goes idle → starting → ready, speaks, and stops cleanly", async () => {
    const s = make();
    const states: string[] = [];
    s.on("state", (n) => states.push(n));
    const media = await s.start();
    expect(media.wsUrl).toContain("/ws");
    expect(media.livekitClientToken).toMatch(/^lk_client_/);
    expect(s.state).toBe("ready");

    const ended: string[] = [];
    s.on("utteranceEnded", (r) => ended.push(r.outcome));
    const u = s.speak(synthTone(600));
    expect(s.state).toBe("speaking");
    expect((await u.done).outcome).toBe("completed");
    expect(s.state).toBe("ready");
    expect(ended).toEqual(["completed"]);

    await new Promise((r) => setTimeout(r, 200)); // let keep-alives fire
    expect(mock.wsMessages.filter((m) => m.type === "session.keep_alive").length).toBeGreaterThan(0);
    expect(mock.sessions.get(media.sessionId)!.keepAlives).toBeGreaterThan(0);

    const endedInfo = new Promise<any>((r) => s.once("ended", r));
    await s.stop();
    expect(s.state).toBe("stopped");
    expect((await endedInfo).reason).toBe("client_stop");
    expect(mock.sessions.get(media.sessionId)).toMatchObject({ stopped: true, stopReason: "USER_CLOSED" });
    expect(states).toEqual(["starting", "ready", "speaking", "ready", "stopping", "stopped"]);
    await s.stop(); // idempotent
  });

  it("a second speak preempts the first", async () => {
    const s = make();
    await s.start();
    const a = s.speak(synthTone(8_000), { leadSeconds: 0.3 });
    await new Promise((r) => setTimeout(r, 60));
    const b = s.speak(synthTone(300));
    expect((await a.done).outcome).toBe("interrupted");
    expect((await b.done).outcome).toBe("completed");
    expect(mock.wsMessages.filter((m) => m.type === "agent.interrupt").length).toBe(1);
    await s.stop();
  });

  it("interrupt with nothing playing sends a bare interrupt; setListening toggles pose", async () => {
    const s = make();
    await s.start();
    const poses: string[] = [];
    s.on("avatarState", (p) => poses.push(String(p)));
    s.interrupt();
    s.setListening(true);
    s.setListening(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.wsMessages.map((m) => m.type)).toEqual(expect.arrayContaining(["agent.interrupt", "agent.start_listening", "agent.stop_listening"]));
    expect(poses).toEqual(["listening", "idle"]);
    await s.stop();
  });

  it("refuses to speak before ready and refuses to start twice", async () => {
    const s = make();
    expect(() => s.speak(synthTone(10))).toThrow(LiveAvatarStateError);
    await s.start();
    await expect(s.start()).rejects.toBeInstanceOf(LiveAvatarStateError);
    await s.stop();
  });

  it("fails start when the token isn't LITE (no ws_url) and cleans up", async () => {
    mock.setOptions({ omitWsUrl: true });
    const s = make();
    const ended = new Promise<any>((r) => s.once("ended", r));
    await expect(s.start()).rejects.toThrow(/ws_url/);
    expect(s.state).toBe("stopped");
    expect((await ended).reason).toBe("start_failed");
    expect([...mock.sessions.values()][0]).toMatchObject({ stopped: true });
  });

  it("ends with socket_closed when the server drops the socket, interrupting speech", async () => {
    const s = make();
    await s.start();
    const u = s.speak(synthTone(10_000), { leadSeconds: 0.2 });
    const ended = new Promise<any>((r) => s.once("ended", r));
    await new Promise((r) => setTimeout(r, 50));
    mock.dropSockets(1011, "max duration");
    const info = await ended;
    expect(info.reason).toBe("socket_closed");
    expect(info.error?.message).toMatch(/1011/);
    expect((await u.done).outcome).toBe("failed");
    expect(s.state).toBe("stopped");
  });
});
