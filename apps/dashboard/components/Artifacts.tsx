"use client";

import { useState } from "react";
import type { Artifact } from "@/lib/types";
import { ARTIFACT_META, SEVERITY_COLOR } from "@/lib/maps";
import { ArtifactIcon, External } from "./icons";

function VerdictChip({ v }: { v: NonNullable<Artifact["verdict"]> }) {
  const map = {
    ship: { c: "var(--color-live)", t: "SHIP" },
    revise: { c: "var(--color-gate)", t: "REVISE" },
    reject: { c: "var(--color-alert)", t: "REJECT" },
  }[v];
  return (
    <span className="chip !py-0 !px-1.5 text-[9px]" style={{ color: map.c }}>
      {map.t}
    </span>
  );
}

function ArtifactCard({ a }: { a: Artifact }) {
  const [open, setOpen] = useState(false);
  const meta = ARTIFACT_META[a.kind];
  const expandable = Boolean(a.preview || a.issues);

  return (
    <div className="enter-x panel reticle overflow-hidden">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px]"
          style={{
            color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${meta.color} 28%, transparent)`,
          }}
        >
          <ArtifactIcon kind={a.kind} width={16} height={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="label !text-[9px]" style={{ color: meta.color }}>
              {meta.label}
            </span>
            {a.verdict && <VerdictChip v={a.verdict} />}
          </div>
          <p className="truncate text-[12.5px] font-600 text-ink">{a.title}</p>
          <p className="truncate text-[11px] text-ink-2">{a.subtitle}</p>
        </div>
      </div>

      {open && a.preview && (
        <pre className="mx-3 mb-2 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-[3px] border border-line bg-panel-2 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-2">
          {a.preview}
        </pre>
      )}

      {open && a.issues && (
        <div className="mx-3 mb-2 space-y-2.5">
          {a.strengths && a.strengths.length > 0 && (
            <div>
              <p className="label mb-1" style={{ color: "var(--color-live)" }}>STRENGTHS</p>
              <ul className="space-y-1">
                {a.strengths.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-[11.5px] text-ink-2">
                    <span style={{ color: "var(--color-live)" }}>+</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="label mb-1" style={{ color: "var(--color-gate)" }}>ISSUES · {a.issues.length}</p>
            <div className="space-y-1.5">
              {a.issues.map((iss, i) => (
                <div key={i} className="rounded-[3px] border border-line bg-panel-2 p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="led" style={{ color: SEVERITY_COLOR[iss.severity] }} />
                    <span className="label !text-[9px]" style={{ color: SEVERITY_COLOR[iss.severity] }}>
                      {iss.severity}
                    </span>
                    <span className="data text-[10px] text-ink-3">{iss.location}</span>
                  </div>
                  <p className="data mb-1 text-[11px] text-ink">{iss.quote}</p>
                  <p className="text-[11.5px] leading-snug text-ink-2">{iss.suggestion}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line px-3 py-1.5">
        <span className="data text-[10px] text-ink-3">{a.meta}</span>
        <div className="flex items-center gap-3">
          {expandable && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="data text-[10px] text-ink-2 hover:text-ink"
            >
              {open ? "collapse" : "expand"}
            </button>
          )}
          <a
            href={a.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[10px] font-600 text-act hover:underline"
          >
            open <External width={12} height={12} />
          </a>
        </div>
      </div>
    </div>
  );
}

export function Artifacts({
  artifacts,
}: {
  artifacts: { artifact: Artifact; id: string }[];
}) {
  return (
    <section className="panel reticle flex min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="label" style={{ color: "var(--color-ink-2)" }}>
          ARTIFACTS
        </span>
        <span className="data text-[10px] text-ink-3">{artifacts.length} created</span>
      </header>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {artifacts.length === 0 && (
          <p className="data mt-6 text-center text-[11px] text-ink-3">
            nothing built yet
          </p>
        )}
        {artifacts.map(({ artifact, id }) => (
          <ArtifactCard key={id} a={artifact} />
        ))}
      </div>
    </section>
  );
}
