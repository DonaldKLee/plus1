import type { ArtifactKind, GooseState, Intent } from "./types";

// intent → signal color token + short label
export const INTENT_META: Record<Intent, { color: string; label: string; act: boolean }> = {
  addressed_to_me: { color: "var(--color-live)", label: "ADDRESSED", act: true },
  action_item: { color: "var(--color-act)", label: "ACTION", act: true },
  review_url: { color: "var(--color-act)", label: "REVIEW", act: true },
  question_about_work: { color: "var(--color-live)", label: "QUESTION", act: true },
  small_talk: { color: "var(--color-quiet)", label: "SMALL TALK", act: false },
  ignore: { color: "var(--color-quiet)", label: "IGNORE", act: false },
};

export const STAGE_COLOR: Record<string, string> = {
  HEARD: "var(--color-live)",
  GATED: "var(--color-gate)",
  RETRIEVED: "var(--color-act)",
  ANNOUNCED: "var(--color-act)",
  PLANNED: "var(--color-gate)",
  BROWSED: "var(--color-act)",
  CRITIQUED: "var(--color-act)",
  CONFLICT: "var(--color-alert)",
  APPROVAL: "var(--color-live)",
  TOOL: "var(--color-act)",
  "BARGE-IN": "var(--color-alert)",
  REPLAN: "var(--color-gate)",
  SPOKE: "var(--color-live)",
};

export const GOOSE_STATE_META: Record<
  GooseState,
  { color: string; label: string }
> = {
  idle: { color: "var(--color-ink-3)", label: "STANDBY" },
  listening: { color: "var(--color-live)", label: "LISTENING" },
  thinking: { color: "var(--color-gate)", label: "THINKING" },
  typing: { color: "var(--color-act)", label: "WORKING" },
  speaking: { color: "var(--color-act)", label: "SPEAKING" },
  honk: { color: "var(--color-alert)", label: "HONK" },
};

export const ARTIFACT_META: Record<
  ArtifactKind,
  { label: string; color: string }
> = {
  gmail_draft: { label: "GMAIL DRAFT", color: "var(--color-act)" },
  doc_review: { label: "DOC REVIEW", color: "var(--color-gate)" },
  notion_update: { label: "NOTION", color: "var(--color-live)" },
  calendar_event: { label: "CALENDAR", color: "var(--color-live)" },
};

export const SEVERITY_COLOR: Record<string, string> = {
  high: "var(--color-alert)",
  medium: "var(--color-gate)",
  low: "var(--color-ink-2)",
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
