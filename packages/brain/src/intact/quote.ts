/**
 * Intact-style quoting engine for car + tenant insurance. Pure and deterministic
 * (no network — belongs in the brain), so it can be tested and reasoned about.
 *
 * The rating factors are realistic but SYNTHETIC — every quote is an estimate for
 * a hackathon demo, not a binding Intact quote. Missing inputs get sensible
 * defaults, and every default is reported back as an assumption so the estimate
 * stays honest.
 */

export type Product = "car" | "tenant";

export interface CarQuoteInput {
  driverAge?: number;
  yearsLicensed?: number;
  atFaultAccidents?: number;
  tickets?: number;
  province?: string; // ON, BC, AB, QC, ...
  city?: string;
  postal?: string; // FSA, e.g. "M5V"
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleValue?: number; // CAD
  annualKm?: number;
  usage?: "commute" | "pleasure" | "business";
  coverage?: "basic" | "standard" | "full"; // liability-only / +collision / full
  deductible?: number; // 250 / 500 / 1000
}

export interface TenantQuoteInput {
  province?: string;
  city?: string;
  postal?: string;
  dwellingType?: "apartment" | "condo" | "house" | "basement";
  contentsValue?: number; // CAD
  liabilityLimit?: number; // 1_000_000 / 2_000_000
  deductible?: number; // 500 / 1000
  priorClaims?: number;
  hasRoommates?: boolean;
}

export interface QuoteFactor {
  label: string;
  effect: "raises" | "lowers" | "neutral";
}

export interface QuoteResult {
  product: Product;
  currency: "CAD";
  monthlyLow: number;
  monthlyHigh: number;
  annualLow: number;
  annualHigh: number;
  recommended: string[];
  factors: QuoteFactor[];
  assumptions: string[];
  disclaimer: string;
}

const DISCLAIMER =
  "Estimate only — a synthetic quote for demo purposes, not a binding Intact quote. Final pricing depends on a full application and underwriting.";

const PROVINCE_FACTOR: Record<string, number> = {
  ON: 1.35,
  BC: 1.4,
  AB: 1.2,
  QC: 0.9,
  MB: 1.1,
  SK: 1.1,
  NS: 1.0,
  NB: 1.0,
  NL: 1.0,
  PE: 0.95,
};

function round(n: number, to = 1): number {
  return Math.round(n / to) * to;
}
function band(annual: number): Pick<QuoteResult, "annualLow" | "annualHigh" | "monthlyLow" | "monthlyHigh"> {
  const low = annual * 0.9;
  const high = annual * 1.12;
  return {
    annualLow: round(low, 10),
    annualHigh: round(high, 10),
    monthlyLow: round(low / 12),
    monthlyHigh: round(high / 12),
  };
}
function provinceFactor(p?: string): number {
  return p ? (PROVINCE_FACTOR[p.toUpperCase()] ?? 1.0) : 1.0;
}

export function quoteCar(input: CarQuoteInput): QuoteResult {
  const assumptions: string[] = [];
  const factors: QuoteFactor[] = [];

  const age = input.driverAge ?? assume(assumptions, "driver age 35", 35);
  const yearsLicensed = input.yearsLicensed ?? assume(assumptions, "10+ years licensed", 12);
  const accidents = input.atFaultAccidents ?? assume(assumptions, "no at-fault accidents", 0);
  const tickets = input.tickets ?? assume(assumptions, "a clean record", 0);
  const province = input.province ?? assume(assumptions, "Ontario", "ON");
  const value = input.vehicleValue ?? assume(assumptions, "a ~$22,000 vehicle", 22000);
  const annualKm = input.annualKm ?? assume(assumptions, "~15,000 km/year", 15000);
  const usage = input.usage ?? assume(assumptions, "commuting use", "commute" as const);
  const coverage = input.coverage ?? assume(assumptions, "standard coverage (collision + comprehensive)", "standard" as const);
  const deductible = input.deductible ?? assume(assumptions, "a $500 deductible", 500);

  let annual = 1000;

  const ageF = age < 20 ? 1.95 : age < 25 ? 1.55 : age < 30 ? 1.18 : age < 65 ? 1.0 : 1.12;
  annual *= ageF;
  factors.push({ label: `driver age ${age}`, effect: ageF > 1.05 ? "raises" : ageF < 0.98 ? "lowers" : "neutral" });

  const expF = yearsLicensed < 3 ? 1.3 : yearsLicensed < 10 ? 1.05 : 0.95;
  annual *= expF;
  if (yearsLicensed < 3) factors.push({ label: "newly licensed", effect: "raises" });

  if (accidents > 0) {
    annual *= 1 + accidents * 0.25;
    factors.push({ label: `${accidents} at-fault accident${accidents > 1 ? "s" : ""}`, effect: "raises" });
  } else {
    factors.push({ label: "clean claims record", effect: "lowers" });
  }
  if (tickets > 0) {
    annual *= 1 + tickets * 0.08;
    factors.push({ label: `${tickets} ticket${tickets > 1 ? "s" : ""}`, effect: "raises" });
  }

  const provF = provinceFactor(province);
  annual *= provF;
  factors.push({ label: `${province.toUpperCase()} rates`, effect: provF > 1.05 ? "raises" : provF < 0.95 ? "lowers" : "neutral" });

  annual *= 0.75 + Math.min(1.1, value / 30000); // value contributes to collision/comp
  const kmF = annualKm > 20000 ? 1.15 : annualKm < 10000 ? 0.9 : 1.0;
  annual *= kmF;
  if (annualKm > 20000) factors.push({ label: "high annual mileage", effect: "raises" });
  else if (annualKm < 10000) factors.push({ label: "low mileage", effect: "lowers" });

  annual *= usage === "business" ? 1.2 : usage === "commute" ? 1.05 : 0.95;
  annual *= coverage === "basic" ? 0.68 : coverage === "full" ? 1.28 : 1.0;
  annual *= deductible >= 1000 ? 0.9 : deductible <= 250 ? 1.1 : 1.0;

  const recommended: string[] = [];
  recommended.push("$1M third-party liability");
  if (value >= 10000 || (input.vehicleYear ?? 2018) >= new Date().getFullYear() - 8) {
    recommended.push("collision + comprehensive (worth it at this vehicle value)");
  } else {
    recommended.push("comprehensive; collision optional on an older car");
  }
  recommended.push(`$${deductible} deductible`);
  if (age < 25 || accidents > 0) recommended.push("accident forgiveness add-on");

  return {
    product: "car",
    currency: "CAD",
    ...band(annual),
    recommended,
    factors: dedupeFactors(factors),
    assumptions,
    disclaimer: DISCLAIMER,
  };
}

export function quoteTenant(input: TenantQuoteInput): QuoteResult {
  const assumptions: string[] = [];
  const factors: QuoteFactor[] = [];

  const province = input.province ?? assume(assumptions, "Ontario", "ON");
  const dwelling = input.dwellingType ?? assume(assumptions, "an apartment", "apartment" as const);
  const contents = input.contentsValue ?? assume(assumptions, "~$30,000 of contents", 30000);
  const liability = input.liabilityLimit ?? assume(assumptions, "$1M liability", 1_000_000);
  const deductible = input.deductible ?? assume(assumptions, "a $500 deductible", 500);
  const claims = input.priorClaims ?? assume(assumptions, "no prior claims", 0);

  let annual = 120;
  annual += (contents / 30000) * 90; // contents drive most of it
  factors.push({ label: `$${Math.round(contents / 1000)}k contents`, effect: contents > 40000 ? "raises" : "neutral" });

  const provF = provinceFactor(province);
  annual *= 0.85 + provF * 0.15;
  factors.push({ label: `${province.toUpperCase()} rates`, effect: provF > 1.05 ? "raises" : "neutral" });

  const dwellF = dwelling === "basement" ? 1.15 : dwelling === "house" ? 1.1 : dwelling === "condo" ? 0.95 : 1.0;
  annual *= dwellF;
  if (dwelling === "basement") factors.push({ label: "basement unit (water risk)", effect: "raises" });

  annual *= liability >= 2_000_000 ? 1.1 : 1.0;
  annual *= deductible >= 1000 ? 0.9 : 1.0;
  if (claims > 0) {
    annual *= 1 + claims * 0.2;
    factors.push({ label: `${claims} prior claim${claims > 1 ? "s" : ""}`, effect: "raises" });
  } else {
    factors.push({ label: "no prior claims", effect: "lowers" });
  }
  if (input.hasRoommates) annual *= 1.08;

  const recommended: string[] = [
    `$${Math.round(contents / 1000)}k contents on replacement cost`,
    `$${(liability / 1_000_000).toFixed(0)}M personal liability`,
    `$${deductible} deductible`,
  ];
  if (dwelling === "basement" || dwelling === "house") recommended.push("add water/sewer backup coverage");

  return {
    product: "tenant",
    currency: "CAD",
    ...band(annual),
    recommended,
    factors: dedupeFactors(factors),
    assumptions,
    disclaimer: DISCLAIMER,
  };
}

function assume<T>(list: string[], phrase: string, value: T): T {
  list.push(phrase);
  return value;
}
function dedupeFactors(f: QuoteFactor[]): QuoteFactor[] {
  const seen = new Set<string>();
  return f.filter((x) => (seen.has(x.label) ? false : (seen.add(x.label), true))).slice(0, 5);
}
