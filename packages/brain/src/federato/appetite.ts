/**
 * Official 2025 Commercial Property appetite guidelines (Federato HTN sample).
 * Pure rules — no network. Scores Target / Acceptable / Not Acceptable.
 */

import type {
  AppetiteTier,
  FactorScore,
  UnderwriteDecision,
} from "@plus1/protocol";

export const TARGET_STATES = ["OH", "PA", "MD", "CO", "CA", "FL"] as const;
export const ACCEPTABLE_STATES = [
  "OH",
  "PA",
  "MD",
  "CO",
  "CA",
  "FL",
  "NC",
  "SC",
  "GA",
  "VA",
  "UT",
] as const;

/** Construction types that count toward the >50% acceptable share. */
export const ACCEPTABLE_CONSTRUCTION = new Set([
  "joisted masonry",
  "jm",
  "non-combustible",
  "noncombustible",
  "masonry non-combustible",
  "masonry noncombustible",
  "steel frame",
  "steel",
  "fire resistive",
  "fire-resistive",
  "modified fire resistive",
  "modified fire-resistive",
]);

export interface BuildingInput {
  tiv: number;
  yearBuilt: number | null;
  constructionType: string | null;
}

export interface LocationInput {
  state: string | null;
  tiv: number;
  hazardTags?: string[];
  address?: string;
  city?: string;
  zip?: string;
  latitude?: number | null;
  longitude?: number | null;
  buildings: BuildingInput[];
}

export interface PolicyScoreInput {
  accountName: string;
  lineOfBusiness: string | null;
  businessType: string | null; // new | renewal
  premium: number | null;
  locations: LocationInput[];
  /** Total loss dollars (paid + reserve indemnity/expense). */
  lossTotal: number | null;
}

function tierPoints(tier: AppetiteTier): number {
  switch (tier) {
    case "target":
      return 2;
    case "acceptable":
      return 1;
    case "missing":
      return 0;
    case "not_acceptable":
      return -3;
  }
}

function normalizeConstruction(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

function isAcceptableConstruction(raw: string | null | undefined): boolean {
  const n = normalizeConstruction(raw);
  if (!n) return false;
  if (ACCEPTABLE_CONSTRUCTION.has(n)) return true;
  // fuzzy: "Non-Combustible", "Joisted Masonry", etc.
  if (n.includes("joisted") && n.includes("masonry")) return true;
  if (n.includes("non-combustible") || n.includes("noncombustible")) return true;
  if (n.includes("steel")) return true;
  if (n.includes("fire resistive") || n.includes("fire-resistive")) return true;
  return false;
}

function primaryStateByTiv(locations: LocationInput[]): string | null {
  if (locations.length === 0) return null;
  const byState = new Map<string, number>();
  for (const loc of locations) {
    const st = (loc.state ?? "").toUpperCase();
    if (!st) continue;
    byState.set(st, (byState.get(st) ?? 0) + (loc.tiv || 0));
  }
  let best: string | null = null;
  let bestTiv = -1;
  for (const [st, tiv] of byState) {
    if (tiv > bestTiv) {
      best = st;
      bestTiv = tiv;
    }
  }
  return best;
}

function totalTiv(locations: LocationInput[]): number {
  return locations.reduce((s, l) => s + (l.tiv || 0), 0);
}

function allBuildings(locations: LocationInput[]): BuildingInput[] {
  return locations.flatMap((l) => l.buildings);
}

export function scoreBusinessType(businessType: string | null): FactorScore {
  const v = (businessType ?? "").toLowerCase();
  if (!v) {
    return {
      factor: "submission_type",
      tier: "missing",
      value: "unknown",
      rule: "New = Acceptable; Renewal = Target",
      points: 0,
    };
  }
  if (v === "renewal") {
    return {
      factor: "submission_type",
      tier: "target",
      value: v,
      rule: "Renewal is Target",
      points: 2,
    };
  }
  if (v === "new") {
    return {
      factor: "submission_type",
      tier: "acceptable",
      value: v,
      rule: "New business is Acceptable",
      points: 1,
    };
  }
  return {
    factor: "submission_type",
    tier: "not_acceptable",
    value: v,
    rule: "Only new / renewal recognized",
    points: -3,
  };
}

export function scoreLineOfBusiness(lob: string | null): FactorScore {
  const v = (lob ?? "").toLowerCase();
  if (!v) {
    return {
      factor: "line_of_business",
      tier: "missing",
      value: "unknown",
      rule: "Property only",
      points: 0,
    };
  }
  if (v === "property") {
    return {
      factor: "line_of_business",
      tier: "acceptable",
      value: v,
      rule: "Property is Acceptable; all other lines Not Acceptable",
      points: 1,
    };
  }
  return {
    factor: "line_of_business",
    tier: "not_acceptable",
    value: v,
    rule: "Property only — all other lines Not Acceptable",
    points: -3,
  };
}

export function scorePrimaryState(state: string | null): FactorScore {
  if (!state) {
    return {
      factor: "primary_risk_state",
      tier: "missing",
      value: "unknown",
      rule: "Acceptable: OH PA MD CO CA FL NC SC GA VA UT; Target: OH PA MD CO CA FL",
      points: 0,
    };
  }
  const st = state.toUpperCase();
  if ((TARGET_STATES as readonly string[]).includes(st)) {
    return {
      factor: "primary_risk_state",
      tier: "target",
      value: st,
      rule: "Target states: OH, PA, MD, CO, CA, FL",
      points: 2,
    };
  }
  if ((ACCEPTABLE_STATES as readonly string[]).includes(st)) {
    return {
      factor: "primary_risk_state",
      tier: "acceptable",
      value: st,
      rule: "Acceptable states include NC, SC, GA, VA, UT",
      points: 1,
    };
  }
  return {
    factor: "primary_risk_state",
    tier: "not_acceptable",
    value: st,
    rule: "State outside appetite list",
    points: -3,
  };
}

export function scoreTiv(tiv: number | null): FactorScore {
  if (tiv == null || Number.isNaN(tiv)) {
    return {
      factor: "tiv",
      tier: "missing",
      value: "unknown",
      rule: "Up to $150M Acceptable; $50–100M Target; over $150M Not Acceptable",
      points: 0,
    };
  }
  const label = `$${(tiv / 1e6).toFixed(1)}M`;
  if (tiv > 150_000_000) {
    return {
      factor: "tiv",
      tier: "not_acceptable",
      value: label,
      rule: "Over $150M Not Acceptable",
      points: -3,
    };
  }
  if (tiv >= 50_000_000 && tiv <= 100_000_000) {
    return {
      factor: "tiv",
      tier: "target",
      value: label,
      rule: "$50M–$100M Target",
      points: 2,
    };
  }
  return {
    factor: "tiv",
    tier: "acceptable",
    value: label,
    rule: "Up to $150M Acceptable",
    points: 1,
  };
}

export function scorePremium(premium: number | null): FactorScore {
  if (premium == null || Number.isNaN(premium)) {
    return {
      factor: "total_premium",
      tier: "missing",
      value: "unknown",
      rule: "$50K–$175K Acceptable; $75K–$100K Target; else Not Acceptable",
      points: 0,
    };
  }
  const label = `$${Math.round(premium).toLocaleString()}`;
  if (premium < 50_000 || premium > 175_000) {
    return {
      factor: "total_premium",
      tier: "not_acceptable",
      value: label,
      rule: "Under $50K or over $175K Not Acceptable",
      points: -3,
    };
  }
  if (premium >= 75_000 && premium <= 100_000) {
    return {
      factor: "total_premium",
      tier: "target",
      value: label,
      rule: "$75K–$100K Target",
      points: 2,
    };
  }
  return {
    factor: "total_premium",
    tier: "acceptable",
    value: label,
    rule: "$50K–$175K Acceptable",
    points: 1,
  };
}

export function scoreBuildingAge(buildings: BuildingInput[]): FactorScore {
  if (buildings.length === 0) {
    return {
      factor: "building_age",
      tier: "missing",
      value: "no buildings",
      rule: "Newer than 1990 Acceptable; newer than 2010 Target; older Not Acceptable",
      points: 0,
    };
  }
  const total = buildings.reduce((s, b) => s + (b.tiv || 0), 0) || buildings.length;
  let post2010 = 0;
  let post1990 = 0;
  let oldest: number | null = null;
  for (const b of buildings) {
    const y = b.yearBuilt;
    const w = b.tiv || total / buildings.length;
    if (y == null) continue;
    if (oldest == null || y < oldest) oldest = y;
    if (y > 2010) post2010 += w;
    if (y > 1990) post1990 += w;
  }
  const share2010 = post2010 / total;
  const share1990 = post1990 / total;
  const value = `oldest ${oldest ?? "?"}; ${(share2010 * 100).toFixed(0)}% TIV >2010`;

  if (share1990 < 0.5) {
    return {
      factor: "building_age",
      tier: "not_acceptable",
      value,
      rule: "Majority TIV older than 1990 Not Acceptable",
      points: -3,
    };
  }
  if (share2010 >= 0.5) {
    return {
      factor: "building_age",
      tier: "target",
      value,
      rule: "Majority TIV newer than 2010 Target",
      points: 2,
    };
  }
  return {
    factor: "building_age",
    tier: "acceptable",
    value,
    rule: "Majority TIV newer than 1990 Acceptable",
    points: 1,
  };
}

export function scoreConstruction(buildings: BuildingInput[]): FactorScore {
  if (buildings.length === 0) {
    return {
      factor: "construction_type",
      tier: "missing",
      value: "no buildings",
      rule: ">50% JM / non-combustible / steel / masonry NC Acceptable",
      points: 0,
    };
  }
  const total = buildings.reduce((s, b) => s + (b.tiv || 0), 0) || buildings.length;
  let ok = 0;
  const types = new Map<string, number>();
  for (const b of buildings) {
    const w = b.tiv || total / buildings.length;
    const key = b.constructionType ?? "unknown";
    types.set(key, (types.get(key) ?? 0) + w);
    if (isAcceptableConstruction(b.constructionType)) ok += w;
  }
  const share = ok / total;
  const top = [...types.entries()].sort((a, b) => b[1] - a[1])[0];
  const value = `${(share * 100).toFixed(0)}% acceptable construction; top=${top?.[0] ?? "?"}`;

  if (share > 0.5) {
    return {
      factor: "construction_type",
      tier: "acceptable",
      value,
      rule: ">50% JM / non-combustible / steel / masonry NC",
      points: 1,
    };
  }
  return {
    factor: "construction_type",
    tier: "not_acceptable",
    value,
    rule: "≤50% acceptable construction types Not Acceptable",
    points: -3,
  };
}

export function scoreLossValue(lossTotal: number | null): FactorScore {
  if (lossTotal == null || Number.isNaN(lossTotal)) {
    return {
      factor: "loss_value",
      tier: "missing",
      value: "unknown",
      rule: "Under $100,000 Acceptable; over Not Acceptable",
      points: 0,
    };
  }
  const label = `$${Math.round(lossTotal).toLocaleString()}`;
  if (lossTotal > 100_000) {
    return {
      factor: "loss_value",
      tier: "not_acceptable",
      value: label,
      rule: "Over $100,000 Not Acceptable",
      points: -3,
    };
  }
  return {
    factor: "loss_value",
    tier: "acceptable",
    value: label,
    rule: "Under $100,000 Acceptable",
    points: 1,
  };
}

export interface AppetiteResult {
  factors: FactorScore[];
  score: number;
  maxScore: number;
  decision: UnderwriteDecision;
  explanation: string;
  primaryState: string | null;
  tiv: number;
}

export function scorePolicyAppetite(input: PolicyScoreInput): AppetiteResult {
  const primaryState = primaryStateByTiv(input.locations);
  const tiv = totalTiv(input.locations);
  const buildings = allBuildings(input.locations);

  // Multi-state: if any material TIV is out-of-appetite state, flag via primary
  // but also note secondary out-of-appetite states in construction of explanation.
  const factors: FactorScore[] = [
    scoreBusinessType(input.businessType),
    scoreLineOfBusiness(input.lineOfBusiness),
    scorePrimaryState(primaryState),
    scoreTiv(tiv || null),
    scorePremium(input.premium),
    scoreBuildingAge(buildings),
    scoreConstruction(buildings),
    scoreLossValue(input.lossTotal),
  ];

  // Extra hard fail if any location state (with TIV) is fully out of appetite
  const outStates = [
    ...new Set(
      input.locations
        .filter((l) => (l.tiv || 0) > 0 && l.state)
        .map((l) => l.state!.toUpperCase())
        .filter((st) => !(ACCEPTABLE_STATES as readonly string[]).includes(st)),
    ),
  ];
  if (outStates.length > 0) {
    factors.push({
      factor: "multi_state_exposure",
      tier: "not_acceptable",
      value: outStates.join(", "),
      rule: "All material location states must be on appetite list",
      points: -3,
    });
  }

  const score = factors.reduce((s, f) => s + f.points, 0);
  const maxScore = factors.length * 2;
  const hardFails = factors.filter((f) => f.tier === "not_acceptable");
  const targets = factors.filter((f) => f.tier === "target");
  const missing = factors.filter((f) => f.tier === "missing");

  let decision: UnderwriteDecision;
  if (missing.length >= 3 && hardFails.length === 0) {
    decision = "investigate";
  } else if (hardFails.length >= 2) {
    decision = "decline";
  } else if (hardFails.length === 1) {
    decision = targets.length >= 2 ? "refer" : "decline";
  } else if (targets.length >= 3) {
    decision = "quote";
  } else {
    decision = "refer";
  }

  const failBits = hardFails.map((f) => `${f.factor}=${f.value}`).join("; ");
  const goodBits = targets.map((f) => `${f.factor}=${f.value}`).join("; ");
  const explanation =
    decision === "quote"
      ? `${input.accountName}: SCORE ${score}/${maxScore}. Strong appetite fit (${goodBits || "mostly acceptable"}). Recommendation: Review for acceptance.`
      : decision === "refer"
        ? `${input.accountName}: SCORE ${score}/${maxScore}. Mixed fit${failBits ? ` — watch: ${failBits}` : ""}. Recommendation: Refer to senior UW.`
        : decision === "investigate"
          ? `${input.accountName}: SCORE ${score}/${maxScore}. Missing required data. Recommendation: Investigate further.`
          : `${input.accountName}: SCORE ${score}/${maxScore}. Out of appetite (${failBits || "multiple factors"}). Recommendation: Decline.`;

  return {
    factors,
    score,
    maxScore,
    decision,
    explanation,
    primaryState,
    tiv,
  };
}
