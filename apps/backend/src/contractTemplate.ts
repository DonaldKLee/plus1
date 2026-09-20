/**
 * The contract template, filled from ONE submission: INGEST → ENRICH → CLASSIFY → DRAFT.
 *
 * Every field carries its provenance — submission record, the insured's policies on file,
 * external risk data, the appetite engine, or "to be provided by the broker" — so a reader can
 * see exactly what the agent knew and what it didn't. Proposed terms are seeded from the expiring
 * same-line policy when there is one; otherwise they are placeholders, never invented numbers.
 *
 * The output is an indication / draft contract package for underwriter review. It is not a policy,
 * and the agent never binds. Federato's API is read-only; drafts are saved locally and returned.
 */
import fs from "node:fs";
import path from "node:path";
import { describeEnrichment, intakeRequests, scorePolicyAppetite, submissionIntakeInput, type HazardEnrichment } from "@plus1/brain";
import type { FactorScore, MindHop, UnderwriteDecision } from "@plus1/protocol";
import { DRAFT_BANNER, loadPolicyForDraft } from "./drafts.js";
import { enrichLocation, primaryLocation } from "./enrichment.js";
import { OUTPUT_DIR, ensureDir } from "./env.js";
import { findOpenSubmission, ingestOpenSubmissions, insuredIdOfRecord, type OpenSubmission } from "./submissions.js";

export type FieldSource = "submission" | "insured history" | "expiring policy" | "external data" | "appetite engine" | "underwriter" | "to be provided";

export interface TemplateField {
  key: string;
  label: string;
  value: string | number | null;
  source: FieldSource;
  note?: string;
}

export interface TemplateSection {
  id: string;
  title: string;
  fields?: TemplateField[];
  /** Markdown body for tables/lists that don't fit key/value. */
  body?: string;
}

export interface ContractDraft {
  submissionNumber: string;
  accountName: string;
  decision: UnderwriteDecision;
  score: number;
  maxScore: number;
  sections: TemplateSection[];
  /** Fields the broker or underwriter must supply before this can go out. */
  openItems: string[];
  markdown: string;
  path: string;
  jsonPath: string;
  hops: MindHop[];
}

const money = (n: number | null | undefined) => (n == null ? null : `$${Math.round(n).toLocaleString("en-US")}`);
const date = (s: unknown) => (typeof s === "string" && s ? s.slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);
const label = (f: string) => f.replace(/_/g, " ");
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
const TBP = (what: string): TemplateField["value"] => `[[ TO BE PROVIDED: ${what} ]]`;

function field(key: string, label: string, value: string | number | null | undefined, source: FieldSource, note?: string): TemplateField {
  return { key, label, value: value ?? null, source, ...(note ? { note } : {}) };
}

/** Build the filled template for a submission reference (number, id, or insured name). */
export async function buildContractDraft(ref: string): Promise<ContractDraft> {
  const t0 = Date.now();
  const hops: MindHop[] = [];

  // ── INGEST ──
  const { subs, byInsured } = await ingestOpenSubmissions();
  const sub = findOpenSubmission(subs, ref);
  if (!sub) throw new Error(`no open submission matches "${ref}"`);
  const insuredId = insuredIdOfRecord(sub.insured);
  const history = insuredId == null ? [] : byInsured.get(insuredId) ?? [];
  const intake = submissionIntakeInput(sub, history);
  const lob = intake.input.lineOfBusiness ?? "";
  // The expiring same-line policy (most recent) seeds coverages, deductible and forms.
  const sameLine = history
    .filter((p) => String(p.line_of_business ?? "").toLowerCase() === lob)
    .sort((a, b) => String(obj(b.dates)?.effective ?? "").localeCompare(String(obj(a.dates)?.effective ?? "")));
  const expiring = sameLine[0] ? await loadPolicyForDraft(Number(sameLine[0].id)) : null;
  hops.push({ stage: "INGEST", ms: Date.now() - t0, detail: `${intake.basis.note}${expiring ? `; expiring ${lob} policy ${expiring.policy_number} on file` : "; no expiring same-line policy"}` });

  // ── ENRICH ──
  const prim = primaryLocation(intake.input.locations);
  let enrichment: HazardEnrichment | null = null;
  if (prim) {
    const tE = Date.now();
    enrichment = await enrichLocation({ zip: prim.zip ?? null, county: prim.county ?? null, state: prim.state, latitude: prim.latitude ?? null, longitude: prim.longitude ?? null });
    hops.push({ stage: "ENRICH", ms: Date.now() - t0, detail: `${enrichment.sources.length}/6 sources for ${[prim.address, prim.city, prim.state].filter(Boolean).join(", ")} (${Date.now() - tE}ms)` });
  } else {
    hops.push({ stage: "ENRICH", ms: Date.now() - t0, detail: "no location on file to enrich" });
  }

  // ── CLASSIFY ──
  const scored = scorePolicyAppetite(intake.input, { enrichment });
  const requests = intakeRequests(scored.factors, intake.basis);
  hops.push({ stage: "CLASSIFY", ms: Date.now() - t0, detail: `${scored.decision} ${scored.score}/${scored.maxScore}; ${requests.length} broker request${requests.length === 1 ? "" : "s"}` });

  // ── DRAFT ──
  const insured = obj(sub.insured) ?? {};
  const broker = obj(sub.broker);
  const contact = obj(sub.contact);
  const underwriter = obj(sub.underwriter) ?? obj(expiring?.underwriter);
  const terms = obj(expiring?.terms);
  const coverages = Array.isArray(expiring?.coverages) ? (expiring!.coverages as Record<string, unknown>[]).filter((c) => c && typeof c === "object") : [];
  const endorsements = Array.isArray(expiring?.endorsements) ? (expiring!.endorsements as Record<string, unknown>[]).filter((e) => e && typeof e === "object") : [];
  const requestedLimit = sub.requested_limit == null ? null : Number(sub.requested_limit);
  const authLimit = underwriter?.authority_limit == null ? null : Number(underwriter.authority_limit);
  const authorityOk = requestedLimit != null && authLimit != null ? requestedLimit <= authLimit : null;
  const openItems: string[] = [...requests];

  const sections: TemplateSection[] = [];

  sections.push({
    id: "parties",
    title: "1. Parties",
    fields: [
      field("insured", "Named insured", (insured.name as string) ?? null, "submission"),
      field("dba", "Doing business as", (insured.dba as string) ?? null, "submission"),
      field("entity", "Entity type / NAICS", insured.entity_type ? `${insured.entity_type} / ${insured.naics_code ?? "—"}` : null, "submission"),
      field("hq", "Head office", insured.hq && typeof insured.hq === "object" ? [obj(insured.hq)?.address, obj(insured.hq)?.city, obj(insured.hq)?.state].filter(Boolean).join(", ") : null, "submission"),
      field("broker", "Producer", broker ? `${broker.name ?? "—"}${broker.tier ? ` (${broker.tier})` : ""}${broker.license_number ? `, lic. ${broker.license_number}` : ""}` : null, "submission"),
      field("contact", "Producer contact", contact ? `${contact.name ?? "—"}${contact.email ? ` · ${contact.email}` : ""}` : null, "submission"),
      field("underwriter", "Underwriter", underwriter ? `${underwriter.name ?? "—"}${underwriter.team ? `, ${underwriter.team}` : ""}` : TBP("assigned underwriter"), underwriter ? "underwriter" : "to be provided"),
    ],
  });

  sections.push({
    id: "submission",
    title: "2. Submission",
    fields: [
      field("number", "Submission number", String(sub.submission_number ?? sub.id), "submission"),
      field("status", "Status", String(sub.status ?? "—"), "submission"),
      field("received", "Received", date(sub.received_date), "submission"),
      field("target_effective", "Target effective date", date(sub.target_effective_date), "submission"),
      field("lob", "Line of business", lob || null, "submission"),
      field("business_type", "New / renewal", intake.businessType, "insured history", intake.basis.priorSameLine ? `${intake.basis.priorSameLine} prior ${lob} polic${intake.basis.priorSameLine === 1 ? "y" : "ies"} on file` : "no prior policy in this line"),
      field("requested_limit", "Requested limit", money(requestedLimit), "submission"),
      field("competitor", "Incumbent / competitor", (sub.competitor as string) ?? null, "submission"),
    ],
  });

  const locRows = intake.input.locations.map((l, i) => {
    const b = l.buildings.map((x) => `${x.yearBuilt ?? "?"} · ${x.constructionType ?? "?"}`).join("<br>") || "—";
    return `| ${i + 1} | ${[l.address, l.city, l.state, l.zip].filter(Boolean).join(", ")} | ${money(l.tiv) ?? "—"} | ${b} | ${(l.hazardTags ?? []).join(", ") || "—"} |`;
  });
  const totalTiv = intake.input.locations.reduce((s, l) => s + l.tiv, 0);
  sections.push({
    id: "risk",
    title: "3. Risk profile (schedule of locations)",
    body: intake.input.locations.length
      ? [`_Source: insured history — ${intake.basis.note}._`, ``, `| # | Location | TIV | Buildings (year · construction) | Hazards on file |`, `|---|---|---|---|---|`, ...locRows, `| | **Total insured value** | **${money(totalTiv)}** | | |`].join("\n")
      : `${TBP("statement of values: locations, buildings, TIV")}`,
  });
  if (!intake.input.locations.length) openItems.push("statement of values (locations, TIV)");

  sections.push({
    id: "losses",
    title: "4. Loss history (five years)",
    fields: [
      field("claims", "Claims on file", intake.basis.claims, "insured history", intake.basis.priorSameLine ? `same line (${lob})` : "all lines counted — no same-line history"),
      field("incurred", "Incurred (paid + reserved)", intake.input.lossTotal == null ? TBP("five-year currently valued loss runs") : money(intake.input.lossTotal), intake.input.lossTotal == null ? "to be provided" : "insured history"),
    ],
  });

  sections.push({
    id: "external",
    title: "5. External risk data",
    body: enrichment
      ? [`${describeEnrichment(enrichment)}`, ``, `| Signal | Value | Source |`, `|---|---|---|`,
          `| National Risk Index (county) | ${enrichment.nri?.riskRating ?? "—"}${enrichment.nri?.riskScore != null ? ` (${Math.round(enrichment.nri.riskScore)}/100)` : ""}${enrichment.nri ? `; worst peril ${Object.entries(enrichment.nri.perils).sort((a, b) => b[1].localeCompare(a[1]))[0]?.join(": ") ?? "—"}` : ""} | FEMA NRI |`,
          `| Disaster declarations since 2015 | ${enrichment.declarationsSince2015 ?? "—"} | OpenFEMA |`,
          `| NFIP flood claims in zip ${enrichment.zip ?? ""} | ${enrichment.nfipClaims ?? "—"} | OpenFEMA |`,
          `| M4.5+ earthquakes within 150 km since 2000 | ${enrichment.quakesSince2000 ?? "—"} | USGS |`,
          `| 5-year max gust / wettest day / days >35 °C | ${enrichment.maxGustKmh != null ? `${Math.round(enrichment.maxGustKmh)} km/h` : "—"} / ${enrichment.maxDailyPrecipMm != null ? `${Math.round(enrichment.maxDailyPrecipMm)} mm` : "—"} / ${enrichment.hotDays ?? "—"} | Open-Meteo |`,
          `| Coordinates resolve to | ${enrichment.geocode ? `${enrichment.geocode.county ?? "?"}, ${enrichment.geocode.state ?? "?"}${enrichment.geocode.matchesFile === false ? " — DIFFERS FROM FILE" : ""}` : "—"} | OpenStreetMap |`,
          ``, `_Sources answering: ${enrichment.sources.join(", ") || "none"}._`].join("\n")
      : "_No location to enrich._",
  });

  const factorRows = scored.factors.map((f) => `| ${label(f.factor)} | ${f.tier.replace("_", " ")} | ${f.value} | ${f.rule} |`);
  sections.push({
    id: "appetite",
    title: "6. Appetite assessment",
    body: [`**${scored.decision.toUpperCase()}** — score ${scored.score}/${scored.maxScore}. ${scored.explanation}`, ``, `| Factor | Tier | Value | Rule |`, `|---|---|---|---|`, ...factorRows].join("\n"),
  });

  // Proposed terms: expiring policy as the basis, submission for the limit, placeholders for the rest.
  const premiumBasis = expiring?.premium != null ? Number(expiring.premium) : null;
  sections.push({
    id: "terms",
    title: "7. Proposed terms (indication)",
    fields: [
      field("limit", "Policy limit", money(requestedLimit) ?? TBP("limit requested"), requestedLimit != null ? "submission" : "to be provided"),
      field("deductible", "Deductible", expiring?.deductible != null ? money(Number(expiring.deductible)) : TBP("deductible"), expiring?.deductible != null ? "expiring policy" : "to be provided", expiring ? `expiring ${expiring.policy_number}` : undefined),
      field("premium", "Annual premium", TBP("premium indication / target premium"), "to be provided", premiumBasis != null ? `expiring premium ${money(premiumBasis)} for reference; appetite band $50K–$175K` : "appetite band $50K–$175K"),
      field("term", "Policy period", sub.target_effective_date ? `${date(sub.target_effective_date)} for 12 months` : TBP("effective date"), sub.target_effective_date ? "submission" : "to be provided"),
      field("basis", "Coverage basis", (terms?.coverage_basis as string) ?? "occurrence", terms?.coverage_basis ? "expiring policy" : "underwriter", terms?.coverage_basis ? undefined : "default; confirm"),
      field("commission", "Commission", expiring?.commission_pct != null ? `${expiring.commission_pct}%` : TBP("commission"), expiring?.commission_pct != null ? "expiring policy" : "to be provided"),
    ],
  });

  sections.push({
    id: "coverages",
    title: "8. Coverage schedule",
    body: coverages.length
      ? [`_Basis: expiring policy ${expiring?.policy_number}; limits to be re-set against the requested limit._`, ``, `| Code | Coverage | Basis | Per occurrence | Aggregate | Deductible / retention |`, `|---|---|---|---|---|---|`,
          ...coverages.map((c) => `| ${c.code ?? "—"} | ${c.name ?? "—"} | ${c.basis ?? "—"} | ${money(c.limit_occurrence as number) ?? "—"} | ${money(c.limit_aggregate as number) ?? "—"} | ${money((c.deductible ?? c.retention) as number) ?? "—"} |`)].join("\n")
      : `${TBP("coverage schedule (no expiring policy on file)")}`,
  });

  sections.push({
    id: "forms",
    title: "9. Forms and endorsements",
    body: endorsements.length
      ? [`_Basis: expiring policy ${expiring?.policy_number}._`, ``, `| Form | Edition | Title |`, `|---|---|---|`, ...endorsements.map((e) => `| ${e.form_number ?? "—"} | ${e.edition_date ?? "—"} | ${e.title ?? e.type ?? "—"} |`)].join("\n")
      : "_Standard forms for the line; schedule to be confirmed by the underwriter._",
  });

  // Conditions: from missing/failing factors, broker requests, authority.
  const conditions: string[] = requests.map((r) => `Receipt and satisfactory review of: ${r}.`);
  for (const f of scored.factors) {
    if (f.tier !== "not_acceptable") continue;
    switch (f.factor) {
      case "submission_type": conditions.push("Renewal business is outside the 2025 appetite; senior underwriter referral required before any offer."); break;
      case "primary_risk_state": case "multi_state_exposure": conditions.push(`Locations in ${f.value} are outside the appetite state list; exclude or refer.`); break;
      case "building_age": conditions.push(`Building age (${f.value}): roof/electrical/mechanical updates to be documented.`); break;
      case "construction_type": conditions.push(`Construction (${f.value}) fails the >50% non-combustible rule; confirm ISO construction class per building.`); break;
      case "loss_value": conditions.push(`Incurred losses ${f.value} exceed the $100,000 line; loss-control narrative and corrective actions required.`); break;
      case "tiv": conditions.push(`TIV ${f.value} exceeds the $150M ceiling; layered or excess structure to be considered.`); break;
      case "line_of_business": conditions.push(`${f.value} is outside the property-only appetite; decline or route to the right desk.`); break;
      default: if (["fema_declarations", "nfip_flood_claims", "fema_national_risk_index", "usgs_earthquakes"].includes(f.factor)) conditions.push(`Catastrophe review (${label(f.factor)}: ${f.value}); wind/flood/quake sublimits and deductibles to be set.`);
    }
  }
  if (authorityOk === false) conditions.push(`Requested limit ${money(requestedLimit)} exceeds ${underwriter?.name ?? "the underwriter"}'s authority (${money(authLimit)}); referral signature required.`);
  if (enrichment?.geocode?.matchesFile === false) conditions.push(`Primary location coordinates resolve to ${enrichment.geocode.county ?? "another county"}; verify the address before binding.`);
  sections.push({ id: "conditions", title: "10. Conditions and subjectivities", body: conditions.length ? conditions.map((c) => `- ${c}`).join("\n") : "- Standard binding requirements only." });

  sections.push({
    id: "signoff",
    title: "11. Authority and sign-off",
    fields: [
      field("recommendation", "Agent recommendation", scored.decision.toUpperCase(), "appetite engine"),
      field("authority", "Within underwriter authority", authorityOk == null ? "unknown (limit or authority not on file)" : authorityOk ? "yes" : "no — referral", authorityOk == null ? "to be provided" : "underwriter"),
      field("uw_sign", "Underwriter signature / date", TBP("signature"), "to be provided"),
      field("valid", "Indication valid until", TBP("30 days from issue, unless withdrawn"), "underwriter"),
    ],
  });

  // Every [[ TO BE PROVIDED ]] placeholder is an open item too, so the list is complete.
  for (const s of sections) {
    if (s.id === "signoff") continue; // signature/validity are the underwriter's, not the broker's
    for (const f of s.fields ?? []) {
      const m = typeof f.value === "string" ? f.value.match(/\[\[ TO BE PROVIDED: (.+?) \]\]/) : null;
      if (m) openItems.push(m[1]!);
    }
    const mb = s.body?.match(/\[\[ TO BE PROVIDED: (.+?) \]\]/);
    if (mb) openItems.push(mb[1]!);
  }
  const markdown = renderMarkdown(sub, insured, scored.decision, scored.score, scored.maxScore, sections, hops);
  const dir = ensureDir(path.join(OUTPUT_DIR, "drafts"));
  const base = `contract-${String(sub.submission_number ?? sub.id).replace(/[^A-Za-z0-9-]/g, "_")}`;
  const mdPath = path.join(dir, `${base}.md`);
  const jsonPath = path.join(dir, `${base}.json`);
  const draft: ContractDraft = {
    submissionNumber: String(sub.submission_number ?? sub.id),
    accountName: intake.input.accountName,
    decision: scored.decision,
    score: scored.score,
    maxScore: scored.maxScore,
    sections,
    openItems: [...new Set(openItems)],
    markdown,
    path: mdPath,
    jsonPath,
    hops: [...hops, { stage: "DRAFT", ms: Date.now() - t0, detail: `${sections.length} sections, ${openItems.length} open item${openItems.length === 1 ? "" : "s"}` }],
  };
  fs.writeFileSync(mdPath, markdown);
  fs.writeFileSync(jsonPath, JSON.stringify({ ...draft, markdown: undefined }, null, 2));
  return draft;
}

function renderMarkdown(sub: OpenSubmission, insured: Record<string, unknown>, decision: string, score: number, max: number, sections: TemplateSection[], hops: MindHop[]): string {
  const head = [
    DRAFT_BANNER("Indication / draft contract package from submission"),
    `# Draft contract package — ${insured.name ?? "Insured"}`,
    ``,
    `**Submission:** ${sub.submission_number ?? sub.id}  **Prepared:** ${today()}  **Agent recommendation:** ${decision.toUpperCase()} (${score}/${max})`,
    ``,
    `_Pipeline: ${hops.map((h) => `${h.stage} (${h.detail})`).join(" → ")}._`,
    ``,
    `Fields marked \`[[ TO BE PROVIDED: … ]]\` were not available from Federato or the insured's file; each is also listed as a condition in section 10. The **Source** column says where every value came from.`,
    ``,
  ];
  const body = sections.map((s) => {
    const parts = [`## ${s.title}`];
    if (s.fields?.length) {
      parts.push(`| Field | Value | Source |`, `|---|---|---|`);
      for (const f of s.fields) parts.push(`| ${f.label} | ${f.value ?? "—"} | ${f.source}${f.note ? ` — ${f.note}` : ""} |`);
    }
    if (s.body) parts.push(s.body);
    return parts.join("\n");
  });
  return [head.join("\n"), ...body, `---\nThis package is an indication prepared for underwriter review. It is not a policy, binder, or offer of coverage, and nothing in it binds the carrier. Coverage is bound only by written confirmation from an authorised underwriter.\n`].join("\n\n");
}
