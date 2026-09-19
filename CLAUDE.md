# plus1 — build notes for agents

**The one constraint that keeps this coherent:**

> The runner makes no decisions. All intelligence lives in `packages/brain`, which must never
> import anything network-bound. All cross-process messages use the zod schemas in
> `packages/protocol`.

## Layout

```
apps/dashboard/   Next.js — setup, integrations, join, the three-column live console
apps/runner/      Node + Playwright — Meet, fake media, captions, chat   (not yet built)
workers/          Hono API + MeetingSession Durable Object + queue        (not yet built)
packages/         brain · goose · mcp-client · voice · protocol           (not yet built)
fixtures/         transcript-demo.json + messy-corpus                     (transcript built)
```

## This session

Built `apps/dashboard` to the impeccable craft floor: the operator's live console
(mission-control terminal world). Driven by `fixtures/transcript-demo.json`, it replays a full
meeting end-to-end — gate classifications, the Mind pipeline, artifacts, honks, barge-in.
Design decisions live in `apps/dashboard/DESIGN.md`.

## Running the dashboard

```bash
cd apps/dashboard
npm install
npm run dev      # http://localhost:3000
```
