---
version: 1
slug: "apps-backend-src-docpdf-ts"
primary_target: "apps/backend/src/docPdf.ts"
related_targets: ["apps/backend/src/docTools.ts"]
---

# Surface brief — the plus1 document (PDF)

## Scope & mode

The PDF artifact the agent hands a room: `doc_pdf` → `docPdf.ts` → `/api/doc/:id.pdf` and the
public `/d/:token`. Mode: **Read** — the reader's job is to understand and verify something the
meeting just decided. Paper, not a screen: no hover, no state, no motion. Print is the one place
the console's design has to survive without interaction.

## Audience & job

The recipient is a meeting participant or someone downstream of it (a client, a manager, a
teammate who missed the call). They open it minutes after the meeting on a phone or a laptop
preview, look for the specific thing they were promised — the number, the date, the price, the
list of who owes what — and forward it. Two failures kill it: the figure they came for is not
there, and it does not look like it came from a company.

## Constraints

- No headless Chromium available (the only Chrome joins Meet). pdf-lib, one pass, pure JS.
- The body is written by an LLM and arrives as markdown-lite. The renderer is the last honest
  step in the chain: whatever it cannot render, the reader never sees.
- US Letter, one column, print-safe margins. Must survive a black-and-white printer.

## Direction contract

THESIS: this document is *evidence*, not correspondence. It owns one idea — every figure the
room asked for, set where it can be checked in seconds — and it refuses the two category
defaults: the Word-file-with-a-logo (centered title, justified prose, numbers buried in
sentences) and the consultancy report cover page. There is no cover, no table of contents, no
section numbering. Page one starts with the answer.

OWN-WORLD: the console's world on paper. White ground, near-black ink (#09090b), one hairline
weight (#e8e8ea) doing all the separating, no fills except the #fafafa figure band and code
block; tables carry no fill at all. Amber (#ffb224) appears exactly once per page — the masthead
rule, 3pt on page one and 2pt over the running head after it — and never as text; amber-as-text
is #855000, reserved for inline code. Geist for prose, Geist Mono for
every measured value: figures, dates, IDs, table numerals, page numbers. Display type carries
real negative tracking (-0.035em to -0.045em) drawn through the PDF text-state operator, not
faked. Recognizable with every word removed: amber hairline over a white page, a mono column of
right-aligned numerals, one rule weight.

STORY: the reader understands they are holding the meeting's record, believes the numbers are
the room's actual numbers because they are set as data rather than prose, and forwards it or
acts on the action list without asking a follow-up question.

FIRST VIEWPORT (page 1, top to bottom): a 3pt amber rule bled across the full measure at the
head of the page; under it, the plus1 wordmark at 11pt semibold ink on the left and the ISO date
in 9pt mono at `--fg-subtle` right-aligned on the same baseline. 34pt of air. Title at 25pt
semibold, tracking -0.04em, wrapping to at most three lines. Subtitle at 11pt `--fg-muted`
directly under it. A hairline across the measure. Then, when the document carries figures, the
figure band: a #fafafa panel with no border, each figure's label in 7.5pt mono uppercase-tracked
`--fg-subtle` above its value in 17pt mono medium ink, laid out in equal columns. Then the body.
There is no primary action — it is paper.

FORM: no concept roll. This is a narrow, precisely specified artifact inside an established
visual world (DESIGN.md's web sections are committed and unchanged), which the playbook routes as a
direct extension rather than a direction tournament. Seed key: none — extension scope.
The build's durable print decisions were added to DESIGN.md as a new `## Print` section; nothing
above it was rewritten.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance.

## The content contract (why numbers went missing)

The renderer previously supported only headings, bullets, rules and quotes, so any table or
aligned figure the model emitted was flattened into a pipe-salad paragraph or dropped. The
template now renders, and the tool schema now names: markdown tables (aligned, mono numerals,
right-aligned numeric columns), a key-figure band, definition rows (`Term: value`), callouts,
and a checklist for action items. The brain's `doc_pdf` instruction requires carrying every
number, date, name and amount from the request verbatim, and requires a table whenever two or
more comparable figures exist.

## Promoted to DESIGN.md

The reusable half of this build now lives in **DESIGN.md § Print**, because it belongs to the world
rather than to this file: the print grid (US Letter, 1in margins, 468pt full measure, 404pt prose
measure), the masthead and running-head rule, the Mono-Means-Measured Rule and the tracking ramp
drawn through `Tc`, the one-hairline and two-fills constraints, the key-figure band, the table
rules, and the One Empty Mark Rule. A second document surface (an invoice, a brief, an exported
summary) inherits those from DESIGN.md without reading this brief. What stays here is everything
specific to *this* renderer — the content contract above, the pdf-lib workarounds, and the defects
this build carries.

## Settled during the build

- Ligatures are disabled at embed time. fontkit substitutes Geist's ff/tt/fi ligatures while
  pdf-lib's width table uses single-glyph advances, which opened a visible hole in the line after
  every ligature. Do not turn them back on without re-checking the wrap.
- One hairline: 1pt `--border` everywhere, including the rule that closes a table header. The
  header separates itself with tracked mono uppercase type; a darker rule was a second treatment.
- An empty table cell is always the same mark (en dash, mono, `--fg-subtle`), whatever the
  markdown wrote and whatever face the column uses.
- Links are real `/Annot /Link` objects with a `/URI` action, and the URL is still printed: this
  is paper first, and a link nobody can read is useless once it leaves the screen.
- Spec-row groups and their headings break as a unit, measured from the group's real height.

## Unresolved

- Geist ships as TTF under `apps/backend/assets/fonts` (OFL). If those files are ever absent the
  renderer falls back to the PDF core fonts and the document still renders — degraded, never
  broken. `docFontStatus()` reports it at server boot so this is an operator's problem to know
  about rather than a reader's to discover. Courier as the fallback mono is a costume face and is
  accepted only because it is the floor of a degraded path.
- A short trailing block (the closing code block in the sample) can still take a page of its own
  when it misses the floor by a few points. No pagination hack was added to chase it; if this
  becomes common, generalize the keep-with-next reserve beyond spec groups.
