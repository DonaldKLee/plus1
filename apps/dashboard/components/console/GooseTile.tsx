"use client";

import { Goose } from "./Goose";
import { GOOSE_STATE_META } from "@/lib/maps";
import type { GooseState } from "@/lib/types";
import { Panel, PanelHead, cx } from "@/components/ui";

const BARS = 24;

export function GooseTile({
  gooseName,
  state,
  amplitude,
}: {
  gooseName: string;
  state: GooseState;
  amplitude: number;
}) {
  const meta = GOOSE_STATE_META[state];
  const speaking = state === "speaking" || state === "honk";

  return (
    <Panel as="section" className="flex flex-col overflow-hidden">
      <PanelHead
        title={gooseName}
        right={
          <span className="chip" style={{ color: meta.color }}>
            <span className={cx("dot", state !== "idle" && "dot-pulse")} />
            {meta.label}
          </span>
        }
      />

      <div className="relative aspect-[5/4] w-full">
        <Goose state={state} amplitude={amplitude} />
      </div>

      <div className="flex items-center gap-3 border-t border-border px-3.5 py-2.5">
        <span className="eyebrow shrink-0">Voice</span>
        <div className="flex h-4 flex-1 items-center gap-[2px]">
          {Array.from({ length: BARS }).map((_, i) => {
            const phase = Math.sin((i / BARS) * 6 + amplitude * 8);
            const h = speaking ? 3 + Math.abs(phase) * amplitude * 13 + (i % 3) : 2;
            return (
              <span
                key={i}
                className="w-full rounded-[1px] transition-[height,background-color] duration-100"
                style={{
                  height: Math.min(16, h),
                  background: speaking ? meta.color : "var(--border-strong)",
                }}
              />
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
