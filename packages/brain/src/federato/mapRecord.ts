import type { PolicyScoreInput, LocationInput, BuildingInput } from "./appetite.js";

/** Sum paid + reserve indemnity and expense from Claim records. */
export function lossTotalFromClaims(claims: unknown): number {
  if (!Array.isArray(claims)) return 0;
  let total = 0;
  for (const c of claims) {
    if (!c || typeof c !== "object") continue;
    const cl = c as Record<string, unknown>;
    total += Number(cl.paid_indemnity ?? 0) || 0;
    total += Number(cl.paid_expense ?? 0) || 0;
    total += Number(cl.reserve_indemnity ?? 0) || 0;
    total += Number(cl.reserve_expense ?? 0) || 0;
  }
  return total;
}

function mapBuilding(b: Record<string, unknown>): BuildingInput {
  return {
    tiv: Number(b.tiv ?? 0) || 0,
    yearBuilt: b.year_built == null ? null : Number(b.year_built),
    constructionType: b.construction_type == null ? null : String(b.construction_type),
  };
}

function mapLocationFromExposure(eu: Record<string, unknown>): LocationInput | null {
  const loc = eu.location;
  if (!loc || typeof loc !== "object") {
    // Sometimes location is just an id
    return null;
  }
  const L = loc as Record<string, unknown>;
  const buildingsRaw = L.buildings;
  const buildings: BuildingInput[] = Array.isArray(buildingsRaw)
    ? buildingsRaw
        .filter((b) => b && typeof b === "object")
        .map((b) => mapBuilding(b as Record<string, unknown>))
    : [];

  const basis = Number(eu.basis_amount ?? 0) || 0;
  const buildingTiv = buildings.reduce((s, b) => s + b.tiv, 0);
  const tags = Array.isArray(L.hazard_tags) ? L.hazard_tags.map(String) : [];

  return {
    state: L.state == null ? null : String(L.state),
    tiv: basis || buildingTiv,
    hazardTags: tags,
    address: L.address == null ? undefined : String(L.address),
    city: L.city == null ? undefined : String(L.city),
    zip: L.zip == null ? undefined : String(L.zip),
    latitude: L.latitude == null ? null : Number(L.latitude),
    longitude: L.longitude == null ? null : Number(L.longitude),
    buildings,
  };
}

/**
 * Normalize an expanded Federato Policy JSON record into PolicyScoreInput.
 */
export function policyFromFederatoRecord(policy: Record<string, unknown>): PolicyScoreInput {
  const insured =
    policy.insured && typeof policy.insured === "object"
      ? (policy.insured as Record<string, unknown>)
      : null;

  const accountName =
    (insured?.name as string) ||
    (insured?.dba as string) ||
    (policy.policy_number as string) ||
    `Policy ${policy.id}`;

  const exposures = Array.isArray(policy.exposure_units) ? policy.exposure_units : [];
  const locations: LocationInput[] = [];
  for (const eu of exposures) {
    if (!eu || typeof eu !== "object") continue;
    const mapped = mapLocationFromExposure(eu as Record<string, unknown>);
    if (mapped) locations.push(mapped);
  }

  return {
    accountName,
    lineOfBusiness: policy.line_of_business == null ? null : String(policy.line_of_business),
    businessType: policy.business_type == null ? null : String(policy.business_type),
    premium: policy.premium == null ? null : Number(policy.premium),
    locations,
    lossTotal: lossTotalFromClaims(policy.claims),
  };
}
