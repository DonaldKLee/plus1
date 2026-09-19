/**
 * Start (or reuse) a Browserbase live-view session, then Playwright-join
 * Google Meet and Present that tab.
 *
 *   MEET_URL=https://meet.google.com/xxx-yyyy-zzz npm run backend:screenshare
 *   POLICY_ID=1001 MEET_URL=... npm run backend:screenshare
 */

import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, envOptional } from "./env.js";
import { deepDivePolicy } from "./deepDive.js";
import { openWorkSessionForScreenshare } from "./browserbaseWork.js";
import { presentLiveViewInMeet, resolveMeetUrl } from "./meetPresent.js";

async function resolveLiveView(): Promise<{
  liveViewUrl: string;
  sessionId?: string;
}> {
  const fromEnv = envOptional("LIVE_VIEW_URL");
  if (fromEnv) return { liveViewUrl: fromEnv };

  const cached = path.join(CACHE_DIR, "screenshare-session.json");
  if (fs.existsSync(cached)) {
    const j = JSON.parse(fs.readFileSync(cached, "utf8")) as {
      liveViewUrl?: string;
      sessionId?: string;
      status?: string;
    };
    if (j.liveViewUrl && j.status === "running") {
      return { liveViewUrl: j.liveViewUrl, sessionId: j.sessionId };
    }
  }

  const policyId = Number(envOptional("POLICY_ID") ?? 1001);
  console.log(`Starting work session for policy ${policyId}…`);
  const { deepDive } = await deepDivePolicy(policyId);
  const browse = await openWorkSessionForScreenshare({
    address: deepDive.address || "44 Cedar Ln",
    city: deepDive.city || "Tampa",
    state: deepDive.state || "FL",
    zip: deepDive.zip || "33602",
  });
  if (!browse.liveViewUrl) {
    throw new Error(browse.error ?? "No live view URL");
  }
  console.log("Session:", browse.sessionId, browse.liveViewUrl);
  return { liveViewUrl: browse.liveViewUrl, sessionId: browse.sessionId };
}

async function main() {
  const meetUrl = resolveMeetUrl();
  const { liveViewUrl } = await resolveLiveView();

  if (!meetUrl) {
    console.log("Opened live view only. Set MEET_URL to auto-join and Present.");
    console.log(liveViewUrl);
    await new Promise(() => {});
    return;
  }

  const result = await presentLiveViewInMeet({ meetUrl, liveViewUrl });
  console.log(JSON.stringify(result, null, 2));
  if (!result.joined) {
    console.log("Join did not finish. Sign in / admit the guest, then re-run.");
  }
  console.log("Leave this process running while you demo. Ctrl+C to exit.");
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
