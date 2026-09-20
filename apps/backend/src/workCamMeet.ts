/**
 * Work-cam: stream Browserbase work into Meet two ways —
 *   local  — Meet in local Chrome; Present/screenshare (getDisplayMedia works)
 *   cloud  — Meet on Browserbase; Browserbase on the camera tile
 *
 *   npm run backend:work-cam
 */

import Browserbase from "@browserbasehq/sdk";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright-core";
import { envOptional } from "./env.js";
import {
  awaitMeetAdmission,
  checkMacScreenRecordingPermission,
  joinMeet,
  launchMeetChrome,
  presentWorkTab,
  stampWorkTitle,
  WORK_TAB_TITLE,
} from "./meetPresent.js";
import {
  WORK_CAM_EARLY_SCRIPT,
  WORK_CAM_H,
  WORK_CAM_REHOOK_SCRIPT,
  WORK_CAM_W,
} from "./workCamEarly.js";
import {
  fetchLiveViewUrl,
  getWorkCamContextId,
} from "./workCamContext.js";
import { onJevLiveView, startWorkBrowser } from "./jevAgent.js";
import {
  loadWorkCamConfig,
  type WorkCamMode,
  workCamModeLabel,
} from "./workCamConfig.js";

const NAME_SHIM = "window.__name = window.__name || function (t) { return t; };";

/** Notes array that prints each entry to the terminal as it's added. */
function createLiveNotes(t0 = Date.now()): string[] {
  const notes: string[] = [];
  notes.push = ((...items: string[]) => {
    for (const item of items) {
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  [${sec}s] ${item}`);
    }
    return Array.prototype.push.apply(notes, items as string[]);
  }) as typeof notes.push;
  return notes;
}

export interface WorkCamSession {
  id: string;
  meetUrl: string;
  /** local = Present/screenshare; cloud = camera tile */
  mode: WorkCamMode;
  /** Browserbase session whose pages we screencast (Agents / work). */
  workSessionId?: string;
  /** Browserbase session that joined Meet (cloud mode only). */
  meetSessionId?: string;
  /** Live view of the Meet bot (cloud — Meet UI for debugging join). */
  liveViewUrl?: string;
  /** Live view of the work/agent browser (Maps etc. — watch this for content). */
  workLiveViewUrl?: string;
  status: "starting" | "joining" | "streaming" | "ended" | "error";
  notes: string[];
  joined: boolean;
  startedAt: number;
}

export interface StartWorkCamOpts {
  meetUrl: string;
  /** Override saved config for this run. */
  mode?: WorkCamMode;
  sessionId?: string;
  connectUrl?: string;
  task?: string;
  startUrl?: string;
}

type Internal = WorkCamSession & {
  meetBrowser?: Browser;
  /** Local persistent Chrome context (local mode). */
  meetContext?: BrowserContext;
  workBrowser?: Browser;
  meetPage?: Page;
  /** Local mode: visible tab Chrome Present captures (title = plus1-work). */
  workPreviewPage?: Page;
  cdp?: CDPSession;
  stopPump?: () => void;
};

const sessions = new Map<string, Internal>();

function bbClient(): { bb: Browserbase; apiKey: string; projectId: string } {
  const apiKey = envOptional("BROWSERBASE_API_KEY");
  const projectId = envOptional("BROWSERBASE_PROJECT_ID");
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required");
  }
  return { bb: new Browserbase({ apiKey }), apiKey, projectId };
}

/** Resolve the Browserbase work session: existing id, or jev running `task`. */
async function resolveWorkSession(
  opts: StartWorkCamOpts,
  notes: string[],
): Promise<{ sessionId: string; liveViewUrl: string; connectUrl?: string }> {
  if (opts.sessionId) {
    const liveViewUrl = await fetchLiveViewUrl(opts.sessionId);
    notes.push(`Using existing work session ${opts.sessionId}`);
    return { sessionId: opts.sessionId, liveViewUrl, connectUrl: opts.connectUrl };
  }
  const task = opts.task?.trim();
  const work = await startWorkBrowser(notes, task);
  return {
    sessionId: work.sessionId,
    liveViewUrl: work.liveViewUrl,
    connectUrl: work.connectUrl,
  };
}

/**
 * Local headed Chrome — opens the Browserbase live-view in a tab, then Presents it.
 * Chrome is launched via launchMeetChrome with "present" purpose (correct flags).
 */
async function createLocalMeetBrowser(notes: string[]): Promise<{
  context: BrowserContext;
  meetPage: Page;
  workPage: Page;
}> {
  const context = await launchMeetChrome({ purpose: "present" });
  await context.addInitScript({ content: NAME_SHIM });
  await context.grantPermissions(["microphone", "camera", "notifications"], {
    origin: "https://meet.google.com",
  });

  // Work tab first (will hold Browserbase live-view)
  const workPage = context.pages()[0] ?? (await context.newPage());
  await stampWorkTitle(workPage);
  notes.push(`Work tab titled "${WORK_TAB_TITLE}" — will open BB live-view here`);

  const meetPage = await context.newPage();
  notes.push("Local Chrome Meet — plus1 profile (sign in once if asked)");
  return { context, meetPage, workPage };
}

/** Cloud Meet on Browserbase — camera path only (Present fails on BB cloud). */
async function createCloudMeetBrowser(notes: string[]): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
  sessionId: string;
  liveViewUrl?: string;
}> {
  const { bb, projectId } = bbClient();
  const contextId = getWorkCamContextId();
  if (!contextId) {
    throw new Error(
      "No Google login for cloud Meet. Run: npm run backend:workcam-login",
    );
  }
  notes.push(`Using Browserbase Context ${contextId} (signed-in Google)`);

  const session = await bb.sessions.create({
    projectId,
    keepAlive: true,
    browserSettings: {
      blockAds: true,
      viewport: { width: WORK_CAM_W, height: WORK_CAM_H },
      context: { id: contextId, persist: true },
    },
  } as Parameters<typeof bb.sessions.create>[0] & { keepAlive?: boolean });
  notes.push(`Created Meet session ${session.id} (cloud, signed-in context)`);

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());

  await context.addInitScript({ content: NAME_SHIM });
  await context.addInitScript({ content: WORK_CAM_EARLY_SCRIPT });
  await context.grantPermissions(["microphone", "camera", "notifications"], {
    origin: "https://meet.google.com",
  });

  const page = context.pages()[0] ?? (await context.newPage());
  const liveViewUrl = await fetchLiveViewUrl(session.id);
  notes.push(`Meet live view (operator): ${liveViewUrl}`);

  return {
    browser,
    context,
    page,
    sessionId: session.id,
    liveViewUrl,
  };
}

async function startScreencastPump(
  bbPage: Page,
  targetPage: Page,
  notes: string[],
): Promise<{ cdp: CDPSession; stop: () => void; waitForFrame: () => Promise<void> }> {
  // Exact match to target canvas → 1:1 blit (less lag)
  await bbPage.setViewportSize({ width: WORK_CAM_W, height: WORK_CAM_H }).catch(() => undefined);

  const cdp = await bbPage.context().newCDPSession(bbPage);
  let stopped = false;
  let frames = 0;
  let inFlight = false;
  let latest: string | null = null;
  let firstFrame!: () => void;
  const gotFirstFrame = new Promise<void>((r) => {
    firstFrame = r;
  });

  const flush = () => {
    if (stopped || inFlight || !latest) return;
    const data = latest;
    latest = null;
    inFlight = true;
    void targetPage
      .evaluate((b64) => {
        const w = window as unknown as { __plus1WorkCam?: { drawJpeg(s: string): void } };
        w.__plus1WorkCam?.drawJpeg(b64);
      }, data)
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (latest) flush();
      });
  };

  cdp.on("Page.screencastFrame", (evt) => {
    const { data, sessionId } = evt as { data: string; sessionId: number };
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
    if (stopped) return;
    latest = data; // coalesce — never queue old frames
    frames++;
    if (frames === 1) firstFrame();
    flush();
  });

  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    maxWidth: WORK_CAM_W,
    maxHeight: WORK_CAM_H,
    everyNthFrame: 1,
  });
  notes.push(
    `CDP screencast ${WORK_CAM_W}x${WORK_CAM_H} q85 → camera (stretch-fill, no letterbox)`,
  );

  const stop = () => {
    stopped = true;
    void cdp.send("Page.stopScreencast").catch(() => undefined);
    notes.push(`Screencast stopped after ${frames} frames`);
  };

  const waitForFrame = async () => {
    const timeout = new Promise<void>((_, rej) =>
      setTimeout(() => rej(new Error("no screencast frame within 15s")), 15_000),
    );
    await Promise.race([gotFirstFrame, timeout]);
    notes.push("First frame on camera canvas");
  };

  return { cdp, stop, waitForFrame };
}

async function rehookMeetMedia(page: Page, notes: string[]): Promise<void> {
  const result = await page.evaluate(WORK_CAM_REHOOK_SCRIPT).catch((e) => ({
    ok: false,
    reason: (e as Error).message,
  }));
  notes.push(
    result && typeof result === "object" && "ok" in (result as object) && (result as { ok: boolean }).ok
      ? "Re-installed getUserMedia hooks"
      : `Media rehook: ${JSON.stringify(result)}`,
  );
}

async function dismissMeetNoise(page: Page): Promise<void> {
  for (const name of [/^ok$/i, /^got it$/i, /^dismiss$/i, /^close$/i]) {
    const b = page.getByRole("button", { name }).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 1500 }).catch(() => undefined);
    }
  }
  // "Can't share your screen" dialog
  const shareFail = page.getByText(/can't share your screen|something went wrong when screen sharing/i).first();
  if (await shareFail.isVisible().catch(() => false)) {
    const ok = page.getByRole("button", { name: /^ok$/i }).first();
    await ok.click({ timeout: 2000 }).catch(() => undefined);
  }
}

/**
 * Put Browserbase on the Meet camera tile (cloud mode).
 * Present/getDisplayMedia fails on Browserbase cloud Chrome ("Can't share your screen").
 */
async function turnOnWorkCamera(page: Page, notes: string[]): Promise<boolean> {
  await dismissMeetNoise(page);
  await rehookMeetMedia(page, notes);

  // Already on?
  if (await page.getByRole("button", { name: /turn off camera/i }).first().isVisible().catch(() => false)) {
    notes.push("Camera already on");
    return true;
  }

  const camOn = page.getByRole("button", { name: /turn on camera/i }).first();
  if (await camOn.isVisible().catch(() => false)) {
    await camOn.click({ timeout: 5000 }).catch(() => undefined);
    notes.push("Clicked Turn on camera");
  } else {
    // JS fallback — Meet sometimes hides the label
    const clicked = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("button, [role='button']")];
      for (const el of nodes) {
        const t = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.toLowerCase();
        if (/turn on camera|start camera|camera off/.test(t) && !/turn off camera/.test(t)) {
          (el as HTMLElement).click();
          return t.slice(0, 60);
        }
      }
      return null;
    });
    if (clicked) notes.push(`Camera click via DOM: ${clicked}`);
  }

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await dismissMeetNoise(page);
    const off = await page
      .getByRole("button", { name: /turn off camera/i })
      .first()
      .isVisible()
      .catch(() => false);
    const gum = await page
      .evaluate(() => {
        const w = window as unknown as { __plus1WorkCam?: { gumCalls?: number } };
        return w.__plus1WorkCam?.gumCalls ?? 0;
      })
      .catch(() => 0);
    if (off) {
      notes.push(`Camera on (getUserMedia calls=${gum}) — Browserbase on cam tile`);
      return true;
    }
    await page.waitForTimeout(400);
  }
  notes.push("Camera did not turn on");
  return false;
}

/**
 * Present the plus1-work tab (BB live view). Tab capture — not Entire screen.
 */
async function startLocalPresent(meetPage: Page, workPage: Page, notes: string[]): Promise<boolean> {
  await dismissMeetNoise(meetPage);
  
  // Ensure work tab has the correct title (stamp multiple times for reliability)
  await stampWorkTitle(workPage);
  const workTitle = await workPage.title().catch(() => "");
  notes.push(`Work tab title: "${workTitle}" (should be "${WORK_TAB_TITLE}")`);
  if (workTitle !== WORK_TAB_TITLE) {
    notes.push("Re-stamping work tab title...");
    await stampWorkTitle(workPage);
    await workPage.waitForTimeout(500);
  }
  
  // Bring Meet to front for the Present action
  await meetPage.bringToFront().catch(() => undefined);
  notes.push("Meet page in front, starting Present...");
  
  const ok = await presentWorkTab(meetPage, notes);
  return ok;
}

async function startLocalPresentFlow(
  record: Internal,
  opts: StartWorkCamOpts,
  notes: string[],
): Promise<WorkCamSession> {
  notes.push("Local Present: plus1 Chrome profile (sign in once in that window)");

  // Early TCC check on macOS
  const tcc = checkMacScreenRecordingPermission();
  if (!tcc.ok && tcc.hint) {
    notes.push("─────────────────────────────────────────────────────────");
    notes.push("⚠️  macOS Screen Recording permission NOT granted to Chrome!");
    notes.push(tcc.hint);
    notes.push("─────────────────────────────────────────────────────────");
  }

  // jev starts now; Meet opens in parallel so the window is not idle.
  const jevP = resolveWorkSession(opts, notes);

  const meet = await createLocalMeetBrowser(notes);
  record.meetContext = meet.context;
  record.workPreviewPage = meet.workPage;
  record.meetPage = meet.meetPage;
  record.status = "joining";
  notes.push("status → joining");
  await meet.meetPage.goto(opts.meetUrl, { waitUntil: "commit", timeout: 60_000 }).catch((e) => {
    notes.push(`goto: ${(e as Error).message.split("\n")[0]}`);
  });
  notes.push(`Meet prejoin at ${meet.meetPage.url()}`);

  let live: Awaited<typeof jevP>;
  try {
    live = await jevP;
  } catch (e) {
    record.status = "error";
    notes.push(`jev failed: ${(e as Error).message}`);
    return publicView(record);
  }
  record.workSessionId = live.sessionId;
  record.workLiveViewUrl = live.liveViewUrl;
  notes.push(`Opening work tab → jev live view`);
  await meet.workPage.goto(live.liveViewUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await stampWorkTitle(meet.workPage);
  notes.push(`Work tab title stamped "${WORK_TAB_TITLE}"`);
  onJevLiveView((url, sessionId) => {
    if (record.status === "ended") return;
    notes.push(`Work session moved → ${sessionId}; reloading live view`);
    record.workSessionId = sessionId;
    record.workLiveViewUrl = url;
    void meet.workPage
      .goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
      .then(() => stampWorkTitle(meet.workPage))
      .catch((e) => notes.push(`live-view reload: ${(e as Error).message}`));
  });

  const prejoinOk = await joinMeet(meet.meetPage, notes, {
    muted: true,
    camera: "off",
    deferJoin: true,
    allowGuest: false,
  });
  if (!prejoinOk) {
    record.status = "error";
    notes.push("Could not reach Meet prejoin (local).");
    return publicView(record);
  }

  notes.push("Asking to join — will Present the plus1-work tab after admit.");
  const joined = await awaitMeetAdmission(meet.meetPage, notes, { camera: "off" });
  record.joined = joined;
  if (!joined) {
    record.status = "error";
    notes.push("Never admitted.");
    return publicView(record);
  }
  notes.push("Admitted to Meet.");
  await dismissMeetNoise(meet.meetPage);

  await stampWorkTitle(meet.workPage);
  const presentOk = await startLocalPresent(meet.meetPage, meet.workPage, notes);
  record.status = "streaming";
  if (!presentOk) {
    notes.push("WARN: auto-Present did not confirm — Chrome is in the meeting; click Present → A tab → plus1-work.");
  }

  return publicView(record);
}

function publicView(s: Internal): WorkCamSession {
  return {
    id: s.id,
    meetUrl: s.meetUrl,
    mode: s.mode,
    workSessionId: s.workSessionId,
    meetSessionId: s.meetSessionId,
    liveViewUrl: s.liveViewUrl,
    workLiveViewUrl: s.workLiveViewUrl,
    status: s.status,
    notes: s.notes,
    joined: s.joined,
    startedAt: s.startedAt,
  };
}

export function listWorkCamSessions(): WorkCamSession[] {
  return [...sessions.values()].map(publicView);
}

export function getWorkCamSession(id: string): WorkCamSession | undefined {
  const s = sessions.get(id);
  return s ? publicView(s) : undefined;
}

export async function stopWorkCam(id: string): Promise<boolean> {
  const s = sessions.get(id);
  if (!s) return false;
  s.stopPump?.();
  try {
    await s.cdp?.detach();
  } catch {
    /* ignore */
  }
  // Never close the work Browserbase session — it is the long-lived plus1 browser.
  try {
    await s.meetBrowser?.close();
  } catch {
    /* ignore */
  }
  try {
    await s.meetContext?.close();
  } catch {
    /* ignore */
  }
  if (s.meetSessionId) {
    try {
      const { bb } = bbClient();
      await bb.sessions.update(s.meetSessionId, { status: "REQUEST_RELEASE" });
    } catch {
      /* ignore */
    }
  }
  s.status = "ended";
  s.notes.push("Meet stopped. Work Browserbase session left running.");
  return true;
}

/**
 * Stream Browserbase work into Meet.
 * Mode (local Present vs cloud camera) comes from opts.mode or saved config.
 */
export async function startWorkCam(opts: StartWorkCamOpts): Promise<WorkCamSession> {
  const saved = await loadWorkCamConfig();
  const mode: WorkCamMode = opts.mode === "local" || opts.mode === "cloud" ? opts.mode : saved.mode;

  const id = `workcam_${Date.now().toString(36)}`;
  const t0 = Date.now();
  const notes = createLiveNotes(t0);
  const record: Internal = {
    id,
    meetUrl: opts.meetUrl,
    mode,
    status: "starting",
    notes,
    joined: false,
    startedAt: t0,
  };
  sessions.set(id, record);

  console.log("");
  console.log(`── work-cam live (${workCamModeLabel(mode)}) ──`);

  try {
    notes.push(`Mode: ${workCamModeLabel(mode)}`);
    notes.push(`Meet URL: ${opts.meetUrl}`);

    if (mode === "local") {
      return await startLocalPresentFlow(record, opts, notes);
    }

    // CLOUD MODE — jev drives the work browser; Meet is a separate BB session.
    const jevP = resolveWorkSession(opts, notes);

    const meet = await createCloudMeetBrowser(notes);
    record.meetBrowser = meet.browser;
    record.meetSessionId = meet.sessionId;
    record.liveViewUrl = meet.liveViewUrl;
    const meetPage = meet.page;
    const streamTarget = meetPage;

    record.meetPage = meetPage;
    await meetPage.setViewportSize({ width: WORK_CAM_W, height: WORK_CAM_H }).catch(() => undefined);

    record.status = "joining";
    notes.push("status → joining");
    await meetPage.goto(opts.meetUrl, { waitUntil: "commit", timeout: 60_000 }).catch((e) => {
      notes.push(`goto: ${(e as Error).message.split("\n")[0]}`);
    });
    notes.push(`Meet prejoin at ${meetPage.url()}`);

    await streamTarget
      .evaluate(() => {
        const w = window as unknown as { __plus1WorkCam?: { setLabel(s: string): void } };
        w.__plus1WorkCam?.setLabel("plus1 work — joining Meet…");
      })
      .catch(() => undefined);

    const prejoinOk = await joinMeet(meetPage, notes, {
      muted: true,
      camera: "off",
      deferJoin: true,
    });
    if (!prejoinOk) {
      record.status = "error";
      notes.push(`Could not reach Meet prejoin (${mode}).`);
      return publicView(record);
    }

    notes.push("Asking to join — will put Browserbase on the camera tile after admit.");
    const joined = await awaitMeetAdmission(meetPage, notes, { camera: "off" });
    record.joined = joined;
    if (!joined) {
      record.status = "error";
      notes.push("Never admitted.");
      return publicView(record);
    }
    notes.push("Admitted to Meet.");
    await dismissMeetNoise(meetPage);

    record.status = "streaming";
    notes.push("status → streaming");

    const jev = await jevP;
    let connectUrl = jev.connectUrl ?? opts.connectUrl;
    if (!connectUrl) {
      const { bb } = bbClient();
      const s = await bb.sessions.retrieve(jev.sessionId);
      if (!s.connectUrl) throw new Error("jev session has no connectUrl");
      connectUrl = s.connectUrl;
    }
    const workBrowser = await chromium.connectOverCDP(connectUrl);
    const workContext = workBrowser.contexts()[0] ?? (await workBrowser.newContext());
    const workPage = workContext.pages()[0] ?? (await workContext.newPage());
    const workSessionId = jev.sessionId;
    notes.push(`Streaming jev session ${workSessionId}`);

    record.workBrowser = workBrowser;
    record.workSessionId = workSessionId;
    await workPage.setViewportSize({ width: WORK_CAM_W, height: WORK_CAM_H }).catch(() => undefined);

    if (workSessionId && workSessionId !== "unknown") {
      try {
        record.workLiveViewUrl = await fetchLiveViewUrl(workSessionId);
        notes.push(`WORK live view: ${record.workLiveViewUrl}`);
      } catch {
        /* ignore */
      }
    }

    {
      // Cloud mode: CDP screencast from work browser → fake camera on Meet page
      const attachPump = async (page: Page) => {
        record.stopPump?.();
        const next = await startScreencastPump(page, streamTarget, notes);
        record.cdp = next.cdp;
        record.stopPump = next.stop;
        await next.waitForFrame().catch((e) => {
          notes.push(`Stream wait: ${(e as Error).message}`);
        });
      };

      await attachPump(workPage);
      notes.push("Frames ready — turning on camera.");
      const camOk = await turnOnWorkCamera(meetPage, notes);
      if (!camOk) {
        notes.push("WARN: open Meet live view and click Turn on camera.");
      } else {
        notes.push("Browserbase on camera (1280×720, stretch-fill).");
      }

      workContext.on("page", (p) => {
        void (async () => {
          try {
            await p.setViewportSize({ width: WORK_CAM_W, height: WORK_CAM_H }).catch(() => undefined);
            await attachPump(p);
            notes.push(`Screencast retargeted → ${p.url().slice(0, 80)}`);
          } catch (e) {
            notes.push(`Retarget failed: ${(e as Error).message}`);
          }
        })();
      });
    }

    return publicView(record);
  } catch (e) {
    record.status = "error";
    notes.push(`status → error`);
    notes.push((e as Error).message);
    record.stopPump?.();
    try {
      await record.cdp?.detach();
    } catch {
      /* ignore */
    }
    try {
      await record.workBrowser?.close();
    } catch {
      /* ignore */
    }
    try {
      await record.meetBrowser?.close();
    } catch {
      /* ignore */
    }
    try {
      await record.meetContext?.close();
    } catch {
      /* ignore */
    }
    return publicView(record);
  }
}
