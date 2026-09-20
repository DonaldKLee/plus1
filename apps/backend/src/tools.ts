/**
 * One place that runs a tool and enforces access, shared by the meeting runner
 * and the chat harness — so "talking to Bob" in chat exercises exactly the same
 * tool path as a real meeting.
 */
import { runTool, type Decision, type ToolAccess } from "./agentBrain.js";
import { runFileTool, READ_TOOLS, WRITE_TOOLS, type FileTool } from "./fileTools.js";
import { runCommand } from "./shellTools.js";
import { runFederatoTool } from "./federatoTools.js";
import { runIntactTool, type NextStep } from "./intactTools.js";
import type { QuoteResult } from "@plus1/brain";

export type ToolCall = NonNullable<Decision["tool"]>;

/** A tool result: a room-ready string, plus structured data when there is any. */
export interface ToolResult {
  text: string;
  quote?: QuoteResult;
  pdfUrl?: string;
  nextStep?: NextStep;
}

const t = (text: string): ToolResult => ({ text });

/** Run one tool call, gated by the session's access. */
export async function executeTool(call: ToolCall, access: ToolAccess): Promise<ToolResult> {
  const name = call.name;

  if (name.startsWith("federato_")) {
    if (access.federato === false) return t("Federato is turned off right now.");
    return runFederatoTool(name, { query: call.query })
      .then((text) => t(text))
      .catch((e: Error) => t(`Federato error: ${e.message}`));
  }

  if (name.startsWith("intact_")) {
    if (!access.intact) return t("Intact isn't connected right now.");
    return runIntactTool(name, { query: call.query, details: call.details })
      .then((r) => ({ text: r.text, quote: r.quote, pdfUrl: r.pdfUrl, nextStep: r.nextStep }))
      .catch((e: Error) => t(`Intact error: ${e.message}`));
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
