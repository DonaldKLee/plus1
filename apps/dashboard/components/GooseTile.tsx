"use client";

import { Goose } from "./Goose";
import { Dot } from "./icons";
import { GOOSE_STATE_META } from "@/lib/maps";
import type { GooseState } from "@/lib/types";

export function GooseTile({
  gooseName,
  state,
  amplitude,
  honking,
}: {
  gooseName: string;
  state: GooseState;
  amplitude: number;
  honking: boolean;
}) {
  const meta = GOOSE_STATE_META[state];
  const bars = 22;

  return (
    <section
      className={`panel reticle relative flex flex-col overflow-hidden ${honking ? "honk-flash" : ""}`}
      style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta.color} 22%, transparent)` }}
    >
      {/* tile header */}
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="led led-pulse" style={{ color: "var(--color-alert)" }} />
          <span className="label" style={{ color: "var(--color-ink-2)" }}>
            CAM · plus1
          </span>
        </div>
        <span className="chip" style={{ color: meta.color }}>
          <span className="led" style={{ color: meta.color }} />
          {meta.label}
        </span>
      </div>

      {/* the feed */}
      <div className="relative aspect-[4/3] w-full">
        <Goose state={state} amplitude={amplitude} />
        {/* nameplate, like a broadcast lower-third */}
        <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-[2px] border border-line-2 bg-[color-mix(in_srgb,var(--color-bg)_78%,transparent)] px-2 py-1 backdrop-blur-sm">
          <span className="font-display text-[12px] font-600 tracking-tight text-ink">
            {gooseName}
          </span>
          <span className="chip !py-0 !px-1.5 text-[9px]" style={{ color: "var(--color-act)" }}>
            AI
          </span>
        </div>
        {/* framing corners */}
        <div className="pointer-events-none absolute left-2 top-2 h-3 w-3 border-l border-t border-line-2 opacity-70" />
        <div className="pointer-events-none absolute right-2 top-2 h-3 w-3 border-r border-t border-line-2 opacity-70" />
      </div>

      {/* amplitude / voice meter */}
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <span className="label shrink-0">VOICE</span>
        <div className="flex h-4 flex-1 items-end gap-[2px]">
          {Array.from({ length: bars }).map((_, i) => {
            const speaking = state === "speaking" || state === "honk";
            const phase = Math.sin((i / bars) * 6 + amplitude * 8);
            const h = speaking
              ? 12 + Math.abs(phase) * amplitude * 12 + (i % 3) * 2
              : 2;
            return (
              <span
                key={i}
                className="w-full rounded-[1px] transition-[height] duration-100"
                style={{
                  height: Math.min(16, h),
                  background: speaking ? meta.color : "var(--color-line-2)",
                  boxShadow: speaking
                    ? `0 0 6px -1px ${meta.color}`
                    : "none",
                }}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
