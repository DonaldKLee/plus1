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
  /** Wettest single day in the last full calendar year, mm. */
  maxDailyPrecipMm: number | null;
  /** Strongest gust in the last full calendar year, km/h. */
  maxGustKmh: number | null;
  /** Which sources actually answered. */
  sources: string[];
}

export const DECLARATIONS_ELEVATED = 6;
export const DECLARATIONS_SEVERE = 12;
export const NFIP_CLAIMS_ELEVATED = 25;
export const NFIP_CLAIMS_SEVERE = 200;
export const GUST_SEVERE_KMH = 120; // ~ hurricane-force gusts recorded
export const PRECIP_SEVERE_MM = 150; // a single-day deluge

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
  const rule = `Last year's extremes: gusts ≥${GUST_SEVERE_KMH} km/h or a ≥${PRECIP_SEVERE_MM} mm day = severe (no credit, flag); otherwise Acceptable`;
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
    scoreDeclarations(e.declarationsSince2015, e.declarationTypes),
    scoreNfipClaims(e.nfipClaims),
    scoreWeatherExtremes(e.maxGustKmh, e.maxDailyPrecipMm),
  ];
}

/** One plain-English sentence on what the outside data says. */
export function describeEnrichment(e: HazardEnrichment): string {
  const where = [e.county ? `${e.county} County` : null, e.state].filter(Boolean).join(", ") || e.zip || "the primary location";
  const parts: string[] = [];
  if (e.declarationsSince2015 != null) {
    const top = Object.entries(e.declarationTypes).sort((a, b) => b[1] - a[1])[0];
    parts.push(`${e.declarationsSince2015} FEMA declarations since 2015${top ? `, mostly ${top[0].toLowerCase()}` : ""}`);
  }
  if (e.nfipClaims != null) parts.push(`${e.nfipClaims} NFIP flood claims in zip ${e.zip}`);
  if (e.maxGustKmh != null) parts.push(`gusts to ${Math.round(e.maxGustKmh)} km/h last year`);
  if (parts.length === 0) return `no external risk data came back for ${where}.`;
  return `${where}: ${parts.join("; ")}.`;
}
