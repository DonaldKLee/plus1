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
  const gooseLines = n(stats.plus1Lines ?? (stats as { gooseLines?: number }).gooseLines);

  return (
    <p className="mb-4 text-[13px] leading-relaxed text-fg-muted">
      <span className="tnum font-medium text-fg">{n(stats.meetings)}</span> meeting{n(stats.meetings) === 1 ? "" : "s"} archived ·{" "}
      <span className="tnum font-medium text-fg">{n(stats.lines).toLocaleString()}</span> lines transcribed,{" "}
      <span className="tnum font-medium text-fg">{gooseLines.toLocaleString()}</span> of them spoken by plus1 ·{" "}
      <span className="tnum font-medium text-fg">{fmtHours(n(stats.totalDurationMs))}</span> in rooms
    </p>
  );
}
