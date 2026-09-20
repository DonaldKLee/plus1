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
- Network only in `apps/backend`: `federatoClient.ts` (auth, schema, query), `enrichment.ts`
  (OpenFEMA declarations by county, NFIP claims by zip, Open-Meteo extremes; cached on disk),
  `federatoQuery.ts` (agentic: goal → Gemini planner with compact schema + query rules → validate
  → run → re-plan on empty/error → collapse groups; every attempt is traced), `federatoTools.ts`
  (the goose's tools: `federato_queue`, `federato_account`, `federato_query`, `federato_portfolio`,
  `federato_enrich`, `federato_guidelines`; tool docs live there and feed the brain prompt).
- The brain can chain tools: `narrateToolResult` may return `nextTool`; `runToolChain` in
  `tools.ts` runs it (cap 3) for both chat and meeting; traces land in session notes ("why:").
- The API's `over` returns one row per record — never trust its grouping; `collapseGroups` does it.
- Direct routes for judges/UW tab: `POST /api/federato/query {goal}`, `POST /api/federato/tool
  {name, query}`, `GET /api/federato/portfolio?by=`, `GET /api/federato/enrich/:policyId`,
  `GET /api/federato/rank?enrich=1`, `GET /api/federato/deep-dive/:id?enrich=1`.
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

## Documents + email (PDF out, SMTP out)

Two more tool families, same in-process pattern as the Intact toolset (prefix-routed in
`tools.ts`, gated by a `servers.*` toggle in the plus1 tab). Note the naming: like the "Intact
MCP", these are **not** MCP-protocol servers — there is no MCP client or server anywhere in this
repo. They're tool modules the brain calls directly.

- **`doc_pdf`** (`servers.docs`, on by default) — `apps/backend/src/docTools.ts` →
  `docPdf.ts`. Renders markdown-lite (headings, bullets, numbered lists, rules, blockquotes) into
  a paginated PDF with `pdf-lib`. The plus1 writes the content itself from the meeting; it doesn't
  ask anyone to dictate it. Stored in memory under a uuid with a 1-hour TTL and served at
  `GET /api/doc/:id.pdf` — the same contract `intactPdf.ts` uses for quotes, so nothing hits disk.
  Deliberately **not** headless-Chromium HTML→PDF: the only Chrome here is the headed,
  SingletonLock'd profile that joins Meet, and borrowing it mid-meeting would fight the live
  session.
- **`email_send` / `email_status`** (`servers.email`, **off** by default) —
  `apps/backend/src/emailTools.ts` → `email.ts`, nodemailer over SMTP.
  `details.attachPdf: "last"` attaches the PDF just generated (resolves against both the document
  and quote stores), so "email me those notes" works in one turn without the model having to carry
  a uuid.

**Email safety — don't loosen this casually.** The composer is an LLM reacting to a live,
frequently misheard transcript, and an email can't be unsent. So: sending is a **dry run** unless
SMTP is configured (it still drafts and logs); `EMAIL_ALLOWLIST` gates recipients by address or
domain; recipients are capped (`EMAIL_MAX_RECIPIENTS`, default 5); and the **`sendApproval`
guardrail makes it two-step** — the first `email_send` returns the exact draft and sends nothing,
and only a second call carrying `details.confirm = true` (after a human says yes) delivers. That
guardrail defaults to ON, and an *unset* guardrail is treated as ON in all three `toolAccessOf`
mappings.

**Why SMTP and not the Gmail API:** there is no Google OAuth in this repo. The only Google
credential is the hand-signed-in persistent Chrome profile Playwright drives (`meetPresent.ts`) —
a browser session, not a token, and not exchangeable for one. An app password needs no consent
screen or callback URL. `deliver()` in `email.ts` is the single seam to swap if that changes.

Config: `GMAIL_USER` + `GMAIL_APP_PASSWORD`, or the `SMTP_*` vars. See `.env.example`.

### Share links (PDF → Meet chat)

Generated PDFs are mirrored into Atlas (`documents` collection, `docStore.ts`) keyed by a
192-bit share token, with a **TTL index on `expiresAt`** so Mongo expires them itself. A plain
`Binary` field, not GridFS — these are KB, nowhere near the 16MB BSON limit. `loadDoc()` in
`docPdf.ts` checks memory first and falls back to Mongo, so a link handed out before a restart
still resolves.

Reachability is a *separate* problem from storage: `localhost:8787` in a Meet chat resolves to each
participant's own machine. So there's a second, deliberately tiny Express app —
`publicDocs.ts`, on `PUBLIC_DOCS_PORT` (8788) — that serves **only** `GET /d/:token`. That is the
port the tunnel exposes.

> **Never point the tunnel at 8787.** The main backend has no auth on any route: `/api/meet/join`
> launches Chrome and joins a meeting as you, `/api/plus1/config` rewrites the agent's config, and
> the chat endpoints reach the agent's file and `run_command` tools. Tunnelling it publishes all of
> that. The 8788 app has one GET route, no body parser, and no agent surface.

```bash
brew install cloudflared
# PUBLIC_DOCS=1 in .env, restart the backend
npm run tunnel      # writes cache/public-url.txt; the backend reads it automatically
```

`publicBaseUrl()` resolves `PUBLIC_BASE_URL` → `cache/public-url.txt` → undefined. When it's
undefined no `shareUrl` is produced and PDFs stay download-only, so the feature degrades cleanly.
When it is set, `doc_pdf` returns a `shareUrl`, `meetTranscribe.ts` posts it into the Meet chat
verbatim (the `doc_pdf` tool doc forbids reading a URL aloud), and the dashboard shows a "Copy
share link" button.

**A share link is a bearer credential** — anyone holding it reads the document, no login. That's
the tradeoff for pasting into a meeting chat. Keep `PUBLIC_DOC_TTL_HOURS` short, and note a quick
tunnel's hostname changes on every run.

## Running it

```bash
# terminal 1 — the backend that joins + transcribes
cd apps/backend && npm install && npm run dev           # :8787

# terminal 2 — the dashboard
cd apps/dashboard && npm install && npm run dev         # http://localhost:3000
```
