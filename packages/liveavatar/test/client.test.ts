import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LiveAvatarClient } from "../src/client.js";
import { LiveAvatarApiError } from "../src/errors.js";
import { silentLogger } from "../src/logger.js";
import { MockLiveAvatar } from "./mock-liveavatar.js";

const mock = new MockLiveAvatar();
beforeAll(() => mock.start());
afterAll(() => mock.stop());

const client = () => new LiveAvatarClient({ apiKey: "test-key", baseUrl: mock.baseUrl, logger: silentLogger, retries: 2 });

describe("LiveAvatarClient", () => {
  it("mints a LITE token with the API key and starts with a Bearer token", async () => {
    const c = client();
    const tok = await c.createLiteSessionToken({ avatar_id: "av", is_sandbox: true, video_settings: { encoding: "H264", quality: "high" } });
    expect(tok.session_token).toMatch(/^tok_/);
    const tokenCall = mock.calls.find((k) => k.path === "/v1/sessions/token")!;
    expect(tokenCall.headers["x-api-key"]).toBe("test-key");
    expect(tokenCall.headers.authorization).toBeUndefined();
    expect(tokenCall.body).toEqual({ mode: "LITE", avatar_id: "av", is_sandbox: true, video_settings: { encoding: "H264", quality: "high" } });

    const started = await c.startSession(tok.session_token);
    expect(started.ws_url).toContain("/ws?session=");
    const startCall = mock.calls.find((k) => k.path === "/v1/sessions/start")!;
    expect(startCall.headers.authorization).toBe(`Bearer ${tok.session_token}`);
    expect(startCall.headers["x-api-key"]).toBeUndefined();

    await c.keepAlive({ sessionId: started.session_id, sessionToken: tok.session_token });
    await c.stopSession({ sessionId: started.session_id, sessionToken: tok.session_token, reason: "USER_CLOSED" });
    expect(mock.sessions.get(started.session_id)).toMatchObject({ stopped: true, stopReason: "USER_CLOSED", keepAlives: 1 });
    // Stop falls back to the API key when no session token is given.
    await c.stopSession({ sessionId: started.session_id });
    const lastStop = mock.calls.filter((k) => k.path === "/v1/sessions/stop").pop()!;
    expect(lastStop.headers["x-api-key"]).toBe("test-key");
  });

  it("surfaces auth errors with status and body", async () => {
    const bad = new LiveAvatarClient({ apiKey: "wrong", baseUrl: mock.baseUrl, logger: silentLogger });
    const err = await bad.createLiteSessionToken({ avatar_id: "av" }).catch((e) => e);
    expect(err).toBeInstanceOf(LiveAvatarApiError);
    expect(err.status).toBe(401);
    expect(err.isAuth).toBe(true);
    expect(err.isTransient).toBe(false);
  });

  it("retries transient failures on idempotent calls", async () => {
    mock.setOptions({ failTokenTimes: 2 });
    const before = mock.calls.filter((k) => k.path === "/v1/sessions/token").length;
    const tok = await client().createLiteSessionToken({ avatar_id: "av" });
    expect(tok.session_id).toBeTruthy();
    expect(mock.calls.filter((k) => k.path === "/v1/sessions/token").length - before).toBe(3);
    mock.setOptions({ failTokenTimes: 0 });
  });

  it("does not retry start (not idempotent)", async () => {
    const c = client();
    const tok = await c.createLiteSessionToken({ avatar_id: "av" });
    await c.startSession(tok.session_token);
    const before = mock.calls.filter((k) => k.path === "/v1/sessions/start").length;
    await expect(c.startSession(tok.session_token)).rejects.toBeInstanceOf(LiveAvatarApiError);
    expect(mock.calls.filter((k) => k.path === "/v1/sessions/start").length - before).toBe(1);
  });

  it("reads the catalogue and tolerates unknown fields", async () => {
    const c = client();
    const avatars = await c.listPublicAvatars();
    expect(avatars[0]).toMatchObject({ id: "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a", name: "Wayne" });
    const voices = await c.listVoices();
    expect(voices[0]?.tags).toEqual(["calm"]);
    const s = await c.getSession("nope");
    expect(s).toBeNull();
  });

  it("times out slow servers", async () => {
    const slow = new LiveAvatarClient({ apiKey: "k", baseUrl: "http://127.0.0.1:9", timeoutMs: 200, retries: 0, logger: silentLogger });
    await expect(slow.listVoices()).rejects.toThrow();
  });
});
