/**
 * Demo content for the public landing page only.
 *
 * This is a trimmed, frozen excerpt of the original sponsorship-sync demo
 * meeting. It lives here, beside the marketing page, on purpose: the product
 * surfaces under /app run on real session data and must stay fixture-free.
 * Nothing in this file is imported by the app.
 */

export type SampleIntent =
  | "addressed_to_me"
  | "action_item"
  | "review_url"
  | "question_about_work"
  | "small_talk"
  | "ignore";

/** Gate verdict styling. Color names one meeting state; act = it cleared the gate. */
export const INTENT_META: Record<SampleIntent, { color: string; label: string; act: boolean }> = {
  addressed_to_me: { color: "var(--live)", label: "Addressed", act: true },
  action_item: { color: "var(--act)", label: "Action", act: true },
  review_url: { color: "var(--act)", label: "Review", act: true },
  question_about_work: { color: "var(--live)", label: "Question", act: true },
  small_talk: { color: "var(--fg-subtle)", label: "Small talk", act: false },
  ignore: { color: "var(--fg-subtle)", label: "Ignored", act: false },
};

export const SAMPLE_MEETING = {
  "meetTitle": "HTN — Sponsorship sync",
  "meetUrl": "https://meet.google.com/abc-defg-hij"
};

export interface SampleLine {
  id: string;
  t: number;
  speaker: string;
  text: string;
  intent: SampleIntent;
  confidence: number;
}

export const SAMPLE_LINES: SampleLine[] = [
  {
    "id": "e1",
    "t": 2600,
    "speaker": "Shannon",
    "text": "okay I think we're all here, morning everyone",
    "intent": "small_talk",
    "confidence": 0.08
  },
  {
    "id": "e2",
    "t": 6200,
    "speaker": "Kevin",
    "text": "morning — coffee's still loading. give me a sec",
    "intent": "small_talk",
    "confidence": 0.05
  },
  {
    "id": "e3",
    "t": 11800,
    "speaker": "Kevin",
    "text": "hey Reginald — what are we actually working on today, remind me where we left it",
    "intent": "addressed_to_me",
    "confidence": 0.94
  },
  {
    "id": "e4",
    "t": 19000,
    "speaker": "Shannon",
    "text": "right, Northwind. so I've been going back and forth with Bob for like two weeks now and honestly the whole thing has been a bit of a saga, he keeps looping in new people and every time we think we've got alignment someone new asks the same questions we already answered, and then last tuesday—",
    "intent": "small_talk",
    "confidence": 0.22
  },
  {
    "id": "e6",
    "t": 26200,
    "speaker": "Shannon",
    "text": "…okay, okay, point taken. I'll keep it short.",
    "intent": "small_talk",
    "confidence": 0.06
  },
  {
    "id": "e7",
    "t": 31000,
    "speaker": "Kevin",
    "text": "can you draft the sponsorship email to Bob? just the follow-up, don't send it",
    "intent": "action_item",
    "confidence": 0.91
  },
  {
    "id": "e8",
    "t": 39000,
    "speaker": "Priya",
    "text": "before that goes out — can you review the deck we're attaching? one sec, dropping it",
    "intent": "review_url",
    "confidence": 0.7
  },
  {
    "id": "e9",
    "t": 44500,
    "speaker": "Priya",
    "text": "https://docs.google.com/presentation/d/1kQ-northwind-deck/edit",
    "intent": "review_url",
    "confidence": 0.97
  },
  {
    "id": "e10",
    "t": 61000,
    "speaker": "Priya",
    "text": "wait, thirty? I thought gold was twenty-five",
    "intent": "question_about_work",
    "confidence": 0.68
  },
  {
    "id": "e11",
    "t": 65500,
    "speaker": "Priya",
    "text": "Reginald — what tier did we actually land on with Bob?",
    "intent": "question_about_work",
    "confidence": 0.93
  },
  {
    "id": "e12",
    "t": 74000,
    "speaker": "Kevin",
    "text": "yeah go ahead and fix the Notion doc",
    "intent": "action_item",
    "confidence": 0.85
  },
  {
    "id": "e13",
    "t": 82000,
    "speaker": "Shannon",
    "text": "and can you book us the big room for the signing on the 21st",
    "intent": "action_item",
    "confidence": 0.58
  },
  {
    "id": "e14",
    "t": 89000,
    "speaker": "Kevin",
    "text": "yeah the atrium, twenty-first, this year— actually hold on Shannon had a—",
    "intent": "action_item",
    "confidence": 0.8
  },
  {
    "id": "e15",
    "t": 92500,
    "speaker": "Shannon",
    "text": "sorry — make it the 22nd, the 21st is the setup day",
    "intent": "action_item",
    "confidence": 0.86
  },
  {
    "id": "e16",
    "t": 99000,
    "speaker": "Kevin",
    "text": "/honk",
    "intent": "ignore",
    "confidence": 1
  },
  {
    "id": "e18",
    "t": 103000,
    "speaker": "Kevin",
    "text": "perfect. good goose. that's everything — thanks all",
    "intent": "small_talk",
    "confidence": 0.1
  }
];

export const SAMPLE_DECISION = {
  hops: [
  {
    "stage": "HEARD",
    "ms": 0,
    "detail": "caption · Kevin"
  },
  {
    "stage": "GATED",
    "ms": 120,
    "detail": "action_item · 0.91"
  },
  {
    "stage": "ANNOUNCED",
    "ms": 480,
    "detail": "filler: \"on it\""
  },
  {
    "stage": "RETRIEVED",
    "ms": 760,
    "detail": "4 chunks"
  },
  {
    "stage": "TOOL",
    "ms": 1180,
    "detail": "gmail.create_draft · Ask→Auto"
  }
],
  say: "on it — drafting the follow-up now, i'll drop the link in the chat. not sending.",
  tool: {"server":"gmail","tool":"create_draft"},
};

export const SAMPLE_ACTED = SAMPLE_LINES.filter((l) => INTENT_META[l.intent].act).length;

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
