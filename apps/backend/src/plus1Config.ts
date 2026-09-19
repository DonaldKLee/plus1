/**
 * plus1.config.json — the shared, committed config for the plus1 character.
 *
 * The voice and avatar IDs live here (not in each person's .env) so everyone runs
 * the same character. A real .env value still wins, but nobody NEEDS one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Plus1Config {
  /** Default name of the plus1 character (used when a persona doesn't override). */
  defaultName: string;
  elevenlabsVoiceId: string;
  liveavatarAvatarId: string;
}

const FALLBACK: Plus1Config = {
  defaultName: "Shannon",
  elevenlabsVoiceId: "",
  liveavatarAvatarId: "",
};

function load(): Plus1Config {
  try {
    const path = fileURLToPath(new URL("../../../plus1.config.json", import.meta.url));
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Plus1Config>;
    return { ...FALLBACK, ...raw };
  } catch {
    return FALLBACK;
  }
}

export const plus1Config = load();

// Fill the env the voice + avatar code already reads, so the committed config is
// the single source of truth. An explicit .env value is left untouched (it wins).
if (!process.env.ELEVENLABS_VOICE_ID && plus1Config.elevenlabsVoiceId) {
  process.env.ELEVENLABS_VOICE_ID = plus1Config.elevenlabsVoiceId;
}
if (!process.env.LIVEAVATAR_AVATAR_ID && plus1Config.liveavatarAvatarId) {
  process.env.LIVEAVATAR_AVATAR_ID = plus1Config.liveavatarAvatarId;
}
