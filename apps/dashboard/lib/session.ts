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
  agent?: boolean; // the goose's own voice
  speaker?: string; // the goose's display name on its lines
}

/** LiveAvatar state as reported by the agent over SSE (`avatar` events). */
export interface AvatarState {
  session: string; // idle | starting | ready | speaking | stopping | stopped
  media: string; // idle | connecting | live | reconnecting | failed
  speaking: boolean;
}

export type ActionKind = "speak" | "chat" | "tool" | "none";

export interface DecisionRecord {
  id: string;
  t: number;
  at: string;
  act: boolean;
  action: ActionKind;
  confidence: number;
  reason: string;
  say?: string;
  chatMessage?: string;
  tool?: { name: string; query?: string };
  outcome?: string;
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

async function post(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${AGENT_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Agent returned ${res.status}`);
  return json;
}

/** Make the goose say something (text → ElevenLabs → LiveAvatar → Meet). */
export function speak(id: string, text: string): Promise<{ id: string }> {
  return post(`/api/meet/sessions/${id}/speak`, { text });
}
/** Instant cached filler ("on it.", "one sec."). */
export function filler(id: string, kind: "ack" | "checking" | "wait" | "unsure" = "ack"): Promise<{ phrase?: string }> {
  return post(`/api/meet/sessions/${id}/filler`, { kind });
}
export function interrupt(id: string): Promise<void> {
  return post(`/api/meet/sessions/${id}/interrupt`);
}
export function honk(id: string): Promise<void> {
  return post(`/api/meet/sessions/${id}/honk`);
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
