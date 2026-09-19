"use client";

import { useCallback, useEffect, useState } from "react";

const AGENT =
  process.env.NEXT_PUBLIC_FEDERATO_AGENT_URL ?? "http://localhost:8787";

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

function DecisionBadge({ d }: { d: string }) {
  const color =
    d === "quote"
      ? "var(--color-live)"
      : d === "refer"
        ? "var(--color-warn, #e6b84d)"
        : d === "investigate"
          ? "var(--color-act)"
          : "var(--color-alert)";
  return (
    <span
      className="label !text-[9px] uppercase"
      style={{ color, borderColor: color }}
    >
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
      setDive({
        deepDive: body.deepDive,
        browse: body.browse,
        hops: [],
      });
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
      setDive({
        deepDive: body.deepDive,
        browse: body.browse,
        hops: [],
      });
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-panel px-3 py-2">
        <div>
          <div className="font-display text-[15px] font-700 tracking-tight text-ink">
            Federato · underwrite queue
          </div>
          <div className="data text-[10px] text-ink-2">
            Schema → query plan → appetite score · agent {AGENT}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-[3px] border border-line px-2.5 py-1 text-[11px] font-600 text-ink-2 hover:border-act hover:text-act"
            onClick={() => void loadRank(false)}
            disabled={loading}
          >
            Rank
          </button>
          <button
            type="button"
            className="rounded-[3px] border border-line px-2.5 py-1 text-[11px] font-600 text-ink-2 hover:border-act hover:text-act"
            onClick={() => void loadRank(true)}
            disabled={loading}
          >
            Refresh API
          </button>
          <button
            type="button"
            className="rounded-[3px] border border-line px-2.5 py-1 text-[11px] font-600 text-ink-2 hover:border-act hover:text-act"
            onClick={() => void runDeepDive(selected ?? 1001, false)}
            disabled={loading}
          >
            Deep-dive
          </button>
          <button
            type="button"
            className="rounded-[3px] border px-2.5 py-1 text-[11px] font-600"
            style={{
              borderColor: "var(--color-act)",
              color: "var(--color-act)",
            }}
            onClick={() => void openScreenshareSession()}
            disabled={loading}
          >
            Browserbase live view
          </button>
          <input
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
            className="w-[220px] rounded-[3px] border border-line bg-transparent px-2 py-1 text-[11px] text-ink outline-none placeholder:text-ink-2 focus:border-act"
          />
          <button
            type="button"
            className="rounded-[3px] border px-2.5 py-1 text-[11px] font-600"
            style={{
              borderColor: "var(--color-live)",
              color: "var(--color-live)",
            }}
            onClick={() => void joinAndPresent()}
            disabled={loading}
          >
            Join Meet & Present
          </button>
        </div>
      </header>

      {err && (
        <div
          className="rounded-[4px] border px-3 py-2 text-[12px]"
          style={{
            borderColor: "var(--color-alert)",
            color: "var(--color-alert)",
          }}
        >
          {err}
          <div className="mt-1 text-ink-2">
            Start the agent:{" "}
            <code className="data">npm run federato</code> from repo root
          </div>
        </div>
      )}

      {meetNotes && meetNotes.length > 0 && (
        <div className="rounded-[4px] border border-line bg-panel px-3 py-2 text-[11px] text-ink-2">
          {meetNotes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Queue */}
        <section className="flex min-h-0 flex-col rounded-[4px] border border-line bg-panel">
          <div className="border-b border-line px-3 py-2">
            <span className="label">Ranked property book</span>
            {rank && (
              <span className="data ml-2 text-[10px] text-ink-3">
                {rank.propertyPolicies} policies · {rank.totalSubmissions}{" "}
                submissions · {rank.generatedAt}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {!rank && !err && (
              <div className="p-4 text-[12px] text-ink-2">
                {loading ? "Scoring…" : "No data yet"}
              </div>
            )}
            {rank?.ranked.map((r) => (
              <button
                key={`${r.policyId}-${r.rank}`}
                type="button"
                onClick={() => {
                  setSelected(r.policyId);
                  void runDeepDive(r.policyId ?? 1001, false);
                }}
                className="flex w-full items-start gap-3 border-b border-line px-3 py-2.5 text-left transition hover:bg-panel-2"
                style={{
                  background:
                    selected === r.policyId
                      ? "color-mix(in srgb, var(--color-act) 6%, transparent)"
                      : undefined,
                }}
              >
                <span className="data w-6 shrink-0 text-[11px] text-ink-3">
                  #{r.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-600 text-ink">
                      {r.accountName}
                    </span>
                    <DecisionBadge d={r.decision} />
                    <span className="data text-[10px] text-ink-3">
                      {r.score}/{r.maxScore}
                    </span>
                  </div>
                  <div className="data mt-0.5 text-[10px] text-ink-2">
                    {r.policyNumber} · {r.primaryState ?? "?"} · prem $
                    {r.premium?.toLocaleString() ?? "—"} · TIV $
                    {r.tiv != null ? `${(r.tiv / 1e6).toFixed(1)}M` : "—"}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink-2">
                    {r.explanation}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Mind + memo */}
        <section className="flex min-h-0 flex-col gap-2.5">
          <div className="rounded-[4px] border border-line bg-panel p-3">
            <div className="label mb-2">Query plan / Mind</div>
            <div className="space-y-1.5">
              {(dive?.hops?.length ? dive.hops : rank?.hops)?.map((h, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2">
                  <span className="data text-[11px]" style={{ color: "var(--color-act)" }}>
                    {h.stage}
                  </span>
                  <span className="data truncate text-[10px] text-ink-2">
                    {h.detail}
                  </span>
                  <span className="data shrink-0 text-[10px] text-ink-3">
                    +{h.ms}ms
                  </span>
                </div>
              )) ?? (
                <div className="text-[11px] text-ink-3">Run Rank to see hops</div>
              )}
            </div>
            {rank?.queryTrace && (
              <ul className="mt-3 space-y-1 border-t border-line pt-2">
                {rank.queryTrace.map((t, i) => (
                  <li key={i} className="data text-[10px] text-ink-2">
                    {t}
                  </li>
                ))}
              </ul>
            )}
            {rank?.schemaResources && (
              <div className="data mt-2 text-[10px] text-ink-3">
                Schema: {rank.schemaResources.join(", ")}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-[4px] border border-line bg-panel p-3">
            <div className="label mb-2">Deep-dive / memo</div>
            {!dive && (
              <p className="text-[12px] text-ink-2">
                Select a row or deep-dive Harbor Point (policy 1001).
              </p>
            )}
            {dive && (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-600 text-ink">
                    {dive.deepDive.accountName}
                  </span>
                  <DecisionBadge d={dive.deepDive.decision} />
                </div>
                <p className="mb-3 text-[12px] leading-snug text-ink-2">
                  {dive.deepDive.explanation}
                </p>
                <div className="data mb-2 text-[10px] text-ink-2">
                  {dive.deepDive.address}, {dive.deepDive.city}{" "}
                  {dive.deepDive.state} {dive.deepDive.zip}
                  {dive.deepDive.hazardTags?.length
                    ? ` · hazards: ${dive.deepDive.hazardTags.join(", ")}`
                    : ""}
                </div>
                {dive.deepDive.contradictionNotes?.length > 0 && (
                  <ul className="mb-3 list-disc space-y-1 pl-4 text-[11px] text-ink-2">
                    {dive.deepDive.contradictionNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
                <div className="space-y-1">
                  {dive.deepDive.factors.map((f) => (
                    <div
                      key={f.factor}
                      className="flex justify-between gap-2 rounded-[3px] border border-line bg-panel-2 px-2 py-1"
                    >
                      <span className="data text-[10px] text-ink">
                        {f.factor}
                      </span>
                      <span className="data text-[10px] text-ink-2">
                        {f.tier}: {f.value}
                      </span>
                    </div>
                  ))}
                </div>
                {dive.browse && (
                  <div className="mt-3 rounded-[3px] border border-line p-2">
                    <div className="label mb-1">Browserbase</div>
                    <div className="data text-[10px] text-ink-2">
                      {dive.browse.status} · {dive.browse.sessionId}
                    </div>
                    {dive.browse.liveViewUrl && (
                      <a
                        className="data mt-1 inline-block text-[11px] underline"
                        style={{ color: "var(--color-act)" }}
                        href={dive.browse.liveViewUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open fullscreen live view (Present this in Meet)
                      </a>
                    )}
                    {dive.browse.error && (
                      <div className="mt-1 text-[11px]" style={{ color: "var(--color-alert)" }}>
                        {dive.browse.error}
                      </div>
                    )}
                    <ul className="mt-1 space-y-0.5">
                      {dive.browse.steps?.map((s, i) => (
                        <li key={i} className="data text-[10px] text-ink-3">
                          {s.ok ? "✓" : "✗"} {s.label}
                          {s.detail ? ` — ${s.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-[3px] border border-line bg-panel-2 p-2 text-[10px] leading-relaxed text-ink-2">
                  {dive.deepDive.memoMarkdown}
                </pre>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
