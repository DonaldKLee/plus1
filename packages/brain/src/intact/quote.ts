/**
 * Intact-style quoting engine for car + tenant insurance. Pure and deterministic
 * (no network — belongs in the brain), so it can be tested and reasoned about.
 *
 * Pricing is SYNTHETIC but calibrated to public data: the base is the province's
 * published average premium, adjusted by directional rate-filing factors. Every
 * quote is an estimate, never a binding Intact quote, and every default is
 * reported back as an assumption. See INTACT_MCP_LLD.md §5.
 */

export type Product = "car" | "tenant";
export type Province =
  | "ON" | "QC" | "BC" | "AB" | "SK" | "MB"
  | "NB" | "NS" | "NL" | "PE" | "YT" | "NT" | "NU";
export type CarCoverage = "basic" | "standard" | "full";
export type Appetite = "standard" | "high_risk" | "refer";

export interface AccidentHistory {
  atFault: number;
  notAtFault: number;
  lastAtFaultYearsAgo?: number;
}

export interface CarQuoteInput {
  driverAge?: number;
  yearsLicensed?: number;
  accidents?: AccidentHistory;
  minorConvictions?: number;
  majorConvictions?: number; // DUI / careless → high-risk
  accidentForgiveness?: boolean;
  province?: string;
  city?: string;
  postal?: string; // FSA, e.g. "M5V"
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleValue?: number; // CAD
  annualKm?: number;
  usage?: "commute" | "pleasure" | "business";
  coverage?: CarCoverage;
  deductible?: number; // 250 / 500 / 1000
  bundleHome?: boolean;
  winterTires?: boolean;
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
  bundleAuto?: boolean;
}

export interface QuoteFactor {
  label: string;
  effect: "raises" | "lowers" | "neutral";
}

export interface PaymentPlan {
  annual: number;
  monthly: number;
  instalmentFeePct: number;
  methods: string[];
}

export interface QuoteResult {
  product: Product;
  currency: "CAD";
  appetite: Appetite;
  monthlyLow: number;
  monthlyHigh: number;
  annualLow: number;
  annualHigh: number;
  payment: PaymentPlan;
  coverageTier: string;
  recommended: string[];
  factors: QuoteFactor[];
  assumptions: string[];
  handoffReason?: string;
  disclaimer: string;
}

const DISCLAIMER =
  "Estimate only — a synthetic quote calibrated to public averages, not a binding Intact quote. Final pricing depends on a full application and underwriting (incl. an Autoplus/MVR check).";

const PAYMENT_METHODS = ["pre-authorized debit", "Visa / Mastercard", "cheque"];
const INSTALMENT_FEE_PCT = 0.03;

/** Province average annual premium, single adult / one vehicle, standard coverage (CAD). */
const PROVINCE_BASE: Record<string, number> = {
  ON: 2068, QC: 1044, BC: 1800, AB: 1800, SK: 1400, MB: 1200,
  NB: 1200, NS: 1150, NL: 1250, PE: 1000, YT: 1000, NT: 1000, NU: 1000,
};
const NATIONAL_BASE = 1800;

/** Tenant base, single adult, $30k contents, apartment, standard (CAD/yr). ~$18/mo. */
const TENANT_PROVINCE_BASE: Record<string, number> = {
  ON: 216, QC: 168, BC: 240, AB: 228, SK: 192, MB: 180,
  NB: 180, NS: 180, NL: 192, PE: 168, YT: 180, NT: 180, NU: 180,
};
const TENANT_NATIONAL_BASE = 210;

function round(n: number, to = 1): number {
  return Math.round(n / to) * to;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function prov(p?: string): string {
  return (p ?? "ON").toUpperCase();
}
function band(mid: number): Pick<QuoteResult, "annualLow" | "annualHigh" | "monthlyLow" | "monthlyHigh"> {
  const low = mid * 0.9;
  const high = mid * 1.12;
  return {
    annualLow: round(low, 10),
    annualHigh: round(high, 10),
    monthlyLow: round(low / 12),
    monthlyHigh: round(high / 12),
  };
}
function paymentPlan(mid: number): PaymentPlan {
  return {
    annual: round(mid, 10),
    monthly: round((mid * (1 + INSTALMENT_FEE_PCT)) / 12),
    instalmentFeePct: INSTALMENT_FEE_PCT,
    methods: PAYMENT_METHODS,
  };
}
/** How much an at-fault accident still bites, by recency. */
function recencyWeight(yearsAgo?: number): number {
  const y = yearsAgo ?? 1; // unspecified → treat as recent
  if (y <= 3) return 1.0;
  if (y <= 6) return 0.5;
  return 0.15;
}
/** Urban territories run a little hotter than the provincial average. */
function territoryFactor(postal?: string): number {
  const fsa = (postal ?? "").toUpperCase().replace(/\s/g, "");
  if (!fsa) return 1.0;
  if (fsa.startsWith("M")) return 1.1; // Toronto
  if (fsa.startsWith("V6") || fsa.startsWith("V5")) return 1.08; // Vancouver
  if (fsa.startsWith("T2") || fsa.startsWith("T3")) return 1.06; // Calgary
  return 1.0;
}

export function quoteCar(input: CarQuoteInput): QuoteResult {
  const assumptions: string[] = [];
  const factors: QuoteFactor[] = [];

  const age = input.driverAge ?? assume(assumptions, "driver age 35", 35);
  const yearsLicensed = input.yearsLicensed ?? assume(assumptions, "10+ years licensed", 12);
  const acc: AccidentHistory =
    input.accidents ?? assume(assumptions, "a clean record (no accidents)", { atFault: 0, notAtFault: 0 });
  const minorConv = input.minorConvictions ?? 0;
  const majorConv = input.majorConvictions ?? 0;
  const province = prov(input.province ?? assume(assumptions, "Ontario", "ON"));
  const value = input.vehicleValue ?? assume(assumptions, "a ~$22,000 vehicle", 22000);
  const annualKm = input.annualKm ?? assume(assumptions, "~15,000 km/year", 15000);
  const usage = input.usage ?? assume(assumptions, "commuting use", "commute" as const);
  const coverage = input.coverage ?? assume(assumptions, "standard coverage (collision + comprehensive)", "standard" as const);
  const deductible = input.deductible ?? assume(assumptions, "a $500 deductible", 500);

  let annual = PROVINCE_BASE[province] ?? NATIONAL_BASE;

  const ageF = age < 20 ? 1.9 : age < 25 ? 1.5 : age < 30 ? 1.15 : age < 65 ? 1.0 : 1.12;
  annual *= ageF;
  factors.push({ label: `driver age ${age}`, effect: ageF > 1.05 ? "raises" : "neutral" });

  const expF = yearsLicensed < 3 ? 1.25 : yearsLicensed < 10 ? 1.05 : 0.95;
  annual *= expF;
  if (yearsLicensed < 3) factors.push({ label: "newly licensed", effect: "raises" });

  // ── record: at-fault (recency-decayed, forgiveness-aware) vs not-at-fault (no impact) ──
  const effectiveAtFault = Math.max(0, acc.atFault - (input.accidentForgiveness ? 1 : 0));
  const w = recencyWeight(acc.lastAtFaultYearsAgo);
  for (let i = 0; i < effectiveAtFault; i++) annual *= 1 + (i === 0 ? 0.25 : 0.2) * w;
  if (acc.atFault > 0) {
    const when = acc.lastAtFaultYearsAgo != null ? ` (${acc.lastAtFaultYearsAgo}y ago)` : "";
    const forgiven = input.accidentForgiveness && acc.atFault >= 1 ? " · first forgiven" : "";
    factors.push({ label: `${acc.atFault} at-fault${when}${forgiven}`, effect: effectiveAtFault > 0 ? "raises" : "neutral" });
  } else {
    factors.push({ label: "clean claims record", effect: "lowers" });
  }
  if (acc.notAtFault > 0) {
    factors.push({ label: `${acc.notAtFault} not-at-fault (no impact)`, effect: "neutral" });
  }
  if (minorConv > 0) {
    annual *= 1 + 0.08 * minorConv;
    factors.push({ label: `${minorConv} minor conviction${minorConv > 1 ? "s" : ""}`, effect: "raises" });
  }

  const provAvg = PROVINCE_BASE[province] ?? NATIONAL_BASE;
  factors.push({ label: `${province} average base`, effect: provAvg > NATIONAL_BASE * 1.05 ? "raises" : provAvg < NATIONAL_BASE * 0.9 ? "lowers" : "neutral" });

  annual *= territoryFactor(input.postal);
  annual *= clamp(value / 22000, 0.8, 1.5); // vehicle value vs an average car
  const kmF = annualKm > 20000 ? 1.15 : annualKm < 10000 ? 0.9 : 1.0;
  annual *= kmF;
  if (annualKm > 20000) factors.push({ label: "high annual mileage", effect: "raises" });
  else if (annualKm < 10000) factors.push({ label: "low mileage", effect: "lowers" });

  annual *= usage === "business" ? 1.2 : usage === "commute" ? 1.05 : 0.95;
  annual *= coverage === "basic" ? 0.6 : coverage === "full" ? 1.25 : 1.0;
  annual *= deductible >= 1000 ? 0.9 : deductible <= 250 ? 1.1 : 1.0;
  if (input.bundleHome) { annual *= 0.85; factors.push({ label: "home+auto bundle", effect: "lowers" }); }
  if (input.winterTires) annual *= 0.97;

  // ── appetite: when NOT to hand a number over ──
  let appetite: Appetite = "standard";
  let handoffReason: string | undefined;
  const recentAtFault = acc.atFault > 0 && (acc.lastAtFaultYearsAgo ?? 1) <= 3;
  if (majorConv > 0) {
    appetite = "high_risk";
    handoffReason = "a major conviction (e.g. DUI/careless) puts this in the high-risk market — a broker handles those.";
  } else if (acc.atFault >= 2 && recentAtFault) {
    appetite = "high_risk";
    handoffReason = "two or more recent at-fault accidents fall outside standard appetite — a broker can place this in the high-risk market.";
  } else if (yearsLicensed < 1 && acc.atFault > 0) {
    appetite = "refer";
    handoffReason = "a brand-new licence with an at-fault claim needs a broker to place.";
  }

  const coverageTier =
    coverage === "basic" ? "Third-Party Liability + Accident Benefits"
    : coverage === "full" ? "Full (Liability + Collision + Comprehensive)"
    : "Standard (Liability + Collision + Comprehensive)";

  const recommended: string[] = ["$1M Third-Party Liability", "Accident Benefits"];
  if (value >= 10000 || (input.vehicleYear ?? 2018) >= new Date().getFullYear() - 8) {
    recommended.push("Collision + Comprehensive (worth it at this vehicle value)");
  } else {
    recommended.push("Comprehensive; Collision optional on an older car");
  }
  recommended.push(`$${deductible} deductible`);
  if (!input.accidentForgiveness && acc.atFault <= 1) recommended.push("Accident Forgiveness add-on");
  if (!input.bundleHome) recommended.push("Bundle with home/tenant to save ~15%");

  return {
    product: "car",
    currency: "CAD",
    appetite,
    ...band(annual),
    payment: paymentPlan(annual),
    coverageTier,
    recommended,
    factors: dedupeFactors(factors),
    assumptions,
    handoffReason,
    disclaimer: DISCLAIMER,
  };
}

export function quoteTenant(input: TenantQuoteInput): QuoteResult {
  const assumptions: string[] = [];
  const factors: QuoteFactor[] = [];

  const province = prov(input.province ?? assume(assumptions, "Ontario", "ON"));
  const dwelling = input.dwellingType ?? assume(assumptions, "an apartment", "apartment" as const);
  const contents = input.contentsValue ?? assume(assumptions, "~$30,000 of contents", 30000);
  const liability = input.liabilityLimit ?? assume(assumptions, "$1M liability", 1_000_000);
  const deductible = input.deductible ?? assume(assumptions, "a $500 deductible", 500);
  const claims = input.priorClaims ?? assume(assumptions, "no prior claims", 0);

  // Base is the province tenant average (@ $30k contents); scale with contents.
  const provBase = TENANT_PROVINCE_BASE[province] ?? TENANT_NATIONAL_BASE;
  let annual = provBase * clamp(0.55 + (contents / 30000) * 0.45, 0.6, 2.2);
  factors.push({ label: `$${Math.round(contents / 1000)}k contents`, effect: contents > 40000 ? "raises" : "neutral" });
  factors.push({ label: `${province} average base`, effect: "neutral" });

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
  if (input.bundleAuto) { annual *= 0.9; factors.push({ label: "auto+tenant bundle", effect: "lowers" }); }

  const recommended: string[] = [
    `$${Math.round(contents / 1000)}k contents on replacement cost`,
    `$${(liability / 1_000_000).toFixed(0)}M personal liability`,
    `$${deductible} deductible`,
  ];
  if (dwelling === "basement" || dwelling === "house") recommended.push("Add water/sewer backup coverage");
  if (!input.bundleAuto) recommended.push("Bundle with auto to save ~10%");

  return {
    product: "tenant",
    currency: "CAD",
    appetite: "standard",
    ...band(annual),
    payment: paymentPlan(annual),
    coverageTier: "Tenant / Contents + Personal Liability",
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
  return f.filter((x) => (seen.has(x.label) ? false : (seen.add(x.label), true))).slice(0, 6);
}
