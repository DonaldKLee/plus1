# plus1 (Hack-the-North-2026)

Meeting coworker goose + **Federato underwriting skill pack**.

## Quick start

```bash
cp .env.example .env          # Federato creds (+ optional Browserbase)
npm install
npm run federato:cache        # schema + 27 property policies
npm run federato              # agent API :8787
npm run dashboard             # console :3000 → UW tab
```

Screenshare Browserbase live view (optional):

```bash
# .env: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID
npm run federato:screenshare
```

See [apps/federato-agent/README.md](apps/federato-agent/README.md) and [HLD.md](HLD.md).

