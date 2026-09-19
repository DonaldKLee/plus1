/**
 * Local file access, exposed to the plus1 as tools (read_file / list_files /
 * write_file). Everything is scoped to a single sandbox directory and every path
 * is contained inside it — the plus1 can never touch anything above the root.
 *
 * Enabling and read-vs-write are gated by the session's plus1 config upstream;
 * this module just does the (contained) filesystem work.
 */
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, dirname } from "node:path";

export type FileTool = "read_file" | "list_files" | "write_file";
export const READ_TOOLS: FileTool[] = ["read_file", "list_files"];
export const WRITE_TOOLS: FileTool[] = ["write_file"];

const MAX_READ_CHARS = 4000; // keep chat/relay sane

/** The one directory the plus1 is allowed to touch. */
export function filesRoot(): string {
  return process.env.plus1_FILES_DIR
    ? resolve(process.env.plus1_FILES_DIR)
    : join(process.cwd(), "plus1-files");
}

/** Resolve `p` inside `root`, refusing anything that escapes it. */
function contain(root: string, p: string): string {
  const abs = isAbsolute(p) ? p : join(root, p);
  const rel = relative(root, abs);
  if (rel === "" ) return abs;
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path "${p}" is outside the allowed directory`);
  }
  return abs;
}

export interface FileToolArgs {
  path?: string;
  content?: string;
}

/** Run a file tool, returning a short human-readable result string for the room. */
export async function runFileTool(name: FileTool, args: FileToolArgs): Promise<string> {
  const root = filesRoot();
  await mkdir(root, { recursive: true });

  if (name === "list_files") {
    const dir = contain(root, args.path?.trim() || ".");
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return `Nothing at "${args.path ?? "."}" (or it isn't a folder).`;
    if (entries.length === 0) return `"${args.path ?? "."}" is empty.`;
    const list = entries
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort()
      .join(", ");
    return `Files in "${args.path ?? "."}": ${list}`;
  }

  if (name === "read_file") {
    if (!args.path?.trim()) return "I need a file name to read.";
    const file = contain(root, args.path.trim());
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) return `No file called "${args.path}".`;
    let text = await readFile(file, "utf8");
    if (text.length > MAX_READ_CHARS) text = `${text.slice(0, MAX_READ_CHARS)}… (truncated)`;
    return `Contents of "${args.path}":\n${text}`;
  }

  if (name === "write_file") {
    if (!args.path?.trim()) return "I need a file name to write.";
    const file = contain(root, args.path.trim());
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, args.content ?? "", "utf8");
    return `Saved to "${args.path}".`;
  }

  return `Unknown file tool: ${name}`;
}
