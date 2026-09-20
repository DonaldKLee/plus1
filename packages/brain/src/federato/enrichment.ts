/**
 * External risk enrichment, scored as appetite factors. Pure: the backend fetches the data
 * (OpenFEMA disaster declarations, NFIP flood claims, Open-Meteo weather extremes) and hands
 * the numbers here. Thresholds are deliberately simple and stated in every `rule` so an
 * underwriter can see exactly how outside data moved the score.
 */
import type { FactorScore } from "@plus1/protocol";

export interface HazardEnrichment {
  zip: string | null;
  county: string | null;
  state: string | null;
  /** FEMA major disaster / emergency declarations naming this county since 2015. null = lookup failed. */
  declarationsSince2015: number | null;
  /** Declarations by incident type, e.g. { Hurricane: 9, Flood: 2 }. */
  declarationTypes: Record<string, number>;
  /** NFIP flood-insurance claims ever filed in this zip. null = lookup failed. */
  nfipClaims: number | null;
  /** Wettest single day in the weather window (last 5 full years), mm. */
  maxDailyPrecipMm: number | null;
  /** Strongest gust in the weather window, km/h. */
  maxGustKmh: number | null;
  /** Days above 35 °C in the window (heat / wildfire-season proxy). */
  hotDays: number | null;
  /** USGS: M4.5+ earthquakes within 150 km since 2000. null = lookup failed. */
  quakesSince2000: number | null;
  /** FEMA National Risk Index for the county: composite rating + per-peril ratings. */
  nri: {
    riskScore: number | null;
    riskRating: string | null; // Very Low … Very High
    expectedAnnualLossRating: string | null;
    perils: Record<string, string>; // coastal_flood, earthquake, hurricane, tornado, wildfire → rating
  } | null;
  /** Reverse-geocoded county/state for the coordinates, to check the broker's file. */
  geocode: { county: string | null; state: string | null; matchesFile: boolean | null } | null;
  /** Which sources actually answered. */
  sources: string[];
}

export const DECLARATIONS_ELEVATED = 6;
export const DECLARATIONS_SEVERE = 12;
export const NFIP_CLAIMS_ELEVATED = 25;
export const NFIP_CLAIMS_SEVERE = 200;
export const GUST_SEVERE_KMH = 120; // ~ hurricane-force gusts recorded
export const PRECIP_SEVERE_MM = 150; // a single-day deluge
export const QUAKES_ELEVATED = 3;
export const QUAKES_SEVERE = 10;

const NRI_ORDER = ["very low", "relatively low", "relatively moderate", "relatively high", "very high"];
const nriIndex = (r: string | null | undefined) => (r ? NRI_ORDER.indexOf(r.toLowerCase()) : -1);

export function scoreQuakes(n: number | null): FactorScore {
  const rule = `USGS M4.5+ quakes within 150 km since 2000: <${QUAKES_ELEVATED} Acceptable; ${QUAKES_ELEVATED}–${QUAKES_SEVERE - 1} elevated (no credit); ≥${QUAKES_SEVERE} Not Acceptable`;
  if (n == null) return { factor: "usgs_earthquakes", tier: "missing", value: "lookup failed", rule, points: 0 };
  const value = `${n} since 2000`;
  if (n >= QUAKES_SEVERE) return { factor: "usgs_earthquakes", tier: "not_acceptable", value, rule, points: -3 };
  if (n >= QUAKES_ELEVATED) return { factor: "usgs_earthquakes", tier: "acceptable", value: `${value}; elevated`, rule, points: 0 };
  return { factor: "usgs_earthquakes", tier: "acceptable", value, rule, points: 1 };
}

/** FEMA National Risk Index composite rating for the county. */
export function scoreNri(nri: HazardEnrichment["nri"]): FactorScore {
  const rule = "FEMA National Risk Index (county): Very Low / Relatively Low = Target; Relatively Moderate = Acceptable; Relatively High = elevated (no credit); Very High = Not Acceptable";
  if (!nri || !nri.riskRating) return { factor: "fema_national_risk_index", tier: "missing", value: "lookup failed", rule, points: 0 };
  const worst = Object.entries(nri.perils).sort((a, b) => nriIndex(b[1]) - nriIndex(a[1]))[0];
  const value = `${nri.riskRating}${nri.riskScore != null ? ` (${Math.round(nri.riskScore)}/100)` : ""}${worst ? `; worst peril ${worst[0].replace(/_/g, " ")}: ${worst[1]}` : ""}`;
  const i = nriIndex(nri.riskRating);
  if (i >= 4) return { factor: "fema_national_risk_index", tier: "not_acceptable", value, rule, points: -3 };
  if (i === 3) return { factor: "fema_national_risk_index", tier: "acceptable", value: `${value}; elevated`, rule, points: 0 };
  if (i === 2) return { factor: "fema_national_risk_index", tier: "acceptable", value, rule, points: 1 };
  return { factor: "fema_national_risk_index", tier: "target", value, rule, points: 2 };
}

/** Does the broker's county/state agree with where the coordinates actually fall? */
export function scoreGeocode(g: HazardEnrichment["geocode"]): FactorScore {
  const rule = "Coordinates reverse-geocoded (OpenStreetMap) must land in the county/state on the file; a mismatch is a data-quality flag (no credit)";
  if (!g) return { factor: "location_consistency", tier: "missing", value: "lookup failed", rule, points: 0 };
  if (g.matchesFile === false) return { factor: "location_consistency", tier: "acceptable", value: `coordinates resolve to ${g.county ?? "?"}, ${g.state ?? "?"} — differs from the file; verify address`, rule, points: 0 };
  return { factor: "location_consistency", tier: "acceptable", value: `coordinates confirm ${g.county ?? "the county"}, ${g.state ?? ""}`.trim(), rule, points: 1 };
}

export function scoreDeclarations(n: number | null, types: Record<string, number>): FactorScore {
  const rule = `FEMA declarations for the county since 2015: <${DECLARATIONS_ELEVATED} Acceptable; ${DECLARATIONS_ELEVATED}–${DECLARATIONS_SEVERE - 1} elevated (no credit); ≥${DECLARATIONS_SEVERE} Not Acceptable`;
  if (n == null) return { factor: "fema_declarations", tier: "missing", value: "lookup failed", rule, points: 0 };
  const top = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ×${v}`).join(", ");
  const value = `${n} since 2015${top ? ` (${top})` : ""}`;
  if (n >= DECLARATIONS_SEVERE) return { factor: "fema_declarations", tier: "not_acceptable", value, rule, points: -3 };
  if (n >= DECLARATIONS_ELEVATED) return { factor: "fema_declarations", tier: "acceptable", value: `${value}; elevated`, rule, points: 0 };
  return { factor: "fema_declarations", tier: "acceptable", value, rule, points: 1 };
}

export function scoreNfipClaims(n: number | null): FactorScore {
  const rule = `NFIP flood claims in the zip: <${NFIP_CLAIMS_ELEVATED} Acceptable; ${NFIP_CLAIMS_ELEVATED}–${NFIP_CLAIMS_SEVERE - 1} elevated (no credit); ≥${NFIP_CLAIMS_SEVERE} Not Acceptable`;
  if (n == null) return { factor: "nfip_flood_claims", tier: "missing", value: "lookup failed", rule, points: 0 };
  const value = `${n} claims`;
  if (n >= NFIP_CLAIMS_SEVERE) return { factor: "nfip_flood_claims", tier: "not_acceptable", value, rule, points: -3 };
  if (n >= NFIP_CLAIMS_ELEVATED) return { factor: "nfip_flood_claims", tier: "acceptable", value: `${value}; elevated`, rule, points: 0 };
  return { factor: "nfip_flood_claims", tier: "acceptable", value, rule, points: 1 };
}

export function scoreWeatherExtremes(maxGustKmh: number | null, maxDailyPrecipMm: number | null): FactorScore {
  const rule = `5-year weather extremes (Open-Meteo): gusts ≥${GUST_SEVERE_KMH} km/h or a ≥${PRECIP_SEVERE_MM} mm day = severe (no credit, flag); otherwise Acceptable`;
  if (maxGustKmh == null && maxDailyPrecipMm == null) {
    return { factor: "weather_extremes", tier: "missing", value: "lookup failed", rule, points: 0 };
  }
  const bits: string[] = [];
  if (maxGustKmh != null) bits.push(`gust ${Math.round(maxGustKmh)} km/h`);
  if (maxDailyPrecipMm != null) bits.push(`wettest day ${Math.round(maxDailyPrecipMm)} mm`);
  const severe = (maxGustKmh ?? 0) >= GUST_SEVERE_KMH || (maxDailyPrecipMm ?? 0) >= PRECIP_SEVERE_MM;
  return {
    factor: "weather_extremes",
    tier: "acceptable",
    value: `${bits.join(", ")}${severe ? "; severe" : ""}`,
    rule,
    points: severe ? 0 : 1,
  };
}

/** All enrichment factors for one location. Missing sources score 0 and say so. */
export function scoreEnrichment(e: HazardEnrichment): FactorScore[] {
  return [
    scoreNri(e.nri),
    scoreDeclarations(e.declarationsSince2015, e.declarationTypes),
    scoreNfipClaims(e.nfipClaims),
    scoreQuakes(e.quakesSince2000),
    scoreWeatherExtremes(e.maxGustKmh, e.maxDailyPrecipMm),
    scoreGeocode(e.geocode),
  ];
}

/** An empty enrichment record: every source unanswered. */
export function emptyEnrichment(loc: { zip?: string | null; county?: string | null; state?: string | null }): HazardEnrichment {
  return {
    zip: loc.zip ?? null, county: loc.county ?? null, state: loc.state ?? null,
    declarationsSince2015: null, declarationTypes: {}, nfipClaims: null,
    maxDailyPrecipMm: null, maxGustKmh: null, hotDays: null, quakesSince2000: null, nri: null, geocode: null, sources: [],
  };
}

/** One plain-English sentence on what the outside data says. */
export function describeEnrichment(e: HazardEnrichment): string {
  const where = [e.county ? `${e.county} County` : null, e.state].filter(Boolean).join(", ") || e.zip || "the primary location";
  const parts: string[] = [];
  if (e.declarationsSince2015 != null) {
    const top = Object.entries(e.declarationTypes).sort((a, b) => b[1] - a[1])[0];
    parts.push(`${e.declarationsSince2015} FEMA declarations since 2015${top ? `, mostly ${top[0].toLowerCase()}` : ""}`);
  }
  if (e.nri?.riskRating) parts.push(`FEMA National Risk Index ${e.nri.riskRating.toLowerCase()}`);
  if (e.nfipClaims != null) parts.push(`${e.nfipClaims} NFIP flood claims in zip ${e.zip}`);
  if (e.quakesSince2000 != null) parts.push(`${e.quakesSince2000} M4.5+ quakes within 150 km since 2000`);
  if (e.maxGustKmh != null) parts.push(`gusts to ${Math.round(e.maxGustKmh)} km/h in the last five years`);
  if (e.geocode?.matchesFile === false) parts.push(`coordinates actually fall in ${e.geocode.county ?? "another county"}`);
  if (parts.length === 0) return `no external risk data came back for ${where}.`;
  return `${where}: ${parts.join("; ")}.`;
}
