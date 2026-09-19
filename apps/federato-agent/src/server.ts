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

const app = express();
const origin = envOptional("DASHBOARD_ORIGIN") ?? "http://localhost:3000";
app.use(cors({ origin: [origin, "http://127.0.0.1:3000"] }));
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

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`federato-agent listening on http://localhost:${port}`);
});
