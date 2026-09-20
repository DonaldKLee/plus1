# plus1 — build notes for agents

**The one constraint that keeps this coherent:**

> The runner makes no decisions. All intelligence lives in `packages/brain`, which must never
> import anything network-bound. All cross-process messages use the zod schemas in
> `packages/protocol`.

## Layout

```
apps/dashboard/        Next.js — setup, integrations, live console, **UW tab**
apps/backend/          Federato API + Browserbase work browser + screenshare helper
apps/runner/           Node + Playwright — joins Meet as the plus1 (LiveAvatar camera/mic), captions, barge-in, control API :8790
workers/               Hono API + MeetingSession DO (not yet)
packages/brain         gate/planner + **federato appetite + query plan** (pure)
packages/protocol      shared zod/types for runner + Federato pack
fixtures/              transcript-demo.json
packages/liveavatar    HeyGen LiveAvatar LITE: session, PCM pump, in-page camera/mic bridge (built, tested live)
packages/voice         ElevenLabs streaming TTS -> PCM 24 kHz + cached fillers (built)
```

## Federato pack — the underwriting agent (prize track)

- Pure scoring in `packages/brain/src/federato` — never import fetch there. `appetite.ts` is the
  2025 table (renewal = Not Acceptable, new = Acceptable); `enrichment.ts` scores outside risk data
  as extra factors; `queryGuide.ts` renders the live schema for the planner, validates payloads
  ($elemMatch through arrays, expand-then-filter, select shapes) and collapses per-record rows into
  groups; `guidelines.ts` is the table + glossary as data.
- Network only in `apps/backend`: `federatoClient.ts` (auth, schema, query), `submissions.ts`
  (INGEST open submissions + insured history → ENRICH → CLASSIFY, with broker request lists),
  `enrichment.ts` (six sources: FEMA NRI, OpenFEMA declarations, NFIP claims, USGS quakes,
  Open-Meteo 5-year extremes, OSM reverse geocode; lookups remembered in the OS temp dir), `drafts.ts` (quote /
  declarations / decline / memo templates from a bound record + appetite), `contractTemplate.ts`
  (the contract package from an OPEN submission: ingest → enrich → classify → draft, each field
  tagged submission / insured history / expiring policy / external data / appetite engine / to be
  provided; saved as .md + .json under `apps/backend/output/drafts/`; drafts only, never sent or bound),
  `federatoQuery.ts` (agentic: goal → Gemini planner with compact schema + query rules → validate
  → run → re-plan on empty/error → collapse groups; every attempt is traced), `federatoTools.ts`
  (the goose's tools: `federato_submissions`, `federato_queue`, `federato_account`, `federato_query`,
  `federato_portfolio`, `federato_enrich`, `federato_guidelines`, `federato_draft`; tool docs live
  there and feed the brain prompt).
- The brain can chain tools: `narrateToolResult` may return `nextTool`; `runToolChain` in
  `tools.ts` runs it (cap 3) for both chat and meeting; traces land in session notes ("why:").
- The API's `over` returns one row per record — never trust its grouping; `collapseGroups` does it.
- No `cache/` folder: Federato token, schema and the expanded book live in process memory (10-min TTL, `npm run backend:warm` to prefetch); drafts go to `apps/backend/output/drafts/`; the Chrome profile is `apps/backend/.profile` (or `MEET_PROFILE_DIR`); disposable state (enrichment lookups, Browserbase session pointer, debug screenshots) sits in `$TMPDIR/plus1-backend`.
- Direct routes for judges/UW tab: `POST /api/federato/query {goal}`, `POST /api/federato/tool
  {name, query}`, `GET /api/federato/portfolio?by=`, `GET /api/federato/enrich/:policyId`,
  `GET /api/federato/rank?enrich=1`, `GET /api/federato/deep-dive/:id?enrich=1`,
  `GET /api/federato/submissions`, `GET /api/federato/draft/:id?kind=quote|declarations|decline|memo[&format=md]`,
  `GET /api/federato/contract/:submissionRef[?format=md]`.
- Dashboard UW tab polls `NEXT_PUBLIC_BACKEND_URL` (default `:8787`).
- Camera/plus1 is teammate-owned; screenshare = Present Browserbase live-view tab.

## Send a plus1 (live transcription)

The core product flow, end to end:

1. Dashboard `/app` — paste a Meet link, "Send the plus1" → `POST /api/meet/join`.
2. `apps/backend/src/meetTranscribe.ts` — launches a local Playwright Chrome
   (`launchMeetChrome`), joins the Meet (`joinMeet` from `meetPresent.ts`), and taps every
   remote audio stream via Web Audio. 16kHz PCM streams continuously over the **Gemini Live API**
   (WebSocket, `gemini-3.5-transcribe-live`); lines surface ~1-2s after each speaker pauses.
   Billed by session, so no per-request rate limits.
3. Lines stream to the dashboard over SSE (`GET /api/meet/sessions/:id/stream`) and render live
   in `components/console/LiveTranscript.tsx` at `/app/meetings/[id]`.

`GEMINI_API_KEY` in `.env`. First run needs a one-time Google sign-in in the headed Chrome
profile (`npm run backend:google-login`, or just sign in when the window opens).

## Persistence (MongoDB Atlas)

`apps/backend/src/store.ts` mirrors every session into Atlas — one `meetings` document per
session holding the settled transcript lines, the plus1's decisions, operator notes, status and
duration, plus a flattened `transcript` field carrying a text index. The in-memory Map in
`meetTranscribe.ts` stays the source of truth while a meeting runs; writes are debounced (~1 s)
and failures are logged, never fatal. With `MONGODB_URI` unset the whole module no-ops and the
app behaves exactly as before.

Meetings are labelled by **purpose**, not by the Meet link: the operator types one when sending the
plus1 (`POST /api/meet/join` body `purpose`), `PATCH /api/meet/sessions/:id` renames one later
(live or archived), and unlabelled meetings fall back to `preview` — the first substantive line,
computed on save. The plus1's own settings live in the same database (`settings` collection,
`_id: "plus1"`, `GET`/`PUT /api/plus1/config`); the plus1 tab treats localStorage as a cache and
MongoDB as the record, and a session joined without a config loads the saved one.

`listSessions()` / `getSession()` are async and merge live sessions with stored ones, so the
dashboard shows history across backend restarts and `/app/meetings/[id]` replays a finished
meeting. Extra endpoints: `GET /api/meet/search?q=`, `GET /api/meet/stats`,
`DELETE /api/meet/sessions/:id`. Network stays in `apps/backend`; nothing in `packages/brain`
touches the database.

All prior fixture/dummy data (personas, integrations, replay demo) has been removed; the dashboard
is Home / Meetings / Underwrite only.

## The plus1 on camera (merged into the same session)

The transcription session above *is* the plus1: `packages/liveavatar` puts a HeyGen LiveAvatar
(LITE mode: we push PCM 24 kHz, it streams lipsynced video into a LiveKit room) onto the fake
camera and mic of that same Chrome tab, and `packages/voice` turns text into PCM with ElevenLabs.
The agent exposes `POST /api/meet/sessions/:id/{speak,filler,interrupt,honk,emote}` and streams
`avatar`/`speaking` SSE events; the live meeting page has the controls. Barge-in is mechanical:
a room transcription fragment while the plus1 is speaking interrupts it. The room audio tap skips
elements marked `data-plus1-avatar` so the plus1 doesn't transcribe itself. `LIVEAVATAR_SANDBOX=1`
sessions die after ~60 s (auto-restarted, video freezes briefly); use `0` for real demos.
Read `packages/liveavatar/README.md` before touching the media path.

## Running it

```bash
# terminal 1 — the backend that joins + transcribes
cd apps/backend && npm install && npm run dev           # :8787

# terminal 2 — the dashboard
cd apps/dashboard && npm install && npm run dev         # http://localhost:3000
```
