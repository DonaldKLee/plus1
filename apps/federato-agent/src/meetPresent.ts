/**
 * Playwright: join Google Meet and Present the Browserbase live-view tab.
 *
 * Chrome's native share picker cannot be clicked from the page, so we
 * stamp the work tab title and pass --auto-select-tab-capture-source-by-title.
 * First run: sign into Google once in the headed window; the profile is reused.
 */

import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { CACHE_DIR, envOptional } from "./env.js";

export const WORK_TAB_TITLE = "plus1-work";

export interface MeetPresentResult {
  joined: boolean;
  presented: boolean;
  notes: string[];
}

function chromePath(): string | undefined {
  return (
    process.env.CHROME_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined)
  );
}

export function screenshareProfileDir(): string {
  return path.join(CACHE_DIR, "screenshare-profile");
}

export async function launchMeetChrome() {
  return chromium.launchPersistentContext(screenshareProfileDir(), {
    headless: false,
    executablePath: chromePath(),
    ignoreDefaultArgs: [
      "--enable-automation",
      "--disable-component-extensions-with-background-pages",
    ],
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled",
      `--auto-select-tab-capture-source-by-title=${WORK_TAB_TITLE}`,
      `--auto-select-desktop-capture-source=${WORK_TAB_TITLE}`,
    ],
    viewport: { width: 1440, height: 900 },
  });
}

/** Open the Playwright Chrome profile so you can sign into Google once. */
export async function openGoogleLogin(opts?: {
  timeoutMs?: number;
}): Promise<{ signedIn: boolean; notes: string[] }> {
  const notes: string[] = [];
  const timeoutMs = opts?.timeoutMs ?? 300_000;
  const context = await launchMeetChrome();
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://accounts.google.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  notes.push("Sign into Google in this Chrome window (the plus1 screenshare profile).");

  const deadline = Date.now() + timeoutMs;
  let signedIn = false;
  while (Date.now() < deadline) {
    const url = page.url();
    const accountChip = page.locator('a[href*="SignOutOptions"], img[data-profileindex], [aria-label*="Google Account"]').first();
    const looksSignedIn =
      /myaccount\.google\.com|mail\.google\.com|meet\.google\.com/.test(url) ||
      (await accountChip.isVisible().catch(() => false));
    if (looksSignedIn && !/ServiceLogin|signin\/v2|identifier/i.test(url)) {
      signedIn = true;
      notes.push("Google session saved. Next Join Meet will use this account.");
      break;
    }
    await page.waitForTimeout(1500);
  }

  if (!signedIn) {
    notes.push("Still waiting on sign-in — leave this window open and finish login.");
  }

  (globalThis as { __plus1MeetContext?: BrowserContext }).__plus1MeetContext = context;
  return { signedIn, notes };
}

async function clickNamed(page: Page, names: RegExp, timeout = 2500): Promise<boolean> {
  const btn = page.getByRole("button", { name: names }).first();
  try {
    await btn.waitFor({ state: "visible", timeout });
    await btn.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function dismissNoise(page: Page): Promise<void> {
  const dismiss = [
    /got it/i,
    /dismiss/i,
    /not now/i,
    /no thanks/i,
    /continue without (microphone|camera|mic)/i,
    /switch here/i,
  ];
  for (const name of dismiss) {
    await clickNamed(page, name, 800);
  }
}

async function stampWorkTitle(page: Page): Promise<void> {
  try {
    await page.evaluate((title) => {
      document.title = title;
      const keep = () => {
        if (document.title !== title) document.title = title;
      };
      keep();
      setInterval(keep, 1500);
    }, WORK_TAB_TITLE);
  } catch {
    /* page may still be loading */
  }
}

async function waitForGoogleSession(page: Page, notes: string[]): Promise<void> {
  const url = page.url();
  if (!/accounts\.google\.com|signin/i.test(url)) return;
  notes.push("Google sign-in required — complete it in the Chrome window (saved for next run).");
  try {
    await page.waitForURL(/meet\.google\.com/i, { timeout: 180_000 });
    notes.push("Signed in; continuing to Meet.");
  } catch {
    throw new Error("Timed out waiting for Google sign-in. Sign in once, then re-run.");
  }
}

async function clickJoinish(page: Page): Promise<string | null> {
  const names = [
    /join now/i,
    /ask to join/i,
    /rejoin/i,
    /join anyway/i,
    /join meeting/i,
    /join the meeting/i,
    /join the call/i,
    /switch here/i,
    /continue here/i,
    /continue$/i,
  ];
  for (const name of names) {
    if (await clickNamed(page, name, 2500)) return name.source;
  }
  const loose = page.locator("button, [role=button]").filter({ hasText: /join/i }).first();
  try {
    await loose.waitFor({ state: "visible", timeout: 4000 });
    await loose.click({ timeout: 2000 });
    return "button:has-text(join)";
  } catch {
    return null;
  }
}

async function dumpMeetDebug(page: Page, notes: string[]): Promise<void> {
  try {
    const shot = path.join(CACHE_DIR, "meet-join-debug.png");
    await page.screenshot({ path: shot, fullPage: true });
    notes.push(`Debug screenshot: ${shot}`);
    notes.push(`Meet URL now: ${page.url()}`);
    notes.push(`Title: ${await page.title()}`);
  } catch (e) {
    notes.push(`Debug dump failed: ${(e as Error).message}`);
  }
}

async function joinMeet(page: Page, notes: string[]): Promise<boolean> {
  await page.waitForLoadState("domcontentloaded");
  await waitForGoogleSession(page, notes);
  await page.waitForTimeout(2500);
  await dismissNoise(page);

  const nameBox = page.getByLabel(/your name/i).first();
  if (await nameBox.isVisible().catch(() => false)) {
    notes.push("Guest name field is showing — this profile is not signed into Google.");
    await nameBox.fill("plus1 UW");
  } else {
    notes.push("Signed-in Meet prejoin (no guest name field).");
  }

  await clickNamed(page, /turn off (microphone|mic)/i, 1200);
  await clickNamed(page, /turn off camera/i, 1200);
  await dismissNoise(page);

  const joinedAlready = await page
    .getByRole("button", { name: /leave call|end call/i })
    .first()
    .isVisible()
    .catch(() => false);
  if (joinedAlready) {
    notes.push("Already in the meeting.");
    return true;
  }

  const clicked = await clickJoinish(page);
  if (!clicked) {
    notes.push("Could not find a Join control.");
    await dumpMeetDebug(page, notes);
    return false;
  }
  notes.push(`Clicked join control: ${clicked}`);

  if (/ask to join/i.test(clicked)) {
    notes.push("Waiting for host admit.");
    try {
      await page
        .getByRole("button", { name: /leave call|end call|present now|share screen/i })
        .first()
        .waitFor({ state: "visible", timeout: 120_000 });
    } catch {
      notes.push("Still waiting to be admitted.");
      return false;
    }
  }

  try {
    await page
      .getByRole("button", { name: /leave call|end call|present now|share screen/i })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    notes.push("Join clicked but meeting chrome did not appear.");
    await dumpMeetDebug(page, notes);
    return false;
  }
  await dismissNoise(page);
  return true;
}

async function presentWorkTab(page: Page, notes: string[]): Promise<boolean> {
  const already = await page.getByText(/you('re| are) presenting/i).first().isVisible().catch(() => false);
  if (already) {
    notes.push("Already presenting.");
    return true;
  }

  const opened =
    (await clickNamed(page, /present now/i, 8000)) ||
    (await clickNamed(page, /share screen/i, 3000)) ||
    (await clickNamed(page, /^present$/i, 3000));
  if (!opened) {
    notes.push("Could not find Present now.");
    return false;
  }
  notes.push("Opened Present.");

  // Optional: pick "A tab" in Meet's chooser before Chrome's picker.
  await clickNamed(page, /^a tab$/i, 2500);
  await clickNamed(page, /chrome tab/i, 1200);
  await clickNamed(page, /^share$/i, 2500);

  // Flag should auto-accept the tab titled plus1-work.
  await page.waitForTimeout(2000);
  const presenting = await page
    .getByText(/you('re| are) presenting|stop presenting|presenting to everyone/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (presenting) {
    notes.push(`Presenting tab "${WORK_TAB_TITLE}" (Chrome auto-selected).`);
    return true;
  }
  notes.push(
    `Present picker may still be up — Chrome should auto-pick "${WORK_TAB_TITLE}". Click Share if needed.`,
  );
  return false;
}

export async function presentLiveViewInMeet(opts: {
  meetUrl: string;
  liveViewUrl: string;
}): Promise<MeetPresentResult> {
  const notes: string[] = [];
  const context = await launchMeetChrome();

  await context.grantPermissions(["camera", "microphone", "notifications"], {
    origin: "https://meet.google.com",
  });

  const work = context.pages()[0] ?? (await context.newPage());
  await work.goto(opts.liveViewUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await stampWorkTitle(work);
  notes.push("Opened Browserbase live view.");

  const meet = await context.newPage();
  await meet.goto(opts.meetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  notes.push(`Opened Meet ${opts.meetUrl}`);

  const joined = await joinMeet(meet, notes);
  let presented = false;
  if (joined) {
    await stampWorkTitle(work);
    presented = await presentWorkTab(meet, notes);
  }

  (globalThis as { __plus1MeetContext?: BrowserContext }).__plus1MeetContext = context;
  return { joined, presented, notes };
}

export function resolveMeetUrl(override?: string): string | undefined {
  const raw = override?.trim() || envOptional("MEET_URL");
  return raw && raw.length > 0 ? raw : undefined;
}
