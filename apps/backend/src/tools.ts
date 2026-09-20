/**
 * One place that runs a tool and enforces access, shared by the meeting runner
 * and the chat harness — so "talking to Bob" in chat exercises exactly the same
 * tool path as a real meeting.
 */
import { narrateToolResult, runTool, type Decision, type MeetingState, type ToolAccess, type ToolReply } from "./agentBrain.js";
import { runFileTool, READ_TOOLS, WRITE_TOOLS, type FileTool } from "./fileTools.js";
import { runCommand } from "./shellTools.js";
import { runFederatoTool } from "./federatoTools.js";
import { runIntactTool, type NextStep } from "./intactTools.js";
import { runEmailTool } from "./emailTools.js";
import { runDocTool } from "./docTools.js";
import { runBrowserWork } from "./browserWork.js";
import type { QuoteResult } from "@plus1/brain";

export type ToolCall = NonNullable<Decision["tool"]>;

/** A tool result: a room-ready string, plus structured data when there is any. */
export interface ToolResult {
  text: string;
  quote?: QuoteResult;
  pdfUrl?: string;
  nextStep?: NextStep;
  /** Reasoning trace for the operator: which queries ran, which sources answered. */
  trace?: string[];
  /** An email was drafted and is waiting on a human's yes (sendApproval). */
  pendingApproval?: boolean;
  /** A publicly reachable link, when public sharing is configured. */
  shareUrl?: string;
}

const t = (text: string): ToolResult => ({ text });

/** Run one tool call, gated by the session's access. */
export async function executeTool(
  call: ToolCall,
  access: ToolAccess,
  opts?: { meetingId?: string },
): Promise<ToolResult> {
  const name = call.name;

  if (name.startsWith("federato_")) {
    if (access.federato === false) return t("Federato is turned off right now.");
    return runFederatoTool(name, { query: call.query })
      .then((r) => ({ text: r.text, trace: r.trace }))
      .catch((e: Error) => t(`Federato error: ${e.message}`));
  }

  if (name.startsWith("intact_")) {
    if (!access.intact) return t("Intact isn't connected right now.");
    return runIntactTool(name, { query: call.query, details: call.details })
      .then((r) => ({ text: r.text, quote: r.quote, pdfUrl: r.pdfUrl, nextStep: r.nextStep }))
      .catch((e: Error) => t(`Intact error: ${e.message}`));
  }

  if (name.startsWith("doc_")) {
    if (!access.docs) return t("document generation is turned off right now.");
    return runDocTool(name, {
      query: call.query,
      content: call.content,
      details: call.details,
      meetingId: opts?.meetingId,
    })
      .then((r) => ({ text: r.text, pdfUrl: r.pdfUrl, shareUrl: r.shareUrl }))
      .catch((e: Error) => t(`pdf error: ${e.message}`));
  }

  if (name.startsWith("email_")) {
    if (!access.email) return t("email isn't connected right now.");
    return runEmailTool(
      name,
      { query: call.query, content: call.content, details: call.details },
      // guardrails.sendApproval → preview + confirm instead of sending outright.
      { requireApproval: access.sendApproval !== false },
    )
      .then((r) => ({
        text: r.text,
        pdfUrl: r.pdfUrl,
        shareUrl: r.shareUrl,
        pendingApproval: r.pendingApproval,
      }))
      .catch((e: Error) => t(`email error: ${e.message}`));
  }

  if (name === "browser_work") {
    if (access.browser === false) return t("screen share is turned off right now.");
    return runBrowserWork({ meetingId: opts?.meetingId, task: call.query ?? "" }).catch((e: Error) =>
      t(`browser error: ${e.message}`),
    );
  }

  if (name === "run_command") {
    if (access.files !== "write") return t("i don't have write access to run commands right now.");
    return runCommand(call.command ?? "")
      .then((text) => t(text))
      .catch((e: Error) => t(`command error: ${e.message}`));
  }

  if (READ_TOOLS.includes(name as FileTool) || WRITE_TOOLS.includes(name as FileTool)) {
    if (access.files === "off") return t("local file access is turned off.");
    if (WRITE_TOOLS.includes(name as FileTool) && access.files !== "write") {
      return t("i only have read access to files right now.");
    }
    return runFileTool(name as FileTool, { path: call.path, content: call.content })
      .then((text) => t(text))
      .catch((e: Error) => t(`file error: ${e.message}`));
  }

  return t(await runTool(name, call.query));
}


// ── Tool chains: announce → run → narrate → (maybe) one more tool → … ──────
// The narrating turn may ask for a follow-up lookup (ToolReply.nextTool). This runs the
// chain with a hard cap so a meeting never turns into an unbounded research project, and
// hands every step back to the caller (chat message, spoken line, operator note).

export interface ChainStep {
  call: ToolCall;
  args: string;
  announced?: string;
  result: ToolResult;
  reply: ToolReply;
}

export interface ChainContext {
  transcript: () => string;
  name: string;
  autonomy: number;
  persona?: string;
  guardrails?: string[];
  channel?: "meeting" | "chat";
  memory: string[];
  muted?: boolean;
  state: MeetingState;
  /** Meeting this chain belongs to, when there is one (doc tools attach to it). */
  meetingId?: string;
}

export interface ChainHooks {
  /** Say the interim line before a follow-up tool runs (voice or chat). */
  announce?: (say: string, step: number) => Promise<void>;
  /** A tool finished (result in hand, not yet narrated). */
  onResult?: (step: ChainStep) => void | Promise<void>;
}

export const MAX_CHAIN_STEPS = 3;

export function argsOf(call: ToolCall): string {
  return call.command ?? call.path ?? call.query ?? (call.details ? JSON.stringify(call.details) : "");
}

/**
 * Execute `first` (already announced by the caller), narrate it, and keep going while the
 * narration asks for a follow-up. Returns every step; the last step's reply.say is the
 * answer to deliver.
 */
export async function runToolChain(first: ToolCall, access: ToolAccess, ctx: ChainContext, hooks: ChainHooks = {}, announced?: string): Promise<ChainStep[]> {
  const steps: ChainStep[] = [];
  let call: ToolCall = first;
  let lastAnnounced = announced;
  for (let depth = 0; depth < MAX_CHAIN_STEPS; depth++) {
    const args = argsOf(call);
    let result: ToolResult;
    try {
      result = await executeTool(call, access, { meetingId: ctx.meetingId });
    } catch (e) {
      result = { text: `the ${call.name} tool failed: ${(e as Error).message}` };
    }
    let reply: ToolReply;
    try {
      reply = await narrateToolResult({
        toolName: call.name,
        args,
        result: result.text,
        transcript: ctx.transcript(),
        name: ctx.name,
        autonomy: ctx.autonomy,
        persona: ctx.persona,
        guardrails: ctx.guardrails,
        access,
        channel: ctx.channel,
        memory: ctx.memory,
        muted: ctx.muted,
        state: ctx.state,
        announced: lastAnnounced,
        chainDepth: depth,
      });
    } catch (e) {
      reply = { say: result.text }; // never swallow the answer because phrasing failed
    }
    const step: ChainStep = { call, args, announced: lastAnnounced, result, reply };
    steps.push(step);
    await hooks.onResult?.(step);

    const next = reply.nextTool;
    if (!next || depth === MAX_CHAIN_STEPS - 1) break;
    // The interim line is the announcement for the next tool.
    if (reply.say.trim() && hooks.announce) await hooks.announce(reply.say.trim(), depth + 1);
    lastAnnounced = reply.say.trim() || undefined;
    call = { name: next.name, query: next.query };
  }
  return steps;
}
