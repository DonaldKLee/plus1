import "./plus1Config.js"; // load committed plus1 config + hydrate env before anything reads it
import express from "express";
import cors from "cors";
import { envOptional } from "./env.js";
import { cacheSchemaAndPolicies } from "./federatoClient.js";
import { rankQueue } from "./rank.js";
import { agenticQuery } from "./federatoQuery.js";
import { runFederatoTool } from "./federatoTools.js";
import { rankOpenSubmissions } from "./submissions.js";
import { draftDocument, type DraftKind } from "./drafts.js";
import { buildContractDraft } from "./contractTemplate.js";
import { deepDivePolicy } from "./deepDive.js";
import {
  openWorkSessionForScreenshare,
  runBrowserbaseVerification,
} from "./browserbaseWork.js";
import { presentLiveViewInMeet, resolveMeetUrl } from "./meetPresent.js";
import {
  avatarStatus,
  emoteSession,
  fillerInSession,
  getSession,
  honkSession,
  interruptSession,
  listSessions,
  speakInSession,
  startMeetTranscription,
  renameSession,
  stopSession,
  subscribe,
  updateSessionConfig,
} from "./meetTranscribe.js";
import { createChat, getChat, sendChatMessage, updateChatConfig } from "./chat.js";
import { getQuotePdf } from "./intactPdf.js";
import { loadDoc } from "./docPdf.js";
import { docFontStatus } from "./docTemplate.js";
import { emailStatus, verifyEmail } from "./email.js";
import { startPublicDocs } from "./publicDocs.js";
import {
  deleteMeeting,
  getplus1Settings,
  meetingStats,
  saveplus1Settings,
  searchMeetings,
  storeEnabled,
} from "./store.js";
import {
  loadWorkCamConfig,
  persistWorkCamConfig,
  type WorkCamMode,
} from "./workCamConfig.js";
import {
  getWorkCamSession,
  listWorkCamSessions,
  startWorkCam,
  stopWorkCam,
} from "./workCamMeet.js";

const app = express();
const configuredOrigin = envOptional("DASHBOARD_ORIGIN") ?? "http://localhost:3000";

// Local dev agent: allow the configured dashboard origin plus any loopback port,
// so the UW tab works whether Next picked 3000, 3001, 3002, ...
// Non-loopback origins are still rejected.
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        // curl / server-to-server (no Origin header)
        callback(null, true);
        return;
      }
      if (origin === configuredOrigin || LOOPBACK_ORIGIN.test(origin)) {
        callback(null, true);
        return;
      }
      // Reject without throwing: omit CORS headers instead of raising a 500.
      callback(null, false);
    },
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "backend", store: storeEnabled() ? "mongodb" : "memory" });
});

app.post("/api/federato/cache", async (_req, res) => {
  try {
    const result = await cacheSchemaAndPolicies();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/federato/rank", async (req, res) => {
  try {
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const enrich = req.query.enrich === "1" || req.query.enrich === "true";
    const result = await rankQueue({ refresh, enrich });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── The agent's Federato tools, callable directly (the UW tab, curl, judges) ──
app.post("/api/federato/query", async (req, res) => {
  try {
    const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
    if (!goal) { res.status(400).json({ error: "body.goal (plain english) required" }); return; }
    res.json(await agenticQuery(goal));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
app.get("/api/federato/draft/:policyId", async (req, res) => {
  try {
    const kind = (typeof req.query.kind === "string" ? req.query.kind : "quote") as DraftKind;
    if (!["quote", "declarations", "decline", "memo"].includes(kind)) { res.status(400).json({ error: "kind must be quote | declarations | decline | memo" }); return; }
    const d = await draftDocument(kind, Number(req.params.policyId));
    if (req.query.format === "md") { res.type("text/markdown").send(d.markdown); return; }
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
app.get("/api/federato/contract/:ref", async (req, res) => {
  try {
    const d = await buildContractDraft(String(req.params.ref));
    if (req.query.format === "md") { res.type("text/markdown").send(d.markdown); return; }
    res.json(d);
  } catch (e) {
    res.status(/no open submission/.test((e as Error).message) ? 404 : 500).json({ error: (e as Error).message });
  }
});
app.get("/api/federato/submissions", async (req, res) => {
  try {
    const enrich = req.query.enrich !== "0";
    res.json(await rankOpenSubmissions({ enrich }));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
app.get("/api/federato/enrich/:policyId", async (req, res) => {
  try {
    const out = await runFederatoTool("federato_enrich", { query: String(req.params.policyId) });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
app.get("/api/federato/portfolio", async (req, res) => {
  try {
    res.json(await runFederatoTool("federato_portfolio", { query: typeof req.query.by === "string" ? req.query.by : undefined }));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
app.post("/api/federato/tool", async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!name.startsWith("federato_")) { res.status(400).json({ error: "body.name must be a federato_* tool" }); return; }
    res.json(await runFederatoTool(name, { query: typeof req.body?.query === "string" ? req.body.query : undefined }));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/federato/deep-dive/:policyId?", async (req, res) => {
  try {
    const policyId = Number(req.params.policyId ?? 1001);
    const enrich = req.query.enrich !== "0";
    const { deepDive, hops } = await deepDivePolicy(policyId, { enrich });
    const browse =
      req.query.browse === "0"
        ? null
        : await runBrowserbaseVerification({
            address: deepDive.address || "44 Cedar Ln",
            city: deepDive.city || "Tampa",
            state: deepDive.state || "FL",
            zip: deepDive.zip || "33602",
          });
    res.json({ deepDive, browse, hops });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/api/federato/screenshare-session", async (req, res) => {
  try {
    const policyId = Number(req.body?.policyId ?? 1001);
    const { deepDive } = await deepDivePolicy(policyId);
    const browse = await openWorkSessionForScreenshare({
      address: deepDive.address || "44 Cedar Ln",
      city: deepDive.city || "Tampa",
      state: deepDive.state || "FL",
      zip: deepDive.zip || "33602",
    });
    res.json({ deepDive, browse });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/api/federato/present-meet", async (req, res) => {
  try {
    const meetUrl = resolveMeetUrl(
      typeof req.body?.meetUrl === "string" ? req.body.meetUrl : undefined,
    );
    if (!meetUrl) {
      res.status(400).json({
        error: "Set MEET_URL in .env or pass { meetUrl } in the body",
      });
      return;
    }
    const policyId = Number(req.body?.policyId ?? 1001);
    const { deepDive } = await deepDivePolicy(policyId);
    const browse = await openWorkSessionForScreenshare({
      address: deepDive.address || "44 Cedar Ln",
      city: deepDive.city || "Tampa",
      state: deepDive.state || "FL",
      zip: deepDive.zip || "33602",
    });
    if (!browse.liveViewUrl) {
      res.status(500).json({ error: browse.error ?? "No live view URL", deepDive, browse });
      return;
    }
    const meet = await presentLiveViewInMeet({
      meetUrl,
      liveViewUrl: browse.liveViewUrl,
    });
    res.json({ deepDive, browse, meet });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── Send a plus1: join a Meet and transcribe it live ──────────────────────
const MEET_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/i;

app.post("/api/meet/join", (req, res) => {
  const meetUrl = typeof req.body?.meetUrl === "string" ? req.body.meetUrl.trim() : "";
  if (!MEET_RE.test(meetUrl)) {
    res.status(400).json({
      error: "Expected a Google Meet link like https://meet.google.com/abc-defg-hij",
    });
    return;
  }
  const config = req.body?.config && typeof req.body.config === "object" ? req.body.config : undefined;
  const purpose = typeof req.body?.purpose === "string" ? req.body.purpose : undefined;
  const workTask = typeof req.body?.task === "string" ? req.body.task : undefined;
  const { sessionId } = startMeetTranscription(meetUrl, config, purpose, workTask);
  res.json({ sessionId });
});

app.get("/api/meet/sessions", async (_req, res) => {
  try {
    res.json({ sessions: await listSessions(), store: storeEnabled() ? "mongodb" : "memory" });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Full-text search across every transcript stored in Atlas.
app.get("/api/meet/search", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json({ results: await searchMeetings(q) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/meet/stats", async (_req, res) => {
  try {
    res.json({ stats: await meetingStats() });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/meet/sessions/:id", async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "No such session" });
      return;
    }
    res.json({ session });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Relabel a meeting — works for live sessions and stored ones alike.
app.patch("/api/meet/sessions/:id", async (req, res) => {
  const purpose = typeof req.body?.purpose === "string" ? req.body.purpose : "";
  const ok = await renameSession(req.params.id, purpose);
  if (!ok) {
    res.status(404).json({ error: "No such session" });
    return;
  }
  res.json({ ok: true, purpose: purpose.trim() });
});

app.delete("/api/meet/sessions/:id", async (req, res) => {
  await stopSession(req.params.id);
  const removed = await deleteMeeting(req.params.id);
  res.json({ ok: true, removed });
});

app.get("/api/meet/sessions/:id/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const ok = subscribe(req.params.id, res);
  if (!ok) {
    res.write(`event: status\ndata: ${JSON.stringify({ status: "error", error: "No such session" })}\n\n`);
    res.end();
  }
});

// ── The plus1 speaks: control-plane → runner commands (HLD §10), per session ──
function plus1Route(handler: (id: string, body: any) => unknown | Promise<unknown>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      const out = await handler(String(req.params.id), req.body ?? {});
      res.json(out ?? { ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      res.status(/No such session/.test(msg) ? 404 : /no avatar|not ready/i.test(msg) ? 409 : 500).json({ error: msg });
    }
  };
}
app.post("/api/meet/sessions/:id/speak", plus1Route((id, b) => {
  if (typeof b.text !== "string" || !b.text.trim()) throw new Error("text required");
  return speakInSession(id, b.text);
}));
app.post("/api/meet/sessions/:id/filler", plus1Route((id, b) => fillerInSession(id, b.kind ?? "ack") ?? { error: "no fillers cached" }));
app.post("/api/meet/sessions/:id/interrupt", plus1Route((id) => { interruptSession(id); }));
app.post("/api/meet/sessions/:id/honk", plus1Route((id) => honkSession(id)));
app.post("/api/meet/sessions/:id/emote", plus1Route((id, b) => emoteSession(id, b.emote ?? "idle")));
app.post("/api/meet/sessions/:id/config", plus1Route((id, b) => {
  const config = b?.config && typeof b.config === "object" ? b.config : b;
  const ok = updateSessionConfig(id, config ?? {});
  if (!ok) throw new Error("No such session");
  return { ok: true };
}));

// ── plus1 settings, stored in MongoDB so they follow the plus1 ─────────────
app.get("/api/plus1/config", async (_req, res) => {
  try {
    res.json({ config: await getplus1Settings(), store: storeEnabled() ? "mongodb" : "memory" });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.put("/api/plus1/config", async (req, res) => {
  const config = req.body?.config && typeof req.body.config === "object" ? req.body.config : req.body;
  if (!config || typeof config !== "object") {
    res.status(400).json({ error: "Expected a config object" });
    return;
  }
  try {
    const saved = await saveplus1Settings(config as Record<string, unknown>);
    // No database configured is not an error: the tab keeps its local copy.
    res.json({ ok: true, saved, store: storeEnabled() ? "mongodb" : "memory" });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Serve a generated Intact quote PDF (in-memory, short-lived).
app.get("/api/intact/quote/:id.pdf", (req, res) => {
  const bytes = getQuotePdf(String(req.params.id));
  if (!bytes) {
    res.status(404).json({ error: "quote expired or not found" });
    return;
  }
  res.setHeader("content-type", "application/pdf");
  res.setHeader("content-disposition", `inline; filename="intact-quote-${req.params.id}.pdf"`);
  res.send(Buffer.from(bytes));
});

// Serve a generated PDF document. Falls back to Mongo, so a link handed out
// before a restart still resolves.
app.get("/api/doc/:id.pdf", async (req, res) => {
  const doc = await loadDoc(String(req.params.id)).catch(() => undefined);
  if (!doc) {
    res.status(404).json({ error: "document expired or not found" });
    return;
  }
  res.setHeader("content-type", "application/pdf");
  res.setHeader("content-disposition", `inline; filename="${doc.filename}"`);
  res.send(Buffer.from(doc.bytes));
});

// Is email actually wired up? The plus1 tab uses this to show a live badge, so
// nobody discovers mid-demo that sends were dry runs all along.
app.get("/api/email/status", async (req, res) => {
  const status = emailStatus();
  // ?verify=1 opens a real SMTP connection; skip it on a plain poll.
  if (status.configured && req.query.verify === "1") {
    const check = await verifyEmail();
    res.json({ ...status, verified: check.ok, error: check.error });
    return;
  }
  res.json(status);
});

// ── Work-cam: local Present vs cloud camera ─────────────────────────────────
app.get("/api/work-cam/config", async (_req, res) => {
  try {
    const cfg = await loadWorkCamConfig();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.put("/api/work-cam/config", async (req, res) => {
  const mode = req.body?.mode;
  if (mode !== "local" && mode !== "cloud") {
    res.status(400).json({ error: 'Expected { mode: "local" | "cloud" }' });
    return;
  }
  try {
    const cfg = await persistWorkCamConfig({ mode });
    res.json({ ok: true, ...cfg });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/work-cam/sessions", (_req, res) => {
  res.json({ sessions: listWorkCamSessions() });
});

app.get("/api/work-cam/sessions/:id", (req, res) => {
  const s = getWorkCamSession(String(req.params.id));
  if (!s) {
    res.status(404).json({ error: "No such work-cam session" });
    return;
  }
  res.json(s);
});

app.post("/api/work-cam/start", async (req, res) => {
  const meetUrl = typeof req.body?.meetUrl === "string" ? req.body.meetUrl.trim() : "";
  if (!MEET_RE.test(meetUrl)) {
    res.status(400).json({
      error: "Pass a Google Meet URL like https://meet.google.com/abc-defg-hij",
    });
    return;
  }
  const modeRaw = req.body?.mode;
  const mode: WorkCamMode | undefined =
    modeRaw === "local" || modeRaw === "cloud" ? modeRaw : undefined;
  const task = typeof req.body?.task === "string" ? req.body.task.trim() : undefined;
  const startUrl =
    typeof req.body?.startUrl === "string" ? req.body.startUrl.trim() : undefined;
  const sessionId =
    typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : undefined;
  const connectUrl =
    typeof req.body?.connectUrl === "string" ? req.body.connectUrl.trim() : undefined;

  try {
    // startWorkCam is long-running — await it so the response has real status.
    const session = await startWorkCam({
      meetUrl,
      mode,
      task: task || undefined,
      startUrl: startUrl || undefined,
      sessionId: sessionId || undefined,
      connectUrl: connectUrl || undefined,
    });
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/api/work-cam/sessions/:id/stop", async (req, res) => {
  const ok = await stopWorkCam(String(req.params.id));
  if (!ok) {
    res.status(404).json({ error: "No such work-cam session" });
    return;
  }
  res.json({ ok: true });
});

// ── Live chat with the plus1 (no meeting) ───────────────────────────────────
app.post("/api/chat/sessions", (req, res) => {
  const config = req.body?.config && typeof req.body.config === "object" ? req.body.config : undefined;
  res.json(createChat(config));
});
app.get("/api/chat/sessions/:id", (req, res) => {
  const c = getChat(String(req.params.id));
  if (!c) {
    res.status(404).json({ error: "No such chat" });
    return;
  }
  res.json({ id: c.id, messages: c.messages });
});
app.post("/api/chat/sessions/:id/message", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const config = req.body?.config && typeof req.body.config === "object" ? req.body.config : undefined;
  try {
    const out = await sendChatMessage(String(req.params.id), text, config);
    res.json(out);
  } catch (e) {
    const msg = (e as Error).message;
    res.status(/No such chat/.test(msg) ? 404 : 400).json({ error: msg });
  }
});
app.post("/api/chat/sessions/:id/config", (req, res) => {
  const config = req.body?.config && typeof req.body.config === "object" ? req.body.config : req.body;
  const ok = updateChatConfig(String(req.params.id), config ?? {});
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: "No such chat" });
});
app.get("/api/meet/sessions/:id/avatar", (req, res) => {
  const st = avatarStatus(req.params.id);
  if (!st) { res.status(404).json({ error: "No such session" }); return; }
  res.json(st);
});

app.post("/api/meet/sessions/:id/leave", async (req, res) => {
  const stopped = await stopSession(req.params.id);
  if (!stopped) {
    res.status(404).json({ error: "No such session" });
    return;
  }
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
  // Say it at boot, not at render time: generated PDFs silently fall back to the
  // PDF core fonts when Geist is missing, and that is an operator's problem to
  // know about rather than a reader's to discover.
  const fonts = docFontStatus();
  if (!fonts.ok) {
    console.warn(
      `[docPdf] Geist missing from ${fonts.dir} (${fonts.missing.join(", ")}) — PDFs will render in the PDF core fonts`,
    );
  }
  // The public document server is a separate app on a separate port, so only it
  // ever sits behind the tunnel. Off unless PUBLIC_DOCS=1.
  startPublicDocs({ mainPort: port });
});
