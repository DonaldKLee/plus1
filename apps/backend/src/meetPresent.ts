/**
 * Playwright: join Google Meet and Present from a dedicated plus1 Chrome profile.
 * Sign in once in that window — we do not hijack your daily Chrome (that hung).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { PROFILE_DIR, ROOT, STATE_DIR, ensureDir, envOptional } from "./env.js";

/**
 * On macOS, check if Google Chrome has Screen Recording permission.
 * Returns true if permission is granted or we can't determine (non-macOS).
 */
export function checkMacScreenRecordingPermission(): { ok: boolean; hint?: string } {
  if (process.platform !== "darwin") return { ok: true };
  try {
    // Query TCC database for Screen Recording permission for Chrome
    const result = execSync(
      `sqlite3 ~/Library/Application\\ Support/com.apple.TCC/TCC.db "SELECT auth_value FROM access WHERE service='kTCCServiceScreenCapture' AND client LIKE '%Chrome%'" 2>/dev/null || echo ""`,
      { encoding: "utf-8", timeout: 3000 },
    ).trim();
    // auth_value: 0=denied, 2=allowed. Empty = we can't read TCC (SIP) — don't scare.
    if (!result || result.includes("2")) return { ok: true };
    if (result.split(/\s+/).every((v) => v === "0")) {
      return {
        ok: false,
        hint: "Grant Screen Recording permission to Google Chrome:\n  System Settings → Privacy & Security → Screen Recording → Google Chrome ✓\n  Then restart Chrome.",
      };
    }
    return { ok: true };
  } catch {
    // Can't read TCC, assume ok and let runtime fail if needed
    return { ok: true };
  }
}

export const WORK_TAB_TITLE = "plus1-work";

/** goose = fake cam/mic for LiveAvatar; present = screenshare; avatar = both. */
export type MeetChromePurpose = "goose" | "present" | "avatar";

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

/** Chrome profile the plus1/presenter joins with. MEET_PROFILE_DIR (relative to repo root) overrides. */
export function screenshareProfileDir(): string {
  const override = envOptional("MEET_PROFILE_DIR");
  return override ? path.resolve(ROOT, override) : PROFILE_DIR;
}

function clearSingletonLocks(): void {
  const dir = screenshareProfileDir();
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      /* nothing to clear */
    }
  }
}

function chromeArgs(purpose: MeetChromePurpose): string[] {
  const args = [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-blink-features=AutomationControlled",
  ];
  if (purpose === "goose") {
    args.push("--use-fake-ui-for-media-stream");
    return args;
  }
  // Present / avatar: real tab capture for screensharing the BB live-view tab.
  args.push(
    "--enable-usermedia-screen-capturing",
    "--allow-http-screen-capture",
    `--auto-select-tab-capture-source-by-title=${WORK_TAB_TITLE}`,
    `--auto-select-desktop-capture-source=${WORK_TAB_TITLE}`,
  );
  // Avatar: same Present flags, no --use-fake-ui-for-media-stream.
  // That flag auto-picks a fake camera for getDisplayMedia and screenshare never starts.
  // Camera/mic for LiveAvatar come from grantPermissions + the in-page fake devices.
  return args;
}

async function launchOnce(purpose: MeetChromePurpose) {
  clearSingletonLocks();
  return chromium.launchPersistentContext(screenshareProfileDir(), {
    headless: false,
    executablePath: chromePath(),
    bypassCSP: purpose === "goose" || purpose === "avatar",
    ignoreDefaultArgs: [
      "--enable-automation",
      "--disable-component-extensions-with-background-pages",
    ],
    args: chromeArgs(purpose),
    viewport: { width: 1440, height: 900 },
  });
}

export async function launchMeetChrome(opts?: { purpose?: MeetChromePurpose }) {
  const purpose = opts?.purpose ?? "goose";
  try {
    return await launchOnce(purpose);
  } catch (e) {
    const msg = (e as Error).message;
    if (/existing browser session|SingletonLock|already in use/i.test(msg)) {
      clearSingletonLocks();
      return await launchOnce(purpose);
    }
    throw e;
  }
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

export async function stampWorkTitle(page: Page): Promise<void> {
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
  // Prefer exact Meet prejoin controls — Ask to join / Join now — via role+name.
  const preferred = [
    page.getByRole("button", { name: /^ask to join$/i }),
    page.getByRole("button", { name: /^join now$/i }),
    page.getByRole("button", { name: /^join$/i }),
    page.locator('button[jsname="Qx7uuf"]').first(), // Meet's common Join/Ask control
  ];
  for (const loc of preferred) {
    try {
      const btn = loc.first();
      if (!(await btn.isVisible().catch(() => false))) continue;
      const label =
        (await btn.getAttribute("aria-label").catch(() => null)) ||
        (await btn.innerText().catch(() => null)) ||
        "join";
      await btn.click({ timeout: 2000 });
      return label.trim().slice(0, 40) || "join";
    } catch {
      /* try next */
    }
  }

  const names = [
    /ask to join/i,
    /join now/i,
    /rejoin/i,
    /join anyway/i,
    /join meeting/i,
    /join the meeting/i,
    /join the call/i,
    /switch here/i,
    /continue here/i,
  ];
  for (const name of names) {
    if (await clickNamed(page, name, 1200)) return name.source;
  }
  return null;
}

async function dumpMeetDebug(page: Page, notes: string[]): Promise<void> {
  try {
    const shot = path.join(ensureDir(STATE_DIR), "meet-join-debug.png");
    await page.screenshot({ path: shot, fullPage: true });
    notes.push(`Debug screenshot: ${shot}`);
    notes.push(`Meet URL now: ${page.url()}`);
    notes.push(`Title: ${await page.title()}`);
  } catch (e) {
    notes.push(`Debug dump failed: ${(e as Error).message}`);
  }
}

export interface JoinOptions {
  /** Join muted (presenter) or unmuted (the plus1). Default muted. */
  muted?: boolean;
  /** "on": camera stays on — it's the avatar. Default "off". */
  camera?: "on" | "off";
  /** Guest display name if the profile isn't signed in. */
  displayName?: string;
  /**
   * Stop on the prejoin screen after mic/cam are set — do not click Join yet.
   * Caller starts media (e.g. work-cam screencast), then calls awaitMeetAdmission().
   */
  deferJoin?: boolean;
  /** If false, do not join as a guest (Meet will refuse anonymous). Default true. */
  allowGuest?: boolean;
}

export async function joinMeet(page: Page, notes: string[], opts: JoinOptions = {}): Promise<boolean> {
  const muted = opts.muted !== false; // default: join muted
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await waitForGoogleSession(page, notes);
  // Short settle only — used to sleep 2.5s before every join.
  await page.waitForTimeout(400);
  await dismissNoise(page);

  const nameBox = page.getByLabel(/your name/i).first();
  if (await nameBox.isVisible().catch(() => false)) {
    notes.push("Guest name field is showing — this plus1 Chrome is not signed into Google.");
    if (opts.allowGuest === false) {
      notes.push("SIGN IN in this Chrome window (your Google account). Waiting 3 minutes…");
      await clickNamed(page, /sign in/i, 3000);
      const until = Date.now() + 180_000;
      while (Date.now() < until) {
        const stillGuest = await nameBox.isVisible().catch(() => false);
        if (!stillGuest && !/accounts\.google\.com|signin/i.test(page.url())) {
          notes.push("Signed in — continuing.");
          break;
        }
        await page.waitForTimeout(1500);
      }
      if (await nameBox.isVisible().catch(() => false)) {
        notes.push("Still a guest after 3 minutes — not joining anonymously.");
        return false;
      }
    } else {
      await nameBox.fill(opts.displayName ?? "plus1 UW");
    }
  } else {
    notes.push("Signed-in Meet prejoin (no guest name field).");
  }

  // Camera always off. Mic off only if requested — the plus1 joins unmuted so
  // it can speak (its BlackHole mic is silent until it plays a reply).
  const mods = process.platform === "darwin" ? "Meta" : "Control";
  if (muted) {
    if (!(await clickNamed(page, /turn off (microphone|mic)/i, 1200))) {
      await page.keyboard.press(`${mods}+d`).catch(() => {});
    }
    notes.push(opts.deferJoin ? "Prejoin: mic off." : "Joined muted.");
  } else {
    notes.push("Joining unmuted so the plus1 can speak.");
  }
  if (opts.camera === "on") {
    // The plus1: the camera is the avatar. Only click "Turn on camera" if Meet shows it.
    if (await clickNamed(page, /turn on camera/i, 1000)) notes.push("Camera was off; turned on.");
    if (!muted && (await clickNamed(page, /turn on (microphone|mic)/i, 1000))) notes.push("Mic was off; turned on.");
  } else if (!(await clickNamed(page, /turn off camera/i, 1200))) {
    await page.keyboard.press(`${mods}+e`).catch(() => {});
  }
  await dismissNoise(page);

  if (opts.deferJoin) {
    notes.push("Prejoin ready — not joining yet (waiting for camera stream).");
    return true;
  }

  return awaitMeetAdmission(page, notes, { camera: opts.camera });
}

/** Click Join / Ask to join and wait until actually in the call (or refused). */
export async function awaitMeetAdmission(
  page: Page,
  notes: string[],
  opts: { camera?: "on" | "off"; timeoutMs?: number } = {},
): Promise<boolean> {
  const inMeeting = () =>
    page
      .getByRole("button", { name: /leave call|end call|present now|share screen/i })
      .first()
      .isVisible()
      .catch(() => false);

  if (await inMeeting()) {
    notes.push("Already in the meeting.");
    return true;
  }

  const refused = page.getByText(/can't join this video call|you can.t join|denied your request|no one responded/i).first();

  const deadline = Date.now() + (opts.timeoutMs ?? (opts.camera === "on" ? 180_000 : 60_000));
  let clickedOnce: string | null = null;
  while (Date.now() < deadline) {
    if (await inMeeting()) {
      await dismissNoise(page);
      notes.push("In the meeting.");
      return true;
    }
    if (await refused.isVisible().catch(() => false)) {
      notes.push("Meet refused the join: the host denied/ignored the request, or this meeting blocks anonymous guests. Sign the profile into Google (npm run google-login) and try again.");
      return false;
    }
    const clicked = await clickJoinish(page);
    if (clicked) {
      if (clicked !== clickedOnce) notes.push(`Clicked join control: ${clicked}`);
      clickedOnce = clicked;
      if (/ask to join/i.test(clicked)) notes.push("Asked to join — waiting for the host to admit.");
    }
    await dismissNoise(page);
    await page.waitForTimeout(2000);
  }

  if (await inMeeting()) {
    await dismissNoise(page);
    notes.push("In the meeting.");
    return true;
  }

  notes.push(
    clickedOnce
      ? "Join clicked but the meeting did not open (still waiting to be admitted?)."
      : "Could not find a Join control on this page.",
  );
  await dumpMeetDebug(page, notes);
  return false;
}

/** Click Present / Share screen. Local Chrome can actually share; BB cloud cannot. */
export async function presentWorkTab(page: Page, notes: string[]): Promise<boolean> {
  // Check macOS TCC permission first
  const tcc = checkMacScreenRecordingPermission();
  if (!tcc.ok && tcc.hint) {
    notes.push(`⚠️  macOS Screen Recording not granted:\n${tcc.hint}`);
  }

  const already = await page.getByText(/you('re| are) presenting/i).first().isVisible().catch(() => false);
  if (already) {
    notes.push("Already presenting.");
    return true;
  }

  // Clear a leftover failure dialog from a prior attempt
  const shareFail = page.getByText(/can't share your screen|something went wrong when screen sharing/i).first();
  if (await shareFail.isVisible().catch(() => false)) {
    await clickNamed(page, /^ok$/i, 2000);
    notes.push("Dismissed prior Can't share dialog.");
  }

  const attempt = async (attemptNum: number): Promise<boolean> => {
    notes.push(`Present attempt ${attemptNum}...`);
    
    const opened =
      (await clickNamed(page, /present now/i, 8000)) ||
      (await clickNamed(page, /share screen/i, 3000)) ||
      (await clickNamed(page, /^present$/i, 3000));
    if (!opened) {
      notes.push("Could not find Present now button.");
      return false;
    }
    notes.push("Clicked Present now.");

    // Wait a moment for the picker menu to appear
    await page.waitForTimeout(800);

    // Click "A tab" to select tab capture mode
    const clickedTab = await clickNamed(page, /^a tab$/i, 3000) || await clickNamed(page, /chrome tab/i, 2000);
    if (clickedTab) {
      notes.push("Selected 'A tab' option.");
    }

    // The Chrome picker should now appear with auto-selected tab by title flag.
    // Wait for picker and try clicking Share
    await page.waitForTimeout(1500);
    
    const clickedShare = await clickNamed(page, /^share$/i, 4000);
    if (clickedShare) {
      notes.push("Clicked Share in picker.");
    }

    // Give Meet time to process
    await page.waitForTimeout(3000);

    const presenting = await page
      .getByText(/you('re| are) presenting|stop presenting|presenting to everyone/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (presenting) {
      notes.push(`✓ Presenting tab "${WORK_TAB_TITLE}" (auto-selected by Chrome flag).`);
      return true;
    }

    // Check for specific error states
    if (await shareFail.isVisible().catch(() => false)) {
      await clickNamed(page, /^ok$/i, 2000);
      notes.push("Meet said 'Can't share your screen' — likely TCC permission issue on macOS.");
      if (tcc.hint) notes.push(tcc.hint);
      return false;
    }

    // Check if the picker is still showing (user needs to click)
    const pickerVisible = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
    if (pickerVisible) {
      notes.push(
        `Present picker still visible — Chrome should auto-select "${WORK_TAB_TITLE}".\n` +
        `If not auto-selected: look for the tab titled "${WORK_TAB_TITLE}" and click Share.`,
      );
    }
    return false;
  };

  // Try up to 2 times
  if (await attempt(1)) return true;
  await page.waitForTimeout(1000);
  if (await attempt(2)) return true;

  // Final check
  const presenting = await page
    .getByText(/you('re| are) presenting|stop presenting/i)
    .first()
    .isVisible()
    .catch(() => false);
  return presenting;
}

/** Click Meet's "Stop presenting" / "Stop sharing" so the plus1 leaves the share. */
export async function stopPresentingWorkTab(page: Page, notes: string[] = []): Promise<boolean> {
  const presenting = await page
    .getByText(/you('re| are) presenting|stop presenting|presenting to everyone|you are sharing/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (!presenting) {
    notes.push("Not presenting — nothing to stop.");
    return true;
  }

  const stopped =
    (await clickNamed(page, /stop presenting/i, 4000)) ||
    (await clickNamed(page, /stop sharing/i, 3000)) ||
    (await clickNamed(page, /^stop$/i, 2000));

  if (!stopped) {
    notes.push("Could not find Stop presenting.");
    return false;
  }
  notes.push("Clicked Stop presenting.");
  await page.waitForTimeout(1500);

  const still = await page
    .getByText(/you('re| are) presenting|stop presenting|presenting to everyone/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (still) {
    notes.push("Still showing as presenting after stop click.");
    return false;
  }
  notes.push("Stopped presenting.");
  return true;
}

/**
 * First names from the Meet *page* DOM (local Playwright Chrome — not Browserbase).
 *
 * Deterministic queries from a live Meet dump (no People-panel clicks):
 *   [role=list][aria-label=Participants] > [role=listitem][data-participant-id]
 *     → aria-label / span.zWGUib  (e.g. "Vaibhav Sharma")
 *   button[aria-label^="More options for "]
 *   span.notranslate on the self tile
 *
 * The Chrome profile is often the human's Google account, so that person shows
 * as "(You)". Prefer remotes; if none, use self's first name so we still greet
 * "Hi Vaibhav" instead of "everyone".
 */
const MEET_UI_NAME_BLOCK = new Set(
  [
    "you",
    "me",
    "devices",
    "device",
    "plus1",
    "shannon",
    "everyone",
    "host",
    "guest",
    "unknown",
    "anonymous",
  ].map((s) => s.toLowerCase()),
);

function looksLikePersonFirstName(first: string): boolean {
  const f = first.trim();
  if (f.length < 2 || f.length > 24) return false;
  if (MEET_UI_NAME_BLOCK.has(f.toLowerCase())) return false;
  if (!/^[A-Za-z][a-zA-Z'’-]*$/.test(f)) return false;
  return true;
}

function titleFirst(name: string): string {
  const n = name.trim();
  if (!n) return n;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function firstNameOf(full: string, exclude: Set<string>): string | null {
  const cleaned = full.trim();
  if (!cleaned || MEET_UI_NAME_BLOCK.has(cleaned.toLowerCase())) return null;
  const first = cleaned.split(/\s+/)[0] ?? cleaned;
  if (!looksLikePersonFirstName(first)) return null;
  if (exclude.has(first.toLowerCase()) || exclude.has(cleaned.toLowerCase())) return null;
  return titleFirst(first);
}

export async function listMeetParticipantNames(
  page: Page,
  opts?: { exclude?: string[] },
): Promise<string[]> {
  if (page.isClosed()) return [];
  const exclude = new Set(
    (opts?.exclude ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  exclude.add("you");
  exclude.add("me");

  try {
    // Never open/close the People side panel — read whatever Meet already rendered.
    const raw = await page.evaluate(() => {
      const out: { name: string; self: boolean }[] = [];
      const seen = new Set<string>();
      const add = (name: string, self: boolean) => {
        const n = name.replace(/\s*\(you\)/i, "").replace(/\s+/g, " ").trim();
        if (n.length < 2 || n.length > 48) return;
        const key = n.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ name: n, self });
      };

      for (const el of document.querySelectorAll<HTMLElement>(
        'div[role="list"][aria-label="Participants"] > div[role="listitem"][data-participant-id], div[role="listitem"][data-participant-id][aria-label]',
      )) {
        const label = (el.getAttribute("aria-label") || "").trim();
        const named = (el.querySelector("span.zWGUib")?.textContent || "").replace(/\s+/g, " ").trim();
        const name = label || named;
        if (!name) continue;
        const self =
          !!el.querySelector(".NnTWjc") ||
          /\(you\)/i.test(el.textContent || "") ||
          /\(you\)/i.test(name);
        add(name, self);
      }

      for (const span of document.querySelectorAll<HTMLElement>("span.zWGUib")) {
        if (span.offsetParent === null) continue;
        const name = (span.textContent || "").replace(/\s+/g, " ").trim();
        if (!name) continue;
        const row = span.closest("[data-participant-id], [role='listitem']");
        const self =
          !!row?.querySelector(".NnTWjc") ||
          /\(you\)/i.test(row?.textContent || "") ||
          /\(you\)/i.test(span.parentElement?.textContent || "");
        add(name, self);
      }

      // Tile / overflow menu: aria-label="More options for Vaibhav Sharma"
      for (const btn of document.querySelectorAll<HTMLElement>('button[aria-label^="More options for "]')) {
        const label = (btn.getAttribute("aria-label") || "").replace(/^More options for\s+/i, "").trim();
        if (!label) continue;
        add(label, false);
      }

      // Self tile chip: <span class="notranslate">Vaibhav Sharma</span>
      for (const span of document.querySelectorAll<HTMLElement>("span.notranslate")) {
        if (span.offsetParent === null) continue;
        const name = (span.textContent || "").replace(/\s+/g, " ").trim();
        if (!name || name.length > 48) continue;
        if (!/^[A-Za-z]/.test(name)) continue;
        add(name, true);
      }

      return out;
    });

    const remotes: string[] = [];
    const selves: string[] = [];
    for (const row of raw) {
      const nice = firstNameOf(row.name, exclude);
      if (!nice) continue;
      const bucket = row.self ? selves : remotes;
      if (!bucket.some((x) => x.toLowerCase() === nice.toLowerCase())) bucket.push(nice);
    }
    // Remotes first; if the roster only has (You) — same Google account as the human — use that.
    return (remotes.length ? remotes : selves).slice(0, 12);
  } catch {
    return [];
  }
}

/** Hang up the Meet call (click Leave call), then the caller can close Chrome. */
export async function leaveMeetCall(page: Page, notes: string[] = []): Promise<boolean> {
  if (page.isClosed()) {
    notes.push("Meet page already closed.");
    return true;
  }
  const url = page.url();
  if (!/meet\.google\.com/i.test(url)) {
    notes.push("Not on a Meet page — nothing to leave.");
    return true;
  }

  // Already back on the post-call / prejoin screen?
  const leftAlready = await page
    .getByText(/you left the meeting|return to home|rejoin|ready to join/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (leftAlready) {
    notes.push("Already left the meeting.");
    return true;
  }

  const clicked =
    (await clickNamed(page, /leave call/i, 4000)) ||
    (await clickNamed(page, /end call/i, 2500)) ||
    (await clickNamed(page, /^leave$/i, 2000));

  if (!clicked) {
    // Sometimes the leave control is an icon button with aria-label only.
    const icon = page.locator('[aria-label*="Leave call" i], [data-tooltip*="Leave call" i], button[aria-label*="Leave" i]').first();
    try {
      await icon.waitFor({ state: "visible", timeout: 2500 });
      await icon.click({ timeout: 2000 });
      notes.push("Clicked Leave via aria-label.");
    } catch {
      notes.push("Could not find Leave call — will close the browser instead.");
      return false;
    }
  } else {
    notes.push("Clicked Leave call.");
  }

  // Meet sometimes asks "Leave without sending feedback?" / confirm.
  await page.waitForTimeout(400);
  await clickNamed(page, /leave without|just leave|^leave$/i, 1500);
  await clickNamed(page, /^ok$/i, 800);

  await page.waitForTimeout(800);
  return true;
}

export async function presentLiveViewInMeet(opts: {
  meetUrl: string;
  liveViewUrl: string;
}): Promise<MeetPresentResult> {
  const notes: string[] = [];
  const context = await launchMeetChrome({ purpose: "present" });

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
