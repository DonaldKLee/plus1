/**
 * `npm run tunnel` — put the public document server on the internet with a
 * cloudflared quick tunnel, so Shannon can drop a working link into Meet chat.
 *
 * A quick tunnel needs no Cloudflare account and no DNS: cloudflared prints a
 * random `https://<words>.trycloudflare.com` hostname and proxies it to a local
 * port. This script parses that hostname out of cloudflared's output and writes
 * it to `cache/public-url.txt`, which `docPdf.publicBaseUrl()` reads — so there
 * is nothing to copy into .env, and restarting the tunnel just works. Setting
 * PUBLIC_BASE_URL explicitly still wins over this file.
 *
 * IT POINTS AT :8788, NOT :8787 — deliberately. The main backend has no auth on
 * any route (it can join meetings as you and reach the agent's file and shell
 * tools); the public app on 8788 serves one GET route and nothing else. Never
 * repoint this at the main port. See publicDocs.ts.
 *
 * Quick tunnel caveats worth knowing: the hostname changes every run, and
 * Cloudflare rate-limits and offers no uptime guarantee. That's fine for a demo
 * or a meeting. For anything durable, use a named tunnel or a real host and set
 * PUBLIC_BASE_URL.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, ensureCacheDir } from "./env.js";
import { publicDocsPort } from "./publicDocs.js";

const URL_FILE = path.join(CACHE_DIR, "public-url.txt");
const HOST_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function writeUrl(url: string): void {
  ensureCacheDir();
  fs.writeFileSync(URL_FILE, `${url}\n`, "utf8");
}

function clearUrl(): void {
  // Leaving a stale hostname behind would have the plus1 hand out dead links.
  try {
    fs.rmSync(URL_FILE, { force: true });
  } catch {
    /* nothing to clear */
  }
}

const port = publicDocsPort();

console.log(`[tunnel] exposing http://localhost:${port} (public document server)`);
if (process.env.PUBLIC_DOCS !== "1") {
  console.warn(
    `[tunnel] warning: PUBLIC_DOCS is not "1", so the backend isn't serving on :${port}.\n` +
      `          Add PUBLIC_DOCS=1 to .env and restart the backend, or links will 502.`,
  );
}

const child = spawn(
  "cloudflared",
  ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let found = false;

function scan(chunk: Buffer): void {
  const text = chunk.toString();
  // cloudflared logs to stderr; the banner carries the hostname.
  process.stderr.write(text);
  if (found) return;
  const m = HOST_RE.exec(text);
  if (!m) return;
  found = true;
  const url = m[0];
  writeUrl(url);
  console.log(`\n[tunnel] public base URL: ${url}`);
  console.log(`[tunnel] wrote ${URL_FILE} — the backend picks this up on the next PDF.`);
  console.log(`[tunnel] test it:  curl -sI ${url}/healthz\n`);
  console.log(
    `[tunnel] NOTE: anyone with a share link can read that document — the link IS the\n` +
      `         credential. Links expire after PUBLIC_DOC_TTL_HOURS (default 24).\n`,
  );
}

child.stdout.on("data", scan);
child.stderr.on("data", scan);

child.on("error", (e) => {
  const err = e as NodeJS.ErrnoException;
  if (err.code === "ENOENT") {
    console.error(
      `\n[tunnel] cloudflared isn't installed.\n` +
        `         macOS:  brew install cloudflared\n` +
        `         other:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n`,
    );
  } else {
    console.error(`[tunnel] failed to start cloudflared: ${err.message}`);
  }
  clearUrl();
  process.exit(1);
});

child.on("exit", (code) => {
  console.log(`[tunnel] cloudflared exited (${code ?? "signal"}) — clearing the public URL.`);
  clearUrl();
  process.exit(code ?? 0);
});

// Ctrl-C should take the hostname out of circulation, not leave it cached.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearUrl();
    child.kill(sig);
  });
}
