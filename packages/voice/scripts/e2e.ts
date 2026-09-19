/**
 * Real ElevenLabs -> real LiveAvatar (sandbox): the plus1 says actual words with lipsync.
 * Watch it in the preview (npm run preview -w @plus1/liveavatar) for video; this prints timings.
 */
import { LiveAvatarClient, LiveAvatarSession } from "@plus1/liveavatar";
import { FillerCache } from "../src/fillers.js";
import { loadEnv, voiceFromEnv } from "../src/env.js";
loadEnv(import.meta.url);

const tts = voiceFromEnv();
const client = new LiveAvatarClient({ apiKey: process.env.LIVEAVATAR_API_KEY! });
const session = new LiveAvatarSession({ client, avatarId: process.env.LIVEAVATAR_AVATAR_ID!, sandbox: process.env.LIVEAVATAR_SANDBOX !== "0" });
const t0 = Date.now(); const st = () => `+${String(Date.now() - t0).padStart(5)}ms`;
session.on("avatarState", (s) => console.log(st(), "avatar:", s));
session.on("utteranceEnded", (r) => console.log(st(), "utterance", r.outcome, `sent=${Math.round(r.sentMs)}ms startLatency=${r.startLatencyMs}ms`));

const fillers = new FillerCache({ tts, voiceKey: `${tts.voiceId}:${tts.model}` });
console.log(st(), "fillers:", await fillers.warm());
await session.start();
console.log(st(), "session ready");

// 1) instant filler from cache while the "planner" thinks
const f = fillers.pick("ack")!;
console.log(st(), `filler: "${f.phrase}"`);
await session.speak(f.pcm).done;

// 2) streamed TTS answer
const answer = "we're locked in on the seventy five k tier with bob. slack says fifty, but the email on the ninth supersedes it, and that's the one he actually replied to.";
console.log(st(), "speaking streamed answer");
const abort = new AbortController();
const u = session.speak(tts.synthesize(answer, { signal: abort.signal }), { onFirstChunk: () => console.log(st(), "first PCM chunk out"), onStarted: () => console.log(st(), "avatar started speaking") });
await u.done;

// 3) barge-in on a long one
const abort2 = new AbortController();
const u2 = session.speak(tts.synthesize("and one more thing, i also wanted to mention that the notion doc is stale and someone should probably update it before the next sync.", { signal: abort2.signal }));
await new Promise((r) => setTimeout(r, 2_000));
console.log(st(), "interrupt!");
abort2.abort(); u2.interrupt();
await u2.done;

await session.stop();
console.log(st(), `done. elevenlabs chars billed this run: ${tts.charsUsed}`);
