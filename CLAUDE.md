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


## Send a goose (live transcription)

The core product flow, end to end:

1. Dashboard `/app` — paste a Meet link, "Send the goose" → `POST /api/meet/join`.
2. `apps/federato-agent/src/meetTranscribe.ts` — launches a local Playwright Chrome
   (`launchMeetChrome`), joins the Meet (`joinMeet` from `meetPresent.ts`), and taps every
   remote audio stream via Web Audio. 16kHz PCM streams continuously over the **Gemini Live API**
   (WebSocket, `gemini-3.5-transcribe-live`); lines surface ~1-2s after each speaker pauses.
   Billed by session, so no per-request rate limits.
3. Lines stream to the dashboard over SSE (`GET /api/meet/sessions/:id/stream`) and render live
   in `components/console/LiveTranscript.tsx` at `/app/meetings/[id]`.

`GEMINI_API_KEY` in `.env`. First run needs a one-time Google sign-in in the headed Chrome
profile (`npm run google-login` in `apps/federato-agent`, or just sign in when the window opens).

All prior fixture/dummy data (personas, integrations, replay demo) has been removed; the dashboard
is Home / Meetings / Underwrite only.

## Running it

```bash
# terminal 1 — the agent that joins + transcribes
cd apps/federato-agent && npm install && npm run dev   # :8787

# terminal 2 — the dashboard
cd apps/dashboard && npm install && npm run dev         # http://localhost:3000
```
