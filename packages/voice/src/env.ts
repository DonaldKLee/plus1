import { ElevenLabsTts } from "./elevenlabs.js";
import { VoiceError } from "./errors.js";

/** Build the production TTS from env (ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL). */
export function voiceFromEnv(env: NodeJS.ProcessEnv = process.env): ElevenLabsTts {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new VoiceError("AUTH", "ELEVENLABS_API_KEY is not set");
  return new ElevenLabsTts({ apiKey, voiceId: env.ELEVENLABS_VOICE_ID || undefined, model: env.ELEVENLABS_MODEL || undefined });
}

/** Load repo-root .env then package-local .env. Dev scripts only. */
export function loadEnv(importMetaUrl: string): void {
  for (const rel of ["../../../.env", "../.env"]) {
    try { process.loadEnvFile(new URL(rel, importMetaUrl)); } catch { /* absent */ }
  }
}
