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

  // Defensive: tolerate an older/newer backend that omits a field or still uses
  // the pre-rename name, so a missing stat never crashes the page.
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const plus1Lines = n(stats.plus1Lines ?? (stats as { gooseLines?: number }).gooseLines);

  const items: [string, string][] = [
    ["Meetings archived", String(n(stats.meetings))],
    ["Lines transcribed", n(stats.lines).toLocaleString()],
    ["Spoken by the plus1", plus1Lines.toLocaleString()],
    ["Time in rooms", fmtHours(n(stats.totalDurationMs))],
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
