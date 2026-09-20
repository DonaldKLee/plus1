/**
 * The agentic query tool: turn an underwriter's question into a Federato query, run it, adapt.
 *
 *   goal ─► planner (Gemini + compact live schema + query-language rules) ─► payload
 *        ─► static validation (packages/brain) ─► execute ─► empty / error? ─► re-plan with feedback
 *        ─► compact, spoken-friendly summary + a trace of every attempt (the "why this query")
 *
 * This is the piece the challenge calls "agentic reasoning": nothing here is hard-coded per
 * question, the schema is read at runtime, and the planner sees its own mistakes.
 */
import { collapseGroups, compactSchema, QUERY_GUIDE, validateQueryPayload, type FederatoSchema } from "@plus1/brain";
import { generateJson } from "./agentBrain.js";
import { fetchSchema, loadCachedSchema, runQuery } from "./federatoClient.js";

export interface QueryAttempt {
  attempt: number;
  rationale: string;
  payload: Record<string, unknown>;
  total?: number;
  returned?: number;
  error?: string;
  validation?: string[];
  /** Rows were per-record and we collapsed them into groups client-side. */
  collapsedTo?: number;
}

export interface AgenticQueryResult {
  text: string;
  attempts: QueryAttempt[];
  rows: unknown[];
  total: number | null;
}

const MAX_ATTEMPTS = 3;
const MAX_ROWS_IN_TEXT = 12;

async function schemaNow(): Promise<FederatoSchema> {
  return ((loadCachedSchema() as FederatoSchema | null) ?? ((await fetchSchema()) as unknown as FederatoSchema));
}

const PLANNER_SCHEMA = {
  type: "object",
  properties: {
    rationale: { type: "string" },
    payload: { type: "string" },
    answerable: { type: "boolean" },
    why_not: { type: "string" },
  },
  required: ["rationale", "payload", "answerable"],
} as const;

function plannerSystem(schemaText: string): string {
  return `You are the query planner for an underwriting agent working on Federato's data API. Translate the underwriter's goal into ONE query payload.

LIVE SCHEMA (resource: field:type; → is a reference, [] means many):
${schemaText}

${QUERY_GUIDE}

Return JSON: {"rationale": one sentence on which resource/fields you chose and why, "payload": the query payload AS A JSON STRING, "answerable": true, "why_not": ""}. If the data cannot answer the goal, set answerable=false and explain in why_not.
Prefer: start from the resource whose records the user wants counted or listed; expand only what a filter or the answer needs; select the few fields that let the answer be spoken (names, numbers, states); sort by the quantity the question is about; limit 20.`;
}

function plannerUser(goal: string, feedback?: string): string {
  return `Underwriter's goal: ${goal}${feedback ? `\n\nYour previous attempt had a problem. Fix it:\n${feedback}` : ""}`;
}

/** Strip nulls/ids and long arrays so the result reads well in a prompt or a chat message. */
export function compactRows(rows: unknown[], max = MAX_ROWS_IN_TEXT): unknown[] {
  const prune = (v: unknown, depth = 0): unknown => {
    if (v == null) return undefined;
    if (Array.isArray(v)) return depth > 2 ? `[${v.length} items]` : v.slice(0, 5).map((x) => prune(x, depth + 1));
    if (typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (x == null || k === "currency") continue;
        const p = prune(x, depth + 1);
        if (p !== undefined) o[k] = p;
      }
      return o;
    }
    return v;
  };
  return rows.slice(0, max).map((r) => prune(r));
}

/** Run one goal end to end. */
export async function agenticQuery(goal: string): Promise<AgenticQueryResult> {
  const schema = await schemaNow();
  const schemaText = compactSchema(schema);
  const attempts: QueryAttempt[] = [];
  let feedback: string | undefined;

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const planned = (await generateJson(plannerSystem(schemaText), plannerUser(goal, feedback), PLANNER_SCHEMA as unknown as Record<string, unknown>, 0.1)) as {
      rationale?: string; payload?: string; answerable?: boolean; why_not?: string;
    };
    if (planned.answerable === false) {
      const text = `the data can't answer that directly${planned.why_not ? `: ${planned.why_not}` : ""}`;
      attempts.push({ attempt: i, rationale: planned.rationale ?? "", payload: {}, error: text });
      return { text, attempts, rows: [], total: null };
    }
    let payload: Record<string, unknown>;
    try {
      payload = typeof planned.payload === "string" ? (JSON.parse(planned.payload) as Record<string, unknown>) : ((planned.payload ?? {}) as Record<string, unknown>);
    } catch (e) {
      feedback = `payload was not valid JSON (${(e as Error).message}). Return the payload as a JSON string.`;
      attempts.push({ attempt: i, rationale: planned.rationale ?? "", payload: {}, error: feedback });
      continue;
    }
    const a: QueryAttempt = { attempt: i, rationale: planned.rationale ?? "", payload };
    attempts.push(a);

    const v = validateQueryPayload(payload, schema);
    if (!v.ok) {
      a.validation = v.problems;
      feedback = `static validation failed:\n- ${v.problems.join("\n- ")}`;
      continue;
    }

    try {
      const res = await runQuery(payload);
      let rows = res.results ?? (res as { groups?: unknown[] }).groups ?? [];
      a.total = res.total;
      a.returned = rows.length;
      // The API hands back one row per record even when grouping; make real groups.
      const c = collapseGroups(rows, payload.select);
      if (c.collapsed) {
        rows = applySort(c.rows, payload.sort);
        a.collapsedTo = rows.length;
      }
      if (rows.length === 0 && i < MAX_ATTEMPTS) {
        feedback = `the query validated but returned zero results (total ${res.total ?? 0}). Most likely a dot-path through an array (use $elemMatch), a filter that should be a where (or vice versa), or a value that doesn't exist. Broaden or fix it.`;
        continue;
      }
      return { text: describeRows(goal, rows, res.total ?? rows.length, payload, a.collapsedTo), attempts, rows, total: res.total ?? rows.length };
    } catch (e) {
      const msg = (e as Error).message;
      a.error = msg;
      feedback = `the API rejected the query: ${msg.slice(0, 400)}`;
    }
  }
  const last = attempts[attempts.length - 1];
  return {
    text: `i couldn't get a clean answer from Federato after ${attempts.length} tries${last?.error ? ` (last error: ${last.error.slice(0, 160)})` : last?.validation ? ` (${last.validation[0]})` : ""}.`,
    attempts,
    rows: [],
    total: null,
  };
}

/** A compact, readable rendering of the result for the room and the narrating LLM. */
function describeRows(goal: string, rows: unknown[], total: number, payload: Record<string, unknown>, collapsedTo?: number): string {
  const resource = String(payload.resource ?? "records");
  if (rows.length === 0) return `no ${resource} records match (${goal}).`;
  const compact = compactRows(rows);
  const head = collapsedTo != null
    ? `${total} ${resource} records match, in ${collapsedTo} group${collapsedTo === 1 ? "" : "s"}${compact.length < collapsedTo ? ` (showing ${compact.length})` : ""}.`
    : `${total} ${resource}${total === 1 ? "" : " records"} match${rows.length < total ? ` (showing ${compact.length})` : ""}.`;
  return `${head}\n${JSON.stringify(compact)}`;
}

/** One line per attempt, for the operator's notes / Mind column. */
export function traceLines(attempts: QueryAttempt[]): string[] {
  return attempts.map((a) => {
    const q = Object.keys(a.payload).length ? JSON.stringify(a.payload) : "(no payload)";
    const outcome = a.error ? `error: ${a.error.slice(0, 120)}` : a.validation ? `rejected before sending: ${a.validation[0]}` : `${a.returned ?? 0}/${a.total ?? "?"} rows${a.collapsedTo != null ? `, collapsed to ${a.collapsedTo} groups client-side (the API groups per record)` : ""}`;
    return `query #${a.attempt}: ${a.rationale} → ${q.slice(0, 300)} → ${outcome}`;
  });
}

/** The API sorted per-record rows; after collapsing into groups, re-apply the payload's sort. */
function applySort(rows: unknown[], sort: unknown): unknown[] {
  if (!Array.isArray(sort) || sort.length === 0) return rows;
  const rules = sort.filter((r): r is { field: string; direction?: string } => !!r && typeof (r as { field?: unknown }).field === "string");
  const get = (row: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), row);
  return [...rows].sort((x, y) => {
    for (const r of rules) {
      const a = get(x, r.field); const b = get(y, r.field);
      if (a == null && b == null) continue;
      if (a == null) return 1; if (b == null) return -1;
      const cmp = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      if (cmp !== 0) return r.direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}
