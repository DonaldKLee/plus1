// Client for the backend live-chat endpoints — same brain + tools as a meeting.
import { AGENT_URL, readplus1Config } from "./session";

export interface QuoteFactor {
  label: string;
  effect: "raises" | "lowers" | "neutral";
}

export interface QuoteResult {
  product: "car" | "tenant";
  currency: "CAD";
  monthlyLow: number;
  monthlyHigh: number;
  annualLow: number;
  annualHigh: number;
  recommended: string[];
  factors: QuoteFactor[];
  assumptions: string[];
  disclaimer: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "bob";
  kind: "text" | "tool" | "quote";
  text: string;
  tool?: string;
  quote?: QuoteResult;
  at: string;
}

export async function createChat(): Promise<string> {
  const res = await fetch(`${AGENT_URL}/api/chat/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: readplus1Config() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Agent returned ${res.status}`);
  return json.chatId as string;
}

export async function sendChatMessage(id: string, text: string): Promise<ChatMessage[]> {
  const res = await fetch(`${AGENT_URL}/api/chat/sessions/${id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Send the current config every message so tool toggles apply immediately.
    body: JSON.stringify({ text, config: readplus1Config() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Agent returned ${res.status}`);
  return (json.messages ?? []) as ChatMessage[];
}
