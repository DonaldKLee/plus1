/**
 * External risk enrichment for a Federato location (the "bonus" milestone, done properly):
 *   - OpenFEMA DisasterDeclarationsSummaries: how often the county has been in a federal
 *     disaster declaration since 2015, and for what (hurricane, flood, fire…).
 *   - OpenFEMA NFIP claims (v2): how many flood-insurance claims that zip has ever filed.
 *   - Open-Meteo archive: last full year's wettest day and strongest gust at the coordinates.
 * All three are free, keyless, and every location in the dataset has county + lat/lng.
 * Failures degrade to nulls (scored as "missing", never as a fail) and are cached per
 * location on disk so ranking the whole book costs the network once.
 */
import fs from "node:fs";
import path from "node:path";
import type { HazardEnrichment } from "@plus1/brain";
import { CACHE_DIR, ensureCacheDir } from "./env.js";

const OPENFEMA = "https://www.fema.gov/api/open";
const OPEN_METEO = "https://archive-api.open-meteo.com/v1/archive";
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
const cachePath = () => path.join(CACHE_DIR, "enrichment.json");

function loadCache(): Record<string, CacheEntry> {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as Record<string, CacheEntry>; }
  catch { cache = {}; }
  return cache;
}
function saveCache(): void {
  try { ensureCacheDir(); fs.writeFileSync(cachePath(), JSON.stringify(cache ?? {}, null, 1)); } catch { /* best effort */ }
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

/** Last full calendar year's daily extremes at the coordinates. */
async function weatherExtremes(lat: number, lng: number): Promise<{ maxDailyPrecipMm: number | null; maxGustKmh: number | null }> {
  const year = new Date().getUTCFullYear() - 1;
  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lng}&start_date=${year}-01-01&end_date=${year}-12-31&daily=precipitation_sum,wind_gusts_10m_max&timezone=auto`;
  const json = (await getJson(url)) as { daily?: { precipitation_sum?: (number | null)[]; wind_gusts_10m_max?: (number | null)[] } };
  const max = (xs?: (number | null)[]) => { const v = (xs ?? []).filter((x): x is number => typeof x === "number"); return v.length ? Math.max(...v) : null; };
  return { maxDailyPrecipMm: max(json.daily?.precipitation_sum), maxGustKmh: max(json.daily?.wind_gusts_10m_max) };
}

/** Enrich one location. Never throws; each source is independent and optional. */
export async function enrichLocation(loc: LocationLike): Promise<HazardEnrichment> {
  const c = loadCache();
  const key = keyOf(loc);
  const hit = c[key];
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const out: HazardEnrichment = {
    zip: loc.zip ?? null, county: loc.county ?? null, state: loc.state ?? null,
    declarationsSince2015: null, declarationTypes: {}, nfipClaims: null,
    maxDailyPrecipMm: null, maxGustKmh: null, sources: [],
  };
  const jobs: Promise<void>[] = [];
  if (loc.state && loc.county) {
    jobs.push(femaDeclarations(loc.state, loc.county).then((r) => { out.declarationsSince2015 = r.count; out.declarationTypes = r.types; out.sources.push("openfema:declarations"); }).catch(() => {}));
  }
  if (loc.zip) {
    jobs.push(nfipClaims(loc.zip).then((n) => { out.nfipClaims = n; out.sources.push("openfema:nfip"); }).catch(() => {}));
  }
  if (typeof loc.latitude === "number" && typeof loc.longitude === "number") {
    jobs.push(weatherExtremes(loc.latitude, loc.longitude).then((w) => { out.maxDailyPrecipMm = w.maxDailyPrecipMm; out.maxGustKmh = w.maxGustKmh; out.sources.push("open-meteo"); }).catch(() => {}));
  }
  await Promise.all(jobs);
  // Cache even partial answers (a dead source shouldn't be hammered), but with a short TTL.
  c[key] = { at: out.sources.length === 3 ? Date.now() : Date.now() - CACHE_TTL_MS + 3600 * 1000, data: out };
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
