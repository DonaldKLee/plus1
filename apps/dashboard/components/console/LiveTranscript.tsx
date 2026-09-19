"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Panel, PanelHead } from "@/components/ui";
import { Arrow } from "@/components/icons";
import {
  STATUS_LABEL,
  fmtClock,
  leaveSession,
  streamUrl,
  type SessionStatus,
  type TranscriptLine,
} from "@/lib/session";

const STATUS_COLOR: Record<SessionStatus, string> = {
  joining: "var(--brand)",
  "waiting-admit": "var(--brand)",
  listening: "var(--live)",
  ended: "var(--fg-subtle)",
  error: "var(--alert)",
};

export function LiveTranscript({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<SessionStatus>("joining");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(streamUrl(sessionId));

    es.addEventListener("status", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setStatus(d.status as SessionStatus);
      setError(d.error ?? null);
      if (Array.isArray(d.notes)) setNotes(d.notes);
    });
    es.addEventListener("line", (e) => {
      const line = JSON.parse((e as MessageEvent).data) as TranscriptLine;
      setLines((prev) => {
        const i = prev.findIndex((l) => l.id === line.id);
        if (i === -1) return [...prev, line];
        const next = prev.slice();
        next[i] = line; // upsert: partial lines grow in place
        return next;
      });
    });
    es.addEventListener("note", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { msg: string };
      setNotes((prev) => [...prev.slice(-20), d.msg]);
    });
    es.onerror = () => {
      // The browser auto-reconnects; nothing to do but let it retry.
    };

    return () => es.close();
  }, [sessionId]);

  const lastLen = lines[lines.length - 1]?.text.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length, lastLen]);

  const live = status === "listening";
  const working = status === "joining" || status === "waiting-admit";

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link href="/app/meetings">
          <Button variant="secondary" size="sm">
            <Arrow width={14} height={14} className="rotate-180" />
            All meetings
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <span
            className={live ? "dot dot-pulse" : "dot"}
            style={{ color: STATUS_COLOR[status] }}
          />
          <span
            className="text-[13px] font-medium"
            style={{ color: STATUS_COLOR[status] }}
          >
            {STATUS_LABEL[status]}
          </span>
          {(live || working) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => leaveSession(sessionId)}
            >
              Leave call
            </Button>
          )}
        </div>
      </div>

      <Panel as="section" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHead
          title="Live transcript"
          right={
            <span className="tnum text-[12px] text-fg-subtle">
              {lines.length} lines
            </span>
          }
        />

        {notes.length > 0 && (live || working) && (
          <p className="tnum border-b border-border px-4 py-1.5 text-[11.5px] text-fg-subtle">
            {notes[notes.length - 1]}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p
              className="px-4 py-3 text-[13px]"
              style={{ color: "var(--alert)" }}
            >
              {error}
            </p>
          )}

          {lines.length === 0 && !error && (
            <div className="px-4 py-12 text-center">
              <p className="text-[13.5px] text-fg-muted">
                {working
                  ? "The goose is joining the room…"
                  : status === "ended"
                    ? "This session has ended."
                    : "Listening. Transcript will appear as people speak."}
              </p>
              {notes.length > 0 && (
                <p className="tnum mx-auto mt-2 max-w-[60ch] text-[12px] leading-relaxed text-fg-subtle">
                  {notes[notes.length - 1]}
                </p>
              )}
            </div>
          )}

          {lines.map((l) => (
            <article
              key={l.id}
              className="rise-in flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <span className="tnum mt-[2px] shrink-0 text-[11px] text-fg-subtle">
                {fmtClock(l.t)}
              </span>
              <p className="text-[13.5px] leading-relaxed text-fg">
                {l.text}
                {l.partial && (
                  <span
                    className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[2px] animate-pulse"
                    style={{ background: "var(--live)" }}
                    aria-hidden
                  />
                )}
              </p>
            </article>
          ))}
          <div ref={endRef} />
        </div>
      </Panel>
    </div>
  );
}
