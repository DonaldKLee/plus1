/**
 * Browserbase work browser + jev agent runs.
 *
 * Every spoken task is a new `agents.runs.create`. The run itself disconnects
 * on COMPLETED; we pin CDP (and clone to keepAlive if BB releases) so the
 * Present tab does not go blank. Shannon's `browser_work` tool drives this.
 */

import fs from "node:fs";
import path from "node:path";
import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { CACHE_DIR, ensureCacheDir, envOptional } from "./env.js";
import { fetchLiveViewUrl } from "./workCamContext.js";

const AGENT_NAME = "plus1-jev";
const CACHE_FILE = path.join(CACHE_DIR, "jev-work.json");
/** Browserbase session timeout max is 6 hours. keepAlive lets us reconnect. */
const SESSION_TIMEOUT_SEC = 21_600;

export type JevSession = {
  runId: string;
  agentId?: string;
  sessionId: string;
  connectUrl: string;
  liveViewUrl: string;
};

export type JevRunInfo = {
  status: string;
  url?: string;
  detail?: string;
};

type Cache = {
  agentId?: string;
  sessionId: string;
  projectId: string;
  createdAt: string;
};

type Live = {
  sessionId: string;
  agentId?: string;
  connectUrl: string;
  liveViewUrl: string;
  stagehand: { act: (instruction: string) => Promise<unknown> };
  browser: Browser | { sessionId?: string; close: () => Promise<void> };
  page?: Page;
  running?: Promise<void>;
  stopHold?: () => void;
  lastRun?: JevRunInfo;
};

let live: Live | null = null;
let attachLock: Promise<Live> | null = null;

const liveViewListeners = new Set<(url: string, sessionId: string) => void>();

/** Work-cam reloads the Present tab if we have to move to a keepAlive copy. */
export function onJevLiveView(cb: (url: string, sessionId: string) => void): () => void {
  liveViewListeners.add(cb);
  return () => liveViewListeners.delete(cb);
}

function emitLiveView(url: string, sessionId: string): void {
  for (const cb of liveViewListeners) {
    try {
      cb(url, sessionId);
    } catch {
      /* ignore */
    }
  }
}

function bbClient(): Browserbase {
  const apiKey = envOptional("BROWSERBASE_API_KEY");
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY required");
  return new Browserbase({ apiKey });
}

function projectId(): string {
  const id = envOptional("BROWSERBASE_PROJECT_ID");
  if (!id) throw new Error("BROWSERBASE_PROJECT_ID required");
  return id;
}

export function jevAgentId(): string | undefined {
  return envOptional("BROWSERBASE_AGENT_ID") ?? readCache()?.agentId;
}

function readCache(): Cache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Cache;
    return j.sessionId ? j : null;
  } catch {
    return null;
  }
}

function writeCache(data: Cache): void {
  ensureCacheDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

function promptStartUrl(task: string): string {
  const explicit = task.match(/https?:\/\/[^\s]+/i)?.[0];
  if (explicit) return explicit.replace(/[.,;)]+$/, "");
  if (/wordle/i.test(task)) return "https://www.nytimes.com/games/wordle/index.html";
  if (/maps/i.test(task)) {
    const m = task.match(/search(?:\s+for)?\s+(?:the\s+)?(.+?)(?:,|\.| then| and | so i|$)/i);
    const q = (m?.[1] ?? task).replace(/google maps/gi, "").trim().slice(0, 140);
    if (q.length > 3) {
      return `https://www.google.com/maps/search/${encodeURIComponent(q)}`;
    }
    return "https://www.google.com/maps";
  }
  const search = task.replace(/\s+/g, " ").trim().slice(0, 120);
  return `https://www.google.com/search?q=${encodeURIComponent(search)}`;
}

async function snapshot(page: Page): Promise<string> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bits = await page
    .evaluate(() => {
      const els = [...document.querySelectorAll("a, button, input, textarea, [role='button'], [aria-label]")];
      return els.slice(0, 35).map((el) => {
        const h = el as HTMLElement;
        return {
          tag: h.tagName.toLowerCase(),
          text: (h.innerText || h.getAttribute("aria-label") || h.getAttribute("placeholder") || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80),
        };
      }).filter((x) => x.text);
    })
    .catch(() => []);
  return `url: ${url}\ntitle: ${title}\ncontrols:\n${bits.map((b) => `- ${b.tag}: ${b.text}`).join("\n")}`;
}

async function geminiNextAction(
  task: string,
  snap: string,
  history: string[],
): Promise<{ action: string; url?: string; text?: string; key?: string; note?: string }> {
  const key = envOptional("GEMINI_API_KEY");
  if (!key) return { action: "done", note: "no GEMINI_API_KEY" };
  const model = process.env.GEMINI_BRAIN_MODEL || "gemini-flash-lite-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const schema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "click", "type", "press", "wait", "done"] },
      url: { type: "string" },
      text: { type: "string" },
      key: { type: "string" },
      note: { type: "string" },
    },
    required: ["action", "note"],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: "You operate a cloud Chrome via Playwright. Complete the user's task with one action per turn. Prefer goto with a full URL when possible (Google Maps search URLs, Pegman/street view, new Google searches). click uses visible button/link text. type types into the focused field. press is a key like Enter. done when the task is complete enough to show on screen.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `TASK:\n${task}\n\nPAGE:\n${snap}\n\nALREADY DID:\n${history.join("\n") || "(nothing)"}\n\nNext single action.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    return JSON.parse(raw) as { action: string; url?: string; text?: string; key?: string; note?: string };
  } catch {
    return { action: "done", note: "bad json" };
  }
}

async function applyAction(
  page: Page,
  act: { action: string; url?: string; text?: string; key?: string; note?: string },
  notes: string[],
): Promise<void> {
  notes.push(`prompt step: ${act.action}${act.note ? ` — ${act.note}` : ""}`);
  switch (act.action) {
    case "goto": {
      const target = act.url || (act.text?.startsWith("http") ? act.text : "");
      if (!target) throw new Error("goto missing url");
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
      break;
    }
    case "click": {
      const name = act.text?.trim();
      if (!name) throw new Error("click missing text");
      const loc = page.getByRole("button", { name: new RegExp(name, "i") }).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.click({ timeout: 8_000 });
        break;
      }
      await page.getByText(name, { exact: false }).first().click({ timeout: 8_000 });
      break;
    }
    case "type": {
      const value = act.text ?? "";
      const focused = page.locator(":focus");
      if (await focused.count()) await focused.fill(value);
      else await page.keyboard.type(value, { delay: 20 });
      break;
    }
    case "press": {
      await page.keyboard.press(act.key || "Enter");
      break;
    }
    case "wait": {
      await page.waitForTimeout(2000);
      break;
    }
    default:
      break;
  }
  await page.waitForTimeout(800).catch(() => undefined);
}

async function runPromptOnPage(page: Page, task: string, notes: string[]): Promise<void> {
  notes.push(`running prompt on ${page.url()}`);
  const history: string[] = [];
  for (let i = 0; i < 10; i++) {
    const snap = await snapshot(page);
    let next: Awaited<ReturnType<typeof geminiNextAction>>;
    try {
      next = await geminiNextAction(task, snap, history);
    } catch (e) {
      notes.push(`gemini: ${(e as Error).message}`);
      break;
    }
    if (next.action === "done") {
      notes.push(`prompt done: ${next.note ?? ""}`);
      break;
    }
    try {
      await applyAction(page, next, notes);
      history.push(`${next.action} ${next.url ?? next.text ?? next.key ?? ""}`.trim());
    } catch (e) {
      notes.push(`step failed: ${(e as Error).message}`);
      history.push(`FAILED ${next.action}: ${(e as Error).message}`);
    }
  }
}

async function sessionIsRunning(sessionId: string): Promise<boolean> {
  try {
    const s = await bbClient().sessions.retrieve(sessionId);
    return s.status === "RUNNING";
  } catch {
    return false;
  }
}

/** Reusable Agent definition (does not consume the 15-run quota). */
async function ensureAgent(notes: string[]): Promise<string | undefined> {
  const bb = bbClient();
  const existing = jevAgentId();
  if (existing) {
    try {
      await bb.agents.retrieve(existing);
      notes.push(`jev agent ${existing} (reused)`);
      return existing;
    } catch {
      notes.push(`saved agent ${existing} is gone — looking for ${AGENT_NAME}`);
    }
  }
  try {
    const page = await bb.agents.list({ limit: 50 });
    const hit = page.data.find((a) => a.name === AGENT_NAME);
    if (hit) {
      notes.push(`jev agent ${hit.agentId} (${AGENT_NAME})`);
      return hit.agentId;
    }
    const created = await bb.agents.create({
      name: AGENT_NAME,
      systemPrompt:
        "You are plus1, a live work browser for underwriting meetings. Follow each user task in this same browser. Prefer Maps, FEMA, and public records. Never close the session.",
    });
    notes.push(`created jev agent ${created.agentId}`);
    return created.agentId;
  } catch (e) {
    notes.push(`agent create skipped: ${(e as Error).message}`);
    return existing;
  }
}

async function playwrightOpen(
  sessionId: string,
  startUrl: string,
  notes: string[],
): Promise<{ connectUrl: string; browser: Browser; page: Page }> {
  const session = await bbClient().sessions.retrieve(sessionId);
  if (!session.connectUrl) throw new Error(`session ${sessionId} has no connectUrl`);
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  notes.push(`work tab was ${page.url() || "unknown"}`);
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500).catch(() => undefined);
  notes.push(`opened ${page.url()}`);
  return { connectUrl: session.connectUrl, browser, page };
}

function stubStagehand(notes: string[]): Live["stagehand"] {
  return {
    act: async () => {
      notes.push("act skipped");
    },
  };
}

async function launchNewSession(
  notes: string[],
  agentId: string | undefined,
  startUrl = "https://www.google.com/maps",
): Promise<Live> {
  const pid = projectId();
  const bb = bbClient();
  notes.push("Starting persistent Browserbase session (keepAlive, 6h timeout) — not an agent run");
  const session = await bb.sessions.create({
    projectId: pid,
    keepAlive: true,
    timeout: SESSION_TIMEOUT_SEC,
    browserSettings: {
      blockAds: true,
      viewport: { width: 1280, height: 720 },
    },
  } as Parameters<typeof bb.sessions.create>[0] & { keepAlive?: boolean; timeout?: number });

  const pw = await playwrightOpen(session.id, startUrl, notes);
  const liveViewUrl = await fetchLiveViewUrl(session.id, {
    expiresIn: SESSION_TIMEOUT_SEC,
    waitMs: 15_000,
  });
  writeCache({
    agentId,
    sessionId: session.id,
    projectId: pid,
    createdAt: new Date().toISOString(),
  });
  notes.push(`persistent session ${session.id}`);
  notes.push(`live view: ${liveViewUrl}`);
  return {
    sessionId: session.id,
    agentId,
    connectUrl: pw.connectUrl,
    liveViewUrl,
    stagehand: stubStagehand(notes),
    browser: pw.browser,
    page: pw.page,
  };
}

async function reconnectSession(
  sessionId: string,
  notes: string[],
  agentId: string | undefined,
): Promise<Live> {
  notes.push(`Reconnecting to persistent session ${sessionId} via Playwright CDP`);
  const pw = await playwrightOpen(sessionId, "https://www.google.com/maps", notes);
  const liveViewUrl = await fetchLiveViewUrl(sessionId, {
    expiresIn: SESSION_TIMEOUT_SEC,
    waitMs: 15_000,
  });
  notes.push(`live view: ${liveViewUrl}`);
  return {
    sessionId,
    agentId,
    connectUrl: pw.connectUrl,
    liveViewUrl,
    stagehand: stubStagehand(notes),
    browser: pw.browser,
    page: pw.page,
  };
}

async function getLive(notes: string[]): Promise<Live> {
  if (live && (await sessionIsRunning(live.sessionId))) return live;
  if (live) {
    notes.push("Cached in-process session died — opening a new one");
    live = null;
  }

  const agentId = await ensureAgent(notes);
  const cached = readCache();
  if (cached?.sessionId && (await sessionIsRunning(cached.sessionId))) {
    live = await reconnectSession(cached.sessionId, notes, agentId ?? cached.agentId);
    return live;
  }
  if (cached?.sessionId) {
    notes.push(`Prior session ${cached.sessionId} is not running — launching a replacement`);
  }
  live = await launchNewSession(notes, agentId);
  return live;
}

function toJev(l: Live): JevSession {
  return {
    runId: `persistent_${l.sessionId}`,
    agentId: l.agentId,
    sessionId: l.sessionId,
    connectUrl: l.connectUrl,
    liveViewUrl: l.liveViewUrl,
  };
}

/**
 * Agent runs.create does not accept keepAlive. The runner disconnects on
 * COMPLETED, and Browserbase then kills the session unless we already hold CDP.
 */
async function pinCdp(
  connectUrl: string,
  notes: string[],
): Promise<{ browser: Browser; page?: Page; stopHold: () => void }> {
  const browser = await chromium.connectOverCDP(connectUrl);
  const page = browser.contexts()[0]?.pages()[0];
  let timer: ReturnType<typeof setInterval> | undefined;
  let cdp: CDPSession | undefined;
  try {
    cdp = await browser.newBrowserCDPSession();
    timer = setInterval(() => {
      void cdp?.send("Browser.getVersion").catch(() => undefined);
    }, 15_000);
    timer.unref?.();
    notes.push("Holding agent session over CDP so it stays open after jev disconnects");
  } catch (e) {
    notes.push(`CDP heartbeat: ${(e as Error).message} — Playwright connection still held`);
  }
  return {
    browser,
    page,
    stopHold: () => {
      if (timer) clearInterval(timer);
      void cdp?.detach().catch(() => undefined);
    },
  };
}

async function lastPageUrl(sessionId: string, page?: Page): Promise<string | undefined> {
  const fromPage = page?.url() ?? "";
  if (fromPage && fromPage !== "about:blank") return fromPage;
  try {
    const debug = await bbClient().sessions.debug(sessionId);
    const hit = [...(debug.pages ?? [])].reverse().find((p) => {
      const u = (p.url ?? "").trim();
      return u && u !== "about:blank" && !u.startsWith("chrome");
    });
    return hit?.url?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** One Browserbase Agent run — this is what actually follows the prompt. */
async function startJevRun(
  task: string,
  notes: string[],
  waitForTask?: boolean,
): Promise<JevSession> {
  const bb = bbClient();
  const agentId = await ensureAgent(notes);
  notes.push("Starting jev run (uses 1 of 15 agent runs).");
  // keepAlive is not a runs.create field — the OpenAPI schema rejects it.
  // We pin CDP below so the session survives when the runner disconnects.
  const run = await bb.agents.runs.create({
    task: `${task}\n\nWhen finished, leave the final page open. Do not close the browser or navigate away from the result.`,
    ...(agentId ? { agentId } : {}),
  });
  notes.push(`jev run ${run.runId} (${run.status})`);

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const cur = await bb.agents.runs.retrieve(run.runId);
    if (cur.sessionId) {
      const session = await bb.sessions.retrieve(cur.sessionId);
      if (session.connectUrl) {
        const hold = await pinCdp(session.connectUrl, notes).catch((e) => {
          notes.push(`CDP hold failed: ${(e as Error).message}`);
          return undefined;
        });

        const liveViewUrl = await fetchLiveViewUrl(cur.sessionId, {
          expiresIn: SESSION_TIMEOUT_SEC,
          waitMs: 20_000,
        });
        notes.push(
          `jev session ${cur.sessionId} keepAlive=${session.keepAlive} expires ${session.expiresAt}`,
        );
        notes.push(`jev live view: ${liveViewUrl}`);
        writeCache({
          agentId: cur.agentId ?? agentId,
          sessionId: cur.sessionId,
          projectId: projectId(),
          createdAt: new Date().toISOString(),
        });

        const handle: Live = {
          sessionId: cur.sessionId,
          agentId: cur.agentId ?? agentId,
          connectUrl: session.connectUrl,
          liveViewUrl,
          stagehand: stubStagehand(notes),
          browser: hold?.browser ?? { close: async () => undefined },
          page: hold?.page,
          stopHold: hold?.stopHold,
        };
        live = handle;

        const watching = watchJevRun(run.runId, notes);
        handle.running = watching;
        if (waitForTask) await watching;

        return {
          runId: run.runId,
          agentId: handle.agentId,
          sessionId: handle.sessionId,
          connectUrl: handle.connectUrl,
          liveViewUrl: live?.liveViewUrl ?? liveViewUrl,
        };
      }
    }
    if (["FAILED", "STOPPED", "TIMED_OUT"].includes(cur.status)) {
      throw new Error(
        `jev ${run.runId} ended ${cur.status}${cur.cause ? `: ${cur.cause.message ?? cur.cause.code}` : ""}`,
      );
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`jev ${run.runId} never exposed a session`);
}

async function watchJevRun(runId: string, notes: string[]): Promise<void> {
  const bb = bbClient();
  let snapshotUrl: string | undefined;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const cur = await bb.agents.runs.retrieve(runId);
      if (cur.sessionId) {
        snapshotUrl = (await lastPageUrl(cur.sessionId, live?.page)) ?? snapshotUrl;
      }
      if (!["COMPLETED", "FAILED", "STOPPED", "TIMED_OUT"].includes(cur.status)) continue;

      notes.push(`jev ${cur.status} — keeping the browser open`);
      const sessionId = cur.sessionId ?? live?.sessionId;
      const rec = cur as unknown as Record<string, unknown>;
      const detail = [
        typeof rec.output === "string" ? rec.output : "",
        typeof rec.result === "string" ? rec.result : "",
        cur.cause?.message ?? "",
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 500);
      if (live) live.lastRun = { status: cur.status, url: snapshotUrl, detail: detail || undefined };
      if (!sessionId) return;

      const stillUp = await sessionIsRunning(sessionId);
      if (stillUp) {
        notes.push(`session ${sessionId} still RUNNING after agent disconnect`);
        return;
      }

      const url = snapshotUrl ?? (await lastPageUrl(sessionId, live?.page));
      notes.push(
        url
          ? `Agent released the session — copying ${url} into a keepAlive browser`
          : "Agent released the session — opening a keepAlive browser",
      );
      live?.stopHold?.();
      const next = await launchNewSession(
        notes,
        cur.agentId ?? live?.agentId,
        url || "https://www.google.com/maps",
      );
      next.lastRun = live?.lastRun ?? { status: cur.status, url, detail: detail || undefined };
      live = next;
      emitLiveView(next.liveViewUrl, next.sessionId);
      return;
    } catch (e) {
      notes.push(`watch jev: ${(e as Error).message}`);
      return;
    }
  }
}

/**
 * Every prompt is a new Browserbase Agent run. After it finishes we pin the
 * cloud Chrome so screenshare does not go blank.
 */
export async function startJevOrStagehand(
  task: string,
  notes: string[],
  opts?: { waitForTask?: boolean },
): Promise<JevSession> {
  notes.push(`prompt: ${task.slice(0, 160)}`);
  try {
    notes.push("Starting a new jev agent run");
    return await startJevRun(task, notes, opts?.waitForTask);
  } catch (e) {
    notes.push(`jev run failed: ${(e as Error).message}`);
  }

  if (!attachLock) {
    attachLock = getLive(notes).finally(() => {
      attachLock = null;
    });
  }
  const handle = await attachLock;
  const page = handle.page;
  const start = promptStartUrl(task);
  const view = await fetchLiveViewUrl(handle.sessionId, {
    expiresIn: SESSION_TIMEOUT_SEC,
    waitMs: 15_000,
  });
  handle.liveViewUrl = view;
  notes.push(`live view: ${view}`);

  // Gemini drives the existing cloud Chrome when jev is unavailable.
  handle.running = (async () => {
    if (!page) return;
    try {
      notes.push(`navigating for prompt → ${start}`);
      await page.goto(start, { waitUntil: "domcontentloaded", timeout: 60_000 });
      notes.push(`now at ${page.url()}`);
      await runPromptOnPage(page, task, notes);
      handle.lastRun = { status: "gemini", url: page.url(), detail: "gemini finished on the work browser" };
    } catch (err) {
      notes.push(`gemini-on-page: ${(err as Error).message}`);
      handle.lastRun = { status: "FAILED", url: page.url(), detail: (err as Error).message };
    }
  })();
  if (opts?.waitForTask) await handle.running;
  return toJev(handle);
}

/** Pin a keepAlive work session without spending an agent run. */
export async function attachWorkBrowser(notes: string[]): Promise<JevSession> {
  const handle = await getLive(notes);
  return toJev(handle);
}

/** Wait until the in-flight jev (or Gemini fallback) finishes. Browser stays open. */
export async function waitForCurrentJevRun(): Promise<JevRunInfo | undefined> {
  const p = live?.running;
  if (p) await p.catch(() => undefined);
  return live?.lastRun;
}

/** JPEG of the cloud work page — what Shannon is presenting, minus Meet chrome. */
export async function screenshotWorkBrowser(): Promise<Buffer | undefined> {
  const page = live?.page;
  if (!page || page.isClosed()) return undefined;
  try {
    return await page.screenshot({ type: "jpeg", quality: 42, fullPage: false, timeout: 4_000 });
  } catch {
    return undefined;
  }
}

const DEFAULT_JEV_TASK =
  "Open Google Maps and leave the map on screen. Do not close the browser.";

/** Always a new jev run. Blank task still runs jev with a Maps default. */
export async function startWorkBrowser(notes: string[], task?: string): Promise<JevSession> {
  return startJevOrStagehand(task?.trim() || DEFAULT_JEV_TASK, notes);
}

/** Stop Meet/local chrome only — never release the work session. */
export function persistentWorkSessionId(): string | undefined {
  return live?.sessionId ?? readCache()?.sessionId;
}
