# plus1 — build notes for agents

**The one constraint that keeps this coherent:**

> The runner makes no decisions. All intelligence lives in `packages/brain`, which must never
> import anything network-bound. All cross-process messages use the zod schemas in
> `packages/protocol`.

## Layout

```
apps/dashboard/        Next.js — setup, integrations, live console, **UW tab**
apps/federato-agent/   Federato API + Browserbase work browser + screenshare helper
apps/runner/           Node + Playwright — joins Meet as the goose (LiveAvatar camera/mic), captions, barge-in, control API :8790
workers/               Hono API + MeetingSession DO (not yet)
packages/brain         gate/planner + **federato appetite + query plan** (pure)
packages/protocol      shared zod/types for runner + Federato pack
fixtures/              transcript-demo.json
packages/liveavatar    HeyGen LiveAvatar LITE: session, PCM pump, in-page camera/mic bridge (built, tested live)
packages/voice         ElevenLabs streaming TTS -> PCM 24 kHz + cached fillers (built)
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

## The goose on camera (merged into the same session)

The transcription session above *is* the goose: `packages/liveavatar` puts a HeyGen LiveAvatar
(LITE mode: we push PCM 24 kHz, it streams lipsynced video into a LiveKit room) onto the fake
camera and mic of that same Chrome tab, and `packages/voice` turns text into PCM with ElevenLabs.
The agent exposes `POST /api/meet/sessions/:id/{speak,filler,interrupt,honk,emote}` and streams
`avatar`/`speaking` SSE events; the live meeting page has the controls. Barge-in is mechanical:
a room transcription fragment while the goose is speaking interrupts it. The room audio tap skips
elements marked `data-plus1-avatar` so the goose doesn't transcribe itself. `LIVEAVATAR_SANDBOX=1`
sessions die after ~60 s (auto-restarted, video freezes briefly); use `0` for real demos.
Read `packages/liveavatar/README.md` before touching the media path.

## Running it

```bash
# terminal 1 — the agent that joins + transcribes
cd apps/federato-agent && npm install && npm run dev   # :8787

# terminal 2 — the dashboard
cd apps/dashboard && npm install && npm run dev         # http://localhost:3000
```
