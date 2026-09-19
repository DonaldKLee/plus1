/** Warm the filler cache for the configured voice (run once per voice; costs a few hundred chars). */
import { FillerCache } from "../src/fillers.js";
import { loadEnv, voiceFromEnv } from "../src/env.js";
loadEnv(import.meta.url);
const tts = voiceFromEnv();
const cache = new FillerCache({ tts, voiceKey: `${tts.voiceId}:${tts.model}` });
const r = await cache.warm();
console.log(`fillers ready: ${cache.size} phrases (${r.loaded} from disk, ${r.synthesized} synthesized, ${tts.charsUsed} chars billed)`);
