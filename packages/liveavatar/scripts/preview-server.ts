/**
 * Standalone preview: the in-page bridge running in a normal browser tab,
 * driven by this tiny server which owns the API key and the LiveAvatar session.
 *
 *   LIVEAVATAR_API_KEY=… npm run preview      → http://localhost:4173
 *
 * This is HLD §12 step 6 ("build the plus1 page standalone first"): iterate on
 * the media bridge here, then the exact same bundle goes into the Meet tab.
 */
import { loadEnv } from "../src/env.js";
loadEnv(import.meta.url);
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveAvatarClient } from "../src/client.js";
import { synthTone, wavToLiveAvatarPcm } from "../src/pcm.js";
import { LiveAvatarSession } from "../src/session.js";
import { ToneTts } from "../src/tts.js";

const here = dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.LIVEAVATAR_API_KEY;
if (!apiKey) { console.error("set LIVEAVATAR_API_KEY (sandbox mode is free)"); process.exit(2); }
const sandbox = process.env.LIVEAVATAR_SANDBOX !== "0";
const avatarId = process.env.LIVEAVATAR_AVATAR_ID ?? "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";
const port = Number(process.env.PORT ?? 4173);

const client = new LiveAvatarClient({ apiKey, logger: console });
// Real voice when ELEVENLABS_API_KEY is set (packages/voice), else a tone so the pipeline still runs.
const tts: import("../src/tts.js").TextToSpeech = process.env.ELEVENLABS_API_KEY
  ? (await import("@plus1/voice")).voiceFromEnv()
  : new ToneTts();
console.log(`tts: ${process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "tone"}`);
let session: LiveAvatarSession | null = null;

const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = async (req: import("node:http").IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(resolve(here, "preview.html")));
    }
    if (req.method === "GET" && url.pathname === "/page.iife.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end(readFileSync(resolve(here, "../dist/page.iife.js")));
    }
    if (req.method === "GET" && url.pathname === "/api/info") {
      return json(res, 200, { tts: process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "tone", sandbox, avatarId, active: session?.isReady ?? false });
    }
    if (req.method !== "POST") return json(res, 404, { error: "not found" });
    const raw = await readBody(req);

    if (url.pathname === "/api/session") {
      if (session) await session.stop();
      session = new LiveAvatarSession({ client, avatarId, sandbox, logger: console, socket: { logger: console } });
      session.on("ended", (i) => console.log("session ended:", i.reason, i.error?.message ?? ""));
      session.on("utteranceEnded", (r) => console.log("utterance", r.id.slice(0, 8), r.outcome, `latency=${r.startLatencyMs ?? "-"}ms`));
      const m = await session.start();
      return json(res, 200, { sessionId: m.sessionId, livekitUrl: m.livekitUrl, livekitClientToken: m.livekitClientToken, maxSessionDurationSec: m.maxSessionDurationSec });
    }
    if (!session?.isReady) return json(res, 409, { error: "no active session" });
    if (url.pathname === "/api/speak") {
      const { text } = JSON.parse(raw.toString() || "{}");
      const u = session.speak(tts.synthesize(String(text ?? "hello"), { signal: new AbortController().signal }), { label: text });
      return json(res, 200, { id: u.id });
    }
    if (url.pathname === "/api/speak-wav") {
      const pcm = raw.length ? wavToLiveAvatarPcm(new Uint8Array(raw)) : synthTone(1000);
      const u = session.speak(pcm, { label: "wav" });
      return json(res, 200, { id: u.id, ms: (pcm.byteLength / 48_000) * 1000 });
    }
    if (url.pathname === "/api/interrupt") { session.interrupt(); return json(res, 200, { ok: true }); }
    if (url.pathname === "/api/listening") { session.setListening(Boolean(JSON.parse(raw.toString() || "{}").on)); return json(res, 200, { ok: true }); }
    if (url.pathname === "/api/stop") { await session.stop(); session = null; return json(res, 200, { ok: true }); }
    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(port, () => console.log(`preview → http://localhost:${port}  (sandbox=${sandbox}, avatar=${avatarId})`));

process.on("SIGINT", async () => { await session?.stop(); process.exit(0); });
