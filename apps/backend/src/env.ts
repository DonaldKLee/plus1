import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(__dirname, "../.env") });

export const ROOT = root;
export const APP_DIR = path.resolve(__dirname, "..");

/** Things worth keeping: drafted documents (contracts, letters, memos). Gitignored, but yours. */
export const OUTPUT_DIR = path.join(APP_DIR, "output");
/** The goose's Chrome profile (Google sign-in). Gitignored. */
export const PROFILE_DIR = path.join(APP_DIR, ".profile");
/** Disposable process state (enrichment lookups, Browserbase session pointer, debug screenshots): lives in the OS temp dir, never in the repo. */
export const STATE_DIR = path.join(os.tmpdir(), "plus1-backend");

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @deprecated There is no repo `cache/` folder any more. Modules that still import these get the
 * disposable STATE_DIR (tunnel URL, work-cam config/context, Browserbase work session). Prefer
 * OUTPUT_DIR for things worth keeping and STATE_DIR for things that aren't.
 */
export const CACHE_DIR = STATE_DIR;
export function ensureCacheDir(): string {
  return ensureDir(STATE_DIR);
}

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v == null || v === "") {
    throw new Error(`Missing env ${name}`);
  }
  return v;
}

export function envOptional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}
