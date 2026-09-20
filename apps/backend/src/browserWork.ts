/**
 * Shannon's screenshare tool: Present the Browserbase work tab into Meet, then
 * run a jev agent on that browser. After the run finishes we keep presenting
 * so the next ask does not start over.
 */
import type { Page } from "playwright-core";
import type { FillerKind } from "@plus1/voice";
import { postToMeetChat } from "./agentBrain.js";
import { presentWorkTab, stampWorkTitle, stopPresentingWorkTab, WORK_TAB_TITLE } from "./meetPresent.js";
import {
  startJevOrStagehand,
  waitForCurrentJevRun,
  type JevRunInfo,
} from "./jevAgent.js";
import { humWhile, watchShare } from "./screenWatch.js";
import { emitWorkHold, showWorkHold } from "./workHold.js";

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

/** Longer write-up for Meet chat — not spoken. */
function chatSummary(info: JevRunInfo | undefined, task: string): string {
  const status = info?.status ?? "COMPLETED";
  const url = info?.url?.trim();
  const detail = info?.detail?.replace(/\s+/g, " ").trim().slice(0, 500);
  const lines = [
    `browser: ${task.slice(0, 120)}`,
    status === "COMPLETED" || status === "gemini" || status === "openai"
      ? "status: done — still sharing"
      : `status: ${status}`,
    url ? `page: ${url}` : undefined,
    detail && detail.length > 8 ? detail : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Short tool result for the model — speak one line; details went to chat. */
function summarize(info: JevRunInfo | undefined, postedChat: boolean): string {
  const status = info?.status ?? "COMPLETED";
  const ok = status === "COMPLETED" || status === "gemini" || status === "openai";
  const bits = [
    ok ? "Done. It's on screen." : `The browser agent ended ${status}.`,
    postedChat
      ? "Details were posted to Meet chat. Speak ONE short line that it's up — do not narrate steps or read the chat aloud."
      : "Still sharing. Speak one short line — do not narrate every step.",
    "Leave the share up for the next task.",
  ];
  return bits.join(" ");
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
  // Don't leave Present on a dying live-view while the next agent spins up.
  emitWorkHold();
  if (media?.workPage) void showWorkHold(media.workPage, media.note);

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

  let postedChat = false;
  if (media?.meetPage) {
    const body = chatSummary(info, task);
    try {
      postedChat = await postToMeetChat(media.meetPage, body);
      notes.push(postedChat ? "Posted browser result to Meet chat." : "Meet chat post failed.");
    } catch (e) {
      notes.push(`Meet chat: ${(e as Error).message}`);
    }
  }
  if (heard.length) {
    notes.push(`screenWatch said: ${heard.slice(-3).join(" / ")}`);
  }
  return { text: summarize(info, postedChat) };
}

/** Stop presenting the work tab into Meet (leave the Browserbase session alone). */
export async function runBrowserUnshare(opts: {
  meetingId?: string;
}): Promise<{ text: string }> {
  const media = opts.meetingId ? mediaByMeeting.get(opts.meetingId) : undefined;
  const notes = bindNotes(media?.note);
  if (!media?.meetPage) {
    return { text: "i'm not in a live Meet, so there's nothing to unshare." };
  }
  notes.push("browser_unshare: stopping Present");
  const ok = await stopPresentingWorkTab(media.meetPage, notes);
  return {
    text: ok
      ? "Stopped sharing my screen."
      : "Couldn't stop presenting — try clicking Stop presenting in Meet.",
  };
}
