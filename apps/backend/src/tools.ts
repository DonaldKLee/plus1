/**
 * One place that runs a tool and enforces access, shared by the meeting runner
 * and the chat harness — so "talking to Bob" in chat exercises exactly the same
 * tool path as a real meeting.
 */
import { runTool, type Decision, type ToolAccess } from "./agentBrain.js";
import { runFileTool, READ_TOOLS, WRITE_TOOLS, type FileTool } from "./fileTools.js";
import { runCommand } from "./shellTools.js";
import { runFederatoTool } from "./federatoTools.js";

export type ToolCall = NonNullable<Decision["tool"]>;

/** Run one tool call, gated by the session's access. Returns a result string. */
export async function executeTool(t: ToolCall, access: ToolAccess): Promise<string> {
  const name = t.name;

  if (name.startsWith("federato_")) {
    if (access.federato === false) return "Federato is turned off right now.";
    return runFederatoTool(name, { query: t.query }).catch((e: Error) => `Federato error: ${e.message}`);
  }

  if (name === "run_command") {
    if (access.files !== "write") return "i don't have write access to run commands right now.";
    return runCommand(t.command ?? "").catch((e: Error) => `command error: ${e.message}`);
  }

  if (READ_TOOLS.includes(name as FileTool) || WRITE_TOOLS.includes(name as FileTool)) {
    if (access.files === "off") return "local file access is turned off.";
    if (WRITE_TOOLS.includes(name as FileTool) && access.files !== "write") {
      return "i only have read access to files right now.";
    }
    return runFileTool(name as FileTool, { path: t.path, content: t.content }).catch(
      (e: Error) => `file error: ${e.message}`,
    );
  }

  return runTool(name, t.query);
}
