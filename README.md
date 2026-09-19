# plus1 (Hack the North 2026)

Meeting coworker goose + **Federato underwriting pack** on `feat/federato-browserbase`.

The goose / camera / LiveAvatar seat is a teammate piece. This branch is the UW queue, appetite scoring, Browserbase Maps/FEMA work browser, and Playwright Meet Present.

## What it does

1. Pulls Federato property policies (schema → query plan → cache).
2. Ranks them against the official 2025 appetite table (pure scoring in `packages/brain`).
3. Deep-dives a policy (Harbor Point `PR-2025-1001` is the decline demo).
4. Opens that address in a **Browserbase** cloud Chrome (Google Maps + FEMA).
5. Playwright joins **your Google Meet** as a signed-in Chrome profile and **Presents** the fullscreen live-view tab.

## Repo layout

```
apps/dashboard         Next.js console — open the UW tab
apps/federato-agent    Federato API + Browserbase + Meet Present
packages/brain         Appetite + query plan (no network)
packages/protocol      Shared zod types
```

## Setup

```bash
git checkout feat/federato-browserbase
cp .env.example .env          # paste keys (see teammate .env, not this file)
npm install                   # from repo root
```

Dashboard talks to the agent at `http://localhost:8787` (`apps/dashboard/.env.local.example`).

The goose's face and voice come from `packages/liveavatar` (HeyGen LiveAvatar on the Meet tab's
fake camera/mic) and `packages/voice` (ElevenLabs → PCM). No virtual audio devices needed: set
`LIVEAVATAR_API_KEY`, `LIVEAVATAR_AVATAR_ID`, `ELEVENLABS_API_KEY` in `.env` (see `.env.example`).

### `.env` keys

| Key | Required | What |
|-----|----------|------|
| `FEDERATO_CLIENT_ID` / `FEDERATO_CLIENT_SECRET` | yes | HTN Federato API |
| `FEDERATO_AUTH_URL` / `AUDIENCE` / `HANDLER_URL` | yes | defaults are in `.env.example` |
| `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` | for live view | booth #46 / browserbase.com |
| `MEET_URL` | for auto Present | `https://meet.google.com/xxx-yyyy-zzz` |
| `OPENAI_API_KEY` (or Google/Anthropic) | optional | Stagehand `act()` on FEMA; goto works without it |

Do **not** commit `.env`. Send keys in chat/DM.

## Run

Two terminals from the repo root:

```bash
npm run federato              # agent http://localhost:8787
npm run dashboard             # UI     http://localhost:3000
```

Optional cache refresh (schema + ~27 property policies):

```bash
npm run federato:cache
```

Open **http://localhost:3000 → UW tab**.

| Button | What |
|--------|------|
| Rank / Refresh API | Score the Federato queue |
| Click a row | Select that `policyId` (use a real id from the list, e.g. `1001`, not a made-up one) |
| Deep-dive | Memo only (`?browse=0`) |
| Browserbase live view | Cloud Maps/FEMA; session closes after the check |
| Join Meet & Present | Keep-alive live view + Playwright join + Present |

## Google login (once)

Playwright cannot see your everyday Chrome. Sign in **once** in the plus1 profile:

```bash
npm run federato:google-login
```

Sign into Google in the headed window that opens. Session is saved at `apps/federato-agent/cache/screenshare-profile` (gitignored). Reuse it on later runs unless you delete that folder.

## Join Meet + Present

1. Put `MEET_URL` in `.env` **or** paste the Meet link in the UW input.
2. First time: `npm run federato:google-login`.
3. Then either:
   ```bash
   MEET_URL=https://meet.google.com/xxx-yyyy-zzz npm run federato:screenshare
   ```
   or UW → **Join Meet & Present**.

Chrome opens the Browserbase fullscreen live view, joins Meet as the saved Google account, clicks Present, and auto-picks the tab titled `plus1-work`.

If the meeting has knock enabled, admit that Google account. If Present stalls, click **Share** once — the work tab should already be selected.

CLI / API:

```bash
curl http://localhost:8787/api/federato/rank
curl http://localhost:8787/api/federato/deep-dive/1001
curl -X POST http://localhost:8787/api/federato/screenshare-session \
  -H 'Content-Type: application/json' -d '{"policyId":1001}'
curl -X POST http://localhost:8787/api/federato/present-meet \
  -H 'Content-Type: application/json' \
  -d '{"policyId":1001,"meetUrl":"https://meet.google.com/xxx-yyyy-zzz"}'
```

## Demo path

1. UW → Rank (27 property policies).
2. Select **Harbor Point Retail LLC** (`1001` / `PR-2025-1001`) — decline: premium, age, frame, losses, AZ/WA.
3. Join Meet & Present → Maps + FEMA for `44 Cedar Ln, Tampa, FL`.
4. Talk the memo while the live-view tab is shared.

## Scripts

| Script | |
|--------|--|
| `npm run federato` | Agent `:8787` |
| `npm run dashboard` | Dashboard `:3000` |
| `npm run federato:cache` | Refresh schema + policies |
| `npm run federato:rank` | CLI rank |
| `npm run federato:google-login` | One-time Google sign-in |
| `npm run federato:screenshare` | Live view + join + Present |
| `npm run test:brain` | Appetite unit tests |

More detail: [apps/federato-agent/README.md](apps/federato-agent/README.md). Architecture notes: [HLD.md](HLD.md), [CLAUDE.md](CLAUDE.md).
