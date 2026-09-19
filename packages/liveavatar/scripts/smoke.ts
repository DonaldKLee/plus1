/**
 * End-to-end smoke against the real LiveAvatar API in sandbox mode (free, ~1 min).
 *
 *   LIVEAVATAR_API_KEY=… npm run smoke                 # tone through the Wayne sandbox avatar
 *   LIVEAVATAR_API_KEY=… npm run smoke -- path/to.wav  # your own audio (any WAV)
 *   LIVEAVATAR_AVATAR_ID=… LIVEAVATAR_SANDBOX=0 …      # production avatar, costs credits
 *
 * Prints every socket event with timing so you can see start latency, interrupt
 * behaviour and clean shutdown. Exits non-zero if anything is off.
 */
import { loadEnv } from "../src/env.js";
loadEnv(import.meta.url);
import { readFileSync } from "node:fs";
import { LiveAvatarClient } from "../src/client.js";
import { synthTone, wavToLiveAvatarPcm, durationMs } from "../src/pcm.js";
import { LiveAvatarSession } from "../src/session.js";
import type { Logger } from "../src/logger.js";

const SANDBOX_AVATAR = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"; // "Wayne", the only avatar sandbox allows

const apiKey = process.env.LIVEAVATAR_API_KEY;
if (!apiKey) { console.error("set LIVEAVATAR_API_KEY"); process.exit(2); }
const sandbox = process.env.LIVEAVATAR_SANDBOX !== "0";
const avatarId = process.env.LIVEAVATAR_AVATAR_ID ?? SANDBOX_AVATAR;
const wavPath = process.argv[2];

const t0 = Date.now();
const stamp = () => `+${String(Date.now() - t0).padStart(5)}ms`;
const log: Logger = {
  debug: (...a) => console.log(stamp(), "·", ...a),
  info: (...a) => console.log(stamp(), "i", ...a),
  warn: (...a) => console.log(stamp(), "!", ...a),
  error: (...a) => console.log(stamp(), "✗", ...a),
};

const client = new LiveAvatarClient({ apiKey, logger: log });
const session = new LiveAvatarSession({ client, avatarId, sandbox, logger: log, socket: { logger: log } });
session.on("state", (n, p) => log.info(`session ${p} → ${n}`));
session.on("avatarState", (s) => log.info(`avatar pose: ${s}`));
session.on("warning", (w) => log.warn("warning", w));
session.on("error", (e) => log.error("error", e.message));
session.on("ended", (i) => log.info(`ended: ${i.reason}${i.error ? ` (${i.error.message})` : ""} after ${Math.round(i.uptimeMs / 1000)}s`));

let failed = false;
try {
  const media = await session.start();
  log.info("LiveKit:", media.livekitUrl, "room token bytes:", media.livekitClientToken.length, "max:", media.maxSessionDurationSec, "s");
  log.info("open this in the preview (npm run preview) to see the video; this script only exercises audio → events");

  const audio = wavPath ? wavToLiveAvatarPcm(new Uint8Array(readFileSync(wavPath))) : synthTone(2_500, { hz: 200 });
  log.info(`speaking ${Math.round(durationMs(audio.byteLength))}ms of audio`);
  const u1 = session.speak(audio, { label: "utterance-1", onStarted: () => log.info("↳ avatar started speaking") });
  const r1 = await u1.done;
  log.info("utterance-1:", r1.outcome, `sent=${Math.round(r1.sentMs)}ms`, `startLatency=${r1.startLatencyMs ?? "-"}ms`);
  if (r1.outcome !== "completed") failed = true;

  // Barge-in: start a long one, cut it after 1.2 s.
  const longAudio = synthTone(8_000, { hz: 260 });
  const u2 = session.speak(longAudio, { label: "utterance-2 (to be interrupted)" });
  await new Promise((r) => setTimeout(r, 1_200));
  log.info("interrupting…");
  session.interrupt();
  const r2 = await u2.done;
  log.info("utterance-2:", r2.outcome, `sent=${Math.round(r2.sentMs)}ms of ${Math.round(durationMs(longAudio.byteLength))}ms`);
  if (r2.outcome !== "interrupted") failed = true;

  // Pose toggles + a short follow-up so we know the server accepts speech right after an interrupt.
  session.setListening(true);
  await new Promise((r) => setTimeout(r, 800));
  session.setListening(false);
  const r3 = await session.speak(synthTone(900, { hz: 300 }), { label: "utterance-3" }).done;
  log.info("utterance-3:", r3.outcome, `startLatency=${r3.startLatencyMs ?? "-"}ms`);
  if (r3.outcome !== "completed") failed = true;
} catch (err) {
  failed = true;
  log.error("smoke failed:", err instanceof Error ? err.stack ?? err.message : err);
} finally {
  await session.stop();
}
console.log(failed ? "\nSMOKE FAILED" : "\nSMOKE OK");
process.exit(failed ? 1 : 0);
