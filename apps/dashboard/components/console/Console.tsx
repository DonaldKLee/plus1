"use client";

import { fixture } from "@/lib/fixture";
import { useMeetingReplay } from "@/lib/replay";
import { ConsoleBar } from "./ConsoleBar";
import { Transcript } from "./Transcript";
import { Mind } from "./Mind";
import { Artifacts } from "./Artifacts";
import { GooseTile } from "./GooseTile";

export function Console({ personaId }: { personaId: string }) {
  const r = useMeetingReplay(fixture);
  const cycleSpeed = () => r.setSpeed(r.speed === 1 ? 2 : r.speed === 2 ? 4 : 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConsoleBar
        meta={fixture.meta}
        personaId={personaId}
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

      <div className="flex min-h-0 flex-1 flex-col p-3 lg:p-4">
        <div className="console-grid">
          <div className="area-goose">
            <GooseTile
              gooseName={fixture.meta.gooseName}
              state={r.gooseState}
              amplitude={r.amplitude}
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
      </div>

      {r.honk && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4"
        >
          <div
            className="shake flex items-center gap-3 rounded-[var(--r)] border px-4 py-3"
            style={{
              borderColor: "color-mix(in srgb, var(--alert) 45%, transparent)",
              background: "color-mix(in srgb, var(--alert) 14%, var(--bg))",
            }}
          >
            <span className="dot dot-pulse" style={{ color: "var(--alert)" }} />
            <div>
              <p className="text-[14px] font-semibold tracking-[-0.02em]" style={{ color: "var(--alert)" }}>
                Honk
              </p>
              <p className="mt-0.5 text-[12.5px] text-fg-muted">
                {r.honk.reason}
                {r.honk.detail ? ` · ${r.honk.detail}` : ""}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
