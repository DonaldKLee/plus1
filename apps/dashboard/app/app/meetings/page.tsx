"use client";

import { useMemo, useState } from "react";
import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { MeetingsTable } from "@/components/dash/MeetingsTable";
import { Empty, Input } from "@/components/ui";
import { Search } from "@/components/icons";
import { MEETINGS } from "@/lib/meetings";
import { PERSONAS, personaById } from "@/lib/personas";

export default function MeetingsPage() {
  const [q, setQ] = useState("");
  const [persona, setPersona] = useState<string | null>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return MEETINGS.filter((m) => {
      if (persona && m.personaId !== persona) return false;
      if (!needle) return true;
      return (
        m.title.toLowerCase().includes(needle) ||
        personaById(m.personaId).name.toLowerCase().includes(needle) ||
        m.participants.some((p) => p.name.toLowerCase().includes(needle))
      );
    });
  }, [q, persona]);

  return (
    <>
      <PageHeader
        title="Meetings"
        description="Every room the goose has sat in. Open one to replay the transcript with its gate decisions, the reasoning behind each one, and the artifacts it produced."
      />

      <PageBody>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              width={15}
              height={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search meetings, people, personas"
              className="pl-9"
              type="search"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setPersona(null)}
              className={`h-8 rounded-[var(--r-sm)] border px-2.5 text-[12.5px] font-medium transition-colors duration-150 ${
                persona === null
                  ? "border-border-strong bg-bg-raise text-fg"
                  : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
              }`}
            >
              All
            </button>
            {PERSONAS.filter((p) => MEETINGS.some((m) => m.personaId === p.id)).map((p) => (
              <button
                key={p.id}
                onClick={() => setPersona(persona === p.id ? null : p.id)}
                className={`h-8 rounded-[var(--r-sm)] border px-2.5 text-[12.5px] font-medium transition-colors duration-150 ${
                  persona === p.id
                    ? "border-border-strong bg-bg-raise text-fg"
                    : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          {results.length > 0 ? (
            <MeetingsTable meetings={results} />
          ) : (
            <div className="rounded-[var(--r)] border border-border">
              <Empty
                title="No meetings match that"
                body="Try a different name, or clear the persona filter to see everything the goose has attended."
              />
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}
