/**
 * Shannon's screenshare tool: Present the Browserbase work tab into Meet, then
 * run a jev agent on that browser. After the run finishes we keep presenting
 * so the next ask does not start over.
 */
import type { Page } from "playwright-core";
import type { FillerKind } from "@plus1/voice";
import { presentWorkTab, stampWorkTitle, WORK_TAB_TITLE } from "./meetPresent.js";
import {
  startJevOrStagehand,
  waitForCurrentJevRun,
  type JevRunInfo,
} from "./jevAgent.js";
import { humWhile, watchShare } from "./screenWatch.js";

export type MeetingMedia = {
  meetPage?: Page;
  workPage?: Page;
  note: (msg: string) => void;
  speak?: (text: string) => Promise<void>;
  filler?: (kind: FillerKind) => Promise<void>;
  busy?: () => boolean;
};

const mediaByMeeting = new Map<string, MeetingMedia>();

export function registerMeetingMedia(id: string, media: MeetingMedia): void {
  mediaByMeeting.set(id, media);
}

export function unregisterMeetingMedia(id: string): void {
  mediaByMeeting.delete(id);
}

function bindNotes(note?: (msg: string) => void): string[] {
  const notes: string[] = [];
  notes.push = ((...items: string[]) => {
    if (note) for (const item of items) note(item);
    return Array.prototype.push.apply(notes, items);
  }) as typeof notes.push;
  return notes;
}

function summarize(info: JevRunInfo | undefined, liveViewUrl: string, heard: string[]): string {
  const status = info?.status ?? "COMPLETED";
  const url = info?.url?.trim();
  const detail = info?.detail?.replace(/\s+/g, " ").trim().slice(0, 400);
  const bits = [
    status === "COMPLETED" || status === "gemini"
      ? "Done. The work is on screen."
      : `The browser agent ended ${status}.`,
    url ? `Last page: ${url}.` : undefined,
    detail && detail.length > 8 ? detail : undefined,
    heard.length
      ? `You already talked through the screen (${heard.slice(-4).join(" / ")}). Wrap up in one short line — don't recap every step.`
      : undefined,
    "Still sharing — the window stays up for the next task. Do not stop presenting unless they explicitly ask.",
    liveViewUrl ? `Live view: ${liveViewUrl}` : undefined,
  ];
  return bits.filter(Boolean).join(" ");
}

/**
 * Trigger Present (if we have a live Meet) and run one Browserbase agent task.
 * Keeps the share up after the agent disconnects.
 */
export async function runBrowserWork(opts: {
  meetingId?: string;
  task: string;
}): Promise<{ text: string }> {
  const task = opts.task.replace(/\s+/g, " ").trim();
  if (!task) {
    return { text: "need a task — what should I pull up on screen?" };
  }

  const media = opts.meetingId ? mediaByMeeting.get(opts.meetingId) : undefined;
  const notes = bindNotes(media?.note);
  notes.push(`browser_work: ${task.slice(0, 160)}`);

  const watcher = media?.speak && media.filler && media.busy
    ? {
        workPage: media.workPage,
        note: media.note,
        speak: media.speak,
        filler: media.filler,
        busy: media.busy,
      }
    : undefined;

  const jevP = startJevOrStagehand(task, notes, { waitForTask: false });
  let releaseHum = () => {};
  const humGate = new Promise<void>((r) => {
    releaseHum = r;
  });
  if (watcher) void humWhile(watcher, humGate);

  let jev: Awaited<ReturnType<typeof startJevOrStagehand>> | undefined;
  try {
    jev = await jevP;

    if (media?.workPage) {
      notes.push(`Opening work tab → ${jev.liveViewUrl}`);
      try {
        await media.workPage.goto(jev.liveViewUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await stampWorkTitle(media.workPage);
      } catch (e) {
        notes.push(`work tab: ${(e as Error).message}`);
      }
    }

    if (media?.meetPage) {
      notes.push(`Presenting "${WORK_TAB_TITLE}"`);
      const ok = await presentWorkTab(media.meetPage, notes);
      notes.push(ok ? "Avatar is presenting the work browser." : "Present did not confirm — work is still running in the cloud tab.");
    } else {
      notes.push("No live Meet page — ran the browser agent without presenting.");
    }
  } finally {
    releaseHum();
  }
  if (!jev) return { text: "couldn't start the work browser." };

  const running = waitForCurrentJevRun();
  const heard = watcher ? await watchShare(watcher, task, running) : [];
  const info = await running;
  return { text: summarize(info, jev.liveViewUrl, heard) };
}
