"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, Input } from "@/components/ui";
import {
  STATUS_LABEL,
  fetchSessions,
  searchMeetings,
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

function fmtDuration(ms?: number): string | null {
  if (!ms || ms < 1000) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function SessionsList({
  limit,
  searchable = false,
}: {
  limit?: number;
  /** Show the transcript search box (MongoDB full-text index). */
  searchable?: boolean;
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSummary[] | null>(null);
  const [searching, setSearching] = useState(false);

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

  // Debounced full-text search over stored transcripts.
  useEffect(() => {
    const q = query.trim();
    if (!searchable || !q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await searchMeetings(q));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, searchable]);

  const search = searchable ? (
    <div className="mb-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search every saved transcript…"
        aria-label="Search transcripts"
      />
    </div>
  ) : null;

  if (sessions === null) {
    return (
      <>
        {search}
        <div className="rounded-[var(--r)] border border-border px-5 py-8 text-center text-[13px] text-fg-subtle">
          Loading…
        </div>
      </>
    );
  }

  if (!reachable) {
    return (
      <div className="rounded-[var(--r)] border border-border">
        <Empty
          title="Agent not reachable"
          body="Start the backend (npm run backend) so the goose can join meetings."
        />
      </div>
    );
  }

  const searchMode = results !== null;
  const rows = searchMode ? results : limit ? sessions.slice(0, limit) : sessions;

  if (rows.length === 0) {
    return (
      <>
        {search}
        <div className="rounded-[var(--r)] border border-border">
          {searchMode ? (
            <Empty
              title={searching ? "Searching…" : "No transcripts match"}
              body={`Nothing saved mentions “${query.trim()}”.`}
            />
          ) : (
            <Empty
              title="No meetings yet"
              body="Paste a Google Meet link above and send the goose in. Transcripts are saved and show up here."
            />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {search}
      <div className="overflow-hidden rounded-[var(--r)] border border-border">
        {rows.map((s) => {
          const duration = fmtDuration(s.durationMs);
          return (
            <Link
              key={s.id}
              href={`/app/meetings/${s.id}`}
              className="flex items-center gap-3 border-b border-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-bg-subtle"
            >
              <span
                className={s.status === "listening" && s.live ? "dot dot-pulse" : "dot"}
                style={{ color: STATUS_COLOR[s.status] ?? "var(--fg-subtle)" }}
              />
              <div className="min-w-0 flex-1">
                <p className="tnum truncate text-[13.5px] font-medium text-fg">
                  {meetCode(s.meetUrl)}
                </p>
                <p className="truncate text-[12.5px] text-fg-subtle">
                  {s.snippet ? (
                    <span className="italic">“{s.snippet}”</span>
                  ) : (
                    <>
                      {fmtWhen(s.createdAt)}
                      {duration ? ` · ${duration}` : ""}
                    </>
                  )}
                </p>
              </div>
              <span
                className="text-[12.5px] font-medium"
                style={{ color: STATUS_COLOR[s.status] ?? "var(--fg-subtle)" }}
              >
                {STATUS_LABEL[s.status] ?? s.status}
              </span>
              <span className="tnum w-16 text-right text-[12.5px] text-fg-subtle">
                {s.lineCount} lines
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
