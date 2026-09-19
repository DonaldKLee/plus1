"use client";

import type { Fixture, GooseState } from "@/lib/types";
import { GOOSE_STATE_META, fmtClock } from "@/lib/maps";
import { Play, Pause, Restart, Plus1Mark } from "./icons";

const TINT: Record<string, string> = {
  Kevin: "#7c93b8",
  Shannon: "#b88fb0",
  Priya: "#8fb8a6",
};

export function StatusBar({
  meta,
  clock,
  endT,
  playing,
  speed,
  gooseState,
  activeSpeaker,
  onToggle,
  onRestart,
  onSpeed,
  onSeek,
}: {
  meta: Fixture["meta"];
  clock: number;
  endT: number;
  playing: boolean;
  speed: number;
  gooseState: GooseState;
  activeSpeaker: string | null;
  onToggle: () => void;
  onRestart: () => void;
  onSpeed: () => void;
  onSeek: (t: number) => void;
}) {
  const gm = GOOSE_STATE_META[gooseState];
  const pct = Math.min(100, (clock / endT) * 100);
  const humans = meta.participants.filter((p) => !p.isAgent);

  return (
    <header className="panel reticle sticky top-0 z-30 flex items-center gap-3 px-3 py-2.5 lg:gap-4 lg:px-4">
      {/* wordmark */}
      <div className="flex items-center gap-2.5 pr-4">
        <span style={{ color: "var(--color-act)" }}>
          <Plus1Mark />
        </span>
        <div className="leading-none">
          <div className="font-display text-[16px] font-700 tracking-tight text-ink">
            plus1
          </div>
          <div className="label !text-[8.5px] mt-0.5">MEETING CONSOLE</div>
        </div>
      </div>

      <div className="h-8 w-px bg-line" />

      {/* mission clock */}
      <div className="flex items-center gap-2.5">
        <span className="led led-pulse" style={{ color: "var(--color-alert)" }} />
        <div className="leading-none">
          <div className="data text-[17px] font-600 tabnum text-ink">
            T+{fmtClock(clock)}
          </div>
          <div className="label !text-[8.5px] mt-1">{meta.sessionId}</div>
        </div>
      </div>

      <div className="h-8 w-px bg-line" />

      {/* meeting title */}
      <div className="hidden min-w-0 leading-none md:block">
        <div className="truncate text-[13px] font-600 text-ink">{meta.meetTitle}</div>
        <div className="data mt-1 truncate text-[10px] text-ink-3">
          {meta.meetUrl.replace("https://", "")}
        </div>
      </div>

      <div className="flex-1" />

      {/* participants */}
      <div className="hidden items-center lg:flex">
        {humans.map((p, i) => {
          const speaking = activeSpeaker === p.name;
          const tint = TINT[p.name] ?? "#8593ab";
          return (
            <div
              key={p.name}
              title={`${p.name} · ${p.role}`}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-600 transition-all"
              style={{
                marginLeft: i === 0 ? 0 : -6,
                zIndex: humans.length - i,
                color: tint,
                background: "var(--color-panel-2)",
                border: `1.5px solid ${speaking ? tint : "var(--color-line-2)"}`,
                boxShadow: speaking ? `0 0 10px -2px ${tint}` : "none",
              }}
            >
              {p.initials}
            </div>
          );
        })}
        <span className="data ml-2 text-[10px] text-ink-3">{humans.length} in call</span>
      </div>

      <div className="hidden h-8 w-px bg-line lg:block" />

      {/* goose state */}
      <div
        className="hidden items-center gap-2 rounded-[3px] border px-2.5 py-1.5 lg:flex"
        style={{
          borderColor: `color-mix(in srgb, ${gm.color} 40%, transparent)`,
          background: `color-mix(in srgb, ${gm.color} 8%, transparent)`,
        }}
      >
        <span className={`led ${gooseState !== "idle" ? "led-pulse" : ""}`} style={{ color: gm.color }} />
        <div className="leading-none">
          <div className="data text-[11px] font-600" style={{ color: gm.color }}>
            {gm.label}
          </div>
          <div className="label !text-[8px] mt-0.5">{meta.gooseName}</div>
        </div>
      </div>

      {/* transport */}
      <div className="flex items-center gap-1">
        <button
          onClick={onRestart}
          title="restart"
          className="flex h-8 w-8 items-center justify-center rounded-[3px] border border-line text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
        >
          <Restart width={15} height={15} />
        </button>
        <button
          onClick={onToggle}
          title={playing ? "pause" : "play"}
          className="flex h-8 w-8 items-center justify-center rounded-[3px] border text-bg transition-colors"
          style={{ background: "var(--color-act)", borderColor: "var(--color-act)" }}
        >
          {playing ? <Pause width={15} height={15} /> : <Play width={15} height={15} />}
        </button>
        <button
          onClick={onSpeed}
          title="playback speed"
          className="flex h-8 w-11 items-center justify-center rounded-[3px] border border-line data text-[11px] font-600 text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
        >
          {speed}×
        </button>
      </div>

      {/* scrub / progress */}
      <input
        type="range"
        min={0}
        max={endT}
        value={clock}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="scrub timeline"
        className="absolute inset-x-0 bottom-0 h-1 w-full cursor-pointer appearance-none bg-transparent"
        style={{
          background: `linear-gradient(90deg, var(--color-act) ${pct}%, var(--color-line) ${pct}%)`,
        }}
      />
    </header>
  );
}
