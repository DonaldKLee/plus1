## Federato agent (`:8787`)

Network + Browserbase + Meet live here. Scoring stays in `packages/brain` (no fetch).

### Setup

From repo root:

```bash
cp .env.example .env    # Federato + Browserbase + MEET_URL
npm install
npm run federato        # this app
```

### Screenshare (Playwright joins Meet + Presents live view)

```bash
npm run federato:google-login    # once — sign in in the headed Chrome
MEET_URL=https://meet.google.com/xxx-yyyy-zzz npm run federato:screenshare
```

Or `POST /api/federato/present-meet` with `{ policyId, meetUrl }`.

Opens Browserbase fullscreen live view, joins Meet as the saved profile, Presents tab `plus1-work`.
Camera/goose stays teammate-owned.

### Demo path

1. Rank queue (schema → planned queries → 2025 appetite table)
2. Deep-dive Harbor Point (`PR-2025-1001`)
3. Browserbase Maps + FEMA for the policy address
4. Present live view in Meet
