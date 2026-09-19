/** `npm run say -- "text" [out.wav]`: synthesize with the configured voice, write a WAV, report latency. */
import { writeFileSync } from "node:fs";
import { liveAvatarPcmToWav, durationMs } from "@plus1/liveavatar";
import { loadEnv, voiceFromEnv } from "../src/env.js";
loadEnv(import.meta.url);
const text = process.argv[2] ?? "yep, on it. give me twenty seconds.";
const out = process.argv[3] ?? "say.wav";
const tts = voiceFromEnv();
const t0 = Date.now(); let first = 0; const parts: Uint8Array[] = [];
for await (const c of tts.synthesize(text, { signal: new AbortController().signal })) { if (!first) first = Date.now() - t0; parts.push(c); }
const pcm = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { pcm.set(p, o); o += p.length; }
writeFileSync(out, liveAvatarPcmToWav(pcm));
console.log(`voice=${tts.voiceId} model=${tts.model} firstByte=${first}ms total=${Date.now() - t0}ms audio=${Math.round(durationMs(pcm.length))}ms -> ${out}`);
