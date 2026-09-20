/**
 * Federato, exposed to the plus1 as tools it can call live in a meeting or chat. This is the
 * underwriting-agent surface for the Federato prize track:
 *
 *   federato_queue(filter?)      the submission queue scored + ranked against appetite (with external risk data)
 *   federato_account(query)      one account/policy: decision, every factor, contradictions, what to request next
 *   federato_query(goal)         agentic: plan a query from the live schema, run it, adapt, explain the query
 *   federato_portfolio(dimension) where the book is already exposed: by state / hazard / construction / broker / decision
 *   federato_enrich(query)       outside risk data for one account (FEMA declarations, NFIP claims, weather) and how it moves the score
 *   federato_guidelines(topic?)  the appetite table or a glossary term, verbatim
 *
 * Results are short strings the room can hear, plus an optional trace (queries run, sources hit)
 * for the operator's notes. Network lives here; scoring stays pure in packages/brain.
 */
import { describeEnrichment, explainGuidelines, type HazardEnrichment } from "@plus1/brain";
import type { RankedSubmission } from "@plus1/protocol";
import { deepDivePolicy } from "./deepDive.js";
import { enrichLocation } from "./enrichment.js";
import { agenticQuery, traceLines } from "./federatoQuery.js";
import { rankQueue } from "./rank.js";
import { renderFederatoIndication } from "./federatoPdf.js";
import { stashPdfBytes } from "./docPdf.js";

export interface FederatoToolResult {
  text: string;
  /** Operator-facing reasoning trace: queries chosen, sources consulted. */
  trace?: string[];
  pdfUrl?: string;
  shareUrl?: string;
}

const money = (n: number | null | undefined) =>
  n == null ? "n/a" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

const who = (r: RankedSubmission) => r.accountName ?? r.policyNumber ?? `policy ${r.policyId}`;

/** Short "why" for a ranked row: the target hits and the hard fails. */
function why(r: RankedSubmission): string {
  const fails = r.factors.filter((f) => f.tier === "not_acceptable").map((f) => `${f.factor.replace(/_/g, " ")} ${f.value}`);
  const hits = r.factors.filter((f) => f.tier === "target").map((f) => f.factor.replace(/_/g, " "));
  if (fails.length) return `fails ${fails.slice(0, 2).join(" and ")}`;
  if (hits.length) return `target on ${hits.slice(0, 3).join(", ")}`;
  return "acceptable across the board";
}

// ───────────────────────────── federato_queue ─────────────────────────────

async function queue(filter?: string): Promise<FederatoToolResult> {
  const t0 = Date.now();
  const { ranked, queryTrace } = await rankQueue({ refresh: false, enrich: true });
  if (!ranked.length) return { text: "the Federato queue is empty right now." };

  const q = filter?.trim().toLowerCase();
  let list = ranked;
  let scope = "the whole property queue";
  if (q) {
    const isState = /^[a-z]{2}$/.test(q);
    const hits = ranked.filter((r) => {
      if (isState) {
        const st = q.toUpperCase();
        const multi = r.factors.find((f) => f.factor === "multi_state_exposure")?.value ?? "";
        return (r.primaryState ?? "") === st || multi.split(/,\s*/).includes(st);
      }
      if (r.decision.toLowerCase() === q || (r.businessType ?? "").toLowerCase() === q) return true;
      if (who(r).toLowerCase().includes(q)) return true;
      // A failing factor by name ("premium", "construction", "loss", "building age", "flood")
      const words = q.split(/\s+/).filter((w) => w.length >= 4);
      return words.length > 0 && r.factors.some((f) => f.tier === "not_acceptable" && words.every((w) => f.factor.includes(w)));
    });
    if (hits.length) { list = hits; scope = `"${filter}"`; }
    else scope = `the whole property queue (nothing matched "${filter}")`;
  }

  const counts = list.reduce<Record<string, number>>((m, r) => ((m[r.decision] = (m[r.decision] ?? 0) + 1), m), {});
  const countLine = Object.entries(counts).map(([d, n]) => `${n} ${d}`).join(", ");
  const top = list.slice(0, 5).map((r, i) => `${i + 1}. ${who(r)} — ${r.decision.toUpperCase()} ${r.score}/${r.maxScore}, ${money(r.premium)} premium, ${money(r.tiv)} TIV in ${r.primaryState ?? "?"}; ${why(r)}`);
  const text = `${list.length} submissions in ${scope}: ${countLine}. Ranked by appetite:\n${top.join("\n")}`;
  return { text, trace: [...queryTrace.slice(0, 3), `ranked ${ranked.length} property policies in ${Date.now() - t0}ms (external risk data included)`] };
}

// ───────────────────────────── federato_account ─────────────────────────────

async function findPolicyId(query: string): Promise<{ id: number | null; how: string }> {
  const numMatch = query.match(/\b(\d{3,})\b/);
  const { ranked } = await rankQueue({ refresh: false });
  if (numMatch) {
    const n = Number(numMatch[1]);
    const byPolicy = ranked.find((r) => r.policyId === n || r.policyNumber?.includes(numMatch[1]!) || r.submissionNumber.includes(numMatch[1]!));
    if (byPolicy) return { id: byPolicy.policyId, how: `matched ${numMatch[1]} to ${who(byPolicy)}` };
    return { id: n, how: `treating ${n} as a policy id` };
  }
  const q = query.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return { id: null, how: "empty account query" };

  // Prefer a contiguous name match (stops "Harbor Point" → random "…Point…" / Verdant).
  const byPhrase = ranked
    .map((r) => {
      const name = who(r).toLowerCase();
      if (name.includes(q) || q.includes(name)) return { r, score: 100 + Math.min(name.length, q.length) };
      return null;
    })
    .filter(Boolean) as { r: (typeof ranked)[number]; score: number }[];
  if (byPhrase.length) {
    byPhrase.sort((a, b) => b.score - a.score);
    return { id: byPhrase[0]!.r.policyId, how: `phrase-matched "${query}" to ${who(byPhrase[0]!.r)}` };
  }

  const stop = new Set(["the", "and", "account", "policy", "for", "about", "check", "look", "into", "what", "with", "pdf", "quote", "indication", "send", "email", "please", "pull", "up"]);
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
  if (!words.length) return { id: null, how: `no usable tokens in "${query}"` };

  const scored = ranked
    .map((r) => {
      const name = who(r).toLowerCase();
      const hits = words.filter((w) => name.includes(w)).length;
      return { r, hits, name };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.name.length - a.name.length);

  const best = scored[0];
  if (!best) return { id: null, how: `no account name in the queue matched "${query}"` };
  // Multi-word queries need at least 2 token hits (Harbor + Point), not a weak single hit.
  if (words.length >= 2 && best.hits < 2) {
    return { id: null, how: `ambiguous match for "${query}" (best was ${who(best.r)} with ${best.hits} token hit)` };
  }
  // Tie-break: if #2 has same hits, refuse rather than guess Verdant.
  if (scored[1] && scored[1].hits === best.hits) {
    return {
      id: null,
      how: `ambiguous: "${query}" matches ${who(best.r)} and ${who(scored[1].r)} equally — ask which account`,
    };
  }
  return { id: best.r.policyId, how: `matched "${query}" to ${who(best.r)} (${best.hits}/${words.length} tokens)` };
}

async function account(query?: string): Promise<FederatoToolResult> {
  const q = query?.trim();
  if (!q) return { text: "which account or policy? give me a name or a policy number." };
  const found = await findPolicyId(q);
  if (found.id == null) return { text: `couldn't find an account matching "${q}" in the queue. try a name from the queue or a policy number.`, trace: [found.how] };

  const { deepDive, hops } = await deepDivePolicy(found.id, { enrich: true });
  const fails = deepDive.factors.filter((f) => f.tier === "not_acceptable");
  const targets = deepDive.factors.filter((f) => f.tier === "target");
  const missing = deepDive.factors.filter((f) => f.tier === "missing");
  const score = deepDive.factors.reduce((n, f) => n + f.points, 0);
  const maxScore = deepDive.factors.length * 2;
  const row = (await rankQueue({ refresh: false })).ranked.find((r) => r.policyId === found.id);
  const broker = brokerOf(found.id, (await rankQueue({ refresh: false, withPolicies: true })).policies);
  const headline = fails.length
    ? `${deepDive.accountName} (${deepDive.policyNumber}): ${deepDive.decision.toUpperCase()}, score ${score}/${maxScore}. ${deepDive.decision === "decline" ? "Out of appetite." : "Mixed fit."} ${money(row?.premium)} premium, ${money(row?.tiv)} TIV, primary state ${row?.primaryState ?? "?"}${broker ? `, via ${broker}` : ""}.`
    : `${deepDive.accountName} (${deepDive.policyNumber}): ${deepDive.decision.toUpperCase()}, score ${score}/${maxScore}. ${deepDive.explanation}${broker ? ` Broker: ${broker}.` : ""}`;
  const lines = [
    headline,
    fails.length ? `Red flags: ${fails.map((f) => `${f.factor.replace(/_/g, " ")} = ${f.value} (${f.rule})`).join("; ")}.` : "No hard fails.",
    targets.length ? `In target on: ${targets.map((f) => `${f.factor.replace(/_/g, " ")} ${f.value}`).join(", ")}.` : "",
    deepDive.contradictionNotes.length ? `Contradictions to resolve: ${deepDive.contradictionNotes.join(" ")}` : "",
    deepDive.address ? `Primary location: ${deepDive.address}${deepDive.hazardTags.length ? ` (broker tags: ${deepDive.hazardTags.join(", ")})` : ""}.` : "",
    missing.length ? `Still need from the broker: ${missing.map((f) => f.factor.replace(/_/g, " ")).join(", ")}.` : "",
  ].filter(Boolean);
  return { text: lines.join("\n"), trace: [found.how, ...hops.map((h) => `${h.stage} ${h.detail ?? ""} @${h.ms}ms`)] };
}

/** "Cardinal & Vale (boutique)" from an expanded policy record, if the cache has it. */
function brokerOf(policyId: number, policies?: unknown[]): string | null {
  const rec = (policies ?? []).find((p) => p && typeof p === "object" && Number((p as { id?: unknown }).id) === policyId) as Record<string, unknown> | undefined;
  const prod = rec?.producer as { broker?: { name?: string; tier?: string } | number } | undefined;
  if (prod && typeof prod.broker === "object" && prod.broker) return `${prod.broker.name ?? "unknown broker"}${prod.broker.tier ? ` (${prod.broker.tier})` : ""}`;
  return null;
}

// ───────────────────────────── federato_query ─────────────────────────────

async function query(goal?: string): Promise<FederatoToolResult> {
  const g = goal?.trim();
  if (!g) return { text: "what do you want to know from the Federato data? give me the question in plain english." };
  const res = await agenticQuery(g);
  return { text: res.text, trace: traceLines(res.attempts) };
}

// ───────────────────────────── federato_portfolio ─────────────────────────────

type Dimension = "state" | "hazard" | "construction" | "broker" | "decision" | "business_type";

function pickDimension(s?: string): Dimension {
  const q = (s ?? "").toLowerCase();
  if (/hazard|peril|flood|wildfire|hurricane|earthquake|cat\b/.test(q)) return "hazard";
  if (/construct|frame|masonry|steel/.test(q)) return "construction";
  if (/broker|producer|agency/.test(q)) return "broker";
  if (/decision|quote|refer|decline|appetite/.test(q)) return "decision";
  if (/renewal|new business|business type/.test(q)) return "business_type";
  return "state";
}

async function portfolio(dimension?: string): Promise<FederatoToolResult> {
  const dim = pickDimension(dimension);
  const { ranked, policies } = await rankQueue({ refresh: false, withPolicies: true });
  type Agg = { n: number; tiv: number; premium: number; decisions: Record<string, number> };
  const agg = new Map<string, Agg>();
  const bump = (key: string, r: RankedSubmission, tivShare = r.tiv ?? 0) => {
    const a = agg.get(key) ?? { n: 0, tiv: 0, premium: 0, decisions: {} };
    a.n += 1; a.tiv += tivShare; a.premium += r.premium ?? 0; a.decisions[r.decision] = (a.decisions[r.decision] ?? 0) + 1;
    agg.set(key, a);
  };
  const byId = new Map<number, Record<string, unknown>>();
  for (const p of policies ?? []) { const rec = p as Record<string, unknown>; if (rec.id != null) byId.set(Number(rec.id), rec); }

  for (const r of ranked) {
    const rec = r.policyId != null ? byId.get(r.policyId) : undefined;
    if (dim === "state") { bump(r.primaryState ?? "unknown", r); continue; }
    if (dim === "decision") { bump(r.decision, r); continue; }
    if (dim === "business_type") { bump(r.businessType ?? "unknown", r); continue; }
    if (dim === "broker") {
      const prod = rec?.producer as { broker?: { name?: string } | number } | undefined;
      const name = typeof prod?.broker === "object" && prod.broker ? prod.broker.name ?? "unknown" : `broker #${prod?.broker ?? "?"}`;
      bump(name, r); continue;
    }
    const eus = Array.isArray(rec?.exposure_units) ? (rec!.exposure_units as Record<string, unknown>[]) : [];
    if (dim === "hazard") {
      const tags = new Set<string>();
      for (const eu of eus) { const loc = eu.location as { hazard_tags?: string[] } | undefined; for (const t of loc?.hazard_tags ?? []) tags.add(t); }
      if (tags.size === 0) bump("none tagged", r);
      for (const t of tags) bump(t, r);
      continue;
    }
    if (dim === "construction") {
      const byType = new Map<string, number>();
      for (const eu of eus) { const loc = eu.location as { buildings?: { construction_type?: string; tiv?: number }[] } | undefined; for (const b of loc?.buildings ?? []) byType.set(b.construction_type ?? "unknown", (byType.get(b.construction_type ?? "unknown") ?? 0) + (b.tiv ?? 0)); }
      for (const [t, tiv] of byType) bump(t, r, tiv);
    }
  }
  const rows = [...agg.entries()].sort((a, b) => b[1].tiv - a[1].tiv).slice(0, 8);
  const totalTiv = ranked.reduce((s, r) => s + (r.tiv ?? 0), 0);
  const lines = rows.map(([k, a]) => {
    const share = totalTiv ? Math.round((a.tiv / totalTiv) * 100) : 0;
    const dec = Object.entries(a.decisions).map(([d, n]) => `${n} ${d}`).join(", ");
    return `${k}: ${a.n} ${a.n === 1 ? "policy" : "policies"}, ${money(a.tiv)} TIV (${share}% of book), ${money(a.premium)} premium; ${dec}`;
  });
  const dimLabel = dim === "hazard" ? "hazard tag (a policy with several tags counts in each)" : dim === "construction" ? "construction type (TIV-weighted)" : dim.replace("_", " ");
  return { text: `Property book by ${dimLabel}, ${ranked.length} policies, ${money(totalTiv)} total TIV:\n${lines.join("\n")}`, trace: [`aggregated client-side over ${ranked.length} cached expanded policies by ${dim}`] };
}

// ───────────────────────────── federato_enrich ─────────────────────────────

async function enrich(query?: string): Promise<FederatoToolResult> {
  const q = query?.trim();
  if (!q) return { text: "which account should i pull outside risk data for?" };
  const found = await findPolicyId(q);
  if (found.id == null) return { text: `couldn't find "${q}" in the queue.`, trace: [found.how] };
  const plain = await deepDivePolicy(found.id, { enrich: false });
  const enriched = await deepDivePolicy(found.id, { enrich: true });
  const e = enriched.deepDive.enrichment as HazardEnrichment | undefined;
  if (!e) return { text: `no location data to enrich for ${plain.deepDive.accountName}.` };
  const ext = enriched.deepDive.factors.filter((f) => ["fema_declarations", "nfip_flood_claims", "weather_extremes"].includes(f.factor));
  const moved = plain.deepDive.decision !== enriched.deepDive.decision
    ? `That moves the call from ${plain.deepDive.decision.toUpperCase()} to ${enriched.deepDive.decision.toUpperCase()}.`
    : `The call stays ${enriched.deepDive.decision.toUpperCase()} (score ${plain.deepDive.factors.reduce((s, f) => s + f.points, 0)} → ${enriched.deepDive.factors.reduce((s, f) => s + f.points, 0)}).`;
  const text = [
    `${enriched.deepDive.accountName}, ${enriched.deepDive.address || "primary location"}: ${describeEnrichment(e)}`,
    `Scored: ${ext.map((f) => `${f.factor.replace(/_/g, " ")} → ${f.tier.replace("_", " ")} (${f.value})`).join("; ")}.`,
    moved,
  ].join(" ");
  return { text, trace: [found.how, `sources: ${e.sources.join(", ") || "none answered"}`] };
}

// ───────────────────────────── federato_guidelines ─────────────────────────────

function guidelines(topic?: string): FederatoToolResult {
  return { text: explainGuidelines(topic) };
}

// ───────────────────────────── federato_quote_pdf ──────────────────────────

async function quotePdf(query?: string): Promise<FederatoToolResult> {
  const q = query?.trim();
  if (!q) return { text: "which account should the indication be for? name or policy number." };
  const found = await findPolicyId(q);
  if (found.id == null) {
    return { text: `couldn't find "${q}" in the queue.`, trace: [found.how] };
  }
  const { deepDive, hops } = await deepDivePolicy(found.id, { enrich: true });
  const { ranked, policies } = await rankQueue({ refresh: false, withPolicies: true });
  const row = ranked.find((r) => r.policyId === found.id);
  const broker = brokerOf(found.id, policies);
  const pdf = await renderFederatoIndication({ deepDive, row, broker });
  const stored = await stashPdfBytes({
    bytes: pdf.bytes,
    filename: pdf.filename,
    title: pdf.title,
    pages: pdf.pages,
  });
  const who = deepDive.accountName;
  const text = stored.shareUrl
    ? `Indication for ${who}: ${deepDive.decision.toUpperCase()}, score ${deepDive.factors.reduce((n, f) => n + f.points, 0)}/${deepDive.factors.length * 2}. The PDF is in the chat — don't read the URL.`
    : `Indication for ${who} is ready as a PDF (${deepDive.decision.toUpperCase()}). I can email it if you give me an address.`;
  return {
    text,
    pdfUrl: stored.pdfUrl,
    shareUrl: stored.shareUrl,
    trace: [found.how, ...hops.map((h) => `${h.stage} ${h.detail ?? ""}`), stored.shareUrl ? "uploaded to Appwrite" : "no public host"],
  };
}

/** Dispatch a federato_* tool. */
export async function runFederatoTool(name: string, args: { query?: string }): Promise<FederatoToolResult> {
  switch (name) {
    case "federato_queue":
    case "federato_appetite": // legacy name
      return queue(args.query);
    case "federato_account":
      return account(args.query);
    case "federato_query":
      return query(args.query);
    case "federato_portfolio":
      return portfolio(args.query);
    case "federato_enrich":
      return enrich(args.query);
    case "federato_guidelines":
      return guidelines(args.query);
    case "federato_quote_pdf":
      return quotePdf(args.query);
    default:
      return { text: `Unknown Federato tool: ${name}` };
  }
}

/** Tool docs shown to the brain. Kept next to the implementations so they never drift. */
export const FEDERATO_TOOL_DOCS: { name: string; doc: string }[] = [
  { name: "federato_queue", doc: `federato_queue(filter?) — the property submission queue scored against the 2025 appetite guidelines and ranked (quote / refer / investigate / decline), with counts and the top five and why. Filter by a state ("FL"), a decision ("decline"), "renewal"/"new", a failing factor ("premium"), or an account name. Use for "what's in the queue", "what should we look at first", "anything in Florida".` },
  { name: "federato_account", doc: `federato_account(query) — deep-dive ONE account by name or policy number: decision, score, every appetite factor with its tier and the rule behind it, red flags, contradictions in the file, the primary location's hazard tags, and what data is still missing from the broker. Use whenever someone names an account.` },
  { name: "federato_query", doc: `federato_query(goal) — ask the Federato data anything in plain english ("how many active property policies in California over $50M TIV", "which brokers sent the most declined submissions", "claims over $100K by cause of loss", "policies expiring in the next 90 days"). I read the live schema, write the query, run it, and fix it if it comes back empty. Use for any count, list, comparison or lookup the other tools don't cover.` },
  { name: "federato_portfolio", doc: `federato_portfolio(dimension) — where the book is already exposed, for portfolio context: by "state", "hazard", "construction", "broker", "decision" or "business type" — policies, TIV, premium and share of the book per bucket. Use for "are we already heavy in Florida / flood / frame", "which broker sends us the most".` },
  { name: "federato_enrich", doc: `federato_enrich(query) — pull OUTSIDE risk data for one account's primary location: FEMA disaster declarations for the county since 2015, NFIP flood claims in the zip, and last year's worst gust and wettest day (OpenFEMA + Open-Meteo, live), scored as extra appetite factors, and whether that changes the decision. Use when someone asks about flood/hurricane/cat exposure or "what does the outside data say".` },
  { name: "federato_guidelines", doc: `federato_guidelines(topic?) — quote the 2025 commercial property appetite table (or one factor, e.g. "premium", "construction") or define an underwriting term ("TIV", "appetite", "refer"). Use when someone asks what the rules are or what a term means.` },
  { name: "federato_quote_pdf", doc: `federato_quote_pdf(query) — render a one-page commercial property INDICATION from the live Federato file. tool.query = exact account name or policy number. The public link is posted into Meet chat automatically — NEVER read the URL aloud. When this tool returns, the PDF is DONE (never say "still generating"). Email ONLY if they asked to email/mail it — then call email_send with attachPdf:"last". Default for "send me the report/indication" is chat, not email.` },
];
