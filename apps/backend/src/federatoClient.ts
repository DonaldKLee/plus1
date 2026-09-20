/**
 * Federato HTN API client — Auth0 token + schema/query actions.
 */

import { env } from "./env.js";

interface TokenCache {
  access_token: string;
  expires_at: number;
}

// Everything here is process memory. Tokens last 4 hours and are cheap to mint; the schema and
// the expanded property book are re-fetched after SNAPSHOT_TTL_MS or on demand. Nothing is
// written to disk.
let memoryToken: TokenCache | null = null;

export async function getAccessToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && memoryToken && memoryToken.expires_at > now + 60_000) {
    return memoryToken.access_token;
  }

  const res = await fetch(env("FEDERATO_AUTH_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env("FEDERATO_CLIENT_ID"),
      client_secret: env("FEDERATO_CLIENT_SECRET"),
      audience: env("FEDERATO_AUDIENCE"),
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Federato auth failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  memoryToken = {
    access_token: body.access_token,
    expires_at: now + body.expires_in * 1000,
  };
  return memoryToken.access_token;
}

function unwrap(data: unknown): unknown {
  if (data && typeof data === "object" && "output" in data) {
    const out = (data as { output: unknown }).output;
    if (Array.isArray(out) && out[0] && typeof out[0] === "object" && "data" in out[0]) {
      return (out[0] as { data: unknown }).data;
    }
    return out;
  }
  return data;
}

export async function federatoAction(
  body: Record<string, unknown>,
): Promise<unknown> {
  const token = await getAccessToken();
  const url = env("FEDERATO_HANDLER_URL");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    const token2 = await getAccessToken(true);
    const res2 = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res2.ok) {
      throw new Error(`Federato ${body.action} failed: ${res2.status} ${await res2.text()}`);
    }
    return unwrap(await res2.json());
  }
  if (!res.ok) {
    throw new Error(`Federato ${body.action} failed: ${res.status} ${await res.text()}`);
  }
  return unwrap(await res.json());
}

export async function fetchSchema(): Promise<Record<string, unknown>> {
  const data = await federatoAction({ action: "schema" });
  return data as Record<string, unknown>;
}

export async function runQuery(
  payload: Record<string, unknown>,
): Promise<{ total?: number; results?: unknown[]; resource?: string }> {
  const data = await federatoAction({ action: "query", payload });
  return data as { total?: number; results?: unknown[]; resource?: string };
}

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
interface Snapshot { at: number; schema: Record<string, unknown>; policies: unknown[] }
let snapshot: Snapshot | null = null;

/**
 * Refresh the in-memory snapshot: the live schema and every property policy, expanded with
 * insured, claims, submission, broker and locations/buildings. Called on demand and when stale.
 */
export async function cacheSchemaAndPolicies(): Promise<{
  schemaResources: string[];
  policyCount: number;
  refreshedAt: string;
}> {
  const schema = await fetchSchema();
  const policies: unknown[] = [];
  let offset = 0;
  const limit = 50;
  for (;;) {
    const page = await runQuery({
      resource: "Policy",
      where: { line_of_business: "property" },
      expand: {
        insured: true,
        claims: true,
        submission: true,
        producer: { broker: true },
        exposure_units: { location: { buildings: true } },
      },
      pagination: { limit, offset },
    });
    const batch = page.results ?? [];
    policies.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
    if (offset > 500) break;
  }
  snapshot = { at: Date.now(), schema, policies };
  return { schemaResources: Object.keys(schema), policyCount: policies.length, refreshedAt: new Date(snapshot.at).toISOString() };
}

const fresh = () => snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL_MS;

/** The schema from the in-memory snapshot, or null when there is none yet (callers fetch live). */
export function loadCachedSchema(): Record<string, unknown> | null {
  return fresh() ? snapshot!.schema : null;
}

/** The expanded property book from the in-memory snapshot, or null when stale/absent. */
export function loadCachedPolicies(): unknown[] | null {
  return fresh() ? snapshot!.policies : null;
}
