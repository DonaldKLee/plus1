// Client for the backend "send a plus1" transcription endpoints.
// The backend joins the Meet, transcribes with Gemini, and streams lines over SSE.

export const AGENT_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  process.env.NEXT_PUBLIC_FEDERATO_AGENT_URL ??
  "http://localhost:8787";

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
  agent?: boolean; // the plus1's own voice
  speaker?: string; // the plus1's display name on its lines
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
  /** What the meeting is for — the dashboard's label for it. */
  purpose?: string;
  /** First substantive line, used as a label when no purpose was given. */
  preview?: string;
  status: SessionStatus;
  createdAt: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  lineCount: number;
  /** false for meetings replayed out of MongoDB rather than running here. */
  live?: boolean;
  /** Only on search results: the transcript line that matched. */
  snippet?: string;
}

/** A full meeting: live from memory, or replayed from MongoDB. */
export interface SessionDetail {
  id: string;
  meetUrl: string;
  purpose?: string;
  status: SessionStatus;
  createdAt: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  notes: string[];
  lines: TranscriptLine[];
  decisions: DecisionRecord[];
  live: boolean;
}

export interface MeetingStats {
  meetings: number;
  lines: number;
  plus1Lines: number;
  totalDurationMs: number;
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  joining: "Joining",
  "waiting-admit": "Waiting to be let in",
  listening: "Listening",
  ended: "Ended",
  error: "Error",
};

/** The plus1 config saved by the plus1 tab, sent to the backend on join. */
export function readplus1Config(): Record<string, unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem("plus1.plus1.config");
    if (!raw) return undefined;
    const c = JSON.parse(raw) as Record<string, unknown>;
    // Only the fields the backend actually reads.
    return {
      name: c.name,
      autonomy: c.autonomy,
      confidence: c.confidence,
      guardrails: c.guardrails,
      servers: c.servers,
      localAccess: c.localAccess,
      email: c.email,
    };
  } catch {
    return undefined;
  }
}

const ACTIVE_KEY = "plus1.activeSession";

/** The most recently joined session, so the plus1 tab can tune it mid-meeting. */
export function activeSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export async function joinMeeting(
  meetUrl: string,
  purpose?: string,
  task?: string,
): Promise<string> {
  // Prefer the config stored in MongoDB; fall back to this browser's copy.
  const config = (await fetchplus1Config()) ?? readplus1Config();
  const res = await fetch(`${AGENT_URL}/api/meet/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meetUrl,
      config,
      purpose,
      task: task?.trim() || undefined,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Agent returned ${res.status}`);
  const sessionId = json.sessionId as string;
  try {
    window.localStorage.setItem(ACTIVE_KEY, sessionId);
  } catch {
    /* ignore */
  }
  return sessionId;
}

/** Push updated plus1 config to a live session (takes effect on the next turn). */
export async function updateSessionConfig(
  id: string,
  config: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(`${AGENT_URL}/api/meet/sessions/${id}/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${AGENT_URL}/api/meet/sessions`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Agent returned ${res.status}`);
  const json = await res.json();
  return (json.sessions ?? []) as SessionSummary[];
}

/** One meeting in full. Works for past meetings once MongoDB is configured. */
export async function fetchSession(id: string): Promise<SessionDetail | null> {
  const res = await fetch(`${AGENT_URL}/api/meet/sessions/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Agent returned ${res.status}`);
  const json = await res.json();
  return (json.session ?? null) as SessionDetail | null;
}

/** Full-text search across stored transcripts (MongoDB text index). */
export async function searchMeetings(q: string): Promise<SessionSummary[]> {
  const res = await fetch(`${AGENT_URL}/api/meet/search?q=${encodeURIComponent(q)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Agent returned ${res.status}`);
  const json = await res.json();
  return (json.results ?? []) as SessionSummary[];
}

export async function fetchStats(): Promise<MeetingStats | null> {
  const res = await fetch(`${AGENT_URL}/api/meet/stats`, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  return (json.stats ?? null) as MeetingStats | null;
}

/** Remove a meeting from the archive (and end it if it is still running). */
export async function deleteMeeting(id: string): Promise<void> {
  await fetch(`${AGENT_URL}/api/meet/sessions/${id}`, { method: "DELETE" });
}

export async function leaveSession(id: string): Promise<void> {
  try {
    if (activeSessionId() === id) window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
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

/** Make the plus1 say something (text → ElevenLabs → LiveAvatar → Meet). */
export function speak(id: string, text: string): Promise<{ id: string }> {
  return post(`/api/meet/sessions/${id}/speak`, { text });
}
/** Instant cached filler ("on it.", "one sec."). */
export function filler(id: string, kind: "ack" | "checking" | "wait" | "unsure" | "thinking" | "loading" = "ack"): Promise<{ phrase?: string }> {
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

/** Rename a meeting (live or archived). */
export async function renameMeeting(id: string, purpose: string): Promise<boolean> {
  const res = await fetch(`${AGENT_URL}/api/meet/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/** The plus1 config stored in MongoDB, or null when nothing is saved yet. */
export async function fetchplus1Config(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${AGENT_URL}/api/plus1/config`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return (json.config ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export interface EmailStatus {
  configured: boolean;
  dryRun: boolean;
  from?: string;
  host?: string;
  port?: number;
  user?: string;
  allowlist: string[];
  maxRecipients: number;
  defaultTo?: string;
  verified?: boolean;
  error?: string;
}

export async function fetchEmailStatus(verify = false): Promise<EmailStatus | null> {
  try {
    const res = await fetch(`${AGENT_URL}/api/email/status${verify ? "?verify=1" : ""}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as EmailStatus;
  } catch {
    return null;
  }
}

/** Persist the plus1 config to MongoDB. Returns false if it could not be saved. */
export async function saveplus1Config(config: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${AGENT_URL}/api/plus1/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => ({}));
    return Boolean(json.saved);
  } catch {
    return false;
  }
}

/** The Meet room code, e.g. abc-defg-hij. */
export function meetCode(url: string): string {
  return url.replace(/^https?:\/\/meet\.google\.com\//i, "").split("?")[0] ?? url;
}

/**
 * What to call a meeting in the UI. The operator's stated purpose wins; older
 * meetings that predate the field fall back to their first transcribed line,
 * and only then to the raw room code.
 */
export function meetingTitle(m: {
  purpose?: string;
  preview?: string;
  meetUrl: string;
  lines?: { text: string; agent?: boolean }[];
}): string {
  const purpose = m.purpose?.trim();
  if (purpose) return purpose;
  if (m.preview?.trim()) return m.preview.trim();
  const firstHuman = m.lines?.find((l) => !l.agent && l.text.trim().split(/\s+/).length >= 4);
  if (firstHuman) {
    const t = firstHuman.text.trim();
    return t.length > 70 ? `${t.slice(0, 70).trimEnd()}…` : t;
  }
  return meetCode(m.meetUrl);
}

/** True when the title is standing in for a real purpose — shown in italics. */
export function isUnlabelled(m: { purpose?: string }): boolean {
  return !m.purpose?.trim();
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
