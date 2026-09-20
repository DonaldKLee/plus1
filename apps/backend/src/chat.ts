/**
 * Live chat with the plus1 — the same brain (decideAction) and the same tools
 * (executeTool) as a meeting, minus Chrome and the avatar. Two uses:
 *   - a fast harness to test tools and just talk to Bob, and
 *   - a broker asking Bob for help, where Bob can offer to hop on a meeting.
 */
import { randomUUID } from "node:crypto";
import type { QuoteResult } from "@plus1/brain";
import {
  applyStateUpdate,
  decideAction,
  emptyState,
  plus1_NAME,
  narrateToolResult,
  recordCompletedAction,
  type MeetingState,
  type ToolAccess,
} from "./agentBrain.js";
import { runToolChain } from "./tools.js";
import type { NextStep } from "./intactTools.js";
import type { SessionConfig } from "./meetTranscribe.js";
import { getplus1Settings } from "./store.js";

export interface ChatMessage {
  id: string;
  role: "user" | "bob";
  kind: "text" | "tool" | "quote";
  text: string;
  tool?: string; // tool name, when kind === "tool" | "quote"
  quote?: QuoteResult; // structured estimate, when kind === "quote"
  pdfUrl?: string; // downloadable quote PDF (relative path)
  nextStep?: NextStep; // broker handoff
  at: string;
}

interface ChatSession {
  id: string;
  config?: SessionConfig;
  messages: ChatMessage[];
  memory: string[]; // standing instructions + facts to honor every turn
  state: MeetingState; // slot filling, same shape the meeting runner keeps
  createdAt: string;
}

const MEMORY_CAP = 24;

/** Merge new things-to-remember into the chat's standing memory. */
function remember(c: ChatSession, items?: string[]): void {
  if (!items?.length) return;
  for (const raw of items) {
    const item = raw.trim();
    if (item && !c.memory.some((m) => m.toLowerCase() === item.toLowerCase())) c.memory.push(item);
  }
  if (c.memory.length > MEMORY_CAP) c.memory = c.memory.slice(-MEMORY_CAP);
}

const chats = new Map<string, ChatSession>();

// ── config → brain knobs (mirrors the meeting's mapping) ────────────────────
function nameOf(c?: SessionConfig): string {
  return c?.name?.trim() || plus1_NAME;
}
function autonomyOf(c?: SessionConfig): number {
  return typeof c?.autonomy === "number" ? c.autonomy : 50;
}
function toolAccessOf(c?: SessionConfig): ToolAccess {
  const servers = c?.servers;
  const files: ToolAccess["files"] = !servers?.local
    ? "off"
    : c?.localAccess === "write"
      ? "write"
      : "read";
  return { federato: servers?.federato !== false, intact: servers?.intact === true, files };
}

function msg(role: ChatMessage["role"], text: string, kind: ChatMessage["kind"] = "text", tool?: string): ChatMessage {
  return { id: randomUUID(), role, kind, text, tool, at: new Date().toISOString() };
}

export function createChat(config?: SessionConfig): { chatId: string } {
  const id = randomUUID();
  chats.set(id, {
    id,
    config,
    messages: [],
    memory: [],
    state: emptyState(),
    createdAt: new Date().toISOString(),
  });
  return { chatId: id };
}

export function getChat(id: string): ChatSession | undefined {
  return chats.get(id);
}

export function updateChatConfig(id: string, patch: SessionConfig): boolean {
  const c = chats.get(id);
  if (!c) return false;
  c.config = { ...c.config, ...patch };
  return true;
}

function transcriptOf(c: ChatSession, max = 16): string {
  const me = nameOf(c.config).toLowerCase();
  return c.messages
    .slice(-max)
    .map((m) => `[${m.role === "bob" ? me : "broker"}] ${m.text}`)
    .join("\n");
}

/** Send a user message; run the brain; return Bob's reply message(s). */
export async function sendChatMessage(
  id: string,
  text: string,
  config?: SessionConfig,
): Promise<{ messages: ChatMessage[] }> {
  const c = chats.get(id);
  if (!c) throw new Error("No such chat");
  const clean = text.trim();
  if (!clean) throw new Error("empty message");

  // Always apply the latest config, so toggling tools in the plus1 tab takes
  // effect on the very next message — no reload, no stale session.
  if (config) c.config = { ...c.config, ...config };
  // No config yet (e.g. a curl session, or a browser that never saved one)? Fall
  // back to whatever the plus1 tab last saved to MongoDB — same as the meeting.
  if (!c.config) c.config = ((await getplus1Settings()) as SessionConfig | null) ?? undefined;

  c.messages.push(msg("user", clean));

  const access = toolAccessOf(c.config);
  const decision = await decideAction(transcriptOf(c), {
    channel: "chat",
    name: nameOf(c.config),
    autonomy: autonomyOf(c.config),
    access,
    memory: c.memory,
    state: c.state,
  });

  // Hold onto anything worth remembering across turns.
  remember(c, decision.remember);
  applyStateUpdate(c.state, decision.state);

  const out: ChatMessage[] = [];

  if (decision.action === "tool" && decision.tool?.name) {
    const call = decision.tool;
    // Announce first (never a silent tool call), then run the chain: tool → narrate →
    // maybe one follow-up tool → … Each step lands in the chat as it happens.
    const announced = decision.say?.trim();
    if (announced) out.push(msg("bob", announced));

    const steps = await runToolChain(
      call,
      access,
      {
        transcript: () => transcriptOf(c),
        name: nameOf(c.config),
        autonomy: autonomyOf(c.config),
        channel: "chat",
        memory: c.memory,
        muted: false,
        state: c.state,
      },
      {
        announce: async (say) => { out.push(msg("bob", say)); },
        onResult: (step) => {
          recordCompletedAction(c.state, `${step.call.name}(${step.args}) → ${step.result.text.slice(0, 160)}`);
          if (step.result.quote) {
            const m = msg("bob", step.result.text, "quote", step.call.name);
            m.quote = step.result.quote;
            out.push(m);
          } else {
            const shown = step.result.trace?.length ? `${step.result.text}\n\n— how: ${step.result.trace.join(" · ")}` : step.result.text;
            out.push(msg("bob", shown, "tool", step.call.name));
          }
          remember(c, step.reply.remember);
          applyStateUpdate(c.state, step.reply.state);
        },
      },
      announced,
    );
    const last = steps[steps.length - 1];
    const reply = last?.reply.say.trim() ?? "";
    // Skip it only if the model just echoed the raw tool string back.
    if (reply && reply !== last?.result.text.trim()) out.push(msg("bob", reply));
  } else {
    const reply = (decision.say || decision.chatMessage || "").trim();
    if (reply) out.push(msg("bob", reply));
  }

  // Never leave the broker hanging in a chat.
  if (out.length === 0) out.push(msg("bob", "hm, i don't have anything useful to add there — what do you need?"));

  c.messages.push(...out);
  return { messages: out };
}
