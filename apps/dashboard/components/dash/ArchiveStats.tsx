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

  // A sentence, not a metric wall: these are context for the list below,
  // never the point of the page.
  const n = (v: number) => <span className="tnum font-medium text-fg">{v.toLocaleString()}</span>;

  return (
    <p className="mb-4 text-[13px] leading-relaxed text-fg-muted">
      {n(stats.meetings)} meeting{stats.meetings === 1 ? "" : "s"} archived ·{" "}
      {n(stats.lines)} lines transcribed, {n(stats.gooseLines)} of them spoken by
      the goose ·{" "}
      <span className="tnum font-medium text-fg">{fmtHours(stats.totalDurationMs)}</span>{" "}
      in rooms
    </p>
  );
}
