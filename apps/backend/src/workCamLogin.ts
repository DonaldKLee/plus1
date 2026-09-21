/**
 * One-time Google sign-in for the work-cam Meet browser (Browserbase Context).
 *
 *   npm run backend:workcam-login
 *
 * Opens a cloud Chrome session, launches a *separate* headed Chrome window to the
 * Browserbase live-view (temp profile — never MEET_PROFILE_DIR), and waits for you
 * to sign into Google. Cookies persist into WORKCAM_CONTEXT_ID.
 *
 * Isolated from the normal plus1 demo (local Meet profile / LiveAvatar).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { ROOT, envOptional } from "./env.js";
import {
  ensureWorkCamContext,
  fetchLiveViewUrl,
  readWorkCamContextCache,
  writeWorkCamContextCache,
} from "./workCamContext.js";

const execFileAsync = promisify(execFile);

/** Prefer .env over a stale shell export (dotenv does not override by default). */
function refreshBrowserbaseEnvFromDotenv(): void {
  try {
    const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^(BROWSERBASE_(?:API_KEY|PROJECT_ID))=(.*)$/);
      if (!m) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* keep whatever is already set */
  }
}

function systemChromePath(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === "darwin") {
    const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Open the live-view URL in a headed Chrome that is NOT the Meet demo profile.
 * Tries: Playwright launch → `open -a` → plain `open`.
 */
async function openLiveViewWindow(
  url: string,
): Promise<{ kind: "playwright"; browser: Browser; context: BrowserContext } | { kind: "os" } | null> {
  const chrome = systemChromePath();
  const tmpProfile = path.join(os.tmpdir(), `plus1-workcam-login-${Date.now()}`);
  fs.mkdirSync(tmpProfile, { recursive: true });

  // 1) Headed Chrome via Playwright — most reliable on this machine
  try {
    const context = await chromium.launchPersistentContext(tmpProfile, {
      headless: false,
      executablePath: chrome,
      args: ["--new-window", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
      viewport: { width: 1280, height: 900 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    console.log("   → opened headed Chrome (temp profile, not Meet demo).");
    return { kind: "playwright", browser: context.browser()!, context };
  } catch (e) {
    console.log(`   → Playwright Chrome failed: ${(e as Error).message}`);
  }

  // 2) macOS open -a with full app path
  const attempts: { label: string; fn: () => Promise<void> }[] = [];
  if (process.platform === "darwin") {
    attempts.push({
      label: "open -a Google Chrome",
      fn: async () => {
        await execFileAsync("/usr/bin/open", ["-na", "Google Chrome", "--args", "--new-window", url]);
      },
    });
    attempts.push({
      label: "open URL",
      fn: async () => {
        await execFileAsync("/usr/bin/open", [url]);
      },
    });
  } else if (process.platform === "win32") {
    attempts.push({
      label: "start",
      fn: async () => {
        await execFileAsync("cmd", ["/c", "start", "", url]);
      },
    });
  } else {
    attempts.push({
      label: "xdg-open",
      fn: async () => {
        await execFileAsync("xdg-open", [url]);
      },
    });
  }

  for (const a of attempts) {
    try {
      await a.fn();
      console.log(`   → opened via ${a.label}.`);
      return { kind: "os" };
    } catch (e) {
      console.log(`   → ${a.label} failed: ${(e as Error).message}`);
    }
  }

  console.log("   → could not auto-open. Paste the URL above into Chrome.");
  return null;
}

async function main() {
  refreshBrowserbaseEnvFromDotenv();
  const apiKey = envOptional("BROWSERBASE_API_KEY");
  const projectId = envOptional("BROWSERBASE_PROJECT_ID");
  if (!apiKey || !projectId) {
    console.error("Need BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in .env");
    process.exit(1);
  }

  const bb = new Browserbase({ apiKey });
  const contextId = await ensureWorkCamContext();
  console.log(`Browserbase Context: ${contextId}`);
  console.log("(work-cam only — does not touch your Meet demo Chrome profile)");
  console.log("");

  const session = await bb.sessions.create({
    projectId,
    keepAlive: true,
    browserSettings: {
      context: { id: contextId, persist: true },
      viewport: { width: 1280, height: 720 },
    },
  } as Parameters<typeof bb.sessions.create>[0] & { keepAlive?: boolean });

  const live = await fetchLiveViewUrl(session.id, { waitMs: 20_000 });
  console.log("1) Live view (sign into Google in this window):");
  console.log(`   ${live}`);
  const viewer = await openLiveViewWindow(live);
  console.log("");
  console.log("2) Sign into Google with an account that can join your Meet");
  console.log("   (different from the LiveAvatar goose if both are in the call).");
  console.log("");

  // Also drive the cloud page to accounts.google.com so the live view shows login.
  const cloud = await chromium.connectOverCDP(session.connectUrl);
  const cloudCtx = cloud.contexts()[0] ?? (await cloud.newContext());
  const cloudPage = cloudCtx.pages()[0] ?? (await cloudCtx.newPage());
  await cloudPage.goto("https://accounts.google.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const rl = readline.createInterface({ input, output, terminal: true });
  console.log("When you're signed in (Google Account page / Gmail / Meet),");
  await rl.question("press Enter here to save the Context… ");
  rl.close();

  const url = cloudPage.url();
  const looksSignedIn =
    /myaccount\.google\.com|mail\.google\.com|meet\.google\.com|accounts\.google\.com\/b\//i.test(
      url,
    ) || !(await cloudPage.getByLabel(/email|phone|identifier/i).first().isVisible().catch(() => false));

  if (!looksSignedIn) {
    console.log("WARN: page still looks like a login form — cookies may be empty.");
    console.log(`Current URL: ${url}`);
  } else {
    console.log(`Looks signed in at ${url}`);
  }

  try {
    await bb.sessions.update(session.id, { status: "REQUEST_RELEASE" });
  } catch {
    /* ignore */
  }
  try {
    await cloud.close();
  } catch {
    /* ignore */
  }
  if (viewer?.kind === "playwright") {
    try {
      await viewer.context.close();
    } catch {
      /* ignore */
    }
  }

  const prev = readWorkCamContextCache();
  writeWorkCamContextCache({
    contextId,
    projectId,
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    signedInAt: new Date().toISOString(),
  });

  console.log("");
  console.log("Saved. Optional: add to .env");
  console.log(`  WORKCAM_CONTEXT_ID=${contextId}`);
  console.log("");
  console.log("Then: npm run backend:work-cam");
}

if (process.argv[1]?.includes("workCamLogin")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
