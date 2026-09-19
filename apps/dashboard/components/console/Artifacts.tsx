"use client";

import { useState } from "react";
import type { Artifact } from "@/lib/types";
import { ARTIFACT_META, SEVERITY_COLOR } from "@/lib/maps";
import { ArtifactIcon, External } from "@/components/icons";
import { Panel, PanelHead, cx } from "@/components/ui";

const VERDICT: Record<NonNullable<Artifact["verdict"]>, { color: string; label: string }> = {
  ship: { color: "var(--live)", label: "Ship" },
  revise: { color: "var(--think)", label: "Revise" },
  reject: { color: "var(--alert)", label: "Reject" },
};

function ArtifactCard({ a }: { a: Artifact }) {
  const [open, setOpen] = useState(false);
  const meta = ARTIFACT_META[a.kind];
  const expandable = Boolean(a.preview || a.issues);

  return (
    <article className="rise-in overflow-hidden rounded-[var(--r-sm)] border border-border bg-bg">
      <div className="flex items-start gap-3 p-3">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] border border-border"
          style={{ color: meta.color }}
        >
          <ArtifactIcon kind={a.kind} width={16} height={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] font-medium" style={{ color: meta.color }}>
              {meta.label}
            </span>
            {a.verdict && (
              <span className="chip" style={{ color: VERDICT[a.verdict].color }}>
                {VERDICT[a.verdict].label}
              </span>
            )}
          </div>
          <p className="truncate text-[13px] font-medium text-fg">{a.title}</p>
          <p className="truncate text-[12.5px] text-fg-muted">{a.subtitle}</p>
        </div>
      </div>

      {open && a.preview && (
        <pre className="mx-3 mb-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-[var(--r-sm)] border border-border bg-bg-subtle px-3 py-2.5 text-[12px] leading-relaxed text-fg-muted">
          {a.preview}
        </pre>
      )}

      {open && a.issues && (
        <div className="mx-3 mb-3 flex flex-col gap-3">
          {a.strengths && a.strengths.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5" style={{ color: "var(--live)" }}>
                Strengths
              </p>
              <ul className="flex flex-col gap-1">
                {a.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-fg-muted">
                    <span className="dot mt-[7px]" style={{ color: "var(--live)" }} />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="eyebrow mb-1.5">Issues · {a.issues.length}</p>
            <div className="flex flex-col gap-1.5">
              {a.issues.map((iss, i) => (
                <div key={i} className="rounded-[var(--r-sm)] border border-border bg-bg-subtle p-2.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="dot" style={{ color: SEVERITY_COLOR[iss.severity] }} />
                    <span
                      className="text-[11.5px] font-medium capitalize"
                      style={{ color: SEVERITY_COLOR[iss.severity] }}
                    >
                      {iss.severity}
                    </span>
                    <span className="tnum truncate text-[11.5px] text-fg-subtle">
                      {iss.location}
                    </span>
                  </div>
                  <p className="mb-1 text-[12px] leading-snug text-fg">&ldquo;{iss.quote}&rdquo;</p>
                  <p className="text-[12.5px] leading-snug text-fg-muted">{iss.suggestion}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        <span className="tnum truncate text-[11.5px] text-fg-subtle">{a.meta}</span>
        <div className="flex shrink-0 items-center gap-3">
          {expandable && (
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="text-[12px] font-medium text-fg-muted transition-colors hover:text-fg"
            >
              {open ? "Collapse" : "Expand"}
            </button>
          )}
          <a
            href={a.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{ color: "var(--act)" }}
          >
            Open
            <External width={12} height={12} />
          </a>
        </div>
      </div>
    </article>
  );
}

export function Artifacts({
  artifacts,
}: {
  artifacts: { artifact: Artifact; id: string }[];
}) {
  return (
    <Panel as="section" className={cx("flex min-h-0 flex-col overflow-hidden")}>
      <PanelHead
        title="Artifacts"
        right={
          <span className="tnum text-[12px] text-fg-subtle">{artifacts.length} created</span>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {artifacts.length === 0 && (
          <p className="px-2 py-10 text-center text-[13px] leading-relaxed text-fg-subtle">
            Nothing built yet.
            <br />
            Work appears here as the goose finishes it.
          </p>
        )}
        {artifacts.map(({ artifact, id }) => (
          <ArtifactCard key={id} a={artifact} />
        ))}
      </div>
    </Panel>
  );
}
