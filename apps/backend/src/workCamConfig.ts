/**
 * Work-cam delivery mode:
 *   local  — Meet in local Chrome; Present/screenshare (getDisplayMedia works)
 *   cloud  — Meet on Browserbase; Browserbase on the camera tile
 */

import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "./env.js";
import { getWorkCamSettings, saveWorkCamSettings } from "./store.js";

export type WorkCamMode = "local" | "cloud";

export interface WorkCamConfig {
  mode: WorkCamMode;
}

const DEFAULT: WorkCamConfig = { mode: "local" };
const FILE = path.join(CACHE_DIR, "workcam-config.json");

let memory: WorkCamConfig = { ...DEFAULT };

function normalize(raw: unknown): WorkCamConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT };
  const mode = (raw as { mode?: string }).mode;
  return { mode: mode === "cloud" ? "cloud" : "local" };
}

function readFile(): WorkCamConfig | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return normalize(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch {
    return null;
  }
}

function writeFile(cfg: WorkCamConfig): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2));
  } catch {
    /* best-effort */
  }
}

/** Resolve config: Mongo → file → memory → default. */
export async function loadWorkCamConfig(): Promise<WorkCamConfig & { source: string }> {
  const fromDb = await getWorkCamSettings().catch(() => null);
  if (fromDb) {
    const cfg = normalize(fromDb);
    memory = cfg;
    return { ...cfg, source: "mongodb" };
  }
  const fromFile = readFile();
  if (fromFile) {
    memory = fromFile;
    return { ...fromFile, source: "file" };
  }
  return { ...memory, source: memory === DEFAULT ? "default" : "memory" };
}

export async function persistWorkCamConfig(partial: Partial<WorkCamConfig>): Promise<WorkCamConfig & { saved: boolean; source: string }> {
  const next = normalize({ ...memory, ...partial });
  memory = next;
  writeFile(next);
  const saved = await saveWorkCamSettings(next as unknown as Record<string, unknown>).catch(() => false);
  return { ...next, saved, source: saved ? "mongodb" : "file" };
}

export function workCamModeLabel(mode: WorkCamMode): string {
  return mode === "local"
    ? "Local Chrome + Present (screenshare)"
    : "Cloud Meet + camera tile";
}
