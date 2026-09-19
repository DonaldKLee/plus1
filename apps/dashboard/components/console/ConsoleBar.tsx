"use client";

import Link from "next/link";
import type { Fixture, GooseState } from "@/lib/types";
import { GOOSE_STATE_META, fmtClock } from "@/lib/maps";
import { Play, Pause, Restart, Arrow } from "@/components/icons";
import { cx } from "@/components/ui";
import { ACCENT_VAR, personaById } from "@/lib/personas";

export function ConsoleBar({
  meta,
  personaId,
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
  personaId: string;
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
  const persona = personaById(personaId);

  return (
    <header className="relative shrink-0 border-b border-border bg-bg">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 lg:flex-nowrap lg:px-5">
        <Link
          href="/app/meetings"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] border border-border text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          aria-label="Back to meetings"
        >
          <Arrow width={15} height={15} className="rotate-180" />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[14px] font-semibold tracking-[-0.02em] text-fg">
              {meta.meetTitle}
            </h1>
            <span className="chip shrink-0" style={{ color: ACCENT_VAR[persona.accent] }}>
              {persona.name}
            </span>
          </div>
          <p className="tnum mt-0.5 truncate text-[12px] text-fg-subtle">
            {meta.meetUrl.replace("https://", "")} · started {meta.startedAtLabel}
          </p>
        </div>

        <div className="hidden items-center xl:flex">
          {humans.map((p, i) => {
            const speaking = activeSpeaker === p.name;
            return (
              <span
                key={p.name}
                title={`${p.name} · ${p.role}`}
                className={cx(
                  "flex h-7 w-7 items-center justify-center rounded-full text-[10.5px] font-semibold transition-colors duration-200",
                  speaking ? "text-fg" : "text-fg-muted",
                )}
                style={{
                  marginLeft: i === 0 ? 0 : -6,
                  zIndex: humans.length - i,
                  background: "var(--bg-raise)",
                  border: `1.5px solid ${speaking ? "var(--live)" : "var(--border-strong)"}`,
                }}
              >
                {p.initials}
              </span>
            );
          })}
          <span className="ml-2.5 text-[12px] text-fg-subtle">{humans.length} in call</span>
        </div>

        <span className="chip shrink-0" style={{ color: gm.color }}>
          <span className={cx("dot", gooseState !== "idle" && "dot-pulse")} />
          {gm.label}
        </span>

        <div className="flex shrink-0 items-center gap-2">
          <span className="tnum text-[13px] font-medium text-fg">{fmtClock(clock)}</span>
          <span className="tnum text-[12px] text-fg-subtle">/ {fmtClock(endT)}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onRestart}
            title="Restart"
            aria-label="Restart replay"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-sm)] border border-border text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            <Restart width={15} height={15} />
          </button>
          <button
            onClick={onToggle}
            aria-label={playing ? "Pause replay" : "Play replay"}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-sm)] bg-inverse-bg text-inverse-fg transition-opacity hover:opacity-85"
          >
            {playing ? <Pause width={15} height={15} /> : <Play width={15} height={15} />}
          </button>
          <button
            onClick={onSpeed}
            aria-label={`Playback speed ${speed}x`}
            className="tnum flex h-8 w-11 items-center justify-center rounded-[var(--r-sm)] border border-border text-[12.5px] font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            {speed}&times;
          </button>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={endT}
        value={clock}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Scrub the meeting timeline"
        className="scrub"
        style={{ ["--pct" as string]: `${pct}%` }}
      />
    </header>
  );
}
