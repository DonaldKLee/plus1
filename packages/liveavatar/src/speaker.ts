/**
 * Streams one utterance of PCM into the avatar and tracks it to completion.
 *
 * Wire behaviour (matches the official SDK and pipecat):
 *  - first chunk 400 ms, then 1 s chunks, all base64 s16le 24 kHz mono
 *  - every chunk and the final `agent.speak_end` carry the utterance's event_id
 *  - the first ~3 s are sent immediately (fast start); after that we pace to
 *    real time so an interrupt discards audio locally instead of having to
 *    drain a huge server buffer
 *  - slow sources (streaming TTS) get partial chunks flushed after a short idle
 *    so time-to-first-audio stays low
 */
import { randomUUID } from "node:crypto";
import { LiveAvatarSocketError, LiveAvatarTimeoutError } from "./errors.js";
import { defaultLogger, type Logger } from "./logger.js";
import { BYTES_PER_SAMPLE, CHUNK_BYTES, FIRST_CHUNK_BYTES, bytesToBase64, durationMs } from "./pcm.js";
import type { ServerEvent } from "./schemas.js";
import type { LiveAvatarSocket } from "./socket.js";

export type PcmSource = Uint8Array | AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

export type UtteranceOutcome = "completed" | "interrupted" | "failed" | "empty";

export interface UtteranceResult {
  id: string;
  outcome: UtteranceOutcome;
  bytesSent: number;
  /** Audio duration actually sent, ms. */
  sentMs: number;
  /** Wall-clock ms from first chunk sent to the server's speak_started (null if never started). */
  startLatencyMs: number | null;
  error?: Error;
}

export interface SpeakOptions {
  /** Seconds of audio to send ahead of real time before pacing kicks in. Default 3. */
  leadSeconds?: number;
  /** Flush a partial chunk if the source has been idle this long. Default 150 ms. */
  idleFlushMs?: number;
  /** Don't flush partial chunks smaller than this many ms. Default 100 ms. */
  minFlushMs?: number;
  /** Extra time after the audio should have finished before we give up waiting for speak_ended. Default 8 s. */
  graceMs?: number;
  /** Called the moment the first chunk goes out. The rig uses this to unmute the mic bus. */
  onFirstChunk?: () => void;
  /** Called when the server reports the avatar started speaking. */
  onStarted?: () => void;
  /** Optional label for logs / the Mind column. */
  label?: string;
}

export interface Utterance {
  readonly id: string;
  readonly label: string | undefined;
  /** Resolves with the outcome; never rejects. */
  readonly done: Promise<UtteranceResult>;
  /** Stop sending, tell the server to drop what it has, resolve `done` with "interrupted". Idempotent. */
  interrupt(): void;
  readonly bytesSent: number;
}

const TIMEOUT: unique symbol = Symbol("timeout");
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", done); clearTimeout(t); resolve(); }
    signal?.addEventListener("abort", done, { once: true });
  });

export function speakUtterance(socket: LiveAvatarSocket, source: PcmSource, opts: SpeakOptions = {}, log: Logger = defaultLogger): Utterance {
  const id = randomUUID();
  const leadMs = (opts.leadSeconds ?? 3) * 1000;
  const idleFlushMs = opts.idleFlushMs ?? 150;
  const minFlushBytes = Math.round(((opts.minFlushMs ?? 100) / 1000) * 48_000);
  const graceMs = opts.graceMs ?? 8_000;

  const abort = new AbortController();
  let bytesSent = 0;
  let firstSentAt: number | null = null;
  let startedAt: number | null = null;
  let interrupted = false;
  let settled = false;

  let resolveDone!: (r: UtteranceResult) => void;
  const done = new Promise<UtteranceResult>((r) => (resolveDone = r));

  const finish = (outcome: UtteranceOutcome, error?: Error) => {
    if (settled) return;
    settled = true;
    socket.off("event", onEvent);
    socket.off("close", onClose);
    abort.abort();
    const result: UtteranceResult = {
      id,
      outcome,
      bytesSent,
      sentMs: durationMs(bytesSent),
      startLatencyMs: firstSentAt != null && startedAt != null ? startedAt - firstSentAt : null,
    };
    if (error) result.error = error;
    log.debug(`utterance ${id.slice(0, 8)} ${outcome} sent=${Math.round(result.sentMs)}ms lat=${result.startLatencyMs ?? "-"}ms`);
    resolveDone(result);
  };

  const matches = (e: { event_id?: string | null; source_event_id?: string | null }) =>
    e.event_id === id || e.source_event_id === id || (e.event_id == null && e.source_event_id == null);

  let sawTalking = false;
  const onEvent = (e: ServerEvent) => {
    switch (e.type) {
      case "agent.speak_started":
        if (matches(e) && startedAt == null) { startedAt = Date.now(); opts.onStarted?.(); }
        break;
      case "agent.speak_ended":
        if (matches(e)) finish(interrupted ? "interrupted" : "completed");
        break;
      case "agent.speak_interrupted":
        if (matches(e)) finish("interrupted");
        break;
      case "agent.state_updated":
        // Fallback completion signal: talking → idle after we've finished sending.
        if (e.new_state === "talking") sawTalking = true;
        else if (sawTalking && e.new_state === "idle" && sendingFinished) finish(interrupted ? "interrupted" : "completed");
        break;
      case "error":
        if (e.error.event_id === id || e.error.event_id == null) {
          finish("failed", new LiveAvatarSocketError(e.error.type ?? null, e.error.message ?? null, e.error.event_id ?? null));
        }
        break;
      default:
        break;
    }
  };
  const onClose = () => finish(interrupted ? "interrupted" : "failed", new LiveAvatarSocketError("closed", "socket closed mid-utterance", id));
  socket.on("event", onEvent);
  socket.on("close", onClose);

  let sendingFinished = false;

  const sendChunk = (bytes: Uint8Array) => {
    socket.send({ type: "agent.speak", event_id: id, audio: bytesToBase64(bytes) });
    if (firstSentAt == null) { firstSentAt = Date.now(); opts.onFirstChunk?.(); }
    bytesSent += bytes.byteLength;
  };

  /** Block until real-time pacing allows the next chunk. */
  const pace = async () => {
    if (firstSentAt == null) return;
    const aheadMs = durationMs(bytesSent) - (Date.now() - firstSentAt);
    if (aheadMs > leadMs) await sleep(aheadMs - leadMs, abort.signal);
  };

  const pump = async () => {
    const it = toAsyncIterator(source);
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let carry: Uint8Array | null = null; // odd trailing byte from a chunk boundary

    const take = (n: number): Uint8Array => {
      const out = new Uint8Array(n);
      let o = 0;
      while (o < n && pending.length) {
        const head = pending[0]!;
        const need = n - o;
        if (head.byteLength <= need) { out.set(head, o); o += head.byteLength; pending.shift(); }
        else { out.set(head.subarray(0, need), o); pending[0] = head.subarray(need); o += need; }
      }
      pendingBytes -= n;
      return out;
    };

    const flushFull = async () => {
      while (!abort.signal.aborted) {
        const target = firstSentAt == null ? FIRST_CHUNK_BYTES : CHUNK_BYTES;
        if (pendingBytes < target) return;
        await pace();
        if (abort.signal.aborted) return;
        sendChunk(take(target));
      }
    };

    const flushPartial = async () => {
      const even = pendingBytes - (pendingBytes % BYTES_PER_SAMPLE);
      if (even <= 0) return;
      await pace();
      if (abort.signal.aborted) return;
      sendChunk(take(even));
    };

    let next = it.next();
    try {
      while (!abort.signal.aborted) {
        const r: IteratorResult<Uint8Array> | typeof TIMEOUT = await Promise.race([next, sleep(idleFlushMs, abort.signal).then((): typeof TIMEOUT => TIMEOUT)]);
        if (abort.signal.aborted) break;
        if (r === TIMEOUT) {
          if (pendingBytes >= minFlushBytes) await flushPartial();
          continue;
        }
        if (r.done) break;
        let chunk = r.value;
        if (carry) { const merged = new Uint8Array(carry.byteLength + chunk.byteLength); merged.set(carry); merged.set(chunk, carry.byteLength); chunk = merged; carry = null; }
        if (chunk.byteLength % 2) { carry = chunk.subarray(chunk.byteLength - 1); chunk = chunk.subarray(0, chunk.byteLength - 1); }
        if (chunk.byteLength) { pending.push(chunk); pendingBytes += chunk.byteLength; }
        await flushFull();
        next = it.next();
      }
      if (!abort.signal.aborted) {
        await flushPartial();
        sendingFinished = true;
        if (bytesSent === 0) { finish("empty"); return; }
        socket.send({ type: "agent.speak_end", event_id: id });
        // Wait for the server to confirm it finished playing.
        const expectedEndAt = (firstSentAt ?? Date.now()) + durationMs(bytesSent);
        const waitMs = Math.max(0, expectedEndAt - Date.now()) + graceMs;
        await sleep(waitMs, abort.signal);
        if (!settled) finish("failed", new LiveAvatarTimeoutError(`speak_ended for utterance ${id.slice(0, 8)}`, waitMs));
      }
    } catch (err) {
      finish("failed", err instanceof Error ? err : new Error(String(err)));
    } finally {
      try { await it.return?.(); } catch { /* source cleanup failure is not our problem */ }
    }
  };

  const utterance: Utterance = {
    id,
    label: opts.label,
    done,
    get bytesSent() { return bytesSent; },
    interrupt() {
      if (settled || interrupted) return;
      interrupted = true;
      abort.abort(); // stops the pump and any pacing sleep
      try {
        if (socket.isReady) socket.send({ type: "agent.interrupt", event_id: id });
      } catch (err) {
        log.warn("interrupt send failed", err);
      }
      // Don't wait on the server: barge-in must be instant from the caller's point of view.
      finish("interrupted");
    },
  };

  void pump();
  return utterance;
}

function toAsyncIterator(source: PcmSource): AsyncIterator<Uint8Array> {
  if (source instanceof Uint8Array) {
    let sent = false;
    return {
      next: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: source })),
      return: async () => ({ done: true, value: undefined }),
    };
  }
  if (Symbol.asyncIterator in source) return (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  const it = (source as Iterable<Uint8Array>)[Symbol.iterator]();
  return {
    next: async () => it.next(),
    return: async () => { it.return?.(); return { done: true, value: undefined }; },
  };
}
