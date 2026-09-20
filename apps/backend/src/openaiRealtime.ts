/**
 * OpenAI Realtime speech-to-speech path for Meet sessions (TALK_BACKEND=openai).
 *
 * Room PCM (16 kHz from the Meet tap) is upsampled to 24 kHz, streamed over a
 * WebSocket, and response audio deltas are pumped into LiveAvatar as 24 kHz PCM.
 * Function calls land in the existing executeTool chain.
 *
 * Gemini Live transcription + ElevenLabs TTS (TALK_BACKEND=legacy) are the
 * parallel talk stack — same tools, avatar, and Meet join.
 */
import { bytesToInt16, int16ToBytes, resampleLinear } from "@plus1/liveavatar";
import { envOptional } from "./env.js";
import { executeTool, type ToolResult } from "./tools.js";
import type { ToolAccess } from "./agentBrain.js";
import { FEDERATO_TOOL_DOCS } from "./federatoTools.js";

const WS = (globalThis as { WebSocket: new (url: string, protocols?: string | string[]) => RealtimeSocket }).WebSocket;

interface RealtimeSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((e?: { message?: string }) => void) | null;
  onclose: (() => void) | null;
}

const OPEN = 1;

export type TalkBackend = "legacy" | "openai";

export function talkBackendOf(): TalkBackend {
  const v = (envOptional("TALK_BACKEND") ?? "legacy").trim().toLowerCase();
  return v === "openai" ? "openai" : "legacy";
}

/** Upsample Meet-tap PCM (16 kHz s16le) to OpenAI / LiveAvatar (24 kHz). */
export function upsample16kTo24k(pcm16: Uint8Array): Uint8Array {
  const samples = bytesToInt16(pcm16);
  return int16ToBytes(resampleLinear(samples, 16_000, 24_000));
}

/** Async queue of PCM chunks — fed by Realtime deltas, drained by AvatarRig.speakPcm. */
export class PcmChunkQueue implements AsyncIterable<Uint8Array> {
  private chunks: Uint8Array[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;

  push(chunk: Uint8Array): void {
    if (this.closed || chunk.byteLength === 0) return;
    this.chunks.push(chunk);
    const w = this.waiters.shift();
    w?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters.splice(0)) w();
  }

  get ended(): boolean {
    return this.closed && this.chunks.length === 0;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    while (true) {
      while (this.chunks.length === 0) {
        if (this.closed) return;
        await new Promise<void>((r) => this.waiters.push(r));
      }
      const next = this.chunks.shift();
      if (next) yield next;
    }
  }
}

export interface RealtimeToolDef {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface OpenAIRealtimeHandlers {
  onNote: (msg: string) => void;
  /** Room heard the user (input transcript). */
  onUserTranscript: (text: string, partial: boolean) => void;
  /** Plus1 is speaking (output transcript). */
  onAgentTranscript: (text: string, partial: boolean) => void;
  /** Start pumping this queue into LiveAvatar; return a handle to interrupt.
   *  `done` resolves when LiveAvatar finishes draining (or is interrupted). */
  onSpeakStart: (
    queue: PcmChunkQueue,
    label?: string,
  ) => { interrupt: () => void; done?: Promise<unknown> };
  onSpeakEnd: () => void;
  /** Barge-in from the room while the plus1 is talking. */
  onBargeIn: () => void;
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  /** Surface a tool/speak turn in the dashboard decisions panel. */
  onDecision?: (d: {
    action: "speak" | "tool";
    reason: string;
    say?: string;
    tool?: { name: string; query?: string };
    outcome?: string;
  }) => void;
  /** Meet chat for share links, etc. May be async so we wait until it's posted. */
  onShareUrl?: (url: string) => void | Promise<void>;
}

export interface OpenAIRealtimeOpts {
  apiKey: string;
  model?: string;
  voice?: string;
  /** Display name of the plus1 (e.g. Shannon) — used in the join greeting. */
  name?: string;
  instructions: string;
  tools: RealtimeToolDef[];
  handlers: OpenAIRealtimeHandlers;
  /** Fire a short greeting once the session is ready. */
  greetOnReady?: boolean;
}

/**
 * Build the Realtime function list from the same tools the Gemini brain can call.
 * Args are deliberately loose (query + details object) so the model can pass
 * whatever it gathered from speech.
 */
export function realtimeToolsFor(access: ToolAccess): RealtimeToolDef[] {
  const tools: RealtimeToolDef[] = [];
  const q = {
    type: "object",
    properties: {
      query: { type: "string", description: "Search string, account name, goal, filter, or free-text argument." },
      details: { type: "object", description: "Structured fields when needed (Intact quote, email)." },
      content: { type: "string", description: "Long text body when writing a document." },
      command: { type: "string", description: "Shell command for run_command only." },
      path: { type: "string", description: "File path for file tools." },
    },
    additionalProperties: true,
  };

  if (access.federato !== false) {
    for (const doc of FEDERATO_TOOL_DOCS) {
      tools.push({
        type: "function",
        name: doc.name,
        description: doc.doc,
        parameters: q,
      });
    }
  }
  if (access.intact !== false) {
    const intactDocs: { name: string; description: string }[] = [
      {
        name: "intact_explain",
        description:
          "Explain a personal-insurance term or coverage in plain language (deductible, liability, collision, comprehensive, accident benefits, etc.). Use for general insurance questions — NOT Federato/commercial UW.",
      },
      {
        name: "intact_quote_car",
        description:
          "Quote PERSONAL car/auto insurance (Intact Canada). Put known fields in details: driverAge, province, city, vehicleYear/Make/Model, coverage, deductible, etc. Call early with defaults — don't interrogate.",
      },
      {
        name: "intact_quote_tenant",
        description:
          "Quote TENANT/renter insurance (Intact). details: province, city, dwellingType, contentsValue, liabilityLimit, etc.",
      },
      {
        name: "intact_vehicle_lookup",
        description: "Decode a VIN to year/make/model. Put VIN in query or details.vin, then quote.",
      },
      {
        name: "intact_quote_pdf",
        description:
          "Render an Intact PERSONAL quote PDF. Link posts to Meet chat automatically. Only call email_send after if they asked to email it (attachPdf:'last'). When this returns, the PDF is DONE — never say still generating.",
      },
      {
        name: "intact_email_quote",
        description: "Legacy alias for intact_quote_pdf — prefer intact_quote_pdf.",
      },
      {
        name: "intact_next_step",
        description:
          "Buy path / broker next step after an Intact quote. Use instead of a price when appetite is high_risk/refer.",
      },
    ];
    for (const t of intactDocs) {
      tools.push({ type: "function", name: t.name, description: t.description, parameters: q });
    }
  }
  if (access.docs) {
    // doc_pdf deliberately not exposed — reports/quotes use federato_quote_pdf / intact_quote_pdf.
  }
  if (access.email) {
    tools.push({
      type: "function",
      name: "email_send",
      description:
        "Email someone. details: to (optional — uses plus1 default recipient), subject, body, attachPdf: 'last' for the PDF just generated. Sends on the first call unless the tool reply says pendingApproval (then call again with confirm:true). Use ONLY when they asked to email / mail it — reports go to Meet chat by default without this tool.",
      parameters: q,
    });
    tools.push({
      type: "function",
      name: "email_status",
      description: "Check whether email SMTP is configured and who it sends as.",
      parameters: q,
    });
  }
  if (access.browser !== false) {
    tools.push({
      type: "function",
      name: "browser_work",
      description:
        "Share YOUR screen and drive the cloud browser. HOUSE / show the property: query like 'show the house at <full street address> on Google Maps Street View' — opens normal Maps (NOT Directions), then exterior Street View from the curb facing the front (never indoors). Flood map / FEMA: 'flood map for <address>'. Details go to Meet chat; say one short line. Leave the share up.",
      parameters: q,
    });
    tools.push({
      type: "function",
      name: "browser_unshare",
      description:
        "Stop presenting / stop sharing your screen in Meet. Call when they say stop sharing, stop presenting, unshare, or take your screen down. No query needed.",
      parameters: { type: "object", properties: {}, additionalProperties: true },
    });
  }
  if (access.files === "read" || access.files === "write") {
    tools.push({ type: "function", name: "list_files", description: "List files in the shared folder.", parameters: q });
    tools.push({ type: "function", name: "read_file", description: "Read a text file from the shared folder.", parameters: q });
  }
  if (access.files === "write") {
    tools.push({ type: "function", name: "write_file", description: "Write a text file in the shared folder.", parameters: q });
    tools.push({ type: "function", name: "run_command", description: "Run a shell command. Put the exact bash in command.", parameters: q });
  }
  return tools;
}

export class OpenAIRealtimeSession {
  private ws: RealtimeSocket | null = null;
  private ready = false;
  private closed = false;
  private currentItemId: string | undefined;
  private currentResponseId: string | undefined;
  private pump: PcmChunkQueue | null = null;
  /** Queued after a prior utterance — kept even when `pump` is nulled on audio.done. */
  private pendingPump: PcmChunkQueue | null = null;
  private speakHandle: { interrupt: () => void; done?: Promise<unknown> } | null = null;
  private agentPartial = "";
  private userPartial = "";
  private toolBusy = false;
  private handledCalls = new Set<string>();
  /** Drop late audio deltas after a barge-in until the next response.created. */
  private ignoreAudioUntilNextResponse = false;
  /** Ignore false barge-ins for a beat after we start talking (echo / trailing user audio). */
  private speakStartedAt = 0;
  private responseCreatedAt = 0;
  private greeted = false;
  private instructions: string;
  private readonly opts: OpenAIRealtimeOpts;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(opts: OpenAIRealtimeOpts) {
    this.opts = opts;
    this.instructions = opts.instructions;
  }

  get isReady(): boolean {
    return this.ready && !this.closed;
  }

  /** True while Realtime audio is pumping into the avatar. */
  get isSpeaking(): boolean {
    return !!(this.speakHandle || this.pump);
  }

  /** Wait until session.updated has landed (or timeout). */
  async waitUntilReady(timeoutMs = 12_000): Promise<boolean> {
    if (this.isReady) return true;
    const start = Date.now();
    while (!this.closed && Date.now() - start < timeoutMs) {
      if (this.isReady) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.isReady;
  }

  connect(): void {
    if (this.closed) return;
    const model = this.opts.model ?? envOptional("OPENAI_REALTIME_MODEL") ?? "gpt-realtime-2.1";
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    let ws: RealtimeSocket;
    try {
      // Browser/Node WebSocket: auth via subprotocol is not standard; Node 22
      // global WebSocket accepts a second argument as protocols only. We use
      // the undocumented headers path when available (undici), else query+header
      // polyfill via a thin wrapper. Prefer the openai SDK pattern: pass headers
      // if the constructor supports it.
      ws = createAuthedSocket(url, this.opts.apiKey);
    } catch (e) {
      this.opts.handlers.onNote(`OpenAI Realtime connect failed: ${(e as Error).message}`);
      return;
    }
    this.ws = ws;
    this.ready = false;

    ws.onopen = () => {
      this.opts.handlers.onNote(`OpenAI Realtime connected (${model}).`);
      this.sendSessionUpdate();
    };
    ws.onmessage = (ev) => void this.handleMessage(ev.data);
    ws.onerror = (e) => this.opts.handlers.onNote(`OpenAI Realtime error: ${e?.message ?? "socket error"}`);
    ws.onclose = () => {
      this.ready = false;
      this.ws = null;
      if (!this.closed) {
        this.opts.handlers.onNote("OpenAI Realtime closed — reconnecting.");
        this.reconnectTimer = setTimeout(() => {
          if (!this.closed) this.connect();
        }, 1200);
      }
    };
  }

  private sendSessionUpdate(): void {
    const voice = this.opts.voice ?? envOptional("OPENAI_REALTIME_VOICE") ?? "coral";
    // high ≈ ~2s max wait (snappy); medium/auto ≈ 4s; low ≈ 8s.
    const eagerness = (envOptional("OPENAI_REALTIME_EAGERNESS") ?? "high").trim().toLowerCase();
    const eagernessSafe =
      eagerness === "low" || eagerness === "medium" || eagerness === "auto" ? eagerness : "high";
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        model: this.opts.model ?? envOptional("OPENAI_REALTIME_MODEL") ?? "gpt-realtime-2.1",
        output_modalities: ["audio"],
        instructions: this.instructions,
        tools: this.opts.tools,
        tool_choice: "auto",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            turn_detection: {
              type: "semantic_vad",
              eagerness: eagernessSafe,
              create_response: true,
              // Critical for barge-in: cancel the model the moment VAD hears you.
              interrupt_response: true,
            },
            transcription: { model: "gpt-4o-mini-transcribe" },
          },
          output: {
            format: { type: "audio/pcm", rate: 24_000 },
            voice,
          },
        },
      },
    });
  }

  /** Refresh system instructions mid-session (e.g. new participant names). */
  updateInstructions(instructions: string): void {
    this.instructions = instructions;
    if (this.ready) this.sendSessionUpdate();
  }

  /** Ask the model to speak once — used for the join greeting. */
  requestGreeting(opts?: { participants?: string[] }): void {
    if (this.greeted || this.closed) return;
    if (!this.ready) {
      void this.waitUntilReady(10_000).then((ok) => {
        if (ok && !this.greeted && !this.closed) this.requestGreeting(opts);
      });
      return;
    }
    this.greeted = true;
    const who = this.opts.name?.trim() || "Shannon";
    const people = (opts?.participants ?? []).filter(Boolean);
    const nameBit =
      people.length === 1
        ? `Open with "Hi ${people[0]}, I'm ${who}" — use that first name, never "everyone".`
        : people.length > 1
          ? `Open with "Hi ${people.slice(0, 4).join(", ")}, I'm ${who}" — use those first names, never "everyone".`
          : `Open with "Hi everyone, I'm ${who}" — do NOT ask for anyone's name.`;
    this.send({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: `You just joined this Google Meet. Your name is ${who} — never ChatGPT, never "an AI".
${nameBit}
One short warm sentence total: greeting + that you can help with Intact quotes, Federato underwriting, docs, or screen share.
Do NOT say you'll hang back / wait until they're ready. Then stop and listen.
This is the ONLY time you introduce yourself this call.`,
      },
    });
    // Lock identity for later turns so tool answers don't re-greet.
    this.instructions = `${this.instructions}\n\nALREADY GREETED THIS CALL as ${who}. Never re-introduce yourself again.\n`;
    this.sendSessionUpdate();
  }

  /** Append one Meet-tap frame (16 kHz s16le base64 from the page). */
  appendMeetPcm16kBase64(b64: string): void {
    if (!this.ready || !this.ws || this.ws.readyState !== OPEN) return;
    let raw: Uint8Array;
    try {
      raw = Buffer.from(b64, "base64");
    } catch {
      return;
    }
    const pcm24 = upsample16kTo24k(raw);
    this.send({
      type: "input_audio_buffer.append",
      audio: Buffer.from(pcm24).toString("base64"),
    });
  }

  /** Stop local playback and tell OpenAI to drop unplayed audio. */
  bargeIn(): void {
    this.ignoreAudioUntilNextResponse = true;
    const handle = this.speakHandle;
    this.speakHandle = null;
    handle?.interrupt();
    this.pump?.close();
    this.pump = null;
    this.pendingPump?.close();
    this.pendingPump = null;
    if (handle) this.opts.handlers.onSpeakEnd();
    if (this.currentItemId) {
      this.send({
        type: "conversation.item.truncate",
        item_id: this.currentItemId,
        content_index: 0,
        // 0 = none of this item was heard — model history matches the cut.
        audio_end_ms: 0,
      });
      this.currentItemId = undefined;
    }
    if (this.currentResponseId) {
      this.send({ type: "response.cancel" });
      this.currentResponseId = undefined;
    }
    this.agentPartial = "";
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.bargeIn();
    try {
      this.ws?.close();
    } catch {
      /* already closing */
    }
    this.ws = null;
    this.ready = false;
  }

  private send(obj: Record<string, unknown>): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      this.opts.handlers.onNote(`OpenAI send failed: ${(e as Error).message}`);
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    let text: string;
    if (typeof data === "string") text = data;
    else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString();
    else if (data && typeof (data as Blob).arrayBuffer === "function") {
      text = Buffer.from(await (data as Blob).arrayBuffer()).toString();
    } else text = String(data);

    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(evt.type ?? "");

    switch (type) {
      case "session.created":
        this.ready = true;
        break;
      case "session.updated":
        this.ready = true;
        if (this.opts.greetOnReady) this.requestGreeting();
        break;

      case "error": {
        const err = evt.error as { message?: string } | undefined;
        this.opts.handlers.onNote(`OpenAI Realtime: ${err?.message ?? JSON.stringify(evt.error)}`);
        break;
      }

      case "input_audio_buffer.speech_started": {
        // Don't cut our own tool-answer / announce audio on room noise.
        if (this.toolBusy) break;
        if (!(this.speakHandle || this.pump || this.pendingPump || this.currentResponseId || this.currentItemId)) {
          break;
        }
        const now = Date.now();
        // Trailing end of the user's question often fires speech_started right as
        // we start answering — that was cutting "I'll keep it quick and…".
        if (now - this.speakStartedAt < 2_000) break;
        if (now - this.responseCreatedAt < 1_200) break;
        this.opts.handlers.onBargeIn();
        this.bargeIn();
        break;
      }

      case "conversation.item.input_audio_transcription.delta": {
        const delta = String(evt.delta ?? "");
        if (!delta) break;
        this.userPartial += delta;
        this.opts.handlers.onUserTranscript(this.userPartial, true);
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const transcript = String(evt.transcript ?? this.userPartial).trim();
        this.userPartial = "";
        if (transcript) this.opts.handlers.onUserTranscript(transcript, false);
        break;
      }

      case "response.created":
        this.ignoreAudioUntilNextResponse = false;
        this.responseCreatedAt = Date.now();
        this.currentResponseId = typeof evt.response === "object" && evt.response
          ? String((evt.response as { id?: string }).id ?? "")
          : undefined;
        this.agentPartial = "";
        break;

      case "response.output_item.added": {
        const item = evt.item as { id?: string; type?: string } | undefined;
        if (item?.id) this.currentItemId = item.id;
        break;
      }

      case "response.output_audio.delta":
      case "response.audio.delta": {
        if (this.ignoreAudioUntilNextResponse) break;
        const delta = String(evt.delta ?? "");
        if (!delta) break;
        this.ensurePump(String(evt.item_id ?? this.currentItemId ?? "speak"));
        try {
          this.pump!.push(Buffer.from(delta, "base64"));
        } catch {
          /* bad chunk */
        }
        break;
      }

      case "response.output_audio.done":
      case "response.audio.done":
        // Close so the iterator can finish; pendingPump keeps the ref for deferred play.
        this.pump?.close();
        this.pump = null;
        break;

      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const delta = String(evt.delta ?? "");
        if (!delta) break;
        this.agentPartial += delta;
        this.opts.handlers.onAgentTranscript(this.agentPartial, true);
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const transcript = String(evt.transcript ?? this.agentPartial).trim();
        this.agentPartial = "";
        if (transcript) {
          this.opts.handlers.onAgentTranscript(transcript, false);
          this.opts.handlers.onDecision?.({
            action: "speak",
            reason: "OpenAI Realtime spoke",
            say: transcript,
            outcome: "spoken",
          });
        }
        break;
      }

      case "response.function_call_arguments.done":
        void this.handleFunctionCall(evt);
        break;

      case "response.output_item.done": {
        const item = evt.item as {
          type?: string;
          name?: string;
          arguments?: string;
          call_id?: string;
        } | undefined;
        if (item?.type === "function_call" && item.call_id && item.name) {
          // Prefer function_call_arguments.done; this is a fallback.
          if (!this.toolBusy) {
            void this.handleFunctionCall({
              name: item.name,
              arguments: item.arguments ?? "{}",
              call_id: item.call_id,
            });
          }
        }
        break;
      }

      case "response.done":
        this.pump?.close();
        this.pump = null;
        this.currentResponseId = undefined;
        break;

      default:
        break;
    }
  }

  private ensurePump(label: string): void {
    if (this.pump && !this.pump.ended) return;
    // Reuse the deferred queue if we're still collecting tool-answer audio
    // while the announce line is playing.
    if (this.pendingPump && !this.pendingPump.ended) {
      this.pump = this.pendingPump;
      return;
    }

    // Still draining a prior utterance — buffer PCM and speak when it finishes.
    // Critical: do NOT require `this.pump === q` later. audio.done nulls `pump`
    // after closing the queue; that used to drop the tool-result line entirely.
    if (this.speakHandle) {
      const q = new PcmChunkQueue();
      this.pump = q;
      this.pendingPump = q;
      const prev = this.speakHandle;
      void prev.done?.finally(() => {
        if (this.pendingPump !== q) return;
        this.pendingPump = null;
        if (this.ignoreAudioUntilNextResponse) {
          q.close();
          return;
        }
        this.attachSpeak(q, label);
      });
      return;
    }

    this.pump = new PcmChunkQueue();
    this.attachSpeak(this.pump, label);
  }

  private attachSpeak(queue: PcmChunkQueue, label: string): void {
    let handle: { interrupt: () => void; done?: Promise<unknown> };
    try {
      handle = this.opts.handlers.onSpeakStart(queue, label.slice(0, 60));
    } catch (e) {
      queue.close();
      if (this.pump === queue) this.pump = null;
      if (this.pendingPump === queue) this.pendingPump = null;
      this.opts.handlers.onNote(`OpenAI speak start failed: ${(e as Error).message}`);
      return;
    }
    this.speakHandle = handle;
    this.speakStartedAt = Date.now();
    void handle.done?.then(() => {
      if (this.speakHandle !== handle) return;
      this.speakHandle = null;
      this.opts.handlers.onSpeakEnd();
    });
  }

  private async handleFunctionCall(evt: Record<string, unknown>): Promise<void> {
    const name = String(evt.name ?? "");
    const callId = String(evt.call_id ?? "");
    const rawArgs = String(evt.arguments ?? "{}");
    if (!name || !callId) return;
    if (this.handledCalls.has(callId)) return;
    this.handledCalls.add(callId);
    this.toolBusy = true;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      args = { query: rawArgs };
    }
    // Models sometimes pass a bare string or nest under goal/filter/account.
    if (typeof args.query !== "string") {
      const alt =
        (typeof args.goal === "string" && args.goal) ||
        (typeof args.filter === "string" && args.filter) ||
        (typeof args.account === "string" && args.account) ||
        (typeof args.topic === "string" && args.topic) ||
        (typeof args.dimension === "string" && args.dimension) ||
        undefined;
      if (alt) args.query = alt;
    }
    const queryPreview =
      typeof args.query === "string"
        ? args.query.slice(0, 120)
        : args.details
          ? JSON.stringify(args.details).slice(0, 120)
          : undefined;
    this.opts.handlers.onNote(`tool ${name}…`);
    this.opts.handlers.onDecision?.({
      action: "tool",
      reason: `OpenAI Realtime → ${name}`,
      tool: { name, query: queryPreview },
      outcome: "acting",
    });
    let result: ToolResult;
    try {
      result = await this.opts.handlers.onToolCall(name, args);
    } catch (e) {
      result = { text: `tool error: ${(e as Error).message}` };
    }
    if (result.shareUrl) {
      try {
        await this.opts.handlers.onShareUrl?.(result.shareUrl);
      } catch {
        /* chat post is best-effort */
      }
    }
    for (const line of result.trace ?? []) {
      this.opts.handlers.onNote(`  why: ${line}`);
    }
    this.opts.handlers.onDecision?.({
      action: "tool",
      reason: `OpenAI Realtime → ${name}`,
      tool: { name, query: queryPreview },
      say: result.text.slice(0, 240),
      outcome: result.text.slice(0, 160),
    });
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          text: result.text,
          pdfUrl: result.pdfUrl,
          shareUrl: result.shareUrl,
          pendingApproval: result.pendingApproval,
          trace: result.trace,
        }),
      },
    });
    // Let the announce line finish before asking for the tool-answer response,
    // so the second utterance attaches cleanly instead of racing the first pump.
    const prior = this.speakHandle?.done;
    if (prior) await prior.catch(() => undefined);

    const pdfTool = /_quote_pdf$|_email_quote$|^federato_quote_pdf$|^doc_pdf$/.test(name);
    const emailTool = name === "email_send" || name === "email_draft";
    const browserWork = name === "browser_work";
    let followUp: string;
    if (browserWork) {
      followUp = `Continue the same conversation. You already introduced yourself — do NOT greet.
browser_work finished. Details are already in Meet chat. Speak ONE short line only (e.g. "got it — it's on my screen"). Do NOT narrate steps or URLs.`;
    } else if (pdfTool) {
      followUp = `Continue the same conversation. Do NOT greet.
The PDF tool FINISHED — it is not still generating. ${result.shareUrl ? "The link is already in Meet chat." : "The PDF is ready."}
- If they asked to email / mail it (this turn or just before): call email_send NOW with details.attachPdf="last", a short subject/body, and the default recipient if no address was given.
- Otherwise: speak ONE short line that it's in the chat (or ready). Do NOT call email_send. Do NOT say "generating in the background" / "working on it" / "still putting it together".`;
    } else if (emailTool) {
      followUp = result.pendingApproval
        ? `Email draft is ready for approval. Speak one short line asking them to confirm. Do NOT claim you already sent it.`
        : `Email tool finished. Speak one short line confirming it sent (or what failed). Do NOT regenerate the PDF. Do NOT say you're still generating.`;
    } else {
      followUp = `Continue the same conversation. You already introduced yourself — do NOT greet or say your name again.

If the user asked to email / send this PDF and you have not emailed yet, call email_send NOW with details.attachPdf="last".
If they already got a PDF and are nudging "send it" / "email it", call email_send — do NOT regenerate the PDF and do NOT say it's still generating.

Otherwise speak the tool result in one or two short sentences — no greeting.`;
    }

    this.send({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: followUp,
      },
    });
    this.toolBusy = false;
  }
}

/**
 * Node's global WebSocket (undici) accepts a `headers` option.
 * GA Realtime: Authorization only — do NOT send OpenAI-Beta: realtime=v1
 * (that forces the retired beta shape and returns the error the user saw).
 */
function createAuthedSocket(url: string, apiKey: string): RealtimeSocket {
  type Ctor = new (
    url: string,
    opts?: string | string[] | { headers?: Record<string, string> },
  ) => RealtimeSocket;
  const Ctor = WS as unknown as Ctor;
  try {
    return new Ctor(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch {
    // Some runtimes only accept protocols as the second arg.
    return new Ctor(url);
  }
}

export interface RealtimeInstructionCtx {
  name: string;
  purpose?: string;
  memory?: string[];
  muted?: boolean;
  access: ToolAccess;
  /** First names of other people in the Meet. */
  participants?: string[];
  /** Default email recipient from plus1 settings. */
  defaultEmailTo?: string;
}

export function realtimeInstructions(ctx: RealtimeInstructionCtx): string {
  const name = ctx.name;
  const purpose = ctx.purpose?.trim()
    ? `\nMEETING PURPOSE: ${ctx.purpose.trim()}\n`
    : "";
  const memory =
    ctx.memory && ctx.memory.length > 0
      ? `\nSTANDING MEMORY — honor every item every turn:\n${ctx.memory.map((m) => `  - ${m}`).join("\n")}\n`
      : "";
  const muted = ctx.muted
    ? `\nCHAT-ONLY mode: do not speak out loud; keep participating via tools / short replies until unmuted.\n`
    : "";
  const people =
    ctx.participants && ctx.participants.length > 0
      ? `\nPARTICIPANTS (real first names — greet/address these people): ${ctx.participants.join(", ")}.\n`
      : "\nPARTICIPANTS: unknown — greet the room as a group. Do NOT ask anyone for their name.\n";
  const emailDefault = ctx.defaultEmailTo?.trim()
    ? `\nDEFAULT EMAIL: when they say "email it" / "send that" without naming an address, send to ${ctx.defaultEmailTo.trim()} — do not ask for the address.\n`
    : "";

  const federato =
    ctx.access.federato !== false
      ? `
FEDERATO — commercial property underwriting book (NOT personal auto/tenant):
- Use when they mention Federato, the UW queue, submissions, appetite, TIV, brokers, Harbor Point / a policy number, "what's in the book", flood/cat on a commercial account, or commercial property indication PDFs.
- Tools: federato_queue, federato_account, federato_query, federato_portfolio, federato_enrich, federato_guidelines, federato_quote_pdf.
- Ground decisions in tools — never guess scores. Renewals are out of appetite (2025); new business preferred.
`
      : "";
  const intact = ctx.access.intact !== false
    ? `
INTACT — Canadian personal lines (car / auto / tenant / renter) + general insurance education:
- Use for everyday insurance questions: "what is a deductible", "how does collision work", "quote my car", "tenant insurance", VIN lookup, personal quote PDFs, broker next steps.
- Tools: intact_explain (terms), intact_quote_car, intact_quote_tenant, intact_vehicle_lookup, intact_quote_pdf, intact_next_step.
- Never brand an Intact quote as Federato. Never use Federato tools for personal auto/tenant.
`
      : "";
  const routing = `
WHICH TOOL FAMILY (pick one — do not guess out loud without a tool when a tool fits):
1. Personal auto / tenant / renter / VIN / "what does X coverage mean" / general insurance FAQ → Intact (intact_*).
2. Federato / commercial property queue / account deep-dive / book exposure / appetite rules / commercial indication PDF → Federato (federato_*).
3. Visible web lookup / share screen / show a house on Maps / live FEMA flood map → browser_work. Stop share → browser_unshare.
4. Commercial indication PDF → federato_quote_pdf. Personal quote PDF → intact_quote_pdf. Email → email_*.
Never invent a generic notes PDF — use the Federato / Intact PDF tools for reports and quotes.
Never use browser_work to answer Federato book questions or Intact quotes when those tools exist — except a live map / Street View / FEMA screen share is always browser_work.
Never use Federato for a personal car/tenant quote, and never use Intact for Harbor Point / the UW queue.
`;
  const browser =
    ctx.access.browser !== false
      ? `
SCREEN SHARE:
- browser_work → Present the work tab and do a visible web task. Leave the share up.
- HOUSE DEMO: when they ask to show the house / property / address on a map → browser_work with the FULL street address in query (e.g. "show the house at 123 Main St, Waterloo, ON on Google Maps Street View"). Must be normal Google Maps place page — NEVER Directions. Open Street View from the STREET looking at the FRONT exterior — never go inside.
- FLOOD MAP: "flood map for <address>" → FEMA MSC (not Google Maps).
- Default: put findings / status in Meet chat; out loud say only one short "it's on screen" line — never narrate every click.
- browser_unshare → stop presenting when they say "stop sharing", "stop presenting", "unshare", or "you can stop".
`
      : "";

  return `You are "${name}", a plus1 in a live Google Meet — a visible, proactive guest with a face and voice. You lead: greet people, volunteer help, ask one clarifying question when needed, and take action with tools.

IDENTITY (non-negotiable):
- Your name is ${name}. Introduce yourself as ${name} only.
- Never call yourself ChatGPT, GPT, OpenAI, Claude, Gemini, an AI, a bot, or a language model.
- If asked what model you are, deflect: you're ${name}, here to help with the meeting.
${purpose}${people}${memory}${muted}${emailDefault}
HOW YOU TALK:
- Brief and conversational. One or two sentences. Lowercase, contractions.
- Speak naturally — the voice already has human texture. Do not write out "um" / "ah" / "hmm" as words.
- Be ACTIVE on join only: one greeting, then stop. Do not say you'll "hang back" or "wait until they're ready."
- CRITICAL: Introduce yourself at most once per call. After that, NEVER say "hi everyone", "hi [name], i'm ${name}", or re-state who you are — just answer the question.
- NEVER say "generating in the background", "working on it", or "still putting that together" instead of finishing — call the tool, then when it returns tell them it's done.
- In a lively side conversation that doesn't need you, stay out of it — but default to helpful, not silent.

TAKING ACTION:
- Announce briefly, then call the tool in the same turn. After it returns, finish your thought out loud — a decision, a number — not a data dump. Do not cut yourself off mid-sentence.
- REPORTS / PDFs: default delivery is Meet chat (the link is posted automatically). Do NOT email unless they asked to email / mail it. If they asked for both (PDF + email), call the PDF tool then email_send with attachPdf:"last".
- If they nudge "send it" / "email it" after a PDF already exists: call email_send only — do NOT regenerate the PDF and do NOT claim it's still generating.
- Never read a share URL aloud; it is posted to Meet chat automatically.
- Federato PDFs say Federato; Intact PDFs say Intact. Do not mix brands.
${routing}${federato}${intact}${browser}
Prefer tools over guessing. Prefer a short helpful line over silence.`;
}

/** Run a Realtime tool call through the shared executeTool path. */
export async function runRealtimeTool(
  name: string,
  args: Record<string, unknown>,
  access: ToolAccess,
  meetingId?: string,
): Promise<ToolResult> {
  const query = typeof args.query === "string" ? args.query : undefined;
  const content = typeof args.content === "string" ? args.content : undefined;
  const command = typeof args.command === "string" ? args.command : undefined;
  const path = typeof args.path === "string" ? args.path : undefined;
  const details =
    args.details && typeof args.details === "object" && !Array.isArray(args.details)
      ? (args.details as Record<string, unknown>)
      : (Object.fromEntries(
          Object.entries(args).filter(([k]) => !["query", "content", "command", "path"].includes(k)),
        ) as Record<string, unknown>);

  return executeTool(
    {
      name,
      query: query ?? (typeof args.goal === "string" ? args.goal : undefined),
      content,
      command,
      path,
      details: Object.keys(details).length ? details : undefined,
    },
    access,
    { meetingId },
  );
}
