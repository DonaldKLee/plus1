"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty } from "@/components/ui";
import {
  STATUS_LABEL,
  fetchSessions,
  type SessionStatus,
  type SessionSummary,
} from "@/lib/session";

const STATUS_COLOR: Record<SessionStatus, string> = {
  joining: "var(--brand)",
  "waiting-admit": "var(--brand)",
  listening: "var(--live)",
  ended: "var(--fg-subtle)",
  error: "var(--alert)",
};

function meetCode(url: string): string {
  return url.replace(/^https?:\/\/meet\.google\.com\//i, "").split("?")[0];
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SessionsList({ limit }: { limit?: number }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await fetchSessions();
        if (!alive) return;
        setSessions(s);
        setReachable(true);
      } catch {
        if (!alive) return;
        setReachable(false);
        setSessions([]);
      }
    };
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (sessions === null) {
    return (
      <div className="rounded-[var(--r)] border border-border px-5 py-8 text-center text-[13px] text-fg-subtle">
        Loading…
      </div>
    );
  }

  if (!reachable) {
    return (
      <div className="rounded-[var(--r)] border border-border">
        <Empty
          title="Agent not reachable"
          body="Start the federato-agent (npm run dev in apps/federato-agent) so the goose can join meetings."
        />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-[var(--r)] border border-border">
        <Empty
          title="No meetings yet"
          body="Paste a Google Meet link above and send the goose in. Transcripts show up here."
        />
      </div>
    );
  }

  const rows = limit ? sessions.slice(0, limit) : sessions;

  return (
    <div className="overflow-hidden rounded-[var(--r)] border border-border">
      {rows.map((s) => (
        <Link
          key={s.id}
          href={`/app/meetings/${s.id}`}
          className="flex items-center gap-3 border-b border-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-bg-subtle"
        >
          <span
            className={s.status === "listening" ? "dot dot-pulse" : "dot"}
            style={{ color: STATUS_COLOR[s.status] }}
          />
          <div className="min-w-0 flex-1">
            <p className="tnum truncate text-[13.5px] font-medium text-fg">
              {meetCode(s.meetUrl)}
            </p>
            <p className="text-[12.5px] text-fg-subtle">{fmtWhen(s.createdAt)}</p>
          </div>
          <span
            className="text-[12.5px] font-medium"
            style={{ color: STATUS_COLOR[s.status] }}
          >
            {STATUS_LABEL[s.status]}
          </span>
          <span className="tnum w-16 text-right text-[12.5px] text-fg-subtle">
            {s.lineCount} lines
          </span>
        </Link>
      ))}
    </div>
  );
}
