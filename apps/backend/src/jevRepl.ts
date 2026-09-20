/**
 * Persistent work-browser REPL — one Browserbase session, many prompts.
 * Does not create Agent runs (those are capped at 15).
 *
 *   npm run backend:jev
 *
 * Commands:
 *   <task>       run the prompt on the long-lived session
 *   /live        print session live-view URL
 *   /last        print last result
 *   /q           quit (session stays up)
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { envOptional } from "./env.js";
import { startJevOrStagehand } from "./jevAgent.js";

type LastRun = {
  runId: string;
  agentId?: string;
  sessionId?: string;
  status: "COMPLETED";
  liveView?: string;
  ms: number;
};

async function main() {
  const apiKey = envOptional("BROWSERBASE_API_KEY");
  if (!apiKey) {
    console.error("Need BROWSERBASE_API_KEY in .env");
    process.exit(1);
  }

  console.log("mode   persistent Browserbase session (no agent runs)");
  console.log("ready — paste a task; same browser stays open. /q does not kill it.");
  console.log("");

  const rl = readline.createInterface({ input, output, terminal: true });
  let last: LastRun | undefined;

  const shutdown = () => {
    rl.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);

  for (;;) {
    let line: string;
    try {
      line = (await rl.question("jev> ")).trim();
    } catch {
      break;
    }
    if (!line) continue;

    const lower = line.toLowerCase();
    if (lower === "/q" || lower === "quit" || lower === "exit") {
      shutdown();
      return;
    }
    if (lower === "/help") {
      console.log(`
  <task>     drive the persistent Browserbase session
  /live      session live-view URL
  /last      last result
  /q         quit (session stays up)
`);
      continue;
    }
    if (lower === "/live") {
      console.log(last?.liveView ?? "(no session yet)");
      continue;
    }
    if (lower === "/last") {
      if (!last) {
        console.log("(no session yet)");
        continue;
      }
      console.log(JSON.stringify(last, null, 2).slice(0, 2000));
      continue;
    }

    try {
      const t0 = Date.now();
      const notes: string[] = [];
      notes.push = ((...items: string[]) => {
        for (const item of items) console.log(`  ${item}`);
        return Array.prototype.push.apply(notes, items as string[]);
      }) as typeof notes.push;
      const session = await startJevOrStagehand(line, notes, { waitForTask: true });
      last = {
        runId: session.runId,
        agentId: session.agentId,
        sessionId: session.sessionId,
        status: "COMPLETED",
        liveView: session.liveViewUrl,
        ms: Date.now() - t0,
      };
      console.log(`live   ${session.liveViewUrl}`);
      console.log(`done   ${last.ms}ms  session ${session.sessionId}`);
    } catch (e) {
      console.error(`fail  ${(e as Error).message}`);
    }
  }

  shutdown();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
