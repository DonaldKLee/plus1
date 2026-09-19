import Link from "next/link";
import { cx } from "@/components/ui";
import { Arrow } from "@/components/icons";
import { ACCENT_VAR, personaById } from "@/lib/personas";
import { fmtDay, fmtDuration, type MeetingRecord } from "@/lib/meetings";

function Avatars({ people }: { people: MeetingRecord["participants"] }) {
  const shown = people.slice(0, 3);
  const rest = people.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <span
          key={p.name}
          title={p.name}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-bg bg-bg-raise text-[10px] font-semibold text-fg-muted"
          style={{ marginLeft: i === 0 ? 0 : -6 }}
        >
          {p.initials}
        </span>
      ))}
      {rest > 0 && (
        <span className="ml-1.5 text-[12px] text-fg-subtle">+{rest}</span>
      )}
    </div>
  );
}

function Row({ m }: { m: MeetingRecord }) {
  const persona = personaById(m.personaId);
  const accent = ACCENT_VAR[persona.accent];
  const live = m.status === "live";

  return (
    <Link
      href={`/app/meetings/${m.id}`}
      className="group grid grid-cols-1 items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3.5 transition-colors duration-150 last:border-b-0 hover:bg-bg-subtle xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_auto]"
    >
      {/* title */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cx("dot", live && "dot-pulse")} style={{ color: live ? "var(--live)" : accent }} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-fg">{m.title}</p>
          <p className="truncate text-[12.5px] text-fg-subtle">
            {persona.name}
            {live && <span style={{ color: "var(--live)" }}> · live now</span>}
          </p>
        </div>
      </div>

      {/* participants */}
      <div className="hidden xl:block">
        <Avatars people={m.participants} />
      </div>

      {/* gate counts — the product's own proof */}
      <div className="hidden items-center gap-3 xl:flex">
        <span className="tnum text-[12.5px]" style={{ color: "var(--act)" }}>
          {m.counts.acted} acted
        </span>
        <span className="tnum text-[12.5px] text-fg-subtle">{m.counts.ignored} ignored</span>
        {m.counts.honks > 0 && (
          <span className="tnum text-[12.5px]" style={{ color: "var(--alert)" }}>
            {m.counts.honks} honk{m.counts.honks > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* artifacts */}
      <div className="hidden xl:block">
        <span className="tnum text-[12.5px] text-fg-muted">
          {m.artifacts.length || "—"}
          {m.artifacts.length > 0 && (
            <span className="ml-1 font-sans text-fg-subtle">
              artifact{m.artifacts.length > 1 ? "s" : ""}
            </span>
          )}
        </span>
      </div>

      {/* when — on mobile this row also carries the gate counts */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[15px] xl:pl-0">
        <span className="tnum text-[12.5px] xl:hidden" style={{ color: "var(--act)" }}>
          {m.counts.acted} acted
        </span>
        <span className="tnum text-[12.5px] text-fg-subtle xl:hidden">
          {m.counts.ignored} ignored
        </span>
        <span className="tnum whitespace-nowrap text-[12.5px] text-fg-muted">
          {fmtDay(m.date)}
          <span className="ml-1.5 text-fg-subtle">{fmtDuration(m.durationMs)}</span>
        </span>
      </div>

      <Arrow
        width={15}
        height={15}
        className="hidden shrink-0 text-fg-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100 xl:block"
      />
    </Link>
  );
}

export function MeetingsTable({
  meetings,
  caption,
}: {
  meetings: MeetingRecord[];
  caption?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--r)] border border-border">
      <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_auto] gap-x-4 border-b border-border bg-bg-subtle px-4 py-2.5 xl:grid">
        <span className="eyebrow">{caption ?? "Meeting"}</span>
        <span className="eyebrow">Room</span>
        <span className="eyebrow">Gate</span>
        <span className="eyebrow">Output</span>
        <span className="eyebrow">When</span>
        <span className="w-[15px]" />
      </div>
      {meetings.map((m) => (
        <Row key={m.id} m={m} />
      ))}
    </div>
  );
}
