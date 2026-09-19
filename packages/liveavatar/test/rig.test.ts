import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveAvatarClient } from "../src/client.js";
import { silentLogger } from "../src/logger.js";
import { PAGE_EVENT_SINK, PAGE_GLOBAL, type PageEvent } from "../src/page-protocol.js";
import { synthTone } from "../src/pcm.js";
import { AvatarRig, type RigPage } from "../src/rig.js";
import { ToneTts } from "../src/tts.js";
import { MockLiveAvatar } from "./mock-liveavatar.js";

/** A fake Playwright page: records init scripts, evaluates bridge calls against a scripted bridge. */
class FakePage implements RigPage {
  initScripts: string[] = [];
  exposed = new Map<string, (...a: any[]) => unknown>();
  calls: { method: string; args: unknown[] }[] = [];
  injected: string[] = [];
  connectResult = { video: true, audio: true };
  async addInitScript(script: string) { this.initScripts.push(script); }
  async exposeFunction(name: string, cb: (...a: any[]) => unknown) { this.exposed.set(name, cb); }
  bridgeInjected = false;
  async evaluate<R>(expression: string): Promise<R> {
    if (expression.startsWith("!!window[")) return this.bridgeInjected as R;
    if (expression.startsWith("window.__plus1AvatarConfig = ")) { this.bridgeInjected = true; this.injected.push(expression); return undefined as R; }
    const m = /b\["(\w+)"\]\(\.\.\.(\[.*\])\)/s.exec(expression) ?? /b\[(".*?")\]\(\.\.\.(.*)\); \}\)\(\)$/s.exec(expression);
    if (!m) throw new Error(`unexpected expression: ${expression}`);
    const method = JSON.parse(m[1]!.startsWith('"') ? m[1]! : `"${m[1]}"`);
    const args = JSON.parse(m[2]!);
    this.calls.push({ method, args });
    if (method === "connect") return this.connectResult as R;
    return undefined as R;
  }
  emit(e: PageEvent) { return this.exposed.get(PAGE_EVENT_SINK)!(e); }
}

let mock: MockLiveAvatar;
beforeEach(async () => { mock = new MockLiveAvatar({ speed: 0.02 }); await mock.start(); });
afterEach(() => mock.stop());

const make = (page: FakePage, over: Partial<ConstructorParameters<typeof AvatarRig>[0]> = {}) =>
  new AvatarRig({
    client: new LiveAvatarClient({ apiKey: "test-key", baseUrl: mock.baseUrl, logger: silentLogger }),
    avatarId: "av", sandbox: true, logger: silentLogger, tts: new ToneTts({ msPerWord: 100, chunkMs: 50 }),
    restartBackoffMs: [30], ...over,
  });

describe("AvatarRig", () => {
  it("installs only the tiny fake-media init script; the heavy bridge is injected on start", async () => {
    const page = new FakePage();
    const rig = make(page, { page: { label: "Reginald", fit: "contain" } });
    await rig.prepare(page);
    expect(page.initScripts).toHaveLength(1);
    const s = page.initScripts[0]!;
    expect(s).toContain("window.top !== window");
    expect(s).toContain('"label":"Reginald"');
    expect(s).toContain("getUserMedia");
    expect(s.length).toBeLessThan(20_000); // no livekit-client in the init script: it stalls Meet
    expect(page.exposed.has(PAGE_EVENT_SINK)).toBe(true);
    expect(page.injected).toHaveLength(0);
    await rig.start();
    expect(page.injected).toHaveLength(1);
    expect(page.injected[0]!).toContain(PAGE_GLOBAL);
    expect(page.injected[0]!).toContain('"fit":"contain"');
    expect(page.injected[0]!.length).toBeGreaterThan(100_000);
    await rig.stop();
  });

  it("start → connects the page with the session's LiveKit creds; speech unmutes, interrupt mutes", async () => {
    const page = new FakePage();
    const rig = make(page);
    await rig.prepare(page);
    const media = await rig.start();
    const connect = page.calls.find((c) => c.method === "connect")!;
    expect(connect.args[0]).toMatchObject({ livekitUrl: media.livekitUrl, livekitToken: media.livekitClientToken });

    const phases: string[] = [];
    rig.on("speaking", (e) => phases.push(e.phase));
    const u = rig.speakText("on it, give me a sec");
    const r = await u.done;
    expect(r.outcome).toBe("completed");
    expect(r.bytesSent).toBeGreaterThan(0);
    expect(phases).toEqual(["queued", "started", "ended"]);
    expect(page.calls.some((c) => c.method === "setAvatarMuted" && c.args[0] === false)).toBe(true);

    const long = rig.speakPcm(synthTone(10_000), { leadSeconds: 0.2 });
    await new Promise((r) => setTimeout(r, 40));
    rig.interrupt();
    expect((await long.done).outcome).toBe("interrupted");
    expect(page.calls.filter((c) => c.method === "setAvatarMuted").pop()!.args[0]).toBe(true);

    await rig.honk();
    expect(page.calls.filter((c) => c.method === "honk")).toHaveLength(1);
    await rig.emote("thinking");
    await rig.emote("idle");
    await rig.emote("nod");
    await new Promise((r) => setTimeout(r, 30));
    expect(mock.wsMessages.map((m) => m.type)).toEqual(expect.arrayContaining(["agent.start_listening", "agent.stop_listening"]));

    await rig.stop();
    expect(page.calls.some((c) => c.method === "disconnect")).toBe(true);
    expect([...mock.sessions.values()].every((s) => s.stopped)).toBe(true);
  });

  it("relays page events and drops speech when the avatar isn't ready", async () => {
    const page = new FakePage();
    const rig = make(page);
    await rig.prepare(page);
    const states: string[] = []; const warnings: string[] = [];
    rig.on("mediaState", (s) => states.push(s));
    rig.on("warning", (w) => warnings.push(w));
    await page.emit({ kind: "state", state: "connecting" });
    await page.emit({ kind: "warning", code: "AUDIO_SILENT", message: "quiet" });
    expect(states).toEqual(["connecting"]);
    expect(warnings[0]).toMatch(/AUDIO_SILENT/);
    expect(rig.mediaState).toBe("connecting");
    expect(() => rig.speakPcm(synthTone(10))).toThrow(/not ready/);
  });

  it("auto-restarts the session and re-plumbs the page when the socket dies", async () => {
    const page = new FakePage();
    const rig = make(page);
    await rig.prepare(page);
    const first = await rig.start();
    const medias: string[] = [first.sessionId];
    rig.on("sessionMedia", (m) => medias.push(m.sessionId));
    const restarted = new Promise<void>((r) => rig.on("sessionMedia", () => r()));
    mock.dropSockets(1011, "max duration reached");
    await restarted;
    await new Promise((r) => setTimeout(r, 50));
    expect(medias).toHaveLength(2);
    expect(medias[0]).not.toBe(medias[1]);
    expect(page.calls.filter((c) => c.method === "connect")).toHaveLength(2);
    expect(rig.sessionState).toBe("ready");
    const r = await rig.speakPcm(synthTone(200)).done;
    expect(r.outcome).toBe("completed");
    await rig.stop();
  });

  it("gives up after maxRestartAttempts and emits dead", async () => {
    const page = new FakePage();
    const rig = make(page, { maxRestartAttempts: 2 });
    await rig.prepare(page);
    await rig.start();
    const dead = new Promise<Error>((r) => rig.once("dead", r));
    mock.setOptions({ apiKey: "rotated" }); // every restart now 401s
    mock.dropSockets();
    const err = await dead;
    expect(err.message).toMatch(/401/);
    await rig.stop();
  });
});
