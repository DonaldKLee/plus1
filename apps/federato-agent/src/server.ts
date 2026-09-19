import express from "express";
import cors from "cors";
import { envOptional } from "./env.js";
import { cacheSchemaAndPolicies } from "./federatoClient.js";
import { rankQueue } from "./rank.js";
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
  stopSession,
  subscribe,
} from "./meetTranscribe.js";

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
  res.json({ ok: true, service: "federato-agent" });
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
    const result = await rankQueue({ refresh });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/federato/deep-dive/:policyId?", async (req, res) => {
  try {
    const policyId = Number(req.params.policyId ?? 1001);
    const { deepDive, hops } = await deepDivePolicy(policyId);
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

// ── Send a goose: join a Meet and transcribe it live ──────────────────────
const MEET_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/i;

app.post("/api/meet/join", (req, res) => {
  const meetUrl = typeof req.body?.meetUrl === "string" ? req.body.meetUrl.trim() : "";
  if (!MEET_RE.test(meetUrl)) {
    res.status(400).json({
      error: "Expected a Google Meet link like https://meet.google.com/abc-defg-hij",
    });
    return;
  }
  const { sessionId } = startMeetTranscription(meetUrl);
  res.json({ sessionId });
});

app.get("/api/meet/sessions", (_req, res) => {
  res.json({ sessions: listSessions() });
});

app.get("/api/meet/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "No such session" });
    return;
  }
  res.json({ session });
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

// ── The goose speaks: control-plane → runner commands (HLD §10), per session ──
function gooseRoute(handler: (id: string, body: any) => unknown | Promise<unknown>) {
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
app.post("/api/meet/sessions/:id/speak", gooseRoute((id, b) => {
  if (typeof b.text !== "string" || !b.text.trim()) throw new Error("text required");
  return speakInSession(id, b.text);
}));
app.post("/api/meet/sessions/:id/filler", gooseRoute((id, b) => fillerInSession(id, b.kind ?? "ack") ?? { error: "no fillers cached" }));
app.post("/api/meet/sessions/:id/interrupt", gooseRoute((id) => { interruptSession(id); }));
app.post("/api/meet/sessions/:id/honk", gooseRoute((id) => honkSession(id)));
app.post("/api/meet/sessions/:id/emote", gooseRoute((id, b) => emoteSession(id, b.emote ?? "idle")));
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
  console.log(`federato-agent listening on http://localhost:${port}`);
});
