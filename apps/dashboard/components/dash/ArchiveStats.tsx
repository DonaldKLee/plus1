"use client";

import { useEffect, useState } from "react";
import { fetchStats, type MeetingStats } from "@/lib/session";

function fmtHours(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Totals across everything stored in MongoDB. Hidden when no store is configured. */
export function ArchiveStats() {
  const [stats, setStats] = useState<MeetingStats | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await fetchStats();
        if (alive) setStats(s);
      } catch {
        if (alive) setStats(null);
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!stats || stats.meetings === 0) return null;

  const items: [string, string][] = [
    ["Meetings archived", String(stats.meetings)],
    ["Lines transcribed", stats.lines.toLocaleString()],
    ["Spoken by the goose", stats.gooseLines.toLocaleString()],
    ["Time in rooms", fmtHours(stats.totalDurationMs)],
  ];

  return (
    <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r)] border border-border bg-border sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="bg-bg px-4 py-3">
          <p className="tnum text-[18px] font-semibold tracking-[-0.02em] text-fg">{value}</p>
          <p className="text-[12px] text-fg-subtle">{label}</p>
        </div>
      ))}
    </div>
  );
}
