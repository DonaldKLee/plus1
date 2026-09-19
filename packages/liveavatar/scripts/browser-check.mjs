import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Loads dist/page.iife.js into real Chrome (headless, `channel: "chrome"`) and proves the media
// bridge works outside Meet: fake getUserMedia, device list, placeholder frame, audio graph,
// honk, PCM playback, and the connect-failure path. Needs Google Chrome installed.
//   npm run check:browser

const bundle = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../dist/page.iife.js"), "utf8");
const early = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../dist/early.iife.js"), "utf8");
const html = `<!doctype html><meta charset=utf-8><title>t</title><body><div id=x></div></body>`;
const server = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); }).listen(0);
await new Promise((r) => server.on("listening", r));
const port = server.address().port;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"] });
const ctx = await browser.newContext({ bypassCSP: true });
const page = await ctx.newPage();
const events = [];
await page.exposeFunction("__plus1AvatarEvent", (e) => { if (e.kind !== "audioLevel") events.push(e); });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });
const cfg = `{"label":"Reginald","width":1280,"height":720,"fps":30,"fit":"cover","backdrop":"#0b0f14","monitorVolume":0,"installFakeMedia":true}`;
await page.addInitScript(`(() => { if (window.top !== window) return; window.__plus1AvatarConfig = ${cfg}; ${early} })();`);
await page.goto(`http://127.0.0.1:${port}/`);
// Meet flow: gUM is acquired by the page before the bridge exists; the late bridge must adopt that bus.
const preGum = await page.evaluate(async () => { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); return s.getTracks().length; });
if (preGum !== 2) { console.log("early gUM override not effective"); process.exit(1); }
await page.evaluate(`window.__plus1AvatarConfig = ${cfg}; ${bundle}`);

const r = await page.evaluate(async () => {
  const b = window.__plus1Avatar;
  const out = { version: b.version, state0: b.getState() };
  const gum = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  out.gum = { v: gum.getVideoTracks().length, a: gum.getAudioTracks().length, settings: gum.getVideoTracks()[0].getSettings() };
  out.devices = (await navigator.mediaDevices.enumerateDevices()).map((d) => d.kind + ":" + d.label);
  await new Promise((r) => setTimeout(r, 400));
  const snap = b.snapshot();
  out.snapshotLen = snap.length;
  // sample the canvas center pixel: placeholder should not be pure black
  const c = window.__gooseCanvas; const px = c.getContext("2d").getImageData(640, 300, 1, 1).data;
  out.centerPixel = Array.from(px);
  out.audioCtxState = window.__audioCtx.state;
  const t0 = performance.now(); await b.honk({ durationMs: 300 }); out.honkMs = Math.round(performance.now() - t0);
  // 24k tone as base64
  const n = 2400; const s = new Int16Array(n); for (let i = 0; i < n; i++) s[i] = Math.round(Math.sin(i / 10) * 8000);
  const bytes = new Uint8Array(s.buffer); let bin = ""; for (const x of bytes) bin += String.fromCharCode(x);
  const t1 = performance.now(); await b.playPcm(btoa(bin)); out.playPcmMs = Math.round(performance.now() - t1);
  b.setAvatarMuted(true); b.setAvatarMuted(false);
  let connectErr = null;
  try { await b.connect({ livekitUrl: "wss://127.0.0.1:1/", livekitToken: "bogus", trackTimeoutMs: 1000 }); } catch (e) { connectErr = String(e.message || e).slice(0, 120); }
  out.connectErr = connectErr; out.state1 = b.getState();
  await b.disconnect(); out.state2 = b.getState();
  return out;
});
console.log(JSON.stringify(r, null, 1));
console.log("events:", JSON.stringify(events));
await browser.close(); server.close();
const ok = r.gum.v === 1 && r.gum.a === 1 && r.gum.settings.width === 1280 && r.centerPixel.some((v, i) => i < 3 && v > 8) && r.honkMs >= 250 && r.connectErr && r.state1.state === "failed" && r.state2.state === "idle" && r.audioCtxState === "running";
console.log(ok ? "BROWSER CHECK OK" : "BROWSER CHECK FAILED");
process.exit(ok ? 0 : 1);
