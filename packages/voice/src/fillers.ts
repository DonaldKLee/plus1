/**
 * Pre-cached filler phrases (HLD section 7): "on it", "one sec"... synthesised once, stored as WAV
 * on disk, played the instant the gate fires while the planner is still thinking. Buys ~1 s of
 * perceived latency and it's what a person does on a call.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { liveAvatarPcmToWav, wavToLiveAvatarPcm, type TextToSpeech } from "@plus1/liveavatar";

export type FillerKind = "ack" | "checking" | "wait" | "unsure";

export const DEFAULT_FILLERS: Record<FillerKind, string[]> = {
  ack: ["on it.", "yep, on it.", "sure, doing that now."],
  checking: ["mm, let me check.", "one sec, looking.", "give me a second."],
  wait: ["one sec.", "hang on.", "almost there."],
  unsure: ["hm, not sure. let me look.", "i might be wrong here, checking."],
};

export interface FillerCacheOptions {
  tts: TextToSpeech;
  /** Directory for the WAV cache. Default: packages/voice/.cache */
  dir?: string;
  /** Distinguishes voices in the cache key so switching voices doesn't play stale audio. */
  voiceKey: string;
  phrases?: Partial<Record<FillerKind, string[]>>;
}

export class FillerCache {
  private readonly pcm = new Map<string, Uint8Array>();
  private readonly phrases: Record<FillerKind, string[]>;
  private readonly dir: string;
  private lastIndex = new Map<FillerKind, number>();

  constructor(private readonly opts: FillerCacheOptions) {
    this.dir = opts.dir ?? fileURLToPath(new URL("../.cache/", import.meta.url));
    this.phrases = { ...DEFAULT_FILLERS, ...(opts.phrases as Record<FillerKind, string[]>) };
  }

  /** Load from disk or synthesise every phrase. Safe to call at runner boot; idempotent. */
  async warm(): Promise<{ loaded: number; synthesized: number }> {
    await mkdir(this.dir, { recursive: true });
    let loaded = 0, synthesized = 0;
    for (const list of Object.values(this.phrases)) {
      for (const phrase of list) {
        if (this.pcm.has(phrase)) continue;
        const file = join(this.dir, `${this.key(phrase)}.wav`);
        try {
          this.pcm.set(phrase, wavToLiveAvatarPcm(new Uint8Array(await readFile(file))));
          loaded++;
          continue;
        } catch { /* miss */ }
        const parts: Uint8Array[] = [];
        for await (const c of this.opts.tts.synthesize(phrase, { signal: new AbortController().signal })) parts.push(c);
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
        this.pcm.set(phrase, out);
        await writeFile(file, liveAvatarPcmToWav(out));
        synthesized++;
      }
    }
    return { loaded, synthesized };
  }

  /** Exact phrase lookup. */
  get(phrase: string): Uint8Array | undefined { return this.pcm.get(phrase); }

  /** Next filler of a kind, rotating so the goose doesn't repeat itself back-to-back. */
  pick(kind: FillerKind): { phrase: string; pcm: Uint8Array } | undefined {
    const list = this.phrases[kind].filter((p) => this.pcm.has(p));
    if (list.length === 0) return undefined;
    const i = ((this.lastIndex.get(kind) ?? -1) + 1) % list.length;
    this.lastIndex.set(kind, i);
    const phrase = list[i]!;
    return { phrase, pcm: this.pcm.get(phrase)! };
  }

  get size(): number { return this.pcm.size; }

  private key(phrase: string): string {
    return createHash("sha1").update(`${this.opts.voiceKey}|${phrase}`).digest("hex").slice(0, 16);
  }
}
