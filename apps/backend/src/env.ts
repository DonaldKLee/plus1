import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(__dirname, "../.env") });

export const ROOT = root;
export const CACHE_DIR = path.join(__dirname, "../cache");

export function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
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
