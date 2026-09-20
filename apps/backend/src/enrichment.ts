/**
 * External risk enrichment for a Federato location — a wealth of free, keyless sources:
 *   - FEMA National Risk Index (ArcGIS): the county's composite risk rating and per-peril ratings.
 *   - OpenFEMA DisasterDeclarationsSummaries: federal disaster declarations for the county since 2015.
 *   - OpenFEMA NFIP claims (v2): flood-insurance claims ever filed in the zip.
 *   - USGS earthquake catalog: M4.5+ events within 150 km since 2000.
 *   - Open-Meteo archive: five years of daily extremes (gust, rain, heat) at the coordinates.
 *   - OpenStreetMap Nominatim reverse geocoding: do the coordinates really fall in the county on file?
 * Every location in the dataset has county + lat/lng, so all six apply.
 * Failures degrade to nulls (scored as "missing", never as a fail). Lookups are remembered per
 * location in the OS temp dir (disposable; nothing lands in the repo) so ranking the whole book
 * costs the network once.
 */
import fs from "node:fs";
import path from "node:path";
import { emptyEnrichment, type HazardEnrichment } from "@plus1/brain";
import { STATE_DIR, ensureDir } from "./env.js";

const OPENFEMA = "https://www.fema.gov/api/open";
const OPEN_METEO = "https://archive-api.open-meteo.com/v1/archive";
const USGS = "https://earthquake.usgs.gov/fdsnws/event/1/count";
const NRI = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query";
const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";
const UA = "plus1-underwriting-agent/0.1 (hackthenorth; contact: team)";
const WEATHER_YEARS = 5;
const TIMEOUT_MS = 9_000;
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

export interface LocationLike {
  id?: number | string | null;
  zip?: string | null;
  county?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface CacheEntry { at: number; data: HazardEnrichment }
let cache: Record<string, CacheEntry> | null = null;
const cachePath = () => path.join(STATE_DIR, "enrichment.json");

function loadCache(): Record<string, CacheEntry> {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as Record<string, CacheEntry>; }
  catch { cache = {}; }
  return cache;
}
function saveCache(): void {
  try { ensureDir(STATE_DIR); fs.writeFileSync(cachePath(), JSON.stringify(cache ?? {}, null, 1)); } catch { /* best effort */ }
}

function keyOf(loc: LocationLike): string {
  return `${loc.state ?? ""}|${loc.county ?? ""}|${loc.zip ?? ""}|${loc.latitude ?? ""},${loc.longitude ?? ""}`;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json", ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** FEMA declarations naming this county since 2015, grouped by incident type. */
async function femaDeclarations(state: string, county: string): Promise<{ count: number; types: Record<string, number> }> {
  const area = `${county.replace(/ County$/i, "")} (County)`;
  const filter = `state eq '${state}' and designatedArea eq '${area.replace(/'/g, "''")}' and declarationDate ge '2015-01-01'`;
  const url = `${OPENFEMA}/v2/DisasterDeclarationsSummaries?$filter=${encodeURIComponent(filter)}&$select=incidentType&$top=1000&$inlinecount=allpages`;
  const json = (await getJson(url)) as { metadata?: { count?: number }; DisasterDeclarationsSummaries?: { incidentType?: string }[] };
  const rows = json.DisasterDeclarationsSummaries ?? [];
  const types: Record<string, number> = {};
  for (const r of rows) { const k = r.incidentType ?? "Other"; types[k] = (types[k] ?? 0) + 1; }
  return { count: json.metadata?.count ?? rows.length, types };
}

/** NFIP flood claims ever filed in the zip (v2 dataset; v1/v3 differ, v2 answers today). */
async function nfipClaims(zip: string): Promise<number> {
  const url = `${OPENFEMA}/v2/FimaNfipClaims?$filter=${encodeURIComponent(`reportedZipCode eq '${zip}'`)}&$select=id&$top=1&$inlinecount=allpages`;
  const json = (await getJson(url)) as { metadata?: { count?: number } };
  if (typeof json.metadata?.count !== "number") throw new Error("no count in NFIP reply");
  return json.metadata.count;
}

/** Five full calendar years of daily extremes at the coordinates. */
async function weatherExtremes(lat: number, lng: number): Promise<{ maxDailyPrecipMm: number | null; maxGustKmh: number | null; hotDays: number | null }> {
  const end = new Date().getUTCFullYear() - 1;
  const start = end - WEATHER_YEARS + 1;
  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lng}&start_date=${start}-01-01&end_date=${end}-12-31&daily=precipitation_sum,wind_gusts_10m_max,temperature_2m_max&timezone=auto`;
  const json = (await getJson(url)) as { daily?: { precipitation_sum?: (number | null)[]; wind_gusts_10m_max?: (number | null)[]; temperature_2m_max?: (number | null)[] } };
  const nums = (xs?: (number | null)[]) => (xs ?? []).filter((x): x is number => typeof x === "number");
  const max = (xs?: (number | null)[]) => { const v = nums(xs); return v.length ? Math.max(...v) : null; };
  const hot = nums(json.daily?.temperature_2m_max);
  return { maxDailyPrecipMm: max(json.daily?.precipitation_sum), maxGustKmh: max(json.daily?.wind_gusts_10m_max), hotDays: hot.length ? hot.filter((t) => t > 35).length : null };
}

/** USGS: significant earthquakes near the coordinates this century. */
async function quakes(lat: number, lng: number): Promise<number> {
  const json = (await getJson(`${USGS}?format=geojson&latitude=${lat}&longitude=${lng}&maxradiuskm=150&minmagnitude=4.5&starttime=2000-01-01`)) as { count?: number };
  if (typeof json.count !== "number") throw new Error("no count");
  return json.count;
}

/** FEMA National Risk Index for the county. */
async function nationalRiskIndex(state: string, county: string): Promise<NonNullable<HazardEnrichment["nri"]>> {
  const c = county.replace(/ County$/i, "").replace(/'/g, "''");
  const where = encodeURIComponent(`STATEABBRV='${state}' AND COUNTY='${c}'`);
  const fields = "RISK_SCORE,RISK_RATNG,EAL_RATNG,CFLD_RISKR,IFLD_RISKR,ERQK_RISKR,HRCN_RISKR,TRND_RISKR,WFIR_RISKR,HAIL_RISKR,SWND_RISKR,WNTW_RISKR";
  const json = (await getJson(`${NRI}?where=${where}&outFields=${fields}&returnGeometry=false&f=json`)) as { features?: { attributes?: Record<string, unknown> }[]; error?: unknown };
  const a = json.features?.[0]?.attributes;
  if (!a) throw new Error("county not in NRI");
  const str = (k: string) => (typeof a[k] === "string" && a[k] ? (a[k] as string) : null);
  const perils: Record<string, string> = {};
  for (const [k, name] of [["CFLD_RISKR", "coastal_flood"], ["IFLD_RISKR", "inland_flood"], ["ERQK_RISKR", "earthquake"], ["HRCN_RISKR", "hurricane"], ["TRND_RISKR", "tornado"], ["WFIR_RISKR", "wildfire"], ["HAIL_RISKR", "hail"], ["SWND_RISKR", "strong_wind"], ["WNTW_RISKR", "winter_weather"]] as const) {
    const v = str(k); if (v && !/not applicable|insufficient/i.test(v)) perils[name] = v;
  }
  return { riskScore: typeof a.RISK_SCORE === "number" ? a.RISK_SCORE : null, riskRating: str("RISK_RATNG"), expectedAnnualLossRating: str("EAL_RATNG"), perils };
}

/** Where do the coordinates really land? Compared with the county/state on the broker's file. */
async function reverseGeocode(lat: number, lng: number, fileCounty: string | null, fileState: string | null): Promise<NonNullable<HazardEnrichment["geocode"]>> {
  const json = (await getJson(`${NOMINATIM}?lat=${lat}&lon=${lng}&format=jsonv2&zoom=10`, { "user-agent": UA })) as { address?: { county?: string; state?: string } };
  const county = json.address?.county ?? null;
  const state = json.address?.state ?? null;
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/ county$/, "").trim();
  const stateOk = fileState && state ? STATE_NAMES[fileState.toUpperCase()]?.toLowerCase() === state.toLowerCase() : null;
  const countyOk = fileCounty && county ? norm(fileCounty) === norm(county) : null;
  const matchesFile = stateOk == null && countyOk == null ? null : (stateOk ?? true) && (countyOk ?? true);
  return { county, state, matchesFile };
}

const STATE_NAMES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia" };

/** Nominatim asks for ≤1 request/second: serialize those calls. */
let nominatimChain: Promise<unknown> = Promise.resolve();
function throttledReverse(lat: number, lng: number, county: string | null, state: string | null) {
  const run = nominatimChain.then(() => new Promise((r) => setTimeout(r, 1100))).then(() => reverseGeocode(lat, lng, county, state));
  nominatimChain = run.catch(() => undefined);
  return run;
}

/** Enrich one location. Never throws; each source is independent and optional. */
export async function enrichLocation(loc: LocationLike): Promise<HazardEnrichment> {
  const c = loadCache();
  const key = keyOf(loc);
  const hit = c[key];
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const out: HazardEnrichment = emptyEnrichment(loc);
  const jobs: Promise<void>[] = [];
  if (loc.state && loc.county) {
    jobs.push(femaDeclarations(loc.state, loc.county).then((r) => { out.declarationsSince2015 = r.count; out.declarationTypes = r.types; out.sources.push("openfema:declarations"); }).catch(() => {}));
  }
  if (loc.zip) {
    jobs.push(nfipClaims(loc.zip).then((n) => { out.nfipClaims = n; out.sources.push("openfema:nfip"); }).catch(() => {}));
  }
  if (loc.state && loc.county) {
    jobs.push(nationalRiskIndex(loc.state, loc.county).then((n) => { out.nri = n; out.sources.push("fema:nri"); }).catch(() => {}));
  }
  if (typeof loc.latitude === "number" && typeof loc.longitude === "number") {
    const { latitude: lat, longitude: lng } = loc;
    jobs.push(weatherExtremes(lat, lng).then((w) => { out.maxDailyPrecipMm = w.maxDailyPrecipMm; out.maxGustKmh = w.maxGustKmh; out.hotDays = w.hotDays; out.sources.push("open-meteo"); }).catch(() => {}));
    jobs.push(quakes(lat, lng).then((n) => { out.quakesSince2000 = n; out.sources.push("usgs:earthquakes"); }).catch(() => {}));
    jobs.push(throttledReverse(lat, lng, loc.county ?? null, loc.state ?? null).then((g) => { out.geocode = g; out.sources.push("osm:reverse-geocode"); }).catch(() => {}));
  }
  await Promise.all(jobs);
  // Cache even partial answers (a dead source shouldn't be hammered), but with a short TTL.
  const ALL_SOURCES = 6;
  c[key] = { at: out.sources.length === ALL_SOURCES ? Date.now() : Date.now() - CACHE_TTL_MS + 3600 * 1000, data: out };
  saveCache();
  return out;
}

/** The location that drives the risk: flood-tagged if any, else the largest TIV. */
export function primaryLocation<T extends LocationLike & { tiv?: number; hazardTags?: string[] }>(locations: T[]): T | undefined {
  return (
    locations.find((l) => (l.hazardTags ?? []).includes("flood") || (l.hazardTags ?? []).includes("hurricane")) ??
    [...locations].sort((a, b) => (b.tiv ?? 0) - (a.tiv ?? 0))[0]
  );
}

/** Enrich many locations with bounded concurrency (the whole book is ~30 distinct locations). */
export async function enrichMany(locs: LocationLike[], concurrency = 4): Promise<Map<string, HazardEnrichment>> {
  const out = new Map<string, HazardEnrichment>();
  const queue = [...locs];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let l = queue.shift(); l; l = queue.shift()) out.set(keyOf(l), await enrichLocation(l));
  }));
  return out;
}

export const enrichmentKey = keyOf;
