"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Panel, PanelHead, cx } from "@/components/ui";
import { Check, Close, Alert } from "@/components/icons";

const AGENT =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  process.env.NEXT_PUBLIC_FEDERATO_AGENT_URL ??
  "http://localhost:8787";

type Factor = {
  factor: string;
  tier: string;
  value: string;
  rule: string;
  points: number;
};

type Ranked = {
  rank: number;
  accountName: string;
  policyNumber: string | null;
  policyId: number | null;
  decision: string;
  score: number;
  maxScore: number;
  premium: number | null;
  tiv: number | null;
  primaryState: string | null;
  explanation: string;
  factors: Factor[];
};

type RankPayload = {
  generatedAt: string;
  schemaResources: string[];
  queryTrace: string[];
  totalSubmissions: number;
  propertyPolicies: number;
  ranked: Ranked[];
  hops: { stage: string; ms: number; detail?: string }[];
};

type DeepDivePayload = {
  deepDive: {
    accountName: string;
    policyNumber: string;
    decision: string;
    explanation: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    hazardTags: string[];
    memoMarkdown: string;
    contradictionNotes: string[];
    factors: Factor[];
  };
  browse: {
    sessionId: string;
    liveViewUrl: string;
    status: string;
    steps: { label: string; ok: boolean; detail?: string }[];
    error?: string;
  } | null;
  hops: { stage: string; ms: number; detail?: string }[];
};

/** Underwriting verdicts map onto the console's existing state hues. */
const DECISION_COLOR: Record<string, string> = {
  quote: "var(--live)",
  refer: "var(--think)",
  investigate: "var(--act)",
};

function DecisionBadge({ d }: { d: string }) {
  return (
    <span className="chip capitalize" style={{ color: DECISION_COLOR[d] ?? "var(--alert)" }}>
      {d}
    </span>
  );
}

export function Underwrite() {
  const [rank, setRank] = useState<RankPayload | null>(null);
  const [dive, setDive] = useState<DeepDivePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(1001);
  const [meetUrl, setMeetUrl] = useState("");
  const [meetNotes, setMeetNotes] = useState<string[] | null>(null);

  const loadRank = useCallback(async (refresh = false) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `${AGENT}/api/federato/rank${refresh ? "?refresh=1" : ""}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setRank(body);
      if (body.ranked?.[0]?.policyId) {
        setSelected(body.ranked[0].policyId);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const runDeepDive = useCallback(async (policyId: number, browse: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      const q = browse ? "" : "?browse=0";
      const res = await fetch(`${AGENT}/api/federato/deep-dive/${policyId}${q}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setDive(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const openScreenshareSession = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`${AGENT}/api/federato/screenshare-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: selected ?? 1001 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setDive({ deepDive: body.deepDive, browse: body.browse, hops: [] });
      if (body.browse?.liveViewUrl) {
        window.open(body.browse.liveViewUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  const joinAndPresent = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setMeetNotes(null);
    try {
      const res = await fetch(`${AGENT}/api/federato/present-meet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: selected ?? 1001,
          meetUrl: meetUrl.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setDive({ deepDive: body.deepDive, browse: body.browse, hops: [] });
      if (Array.isArray(body.meet?.notes)) setMeetNotes(body.meet.notes);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selected, meetUrl]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("plus1.meetUrl");
      if (saved) setMeetUrl(saved);
    } catch {
      /* ignore */
    }
    void loadRank(false);
  }, [loadRank]);

  const hops = dive?.hops?.length ? dive.hops : rank?.hops;

  return (
    <div className="flex flex-col gap-5">
      {/* controls */}
      <section className="flex flex-col gap-3 rounded-[var(--r)] border border-border bg-bg-subtle p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void loadRank(false)} disabled={loading}>
            Rank
          </Button>
          <Button size="sm" onClick={() => void loadRank(true)} disabled={loading}>
            Refresh API
          </Button>
          <Button
            size="sm"
            onClick={() => void runDeepDive(selected ?? 1001, false)}
            disabled={loading}
          >
            Deep-dive
          </Button>
          <Button size="sm" onClick={() => void openScreenshareSession()} disabled={loading}>
            Browserbase live view
          </Button>
        </div>

        <p className="tnum text-[11.5px] text-fg-subtle xl:order-last xl:w-full xl:text-right">
          Schema → query plan → appetite score · agent {AGENT}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="url"
            value={meetUrl}
            onChange={(e) => {
              setMeetUrl(e.target.value);
              try {
                localStorage.setItem("plus1.meetUrl", e.target.value);
              } catch {
                /* ignore */
              }
            }}
            placeholder="https://meet.google.com/xxx-yyyy-zzz"
            spellCheck={false}
            className="h-8 w-full text-[13px] sm:w-[248px]"
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => void joinAndPresent()}
            disabled={loading}
          >
            Join Meet &amp; present
          </Button>
        </div>
      </section>

      {err && (
        <div
          role="alert"
          className="rounded-[var(--r)] border px-4 py-3"
          style={{
            borderColor: "color-mix(in srgb, var(--alert) 35%, transparent)",
            background: "color-mix(in srgb, var(--alert) 7%, transparent)",
          }}
        >
          <p
            className="flex items-start gap-2 text-[13px] font-medium"
            style={{ color: "var(--alert)" }}
          >
            <Alert width={14} height={14} className="mt-[2px] shrink-0" />
            {err}
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] text-fg-muted">
            Start the agent with{" "}
            <code className="tnum rounded bg-bg-raise px-1.5 py-0.5 text-fg">
              npm run backend
            </code>{" "}
            from the repo root.
          </p>
        </div>
      )}

      {meetNotes && meetNotes.length > 0 && (
        <div className="rounded-[var(--r)] border border-border bg-bg-subtle px-4 py-3">
          <p className="mb-1.5 text-[12.5px] font-medium text-fg-muted">Presented in Meet</p>
          <ul className="flex flex-col gap-1">
            {meetNotes.map((n) => (
              <li key={n} className="text-[12.5px] text-fg-muted">
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        {/* ranked queue */}
        <Panel as="section" className="flex flex-col overflow-hidden">
          <PanelHead
            title="Ranked property book"
            right={
              rank ? (
                <span className="tnum text-[12px] text-fg-subtle">
                  {rank.propertyPolicies} policies · {rank.totalSubmissions} submissions
                </span>
              ) : undefined
            }
          />
          <div className="max-h-[560px] overflow-y-auto">
            {!rank && !err && (
              <p className="px-4 py-10 text-center text-[13px] text-fg-subtle">
                {loading ? "Scoring the book…" : "No data yet — run Rank."}
              </p>
            )}
            {rank?.ranked.map((r) => {
              const isSel = selected === r.policyId;
              return (
                <button
                  key={`${r.policyId}-${r.rank}`}
                  type="button"
                  onClick={() => {
                    setSelected(r.policyId);
                    void runDeepDive(r.policyId ?? 1001, false);
                  }}
                  className={cx(
                    "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors duration-150 last:border-b-0",
                    isSel ? "bg-bg-raise" : "hover:bg-bg-raise/60",
                  )}
                >
                  <span className="tnum w-6 shrink-0 pt-0.5 text-[12px] text-fg-subtle">
                    {r.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-fg">
                        {r.accountName}
                      </span>
                      <DecisionBadge d={r.decision} />
                      <span className="tnum text-[12px] text-fg-subtle">
                        {r.score}/{r.maxScore}
                      </span>
                    </span>
                    <span className="tnum mt-1 block text-[12px] text-fg-muted">
                      {r.policyNumber} · {r.primaryState ?? "?"} · prem $
                      {r.premium?.toLocaleString() ?? "—"} · TIV{" "}
                      {r.tiv != null ? `$${(r.tiv / 1e6).toFixed(1)}M` : "—"}
                    </span>
                    <span className="mt-1.5 line-clamp-2 block text-[12.5px] leading-snug text-fg-muted">
                      {r.explanation}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        {/* reasoning + memo */}
        <section className="flex flex-col gap-5">
          <Panel className="overflow-hidden">
            <PanelHead title="Query plan" />
            <div className="p-4">
              <div className="flex flex-col gap-1.5">
                {hops?.length ? (
                  hops.map((h, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] font-medium" style={{ color: "var(--act)" }}>
                        {h.stage}
                      </span>
                      <span className="truncate text-[12px] text-fg-muted">{h.detail}</span>
                      <span className="tnum shrink-0 text-[11.5px] text-fg-subtle">
                        +{h.ms}ms
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[12.5px] text-fg-subtle">Run Rank to see the hops.</p>
                )}
              </div>

              {rank?.queryTrace && rank.queryTrace.length > 0 && (
                <ul className="mt-4 flex flex-col gap-1 border-t border-border pt-3">
                  {rank.queryTrace.map((t, i) => (
                    <li key={i} className="tnum text-[11.5px] text-fg-muted">
                      {t}
                    </li>
                  ))}
                </ul>
              )}

              {rank?.schemaResources && rank.schemaResources.length > 0 && (
                <p className="tnum mt-3 text-[11.5px] text-fg-subtle">
                  Schema: {rank.schemaResources.join(", ")}
                </p>
              )}
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHead title="Deep-dive memo" />
            <div className="max-h-[520px] overflow-y-auto p-4">
              {!dive && (
                <p className="text-[13px] text-fg-subtle">
                  Select a row, or deep-dive Harbor Point (policy 1001).
                </p>
              )}

              {dive && (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-fg">
                      {dive.deepDive.accountName}
                    </span>
                    <DecisionBadge d={dive.deepDive.decision} />
                  </div>

                  <p className="mb-3 text-[13px] leading-relaxed text-fg-muted">
                    {dive.deepDive.explanation}
                  </p>

                  <p className="tnum mb-3 text-[12px] text-fg-muted">
                    {dive.deepDive.address}, {dive.deepDive.city} {dive.deepDive.state}{" "}
                    {dive.deepDive.zip}
                    {dive.deepDive.hazardTags?.length
                      ? ` · hazards: ${dive.deepDive.hazardTags.join(", ")}`
                      : ""}
                  </p>

                  {dive.deepDive.contradictionNotes?.length > 0 && (
                    <ul className="mb-3 flex flex-col gap-1.5">
                      {dive.deepDive.contradictionNotes.map((n, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-[12.5px] leading-snug text-fg-muted"
                        >
                          <span className="dot mt-[7px]" style={{ color: "var(--alert)" }} />
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex flex-col gap-1">
                    {dive.deepDive.factors.map((f) => (
                      <div
                        key={f.factor}
                        className="flex justify-between gap-3 rounded-[var(--r-sm)] border border-border bg-bg px-2.5 py-1.5"
                      >
                        <span className="text-[12px] text-fg">{f.factor}</span>
                        <span className="tnum text-[12px] text-fg-muted">
                          {f.tier}: {f.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  {dive.browse && (
                    <div className="mt-4 rounded-[var(--r-sm)] border border-border p-3">
                      <p className="mb-1.5 text-[12.5px] font-medium text-fg-muted">Browserbase</p>
                      <p className="tnum text-[12px] text-fg-muted">
                        {dive.browse.status} · {dive.browse.sessionId}
                      </p>

                      {dive.browse.liveViewUrl && (
                        <a
                          className="mt-1.5 inline-block text-[12.5px] font-medium underline decoration-1 transition-opacity hover:opacity-80"
                          style={{ color: "var(--act)" }}
                          href={dive.browse.liveViewUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open fullscreen live view — present this in Meet
                        </a>
                      )}

                      {dive.browse.error && (
                        <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--alert)" }}>
                          {dive.browse.error}
                        </p>
                      )}

                      <ul className="mt-2 flex flex-col gap-1">
                        {dive.browse.steps?.map((s, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-[12px] text-fg-subtle"
                          >
                            {s.ok ? (
                              <Check
                                width={12}
                                height={12}
                                className="mt-[3px] shrink-0"
                                style={{ color: "var(--live)" }}
                              />
                            ) : (
                              <Close
                                width={12}
                                height={12}
                                className="mt-[3px] shrink-0"
                                style={{ color: "var(--alert)" }}
                              />
                            )}
                            <span>
                              {s.label}
                              {s.detail ? ` — ${s.detail}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <pre className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap rounded-[var(--r-sm)] border border-border bg-bg p-3 text-[11.5px] leading-relaxed text-fg-muted">
                    {dive.deepDive.memoMarkdown}
                  </pre>
                </>
              )}
            </div>
          </Panel>
        </section>
      </div>
    </div>
  );
}
