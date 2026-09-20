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

## Print

The same world on paper. Added when the document renderer (`apps/backend/src/docTemplate.ts`)
became the first surface to render this design outside a browser. Everything above still holds —
white ground, near-black ink, one hairline weight, amber as identity — but print settles things no
web surface could: there is no hover, no state, no motion, and no reflow. What the renderer cannot
draw, the reader never sees.

**The grid.** US Letter (612×792pt), 1in margins (72pt) so it survives every consumer printer.
Two measures, not one: **468pt full measure** for rules, tables and the figure band, and a
**404pt prose measure** (~72ch at 11pt Geist) for body text. Body is 11pt at 1.55 leading. The
content floor is 78pt, the footer hairline sits at 62pt. Prose never runs the full measure — a
line of text set to 468pt is a line nobody finishes.

**The masthead.** Amber appears **exactly once per page** and never as text. Page one gets a 3pt
amber rule bled across the full measure, the `plus1` wordmark under it in 11pt semibold ink, and
the ISO date right-aligned on the same baseline in 9pt mono `--fg-subtle`. Every page after that
gets a 2pt amber rule over a running head: the document's title left, `plus1` right, both 8.5pt
`--fg-subtle`. The running head's title is **sans, not mono** — it is the document's name, and mono
there would be a costume for "technical" rather than a measured value.

**The Mono-Means-Measured Rule.** Geist Mono carries every measured value and nothing else:
figures, dates, IDs, table numerals, page numbers, code. Geist carries everything else, including
headings, prose, table text columns, and the running head. A bolded total inside a numeric column
stays mono — a total set in the sans breaks the column it is the total of.

**Tracking is real, not faked.** CSS `letter-spacing` has no equivalent in pdf-lib, so display type
is tracked through the PDF text-state operator (`Tc`) and every measurement compensates for it.
The web ramp carries over: title 25pt semibold at `-1pt` (−0.04em), H1 16.5pt at `-0.5pt`,
H2 13pt at `-0.3pt`. Mono labels track *positive* (`+0.4` to `+0.45`), which is what makes an
uppercase field name legible at 8pt.

**One hairline does all the separating.** 1pt in `--border`, everywhere — the rule under a title,
between table rows, under a table header, above the footer. There is no second weight and no darker
rule. `--border-strong` appears only as a drawn mark (bullet dots, the blockquote stripe, an
unchecked box), never as a divider.

**Two fills, no more.** `--bg-subtle` (#fafafa) grounds the figure band and the code block. Nothing
else is filled: tables carry no fill at all, no zebra, no header shade, no vertical rules.

**The key-figure band.** The one panel in the document, and the reason it exists: the thing a reader
came for is almost always a number, and a number inside a sentence is a number nobody can check.
A `--bg-subtle` panel with no border, 18pt padding, up to six figures in equal columns (three per
row, two when there are exactly four). Each figure is a 7.5pt mono uppercase tracked label in
`--fg-subtle` over a 17pt mono medium value in ink, with an optional 8.5pt sans note under it in
`--fg-muted`. This is the one place tracked mono uppercase is correct: it is a field name on an
instrument, not an eyebrow over a heading.

**Tables.** 9.8pt cells, 9pt gutters, header in 8.2pt tracked mono uppercase `--fg-subtle`. A
column whose non-empty body cells are all numbers is a numeric column: it sets itself in mono and
right-aligns itself even when the source markdown did not say so, because that is what makes a
column comparable. The first column is ink, the rest `--fg-muted`. Slack in a narrow table goes to
the widest *text* column, never stretched across the numbers. A table that spans a page repeats its
header.

**The One Empty Mark Rule.** An absent value is always the same mark: an en dash, in mono, in
`--fg-subtle` — whatever the source wrote there and whatever face the column uses. Letting each
column supply its own put a sans em dash beside a mono one in the same row.

**No cover, no contents, no numbering.** Page one starts with the answer. The two category defaults
this refuses are the Word-file-with-a-logo (centered title, justified prose, figures buried in
sentences) and the consultancy report cover page. There is no primary action, because it is paper:
a printed URL is printed in full even when the digital copy is also a live link.

**Degradation is a floor, not a style.** Geist and Geist Mono are embedded as TTF (OFL, under
`apps/backend/assets/fonts`) with ligatures disabled at embed time. When those files are absent the
renderer falls back to the PDF core fonts and still produces a document. That fallback is an
accepted floor for a broken deployment; Helvetica and Courier are not part of this design system
and no surface should target them.
