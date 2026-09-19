/**
 * run_command: let the plus1 actually DO things on the machine (make a file,
 * convert something, open an app) the way an agentic coder does — but the
 * trigger is a live, sometimes-misheard voice transcript, so this is guarded:
 *   - only reachable when Local access is set to "Read & write" (upstream),
 *   - the plus1 must announce what it's doing first (executeDecision),
 *   - a denylist blocks obviously destructive / dangerous commands,
 *   - every run has a timeout and a capped, captured output.
 *
 * It still runs with the user's own permissions — "bash access" means what it
 * says. Point plus1_SHELL_CWD at the directory you actually want it working in.
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";

const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 2000;

// Commands we refuse outright. Not a sandbox — a seatbelt against a mis-heard
// word turning into something irreversible.
const DENY: { re: RegExp; why: string }[] = [
  { re: /\brm\s+(-[a-z]*r[a-z]*\s+|.*\s)?(-[a-z]*f|--force)/i, why: "recursive/forced delete" },
  { re: /\brm\s+-[a-z]*f[a-z]*r/i, why: "recursive/forced delete" },
  { re: /\bsudo\b|\bdoas\b/i, why: "privilege escalation" },
  { re: /\bmkfs\b|\bdiskutil\s+(erase|partition)|\bdd\s+if=/i, why: "disk formatting" },
  { re: />\s*\/dev\/(sd|disk|nvme)/i, why: "writing to a raw disk" },
  { re: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i, why: "power control" },
  { re: /:\(\)\s*\{.*\|.*&\s*\}\s*;/i, why: "fork bomb" },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/i, why: "piping the internet into a shell" },
  { re: /\bchmod\s+-R\s+0?777\s+\//i, why: "world-writable on root" },
  { re: /\bkill\s+-9\s+-1\b|\bkillall\s+-9\b/i, why: "killing everything" },
  { re: /\b(rm|unlink)\b[^\n]*\s(\/|~|\$HOME)(\s|$)/i, why: "deleting a home/root path" },
];

export function shellCwd(): string {
  return process.env.plus1_SHELL_CWD || homedir();
}

/** Run a shell command, returning a short human-readable result for the room. */
export function runCommand(command: string): Promise<string> {
  const cmd = command.trim();
  if (!cmd) return Promise.resolve("nothing to run.");
  for (const d of DENY) {
    if (d.re.test(cmd)) {
      return Promise.resolve(`i won't run that — it looks like ${d.why}. try a narrower command.`);
    }
  }

  return new Promise((resolve) => {
    execFile(
      "/bin/bash",
      ["-lc", cmd],
      { cwd: shellCwd(), timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
        const clip = out.length > MAX_OUTPUT ? `${out.slice(0, MAX_OUTPUT)}… (truncated)` : out;
        if (err) {
          const timedOut = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
          if (timedOut) return resolve(`that command timed out after ${TIMEOUT_MS / 1000}s.`);
          return resolve(`command failed: ${clip || err.message}`);
        }
        resolve(clip ? `done. ${clip}` : "done.");
      },
    );
  });
}
