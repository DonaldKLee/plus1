---
version: 1
slug: "apps-dashboard-app-page-tsx"
primary_target: "apps/dashboard/app/page.tsx"
related_targets: []
---

## Scope

`apps/dashboard/app/page.tsx` — the plus1 public landing page. Visitor mode: **Persuade**.

## Audience & job

Hack the North judges and technically literate operators (founders, PMs, ops leads) meeting
plus1 for the first time, usually on a laptop, often for under sixty seconds. They must leave
able to repeat the mechanism back: *every other meeting AI records; this one participates.*

Primary action: enter the console (`/app`). Secondary: watch the mechanism explained.

## Constraints

- Light surface. All four pinned references (Notion, Figma, Ramp, Stripe) are light with
  confident near-black display type; the dashboard stays dark, so product imagery supplies
  the contrast.
- No invented commercial claims: no customer logos, no pricing, no benchmarks, no testimonials.
  Demonstration content from `fixtures/transcript-demo.json` is real project material.
- Hero reserves a live world-map slot the team fills with real session data later.

## Direction contract

THESIS: The page a participant would build, not a recorder. It refuses the AI-SaaS landing
default — gradient mesh hero, three icon-and-heading feature cards, fake logo wall — and instead
argues one asymmetry in plain sight: recorders act after the meeting, plus1 acts inside it. The
timeline, not the card grid, is the page's structural spine.

OWN-WORLD: Notion/Stripe canon executed straight — white ground (`#ffffff`), near-black display
type (`#0a0a0b`) in Geist 600 at tight tracking, hairline `#e6e6e9` rules, generous vertical air.
One brand hue, plus1-beak amber `#FFB224`, carries identity only: the mark, the live pulse, the
map nodes. Four state hues carry meaning and nothing else — emerald heard, violet reasoning, sky
acting, rose honk. Geist Mono sets timestamps, gate verdicts, and latency. No gradient text, no
glass, no icon tiles.

STORY: A visitor understands within one viewport that a plus1 joins the call as a guest; believes
it because the gate classification and sub-200ms latency are shown as instrument readings rather
than asserted; and clicks into the console to watch a real meeting replay.

FIRST VIEWPORT: Full-width white. Wordmark and nav ride a hairline-ruled top bar. Left column
(~52%) holds one tagline at clamp(3rem, 6vw, 5.25rem), a two-line subhead at 60–70ch, then a
white-on-black primary button and a quiet text link. Right column holds the live world map —
a dotted equirectangular projection with amber session nodes pulsing on a slow loop and a
running session counter beneath. Below the fold line, a hairline rule and a single dark product
screenshot of the console, cropped so the transcript gate column is what the eye lands on.

FORM: Category canon, taken deliberately. The user invoked the standing exit by naming Notion,
Figma, Ramp and Stripe as the bar; no concept roll was run, per the brief-pinned rule in
new-work.md §5. Their craft level is the target: hairline discipline, typographic confidence,
and restraint over ornament. Seed key: pinned-canon-landing (no roll).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Sections

1. Hero — tagline, subhead, actions, live world map.
2. Problem — three stated failures of the recorder model, set as a ruled list, not cards.
3. Mechanism — the gate, shown as an actual classification timeline with real fixture utterances.
4. Capabilities — the six product behaviors from PRODUCT.md, each tied to the problem it answers.
5. Console preview — dark product panel, the contrast moment of the page.
6. Constraints — the non-negotiables, stated as proof of trustworthiness rather than fine print.
7. Footer — navigation plus "built with love at Hack the North 2026".

## Unresolved

- Real logo, final palette, and brand guidelines arrive later; every color is a token so the
  swap is one file.
- World map is fixture-driven until live session data exists.
