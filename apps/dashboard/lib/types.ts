export type Intent =
  | "addressed_to_me"
  | "action_item"
  | "review_url"
  | "question_about_work"
  | "small_talk"
  | "ignore";

export type Urgency = "now" | "after_current_speaker" | "async";
export type Source = "caption" | "chat";
export type Emote = "thinking" | "typing" | "nod" | "honk" | "idle";
export type Policy = "Auto" | "Ask" | "Off";

export interface Gate {
  intent: Intent;
  confidence: number;
  requires_response: boolean;
  urgency: Urgency;
  extracted_task?: string;
  url?: string;
}

export interface Hop {
  stage: string;
  ms: number;
  detail?: string;
}

export interface RetrievedChunk {
  source: string;
  ref: string;
  quote: string;
  score: number;
}

export interface ToolCall {
  server: string;
  tool: string;
  policy?: Policy;
  args: Record<string, unknown>;
}

export interface ConflictClaim {
  source: string;
  value: string;
  date: string;
  signal: string;
}

export interface Conflict {
  entity: string;
  claims: ConflictClaim[];
  winner: string;
  reason: string;
  overruled: string[];
}

export interface Plan {
  say: string;
  emote: Emote;
  tool_calls: ToolCall[];
  chat_message: string | null;
  confidence: number;
  sources: string[];
}

export interface Decision {
  latencyMs: number;
  bargedInAtMs?: number;
  hops: Hop[];
  retrieved: RetrievedChunk[];
  conflict: Conflict | null;
  plan: Plan;
}

export type ArtifactKind =
  | "gmail_draft"
  | "doc_review"
  | "notion_update"
  | "calendar_event";

export interface Artifact {
  kind: ArtifactKind;
  title: string;
  subtitle: string;
  href: string;
  meta: string;
  preview?: string;
  verdict?: "ship" | "revise" | "reject";
  strengths?: string[];
  issues?: { severity: "high" | "medium" | "low"; location: string; quote: string; suggestion: string }[];
}

export interface MeetingEvent {
  id: string;
  t: number;
  kind: "join" | "utterance" | "honk" | "leave";
  speaker?: string;
  source?: Source;
  text?: string;
  gate?: Gate;
  decision?: Decision;
  artifact?: Artifact;
  participants?: string[];
  reason?: string;
  detail?: string;
  monologueMs?: number;
}

export interface Participant {
  name: string;
  role: string;
  initials: string;
  isAgent?: boolean;
}

export interface Fixture {
  meta: {
    sessionId: string;
    meetTitle: string;
    meetUrl: string;
    gooseName: string;
    personaStyle: string;
    startedAtLabel: string;
    participants: Participant[];
  };
  events: MeetingEvent[];
}

export type GooseState = "idle" | "listening" | "thinking" | "typing" | "speaking" | "honk";
