/**
 * Submission intake: turn an OPEN submission (received / cleared / quoted) plus what we already
 * know about the insured into something the appetite engine can score, and say exactly what is
 * still missing. Pure. The backend fetches the records.
 *
 * A submission carries: line of business, requested limit, broker, target effective date. It
 * does NOT carry exposure. Exposure (locations, buildings, five-year losses) comes from the
 * insured's policies already on file — which is how a real underwriter reads a renewal or a
 * returning account.
 */
import type { FactorScore } from "@plus1/protocol";
import type { LocationInput, PolicyScoreInput } from "./appetite.js";
import { lossTotalFromClaims, policyFromFederatoRecord } from "./mapRecord.js";

export interface SubmissionRecord {
  id: number;
  submission_number?: string | null;
  status?: string | null;
  line_of_business?: string | null;
  requested_limit?: number | null;
  received_date?: string | null;
  target_effective_date?: string | null;
  insured?: { id?: number; name?: string | null; dba?: string | null } | number | null;
  broker?: { id?: number; name?: string | null; tier?: string | null } | number | null;
}

export interface IntakeBasis {
  /** Policies on file for this insured (any line). */
  priorPolicies: number;
  /** Prior policies in the SAME line of business (drives new vs renewal). */
  priorSameLine: number;
  /** Distinct locations recovered from those policies. */
  locations: number;
  /** Claims recovered from those policies. */
  claims: number;
  /** Where the exposure came from, in words. */
  note: string;
}

export interface IntakeInput {
  input: PolicyScoreInput;
  basis: IntakeBasis;
  businessType: "new" | "renewal";
}

const insuredIdOf = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "object") { const id = (v as { id?: unknown }).id; return id == null ? null : Number(id); }
  return Number(v);
};

/**
 * Build the score input for a submission from the insured's history.
 * `insuredPolicies` = every expanded Policy record whose insured is this submission's insured.
 */
export function submissionIntakeInput(sub: SubmissionRecord, insuredPolicies: Record<string, unknown>[]): IntakeInput {
  const insured = typeof sub.insured === "object" && sub.insured ? sub.insured : null;
  const accountName = insured?.name || insured?.dba || `submission ${sub.submission_number ?? sub.id}`;
  const lob = (sub.line_of_business ?? "").toLowerCase() || null;

  // Most recent policies first, so the schedule reflects the latest known exposure.
  const sorted = [...insuredPolicies].sort((a, b) => String((b.dates as { effective?: string })?.effective ?? "").localeCompare(String((a.dates as { effective?: string })?.effective ?? "")));
  const sameLine = sorted.filter((p) => String(p.line_of_business ?? "").toLowerCase() === lob);

  // Locations: dedupe by location id across all prior policies (same insured, same buildings).
  const seen = new Set<string>();
  const locations: LocationInput[] = [];
  let claims = 0;
  let lossTotal = 0;
  // Five-year loss history (the guidelines' window), from the same line where it exists —
  // health or auto claims say nothing about a property risk.
  const lossBasis = sameLine.length ? sameLine : sorted;
  const cutoff = new Date(Date.now() - 5 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const recentClaims = (p: Record<string, unknown>) =>
    Array.isArray(p.claims) ? (p.claims as Record<string, unknown>[]).filter((c) => c && typeof c === "object" && (typeof c.date_of_loss !== "string" || c.date_of_loss >= cutoff)) : [];
  for (const p of lossBasis) {
    const cl = recentClaims(p);
    claims += cl.length;
    lossTotal += lossTotalFromClaims(cl);
  }
  for (const p of sorted) {
    const mapped = policyFromFederatoRecord(p);
    const eus = Array.isArray(p.exposure_units) ? (p.exposure_units as Record<string, unknown>[]) : [];
    mapped.locations.forEach((loc, i) => {
      const eu = eus[i];
      const locId = eu && typeof eu.location === "object" && eu.location ? String((eu.location as { id?: unknown }).id ?? `${loc.address}|${loc.zip}`) : `${loc.address}|${loc.zip}`;
      if (seen.has(locId)) return;
      seen.add(locId);
      locations.push(loc);
    });
  }

  const businessType: "new" | "renewal" = sameLine.length > 0 ? "renewal" : "new";
  const basis: IntakeBasis = {
    priorPolicies: sorted.length,
    priorSameLine: sameLine.length,
    locations: locations.length,
    claims,
    note:
      sorted.length === 0
        ? "no prior policies on file; exposure unknown until the broker sends the schedule"
        : `${locations.length} location${locations.length === 1 ? "" : "s"} from ${sorted.length} prior polic${sorted.length === 1 ? "y" : "ies"}; ${claims} claim${claims === 1 ? "" : "s"} in the last 5 years${sameLine.length ? ` on ${sameLine.length} ${lob} polic${sameLine.length === 1 ? "y" : "ies"}` : " (no same-line history; all lines counted)"}`,
  };

  return {
    input: {
      accountName,
      lineOfBusiness: lob,
      businessType,
      // A submission has no premium yet; the factor scores "missing" and goes on the request list.
      premium: null,
      locations,
      lossTotal: sorted.length ? lossTotal : null,
    },
    basis,
    businessType,
  };
}

/** What to ask the broker for, from the factors that came back "missing" and the intake basis. */
export function intakeRequests(factors: FactorScore[], basis: IntakeBasis): string[] {
  const out: string[] = [];
  const missing = new Set(factors.filter((f) => f.tier === "missing").map((f) => f.factor));
  if (missing.has("total_premium")) out.push("premium indication / target premium");
  if (missing.has("tiv") || basis.locations === 0) out.push("statement of values (locations, TIV)");
  if (missing.has("building_age") || missing.has("construction_type")) out.push("construction type and year built per building");
  if (missing.has("loss_value") || basis.claims === 0) out.push("five-year currently valued loss runs");
  if (missing.has("primary_risk_state")) out.push("primary risk location and state");
  if (missing.has("fema_declarations") || missing.has("nfip_flood_claims")) out.push("(external risk lookup failed; retry enrichment)");
  return out;
}
