/**
 * One-time Google sign-in for the work-cam Meet browser (Browserbase Context).
 *
 *   npm run backend:workcam-login
 *
 * Opens a cloud Chrome, prints a live-view URL — sign into Google there.
 * Cookies persist into WORKCAM_CONTEXT_ID so work-cam can join Meet signed-in
 * (anonymous guests are blocked on many Meets).
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright-core";
import { envOptional } from "./env.js";
import {
  ensureWorkCamContext,
  fetchLiveViewUrl,
  readWorkCamContextCache,
  writeWorkCamContextCache,
} from "./workCamContext.js";

async function main() {
  const apiKey = envOptional("BROWSERBASE_API_KEY");
  const projectId = envOptional("BROWSERBASE_PROJECT_ID");
  if (!apiKey || !projectId) {
    console.error("Need BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in .env");
    process.exit(1);
  }

  const bb = new Browserbase({ apiKey });
  const contextId = await ensureWorkCamContext();
  console.log(`Browserbase Context: ${contextId}`);
  console.log("(saved under apps/backend/cache/workcam-context.json)");
  console.log("");

  const session = await bb.sessions.create({
    projectId,
    keepAlive: true,
    browserSettings: {
      context: { id: contextId, persist: true },
      viewport: { width: 1280, height: 720 },
    },
  } as Parameters<typeof bb.sessions.create>[0] & { keepAlive?: boolean });

  const live = await fetchLiveViewUrl(session.id);
  console.log("1) Open this live view in your laptop browser:");
  console.log(`   ${live}`);
  console.log("");
  console.log("2) Sign into Google with an account that can join your Meet");
  console.log("   (different from the LiveAvatar goose if both are in the call).");
  console.log("");

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://accounts.google.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const rl = readline.createInterface({ input, output, terminal: true });
  console.log("When you're signed in (Google Account page / Gmail / Meet),");
  await rl.question("press Enter here to save the Context… ");
  rl.close();

  // Soft check
  const url = page.url();
  const looksSignedIn =
    /myaccount\.google\.com|mail\.google\.com|meet\.google\.com|accounts\.google\.com\/b\//i.test(
      url,
    ) || !(await page.getByLabel(/email|phone|identifier/i).first().isVisible().catch(() => false));

  if (!looksSignedIn) {
    console.log("WARN: page still looks like a login form — cookies may be empty.");
    console.log(`Current URL: ${url}`);
  } else {
    console.log(`Looks signed in at ${url}`);
  }

  // Closing with persist:true writes cookies back into the Context
  try {
    await bb.sessions.update(session.id, { status: "REQUEST_RELEASE" });
  } catch {
    /* ignore */
  }
  try {
    await browser.close();
  } catch {
    /* ignore */
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

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

// tsx resolves differently — always run when invoked as the CLI entry
if (process.argv[1]?.includes("workCamLogin")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
