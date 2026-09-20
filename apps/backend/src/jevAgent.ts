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
import { emitWorkHold } from "./workHold.js";

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

/** Demo / Harbor Point primary — used when they ask for a flood map without an address. */
const FEMA_DEMO_ADDRESS = "44 Cedar Ln, Tampa, FL";
const FEMA_MSC_SEARCH = "https://msc.fema.gov/portal/search";

function isFloodMapTask(task: string): boolean {
  return /flood\s*map|fema|nfhl|firmette|flood\s*zone|msc\.fema/i.test(task);
}

/** Buying a house / show the property / Street View — Google Maps, not FEMA. */
function isHouseViewTask(task: string): boolean {
  if (isFloodMapTask(task)) return false;
  return (
    /\bstreet\s*view\b|\bpegman\b/i.test(task) ||
    /\b(house|home|property|listing|address)\b/i.test(task) ||
    /\b(show|pull\s*up|look\s*(at|up)|open)\b.*\b(map|maps)\b/i.test(task) ||
    /\bgoogle\s+maps\b/i.test(task)
  );
}

/** Pull a US-looking street address out of free text, if present. */
function extractStreetAddress(task: string): string | undefined {
  const m = task.match(
    /\b\d{1,5}\s+[A-Za-z0-9.'’-]+(?:\s+[A-Za-z0-9.'’-]+){0,5}\s*,\s*[A-Za-z .'-]+(?:,\s*[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?\b/,
  );
  if (m?.[0]) return m[0].replace(/\s+/g, " ").trim();
  // Harbor Point / Tampa warehouse shorthand from the UW demo
  if (/harbor\s*point|tampa\s*warehouse|cedar\s*ln|cedar\s*lane/i.test(task)) {
    return FEMA_DEMO_ADDRESS;
  }
  return undefined;
}

function mapsSearchUrl(address: string): string {
  // Place/search URL — never /maps/dir/ (Directions).
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * Rewrite high-stakes demo tasks into deterministic Browserbase agent steps.
 * Flood map → FEMA MSC. House / Street View → Google Maps place + exterior SV.
 */
function normalizeBrowserTask(task: string): string {
  const trimmed = task.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;

  if (isFloodMapTask(trimmed)) {
    const address = extractStreetAddress(trimmed) || FEMA_DEMO_ADDRESS;
    return [
      `Open ${FEMA_MSC_SEARCH} immediately (FEMA Flood Map Service Center — Search by Address).`,
      `Do NOT open Google, Google Maps, google.com, or any other website first.`,
      `In the address search field, type exactly this full address and submit/search: ${address}`,
      `Wait until the flood map / Dynamic Map / FIRMette (or search results) for that address is visible.`,
      `Leave that FEMA flood map page on screen. Do not close the browser or navigate away.`,
    ].join("\n");
  }

  if (isHouseViewTask(trimmed)) {
    const address = extractStreetAddress(trimmed);
    if (!address) {
      return [
        trimmed,
        "",
        "Use Google Maps (normal place/search page — NOT Directions, NOT a google.com search).",
        "If an address is present, open Street View from the STREET looking at the FRONT of the building — never indoor/interior Street View.",
      ].join("\n");
    }
    return [
      `Open this Google Maps place/search URL (normal Maps — NOT Directions, NOT /maps/dir/, NOT google.com):`,
      mapsSearchUrl(address),
      `Confirm the pin for exactly: ${address}`,
      `Open Street View at this address.`,
      `CRITICAL: stand on the STREET / curb looking at the FRONT exterior of the house or building. Do NOT enter the building. Do NOT use indoor / interior / inside Street View. Do NOT walk through the front door.`,
      `Leave that exterior Street View on screen. Do not close the browser or navigate away.`,
    ].join("\n");
  }

  return trimmed;
}

function promptStartUrl(task: string): string {
  const explicit = task.match(/https?:\/\/[^\s]+/i)?.[0];
  if (explicit) {
    const url = explicit.replace(/[.,;)]+$/, "");
    // Never seed Directions even if the model pasted a /dir/ link.
    if (/google\.[^/]+\/maps\/dir/i.test(url)) {
      const addr = extractStreetAddress(task);
      return addr ? mapsSearchUrl(addr) : "https://www.google.com/maps";
    }
    return url;
  }
  // Flood map BEFORE the generic "maps" branch — "flood map" must not become Google Maps.
  if (isFloodMapTask(task) || /msc\.fema\.gov/i.test(task)) {
    return FEMA_MSC_SEARCH;
  }
  if (/wordle/i.test(task)) return "https://www.nytimes.com/games/wordle/index.html";

  if (isHouseViewTask(task) || (/\b(google\s+)?maps\b|street view|pegman/i.test(task) && !isFloodMapTask(task))) {
    const addr = extractStreetAddress(task);
    if (addr) return mapsSearchUrl(addr);
    return "https://www.google.com/maps";
  }

  // Default landing / search on google.com (not Maps).
  const search = task
    .replace(/\b(share your screen|share screen|pull up|look up|show me|on the web|browser)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  if (!search || search.length < 3) return "https://www.google.com";
  return `https://www.google.com/search?q=${encodeURIComponent(search)}`;
}

async function snapshot(page: Page): Promise<string> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bits = await page
    .evaluate(() => {
      const out: { tag: string; text: string }[] = [];
      const push = (tag: string, text: string) => {
        const t = text.replace(/\s+/g, " ").trim().slice(0, 100);
        if (t.length >= 2) out.push({ tag, text: t });
      };
      for (const h of document.querySelectorAll("h1, h2")) {
        push("heading", (h as HTMLElement).innerText || "");
      }
      for (const el of document.querySelectorAll("a, button, input, textarea, [role='button'], [aria-label]")) {
        if (out.length >= 40) break;
        const h = el as HTMLElement;
        push(
          h.tagName.toLowerCase(),
          h.innerText || h.getAttribute("aria-label") || h.getAttribute("placeholder") || h.getAttribute("value") || "",
        );
      }
      return out;
    })
    .catch(() => [] as { tag: string; text: string }[]);
  return `url: ${url}\ntitle: ${title}\ncontrols:\n${bits.map((b) => `- ${b.tag}: ${b.text}`).join("\n")}`;
}

type PageAction = { action: string; url?: string; text?: string; key?: string; note?: string };

const PAGE_DRIVER_SYSTEM = `You drive a cloud Chrome browser that is being screenshared into a live meeting.

Goal: make the RESULT visible on screen so people watching the share can see it. Prefer concrete pages over search result lists when you can.

Rules:
- One action per turn. Pick the smallest next step that advances the task.
- Prefer action "goto" with a full https URL when you know where to go (Maps search URL, a company contact page, Google search URL, etc.).
- "click" uses visible button/link text from PAGE controls — copy the text closely.
- "type" types into the focused field; "press" is usually Enter after typing a search.
- "wait" only if the page is clearly loading.
- Use "done" ONLY when the useful answer is already on screen (address, phone, map pin, article, filled form). Do NOT done after a generic Google homepage or a bare search box.
- If the last step failed, try a different approach (new goto URL, different click text) — do not repeat the same failed click.
- Keep notes short (what you are trying).`;

function pageDriverUserPrompt(task: string, snap: string, history: string[]): string {
  return `TASK (show this on screen for the meeting):
${task}

CURRENT PAGE:
${snap}

STEPS SO FAR:
${history.join("\n") || "(none yet — usually start with goto to a useful URL)"}

Return the next single JSON action.`;
}

async function openaiNextAction(task: string, snap: string, history: string[]): Promise<PageAction> {
  const key = envOptional("OPENAI_API_KEY");
  if (!key) return { action: "done", note: "no OPENAI_API_KEY" };
  const model = envOptional("OPENAI_BROWSER_MODEL") ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${PAGE_DRIVER_SYSTEM}

Reply with ONLY a JSON object:
{"action":"goto"|"click"|"type"|"press"|"wait"|"done","url":"...","text":"...","key":"...","note":"..."}
Omit unused fields. action and note are required.`,
        },
        { role: "user", content: pageDriverUserPrompt(task, snap, history) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      action: String(parsed.action ?? "done"),
      url: typeof parsed.url === "string" ? parsed.url : undefined,
      text: typeof parsed.text === "string" ? parsed.text : undefined,
      key: typeof parsed.key === "string" ? parsed.key : undefined,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    };
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
      const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const candidates = [
        page.getByRole("link", { name: re }).first(),
        page.getByRole("button", { name: re }).first(),
        page.getByText(re).first(),
      ];
      let clicked = false;
      for (const loc of candidates) {
        if (await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: 8_000 });
          clicked = true;
          break;
        }
      }
      if (!clicked) throw new Error(`click target not found: ${name}`);
      break;
    }
    case "type": {
      const value = act.text ?? "";
      const focused = page.locator(":focus");
      if (await focused.count()) await focused.fill(value);
      else {
        const box = page.locator("input:visible, textarea:visible, [contenteditable='true']").first();
        if (await box.count()) {
          await box.click({ timeout: 3_000 });
          await box.fill(value);
        } else {
          await page.keyboard.type(value, { delay: 20 });
        }
      }
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
      throw new Error(`unknown action: ${act.action}`);
  }
  await page.waitForTimeout(900).catch(() => undefined);
}

async function runPromptOnPage(
  page: Page,
  task: string,
  notes: string[],
  opts?: { seededGoto?: string },
): Promise<void> {
  if (!envOptional("OPENAI_API_KEY")) {
    notes.push("page driver needs OPENAI_API_KEY");
    return;
  }
  notes.push(`running prompt on ${page.url()} (openai)`);
  const history: string[] = opts?.seededGoto ? [`goto ${opts.seededGoto}`] : [];
  // Seeded navigation counts — otherwise the model can "done" on a blank tab,
  // or we reject a legit done when the start URL already shows the answer.
  let applied = opts?.seededGoto ? 1 : 0;
  let earlyDoneRejects = 0;
  for (let i = 0; i < 14; i++) {
    const snap = await snapshot(page);
    let next: PageAction;
    try {
      next = await openaiNextAction(task, snap, history);
    } catch (e) {
      notes.push(`openai: ${(e as Error).message}`);
      break;
    }
    if (next.action === "done") {
      // Only force more work if we never moved the page meaningfully.
      if (applied < 1 || (applied === 1 && opts?.seededGoto && earlyDoneRejects < 1)) {
        // One nudge: after only the seed goto, ask for one more concrete step
        // (click a result, open street view) before accepting done.
        if (applied === 1 && opts?.seededGoto && earlyDoneRejects < 1) {
          earlyDoneRejects++;
          notes.push(`nudged past early done (${next.note ?? "no note"}) — try one more visible step`);
          history.push(`REJECTED early done: ${next.note ?? ""} — do one more step so the result is obvious on screen`);
          continue;
        }
        if (applied < 1) {
          notes.push(`ignored early done (${next.note ?? "no note"}) — need at least one real step`);
          history.push(`REJECTED early done: ${next.note ?? ""}`);
          continue;
        }
      }
      notes.push(`prompt done: ${next.note ?? ""}`);
      break;
    }
    try {
      await applyAction(page, next, notes);
      applied++;
      history.push(`${next.action} ${next.url ?? next.text ?? next.key ?? ""}`.trim());
    } catch (e) {
      notes.push(`step failed: ${(e as Error).message}`);
      history.push(`FAILED ${next.action}: ${(e as Error).message}`);
    }
  }
  if (applied <= (opts?.seededGoto ? 1 : 0)) {
    notes.push("page driver finished with no successful steps beyond the start URL");
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
  startUrl = "https://www.google.com",
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
  const pw = await playwrightOpen(sessionId, "https://www.google.com", notes);
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
  // Swap Present off the dying live-view before the next session attaches.
  emitWorkHold();
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
      // Agent live-view shows "disconnected" — Present the logo hold screen instead.
      emitWorkHold();
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
        url || "https://www.google.com",
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
  const normalized = normalizeBrowserTask(task);
  if (normalized !== task.replace(/\s+/g, " ").trim()) {
    notes.push(
      isFloodMapTask(task)
        ? "rewrote flood-map task → FEMA MSC + full address"
        : "rewrote house/maps task → Google Maps place + exterior Street View",
    );
  }
  notes.push(`prompt: ${normalized.slice(0, 200)}`);
  const skipAgents =
    envOptional("BROWSERBASE_SKIP_AGENTS") === "1" ||
    /^(1|true|yes)$/i.test(envOptional("BROWSER_FALLBACK_ONLY") ?? "");

  if (!skipAgents) {
    try {
      notes.push("Starting a new jev agent run");
      return await startJevRun(normalized, notes, opts?.waitForTask);
    } catch (e) {
      notes.push(`jev run failed: ${(e as Error).message}`);
    }
  } else {
    notes.push("Skipping Browserbase agents (BROWSERBASE_SKIP_AGENTS) — OpenAI page driver");
  }

  if (!attachLock) {
    attachLock = getLive(notes).finally(() => {
      attachLock = null;
    });
  }
  const handle = await attachLock;
  const page = handle.page;
  const start = promptStartUrl(normalized);
  const view = await fetchLiveViewUrl(handle.sessionId, {
    expiresIn: SESSION_TIMEOUT_SEC,
    waitMs: 15_000,
  });
  handle.liveViewUrl = view;
  notes.push(`live view: ${view}`);

  // OpenAI page driver continues the task on the keepAlive cloud Chrome.
  handle.running = (async () => {
    if (!page) return;
    try {
      notes.push(`navigating for prompt → ${start}`);
      await page.goto(start, { waitUntil: "domcontentloaded", timeout: 60_000 });
      notes.push(`now at ${page.url()}`);
      await runPromptOnPage(page, normalized, notes, { seededGoto: start });
      handle.lastRun = {
        status: "openai",
        url: page.url(),
        detail: "openai finished on the work browser",
      };
    } catch (err) {
      notes.push(`openai-on-page: ${(err as Error).message}`);
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

/** Wait until the in-flight jev or OpenAI page-driver finishes. Browser stays open. */
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
  "Open https://www.google.com and leave the homepage on screen. Do not close the browser.";

/** Always a new jev run. Blank task still runs jev with a google.com default. */
export async function startWorkBrowser(notes: string[], task?: string): Promise<JevSession> {
  return startJevOrStagehand(task?.trim() || DEFAULT_JEV_TASK, notes);
}

/** Stop Meet/local chrome only — never release the work session. */
export function persistentWorkSessionId(): string | undefined {
  return live?.sessionId ?? readCache()?.sessionId;
}
