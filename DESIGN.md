# DESIGN.md — plus1

> Durable visual decisions. Product truth lives in PRODUCT.md.

## The world

One world, two grounds, no second identity. The public site and the operator console are the
same design: white ground, near-black ink, hairline borders, tight negative tracking, and amber
reserved for identity. The console is not a separate "dark app" — it is the same surface with
denser information.

The register is the quiet instrument: Ramp and ElevenLabs rather than a neon mission-control
dashboard. Nothing decorative earns space; every mark is either content, structure, or state.

## Ground

`:root` is light and is the default everywhere, including `/app`. `.theme-dark` still exists and
is used deliberately in exactly one place — the `ConsolePreview` inset on the landing page, where
the console appears as an object *inside* a page rather than as the page itself.

Do not add a theme toggle without a reason from the use scene. The operator watches this on a
second screen in a lit room, which is what picked light.

## Color has two jobs

- **Identity** — `--brand` (#ffb224). The wordmark and the goose's beak. Never text, never a
  navigation accent — the rail earns emphasis from fill and weight instead.
- **State** — one hue per meeting state: `--live`, `--think`, `--act`, `--alert`. Never decoration.

Everything else is the neutral ramp. Any hue rendered as **text** uses its readable pair:
`--brand-text` (#855000, 6.68:1 on white), not `--brand` (1.80:1). This is the single easiest
mistake to make here and the one that has already been made once.

## Elevation

Light needs depth that dark gets free from its border ramp. Four steps, each with a real y-offset
and a soft blur over a 1px edge — never a zero-offset halo:

`--shadow-sm` (resting: panels, buttons) · `--shadow` · `--shadow-lg`
(floating: toasts) · `--shadow-key` (the one lifted surface on a page).

**One `--shadow-key` per page, maximum.** On Home it is the join panel, which is what makes it
read as the main event without any color or size trick.

## Composition

- **Ground:** white rail and white page header, tinted page body (`--bg-subtle`), white cards.
  Cards need a tinted ground to read as objects; on white they only have a hairline.
- Panels are white with a hairline and `--shadow-sm`. Panels never nest.
- Panel titles are sentence-case `13px` medium — not uppercase micro-labels. There are no
  eyebrows or kickers anywhere in the app; a heading carries its own weight.
- Counts and totals are a sentence, not a four-up metric wall. They are context for the content
  below them, never the point of the page.
- The full-height two-column console grid is a desktop composition (`lg:`). Below that, panels
  size to their content.

## The rail

232px, white, one hairline on the right. Three zones separated by rules: a 60px brand block
(dark logo tile + wordmark), the nav, and a footer.

Nav rows are 36px, 14px text, an 18px outline icon at `--fg-subtle`. The active row is a flat
`--bg-raise` fill with `--fg` text at weight 500 — no accent bar, no border, no shadow. Emphasis
is fill and weight; the rail is the one place brand color does not appear.

The footer holds agent reachability, polled from `/health`. It belongs there because it is true
of the whole console rather than any page, and every feature fails the same way without it.

## Primary action

Starting a meeting is the console's one primary action and is always reachable:

- **Home** leads with the join panel — the page's only lifted surface.
- **Every other page** carries a compact black "Send the goose" button in its header, supplied by
  `PageHeader` unless a page overrides `right` with its own primary action (Chat does).

Black-on-white is reserved for this action. A second black button on a page means one of them is
not actually primary.

## Meetings are named, not addressed

A meeting is labelled by its **purpose**, never by the Meet room code. Purpose is typed when
sending the goose, editable inline on the meeting page, and falls back to `preview` (the first
substantive line, italic to mark it as a stand-in). The room code is a trailing detail in the
second line. A raw code as a title means both the purpose and the transcript were empty.

## Type

Geist, with Geist Mono for every measured value — timestamps, counts, confidence, IDs. Monospace
is for data, never for flavor. Display headings run `-0.035em` to `-0.045em`; body sits at
`13.5–15px` with relaxed leading and a 65–75ch measure.

## Motion

One grammar: exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) from an already-visible
default. `.rise` / `.rise-in` are the whole vocabulary, plus `.dot-pulse` for live state. One
authored moment per page — on Home it is the join panel arriving. `prefers-reduced-motion` is
honored globally.

## The floor

Contrast: body and placeholder ≥4.5:1, large text ≥3:1, verified against the real ground rather
than assumed. Browser surfaces are part of the design — selection, caret, scrollbars, focus rings
and underline offsets are all themed from the palette. Every control has hover, focus-visible,
disabled, loading, error and empty states.
