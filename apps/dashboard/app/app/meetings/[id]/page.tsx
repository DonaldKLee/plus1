import Link from "next/link";
import { notFound } from "next/navigation";
import { Console } from "@/components/console/Console";
import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { Button } from "@/components/ui";
import { ArtifactIcon, Arrow } from "@/components/icons";
import { ARTIFACT_META } from "@/lib/maps";
import { MEETINGS, fmtDay, fmtDuration, meetingById } from "@/lib/meetings";
import { ACCENT_VAR, personaById } from "@/lib/personas";

export function generateStaticParams() {
  return MEETINGS.map((m) => ({ id: m.id }));
}

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meeting = meetingById(id);
  if (!meeting) notFound();

  // The fixture only carries one full replay; that session opens the live console.
  if (meeting.status === "live") {
    return <Console personaId={meeting.personaId} />;
  }

  const persona = personaById(meeting.personaId);
  const accent = ACCENT_VAR[persona.accent];
  const total = meeting.counts.acted + meeting.counts.ignored;
  const quietPct = total ? Math.round((meeting.counts.ignored / total) * 100) : 0;

  return (
    <>
      <PageHeader
        title={meeting.title}
        description={`${fmtDay(meeting.date)} at ${meeting.startedAtLabel} · ${fmtDuration(meeting.durationMs)} · ${persona.name} was in the room.`}
        right={
          <Link href="/app/meetings">
            <Button variant="secondary" size="sm">
              <Arrow width={14} height={14} className="rotate-180" />
              All meetings
            </Button>
          </Link>
        }
      />

      <PageBody>
        <div className="grid grid-cols-2 overflow-hidden rounded-[var(--r)] border border-border sm:grid-cols-4">
          {[
            { label: "Utterances", value: meeting.counts.utterances, note: "heard and attributed" },
            {
              label: "Spoke or acted",
              value: meeting.counts.acted,
              note: "cleared the gate",
              color: "var(--act)",
            },
            {
              label: "Stayed quiet",
              value: meeting.counts.ignored,
              note: `${quietPct}% of the room`,
            },
            {
              label: "Honks",
              value: meeting.counts.honks,
              note: meeting.counts.honks ? "disagreement flagged" : "nothing to flag",
              color: meeting.counts.honks ? "var(--alert)" : undefined,
            },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`px-4 py-3.5 ${i < 2 ? "border-b border-border sm:border-b-0" : ""} ${i % 2 === 1 ? "border-l border-border" : ""} ${i === 2 ? "sm:border-l" : ""}`}
            >
              <p className="eyebrow">{s.label}</p>
              <p
                className="tnum mt-1.5 text-[19px] font-medium tracking-[-0.02em] text-fg"
                style={s.color ? { color: s.color } : undefined}
              >
                {s.value}
              </p>
              <p className="mt-0.5 text-[12px] text-fg-subtle">{s.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section>
            <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.02em] text-fg">
              What it produced
            </h2>
            {meeting.artifacts.length > 0 ? (
              <div className="overflow-hidden rounded-[var(--r)] border border-border">
                {meeting.artifacts.map((a, i) => {
                  const meta = ARTIFACT_META[a.kind];
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0"
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] border border-border"
                        style={{ color: meta.color }}
                      >
                        <ArtifactIcon kind={a.kind} width={16} height={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium text-fg">{a.title}</p>
                        <p className="text-[12.5px]" style={{ color: meta.color }}>
                          {meta.label}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm">
                        Open
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[var(--r)] border border-border px-5 py-8 text-center">
                <p className="text-[13.5px] font-medium text-fg">Nothing was produced</p>
                <p className="mx-auto mt-1 max-w-[46ch] text-[13px] leading-relaxed text-fg-muted">
                  {persona.name} ran in silent mode for this meeting — present, indexing the
                  conversation, taking no action.
                </p>
              </div>
            )}

            <div className="mt-5 rounded-[var(--r)] border border-border bg-bg-subtle px-5 py-4">
              <p className="text-[13.5px] font-medium text-fg">Full replay not available</p>
              <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-fg-muted">
                Transcript replay with gate decisions is wired to the live session for now. Open{" "}
                <Link
                  href="/app/meetings/s_htn_sponsor_01"
                  className="font-medium text-fg underline decoration-border-strong hover:decoration-fg"
                >
                  HTN — Sponsorship sync
                </Link>{" "}
                to watch one end to end.
              </p>
            </div>
          </section>

          <aside className="flex flex-col gap-5">
            <div className="rounded-[var(--r)] border border-border p-4">
              <p className="eyebrow mb-2.5">Persona</p>
              <div className="flex items-center gap-2">
                <span className="dot" style={{ color: accent }} />
                <span className="text-[13.5px] font-medium text-fg">{persona.name}</span>
                <span className="text-[12.5px] text-fg-subtle">{persona.role}</span>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{persona.purpose}</p>
              <Link
                href="/app/personas"
                className="mt-3 inline-block text-[12.5px] font-medium text-fg-muted transition-colors hover:text-fg"
              >
                View brief
              </Link>
            </div>

            <div className="rounded-[var(--r)] border border-border p-4">
              <p className="eyebrow mb-2.5">In the room</p>
              <ul className="flex flex-col gap-2">
                {meeting.participants.map((p) => (
                  <li key={p.name} className="flex items-center gap-2.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bg-raise text-[10px] font-semibold text-fg-muted">
                      {p.initials}
                    </span>
                    <span className="text-[13px] text-fg">{p.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
