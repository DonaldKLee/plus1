// Client for the federato-agent "send a goose" transcription endpoints.
// The agent joins the Meet, transcribes with Gemini, and streams lines over SSE.

export const AGENT_URL =
  process.env.NEXT_PUBLIC_FEDERATO_AGENT_URL ?? "http://localhost:8787";

export type SessionStatus =
  | "joining"
  | "waiting-admit"
  | "listening"
  | "ended"
  | "error";

export interface TranscriptLine {
  id: string;
  t: number; // ms since capture started
  at: string; // ISO wall clock
  text: string;
  partial?: boolean; // still being spoken
}

export interface SessionSummary {
  id: string;
  meetUrl: string;
  status: SessionStatus;
  createdAt: string;
  error?: string;
  lineCount: number;
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  joining: "Joining",
  "waiting-admit": "Waiting to be let in",
  listening: "Listening",
  ended: "Ended",
  error: "Error",
};

export async function joinMeeting(meetUrl: string): Promise<string> {
  const res = await fetch(`${AGENT_URL}/api/meet/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ meetUrl }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Agent returned ${res.status}`);
  return json.sessionId as string;
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${AGENT_URL}/api/meet/sessions`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Agent returned ${res.status}`);
  const json = await res.json();
  return (json.sessions ?? []) as SessionSummary[];
}

export async function leaveSession(id: string): Promise<void> {
  await fetch(`${AGENT_URL}/api/meet/sessions/${id}/leave`, { method: "POST" });
}

export function streamUrl(id: string): string {
  return `${AGENT_URL}/api/meet/sessions/${id}/stream`;
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
