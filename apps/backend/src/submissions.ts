/**
 * The intake pipeline for OPEN submissions, in the order the challenge states it:
 *
 *   INGEST   pull open submissions (received / cleared / quoted) with insured + broker, and every
 *            policy on file for those insureds (locations, buildings, five-year claims)
 *   ENRICH   real-world risk data for each primary location (see enrichment.ts: FEMA flood zone,
 *            FEMA declarations, NFIP claims, USGS earthquakes, FEMA National Risk Index, weather
 *            extremes, reverse-geocode consistency)
 *   CLASSIFY the 2025 appetite table + enrichment factors → quote / refer / investigate / decline,
 *            with the rule behind every factor and the list of what to request from the broker
 *
 * Scoring is pure (packages/brain); this file only fetches and assembles.
 */
import { intakeRequests, scorePolicyAppetite, submissionIntakeInput, type HazardEnrichment, type SubmissionRecord } from "@plus1/brain";
import type { MindHop, SubmissionIntake, SubmissionIntakeResponse } from "@plus1/protocol";
import { enrichMany, enrichmentKey, primaryLocation } from "./enrichment.js";
import { runQuery } from "./federatoClient.js";

const OPEN_STATUSES = ["received", "cleared", "quoted"];
const ALL_POLICIES_TTL_MS = 10 * 60 * 1000;

/** Every policy, expanded for exposure and losses: the join table for intake. In memory, refreshed after a TTL. */
let allPolicies: { at: number; results: Record<string, unknown>[] } | null = null;
async function allPoliciesExpanded(): Promise<Record<string, unknown>[]> {
  if (allPolicies && Date.now() - allPolicies.at < ALL_POLICIES_TTL_MS) return allPolicies.results;
  const results: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const page = await runQuery({
      resource: "Policy",
      expand: { insured: true, claims: true, producer: { broker: true }, exposure_units: { location: { buildings: true } } },
      pagination: { limit: 50, offset },
    });
    const batch = (page.results ?? []) as Record<string, unknown>[];
    results.push(...batch);
    if (batch.length < 50) break;
  }
  allPolicies = { at: Date.now(), results };
  return results;
}

const insuredIdOf = (v: unknown): number | null =>
  v == null ? null : typeof v === "object" ? (((v as { id?: unknown }).id ?? null) as number | null) : Number(v);

export type OpenSubmission = SubmissionRecord & Record<string, unknown>;

/** INGEST: open submissions (insured + broker + contact expanded) and every policy on file, keyed by insured. */
export async function ingestOpenSubmissions(statuses: string[] = OPEN_STATUSES): Promise<{
  subs: OpenSubmission[];
  policies: Record<string, unknown>[];
  byInsured: Map<number, Record<string, unknown>[]>;
}> {
  const subsPage = await runQuery({
    resource: "Submission",
    where: { status: { $in: statuses } },
    expand: { insured: true, broker: true, contact: true, underwriter: true },
    sort: [{ field: "received_date", direction: "desc" }],
    pagination: { limit: 200 },
  });
  const subs = (subsPage.results ?? []) as OpenSubmission[];
  const policies = await allPoliciesExpanded();
  const byInsured = new Map<number, Record<string, unknown>[]>();
  for (const p of policies) {
    const id = insuredIdOf(p.insured);
    if (id == null) continue;
    byInsured.set(id, [...(byInsured.get(id) ?? []), p]);
  }
  return { subs, policies, byInsured };
}

/** Find one open submission by number ("SUB-2025-00134"), id, or insured name fragment. */
export function findOpenSubmission(subs: OpenSubmission[], ref: string): OpenSubmission | undefined {
  const q = ref.trim().toLowerCase();
  const num = q.match(/sub-?\d{4}-?\d+/i)?.[0].replace(/^sub-?/i, "").replace("-", "");
  return (
    subs.find((s) => String(s.submission_number ?? "").toLowerCase() === q) ??
    (num ? subs.find((s) => String(s.submission_number ?? "").replace(/^sub-?/i, "").replace("-", "").toLowerCase() === num.toLowerCase()) : undefined) ??
    subs.find((s) => String(s.id) === q) ??
    subs.find((s) => { const n = typeof s.insured === "object" && s.insured ? String(s.insured.name ?? "").toLowerCase() : ""; return n && (n.includes(q) || q.includes(n.split(" ")[0]!)); })
  );
}

export const insuredIdOfRecord = insuredIdOf;

export async function rankOpenSubmissions(opts: { enrich?: boolean; statuses?: string[] } = {}): Promise<SubmissionIntakeResponse> {
  const t0 = Date.now();
  const hops: MindHop[] = [];
  const statuses = opts.statuses ?? OPEN_STATUSES;

  // ── INGEST ──
  const { subs, policies, byInsured } = await ingestOpenSubmissions(statuses);
  hops.push({ stage: "INGEST", ms: Date.now() - t0, detail: `${subs.length} open submissions (${statuses.join("/")}); ${policies.length} policies on file joined by insured` });

  const prepared = subs.map((sub) => {
    const insuredId = insuredIdOf(sub.insured);
    const history = insuredId == null ? [] : byInsured.get(insuredId) ?? [];
    return { sub, intake: submissionIntakeInput(sub, history) };
  });

  // ── ENRICH ──
  let enrichments: Map<string, HazardEnrichment> | null = null;
  if (opts.enrich) {
    const tE = Date.now();
    const locs = prepared.map(({ intake }) => primaryLocation(intake.input.locations)).filter((l): l is NonNullable<typeof l> => !!l);
    enrichments = await enrichMany(locs.map((l) => ({ zip: l.zip ?? null, county: l.county ?? null, state: l.state, latitude: l.latitude ?? null, longitude: l.longitude ?? null })));
    const sources = new Set<string>();
    for (const e of enrichments.values()) for (const s of e.sources) sources.add(s.split(":")[0]!);
    hops.push({ stage: "ENRICH", ms: Date.now() - t0, detail: `${enrichments.size} primary locations via ${[...sources].join(", ") || "no sources"} (${Date.now() - tE}ms)` });
  }

  // ── CLASSIFY ──
  const ranked: SubmissionIntake[] = prepared.map(({ sub, intake }) => {
    const tC = Date.now();
    const prim = primaryLocation(intake.input.locations);
    const enrichment = enrichments && prim ? enrichments.get(enrichmentKey({ zip: prim.zip ?? null, county: prim.county ?? null, state: prim.state, latitude: prim.latitude ?? null, longitude: prim.longitude ?? null })) ?? null : null;
    const scored = scorePolicyAppetite(intake.input, { enrichment });
    const broker = typeof sub.broker === "object" && sub.broker ? sub.broker : null;
    const subHops: MindHop[] = [
      { stage: "INGEST", ms: 0, detail: intake.basis.note },
      ...(enrichment ? [{ stage: "ENRICH", ms: 0, detail: `${enrichment.sources.length} sources: ${enrichment.sources.join(", ")}` }] : []),
      { stage: "CLASSIFY", ms: Date.now() - tC, detail: `${scored.decision} ${scored.score}/${scored.maxScore}` },
    ];
    return {
      rank: 0,
      submissionId: Number(sub.id),
      submissionNumber: String(sub.submission_number ?? sub.id),
      status: String(sub.status ?? "unknown"),
      receivedDate: (sub.received_date as string | null) ?? null,
      targetEffectiveDate: (sub.target_effective_date as string | null) ?? null,
      requestedLimit: sub.requested_limit == null ? null : Number(sub.requested_limit),
      accountName: intake.input.accountName,
      broker: broker?.name ?? null,
      brokerTier: broker?.tier ?? null,
      lineOfBusiness: intake.input.lineOfBusiness ?? "unknown",
      businessType: intake.businessType,
      basis: intake.basis,
      primaryState: scored.primaryState,
      tiv: scored.tiv || null,
      score: scored.score,
      maxScore: scored.maxScore,
      decision: scored.decision,
      explanation: scored.explanation,
      factors: scored.factors,
      requests: intakeRequests(scored.factors, intake.basis),
      ...(enrichment ? { enrichment } : {}),
      hops: subHops,
    };
  });

  const order = { quote: 0, refer: 1, investigate: 2, decline: 3 } as const;
  ranked.sort((a, b) => order[a.decision] - order[b.decision] || b.score - a.score);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  hops.push({ stage: "CLASSIFY", ms: Date.now() - t0, detail: `${ranked.filter((r) => r.decision === "quote").length} quote, ${ranked.filter((r) => r.decision === "refer").length} refer, ${ranked.filter((r) => r.decision === "investigate").length} investigate, ${ranked.filter((r) => r.decision === "decline").length} decline` });

  return { generatedAt: new Date().toISOString(), openSubmissions: subs.length, enriched: Boolean(opts.enrich), ranked, hops };
}
