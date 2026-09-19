"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input, Panel, PanelHead } from "@/components/ui";
import { Arrow } from "@/components/icons";
import {
  STATUS_LABEL,
  fmtClock,
  filler,
  honk,
  interrupt,
  leaveSession,
  speak,
  streamUrl,
  type AvatarState,
  type DecisionRecord,
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

const ACTION_META: Record<
  DecisionRecord["action"],
  { label: string; color: string }
> = {
  speak: { label: "Speak", color: "var(--act, #4ade80)" },
  chat: { label: "Chat", color: "var(--brand)" },
  tool: { label: "Tool", color: "#c084fc" },
  none: { label: "Hold", color: "var(--fg-subtle)" },
};

export function LiveTranscript({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<SessionStatus>("joining");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [avatar, setAvatar] = useState<AvatarState | null>(null);
  const [say, setSay] = useState("");
  const [sending, setSending] = useState(false);
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
    es.addEventListener("decision", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as DecisionRecord;
      setDecisions((prev) => {
        const i = prev.findIndex((x) => x.id === d.id);
        if (i === -1) return [...prev, d];
        const next = prev.slice();
        next[i] = d; // outcome updates in place
        return next;
      });
    });
    es.addEventListener("avatar", (e) => {
      setAvatar(JSON.parse((e as MessageEvent).data) as AvatarState);
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
  const acted = decisions.filter((d) => d.outcome && d.outcome !== "held" && d.outcome !== "below threshold");
  const avatarReady = avatar?.session === "ready" || avatar?.session === "speaking";

  async function submitSay(e: React.FormEvent) {
    e.preventDefault();
    const text = say.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await speak(sessionId, text);
      setSay("");
    } catch (err) {
      setNotes((prev) => [...prev.slice(-20), `speak failed: ${(err as Error).message}`]);
    } finally {
      setSending(false);
    }
  }

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
            <Button variant="ghost" size="sm" onClick={() => leaveSession(sessionId)}>
              Leave call
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Transcript */}
        <Panel as="section" className="flex min-h-0 flex-col overflow-hidden">
          <PanelHead
            title="Live transcript"
            right={<span className="tnum text-[12px] text-fg-subtle">{lines.length} lines</span>}
          />

          {notes.length > 0 && (live || working) && (
            <p className="tnum border-b border-border px-4 py-1.5 text-[11.5px] text-fg-subtle">
              {notes[notes.length - 1]}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && (
              <p className="px-4 py-3 text-[13px]" style={{ color: "var(--alert)" }}>
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
                <p
                  className="text-[13.5px] leading-relaxed"
                  style={{ color: l.agent ? "var(--brand)" : "var(--fg)" }}
                >
                  {l.agent && <span className="mr-1.5 font-medium">{l.speaker ?? "goose"}:</span>}
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

          {/* Operator controls: make the goose speak by hand, or cut it off. The brain does the rest. */}
          {(live || working) && (
            <form onSubmit={submitSay} className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
              <span
                className={avatar?.speaking ? "dot dot-pulse" : "dot"}
                style={{ color: avatarReady ? "var(--live)" : "var(--fg-subtle)" }}
                title={avatar ? `avatar ${avatar.session} · media ${avatar.media}` : "avatar not started"}
              />
              <Input
                value={say}
                onChange={(e) => setSay(e.target.value)}
                disabled={!avatarReady || sending}
                placeholder={avatarReady ? "make the goose say…" : "avatar warming up…"}
                className="min-w-0 flex-1 disabled:opacity-50"
                autoComplete="off"
              />
              <Button type="submit" variant="primary" size="sm" disabled={!avatarReady || sending || !say.trim()}>
                Say it
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={!avatarReady} onClick={() => void filler(sessionId, "ack")}>
                “on it”
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={!avatarReady} onClick={() => void interrupt(sessionId)}>
                Interrupt
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={!avatarReady} onClick={() => void honk(sessionId)}>
                Honk
              </Button>
            </form>
          )}
        </Panel>

        {/* Decisions */}
        <Panel as="section" className="flex min-h-0 flex-col overflow-hidden">
          <PanelHead
            title="Goose decisions"
            right={<span className="tnum text-[12px] text-fg-subtle">{acted.length} acted</span>}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {decisions.length === 0 && (
              <p className="px-4 py-10 text-center text-[13px] text-fg-subtle">
                The goose reads every line and decides whether to speak, chat, or
                call a tool. Its reasoning shows up here.
              </p>
            )}
            {decisions
              .slice()
              .reverse()
              .map((d) => {
                const meta = ACTION_META[d.action];
                const didAct = d.outcome && d.outcome !== "held" && d.outcome !== "below threshold";
                return (
                  <article key={d.id} className="rise-in border-b border-border px-4 py-3 last:border-b-0">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className="rounded-[var(--r-sm)] px-1.5 py-0.5 text-[11px] font-medium"
                        style={{
                          color: meta.color,
                          background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                        }}
                      >
                        {meta.label}
                      </span>
                      <span className="tnum text-[11px] text-fg-subtle">
                        {Math.round(d.confidence * 100)}%
                      </span>
                      <span className="tnum ml-auto text-[11px] text-fg-subtle">
                        {fmtClock(d.t)}
                      </span>
                    </div>
                    <p className="text-[12.5px] leading-snug text-fg-muted">{d.reason}</p>
                    {(d.say || d.chatMessage) && (
                      <p className="mt-1.5 text-[13px] italic leading-snug text-fg">
                        “{d.say ?? d.chatMessage}”
                      </p>
                    )}
                    {d.tool?.name && (
                      <p className="tnum mt-1.5 text-[12px] text-fg-muted">
                        {d.tool.name}({d.tool.query ?? ""})
                      </p>
                    )}
                    {d.outcome && (
                      <p
                        className="mt-1.5 text-[11.5px] font-medium"
                        style={{ color: didAct ? meta.color : "var(--fg-subtle)" }}
                      >
                        {d.outcome}
                      </p>
                    )}
                  </article>
                );
              })}
          </div>
        </Panel>
      </div>
    </div>
  );
}
