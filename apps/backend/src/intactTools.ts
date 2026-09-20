/**
 * Intact insurance, exposed to the plus1 as tools: conversational car + tenant
 * quoting, vehicle lookup (real vPIC data), coverage explainers, an emailed PDF
 * summary, and a broker-call handoff. The rating engine is pure
 * (@plus1/brain/intact); this wrapper coerces the loose details the brain
 * gathered into typed inputs. See INTACT_MCP_LLD.md.
 */
import {
  quoteCar,
  quoteTenant,
  type CarQuoteInput,
  type TenantQuoteInput,
  type QuoteResult,
} from "@plus1/brain";
import { vehicleLookup, describeVehicle } from "./intactVehicle.js";
import { renderQuotePdf, type QuoteApplicant } from "./intactPdf.js";

type Details = Record<string, unknown>;

const numOf = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const strOf = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const boolOf = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const enumOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => {
  const s = strOf(v)?.toLowerCase();
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
};

function coerceCar(d: Details): CarQuoteInput {
  const atFault = numOf(d.atFaultAccidents);
  const notAtFault = numOf(d.notAtFaultAccidents);
  const lastAtFaultYearsAgo = numOf(d.lastAtFaultYearsAgo);
  const accidents =
    atFault != null || notAtFault != null || lastAtFaultYearsAgo != null
      ? { atFault: atFault ?? 0, notAtFault: notAtFault ?? 0, lastAtFaultYearsAgo }
      : undefined;
  return {
    driverAge: numOf(d.driverAge),
    yearsLicensed: numOf(d.yearsLicensed),
    accidents,
    minorConvictions: numOf(d.minorConvictions) ?? numOf(d.tickets),
    majorConvictions: numOf(d.majorConvictions),
    accidentForgiveness: boolOf(d.accidentForgiveness),
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
    bundleHome: boolOf(d.bundleHome),
    winterTires: boolOf(d.winterTires),
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
    hasRoommates: boolOf(d.hasRoommates),
    bundleAuto: boolOf(d.bundleAuto),
  };
}

function applicantOf(d: Details): QuoteApplicant {
  const vehicle = [numOf(d.vehicleYear), strOf(d.vehicleMake), strOf(d.vehicleModel)].filter(Boolean).join(" ");
  return { name: strOf(d.name), province: strOf(d.province), email: strOf(d.email), vehicle: vehicle || undefined };
}

function fmtQuote(q: QuoteResult): string {
  const kind = q.product === "car" ? "Car insurance" : "Tenant insurance";
  if (q.appetite !== "standard" && q.handoffReason) {
    return [`${kind} — this one needs a broker.`, q.handoffReason, "Intact broker line: 1-866-464-2424.", q.disclaimer]
      .filter(Boolean)
      .join("\n");
  }
  const why = q.factors.map((f) => f.label).slice(0, 3).join(", ");
  return [
    `${kind} — estimate`,
    `$${q.monthlyLow}–${q.monthlyHigh} / month  ($${q.annualLow.toLocaleString()}–${q.annualHigh.toLocaleString()} / yr, CAD)`,
    `Pay in full ${"$" + q.payment.annual.toLocaleString()}/yr, or $${q.payment.monthly}/mo.`,
    `Coverage: ${q.coverageTier}`,
    `Recommended: ${q.recommended.join(" · ")}`,
    why ? `Why: ${why}` : "",
    q.assumptions.length ? `Assumed: ${q.assumptions.join(", ")}` : "",
    q.disclaimer,
  ]
    .filter(Boolean)
    .join("\n");
}

const EXPLAIN: { re: RegExp; text: string }[] = [
  { re: /deductible/i, text: "A deductible is what you pay out of pocket on a claim before insurance covers the rest — a higher deductible means a lower premium." },
  { re: /comprehensive/i, text: "Comprehensive covers damage to your car that isn't a collision — theft, fire, vandalism, hail, or hitting an animal." },
  { re: /collision/i, text: "Collision covers damage to your own car from an accident, whoever's at fault." },
  { re: /accident benefit/i, text: "Accident Benefits cover medical costs, rehab, and income replacement if you're hurt in a car accident, no matter who caused it." },
  { re: /third.?party|liability/i, text: "Third-Party Liability covers injury or damage you cause to other people or their property — it's the part the law requires." },
  { re: /forgiveness/i, text: "Accident Forgiveness is an add-on that waives the premium increase on your first at-fault accident." },
  { re: /replacement cost/i, text: "Replacement cost pays to replace your stuff with new equivalents, instead of the depreciated used value." },
  { re: /water|sewer|backup/i, text: "Water/sewer backup coverage pays for damage if water backs up through drains or sump pumps — an add-on worth it for basements." },
  { re: /contents/i, text: "Contents coverage is the value of your belongings — furniture, electronics, clothes — the policy replaces if they're damaged or stolen." },
  { re: /bundle/i, text: "Bundling home/tenant and auto with one insurer usually knocks 10–15% off both premiums." },
];

function explain(term: string): string {
  const hit = EXPLAIN.find((e) => e.re.test(term));
  return hit ? hit.text : "happy to explain — which coverage or term did you want me to break down?";
}

export interface NextStep {
  kind: "broker_call" | "find_broker";
  brokerLine: string;
  meetUrl?: string;
}

export interface IntactToolResult {
  text: string;
  quote?: QuoteResult;
  pdfUrl?: string;
  shareUrl?: string;
  nextStep?: NextStep;
}

export async function runIntactTool(
  name: string,
  args: { query?: string; details?: Details },
): Promise<IntactToolResult> {
  const d = args.details ?? {};

  if (name === "intact_quote_car") {
    // Don't hand out a quote built on a made-up driver: age + location move the
    // price most, so require them before quoting rather than defaulting silently.
    const hasAge = numOf(d.driverAge) != null;
    const hasLocation = Boolean(strOf(d.province) || strOf(d.city) || strOf(d.postal));
    if (!hasAge || !hasLocation) {
      const need = [!hasAge && "how old you are", !hasLocation && "what city (or province) you're in"].filter(Boolean).join(" and ");
      return { text: `before i can quote that, i just need ${need} — those two change the price the most.` };
    }
    const q = quoteCar(coerceCar(d));
    return { text: fmtQuote(q), quote: q };
  }
  if (name === "intact_quote_tenant") {
    const hasLocation = Boolean(strOf(d.province) || strOf(d.city) || strOf(d.postal));
    if (!hasLocation) {
      return { text: "sure — what city (or province) are you renting in? that sets the base rate." };
    }
    const q = quoteTenant(coerceTenant(d));
    return { text: fmtQuote(q), quote: q };
  }
  if (name === "intact_explain") return { text: explain(args.query ?? strOf(d.term) ?? "") };

  if (name === "intact_vehicle_lookup") {
    const vin = strOf(d.vin) ?? args.query;
    if (!vin) return { text: "give me the 17-character VIN and i'll pull up the exact vehicle." };
    const v = await vehicleLookup(vin);
    if (!v) return { text: "i couldn't decode that VIN — want to just tell me the year, make, and model?" };
    return { text: `that's a ${describeVehicle(v)}. i'll use that for the quote.` };
  }

  if (name === "intact_quote_pdf" || name === "intact_email_quote") {
    const product = enumOf(d.product, ["car", "tenant"] as const) ?? (d.contentsValue != null ? "tenant" : "car");
    const q = product === "tenant" ? quoteTenant(coerceTenant(d)) : quoteCar(coerceCar(d));
    const pdf = await renderQuotePdf(q, applicantOf(d));
    const email = strOf(d.email);
    const text = pdf.shareUrl
      ? `Intact ${product} quote is ready. The PDF is in the chat — don't read the URL.`
      : email
        ? `your Intact ${product} quote is ready as a PDF. I can email it to ${email}.`
        : `your Intact ${product} quote is ready as a PDF.`;
    return { text, quote: q, pdfUrl: pdf.pdfUrl, shareUrl: pdf.shareUrl };
  }

  if (name === "intact_next_step") {
    const brokerLine = "1-866-464-2424";
    const highRisk = strOf(d.appetite) === "high_risk" || strOf(d.appetite) === "refer";
    const text = highRisk
      ? "this one's best placed by a broker — want me to set up a quick call so they can find you the right market?"
      : "want me to book a quick call with a broker to finalize, or set you up with belairdirect to buy online?";
    return { text, nextStep: { kind: "broker_call", brokerLine } };
  }

  return { text: `Unknown Intact tool: ${name}` };
}
