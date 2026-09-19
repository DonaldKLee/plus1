/**
 * Live chat with the goose — the same brain (decideAction) and the same tools
 * (executeTool) as a meeting, minus Chrome and the avatar. Two uses:
 *   - a fast harness to test tools and just talk to Bob, and
 *   - a broker asking Bob for help, where Bob can offer to hop on a meeting.
 */
import { randomUUID } from "node:crypto";
import type { QuoteResult } from "@plus1/brain";
import { decideAction, GOOSE_NAME, type ToolAccess } from "./agentBrain.js";
import { executeTool } from "./tools.js";
import type { SessionConfig } from "./meetTranscribe.js";

export interface ChatMessage {
  id: string;
  role: "user" | "bob";
  kind: "text" | "tool" | "quote";
  text: string;
  tool?: string; // tool name, when kind === "tool" | "quote"
  quote?: QuoteResult; // structured estimate, when kind === "quote"
  at: string;
}

interface ChatSession {
  id: string;
  config?: SessionConfig;
  messages: ChatMessage[];
  memory: string[]; // standing instructions + facts to honor every turn
  createdAt: string;
}

const chats = new Map<string, ChatSession>();

// ── config → brain knobs (mirrors the meeting's mapping) ────────────────────
function nameOf(c?: SessionConfig): string {
  return c?.name?.trim() || GOOSE_NAME;
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
  chats.set(id, { id, config, messages: [], memory: [], createdAt: new Date().toISOString() });
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
  return c.messages
    .slice(-max)
    .map((m) => `[${m.role === "bob" ? "goose" : "broker"}] ${m.text}`)
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

  // Always apply the latest config, so toggling tools in the Goose tab takes
  // effect on the very next message — no reload, no stale session.
  if (config) c.config = { ...c.config, ...config };

  c.messages.push(msg("user", clean));

  const access = toolAccessOf(c.config);
  const decision = await decideAction(transcriptOf(c), {
    channel: "chat",
    name: nameOf(c.config),
    autonomy: autonomyOf(c.config),
    access,
    memory: c.memory,
  });

  // Hold onto anything worth remembering across turns.
  if (decision.remember?.length) {
    for (const raw of decision.remember) {
      const item = raw.trim();
      if (item && !c.memory.some((m) => m.toLowerCase() === item.toLowerCase())) c.memory.push(item);
    }
    if (c.memory.length > 24) c.memory = c.memory.slice(-24);
  }

  const out: ChatMessage[] = [];

  if (decision.action === "tool" && decision.tool?.name) {
    // Announce first (never a silent tool call), then run it, then show the result.
    if (decision.say?.trim()) out.push(msg("bob", decision.say.trim()));
    const { text, quote } = await executeTool(decision.tool, access);
    if (quote) {
      const m = msg("bob", text, "quote", decision.tool.name);
      m.quote = quote;
      out.push(m);
    } else {
      out.push(msg("bob", text, "tool", decision.tool.name));
    }
  } else {
    const reply = (decision.say || decision.chatMessage || "").trim();
    if (reply) out.push(msg("bob", reply));
  }

  // Never leave the broker hanging in a chat.
  if (out.length === 0) out.push(msg("bob", "hm, i don't have anything useful to add there — what do you need?"));

  c.messages.push(...out);
  return { messages: out };
}
