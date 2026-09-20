/**
 * Drafting: the underwriter's actual outputs, filled from Federato data + the appetite result.
 *
 *   quote         quote letter / indication to the broker (terms, coverage schedule, forms, subjectivities)
 *   declarations  policy declarations page with schedules of locations and endorsements
 *   decline       broker decline letter citing the 2025 appetite rules the file fails
 *   memo          the internal underwriting memo (deep dive, with external risk data)
 *
 * Every document is a DRAFT for underwriter review, never a binding contract, and the agent never
 * sends or binds anything. Commercial terms and schedules are templated from the record; we do not
 * invent coverage wording. Federato's API is read-only, so drafts are saved locally and returned.
 */
import fs from "node:fs";
import path from "node:path";
import { describeEnrichment, policyFromFederatoRecord, scorePolicyAppetite, type HazardEnrichment } from "@plus1/brain";
import type { FactorScore } from "@plus1/protocol";
import { deepDivePolicy } from "./deepDive.js";
import { enrichLocation, primaryLocation } from "./enrichment.js";
import { OUTPUT_DIR, ensureDir } from "./env.js";
import { runQuery } from "./federatoClient.js";

export type DraftKind = "quote" | "declarations" | "decline" | "memo";

export interface Draft {
  kind: DraftKind;
  title: string;
  accountName: string;
  policyNumber: string;
  markdown: string;
  path: string;
  /** Points a human must resolve before this leaves the building. */
  reviewPoints: string[];
}

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const date = (s: unknown) => (typeof s === "string" && s ? s.slice(0, 10) : "—");
const today = () => new Date().toISOString().slice(0, 10);
const label = (f: string) => f.replace(/_/g, " ");

export const DRAFT_BANNER = (kind: string) =>
  `> **DRAFT — ${kind}.** Prepared automatically by plus1 from Federato policy data and the 2025 appetite guidelines, for underwriter review. Not a binding contract, quote, or offer of coverage. All terms subject to underwriter approval and carrier authority.\n`;

/** One policy with everything a document needs. */
export async function loadPolicyForDraft(policyId: number): Promise<Record<string, unknown>> {
  const page = await runQuery({
    resource: "Policy",
    where: { id: policyId },
    expand: {
      insured: { hq: true },
      claims: true,
      submission: { contact: true },
      producer: { broker: true, contact: true },
      coverages: true,
      endorsements: true,
      underwriter: true,
      exposure_units: { location: { buildings: true } },
    },
    pagination: { limit: 1 },
  });
  const rec = page.results?.[0] as Record<string, unknown> | undefined;
  if (!rec) throw new Error(`Policy ${policyId} not found`);
  return rec;
}

interface Context {
  p: Record<string, unknown>;
  insured: Record<string, unknown>;
  broker: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  underwriter: Record<string, unknown> | null;
  coverages: Record<string, unknown>[];
  endorsements: Record<string, unknown>[];
  locations: { address: string; city: string; state: string; zip: string; tiv: number; buildings: Record<string, unknown>[]; hazardTags: string[] }[];
  factors: FactorScore[];
  decision: string;
  score: number;
  maxScore: number;
  enrichment: HazardEnrichment | null;
  authority: { limit: number | null; ok: boolean | null };
}

async function buildContext(policyId: number): Promise<Context> {
  const p = await loadPolicyForDraft(policyId);
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  const input = policyFromFederatoRecord(p);
  const prim = primaryLocation(input.locations);
  const enrichment = prim ? await enrichLocation({ zip: prim.zip ?? null, county: prim.county ?? null, state: prim.state, latitude: prim.latitude ?? null, longitude: prim.longitude ?? null }) : null;
  const scored = scorePolicyAppetite(input, { enrichment });
  const eus = Array.isArray(p.exposure_units) ? (p.exposure_units as Record<string, unknown>[]) : [];
  const locations = eus.map((eu) => {
    const loc = obj(eu.location) ?? {};
    const buildings = Array.isArray(loc.buildings) ? (loc.buildings as Record<string, unknown>[]) : [];
    return {
      address: String(loc.address ?? ""), city: String(loc.city ?? ""), state: String(loc.state ?? ""), zip: String(loc.zip ?? ""),
      tiv: Number(eu.basis_amount ?? 0) || buildings.reduce((s, b) => s + (Number(b.tiv) || 0), 0),
      buildings, hazardTags: Array.isArray(loc.hazard_tags) ? loc.hazard_tags.map(String) : [],
    };
  });
  const underwriter = obj(p.underwriter);
  const limit = p.limit == null ? null : Number(p.limit);
  const authLimit = underwriter?.authority_limit == null ? null : Number(underwriter.authority_limit);
  return {
    p,
    insured: obj(p.insured) ?? {},
    broker: obj(obj(p.producer)?.broker),
    contact: obj(obj(p.producer)?.contact) ?? obj(obj(p.submission)?.contact),
    underwriter,
    coverages: Array.isArray(p.coverages) ? (p.coverages as Record<string, unknown>[]).filter((c) => c && typeof c === "object") : [],
    endorsements: Array.isArray(p.endorsements) ? (p.endorsements as Record<string, unknown>[]).filter((e) => e && typeof e === "object") : [],
    locations,
    factors: scored.factors,
    decision: scored.decision,
    score: scored.score,
    maxScore: scored.maxScore,
    enrichment,
    authority: { limit: authLimit, ok: limit != null && authLimit != null ? limit <= authLimit : null },
  };
}

// ── shared blocks ──

function partiesBlock(c: Context): string {
  const dates = (c.p.dates as Record<string, unknown>) ?? {};
  return [
    `| | |`, `|---|---|`,
    `| **Named insured** | ${c.insured.name ?? "—"}${c.insured.dba ? ` (dba ${c.insured.dba})` : ""} |`,
    `| **Entity / NAICS** | ${c.insured.entity_type ?? "—"} / ${c.insured.naics_code ?? "—"} |`,
    `| **Producer** | ${c.broker?.name ?? "—"}${c.broker?.tier ? ` (${c.broker.tier})` : ""}${c.broker?.license_number ? `, lic. ${c.broker.license_number}` : ""} |`,
    `| **Producer contact** | ${c.contact?.name ?? "—"}${c.contact?.email ? ` · ${c.contact.email}` : ""} |`,
    `| **Line of business** | ${c.p.line_of_business ?? "—"} (${c.p.business_type ?? "—"} business) |`,
    `| **Policy term** | ${date(dates.effective)} to ${date(dates.expiration)} |`,
    `| **Underwriter** | ${c.underwriter?.name ?? "unassigned"}${c.underwriter?.team ? `, ${c.underwriter.team}` : ""} |`,
  ].join("\n");
}

function termsBlock(c: Context): string {
  const t = (c.p.terms as Record<string, unknown>) ?? {};
  return [
    `| Term | Value |`, `|---|---|`,
    `| Policy limit | ${money(c.p.limit as number)} |`,
    `| Deductible | ${money(c.p.deductible as number)} |`,
    `| Annual premium | ${money(c.p.premium as number)} ${c.p.currency ?? "USD"} |`,
    `| Commission | ${pct(c.p.commission_pct as number)} |`,
    `| Coverage basis | ${t.coverage_basis ?? "—"} |`,
    ...(t.aggregate_limit != null ? [`| Aggregate limit | ${money(t.aggregate_limit as number)} |`] : []),
    ...(t.attachment_point != null ? [`| Attachment point | ${money(t.attachment_point as number)} |`] : []),
    ...(t.participation_pct != null ? [`| Participation | ${pct(t.participation_pct as number)} |`] : []),
  ].join("\n");
}

function coverageSchedule(c: Context): string {
  if (!c.coverages.length) return "_No coverage records on file._";
  const rows = c.coverages.map((cv) => `| ${cv.code ?? "—"} | ${cv.name ?? "—"} | ${cv.basis ?? "—"} | ${money(cv.limit_occurrence as number)} | ${money(cv.limit_aggregate as number)} | ${money(cv.deductible as number ?? cv.retention as number)} |`);
  return [`| Code | Coverage | Basis | Per occurrence | Aggregate | Deductible / retention |`, `|---|---|---|---|---|---|`, ...rows].join("\n");
}

function locationSchedule(c: Context): string {
  if (!c.locations.length) return "_No scheduled locations on file._";
  const rows: string[] = [`| # | Location | TIV | Buildings (year built · construction · sprinklered) | Hazards on file |`, `|---|---|---|---|---|`];
  c.locations.forEach((l, i) => {
    const b = l.buildings.map((x) => `${x.year_built ?? "?"} · ${x.construction_type ?? "?"} · ${x.sprinklered === true ? "yes" : x.sprinklered === false ? "no" : "?"}`).join("<br>") || "—";
    rows.push(`| ${i + 1} | ${[l.address, l.city, l.state, l.zip].filter(Boolean).join(", ")} | ${money(l.tiv)} | ${b} | ${l.hazardTags.join(", ") || "—"} |`);
  });
  const total = c.locations.reduce((s, l) => s + l.tiv, 0);
  rows.push(`| | **Total insured value** | **${money(total)}** | | |`);
  return rows.join("\n");
}

function formsSchedule(c: Context): string {
  if (!c.endorsements.length) return "_No endorsements on file._";
  const rows = c.endorsements.map((e) => `| ${e.form_number ?? "—"} | ${e.edition_date ?? "—"} | ${e.title ?? e.type ?? "—"} | ${date(e.effective_date)} | ${e.premium_change != null ? money(e.premium_change as number) : "—"} |`);
  return [`| Form | Edition | Title | Effective | Premium change |`, `|---|---|---|---|---|`, ...rows].join("\n");
}

function appetiteBlock(c: Context): string {
  const rows = c.factors.map((f) => `| ${label(f.factor)} | ${f.tier.replace("_", " ")} | ${f.value} | ${f.rule} |`);
  return [`**Appetite result: ${c.decision.toUpperCase()} (${c.score}/${c.maxScore})**`, ``, `| Factor | Tier | Value | Rule |`, `|---|---|---|---|`, ...rows].join("\n");
}

/** Subjectivities and conditions derived from what fails or is missing. */
function subjectivities(c: Context): string[] {
  const out: string[] = [];
  for (const f of c.factors) {
    if (f.tier === "missing") out.push(`Receipt and satisfactory review of ${label(f.factor)} information (not on file).`);
    if (f.tier === "not_acceptable") {
      switch (f.factor) {
        case "total_premium": out.push(`Premium to be re-rated into the $50,000–$175,000 appetite band or referred for approval (currently ${f.value}).`); break;
        case "building_age": out.push(`Roof and electrical/mechanical update documentation for buildings older than 1990 (${f.value}).`); break;
        case "construction_type": out.push(`Confirmation of construction class by location; frame majority is outside appetite (${f.value}).`); break;
        case "loss_value": out.push(`Five-year currently valued loss runs and a loss-control narrative; incurred losses ${f.value} exceed the $100,000 line.`); break;
        case "multi_state_exposure": out.push(`Locations in ${f.value} to be excluded or separately referred (out-of-appetite states).`); break;
        case "submission_type": out.push(`Renewal business is outside the 2025 appetite; requires senior underwriter referral.`); break;
        case "primary_risk_state": out.push(`Primary risk state ${f.value} is outside the appetite list; requires referral.`); break;
        case "tiv": out.push(`TIV ${f.value} exceeds the $150M ceiling; layered or excess structure to be considered.`); break;
        case "fema_declarations": case "nfip_flood_claims": case "fema_national_risk_index": case "usgs_earthquakes":
          out.push(`Catastrophe review: ${label(f.factor)} ${f.value}; flood/wind/quake sublimits and deductibles to be confirmed.`); break;
        default: out.push(`${label(f.factor)} ${f.value} outside appetite; underwriter to confirm.`);
      }
    }
  }
  if (c.authority.ok === false) out.push(`Policy limit ${money(c.p.limit as number)} exceeds ${c.underwriter?.name ?? "the assigned underwriter"}'s authority (${money(c.authority.limit)}); referral signature required.`);
  if (c.enrichment?.geocode?.matchesFile === false) out.push(`Primary location coordinates resolve to ${c.enrichment.geocode.county ?? "another county"}; address to be verified.`);
  return out;
}

function externalBlock(c: Context): string {
  if (!c.enrichment) return "";
  return `## External risk data\n${describeEnrichment(c.enrichment)} Sources: ${c.enrichment.sources.join(", ") || "none answered"}.\n`;
}

// ── documents ──

function renderQuote(c: Context): { markdown: string; reviewPoints: string[] } {
  const subj = subjectivities(c);
  const md = `${DRAFT_BANNER("Quote letter / indication")}
# Indication of terms — ${c.insured.name ?? "Insured"}

**To:** ${c.contact?.name ?? c.broker?.name ?? "Producer"}${c.broker?.name ? `, ${c.broker.name}` : ""}  
**From:** ${c.underwriter?.name ?? "Underwriting"}  
**Date:** ${today()}  
**Re:** ${c.p.line_of_business ?? "Property"} — ${c.insured.name ?? ""} — our ref. ${c.p.policy_number ?? "—"}

Thank you for the submission. Based on the information on file, we can offer the following **indication**, subject to the conditions below.

## Parties and term
${partiesBlock(c)}

## Indicated terms
${termsBlock(c)}

## Coverage schedule
${coverageSchedule(c)}

## Schedule of locations
${locationSchedule(c)}

## Forms and endorsements
${formsSchedule(c)}

## Conditions and subjectivities
${subj.length ? subj.map((s) => `- ${s}`).join("\n") : "- None beyond standard binding requirements."}

## Basis of this indication
${appetiteBlock(c)}

${externalBlock(c)}
This indication is valid for 30 days and is not a binder. Coverage is bound only by written confirmation from an authorised underwriter.
`;
  return { markdown: md, reviewPoints: subj };
}

function renderDeclarations(c: Context): { markdown: string; reviewPoints: string[] } {
  const subj = subjectivities(c);
  const md = `${DRAFT_BANNER("Policy declarations")}
# Commercial ${c.p.line_of_business ?? "property"} policy — Declarations

**Policy number:** ${c.p.policy_number ?? "—"}  **Status on file:** ${c.p.status ?? "—"}

## Item 1 — Named insured and producer
${partiesBlock(c)}

## Item 2 — Policy period
${date((c.p.dates as Record<string, unknown>)?.effective)} to ${date((c.p.dates as Record<string, unknown>)?.expiration)}, 12:01 a.m. standard time at the named insured's address.

## Item 3 — Limits, deductible and premium
${termsBlock(c)}

## Item 4 — Coverages
${coverageSchedule(c)}

## Item 5 — Schedule of locations
${locationSchedule(c)}

## Item 6 — Forms and endorsements attached
${formsSchedule(c)}

## Underwriter review points
${subj.length ? subj.map((s) => `- ${s}`).join("\n") : "- None."}
${c.authority.ok === true ? `\n_Limit within ${c.underwriter?.name ?? "underwriter"}'s authority (${money(c.authority.limit)})._` : ""}
`;
  return { markdown: md, reviewPoints: subj };
}

function renderDecline(c: Context): { markdown: string; reviewPoints: string[] } {
  const fails = c.factors.filter((f) => f.tier === "not_acceptable");
  const md = `${DRAFT_BANNER("Decline letter")}
# Declination — ${c.insured.name ?? "Insured"}

**To:** ${c.contact?.name ?? c.broker?.name ?? "Producer"}${c.broker?.name ? `, ${c.broker.name}` : ""}  
**From:** ${c.underwriter?.name ?? "Underwriting"}  
**Date:** ${today()}  
**Re:** ${c.p.line_of_business ?? "Property"} — ${c.insured.name ?? ""} — ref. ${c.p.policy_number ?? "—"}

Thank you for the opportunity to review this account. After evaluating the submission against our 2025 commercial property appetite guidelines, we are **unable to offer terms** at this time.

## Reasons
${fails.length ? fails.map((f) => `- **${label(f.factor)}**: ${f.value}. _Guideline: ${f.rule}._`).join("\n") : "- The account does not fit our current appetite."}

${c.enrichment ? `## Supporting external data\n${describeEnrichment(c.enrichment)}\n` : ""}
## What would change the outcome
${subjectivities(c).filter((s) => !/authority/.test(s)).map((s) => `- ${s}`).join("\n") || "- Not applicable."}

We would welcome the opportunity to review a revised submission. Nothing in this letter should be read as a statement about the insured's insurability with other carriers.

## Internal basis (not for the broker)
${appetiteBlock(c)}
`;
  return { markdown: md, reviewPoints: fails.map((f) => `${label(f.factor)}: ${f.value}`) };
}

/** Which document the request is asking for. */
export function parseDraftKind(text: string): DraftKind | null {
  const q = text.toLowerCase();
  if (/decline|declination|turn.?down|reject/.test(q)) return "decline";
  if (/declaration|dec page|binder|policy document|contract/.test(q)) return "declarations";
  if (/quote|indication|terms|proposal|offer/.test(q)) return "quote";
  if (/memo|write.?up|summary/.test(q)) return "memo";
  return null;
}

export async function draftDocument(kind: DraftKind, policyId: number): Promise<Draft> {
  const dir = ensureDir(path.join(OUTPUT_DIR, "drafts"));
  let markdown: string;
  let reviewPoints: string[];
  let accountName: string;
  let policyNumber: string;
  if (kind === "memo") {
    const { deepDive } = await deepDivePolicy(policyId, { enrich: true });
    markdown = `${DRAFT_BANNER("Underwriting memo")}\n${deepDive.memoMarkdown}`;
    reviewPoints = deepDive.contradictionNotes;
    accountName = deepDive.accountName;
    policyNumber = deepDive.policyNumber;
  } else {
    const c = await buildContext(policyId);
    const r = kind === "quote" ? renderQuote(c) : kind === "declarations" ? renderDeclarations(c) : renderDecline(c);
    markdown = r.markdown;
    reviewPoints = r.reviewPoints;
    accountName = String(c.insured.name ?? `policy ${policyId}`);
    policyNumber = String(c.p.policy_number ?? policyId);
  }
  const file = path.join(dir, `${kind}-${policyNumber.replace(/[^A-Za-z0-9-]/g, "_")}.md`);
  fs.writeFileSync(file, markdown);
  const title = { quote: "Quote letter / indication", declarations: "Policy declarations", decline: "Decline letter", memo: "Underwriting memo" }[kind];
  return { kind, title, accountName, policyNumber, markdown, path: file, reviewPoints };
}
