"use client";

import { useEffect, useRef, useState } from "react";
import type { DecisionView } from "@/lib/replay";
import type { Conflict, Decision, RetrievedChunk } from "@/lib/types";
import { INTENT_META, STAGE_COLOR, fmtMs } from "@/lib/maps";

function HopRail({ view }: { view: DecisionView }) {
  const hops = view.event.decision!.hops;
  return (
    <div className="relative py-1">
      {hops.map((h, i) => {
        const lit = i < view.litHops;
        const firing = i === view.firingIndex;
        const color = STAGE_COLOR[h.stage] ?? "var(--color-act)";
        const segLit = i > 0 && i < view.litHops;
        return (
          <div key={h.stage + i} className="relative flex gap-3">
            {/* rail */}
            <div className="relative flex w-4 shrink-0 flex-col items-center">
              {i > 0 && (
                <span
                  className={`hop-line absolute -top-3 h-3 w-[2px] ${segLit ? "lit" : ""}`}
                  style={{ color }}
                />
              )}
              <span
                className={`hop-node relative mt-1 h-2.5 w-2.5 rounded-[2px] ${lit ? "lit" : ""} ${firing ? "firing" : ""}`}
                style={{
                  ["--hop-color" as string]: color,
                  background: lit ? color : "var(--color-line-2)",
                }}
              />
            </div>
            {/* label */}
            <div className={`flex flex-1 items-baseline justify-between gap-2 pb-3 ${lit ? "" : "opacity-35"}`}>
              <div className="min-w-0">
                <span
                  className="data text-[11px] font-600 tracking-wide"
                  style={{ color: lit ? color : "var(--color-ink-2)" }}
                >
                  {h.stage}
                </span>
                {h.detail && (
                  <span className="data ml-2 text-[10.5px] text-ink-2">{h.detail}</span>
                )}
              </div>
              <span className="data shrink-0 text-[10px] text-ink-3 tabnum">
                {h.ms === 0 ? "0ms" : `+${fmtMs(h.ms)}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Evidence({ chunks }: { chunks: RetrievedChunk[] }) {
  return (
    <div className="space-y-2">
      {chunks.map((c, i) => (
        <div key={i} className="rounded-[3px] border border-line bg-panel-2 p-2.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className="label !text-[9px]" style={{ color: "var(--color-act)" }}>
                {c.source}
              </span>
              <span className="data text-[10px] text-ink-2">{c.ref}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <div className="gauge w-10" style={{ color: "var(--color-live)" }}>
                <i style={{ width: `${(c.score * 100).toFixed(0)}%` }} />
              </div>
              <span className="data text-[10px] text-ink-3">{c.score.toFixed(2)}</span>
            </span>
          </div>
          <p className="text-[12px] leading-snug text-ink-2">“{c.quote}”</p>
        </div>
      ))}
    </div>
  );
}

function ConflictView({ c }: { c: Conflict }) {
  return (
    <div className="rounded-[3px] border p-2.5" style={{ borderColor: "color-mix(in srgb, var(--color-alert) 35%, transparent)", background: "color-mix(in srgb, var(--color-alert) 6%, transparent)" }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="label !text-[9px]" style={{ color: "var(--color-alert)" }}>
          CONFLICT
        </span>
        <span className="data text-[10.5px] text-ink">{c.entity}</span>
      </div>
      <div className="space-y-1.5">
        {c.claims.map((claim, i) => {
          const win = c.winner === claim.source;
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded-[2px] px-2 py-1.5"
              style={{
                background: win ? "color-mix(in srgb, var(--color-live) 12%, transparent)" : "transparent",
                border: win ? "1px solid color-mix(in srgb, var(--color-live) 40%, transparent)" : "1px solid var(--color-line)",
                opacity: win ? 1 : 0.6,
              }}
            >
              <div className="flex items-center gap-2">
                <span className="label !text-[9px]">{claim.source}</span>
                <span className="data text-[11px] text-ink" style={{ textDecoration: win ? "none" : "line-through", textDecorationColor: "var(--color-ink-3)" }}>
                  {claim.value}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="data text-[9.5px] text-ink-3">{claim.date}</span>
                {win ? (
                  <span className="chip !py-0 !px-1.5 text-[9px]" style={{ color: "var(--color-live)" }}>
                    WINNER
                  </span>
                ) : (
                  <span className="data text-[9px] text-ink-3">overruled</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-2">
        <span className="label !text-[9px]" style={{ color: "var(--color-alert)" }}>WHY </span>
        {c.reason}
      </p>
    </div>
  );
}

function PlanView({ d }: { d: Decision }) {
  return (
    <div className="space-y-2.5">
      {/* spoken */}
      <div className="flex gap-2 border-l pl-2.5" style={{ borderColor: "var(--color-act)" }}>
        <p className="text-[12.5px] leading-snug text-ink">“{d.plan.say}”</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip !py-0 !px-1.5 text-[9px]" style={{ color: "var(--color-gate)" }}>
          emote · {d.plan.emote}
        </span>
        <span className="chip !py-0 !px-1.5 text-[9px]" style={{ color: "var(--color-live)" }}>
          conf {d.plan.confidence.toFixed(2)}
        </span>
      </div>

      {d.plan.tool_calls.map((tc, i) => (
        <div key={i} className="rounded-[3px] border border-line bg-panel-2">
          <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
            <span className="data text-[11px]" style={{ color: "var(--color-act)" }}>
              {tc.server}.{tc.tool}()
            </span>
            {tc.policy && (
              <span
                className="chip !py-0 !px-1.5 text-[9px]"
                style={{ color: tc.policy === "Auto" ? "var(--color-live)" : tc.policy === "Ask" ? "var(--color-gate)" : "var(--color-ink-3)" }}
              >
                {tc.policy}
              </span>
            )}
          </div>
          <pre className="mono overflow-x-auto px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-2">
            {JSON.stringify(tc.args, null, 2)}
          </pre>
        </div>
      ))}

      {d.plan.chat_message && (
        <div className="flex items-start gap-1.5 rounded-[3px] bg-panel-2 px-2.5 py-1.5">
          <span className="label !text-[9px] mt-0.5">→ CHAT</span>
          <span className="data text-[11px] text-ink-2">{d.plan.chat_message}</span>
        </div>
      )}

      {d.plan.sources.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {d.plan.sources.map((s) => (
            <span key={s} className="data rounded-[2px] bg-panel-2 px-1.5 py-0.5 text-[9.5px] text-ink-3">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionCard({
  view,
  open,
  onToggle,
}: {
  view: DecisionView;
  open: boolean;
  onToggle: () => void;
}) {
  const e = view.event;
  const d = e.decision!;
  const gm = e.gate ? INTENT_META[e.gate.intent] : null;
  const statusColor = view.active ? "var(--color-act)" : "var(--color-ink-3)";

  return (
    <div className="enter panel !bg-panel-2/40 overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-act)_5%,transparent)]"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            {gm && (
              <span className="chip !py-0 !px-1.5 text-[9px]" style={{ color: gm.color }}>
                {gm.label}
              </span>
            )}
            <span className="data text-[10px] text-ink-3 truncate">
              {e.speaker} · {e.source}
            </span>
          </div>
          <p className="truncate text-[12px] text-ink-2">“{e.text}”</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="flex items-center gap-1.5" style={{ color: statusColor }}>
            <span className={`led ${view.active ? "led-pulse" : ""}`} />
            <span className="data text-[10px]">{view.active ? "LIVE" : "DONE"}</span>
          </span>
          <span className="data text-[11px] font-600" style={{ color: view.active ? "var(--color-act)" : "var(--color-ink-2)" }}>
            {fmtMs(d.latencyMs)}
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-3">
          <HopRail view={view} />
          <div className="mt-2 space-y-3 border-t border-line pt-3">
            {d.retrieved.length > 0 && view.litHops >= 3 && (
              <section>
                <p className="label mb-1.5">EVIDENCE · {d.retrieved.length}</p>
                <Evidence chunks={d.retrieved} />
              </section>
            )}
            {d.conflict && view.litHops >= 4 && (
              <section>
                <ConflictView c={d.conflict} />
              </section>
            )}
            {view.litHops >= 2 && (
              <section>
                <p className="label mb-1.5">PLAN</p>
                <PlanView d={d} />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Mind({ decisions }: { decisions: DecisionView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const topId = decisions[0]?.event.id ?? null;
  const lastTop = useRef<string | null>(null);

  // auto-follow the newest decision unless the user has taken control
  useEffect(() => {
    if (topId && topId !== lastTop.current) {
      lastTop.current = topId;
      if (!manual) setOpenId(topId);
    }
  }, [topId, manual]);

  const effectiveOpen = openId ?? topId;

  return (
    <section className="panel reticle flex min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="label" style={{ color: "var(--color-ink-2)" }}>
            MIND
          </span>
          <span className="data text-[10px] text-ink-3">reasoning trace</span>
        </div>
        <span className="data text-[10px] text-ink-3">{decisions.length} decisions</span>
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {decisions.length === 0 && (
          <p className="data mt-6 text-center text-[11px] text-ink-3">
            gate open · most utterances die here
          </p>
        )}
        {decisions.map((v) => (
          <DecisionCard
            key={v.event.id}
            view={v}
            open={effectiveOpen === v.event.id}
            onToggle={() => {
              setManual(true);
              setOpenId((cur) => (cur === v.event.id ? null : v.event.id));
            }}
          />
        ))}
      </div>
    </section>
  );
}
