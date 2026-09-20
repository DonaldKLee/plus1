/**
 * Interactive work-cam script — local Present or cloud camera (from saved config).
 *
 *   npm run backend:work-cam
 *
 * Toggle mode on the Goose tab, or pass WORK_CAM_MODE=local|cloud.
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { envOptional } from "./env.js";
import { getWorkCamContextId } from "./workCamContext.js";
import {
  loadWorkCamConfig,
  type WorkCamMode,
  workCamModeLabel,
} from "./workCamConfig.js";
import { startWorkCam, stopWorkCam } from "./workCamMeet.js";

const MEET_RE =
  /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/i;

function normalizeMeetUrl(raw: string): string {
  const t = raw.trim().replace(/^<|>$/g, "");
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(t)) {
    return `https://meet.google.com/${t.toLowerCase()}`;
  }
  return t;
}

async function ask(rl: readline.Interface, q: string): Promise<string> {
  return (await rl.question(q)).trim();
}

async function main() {
  if (!envOptional("BROWSERBASE_API_KEY") || !envOptional("BROWSERBASE_PROJECT_ID")) {
    console.error("Need BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in .env");
    process.exit(1);
  }

  const saved = await loadWorkCamConfig();
  const envMode = envOptional("WORK_CAM_MODE");
  let mode: WorkCamMode =
    envMode === "local" || envMode === "cloud" ? envMode : saved.mode;

  const rl = readline.createInterface({ input, output, terminal: true });

  console.log("plus1 work-cam");
  console.log(`  saved mode: ${workCamModeLabel(saved.mode)} (${saved.source})`);
  console.log("");

  const modeAns = await ask(
    rl,
    `Mode [Enter=${mode}, l=local Present, c=cloud camera]: `,
  );
  if (/^l(ocal)?$/i.test(modeAns)) mode = "local";
  else if (/^c(loud)?$/i.test(modeAns)) mode = "cloud";

  if (mode === "cloud" && !getWorkCamContextId()) {
    console.error("Cloud Meet needs a signed-in Google Context.");
    console.error("Run once:  npm run backend:workcam-login");
    rl.close();
    process.exit(1);
  }

  console.log(`  using ${workCamModeLabel(mode)}`);
  console.log("");

  const DEFAULT_MEET = "https://meet.google.com/vhz-nzug-ich";
  let meetUrl = normalizeMeetUrl(await ask(rl, `Meet link [Enter=${DEFAULT_MEET}]: `));
  if (!meetUrl) meetUrl = DEFAULT_MEET;
  while (!MEET_RE.test(meetUrl)) {
    console.log("  need https://meet.google.com/abc-defg-hij");
    meetUrl = normalizeMeetUrl(await ask(rl, `Meet link [Enter=${DEFAULT_MEET}]: `));
    if (!meetUrl) meetUrl = DEFAULT_MEET;
  }
  console.log(`  using ${meetUrl}`);

  const SUGGESTED =
    'Go to maps.google.com, search "Waterloo, Ontario", switch to Satellite, zoom into the University of Waterloo campus, then pan around the main buildings for a bit.';

  console.log("tip — press Enter to use this prompt:");
  console.log(`  ${SUGGESTED}`);
  console.log("");

  let task = await ask(rl, "jev prompt [Enter = tip above]: ");
  if (!task) task = SUGGESTED;

  rl.close();

  console.log("");
  console.log("running… (live log below)");
  console.log("");

  const session = await startWorkCam({ meetUrl, task, mode });

  console.log("");
  console.log("── summary ──");
  console.log(`mode      ${session.mode}`);
  console.log(`status    ${session.status}`);
  if (session.workSessionId) console.log(`work bb   ${session.workSessionId}`);
  if (session.meetSessionId) console.log(`meet bb   ${session.meetSessionId}`);
  if (session.workLiveViewUrl) {
    console.log("");
    console.log("WATCH WORK (Google Maps / agent):");
    console.log(`  ${session.workLiveViewUrl}`);
  }
  if (session.liveViewUrl) {
    console.log("");
    console.log("watch meet (Meet UI only — not Maps):");
    console.log(`  ${session.liveViewUrl}`);
  }

  if (session.notes.length) {
    console.log("");
    console.log("── last notes ──");
    for (const n of session.notes.slice(-12)) console.log(`  ${n}`);
  }

  if (session.status === "error" && !session.joined) {
    console.error("");
    console.error("failed — never got into the meeting (notes above)");
    process.exit(1);
  }

  console.log("");
  console.log(
    mode === "local"
      ? "live — Present is on. Ctrl+C closes Meet Chrome only; Browserbase work session stays up."
      : "live — Browserbase on the Meet camera tile. Ctrl+C stops Meet; work session stays up.",
  );

  const shutdown = async () => {
    console.log("\nstopping…");
    await stopWorkCam(session.id);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await new Promise(() => {});
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("");
  console.error(msg);
  if (/quota|402|payment required/i.test(msg)) {
    console.error("Browserbase Agents cap is 15 runs this period. Work-cam will try Stagehand next time.");
  }
  process.exit(1);
});
