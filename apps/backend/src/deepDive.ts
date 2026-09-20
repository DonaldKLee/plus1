import {
  describeEnrichment,
  policyFromFederatoRecord,
  scorePolicyAppetite,
  type HazardEnrichment,
} from "@plus1/brain";
import type { DeepDiveResult, MindHop } from "@plus1/protocol";
import { enrichLocation } from "./enrichment.js";
import { loadCachedPolicies, runQuery } from "./federatoClient.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export async function deepDivePolicy(
  policyId = 1001,
  opts: { enrich?: boolean } = {},
): Promise<{ deepDive: DeepDiveResult; hops: MindHop[] }> {
  const hops: MindHop[] = [];
  const t0 = Date.now();

  let policy: Record<string, unknown> | null = null;
  const cached = loadCachedPolicies();
  if (cached) {
    policy =
      cached.map(asRecord).find((p) => p && Number(p.id) === policyId) ?? null;
  }

  if (!policy) {
    const page = await runQuery({
      resource: "Policy",
      where: { id: policyId },
      expand: {
        insured: true,
        claims: true,
        submission: true,
        producer: { broker: true },
        exposure_units: { location: { buildings: true } },
      },
      pagination: { limit: 1 },
    });
    policy = asRecord(page.results?.[0]) ?? null;
    hops.push({ stage: "QUERY", ms: Date.now() - t0, detail: `policy ${policyId}` });
  } else {
    hops.push({ stage: "QUERY", ms: Date.now() - t0, detail: "from cache" });
  }

  if (!policy) {
    throw new Error(`Policy ${policyId} not found`);
  }

  const input = policyFromFederatoRecord(policy);

  // Pick primary location for browse — prefer FL / flood-tagged Harbor Point style
  const locs = input.locations;
  const preferred =
    locs.find((l) => (l.hazardTags ?? []).includes("flood")) ||
    locs.find((l) => l.state === "FL") ||
    locs.sort((a, b) => b.tiv - a.tiv)[0];

  // Appetite rules alone, then with outside risk data for the primary location (optional).
  const base = scorePolicyAppetite(input);
  let enrichment: HazardEnrichment | null = null;
  if (opts.enrich && preferred) {
    const tE = Date.now();
    enrichment = await enrichLocation({
      zip: preferred.zip ?? null, county: preferred.county ?? null, state: preferred.state,
      latitude: preferred.latitude ?? null, longitude: preferred.longitude ?? null,
    });
    hops.push({ stage: "ENRICH", ms: Date.now() - t0, detail: `${enrichment.sources.length}/3 sources answered (${Date.now() - tE}ms)` });
  }
  const scored = enrichment ? scorePolicyAppetite(input, { enrichment }) : base;
  hops.push({ stage: "SCORE", ms: Date.now() - t0, detail: enrichment ? `${scored.decision} (rules alone: ${base.decision})` : scored.decision });

  const address = [
    preferred?.address,
    preferred?.city,
    preferred?.state,
    preferred?.zip,
  ]
    .filter(Boolean)
    .join(", ");

  const contradictionNotes: string[] = [];
  if (scored.factors.some((f) => f.factor === "total_premium" && f.tier === "not_acceptable")) {
    contradictionNotes.push(
      `Premium ${scored.factors.find((f) => f.factor === "total_premium")?.value} is outside $50–175K band.`,
    );
  }
  if (scored.factors.some((f) => f.factor === "multi_state_exposure")) {
    contradictionNotes.push(
      `Locations include out-of-appetite states: ${
        scored.factors.find((f) => f.factor === "multi_state_exposure")?.value
      }.`,
    );
  }
  if (scored.factors.some((f) => f.factor === "construction_type" && f.tier === "not_acceptable")) {
    contradictionNotes.push(
      "Majority TIV is Frame / Wood Frame — fails >50% JM/steel/non-combustible rule.",
    );
  }
  if (scored.factors.some((f) => f.factor === "loss_value" && f.tier === "not_acceptable")) {
    contradictionNotes.push(
      `Loss total ${scored.factors.find((f) => f.factor === "loss_value")?.value} exceeds $100k hard line.`,
    );
  }
  if (scored.factors.some((f) => f.factor === "submission_type" && f.tier === "not_acceptable")) {
    contradictionNotes.push("Renewal business is outside the 2025 appetite (new business only).");
  }
  if ((preferred?.hazardTags ?? []).includes("flood")) {
    contradictionNotes.push(
      enrichment?.nfipClaims != null
        ? `Broker file tags ${preferred?.address} with flood/hurricane; OpenFEMA shows ${enrichment.nfipClaims} NFIP claims in zip ${enrichment.zip} and ${enrichment.declarationsSince2015 ?? "?"} county declarations since 2015.`
        : `Broker file tags ${preferred?.address} with flood/hurricane — verify on FEMA NFHL live.`,
    );
  }
  if (enrichment && scored.decision !== base.decision) {
    contradictionNotes.push(
      `Appetite rules alone say ${base.decision.toUpperCase()}; outside risk data moves it to ${scored.decision.toUpperCase()}.`,
    );
  }

  const factorLines = scored.factors
    .map((f) => `- **${f.factor}** (${f.tier}): ${f.value} — _${f.rule}_`)
    .join("\n");

  const memoMarkdown = `# Underwriting memo — ${input.accountName}

**Decision:** ${scored.decision.toUpperCase()}  
**Score:** ${scored.score}/${scored.maxScore}  
**Policy:** ${policy.policy_number ?? policyId}

## Summary
${scored.explanation}

## Appetite factors
${factorLines}

## Deep-dive location
${address || "n/a"}  
Hazards: ${(preferred?.hazardTags ?? []).join(", ") || "none listed"}

## External risk data
${enrichment ? `${describeEnrichment(enrichment)}  \nSources: ${enrichment.sources.join(", ") || "none answered"}. Rules alone: **${base.decision.toUpperCase()}** (${base.score}/${base.maxScore}); with outside data: **${scored.decision.toUpperCase()}** (${scored.score}/${scored.maxScore}).` : "not pulled (enrich=1 to include OpenFEMA + Open-Meteo)"}

## Contradictions / subjectivities
${contradictionNotes.map((n) => `- ${n}`).join("\n") || "- none"}

## Next actions
- ${scored.decision === "decline" ? "Issue broker decline citing premium, construction, losses, multi-state." : "Refer with FEMA verification attached."}
- Confirm flood zone on FEMA NFHL for ${preferred?.address ?? "primary location"}.
`;

  hops.push({ stage: "MEMO", ms: Date.now() - t0, detail: "underwriting memo drafted" });

  const deepDive: DeepDiveResult = {
    policyId: Number(policy.id),
    policyNumber: String(policy.policy_number ?? policyId),
    accountName: input.accountName,
    address: preferred?.address ?? "",
    city: preferred?.city ?? "",
    state: preferred?.state ?? "",
    zip: preferred?.zip ?? "",
    latitude: preferred?.latitude ?? null,
    longitude: preferred?.longitude ?? null,
    hazardTags: preferred?.hazardTags ?? [],
    decision: scored.decision,
    explanation: scored.explanation,
    factors: scored.factors,
    memoMarkdown,
    contradictionNotes,
    ...(enrichment ? { enrichment, decisionWithoutEnrichment: base.decision } : {}),
  };

  return { deepDive, hops };
}
