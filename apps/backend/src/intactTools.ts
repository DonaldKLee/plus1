/**
 * Intact insurance, exposed to the plus1 as tools: conversational car + tenant
 * quoting. The rating engine is pure (@plus1/brain/intact); this wrapper coerces
 * the loose details the brain gathered into typed inputs and formats a friendly,
 * chat-ready quote.
 */
import {
  quoteCar,
  quoteTenant,
  type CarQuoteInput,
  type TenantQuoteInput,
  type QuoteResult,
} from "@plus1/brain";

type Details = Record<string, unknown>;

const numOf = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const strOf = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const enumOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => {
  const s = strOf(v)?.toLowerCase();
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
};

function coerceCar(d: Details): CarQuoteInput {
  return {
    driverAge: numOf(d.driverAge),
    yearsLicensed: numOf(d.yearsLicensed),
    atFaultAccidents: numOf(d.atFaultAccidents),
    tickets: numOf(d.tickets),
    province: strOf(d.province),
    city: strOf(d.city),
    postal: strOf(d.postal),
    vehicleYear: numOf(d.vehicleYear),
    vehicleMake: strOf(d.vehicleMake),
    vehicleModel: strOf(d.vehicleModel),
    vehicleValue: numOf(d.vehicleValue),
    annualKm: numOf(d.annualKm),
    usage: enumOf(d.usage, ["commute", "pleasure", "business"] as const),
    coverage: enumOf(d.coverage, ["basic", "standard", "full"] as const),
    deductible: numOf(d.deductible),
  };
}

function coerceTenant(d: Details): TenantQuoteInput {
  return {
    province: strOf(d.province),
    city: strOf(d.city),
    postal: strOf(d.postal),
    dwellingType: enumOf(d.dwellingType, ["apartment", "condo", "house", "basement"] as const),
    contentsValue: numOf(d.contentsValue),
    liabilityLimit: numOf(d.liabilityLimit),
    deductible: numOf(d.deductible),
    priorClaims: numOf(d.priorClaims),
    hasRoommates: typeof d.hasRoommates === "boolean" ? d.hasRoommates : undefined,
  };
}

function fmtQuote(q: QuoteResult): string {
  const kind = q.product === "car" ? "Car insurance" : "Tenant insurance";
  const why = q.factors.map((f) => f.label).slice(0, 3).join(", ");
  const lines = [
    `${kind} — estimate`,
    `$${q.monthlyLow}–${q.monthlyHigh} / month  ($${q.annualLow.toLocaleString()}–${q.annualHigh.toLocaleString()} / yr, CAD)`,
    `Recommended: ${q.recommended.join(" · ")}`,
    why ? `Why: ${why}` : "",
    q.assumptions.length ? `Assumed: ${q.assumptions.join(", ")}` : "",
    q.disclaimer,
  ];
  return lines.filter(Boolean).join("\n");
}

const EXPLAIN: { re: RegExp; text: string }[] = [
  { re: /deductible/i, text: "A deductible is what you pay out of pocket on a claim before insurance covers the rest — a higher deductible means a lower premium." },
  { re: /comprehensive/i, text: "Comprehensive covers damage to your car that isn't a collision — theft, fire, vandalism, hail, or hitting an animal." },
  { re: /collision/i, text: "Collision covers damage to your own car from an accident, whoever's at fault." },
  { re: /liability/i, text: "Liability covers injury or damage you cause to other people or their property — it's the part the law requires." },
  { re: /replacement cost/i, text: "Replacement cost pays to replace your stuff with new equivalents, instead of paying the depreciated used value." },
  { re: /water|sewer|backup/i, text: "Water/sewer backup coverage pays for damage if water backs up through drains or sump pumps — it's usually an add-on, worth it for basements." },
  { re: /contents/i, text: "Contents coverage is the value of your belongings — furniture, electronics, clothes — that the policy will replace if they're damaged or stolen." },
];

function explain(term: string): string {
  const hit = EXPLAIN.find((e) => e.re.test(term));
  return hit ? hit.text : "happy to explain — which coverage or term did you want me to break down?";
}

export interface IntactToolResult {
  text: string;
  quote?: QuoteResult;
}

export async function runIntactTool(
  name: string,
  args: { query?: string; details?: Details },
): Promise<IntactToolResult> {
  if (name === "intact_quote_car") {
    const q = quoteCar(coerceCar(args.details ?? {}));
    return { text: fmtQuote(q), quote: q };
  }
  if (name === "intact_quote_tenant") {
    const q = quoteTenant(coerceTenant(args.details ?? {}));
    return { text: fmtQuote(q), quote: q };
  }
  if (name === "intact_explain") return { text: explain(args.query ?? "") };
  return { text: `Unknown Intact tool: ${name}` };
}
