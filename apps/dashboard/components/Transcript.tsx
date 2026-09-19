"use client";

import { useEffect, useRef } from "react";
import type { Fixture } from "@/lib/types";
import { INTENT_META } from "@/lib/maps";
import { Caption, Chat } from "./icons";

const SPEAKER_TINT: Record<string, string> = {
  Kevin: "#7c93b8",
  Shannon: "#b88fb0",
  Priya: "#8fb8a6",
};

interface Line {
  key: string;
  t: number;
  who: string;
  text: string;
  source?: "caption" | "chat";
  gate?: Fixture["events"][number]["gate"];
  agent?: boolean;
  cut?: boolean;
}

function buildLines(fixture: Fixture, clock: number, gooseName: string): Line[] {
  const lines: Line[] = [];
  for (const e of fixture.events) {
    if (e.kind === "utterance" && e.t <= clock && e.text) {
      lines.push({
        key: e.id,
        t: e.t,
        who: e.speaker ?? "?",
        text: e.text,
        source: e.source,
        gate: e.gate,
      });
    }
    if (e.decision) {
      const say = e.decision.plan.say?.trim();
      const spokeHop = e.decision.hops.find(
        (h) => h.stage === "SPOKE" || h.stage === "ANNOUNCED",
      );
      if (say && spokeHop && e.t + spokeHop.ms <= clock) {
        lines.push({
          key: `${e.id}-say`,
          t: e.t + spokeHop.ms + 0.5,
          who: gooseName,
          text: say,
          agent: true,
          cut: Boolean(e.decision.bargedInAtMs),
        });
      }
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

export function Transcript({
  fixture,
  clock,
  gooseName,
}: {
  fixture: Fixture;
  clock: number;
  gooseName: string;
}) {
  const lines = buildLines(fixture, clock, gooseName);
  const endRef = useRef<HTMLDivElement>(null);
  const count = lines.length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count]);

  return (
    <section className="panel reticle flex min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="label" style={{ color: "var(--color-ink-2)" }}>
            TRANSCRIPT
          </span>
          <span className="data text-[10px] text-ink-3">{count} lines</span>
        </div>
        <span className="label">SPEAKER · GATE</span>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {lines.length === 0 && (
          <p className="data mt-6 text-center text-[11px] text-ink-3">
            awaiting captions…
          </p>
        )}
        {lines.map((l, i) => {
          const last = i === lines.length - 1;
          const gm = l.gate ? INTENT_META[l.gate.intent] : null;
          const tint = l.agent ? "var(--color-act)" : SPEAKER_TINT[l.who] ?? "#8593ab";
          return (
            <div key={l.key} className={`enter flex gap-2.5 ${last ? "" : ""}`}>
              <div
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-600"
                style={{
                  color: tint,
                  background: `color-mix(in srgb, ${tint} 14%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${tint} 30%, transparent)`,
                }}
              >
                {l.agent ? "R" : (l.who[0] ?? "?")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  <span
                    className="text-[12px] font-600"
                    style={{ color: l.agent ? "var(--color-act)" : "var(--color-ink)" }}
                  >
                    {l.who}
                  </span>
                  {l.agent ? (
                    <span className="chip !py-0 !px-1.5 text-[9px]" style={{ color: "var(--color-act)" }}>
                      plus1
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-ink-3">
                      {l.source === "chat" ? <Chat width={11} height={11} /> : <Caption width={11} height={11} />}
                      <span className="label !text-[9px]">{l.source}</span>
                    </span>
                  )}
                </div>
                <p
                  className={`text-[13px] leading-[1.5] ${
                    l.agent ? "text-ink" : "text-ink-2"
                  } ${l.source === "chat" && !l.agent ? "data break-all rounded-[3px] bg-panel-2 px-2 py-1 text-[12px] text-act" : ""}`}
                >
                  {l.text}
                  {l.cut && (
                    <span className="ml-1 chip !py-0 !px-1.5 align-middle text-[9px]" style={{ color: "var(--color-alert)" }}>
                      cut · barge-in
                    </span>
                  )}
                </p>

                {gm && !l.agent && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span
                      className="chip !py-0 !px-1.5 text-[9px]"
                      style={{ color: gm.color, opacity: gm.act ? 1 : 0.72 }}
                    >
                      {gm.label}
                    </span>
                    <div className="gauge w-16" style={{ color: gm.color }}>
                      <i style={{ width: `${(l.gate!.confidence * 100).toFixed(0)}%` }} />
                    </div>
                    <span className="data text-[10px]" style={{ color: gm.color }}>
                      {l.gate!.confidence.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </section>
  );
}
