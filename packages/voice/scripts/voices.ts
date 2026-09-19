import { loadEnv, voiceFromEnv } from "../src/env.js";
loadEnv(import.meta.url);
const tts = voiceFromEnv();
const [voices, sub] = await Promise.all([tts.listVoices(), tts.subscription()]);
console.log(`tier=${sub.tier} used=${sub.character_count}/${sub.character_limit} chars`);
console.table(voices.map((v) => ({ id: v.voice_id, name: v.name, category: v.category, accent: v.labels?.accent, gender: v.labels?.gender })));
