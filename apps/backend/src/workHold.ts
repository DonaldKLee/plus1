/**
 * Holding screen for the Meet Present work tab between Browserbase agent runs.
 * Live view flashes "disconnected" when an agent ends — we swap to a logo page
 * until the next live view URL is ready.
 *
 * Swap the image: put a PNG at apps/backend/assets/work-hold-logo.png
 * or set WORK_HOLD_LOGO to an absolute path.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { envOptional } from "./env.js";
import { stampWorkTitle } from "./meetPresent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOGO = path.join(__dirname, "../assets/work-hold-logo.png");

const holdListeners = new Set<() => void>();

export function onWorkHold(cb: () => void): () => void {
  holdListeners.add(cb);
  return () => holdListeners.delete(cb);
}

export function emitWorkHold(): void {
  for (const cb of holdListeners) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

export function workHoldLogoPath(): string {
  const custom = envOptional("WORK_HOLD_LOGO");
  if (custom && fs.existsSync(custom)) return custom;
  return DEFAULT_LOGO;
}

export function workHoldHtml(): string {
  const logoPath = workHoldLogoPath();
  const b64 = fs.existsSync(logoPath)
    ? fs.readFileSync(logoPath).toString("base64")
    : "";
  const img = b64
    ? `<img src="data:image/png;base64,${b64}" alt="plus1" />`
    : `<div class="fallback">plus1</div>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>plus1-work</title>
  <style>
    html, body {
      margin: 0; height: 100%; background: #ffffff; color: #111;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    }
    main {
      min-height: 100%; display: grid; place-items: center;
      padding: 2rem;
      box-sizing: border-box;
    }
    .card { text-align: center; max-width: min(920px, 92vw); }
    img {
      display: block; margin: 0 auto;
      width: min(720px, 88vw); height: auto;
    }
    .fallback {
      width: 200px; height: 200px; margin: 0 auto; border-radius: 50%;
      background: #111; color: #fff; display: grid; place-items: center;
      font-size: 2rem; font-weight: 700;
    }
    p { margin: 1.5rem 0 0; opacity: 0.45; font-size: 0.95rem; letter-spacing: 0.04em; }
  </style>
</head>
<body>
  <main><div class="card">${img}<p>working on the next view…</p></div></main>
</body>
</html>`;
}

/** Local URL the Present tab loads (same machine as Playwright Chrome). */
export function workHoldUrl(port = Number(process.env.PORT ?? 8787)): string {
  return `http://127.0.0.1:${port}/work-hold`;
}

/** Navigate the work tab to the logo hold screen and keep the Present title. */
export async function showWorkHold(page: Page | undefined, note?: (msg: string) => void): Promise<void> {
  if (!page || page.isClosed()) return;
  try {
    await page.goto(workHoldUrl(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    await stampWorkTitle(page);
    note?.("Work tab → hold screen (logo)");
  } catch (e) {
    // Fallback: inline data URL if the backend route isn't reachable yet
    try {
      const data = `data:text/html;charset=utf-8,${encodeURIComponent(workHoldHtml())}`;
      await page.goto(data, { waitUntil: "domcontentloaded", timeout: 10_000 });
      await stampWorkTitle(page);
      note?.("Work tab → hold screen (inline)");
    } catch (e2) {
      note?.(`hold screen: ${(e2 as Error).message}`);
    }
  }
}
