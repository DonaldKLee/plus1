"use client";

import { useEffect, useRef } from "react";
import type { Fixture } from "@/lib/types";
import { INTENT_META, fmtClock } from "@/lib/maps";
import { Chat } from "@/components/icons";
import { Panel, PanelHead, cx } from "@/components/ui";

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

  const quiet = lines.filter((l) => l.gate && !INTENT_META[l.gate.intent].act).length;

  return (
    <Panel as="section" className="flex min-h-0 flex-col overflow-hidden">
      <PanelHead
        title="Transcript"
        right={
          <span className="tnum text-[12px] text-fg-subtle">
            {count} lines
            {quiet > 0 && <span className="ml-2">{quiet} ignored</span>}
          </span>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            Waiting for captions.
          </p>
        )}

        {lines.map((l) => {
          const gm = l.gate ? INTENT_META[l.gate.intent] : null;
          return (
            <article
              key={l.key}
              className="rise-in grid grid-cols-1 gap-x-3 gap-y-1.5 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_94px]"
            >
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={cx(
                      "text-[12.5px] font-medium",
                      l.agent ? "" : "text-fg",
                    )}
                    style={l.agent ? { color: "var(--act)" } : undefined}
                  >
                    {l.who}
                  </span>
                  {l.agent && (
                    <span className="chip" style={{ color: "var(--act)" }}>
                      plus1
                    </span>
                  )}
                  {l.source === "chat" && (
                    <Chat width={12} height={12} className="text-fg-subtle" />
                  )}
                  <span className="tnum ml-auto text-[11px] text-fg-subtle sm:ml-0">
                    {fmtClock(l.t)}
                  </span>
                </div>

                <p
                  className={cx(
                    "text-[13.5px] leading-relaxed",
                    l.agent ? "text-fg" : "text-fg-muted",
                    l.source === "chat" && !l.agent && "tnum break-words text-[12.5px]",
                  )}
                >
                  {l.text}
                  {l.cut && (
                    <span
                      className="chip ml-1.5 align-middle"
                      style={{ color: "var(--alert)" }}
                    >
                      cut · barge-in
                    </span>
                  )}
                </p>
              </div>

              {/* the gate column — the product's thesis, made readable */}
              <div className="flex items-start gap-2 sm:flex-col sm:items-end sm:gap-1.5">
                {gm && !l.agent ? (
                  <>
                    <span
                      className="chip"
                      style={{ color: gm.color}}
                    >
                      {gm.label}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="meter w-10" style={{ color: gm.color }}>
                        <i style={{ ["--fill" as string]: l.gate!.confidence }} />
                      </span>
                      <span className="tnum text-[11px] text-fg-subtle">
                        {l.gate!.confidence.toFixed(2)}
                      </span>
                    </span>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
        <div ref={endRef} />
      </div>
    </Panel>
  );
}
