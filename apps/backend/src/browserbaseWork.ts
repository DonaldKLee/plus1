/**
 * Browserbase work browser — FEMA / Maps verification for Meet live-view.
 * Prefers Stagehand (Browserbase-recommended). Falls back to CDP Playwright, then local open.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import type { BrowseSession } from "@plus1/protocol";
import { STATE_DIR, ensureDir, envOptional } from "./env.js";

export interface BrowseTarget {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  queryLabel?: string;
}

function liveViewUrl(sessionId: string, debuggerUrl?: string): string {
  if (debuggerUrl) return debuggerUrl;
  return `https://www.browserbase.com/sessions/${sessionId}`;
}

/** Fullscreen live view (no dashboard chrome) — Present this tab in Meet. */
async function fetchFullscreenLiveView(
  apiKey: string,
  sessionId: string,
): Promise<{ fullscreenUrl?: string; debuggerUrl?: string }> {
  try {
    const { Browserbase } = await import("@browserbasehq/sdk");
    const bb = new Browserbase({ apiKey });
    const debug = await bb.sessions.debug(sessionId);
    // Prefer first open page's fullscreen URL (Maps tab); else session-level.
    const pageFs = debug.pages?.[0]?.debuggerFullscreenUrl;
    return {
      fullscreenUrl: pageFs || debug.debuggerFullscreenUrl,
      debuggerUrl: debug.debuggerUrl,
    };
  } catch {
    return {};
  }
}

function formatQuery(target: BrowseTarget): string {
  return [target.address, target.city, target.state, target.zip]
    .filter(Boolean)
    .join(", ");
}

async function createBbSession(apiKey: string, projectId: string) {
  const { Browserbase } = await import("@browserbasehq/sdk");
  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({
    projectId,
    keepAlive: true,
    browserSettings: { blockAds: true },
  } as Parameters<typeof bb.sessions.create>[0] & { keepAlive?: boolean });
  return { bb, session };
}

function resolveModelConfig():
  | { modelName: string; apiKey: string }
  | undefined {
  const openai = envOptional("OPENAI_API_KEY");
  if (openai) return { modelName: "openai/gpt-4o-mini", apiKey: openai };
  const google = envOptional("GOOGLE_API_KEY");
  if (google) return { modelName: "google/gemini-2.0-flash", apiKey: google };
  const anthropic = envOptional("ANTHROPIC_API_KEY");
  if (anthropic)
    return { modelName: "anthropic/claude-haiku-4-5", apiKey: anthropic };
  return undefined;
}

/**
 * Stagehand v4 on Browserbase — preferred for prize demo.
 * browserbase.launch → Stagehand.create; goto Maps/FEMA; optional act() with a model key.
 */
async function runWithStagehand(
  target: BrowseTarget,
  apiKey: string,
  projectId: string,
  keepOpen: boolean,
): Promise<BrowseSession> {
  ensureDir(STATE_DIR);
  const query = formatQuery(target);
  const steps: BrowseSession["steps"] = [];

  const { Stagehand, browserbase } = await import("@browserbasehq/stagehand");

  const launchOpts = {
    apiKey,
    projectId,
    ...(keepOpen ? { keepAlive: true } : {}),
  } as Parameters<typeof browserbase.launch>[0];

  let browser;
  try {
    browser = await browserbase.launch(launchOpts);
  } catch (e) {
    // Free tier may reject keepAlive — retry without it and hold the CDP handle instead.
    if (keepOpen) {
      steps.push({
        label: "stagehand.keepalive_retry",
        ok: true,
        detail: (e as Error).message,
      });
      browser = await browserbase.launch({
        apiKey,
        projectId,
      } as Parameters<typeof browserbase.launch>[0]);
    } else {
      throw e;
    }
  }

  const model = resolveModelConfig();
  const stagehand = await Stagehand.create({
    browser,
    ...(model ? { model } : {}),
    logging: { level: "error" },
  });
  steps.push({
    label: "stagehand.create",
    ok: true,
    detail: model ? `BROWSERBASE + ${model.modelName}` : "BROWSERBASE (goto-only)",
  });

  const sessionId = browser.sessionId ?? "stagehand-session";

  const pages = await browser.context.pages();
  const page = pages[0] ?? (await browser.context.newPage());

  await page.goto(
    `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  steps.push({ label: "maps.open", ok: true, detail: query });
  await page.waitForTimeout(2500);

  const fema = await browser.context.newPage(
    "https://msc.fema.gov/portal/home",
  );
  steps.push({ label: "fema.portal", ok: true });
  await fema.waitForLoadState("domcontentloaded").catch(() => undefined);

  if (model) {
    try {
      await browser.context.setActivePage(fema);
      await stagehand.act(
        `type "${query}" into the address search box and submit the search`,
        { page: fema },
      );
      steps.push({ label: "stagehand.act.fema_search", ok: true, detail: query });
      await fema.waitForTimeout(3000);
    } catch (e) {
      steps.push({
        label: "stagehand.act.fema_search",
        ok: false,
        detail: (e as Error).message,
      });
    }
  } else {
    steps.push({
      label: "stagehand.act.skipped",
      ok: true,
      detail:
        "No OPENAI/GOOGLE/ANTHROPIC key — used goto only; live view still active",
    });
  }

  const shot = path.join(STATE_DIR, `browse-${sessionId}.png`);
  try {
    const png = await page.screenshot({ fullPage: false });
    fs.writeFileSync(shot, png);
    steps.push({ label: "screenshot", ok: true, detail: shot });
  } catch {
    steps.push({ label: "screenshot", ok: false });
  }

  const live = await fetchFullscreenLiveView(apiKey, String(sessionId));
  const browse: BrowseSession = {
    sessionId: String(sessionId),
    liveViewUrl: liveViewUrl(String(sessionId), live.fullscreenUrl),
    debuggerUrl: live.debuggerUrl,
    status: keepOpen ? "running" : "done",
    steps,
    screenshotPath: fs.existsSync(shot) ? shot : undefined,
  };
  if (live.fullscreenUrl) {
    steps.push({ label: "liveview.fullscreen", ok: true, detail: live.fullscreenUrl });
  }

  fs.writeFileSync(
    path.join(STATE_DIR, keepOpen ? "screenshare-session.json" : "last-browse.json"),
    JSON.stringify(browse, null, 2),
  );

  if (!keepOpen) {
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
  } else {
    // Hold handles so the Browserbase session stays alive for Meet Present
    (globalThis as { __plus1Stagehand?: unknown }).__plus1Stagehand = stagehand;
    (globalThis as { __plus1BbBrowser?: unknown }).__plus1BbBrowser = browser;
  }

  return browse;
}

async function runWithCdp(
  target: BrowseTarget,
  apiKey: string,
  projectId: string,
  keepOpen: boolean,
): Promise<BrowseSession> {
  ensureDir(STATE_DIR);
  const query = formatQuery(target);
  const steps: BrowseSession["steps"] = [];
  const { session } = await createBbSession(apiKey, projectId);
  steps.push({ label: "session.create", ok: true, detail: session.id });

  const browse: BrowseSession = {
    sessionId: session.id,
    liveViewUrl: liveViewUrl(session.id),
    status: "running",
    steps,
  };

  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(
      `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    steps.push({ label: "maps.open", ok: true, detail: query });
    await page.waitForTimeout(2500);

    const fema = await context.newPage();
    await fema.goto("https://msc.fema.gov/portal/home", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    steps.push({ label: "fema.portal", ok: true });

    const live = await fetchFullscreenLiveView(apiKey, session.id);
    browse.liveViewUrl = liveViewUrl(session.id, live.fullscreenUrl);
    browse.debuggerUrl = live.debuggerUrl;
    if (live.fullscreenUrl) {
      steps.push({
        label: "liveview.fullscreen",
        ok: true,
        detail: live.fullscreenUrl,
      });
    }

    const shot = path.join(STATE_DIR, `browse-${session.id}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    browse.screenshotPath = shot;
    steps.push({ label: "screenshot", ok: true, detail: shot });
    browse.status = keepOpen ? "running" : "done";

    fs.writeFileSync(
      path.join(STATE_DIR, keepOpen ? "screenshare-session.json" : "last-browse.json"),
      JSON.stringify({ ...browse, connectUrl: session.connectUrl }, null, 2),
    );

    if (!keepOpen) {
      await browser.close();
    } else {
      (globalThis as { __plus1BbBrowser?: unknown }).__plus1BbBrowser = browser;
    }
    return browse;
  } catch (e) {
    browse.status = "error";
    browse.error = (e as Error).message;
    steps.push({ label: "error", ok: false, detail: browse.error });
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    return browse;
  }
}

export async function runBrowserbaseVerification(
  target: BrowseTarget,
): Promise<BrowseSession> {
  const apiKey = envOptional("BROWSERBASE_API_KEY");
  const projectId = envOptional("BROWSERBASE_PROJECT_ID");

  if (!apiKey || !projectId) {
    return {
      sessionId: "local-fallback",
      liveViewUrl: "",
      status: "error",
      steps: [
        {
          label: "credentials",
          ok: false,
          detail: "Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in .env",
        },
      ],
      error: "Browserbase credentials missing",
    };
  }

  try {
    return await runWithStagehand(target, apiKey, projectId, false);
  } catch (e) {
    const fallback = await runWithCdp(target, apiKey, projectId, false);
    fallback.steps.unshift({
      label: "stagehand.fallback_cdp",
      ok: true,
      detail: (e as Error).message,
    });
    return fallback;
  }
}

/**
 * Keep a Browserbase session open for Meet screenshare demos.
 */
export async function openWorkSessionForScreenshare(
  target: BrowseTarget,
): Promise<BrowseSession> {
  const apiKey = envOptional("BROWSERBASE_API_KEY");
  const projectId = envOptional("BROWSERBASE_PROJECT_ID");
  if (!apiKey || !projectId) {
    return openLocalWorkPreview(target);
  }

  try {
    return await runWithStagehand(target, apiKey, projectId, true);
  } catch (e) {
    try {
      const browse = await runWithCdp(target, apiKey, projectId, true);
      browse.steps.unshift({
        label: "stagehand.fallback_cdp",
        ok: true,
        detail: (e as Error).message,
      });
      return browse;
    } catch (e2) {
      const local = await openLocalWorkPreview(target);
      local.steps.unshift({
        label: "browserbase.failed",
        ok: false,
        detail: `${(e as Error).message}; ${(e2 as Error).message}`,
      });
      return local;
    }
  }
}

/**
 * Local headed Chrome fallback when Browserbase keys are missing.
 */
export async function openLocalWorkPreview(
  target: BrowseTarget,
): Promise<BrowseSession> {
  ensureDir(STATE_DIR);
  const query = formatQuery(target);
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  const femaUrl = "https://msc.fema.gov/portal/home";

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    if (process.platform === "darwin") {
      await execFileAsync("open", [
        "-na",
        "Google Chrome",
        "--args",
        "--new-window",
        mapsUrl,
      ]);
      await execFileAsync("open", [
        "-na",
        "Google Chrome",
        "--args",
        "--new-tab",
        femaUrl,
      ]);
    } else if (process.platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", mapsUrl]);
      await execFileAsync("cmd", ["/c", "start", "", femaUrl]);
    } else {
      await execFileAsync("xdg-open", [mapsUrl]);
      await execFileAsync("xdg-open", [femaUrl]);
    }
  } catch (e) {
    return {
      sessionId: "local-open-failed",
      liveViewUrl: mapsUrl,
      status: "error",
      steps: [{ label: "local.open", ok: false, detail: (e as Error).message }],
      error: (e as Error).message,
    };
  }

  const browse: BrowseSession = {
    sessionId: "local-chrome",
    liveViewUrl: mapsUrl,
    status: "running",
    steps: [
      { label: "local.maps", ok: true, detail: mapsUrl },
      { label: "local.fema", ok: true, detail: femaUrl },
      {
        label: "screenshare",
        ok: true,
        detail:
          "Present the Chrome Maps/FEMA window in Meet (add Browserbase keys for cloud live view)",
      },
    ],
  };
  fs.writeFileSync(
    path.join(STATE_DIR, "screenshare-session.json"),
    JSON.stringify(browse, null, 2),
  );
  return browse;
}
