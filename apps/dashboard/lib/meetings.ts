import type { ArtifactKind } from "./types";
import { fixture } from "./fixture";
import { INTENT_META } from "./maps";

/** The live session's counts are derived from the replay so the two never drift. */
const liveGated = fixture.events.filter((e) => e.kind === "utterance" && e.gate);
const liveActed = liveGated.filter((e) => INTENT_META[e.gate!.intent].act);
const LIVE_COUNTS = {
  utterances: liveGated.length,
  acted: liveActed.length,
  ignored: liveGated.length - liveActed.length,
  honks: fixture.events.filter((e) => e.kind === "honk").length,
};
const LIVE_DURATION = Math.max(...fixture.events.map((e) => e.t));

/**
 * A past (or live) meeting the goose sat in on. The live one replays from
 * `fixtures/transcript-demo.json`; the rest are authored records.
 *
 * DUMMY DATA. This shape is the contract the session API should meet.
 */
export interface MeetingRecord {
  id: string;
  title: string;
  personaId: string;
  /** ISO date. Rendered relative to today in the UI. */
  date: string;
  startedAtLabel: string;
  durationMs: number;
  status: "live" | "done";
  participants: { name: string; initials: string }[];
  counts: {
    utterances: number;
    /** Gate said act or answer. */
    acted: number;
    /** Gate said stay quiet — the number that proves the product works. */
    ignored: number;
    honks: number;
  };
  artifacts: { kind: ArtifactKind; title: string }[];
}

export const MEETINGS: MeetingRecord[] = [
  {
    id: "s_htn_sponsor_01",
    title: "HTN — Sponsorship sync",
    personaId: "reginald",
    date: "2026-09-19",
    startedAtLabel: "10:04 AM",
    durationMs: LIVE_DURATION,
    status: "live",
    participants: [
      { name: "Kevin", initials: "KV" },
      { name: "Shannon", initials: "SH" },
      { name: "Priya", initials: "PR" },
    ],
    counts: LIVE_COUNTS,
    artifacts: fixture.events
      .filter((e) => e.artifact)
      .map((e) => ({ kind: e.artifact!.kind, title: e.artifact!.title })),
  },
  {
    id: "s_eng_standup_44",
    title: "Engineering standup",
    personaId: "margaret",
    date: "2026-09-18",
    startedAtLabel: "9:30 AM",
    durationMs: 912_000,
    status: "done",
    participants: [
      { name: "Kevin", initials: "KV" },
      { name: "Dana", initials: "DA" },
      { name: "Marcus", initials: "MA" },
      { name: "Priya", initials: "PR" },
    ],
    counts: { utterances: 71, acted: 9, ignored: 62, honks: 0 },
    artifacts: [
      { kind: "notion_update", title: "Sprint 14 — commitments" },
      { kind: "calendar_event", title: "Runner spike — Thursday" },
    ],
  },
  {
    id: "s_design_review_09",
    title: "Console design review",
    personaId: "plume",
    date: "2026-09-17",
    startedAtLabel: "2:00 PM",
    durationMs: 2_760_000,
    status: "done",
    participants: [
      { name: "Kevin", initials: "KV" },
      { name: "Yuki", initials: "YU" },
      { name: "Dana", initials: "DA" },
    ],
    counts: { utterances: 104, acted: 14, ignored: 90, honks: 5 },
    artifacts: [
      { kind: "doc_review", title: "Console IA — critique" },
      { kind: "notion_update", title: "Review decisions" },
    ],
  },
  {
    id: "s_customer_northwind",
    title: "Northwind — scope call",
    personaId: "wingman",
    date: "2026-09-16",
    startedAtLabel: "11:15 AM",
    durationMs: 2_040_000,
    status: "done",
    participants: [
      { name: "Kevin", initials: "KV" },
      { name: "R. Okafor", initials: "RO" },
      { name: "Shannon", initials: "SH" },
    ],
    counts: { utterances: 88, acted: 11, ignored: 77, honks: 3 },
    artifacts: [
      { kind: "gmail_draft", title: "Northwind — scope recap + pricing" },
      { kind: "notion_update", title: "Northwind account notes" },
    ],
  },
  {
    id: "s_board_prep_02",
    title: "Board prep — Q3 numbers",
    personaId: "bartholomew",
    date: "2026-09-12",
    startedAtLabel: "4:30 PM",
    durationMs: 3_300_000,
    status: "done",
    participants: [
      { name: "Kevin", initials: "KV" },
      { name: "Shannon", initials: "SH" },
    ],
    counts: { utterances: 132, acted: 0, ignored: 132, honks: 0 },
    artifacts: [],
  },
  {
    id: "s_ops_weekly_31",
    title: "Ops weekly",
    personaId: "margaret",
    date: "2026-09-11",
    startedAtLabel: "9:00 AM",
    durationMs: 1_500_000,
    status: "done",
    participants: [
      { name: "Priya", initials: "PR" },
      { name: "Kevin", initials: "KV" },
      { name: "Marcus", initials: "MA" },
    ],
    counts: { utterances: 63, acted: 7, ignored: 56, honks: 1 },
    artifacts: [{ kind: "notion_update", title: "Ops actions — week 37" }],
  },
];

export function meetingById(id: string) {
  return MEETINGS.find((m) => m.id === id) ?? null;
}

/** Derived, never stored: a persona's usage must reconcile against this ledger. */
export function meetingCountByPersona(personaId: string): number {
  return MEETINGS.filter((m) => m.personaId === personaId).length;
}

export const liveMeeting = MEETINGS.find((m) => m.status === "live") ?? null;

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Relative day label against a fixed "today" so the fixture reads consistently. */
const TODAY = new Date("2026-09-19T00:00:00Z");

export function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const days = Math.round((TODAY.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
