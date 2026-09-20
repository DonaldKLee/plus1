/**
 * Resolve / create a Browserbase Context that holds the work-cam Google login.
 * Persisted under apps/backend/cache/workcam-context.json and/or WORKCAM_CONTEXT_ID.
 */

import fs from "node:fs";
import path from "node:path";
import Browserbase from "@browserbasehq/sdk";
import { CACHE_DIR, ensureCacheDir, envOptional } from "./env.js";

const CACHE_FILE = path.join(CACHE_DIR, "workcam-context.json");

export type WorkCamContextCache = {
  contextId: string;
  projectId: string;
  createdAt: string;
  signedInAt?: string;
};

function bb(): { client: Browserbase; projectId: string } {
  const apiKey = envOptional("BROWSERBASE_API_KEY");
  const projectId = envOptional("BROWSERBASE_PROJECT_ID");
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required");
  }
  return { client: new Browserbase({ apiKey }), projectId };
}

export function readWorkCamContextCache(): WorkCamContextCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as WorkCamContextCache;
    return j.contextId ? j : null;
  } catch {
    return null;
  }
}

export function writeWorkCamContextCache(data: WorkCamContextCache): void {
  ensureCacheDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

/** Env wins, then cache file. Does not create. */
export function getWorkCamContextId(): string | undefined {
  return envOptional("WORKCAM_CONTEXT_ID") ?? readWorkCamContextCache()?.contextId;
}

/** Create a named Browserbase Context and cache the id. */
export async function ensureWorkCamContext(): Promise<string> {
  const existing = getWorkCamContextId();
  if (existing) {
    // Verify it still exists
    try {
      const { client } = bb();
      await client.contexts.retrieve(existing);
      return existing;
    } catch {
      /* recreate below */
    }
  }

  const { client, projectId } = bb();
  const ctx = await client.contexts.create({
    projectId,
    name: `plus1-workcam-${Date.now().toString(36)}`,
  });
  writeWorkCamContextCache({
    contextId: ctx.id,
    projectId,
    createdAt: new Date().toISOString(),
  });
  return ctx.id;
}

export async function fetchLiveViewUrl(
  sessionId: string,
  opts?: { expiresIn?: number; waitMs?: number },
): Promise<string> {
  const { client } = bb();
  const deadline = Date.now() + (opts?.waitMs ?? 15_000);
  try {
    while (true) {
      const debug = await client.sessions.debug(
        sessionId,
        opts?.expiresIn ? { expiresIn: opts.expiresIn } : undefined,
      );
      const pages = debug.pages ?? [];
      const real = [...pages].reverse().find((p) => {
        const u = (p.url ?? "").trim();
        return u && u !== "about:blank" && !u.startsWith("chrome");
      });
      const pick = real ?? pages[pages.length - 1];
      const url =
        pick?.debuggerFullscreenUrl ||
        debug.debuggerFullscreenUrl ||
        debug.debuggerUrl ||
        `https://www.browserbase.com/sessions/${sessionId}`;
      if (real || Date.now() >= deadline) return url;
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch {
    return `https://www.browserbase.com/sessions/${sessionId}`;
  }
}
