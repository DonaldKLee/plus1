# plus1 — build notes for agents

**The one constraint that keeps this coherent:**

> The runner makes no decisions. All intelligence lives in `packages/brain`, which must never
> import anything network-bound. All cross-process messages use the zod schemas in
> `packages/protocol`.

## Layout

```
apps/dashboard/        Next.js — setup, integrations, live console, **UW tab**
apps/federato-agent/   Federato API + Browserbase work browser + screenshare helper
apps/runner/           Node + Playwright — Meet, fake media (not yet / teammate)
workers/               Hono API + MeetingSession DO (not yet)
packages/brain         gate/planner + **federato appetite + query plan** (pure)
packages/protocol      shared zod/types for runner + Federato pack
fixtures/              transcript-demo.json
```

## Federato pack (feat/federato-browserbase)

- Pure scoring in `packages/brain/src/federato` — never import fetch there.
- Network + Browserbase only in `apps/federato-agent`.
- Dashboard UW tab polls `NEXT_PUBLIC_FEDERATO_AGENT_URL` (default `:8787`).
- Camera/goose is teammate-owned; screenshare = Present Browserbase live-view tab.


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
