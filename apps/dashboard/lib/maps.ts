import type { ArtifactKind, GooseState, Intent } from "./types";

/**
 * Color carries exactly one meaning in this product: which state the meeting is
 * in. Four hues, no more — emerald heard, violet reasoning, sky acting, rose
 * conflict — plus the neutral ramp for everything the goose decided to ignore.
 */

export const INTENT_META: Record<Intent, { color: string; label: string; act: boolean }> = {
  addressed_to_me: { color: "var(--live)", label: "Addressed", act: true },
  action_item: { color: "var(--act)", label: "Action", act: true },
  review_url: { color: "var(--act)", label: "Review", act: true },
  question_about_work: { color: "var(--live)", label: "Question", act: true },
  small_talk: { color: "var(--fg-subtle)", label: "Small talk", act: false },
  ignore: { color: "var(--fg-subtle)", label: "Ignored", act: false },
};

export const STAGE_COLOR: Record<string, string> = {
  HEARD: "var(--live)",
  GATED: "var(--think)",
  RETRIEVED: "var(--act)",
  ANNOUNCED: "var(--act)",
  PLANNED: "var(--think)",
  BROWSED: "var(--act)",
  CRITIQUED: "var(--act)",
  CONFLICT: "var(--alert)",
  APPROVAL: "var(--live)",
  TOOL: "var(--act)",
  "BARGE-IN": "var(--alert)",
  REPLAN: "var(--think)",
  SPOKE: "var(--live)",
};

export const GOOSE_STATE_META: Record<GooseState, { color: string; label: string }> = {
  idle: { color: "var(--fg-subtle)", label: "Standby" },
  listening: { color: "var(--live)", label: "Listening" },
  thinking: { color: "var(--think)", label: "Thinking" },
  typing: { color: "var(--act)", label: "Working" },
  speaking: { color: "var(--act)", label: "Speaking" },
  honk: { color: "var(--alert)", label: "Honk" },
};

export const ARTIFACT_META: Record<ArtifactKind, { label: string; color: string }> = {
  gmail_draft: { label: "Gmail draft", color: "var(--act)" },
  doc_review: { label: "Doc review", color: "var(--think)" },
  notion_update: { label: "Notion", color: "var(--live)" },
  calendar_event: { label: "Calendar", color: "var(--live)" },
};

export const SEVERITY_COLOR: Record<string, string> = {
  high: "var(--alert)",
  medium: "var(--think)",
  low: "var(--fg-muted)",
};

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
