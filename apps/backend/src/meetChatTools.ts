/**
 * Post a message (usually the last PDF share link) into the live Meet chat.
 * Separate from PDF generation on purpose — generating a PDF does not mean
 * the link made it into chat.
 */
import { postToMeetChat } from "./agentBrain.js";
import { getMeetingMedia } from "./browserWork.js";
import { lastDocId, loadDoc, shareUrlFor } from "./docPdf.js";

type Details = Record<string, unknown>;

const strOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

export interface MeetChatToolResult {
  text: string;
  shareUrl?: string;
  /** True only when Meet chat accepted the post. */
  posted?: boolean;
}

async function resolveLastShareUrl(): Promise<string | undefined> {
  const id = lastDocId();
  if (!id) return undefined;
  const doc = await loadDoc(id);
  if (!doc) return undefined;
  return doc.shareUrl ?? shareUrlFor(doc.token);
}

function wantsLastPdf(d: Details, query?: string, hasExplicitMessage?: boolean): boolean {
  const raw = (
    strOf(d.attachPdf) ??
    strOf(d.attachment) ??
    strOf(d.pdf) ??
    strOf(d.what) ??
    (!hasExplicitMessage ? query : undefined) ??
    ""
  ).toLowerCase();
  if (!raw) return !hasExplicitMessage; // default: last PDF when nothing else was given
  return ["last", "latest", "it", "that", "the pdf", "pdf", "quote", "report", "indication", "true", "yes"].includes(
    raw,
  );
}

export async function runMeetChatTool(
  name: string,
  args: { query?: string; content?: string; details?: Details },
  opts: { meetingId?: string } = {},
): Promise<MeetChatToolResult> {
  if (name !== "meet_chat_send") {
    return { text: `Unknown Meet chat tool: ${name}` };
  }

  const d = args.details ?? {};
  let message =
    strOf(d.message) ?? strOf(d.text) ?? strOf(d.body) ?? strOf(args.content) ?? undefined;
  let shareUrl: string | undefined;

  if (wantsLastPdf(d, args.query, Boolean(message))) {
    shareUrl = await resolveLastShareUrl();
    if (shareUrl) {
      message = message ? `${message}\n${shareUrl}` : shareUrl;
    }
  }

  if (!message) {
    return {
      text: "no PDF link to post yet — generate the quote/indication PDF first, then call meet_chat_send.",
      posted: false,
    };
  }

  const media = opts.meetingId ? getMeetingMedia(opts.meetingId) : undefined;
  if (!media?.meetPage || media.meetPage.isClosed()) {
    return {
      text: "not in a live Meet, so I can't post to chat. Do not tell them it's already in the chat.",
      shareUrl,
      posted: false,
    };
  }

  const ok = await postToMeetChat(media.meetPage, message);
  media.note?.(ok ? "meet_chat_send: posted to Meet chat." : "meet_chat_send: Meet chat post FAILED.");
  if (ok) {
    return {
      text: "Posted to Meet chat successfully. You may say it's in the chat now.",
      shareUrl: shareUrl ?? (/^https?:\/\//i.test(message) ? message : undefined),
      posted: true,
    };
  }
  return {
    text: "Meet chat post FAILED — the link is NOT in the chat. Say that and offer to try meet_chat_send again. Do NOT claim you already sent it.",
    shareUrl,
    posted: false,
  };
}
