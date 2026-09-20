"use client";

import { useEffect, useRef, useState } from "react";
import { Plus1Mark } from "@/components/ui";
import { fmtClock } from "./sample";

/**
 * A living miniature of the console — the one thing a competitor's landing page
 * can't fake. It plays a short meeting in real time: names land on each line
 * (the speaker attribution the console now records), the gate labels each one,
 * and the plus1 answers and acts. Loops; freezes fully expanded for reduced
 * motion.
 */

type Entry = {
  t: number;
  speaker: string;
  text: string;
  agent?: boolean;
  gate: { label: string; color: string } | null;
};

const LIVE = "var(--live)";
const ACT = "var(--act)";
const MUTED = "var(--fg-subtle)";

const SCRIPT: Entry[] = [
  { t: 3200, speaker: "Donald", text: "morning all — let's run the Northwind submission.", gate: { label: "Small talk", color: MUTED } },
  { t: 9400, speaker: "Kevin", text: "plus1, what's the TIV on the Tampa warehouse?", gate: { label: "Addressed", color: LIVE } },
  { t: 12600, speaker: "plus1", text: "pulling it now — Tampa warehouse is $4.2M TIV, and it's in appetite.", agent: true, gate: null },
  { t: 21000, speaker: "Priya", text: "can you draft the follow-up to Bob? don't send it yet.", gate: { label: "Action", color: ACT } },
  { t: 24800, speaker: "plus1", text: "on it — drafting now, I'll drop the link in the chat. not sending.", agent: true, gate: null },
  { t: 33000, speaker: "Donald", text: "and book the atrium for the signing on the 22nd.", gate: { label: "Action", color: ACT } },
];

const DECISION_HOPS = [
  { stage: "HEARD", ms: 0 },
  { stage: "GATED", ms: 120 },
  { stage: "ANNOUNCED", ms: 480 },
  { stage: "RETRIEVED", ms: 760 },
  { stage: "TOOL", ms: 1180 },
];

const CHAR_MS = 26;
const HOLD_MS = 1100;
const LOOP_PAUSE_MS = 2600;

export function ConsolePreview() {
  const [idx, setIdx] = useState(0); // line currently typing
  const [typed, setTyped] = useState(0); // chars shown of that line
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce.current) {
      setIdx(SCRIPT.length - 1);
      setTyped(SCRIPT[SCRIPT.length - 1].text.length);
    }
  }, []);

  useEffect(() => {
    if (reduce.current) return;
    const cur = SCRIPT[idx];
    if (typed < cur.text.length) {
      const id = setTimeout(() => setTyped((n) => n + 1), CHAR_MS);
      return () => clearTimeout(id);
    }
    // line finished — advance, or loop from the top
    const atEnd = idx >= SCRIPT.length - 1;
    const id = setTimeout(
      () => {
        if (atEnd) {
          setIdx(0);
          setTyped(0);
        } else {
          setIdx((i) => i + 1);
          setTyped(0);
        }
      },
      atEnd ? LOOP_PAUSE_MS : HOLD_MS,
    );
    return () => clearTimeout(id);
  }, [idx, typed]);

  const shown = SCRIPT.slice(0, idx + 1);
  // The reasoning panel tracks the most recent plus1 action in view.
  const lastAgent = [...shown].reverse().find((e) => e.agent);
  const showDecision = Boolean(lastAgent);

  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-bg text-fg shadow-[var(--shadow-lg)]">
      {/* chrome */}
      <div className="flex items-center gap-3 border-b border-border bg-bg px-4 py-3">
        <Plus1Mark size={20} className="shrink-0 text-fg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-fg">Northwind — submission review</p>
          <p className="tnum truncate text-[11.5px] text-fg-subtle">meet.google.com/abc-defg-hij</p>
        </div>
        <span className="chip shrink-0" style={{ color: LIVE }}>
          <span className="dot dot-pulse" />
          Listening
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* transcript */}
        <div className="min-h-[292px] border-b border-border md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="eyebrow">Live transcript</span>
            <span className="eyebrow">Gate</span>
          </div>
          {shown.map((e, i) => {
            const isCurrent = i === idx;
            const text = isCurrent && !reduce.current ? e.text.slice(0, typed) : e.text;
            const typingDone = !isCurrent || typed >= e.text.length || reduce.current;
            return (
              <div
                key={i}
                className="rise-in flex items-start gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <span className="tnum mt-[3px] shrink-0 text-[11px] text-fg-subtle">{fmtClock(e.t)}</span>
                <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
                  <span
                    className="mr-1.5 font-medium"
                    style={{ color: e.agent ? "var(--brand-text)" : ACT }}
                  >
                    {e.speaker}:
                  </span>
                  <span style={{ color: e.agent ? "var(--fg)" : "var(--fg-muted)" }}>{text}</span>
                  {isCurrent && !typingDone && (
                    <span
                      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse"
                      style={{ background: LIVE }}
                      aria-hidden
                    />
                  )}
                </p>
                {e.gate && typingDone && (
                  <span className="rise-in chip shrink-0" style={{ color: e.gate.color }}>
                    {e.gate.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* what it did about it */}
        <div className="min-h-[292px]">
          <div className="border-b border-border px-4 py-2">
            <span className="eyebrow">plus1 decisions</span>
          </div>
          {showDecision ? (
            <div key={lastAgent!.text} className="rise-in px-4 py-3">
              <ol className="mb-3">
                {DECISION_HOPS.map((h) => (
                  <li key={h.stage} className="flex items-baseline justify-between gap-3 py-1">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACT }} />
                      <span className="text-[11.5px] font-medium text-fg">{h.stage}</span>
                    </span>
                    <span className="tnum text-[11px] text-fg-subtle">
                      {h.ms === 0 ? "0ms" : `+${h.ms}ms`}
                    </span>
                  </li>
                ))}
              </ol>
              <blockquote
                className="border-l pl-3 text-[12.5px] leading-relaxed text-fg"
                style={{ borderColor: ACT }}
              >
                &ldquo;{lastAgent!.text}&rdquo;
              </blockquote>
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-[12.5px] text-fg-subtle">
              plus1 reads every line, attributes it to a speaker, and decides whether to
              speak, chat, or act.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
