/**
 * What the query-planning LLM needs to write correct Federato queries: a compact rendering of
 * the live schema, the query-language rules (from the challenge's Query Request Body guide),
 * and a validator that catches the classic mistakes (dot-paths through arrays, expanding
 * non-references, unknown fields) BEFORE a query is sent. Pure — no network.
 */
import type { FederatoSchema, SchemaField, SchemaResource } from "./queryPlan.js";

/** One line per resource: `Policy: id:number, premium:number, insured:→Insured, claims:→Claim[], dates:{effective,…}`. */
export function compactSchema(schema: FederatoSchema): string {
  const lines: string[] = [];
  for (const [name, res] of Object.entries(schema)) {
    const fields = Object.entries(res.fields ?? {}).map(([f, d]) => `${f}:${describeField(d)}`);
    lines.push(`${name}: ${fields.join(", ")}`);
  }
  return lines.join("\n");
}

function describeField(d: SchemaField): string {
  if (d.type === "reference") return `→${d.resource ?? "?"}${d.cardinality === "many" ? "[]" : ""}`;
  if (d.type === "object" && d.fields) return `{${Object.keys(d.fields).join(",")}}`;
  if (d.type === "array") {
    const item = d.itemSchema;
    if (item?.fields) return `[{${Object.keys(item.fields).join(",")}}]`;
    return `[${item?.type ?? "?"}]`;
  }
  return d.type + (d.optional ? "?" : "");
}

export const QUERY_GUIDE = `Federato query language (Mongo-flavoured). Payload keys, all optional except resource:
  resource, where, expand, unwind, filter, over, select, sort, pagination
Pipeline order: where (raw records) → expand (hydrate references) → unwind (fan arrays into rows) → filter (hydrated rows) → over (group) → select → sort → pagination.
Operators: $eq $ne $exists $gt $gte $lt $lte $in $nin $contains $elemMatch, combinators $and $or $not. Multiple operators in one clause = AND.
RULES THAT MATTER:
- "where" runs BEFORE expand: only scalar fields of the resource itself (e.g. Policy.line_of_business, Policy.premium, Policy.status). Anything through a reference (insured.name, exposure_units.location.state) goes in "filter" AFTER an "expand" of that path.
- Dot-paths do NOT traverse arrays. For a "many" reference or array field use $elemMatch: {"filter": {"exposure_units": {"$elemMatch": {"location": {"state": "CA"}}}}} (with "expand": {"exposure_units": {"location": true}}).
- expand chains by nesting: {"expand": {"exposure_units": {"location": {"buildings": true}}}}; {"expand": {"producer": {"broker": true}}}.
- select: list form ["id","premium","insured.name"] or object form {"id": true, "insured": {"name": true}}. In the object form a value is ONLY true, a nested object, or an aggregation — never a path string ({"broker": "broker.name"} is invalid; write {"broker": {"name": true}}). Aggregations in select: {"totalTiv": {"$sum": "exposure_units.basis_amount"}}, $avg, $min, $max, {"n": {"$count": true}}, $countDistinct.
- Grouping: "over": ["field.path"] names the group keys and MUST also appear in select as plain fields (e.g. over ["cause_of_loss"], select {"cause_of_loss": true, "n": {"$count": true}, "paid": {"$sum": "paid_indemnity"}}). Rows come back per record and are collapsed into groups for you.
- sort: [{"field": "premium", "direction": "desc"}]. pagination: {"limit": 20, "offset": 0}. The reply's "total" counts all matches regardless of limit.
- Keep results small: select only what the question needs; limit ≤ 25 unless counting.
WORKED EXAMPLES:
- "active property policies in California with total premium" → {"resource":"Policy","where":{"status":"active","line_of_business":"property"},"expand":{"exposure_units":{"location":true}},"filter":{"exposure_units":{"$elemMatch":{"location":{"state":"CA"}}}},"select":{"n":{"$count":true},"premium":{"$sum":"premium"}}}
- "declined submissions by broker, most first" → {"resource":"Submission","where":{"status":"declined"},"expand":{"broker":true},"over":["broker.name"],"select":{"broker":{"name":true},"n":{"$count":true}},"sort":[{"field":"n","direction":"desc"}]}
- "property policies at flood-tagged locations, biggest premium first" → {"resource":"Policy","where":{"line_of_business":"property"},"expand":{"insured":true,"exposure_units":{"location":true}},"filter":{"exposure_units":{"$elemMatch":{"location":{"hazard_tags":{"$in":["flood"]}}}}},"select":["policy_number","premium","insured.name"],"sort":[{"field":"premium","direction":"desc"}],"pagination":{"limit":20}}
- "pre-1990 unsprinklered buildings" → expand exposure_units.location.buildings, unwind ["exposure_units","exposure_units.location.buildings"], filter {"exposure_units.location.buildings.year_built":{"$lte":1990},"exposure_units.location.buildings.sprinklered":false}.
- "policies expiring in the next 90 days" → where {"dates.expiration":{"$gte":"<today ISO>","$lte":"<today+90d ISO>"}} (dates are ISO strings; nested object dot-paths are fine, only arrays need $elemMatch).
Known values: Policy.line_of_business ∈ property, cgl, auto, cyber, health, lpl, excess. Policy.business_type ∈ new, renewal. Policy.status ∈ active, bound, quoted, expired, cancelled. Submission.status ∈ received, cleared, quoted, bound, declined, lost. Location.hazard_tags ⊂ flood, wildfire, hail, earthquake, tornado, winter_storm, hurricane, wind. Building.construction_type e.g. Frame, Joisted Masonry, Non-Combustible, Masonry Non-Combustible, Fire Resistive.`;

export interface QueryValidation {
  ok: boolean;
  /** Hard errors — the API will reject or silently return nothing. */
  problems: string[];
  /** Soft advice. */
  warnings: string[];
}

const PIPELINE_KEYS = new Set(["resource", "where", "expand", "unwind", "filter", "over", "select", "sort", "pagination"]);

/** Static checks against the schema. Returns problems the planner should fix before we send it. */
export function validateQueryPayload(payload: unknown, schema: FederatoSchema): QueryValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, problems: ["payload must be an object"], warnings };
  }
  const q = payload as Record<string, unknown>;
  for (const k of Object.keys(q)) if (!PIPELINE_KEYS.has(k)) problems.push(`unknown top-level key "${k}"`);
  const resource = q.resource;
  if (typeof resource !== "string" || !(resource in schema)) {
    problems.push(`resource must be one of: ${Object.keys(schema).join(", ")}`);
    return { ok: false, problems, warnings };
  }
  const res = schema[resource]!;

  if (q.where && typeof q.where === "object") checkWhere(q.where as Record<string, unknown>, res, schema, problems, warnings, "where");
  if (q.expand !== undefined) checkExpand(q.expand, res, schema, problems, "expand");
  if (q.select && typeof q.select === "object" && !Array.isArray(q.select)) checkSelect(q.select as Record<string, unknown>, problems, "select");
  if (Array.isArray(q.over) && q.select && typeof q.select === "object" && !Array.isArray(q.select)) {
    const sel = q.select as Record<string, unknown>;
    for (const key of q.over as unknown[]) {
      if (typeof key !== "string") continue;
      const head = key.split(".")[0]!;
      if (!(head in sel)) warnings.push(`over key "${key}" is not in select; add {"${head}": true} so groups are labelled`);
    }
  }
  if (q.pagination && typeof q.pagination === "object") {
    const lim = (q.pagination as Record<string, unknown>).limit;
    if (typeof lim === "number" && lim > 100) warnings.push("limit > 100 is a lot to read aloud; consider aggregating");
  }
  return { ok: problems.length === 0, problems, warnings };
}

function checkWhere(
  clause: Record<string, unknown>,
  res: SchemaResource,
  schema: FederatoSchema,
  problems: string[],
  warnings: string[],
  where: string,
): void {
  for (const [key, val] of Object.entries(clause)) {
    if (key === "$and" || key === "$or") {
      if (Array.isArray(val)) for (const sub of val) if (sub && typeof sub === "object") checkWhere(sub as Record<string, unknown>, res, schema, problems, warnings, where);
      continue;
    }
    if (key === "$not") { if (val && typeof val === "object") checkWhere(val as Record<string, unknown>, res, schema, problems, warnings, where); continue; }
    if (key.startsWith("$")) continue;
    const [head, ...rest] = key.split(".");
    const field = res.fields[head!];
    if (!field) { problems.push(`${where}: "${head}" is not a field of ${resourceName(res, schema)} (fields: ${Object.keys(res.fields).slice(0, 12).join(", ")}…)`); continue; }
    if (field.type === "reference" && where === "where") {
      problems.push(`where: "${key}" goes through reference "${head}"; expand it and use "filter" instead`);
    }
    if ((field.type === "reference" && field.cardinality === "many") || field.type === "array") {
      if (rest.length > 0 || (val && typeof val === "object" && !("$elemMatch" in (val as object)) && !("$in" in (val as object)) && !("$contains" in (val as object)))) {
        problems.push(`"${key}" is an array/many field — use {"${head}": {"$elemMatch": {...}}} instead of a dot-path`);
      }
    }
  }
}

function resourceName(res: SchemaResource, schema: FederatoSchema): string {
  return Object.entries(schema).find(([, r]) => r === res)?.[0] ?? "resource";
}

function checkExpand(expand: unknown, res: SchemaResource, schema: FederatoSchema, problems: string[], path: string): void {
  if (typeof expand === "string") {
    // {"expand": {"producer": "broker"}} shorthand handled by caller; a bare string at top level is invalid
    problems.push(`${path}: must be an object like {"insured": true}`);
    return;
  }
  if (!expand || typeof expand !== "object") return;
  for (const [key, val] of Object.entries(expand as Record<string, unknown>)) {
    const field = res.fields[key];
    if (!field) { problems.push(`${path}: "${key}" is not a field of ${resourceName(res, schema)}`); continue; }
    let target: SchemaResource | undefined;
    if (field.type === "reference") target = field.resource ? schema[field.resource] : undefined;
    else if (field.type === "object" && field.fields) {
      // e.g. producer: {broker: true} — object holding references
      const sub = { type: "object", fields: field.fields } as SchemaResource;
      if (val && typeof val === "object") checkExpand(val, sub, schema, problems, `${path}.${key}`);
      else if (typeof val === "string") { if (!field.fields[val]) problems.push(`${path}.${key}: "${val}" is not a reference inside ${key}`); }
      continue;
    } else { problems.push(`${path}: "${key}" is a ${field.type}, not a reference — nothing to expand`); continue; }
    if (target && val && typeof val === "object") checkExpand(val, target, schema, problems, `${path}.${key}`);
  }
}

const AGG_OPS = new Set(["$sum", "$avg", "$min", "$max", "$count", "$countDistinct"]);

/** Object-form select: values must be true, a nested object, or an aggregation — never a path string. */
function checkSelect(select: Record<string, unknown>, problems: string[], path: string): void {
  for (const [key, val] of Object.entries(select)) {
    if (val === true) continue;
    if (typeof val === "string") { problems.push(`${path}.${key}: "${val}" is a string; use {"${key}": {"${val.split(".").pop()}": true}} or {"${key}": true}`); continue; }
    if (Array.isArray(val)) continue; // {"insured": ["name","id"]} shorthand
    if (val && typeof val === "object") {
      const keys = Object.keys(val as Record<string, unknown>);
      if (keys.some((k) => AGG_OPS.has(k)) || keys.includes("$expand")) continue;
      // A lone operator-looking key that isn't a real aggregation ("%count", "$cnt") is a typo the API will reject or ignore.
      const bogus = keys.filter((k) => /^[^a-z_]/i.test(k));
      if (bogus.length) { problems.push(`${path}.${key}: unknown aggregation ${bogus.map((b) => `"${b}"`).join(", ")}; use one of ${[...AGG_OPS].join(", ")}`); continue; }
      checkSelect(val as Record<string, unknown>, problems, `${path}.${key}`);
    }
  }
}

/** Is this select leaf an aggregation spec? */
export function isAggregation(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).some((k) => AGG_OPS.has(k));
}

/**
 * The API returns one row per record even with `over`. Collapse rows into real groups:
 * group keys = the plain (non-aggregate) select paths; aggregates recombine by operator.
 * Pure. Returns the rows unchanged when nothing in select aggregates.
 */
export function collapseGroups(rows: unknown[], select: unknown): { rows: unknown[]; collapsed: boolean } {
  if (!select || typeof select !== "object" || Array.isArray(select)) return { rows, collapsed: false };
  const sel = select as Record<string, unknown>;
  const aggs = Object.entries(sel).filter(([, v]) => isAggregation(v)).map(([k, v]) => ({ key: k, op: Object.keys(v as object).find((o) => AGG_OPS.has(o))! }));
  if (aggs.length === 0) return { rows, collapsed: false };
  const plain = Object.keys(sel).filter((k) => !aggs.some((a) => a.key === k));
  const groups = new Map<string, { out: Record<string, unknown>; n: number; sums: Record<string, number> }>();
  const groupKey = (r: Record<string, unknown>) => JSON.stringify(plain.map((k) => r[k] ?? null));
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const k = groupKey(r);
    let g = groups.get(k);
    if (!g) {
      g = { out: {}, n: 0, sums: {} };
      for (const p of plain) g.out[p] = r[p];
      for (const a of aggs) g.out[a.key] = a.op === "$count" || a.op === "$countDistinct" ? 0 : null;
      groups.set(k, g);
    }
    g.n += 1;
    for (const a of aggs) {
      const v = r[a.key];
      const cur = g.out[a.key] as number | null;
      if (a.op === "$count" || a.op === "$countDistinct") { g.out[a.key] = (cur ?? 0) + (typeof v === "number" ? v : 1); continue; }
      if (typeof v !== "number") continue;
      if (a.op === "$sum") g.out[a.key] = (cur ?? 0) + v;
      else if (a.op === "$min") g.out[a.key] = cur == null ? v : Math.min(cur, v);
      else if (a.op === "$max") g.out[a.key] = cur == null ? v : Math.max(cur, v);
      else if (a.op === "$avg") { g.sums[a.key] = (g.sums[a.key] ?? 0) + v; g.out[a.key] = g.sums[a.key]! / g.n; }
    }
  }
  const out = [...groups.values()].map((g) => g.out);
  return { rows: out, collapsed: out.length !== rows.length };
}
