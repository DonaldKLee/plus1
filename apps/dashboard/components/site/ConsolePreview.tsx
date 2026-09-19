import { fixture } from "@/lib/fixture";
import { INTENT_META, fmtClock, fmtMs } from "@/lib/maps";
import { GooseMark } from "@/components/ui";

/**
 * A still of the real console, built from the real fixture — not a mockup.
 * The dark panel is the page's one contrast moment.
 */
export function ConsolePreview() {
  const lines = fixture.events
    .filter((e) => e.kind === "utterance" && e.gate && e.text)
    .slice(0, 7);

  const acted = fixture.events.find((e) => e.decision?.plan.tool_calls.length);
  const decision = acted?.decision;

  return (
    <div className="theme-dark overflow-hidden rounded-[var(--r-lg)] border border-border bg-bg text-fg">
      {/* console chrome */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <GooseMark size={18} className="text-fg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-fg">{fixture.meta.meetTitle}</p>
          <p className="tnum truncate text-[11.5px] text-fg-subtle">
            {fixture.meta.meetUrl.replace("https://", "")}
          </p>
        </div>
        <span className="chip shrink-0" style={{ color: "var(--live)" }}>
          <span className="dot dot-pulse" />
          Listening
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* transcript with its gate column */}
        <div className="border-b border-border md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="eyebrow">Transcript</span>
            <span className="eyebrow">Gate</span>
          </div>
          {lines.map((e) => {
            const gm = INTENT_META[e.gate!.intent];
            return (
              <div
                key={e.id}
                className="flex items-start gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 flex items-center gap-2">
                    <span className="text-[12px] font-medium text-fg">{e.speaker}</span>
                    <span className="tnum text-[11px] text-fg-subtle">{fmtClock(e.t)}</span>
                  </p>
                  <p className="line-clamp-2 text-[12.5px] leading-snug text-fg-muted">{e.text}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="chip" style={{ color: gm.color}}>
                    {gm.label}
                  </span>
                  <span className="tnum text-[11px] text-fg-subtle">
                    {e.gate!.confidence.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* what it did about it */}
        <div>
          <div className="border-b border-border px-4 py-2">
            <span className="eyebrow">Reasoning</span>
          </div>

          {decision && (
            <div className="px-4 py-3">
              <ol className="mb-3">
                {decision.hops.slice(0, 5).map((h, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-1">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--act)" }}
                      />
                      <span className="text-[11.5px] font-medium text-fg">{h.stage}</span>
                    </span>
                    <span className="tnum text-[11px] text-fg-subtle">
                      {h.ms === 0 ? "0ms" : `+${fmtMs(h.ms)}`}
                    </span>
                  </li>
                ))}
              </ol>

              <blockquote
                className="border-l pl-3 text-[12.5px] leading-relaxed text-fg"
                style={{ borderColor: "var(--act)" }}
              >
                &ldquo;{decision.plan.say}&rdquo;
              </blockquote>

              {decision.plan.tool_calls[0] && (
                <div className="mt-3 rounded-[var(--r-sm)] border border-border bg-bg-subtle px-2.5 py-2">
                  <p className="tnum text-[11.5px]" style={{ color: "var(--act)" }}>
                    {decision.plan.tool_calls[0].server}.{decision.plan.tool_calls[0].tool}()
                  </p>
                  <p className="mt-1 text-[11.5px] text-fg-subtle">
                    Draft created · link posted in meeting chat
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
