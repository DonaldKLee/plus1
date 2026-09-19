"use client";

import { fixture } from "@/lib/fixture";
import { useMeetingReplay } from "@/lib/replay";
import { StatusBar } from "./StatusBar";
import { Transcript } from "./Transcript";
import { Mind } from "./Mind";
import { Artifacts } from "./Artifacts";
import { GooseTile } from "./GooseTile";

export function ConsoleView() {
  const r = useMeetingReplay(fixture);
  const cycleSpeed = () => r.setSpeed(r.speed === 1 ? 2 : r.speed === 2 ? 4 : 1);

  return (
    <div className="flex min-h-0 flex-col gap-2.5 lg:flex-1">
      <StatusBar
        meta={fixture.meta}
        clock={r.clock}
        endT={r.endT}
        playing={r.playing}
        speed={r.speed}
        gooseState={r.gooseState}
        activeSpeaker={r.activeSpeaker}
        onToggle={r.toggle}
        onRestart={r.restart}
        onSpeed={cycleSpeed}
        onSeek={r.seek}
      />

      <div className="console-grid">
        <div className="area-goose">
          <GooseTile
            gooseName={fixture.meta.gooseName}
            state={r.gooseState}
            amplitude={r.amplitude}
            honking={Boolean(r.honk)}
          />
        </div>
        <div className="area-transcript min-w-0">
          <Transcript fixture={fixture} clock={r.clock} gooseName={fixture.meta.gooseName} />
        </div>
        <div className="area-mind min-w-0">
          <Mind decisions={r.decisions} />
        </div>
        <div className="area-artifacts min-w-0">
          <Artifacts artifacts={r.artifacts} />
        </div>
      </div>

      {/* honk banner */}
      {r.honk && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center pt-24">
          <div
            className="shake flex items-center gap-3 rounded-[4px] border px-5 py-3"
            style={{
              borderColor: "var(--color-alert)",
              background: "color-mix(in srgb, var(--color-alert) 16%, var(--color-bg))",
              boxShadow: "0 0 40px -6px var(--color-alert)",
            }}
          >
            <span className="led led-pulse" style={{ color: "var(--color-alert)" }} />
            <div>
              <div className="font-display text-[20px] font-700 tracking-tight" style={{ color: "var(--color-alert)" }}>
                HONK
              </div>
              <div className="data text-[10px] text-ink-2">
                {r.honk.reason}{r.honk.detail ? ` · ${r.honk.detail}` : ""}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
