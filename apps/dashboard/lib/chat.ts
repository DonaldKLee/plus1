// Client for the backend live-chat endpoints — same brain + tools as a meeting.
import { AGENT_URL, readGooseConfig } from "./session";

export interface ChatMessage {
  id: string;
  role: "user" | "bob";
  kind: "text" | "tool";
  text: string;
  tool?: string;
  at: string;
}

export async function createChat(): Promise<string> {
  const res = await fetch(`${AGENT_URL}/api/chat/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: readGooseConfig() }),
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
    body: JSON.stringify({ text, config: readGooseConfig() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Agent returned ${res.status}`);
  return (json.messages ?? []) as ChatMessage[];
}
