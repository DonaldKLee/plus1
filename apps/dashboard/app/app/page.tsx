import Link from "next/link";
import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { JoinMeeting } from "@/components/dash/JoinMeeting";
import { MeetingsTable } from "@/components/dash/MeetingsTable";
import { Button } from "@/components/ui";
import { MEETINGS, fmtDuration, liveMeeting } from "@/lib/meetings";
import { ACCENT_VAR, personaById } from "@/lib/personas";

const recent = MEETINGS.slice(0, 4);

const totals = MEETINGS.reduce(
  (a, m) => ({
    meetings: a.meetings + 1,
    acted: a.acted + m.counts.acted,
    ignored: a.ignored + m.counts.ignored,
    artifacts: a.artifacts + m.artifacts.length,
  }),
  { meetings: 0, acted: 0, ignored: 0, artifacts: 0 },
);

const SUMMARY: {
  label: string;
  value: string;
  note: string;
  color?: string;
}[] = [
  { label: "Meetings", value: String(totals.meetings), note: "last 14 days" },
  {
    label: "Spoke or acted",
    value: String(totals.acted),
    note: "gate said yes",
    color: "var(--act)",
  },
  {
    label: "Stayed quiet",
    value: String(totals.ignored),
    note: "gate said no",
  },
  {
    label: "Artifacts",
    value: String(totals.artifacts),
    note: "drafts, reviews, notes",
  },
];

export default function DashboardHome() {
  return (
    <>
      <PageHeader
        title="Home"
        description="Paste a Meet link, choose who the goose should be in that room, and send it in. It joins as a visible guest and starts working while the meeting runs."
      />

      <PageBody>
        <JoinMeeting />

        {/* The operator is mid-call on a second screen: a running session
            outranks any aggregate below it. */}
        {liveMeeting && (
          <section className="mt-6 flex flex-col gap-4 rounded-[var(--r)] border border-border bg-bg-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className="dot dot-pulse mt-[7px]"
                style={{ color: "var(--live)" }}
              />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[14px] font-medium text-fg">
                    {liveMeeting.title}
                  </span>
                  <span className="chip" style={{ color: "var(--live)" }}>
                    Live now
                  </span>
                </p>
                <p className="mt-1 text-[13px] text-fg-muted">
                  <span
                    className="font-medium"
                    style={{
                      color:
                        ACCENT_VAR[personaById(liveMeeting.personaId).accent],
                    }}
                  >
                    {personaById(liveMeeting.personaId).name}
                  </span>{" "}
                  is in the room · {liveMeeting.participants.length} others ·{" "}
                  <span className="tnum">
                    {fmtDuration(liveMeeting.durationMs)}
                  </span>{" "}
                  elapsed
                </p>
              </div>
            </div>
            <Link href={`/app/meetings/${liveMeeting.id}`} className="shrink-0">
              <Button variant="primary">Open the console</Button>
            </Link>
          </section>
        )}

        <div className="mt-6 grid grid-cols-2 divide-border overflow-hidden rounded-[var(--r)] border border-border sm:grid-cols-4 sm:divide-x">
          {SUMMARY.map((s, i) => (
            <div
              key={s.label}
              className={`px-4 py-3.5 ${i < 2 ? "border-b border-border sm:border-b-0" : ""} ${i % 2 === 1 ? "border-l border-border sm:border-l-0" : ""}`}
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

        <section className="mt-9">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-fg">
              Recent meetings
            </h2>
            <Link
              href="/app/meetings"
              className="text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
            >
              View all
            </Link>
          </div>
          <MeetingsTable meetings={recent} />
        </section>

        <section className="mt-9 flex flex-col gap-3 rounded-[var(--r)] border border-border bg-bg-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13.5px] font-medium text-fg">
              Give the goose a different job
            </p>
            <p className="mt-0.5 max-w-[60ch] text-[13px] leading-snug text-fg-muted">
              A persona sets what the agent is there to do, how freely it
              speaks, and which tools it can reach for. Edit one, or write a new
              brief.
            </p>
          </div>
          <Link href="/app/personas" className="shrink-0">
            <Button variant="secondary">Manage personas</Button>
          </Link>
        </section>
      </PageBody>
    </>
  );
}
