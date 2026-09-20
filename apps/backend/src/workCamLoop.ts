/**
 * Retry local work-cam until Meet join succeeds.
 *   node --import tsx src/workCamLoop.ts
 */
import { startWorkCam, stopWorkCam } from "./workCamMeet.js";

const MEET = "https://meet.google.com/vhz-nzug-ich";
const TASK =
  'Go to maps.google.com, search "Waterloo, Ontario", switch to Satellite, zoom the campus.';
const MAX = 8;

async function main() {
  for (let i = 1; i <= MAX; i++) {
    console.log("");
    console.log(`======== ATTEMPT ${i}/${MAX} ========`);
    const session = await startWorkCam({
      meetUrl: MEET,
      task: TASK,
      mode: "local",
    });

    console.log("── result ──");
    console.log(`status  ${session.status}`);
    console.log(`joined  ${session.joined}`);
    if (session.workLiveViewUrl) console.log(`work    ${session.workLiveViewUrl}`);
    for (const n of session.notes.slice(-8)) console.log(`  ${n}`);

    if (session.joined && session.status !== "error") {
      console.log("");
      console.log("WORKED — in the meeting. Leaving it live. Ctrl+C to stop.");
      process.on("SIGINT", () => void stopWorkCam(session.id).then(() => process.exit(0)));
      process.on("SIGTERM", () => void stopWorkCam(session.id).then(() => process.exit(0)));
      await new Promise(() => {});
      return;
    }

    console.log("failed — stopping and retrying…");
    await stopWorkCam(session.id).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error(`Gave up after ${MAX} attempts.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
