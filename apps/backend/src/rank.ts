import type { FederatoSchema } from "@plus1/brain";
import {
  explainQueryPlan,
  planAppetiteQueries,
  policyFromFederatoRecord,
  scorePolicyAppetite,
} from "@plus1/brain";
import type { MindHop, RankResponse, RankedSubmission } from "@plus1/protocol";
import {
  cacheSchemaAndPolicies,
  fetchSchema,
  loadCachedPolicies,
  loadCachedSchema,
  runQuery,
} from "./federatoClient.js";
import { enrichMany, enrichmentKey, primaryLocation } from "./enrichment.js";
import type { HazardEnrichment } from "@plus1/brain";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export async function rankQueue(opts?: {
  refresh?: boolean;
  /** Fold OpenFEMA / Open-Meteo risk data for each primary location into the score (cached per location). */
  enrich?: boolean;
  /** Return the raw expanded policy records too (for client-side portfolio aggregation). */
  withPolicies?: boolean;
}): Promise<RankResponse> {
  const hops: MindHop[] = [];
  const t0 = Date.now();
  const queryTrace: string[] = [];

  let schema = opts?.refresh ? null : loadCachedSchema();
  if (!schema) {
    schema = await fetchSchema();
    hops.push({ stage: "SCHEMA", ms: Date.now() - t0, detail: "fetched live schema" });
  } else {
    hops.push({ stage: "SCHEMA", ms: Date.now() - t0, detail: "loaded cache" });
  }

  const planned = planAppetiteQueries(schema as FederatoSchema);
  queryTrace.push(...explainQueryPlan(planned));
  hops.push({
    stage: "PLAN",
    ms: Date.now() - t0,
    detail: `${planned.length} queries planned`,
  });

  let policies = opts?.refresh ? null : loadCachedPolicies();
  if (!policies || policies.length === 0) {
    const cached = await cacheSchemaAndPolicies();
    policies = loadCachedPolicies() ?? [];
    hops.push({
      stage: "QUERY",
      ms: Date.now() - t0,
      detail: `expanded ${cached.policyCount} property policies`,
    });
  } else {
    hops.push({
      stage: "QUERY",
      ms: Date.now() - t0,
      detail: `cached ${policies.length} property policies`,
    });
  }

  // Optional: pull submissions for join metadata
  let submissions: unknown[] = [];
  try {
    const subPage = await runQuery({
      resource: "Submission",
      expand: { insured: true, broker: true },
      pagination: { limit: 200 },
    });
    submissions = subPage.results ?? [];
    queryTrace.push(
      `[submissions_page] fetched ${submissions.length} / total ${subPage.total ?? "?"}`,
    );
  } catch (e) {
    queryTrace.push(`[submissions_page] skipped: ${(e as Error).message}`);
  }

  // External enrichment: one lookup per distinct primary location, cached on disk.
  let enrichments: Map<string, HazardEnrichment> | null = null;
  const inputs = policies.map((raw) => { const p = asRecord(raw); return p ? { policy: p, input: policyFromFederatoRecord(p) } : null; }).filter((x): x is { policy: Record<string, unknown>; input: ReturnType<typeof policyFromFederatoRecord> } => !!x);
  if (opts?.enrich) {
    const tE = Date.now();
    const locs = inputs.map(({ input }) => primaryLocation(input.locations)).filter((l): l is NonNullable<typeof l> => !!l);
    enrichments = await enrichMany(locs.map((l) => ({ zip: l.zip ?? null, county: l.county ?? null, state: l.state, latitude: l.latitude ?? null, longitude: l.longitude ?? null })));
    hops.push({ stage: "ENRICH", ms: Date.now() - t0, detail: `${enrichments.size} locations via OpenFEMA + Open-Meteo (${Date.now() - tE}ms)` });
    queryTrace.push(`[enrichment] ${enrichments.size} primary locations enriched (FEMA declarations, NFIP claims, weather extremes)`);
  }

  hops.push({ stage: "SCORE", ms: Date.now() - t0, detail: opts?.enrich ? "appetite engine + external risk factors" : "appetite engine" });

  const ranked: RankedSubmission[] = [];
  for (const { policy, input } of inputs) {
    const prim = primaryLocation(input.locations);
    const enrichment = enrichments && prim ? enrichments.get(enrichmentKey({ zip: prim.zip ?? null, county: prim.county ?? null, state: prim.state, latitude: prim.latitude ?? null, longitude: prim.longitude ?? null })) ?? null : null;
    const result = scorePolicyAppetite(input, { enrichment });
    const submission =
      policy.submission && typeof policy.submission === "object"
        ? (policy.submission as Record<string, unknown>)
        : null;

    // Prefer matching submission by id from queue
    let submissionId = submission?.id != null ? Number(submission.id) : 0;
    let submissionNumber =
      submission?.submission_number != null
        ? String(submission.submission_number)
        : `SUB-policy-${policy.id}`;

    if (!submission && submissions.length) {
      const insuredId =
        policy.insured && typeof policy.insured === "object"
          ? Number((policy.insured as Record<string, unknown>).id)
          : null;
      const match = submissions.find((s) => {
        const r = asRecord(s);
        if (!r) return false;
        if (String(r.line_of_business) !== "property") return false;
        const ins = r.insured;
        const iid =
          typeof ins === "object" && ins
            ? Number((ins as Record<string, unknown>).id)
            : Number(ins);
        return insuredId != null && iid === insuredId;
      });
      if (match) {
        const m = match as Record<string, unknown>;
        submissionId = Number(m.id);
        submissionNumber = String(m.submission_number ?? submissionNumber);
      }
    }

    ranked.push({
      rank: 0,
      submissionId,
      submissionNumber,
      policyId: policy.id == null ? null : Number(policy.id),
      policyNumber: policy.policy_number == null ? null : String(policy.policy_number),
      accountName: input.accountName,
      lineOfBusiness: input.lineOfBusiness ?? "unknown",
      businessType: input.businessType,
      primaryState: result.primaryState,
      premium: input.premium,
      tiv: result.tiv || null,
      score: result.score,
      maxScore: result.maxScore,
      decision: result.decision,
      explanation: result.explanation,
      factors: result.factors,
      queryTrace: queryTrace.slice(0, 3),
    });
  }

  // Sort: quote first, then refer, then by score desc; decline last
  const decisionOrder = { quote: 0, refer: 1, investigate: 2, decline: 3 } as const;
  ranked.sort((a, b) => {
    const d = decisionOrder[a.decision] - decisionOrder[b.decision];
    if (d !== 0) return d;
    return b.score - a.score;
  });
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });

  hops.push({
    stage: "RANK",
    ms: Date.now() - t0,
    detail: `top=${ranked[0]?.accountName ?? "none"} (${ranked[0]?.decision ?? "-"})`,
  });

  return {
    generatedAt: new Date().toISOString(),
    schemaResources: Object.keys(schema),
    queryTrace,
    totalSubmissions: submissions.length,
    propertyPolicies: policies.length,
    ranked,
    hops,
    enriched: Boolean(opts?.enrich),
    ...(opts?.withPolicies ? { policies } : {}),
  };
}
