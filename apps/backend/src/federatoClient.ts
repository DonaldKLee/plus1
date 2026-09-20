/**
 * Federato HTN API client — Auth0 token + schema/query actions.
 */

import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, ensureCacheDir, env } from "./env.js";

interface TokenCache {
  access_token: string;
  expires_at: number;
}

let memoryToken: TokenCache | null = null;

function tokenPath() {
  return path.join(CACHE_DIR, "token.json");
}

export async function getAccessToken(force = false): Promise<string> {
  ensureCacheDir();
  const now = Date.now();
  if (!force && memoryToken && memoryToken.expires_at > now + 60_000) {
    return memoryToken.access_token;
  }
  try {
    const disk = JSON.parse(fs.readFileSync(tokenPath(), "utf8")) as TokenCache;
    if (!force && disk.expires_at > now + 60_000) {
      memoryToken = disk;
      return disk.access_token;
    }
  } catch {
    /* mint fresh */
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
  fs.writeFileSync(tokenPath(), JSON.stringify(memoryToken, null, 2));
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

export async function cacheSchemaAndPolicies(): Promise<{
  schemaPath: string;
  policiesPath: string;
  schemaResources: string[];
  policyCount: number;
}> {
  ensureCacheDir();
  const schema = await fetchSchema();
  const schemaPath = path.join(CACHE_DIR, "schema.json");
  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));

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

  const policiesPath = path.join(CACHE_DIR, "property-policies.json");
  fs.writeFileSync(
    policiesPath,
    JSON.stringify({ cachedAt: new Date().toISOString(), results: policies }, null, 2),
  );

  return {
    schemaPath,
    policiesPath,
    schemaResources: Object.keys(schema),
    policyCount: policies.length,
  };
}

export function loadCachedSchema(): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, "schema.json"), "utf8"));
  } catch {
    return null;
  }
}

export function loadCachedPolicies(): unknown[] | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(CACHE_DIR, "property-policies.json"), "utf8"),
    );
    const results: unknown[] = raw.results ?? raw;
    // Older caches never expanded producer.broker; refetch so brokers have names.
    const first = results[0] as { producer?: { broker?: unknown } } | undefined;
    if (first && typeof first.producer?.broker === "number") return null;
    return results;
  } catch {
    return null;
  }
}
