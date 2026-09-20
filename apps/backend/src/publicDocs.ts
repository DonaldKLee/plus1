/**
 * The public document server — a SEPARATE Express app, on its own port, that
 * serves exactly one thing: a generated PDF, by share token.
 *
 * WHY IT IS SEPARATE, AND WHY THAT MATTERS MORE THAN IT LOOKS.
 * The main backend on :8787 has no authentication on any route. It can launch
 * Chrome and join a meeting as you (`POST /api/meet/join`), rewrite the plus1's
 * config, and expose the chat surface that reaches the agent's file and shell
 * tools. Putting a tunnel in front of *that* would publish all of it to the
 * internet. So the tunnel points here instead: one GET route, no write methods,
 * no agent surface, nothing to configure. The blast radius of a leaked tunnel
 * hostname is "someone can read a PDF if they also guessed a 192-bit token".
 *
 * Run it with:  npm run tunnel   (cloudflared quick tunnel → cache/public-url.txt)
 */
import express, { type Express } from "express";
import { loadDoc, publicBaseUrl } from "./docPdf.js";

/** Share tokens are base64url from 24 random bytes — 32 chars, fixed alphabet. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function buildPublicApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  // No body parser, no CORS, no cookies: nothing here reads a request body, and
  // every byte of attack surface we don't add is one we don't have to reason about.

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  app.get("/d/:token", async (req, res) => {
    const token = String(req.params.token).replace(/\.pdf$/i, "");
    // Reject malformed tokens before touching the database.
    if (!TOKEN_RE.test(token)) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }

    const doc = await loadDoc(token).catch(() => undefined);
    if (!doc) {
      res
        .status(404)
        .type("text/html")
        .send(
          `<!doctype html><meta charset="utf-8"><title>Link expired</title>` +
            `<div style="font:16px/1.6 system-ui;max-width:32rem;margin:15vh auto;padding:0 1.5rem">` +
            `<h1 style="font-size:1.25rem">This link has expired</h1>` +
            `<p style="color:#555">Shared documents are available for a limited time. ` +
            `Ask the plus1 to send it again.</p></div>`,
        );
      return;
    }

    res.setHeader("content-type", "application/pdf");
    // `inline` so it previews in the browser instead of forcing a download —
    // the point is that someone in a meeting can glance at it immediately.
    res.setHeader("content-disposition", `inline; filename="${doc.filename}"`);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-robots-tag", "noindex, nofollow");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cache-control", "private, max-age=300");
    res.send(Buffer.from(doc.bytes));
  });

  // Anything else, including the root, reveals nothing about what's here.
  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });

  return app;
}

export function publicDocsPort(): number {
  return Number(process.env.PUBLIC_DOCS_PORT ?? 8788);
}

/** Start the public app when PUBLIC_DOCS=1. Returns the port, or null if off. */
export function startPublicDocs(opts?: { mainPort?: number }): number | null {
  if (process.env.PUBLIC_DOCS !== "1") return null;
  const port = publicDocsPort();
  const main = opts?.mainPort;
  buildPublicApp().listen(port, () => {
    console.log(
      `[public] document server on http://localhost:${port}` +
        (main ? ` — tunnel THIS port, not :${main}` : " — tunnel THIS port, not the main backend"),
    );
    // Logged in here so the two lines can't interleave out of order.
    const base = publicBaseUrl();
    console.log(
      base
        ? `[public] share links resolve to ${base}/d/…`
        : `[public] no public URL yet — run \`npm run tunnel\` and links start working (no restart needed)`,
    );
  });
  return port;
}
