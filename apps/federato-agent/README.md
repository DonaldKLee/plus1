## Federato underwriting pack (this branch)

### Packages
- `packages/brain` — pure appetite scoring + query planning (no network)
- `packages/protocol` — shared types for rank / deep-dive / browse
- `apps/federato-agent` — Auth0 + Federato query, Browserbase work browser, screenshare helper
- `apps/dashboard` — **UW** nav tab consumes the agent API (does not replace Console)

### Setup
```bash
cp .env.example .env   # fill Federato + optional Browserbase keys
npm install            # from repo root (workspaces)
npm run federato:cache # schema + property policies → apps/federato-agent/cache
npm run federato       # API on :8787
npm run dashboard      # UI on :3000 → open UW tab
```

### Screenshare (Playwright joins Meet + Presents live view)
```bash
# needs BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID
MEET_URL=https://meet.google.com/xxx-yyyy-zzz npm run federato:screenshare
```
Opens Browserbase live view, joins Meet, clicks Present, auto-selects the work tab.
First run: sign into Google in the headed Chrome window (profile is reused).
Camera/goose stays teammate-owned.

### Demo path
1. Rank queue (schema → planned queries → 2025 appetite table)
2. Deep-dive Harbor Point (`PR-2025-1001`) — premium/construction/loss/multi-state fails
3. Browserbase live view on `44 Cedar Ln, Tampa, FL` (Maps + FEMA)
4. Present live view in Meet
