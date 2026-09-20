/**
 * ElevenLabs streaming TTS -> PCM 16-bit 24 kHz mono, exactly what LiveAvatar wants.
 *
 * Uses POST /v1/text-to-speech/{voice}/stream?output_format=pcm_24000 and yields the
 * response body as it arrives (~450 ms to first byte with eleven_flash_v2_5), so the
 * avatar starts moving before synthesis has finished. Implements the `TextToSpeech`
 * interface from @plus1/liveavatar.
 */
import type { TextToSpeech } from "@plus1/liveavatar";
import { VoiceError } from "./errors.js";

export const ELEVENLABS_API_URL = "https://api.elevenlabs.io";

/** Low-latency models first. flash_v2_5 is the right default for a live conversation. */
export type ElevenLabsModel = "eleven_flash_v2_5" | "eleven_turbo_v2_5" | "eleven_multilingual_v2" | "eleven_v3" | (string & {});

export interface VoiceSettings {
  /** 0..1. Lower = more expressive/variable, higher = more monotone. */
  stability?: number;
  similarity_boost?: number;
  /** 0..1, style exaggeration. Costs latency; keep low for flash. */
  style?: number;
  use_speaker_boost?: boolean;
  /** 0.7..1.2 */
  speed?: number;
}

export interface ElevenLabsTtsOptions {
  apiKey: string;
  /** Default: Daniel, a steady British broadcaster: the plus1's "slightly-too-formal middle manager". */
  voiceId?: string;
  model?: ElevenLabsModel;
  voiceSettings?: VoiceSettings;
  /** ISO 639-1; only used by models that accept it. */
  languageCode?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Abort if the first byte hasn't arrived by then. Default 6 s. */
  firstByteTimeoutMs?: number;
  /** Called after every request with the characters billed. Handy on the free tier. */
  onUsage?: (chars: number) => void;
}

export const DEFAULT_VOICE_ID = "onwK4e9ZLuTAKqWW03F9"; // Daniel
export const plus1_VOICE_SETTINGS: VoiceSettings = { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.04 };

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export class ElevenLabsTts implements TextToSpeech {
  readonly voiceId: string;
  readonly model: ElevenLabsModel;
  private readonly opts: ElevenLabsTtsOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private _charsUsed = 0;

  constructor(opts: ElevenLabsTtsOptions) {
    if (!opts.apiKey) throw new VoiceError("AUTH", "ElevenLabsTts needs an apiKey (ELEVENLABS_API_KEY)");
    this.opts = opts;
    this.voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
    this.model = opts.model ?? "eleven_flash_v2_5";
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (opts.baseUrl ?? ELEVENLABS_API_URL).replace(/\/+$/, "");
  }

  /** Characters sent to the API by this instance (what the free tier meters). */
  get charsUsed(): number { return this._charsUsed; }

  /** Streams PCM 24 kHz mono s16le. Honour `signal` for barge-in: it cancels the HTTP body mid-stream. */
  async *synthesize(text: string, { signal }: { signal: AbortSignal }): AsyncIterable<Uint8Array> {
    const clean = normalizeText(text);
    if (!clean) return;
    if (clean.length > 5_000) throw new VoiceError("BAD_INPUT", `text too long for one request (${clean.length} chars > 5000)`);
    if (signal.aborted) return;

    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const firstByteTimer = setTimeout(() => ctl.abort(new VoiceError("TIMEOUT", "ElevenLabs: no audio within firstByteTimeout")), this.opts.firstByteTimeoutMs ?? 6_000);

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(this.voiceId)}/stream?output_format=pcm_24000`, {
        method: "POST",
        headers: { "xi-api-key": this.opts.apiKey, "content-type": "application/json", accept: "audio/pcm" },
        body: JSON.stringify({
          text: clean,
          model_id: this.model,
          voice_settings: { ...plus1_VOICE_SETTINGS, ...this.opts.voiceSettings },
          ...(this.opts.languageCode ? { language_code: this.opts.languageCode } : {}),
        }),
        signal: ctl.signal,
      });
    } catch (err) {
      clearTimeout(firstByteTimer);
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) return; // barge-in before the request landed: silently produce nothing
      if (ctl.signal.reason instanceof VoiceError) throw ctl.signal.reason;
      throw new VoiceError("API_ERROR", `ElevenLabs request failed: ${(err as Error).message}`);
    }

    if (!res.ok || !res.body) {
      clearTimeout(firstByteTimer);
      signal.removeEventListener("abort", onAbort);
      const body = await res.text().catch(() => "");
      const code = res.status === 401 || res.status === 403 ? "AUTH" : res.status === 402 || res.status === 429 ? "QUOTA" : "API_ERROR";
      throw new VoiceError(code, `ElevenLabs HTTP ${res.status}: ${body.slice(0, 300)}`, res.status, body);
    }
    this._charsUsed += clean.length;
    this.opts.onUsage?.(clean.length);

    // Align to whole 16-bit samples across chunk boundaries so a consumer never sees a torn sample.
    let carry: Uint8Array | null = null;
    let first = true;
    try {
      for await (const raw of res.body as unknown as AsyncIterable<Uint8Array>) {
        if (first) { clearTimeout(firstByteTimer); first = false; }
        let chunk: Uint8Array = raw;
        if (carry) { const m = new Uint8Array(carry.length + chunk.length); m.set(carry); m.set(chunk, carry.length); chunk = m; carry = null; }
        if (chunk.length % 2) { carry = chunk.subarray(chunk.length - 1); chunk = chunk.subarray(0, chunk.length - 1); }
        if (chunk.length) yield chunk;
      }
    } catch (err) {
      if (signal.aborted) return; // barge-in mid-stream: expected
      if (ctl.signal.reason instanceof VoiceError) throw ctl.signal.reason;
      throw new VoiceError("API_ERROR", `ElevenLabs stream failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(firstByteTimer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** Synthesize to one buffer (fillers, tests). */
  async synthesizeAll(text: string, signal: AbortSignal = new AbortController().signal): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    for await (const c of this.synthesize(text, { signal })) parts.push(c);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  async listVoices(): Promise<ElevenLabsVoice[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/voices`, { headers: { "xi-api-key": this.opts.apiKey } });
    if (!res.ok) throw new VoiceError(res.status === 401 ? "AUTH" : "API_ERROR", `ElevenLabs /v1/voices HTTP ${res.status}`, res.status);
    const json = (await res.json()) as { voices: ElevenLabsVoice[] };
    return json.voices;
  }

  async subscription(): Promise<{ tier: string; character_count: number; character_limit: number }> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/user/subscription`, { headers: { "xi-api-key": this.opts.apiKey } });
    if (!res.ok) throw new VoiceError(res.status === 401 ? "AUTH" : "API_ERROR", `ElevenLabs /v1/user/subscription HTTP ${res.status}`, res.status);
    return (await res.json()) as { tier: string; character_count: number; character_limit: number };
  }
}

/** Collapse whitespace; drop markdown-ish noise the planner might leak; keep the lowercase plus1 voice as written. */
export function normalizeText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]+/g, "")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/\s+/g, " ")
    .trim();
}
