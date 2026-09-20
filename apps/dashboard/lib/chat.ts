// Client for the backend live-chat endpoints — same brain + tools as a meeting.
import { AGENT_URL, readplus1Config, fetchplus1Config } from "./session";

/** Same resolution the meeting uses: MongoDB config first, this browser's copy as fallback. */
async function currentConfig(): Promise<Record<string, unknown> | undefined> {
  return (await fetchplus1Config()) ?? readplus1Config();
}

export interface QuoteFactor {
  label: string;
  effect: "raises" | "lowers" | "neutral";
}

export interface PaymentPlan {
  annual: number;
  monthly: number;
  instalmentFeePct: number;
  methods: string[];
}

export interface QuoteResult {
  product: "car" | "tenant";
  currency: "CAD";
  appetite: "standard" | "high_risk" | "refer";
  monthlyLow: number;
  monthlyHigh: number;
  annualLow: number;
  annualHigh: number;
  payment: PaymentPlan;
  coverageTier: string;
  recommended: string[];
  factors: QuoteFactor[];
  assumptions: string[];
  handoffReason?: string;
  disclaimer: string;
}

export interface NextStep {
  kind: "broker_call" | "find_broker";
  brokerLine: string;
  meetUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "bob";
  kind: "text" | "tool" | "quote";
  text: string;
  tool?: string;
  quote?: QuoteResult;
  pdfUrl?: string;
  /** Publicly reachable link, when the backend has public sharing configured. */
  shareUrl?: string;
  nextStep?: NextStep;
  at: string;
}

export async function createChat(): Promise<string> {
  const res = await fetch(`${AGENT_URL}/api/chat/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: await currentConfig() }),
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
    body: JSON.stringify({ text, config: await currentConfig() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Agent returned ${res.status}`);
  return (json.messages ?? []) as ChatMessage[];
}
