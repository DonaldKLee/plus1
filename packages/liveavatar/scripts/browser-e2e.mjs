// Live end-to-end of the in-page bridge: preview server (real LiveAvatar sandbox) + headless Chrome.
// Proves that avatar video frames land on the fake-camera canvas and avatar audio reaches the
// fake-mic bus, which is the one thing unit tests cannot cover.
//   npm run e2e:browser -w @plus1/liveavatar
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 4199;
const server = spawn("npx", ["tsx", resolve(here, "preview-server.ts")], { cwd: resolve(here, ".."), env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
const serverLog = [];
server.stdout.on("data", (d) => serverLog.push(String(d)));
server.stderr.on("data", (d) => serverLog.push(String(d)));
const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); } throw new Error(`timeout waiting for ${what}`); };
await waitFor(async () => { try { return (await fetch(`http://localhost:${PORT}/`)).ok; } catch { return false; } }, 15_000, "preview server");

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"] });
const ctx = await browser.newContext({ bypassCSP: true });
const page = await ctx.newPage();
const events = []; const levels = [];
page.on("console", (m) => { if (m.type() === "error") events.push({ kind: "console.error", text: m.text() }); });
page.on("pageerror", (e) => events.push({ kind: "pageerror", text: e.message }));
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => { const prev = window.__plus1AvatarEvent; window.__events = []; window.__plus1AvatarEvent = (e) => { window.__events.push({ t: performance.now(), ...e }); prev?.(e); }; });

const result = {};
const t0 = Date.now();
await page.click("#start");
await waitFor(async () => (await page.evaluate(() => window.__plus1Avatar.getState())).state === "live", 40_000, "avatar tracks live");
result.msToLive = Date.now() - t0;
result.state = await page.evaluate(() => window.__plus1Avatar.getState());
const snapA = await page.evaluate(() => window.__plus1Avatar.snapshot());
await new Promise((r) => setTimeout(r, 700));
const snapB = await page.evaluate(() => window.__plus1Avatar.snapshot());
result.videoFramesChange = snapA !== snapB;
result.centerPixel = await page.evaluate(() => Array.from(window.__gooseCanvas.getContext("2d").getImageData(640, 360, 1, 1).data));

// Speak: 1.5 s tone straight through the avatar (bypasses ElevenLabs quota).
await page.evaluate(() => window.__plus1Avatar.setAvatarMuted(false));
const speakRes = await fetch(`http://localhost:${PORT}/api/speak-wav`, { method: "POST" }).then((r) => r.json());
result.utterance = speakRes;
await new Promise((r) => setTimeout(r, 2_500));
const pageEvents = await page.evaluate(() => window.__events);
const rmsValues = pageEvents.filter((e) => e.kind === "audioLevel").map((e) => e.rms);
result.audioLevelSamples = rmsValues.length;
result.peakRms = Math.max(0, ...rmsValues);
result.warnings = pageEvents.filter((e) => e.kind === "warning");
result.stateEvents = pageEvents.filter((e) => e.kind === "state").map((e) => `${e.state}${e.detail ? `(${e.detail})` : ""}`);
result.errors = events;

await page.click("#stop");
await new Promise((r) => setTimeout(r, 500));
result.finalState = await page.evaluate(() => window.__plus1Avatar.getState());
await browser.close();
server.kill("SIGINT");
await new Promise((r) => setTimeout(r, 800));

console.log(JSON.stringify(result, null, 1));
const ok = result.state.video && result.state.audio && result.videoFramesChange && result.peakRms > 0.01 && result.finalState.state === "idle" && result.errors.length === 0;
console.log(ok ? "BROWSER E2E OK" : "BROWSER E2E FAILED");
if (!ok) console.log("server log:\n" + serverLog.join(""));
process.exit(ok ? 0 : 1);
