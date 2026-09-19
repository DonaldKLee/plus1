---
version: 1
slug: "apps-dashboard-app-app-layout-tsx"
primary_target: "apps/dashboard/app/app/layout.tsx"
related_targets: ["apps/dashboard/app/app/page.tsx","apps/dashboard/components"]
---

## Scope

`apps/dashboard/app/app/**` — the operator's dashboard: home, meetings, personas, integrations,
and the live console. Visitor mode: **Operate**.

## Audience & job

The operator mid-meeting on a second screen, and the builder debugging the agent. Tasks, in
frequency order: start a meeting by pasting a Meet link and choosing a persona; watch the live
console; review a past meeting and its artifacts; edit personas; set per-tool policy.

## Constraints

- Dark. The use scene is a second screen in a room lit by a video call; a white panel beside a
  Meet window is a flashlight.
- All data is fixture-driven (`fixtures/transcript-demo.json` plus authored dummy records).
  Every seam that will take a real API is a typed module under `lib/`, not inline JSX.
- The replay engine (`lib/replay.ts`, `lib/types.ts`, `lib/maps.ts`) is load-bearing and survives
  the rebuild unchanged; only the presentation layer is replaced.

## Direction contract

THESIS: An operations console that earns trust by being legible, not by looking technical. It
replaces the previous mission-control instrument panel — reticle brackets, scanlines, LED glow,
3px corners — which dressed the data in sci-fi costume. The rebuild's claim: the agent's
reasoning is ordinary, auditable record-keeping, and the surface that shows it should read like
Vercel's dashboard, where color appears only when something is true.

OWN-WORLD: Near-black ground `#08090a`, raised panels `#0d0e10`, hairline borders `#1e2022`,
Geist 400/500/600 for chrome and Geist Mono with tabular figures for every measured value.
Radius 8px on panels, 6px on controls. Primary actions are white-on-black, the Vercel move;
the brand amber `#FFB224` marks identity only — the wordmark, the plus1 avatar, the active-nav
rail. The four state hues are the sole other color and each names one meeting state: emerald
heard, violet reasoning, sky acting, rose honk. No glow, no gradient, no ornament that is not a
reading.

STORY: The operator lands, sees whether a meeting is live, pastes a link, picks the persona that
sets the agent's purpose, and joins. During the meeting they read the transcript with each
utterance's gate verdict beside it, watch the reasoning pipeline resolve, and collect artifacts
as they are produced. Afterwards they find the meeting in a list and reopen the whole record.

FIRST VIEWPORT (`/app`): A 248px fixed sidebar — wordmark, primary nav, persona summary, account
row at the base — against the near-black ground. The main column opens with a ruled page header,
then the join card: a single wide input for the Meet URL, a persona select, and a white Join
button, with the currently-armed persona named in plain language beneath. Below a hairline rule,
recent meetings as a dense ruled table — title, participants, duration, artifact count, gate
counts — not as cards.

FORM: Category canon, taken deliberately. The user invoked the standing exit by naming Vercel,
Stripe docs and Ramp as the bar; no concept roll was run, per the brief-pinned rule in
new-work.md §5. Vercel's dashboard is the specific target: monochrome chrome, hairline tables,
state as the only color. Seed key: pinned-canon-dashboard (no roll).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Memorable moment

The console's gate column: every utterance carries its classification verdict and confidence
inline, so the operator watches the agent decide to stay quiet — the product's actual thesis,
visible as a column of "ignore" that occasionally turns into "act".

## Unresolved

- Personas are authored dummy records; the shape in `lib/personas.ts` is the contract the real
  API should meet.
- Meeting history is fixture-derived; one real session replaces it without a layout change.
