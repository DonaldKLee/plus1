"use client";

import { useEffect, useRef, useState } from "react";
import type { DecisionView } from "@/lib/replay";
import type { Conflict, Decision, RetrievedChunk } from "@/lib/types";
import { INTENT_META, STAGE_COLOR, fmtMs } from "@/lib/maps";
import { Panel, PanelHead, cx } from "@/components/ui";

function HopRail({ view }: { view: DecisionView }) {
  const hops = view.event.decision!.hops;
  return (
    <ol className="relative">
      {hops.map((h, i) => {
        const lit = i < view.litHops;
        const firing = i === view.firingIndex;
        const color = STAGE_COLOR[h.stage] ?? "var(--act)";
        const segLit = i > 0 && i < view.litHops;
        return (
          <li key={h.stage + i} className="relative flex gap-3">
            <div className="relative flex w-3 shrink-0 flex-col items-center">
              {i > 0 && (
                <span
                  className={cx("bus absolute -top-3 h-3 w-[1.5px]", segLit && "lit")}
                  style={{ color }}
                />
              )}
              <span
                className={cx(
                  "mt-[5px] h-2 w-2 rounded-full transition-colors duration-300",
                  firing && "pop",
                )}
                style={{ background: lit ? color : "var(--border-strong)" }}
              />
            </div>
            <div
              className={cx(
                "flex flex-1 items-baseline justify-between gap-3 pb-3 transition-opacity duration-300",
                lit ? "opacity-100" : "opacity-40",
              )}
            >
              <span className="min-w-0">
                <span
                  className="text-[12px] font-medium"
                  style={{ color: lit ? color : "var(--fg-muted)" }}
                >
                  {h.stage}
                </span>
                {h.detail && (
                  <span className="ml-2 text-[12px] text-fg-muted">{h.detail}</span>
                )}
              </span>
              <span className="tnum shrink-0 text-[11px] text-fg-subtle">
                {h.ms === 0 ? "0ms" : `+${fmtMs(h.ms)}`}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Evidence({ chunks }: { chunks: RetrievedChunk[] }) {
  return (
    <div className="flex flex-col gap-2">
      {chunks.map((c, i) => (
        <div key={i} className="rounded-[var(--r-sm)] border border-border bg-bg p-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[12px] font-medium" style={{ color: "var(--act)" }}>
                {c.source}
              </span>
              <span className="tnum truncate text-[11.5px] text-fg-subtle">{c.ref}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="meter w-9" style={{ color: "var(--live)" }}>
                <i style={{ ["--fill" as string]: c.score }} />
              </span>
              <span className="tnum text-[11px] text-fg-subtle">{c.score.toFixed(2)}</span>
            </span>
          </div>
          <p className="text-[12.5px] leading-snug text-fg-muted">&ldquo;{c.quote}&rdquo;</p>
        </div>
      ))}
    </div>
  );
}

function ConflictView({ c }: { c: Conflict }) {
  return (
    <div
      className="rounded-[var(--r-sm)] border p-3"
      style={{
        borderColor: "color-mix(in srgb, var(--alert) 32%, transparent)",
        background: "color-mix(in srgb, var(--alert) 7%, transparent)",
      }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="chip" style={{ color: "var(--alert)" }}>
          Conflict
        </span>
        <span className="truncate text-[12.5px] font-medium text-fg">{c.entity}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {c.claims.map((claim, i) => {
          const win = c.winner === claim.source;
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded-[var(--r-sm)] border px-2.5 py-1.5"
              style={{
                borderColor: win
                  ? "color-mix(in srgb, var(--live) 38%, transparent)"
                  : "var(--border)",
                background: win
                  ? "color-mix(in srgb, var(--live) 10%, transparent)"
                  : "transparent",
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[11.5px] text-fg-subtle">{claim.source}</span>
                <span
                  className={cx("tnum truncate text-[12px]", win ? "text-fg" : "text-fg-muted")}
                  style={win ? undefined : { textDecoration: "line-through" }}
                >
                  {claim.value}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tnum text-[11px] text-fg-subtle">{claim.date}</span>
                {win && (
                  <span className="chip" style={{ color: "var(--live)" }}>
                    Trusted
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 text-[12.5px] leading-snug text-fg-muted">
        <span className="font-medium" style={{ color: "var(--alert)" }}>
          Why:{" "}
        </span>
        {c.reason}
      </p>
    </div>
  );
}

function PlanView({ d }: { d: Decision }) {
  return (
    <div className="flex flex-col gap-2.5">
      <blockquote
        className="border-l pl-3 text-[13px] leading-relaxed text-fg"
        style={{ borderColor: "var(--act)" }}
      >
        &ldquo;{d.plan.say}&rdquo;
      </blockquote>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip" style={{ color: "var(--think)" }}>
          {d.plan.emote}
        </span>
        <span className="chip" style={{ color: "var(--live)" }}>
          confidence {d.plan.confidence.toFixed(2)}
        </span>
      </div>

      {d.plan.tool_calls.map((tc, i) => (
        <div key={i} className="overflow-hidden rounded-[var(--r-sm)] border border-border bg-bg">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
            <span className="tnum truncate text-[12px]" style={{ color: "var(--act)" }}>
              {tc.server}.{tc.tool}()
            </span>
            {tc.policy && (
              <span
                className="chip"
                style={{
                  color:
                    tc.policy === "Auto"
                      ? "var(--live)"
                      : tc.policy === "Ask"
                        ? "var(--think)"
                        : "var(--fg-subtle)",
                }}
              >
                {tc.policy}
              </span>
            )}
          </div>
          <pre className="tnum overflow-x-auto px-2.5 py-2 text-[11.5px] leading-relaxed text-fg-muted">
            {JSON.stringify(tc.args, null, 2)}
          </pre>
        </div>
      ))}

      {d.plan.chat_message && (
        <div className="flex items-start gap-2 rounded-[var(--r-sm)] bg-bg px-2.5 py-2">
          <span className="eyebrow mt-[2px] shrink-0">Chat</span>
          <span className="text-[12.5px] leading-snug text-fg-muted">{d.plan.chat_message}</span>
        </div>
      )}

      {d.plan.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.plan.sources.map((s) => (
            <span
              key={s}
              className="tnum rounded-[4px] border border-border px-1.5 py-0.5 text-[11px] text-fg-subtle"
            >
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

  return (
    <div className="rise-in overflow-hidden rounded-[var(--r-sm)] border border-border bg-bg">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-bg-raise"
      >
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex items-center gap-2">
            {gm && (
              <span className="chip" style={{ color: gm.color }}>
                {gm.label}
              </span>
            )}
            <span className="truncate text-[11.5px] text-fg-subtle">{e.speaker}</span>
          </span>
          <span className="block truncate text-[12.5px] text-fg-muted">
            &ldquo;{e.text}&rdquo;
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          <span
            className="flex items-center gap-1.5 text-[11px]"
            style={{ color: view.active ? "var(--act)" : "var(--fg-subtle)" }}
          >
            <span className={cx("dot", view.active && "dot-pulse")} />
            {view.active ? "Live" : "Done"}
          </span>
          <span
            className="tnum text-[12px] font-medium"
            style={{ color: view.active ? "var(--act)" : "var(--fg-muted)" }}
          >
            {fmtMs(d.latencyMs)}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3">
          <HopRail view={view} />

          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {d.retrieved.length > 0 && view.litHops >= 3 && (
              <section>
                <p className="eyebrow mb-1.5">Evidence · {d.retrieved.length}</p>
                <Evidence chunks={d.retrieved} />
              </section>
            )}
            {d.conflict && view.litHops >= 4 && <ConflictView c={d.conflict} />}
            {view.litHops >= 2 && (
              <section>
                <p className="eyebrow mb-1.5">Plan</p>
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

  useEffect(() => {
    if (topId && topId !== lastTop.current) {
      lastTop.current = topId;
      if (!manual) setOpenId(topId);
    }
  }, [topId, manual]);

  const effectiveOpen = openId ?? topId;

  return (
    <Panel as="section" className="flex min-h-0 flex-col overflow-hidden">
      <PanelHead
        title="Reasoning"
        right={
          <span className="tnum text-[12px] text-fg-subtle">
            {decisions.length} decision{decisions.length === 1 ? "" : "s"}
          </span>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {decisions.length === 0 && (
          <p className="px-2 py-10 text-center text-[13px] leading-relaxed text-fg-subtle">
            Nothing has cleared the gate yet.
            <br />
            Most of what is said never gets here.
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
    </Panel>
  );
}
