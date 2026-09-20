/**
 * The plus1 document template: the console's design, on paper.
 *
 * This is the layout engine behind every PDF the plus1 hands a room. docPdf.ts
 * owns storage, tokens and share links; this module owns the page.
 *
 * The thesis is that the document is *evidence*, not correspondence. A meeting
 * asked for something specific — a price, a date, who owes what — and the
 * reader opens this minutes later looking for exactly that. So figures are set
 * as data (Geist Mono, right-aligned, in real tables), never buried in prose,
 * and page one starts with the answer: no cover, no table of contents, no
 * section numbering.
 *
 * Design tokens are lifted verbatim from apps/dashboard/app/globals.css so the
 * PDF and the console are the same surface. Amber is identity only — the
 * masthead rule — and never text; amber as text is --brand-text (#855000).
 *
 * Geist ships under assets/fonts (OFL). When those files are missing the
 * renderer degrades to the PDF core fonts rather than failing: a slightly
 * plainer document always beats no document.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  setCharacterSpacing,
  type Color,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

// ── palette (globals.css) ──────────────────────────────────────────────────
const hex = (h: string): Color => {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

export const C = {
  ink: hex("#09090b"), // --fg
  muted: hex("#55555d"), // --fg-muted
  subtle: hex("#6e6e76"), // --fg-subtle
  border: hex("#e8e8ea"), // --border
  borderStrong: hex("#d5d5da"), // --border-strong
  bgSubtle: hex("#fafafa"), // --bg-subtle
  brand: hex("#ffb224"), // --brand — identity only, never text
  brandText: hex("#855000"), // --brand-text — the readable pair
  live: hex("#0a7f4a"),
  alert: hex("#c81e2a"),
} as const;

// ── the grid ───────────────────────────────────────────────────────────────
export const PAGE_W = 612; // US Letter
export const PAGE_H = 792;
const M = 72; // 1in — print-safe on every consumer printer
const FULL_W = PAGE_W - M * 2; // 468pt: tables, rules, figure bands
const PROSE_W = 404; // ~72ch at 11pt Geist — the reading measure
const HEAD_TOP = PAGE_H - 52; // masthead baseline zone
const BODY_TOP = PAGE_H - 96; // where content starts on a continuation page
const FOOT_RULE = 62; // footer hairline
const BOTTOM = 78; // content floor

const BODY = 11;
const LEAD = 1.55;

// ── fonts ──────────────────────────────────────────────────────────────────
export interface Fonts {
  sans: PDFFont;
  medium: PDFFont;
  semibold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
  monoMedium: PDFFont;
  /** True when real Geist was embedded (affects which glyphs are safe). */
  geist: boolean;
}

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");

function readFont(file: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(FONT_DIR, file));
  } catch {
    return null;
  }
}

const FONT_FILES = [
  "Geist-Regular.ttf",
  "Geist-Medium.ttf",
  "Geist-SemiBold.ttf",
  "Geist-Italic.ttf",
  "GeistMono-Regular.ttf",
  "GeistMono-Medium.ttf",
] as const;

/**
 * Which faces are actually on disk. Checked at startup, not only at render
 * time: the fallback is a legitimate floor, but an operator should learn that a
 * deployment shipped without `assets/fonts` from a boot log — not from a reader
 * receiving a document set in a typeface the design never chose.
 */
export function docFontStatus(): { ok: boolean; dir: string; missing: string[] } {
  const missing = FONT_FILES.filter((f) => !fs.existsSync(path.join(FONT_DIR, f)));
  return { ok: missing.length === 0, dir: FONT_DIR, missing };
}

let warned = false;

/**
 * Embed Geist + Geist Mono, or fall back to the PDF core fonts. `subset: false`
 * because a subsetted font that later needs a glyph it dropped throws at draw
 * time; a full embed costs ~120KB per face once per document, which is nothing
 * against never failing a render.
 */
export async function loadDocFonts(doc: PDFDocument): Promise<Fonts> {
  const files = {
    sans: readFont("Geist-Regular.ttf"),
    medium: readFont("Geist-Medium.ttf"),
    semibold: readFont("Geist-SemiBold.ttf"),
    italic: readFont("Geist-Italic.ttf"),
    mono: readFont("GeistMono-Regular.ttf"),
    monoMedium: readFont("GeistMono-Medium.ttf"),
  };

  if (Object.values(files).every((f) => f !== null)) {
    doc.registerFontkit(fontkit);
    // Ligatures off, deliberately. fontkit substitutes Geist's ff/tt/fi
    // ligatures during shaping, but the width table pdf-lib writes is built
    // from single-glyph advances, so every ligature opened a visible hole in
    // the line ("came off ." / "htt ps://"). Turning the feature off is the
    // only fix that keeps measured wrapping and drawn text in agreement.
    const embed = (b: Buffer) =>
      doc.embedFont(b, {
        subset: false,
        features: { liga: false, rlig: false, clig: false, dlig: false, calt: false },
      });
    return {
      sans: await embed(files.sans!),
      medium: await embed(files.medium!),
      semibold: await embed(files.semibold!),
      italic: await embed(files.italic!),
      mono: await embed(files.mono!),
      monoMedium: await embed(files.monoMedium!),
      geist: true,
    };
  }

  if (!warned) {
    warned = true;
    console.warn(`[docPdf] Geist not found in ${FONT_DIR}; rendering with core fonts`);
  }
  const core = async (n: StandardFonts) => doc.embedFont(n);
  return {
    sans: await core(StandardFonts.Helvetica),
    medium: await core(StandardFonts.Helvetica),
    semibold: await core(StandardFonts.HelveticaBold),
    italic: await core(StandardFonts.HelveticaOblique),
    mono: await core(StandardFonts.Courier),
    monoMedium: await core(StandardFonts.CourierBold),
    geist: false,
  };
}

/**
 * An LLM writing "notes" emits curly quotes, dashes, arrows and the occasional
 * emoji. Embedded Geist covers Latin-1 plus the typographic punctuation we
 * actually want to keep, so those survive; anything past that (emoji, CJK,
 * dingbats) is mapped or dropped, because a missing glyph is a thrown error
 * rather than a blank box.
 */
export function normalizeText(s: string, geist = true): string {
  const keep = geist
    ? /[^\n\x20-\x7E\xA0-\xFF\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/g
    : /[^\n\x20-\x7E\xA0-\xFF]/g;
  const map: Record<string, string> = {
    "\u2018": "'", "\u2019": "'", "\u201A": ",", "\u201B": "'",
    "\u201C": '"', "\u201D": '"', "\u201E": '"',
    "\u2013": "-", "\u2014": "-", "\u2015": "-", "\u2212": "-",
    "\u2026": "...", "\u2022": "-", "\u00B7": "-", "\u25CF": "-", "\u25AA": "-",
    "\u2192": "->", "\u2190": "<-", "\u21D2": "=>", "\u2264": "<=", "\u2265": ">=",
    "\u00A0": " ", "\u2009": " ", "\u200A": " ", "\u202F": " ", "\u200B": "",
    "\u2713": "", "\u2714": "", "\u2717": "x", "\u2718": "x", "\uFE0F": "",
  };
  let out = s.replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
  // Fold the characters this font cannot show, keeping the ones it can.
  out = out.replace(/[\u2018-\u201E\u2013-\u2015\u2212\u2026\u2022\u00B7\u25CF\u25AA\u2192\u2190\u21D2\u2264\u2265\u00A0\u2009\u200A\u202F\u200B\u2713\u2714\u2717\u2718\uFE0F]/g, (c) => {
    if (geist && /[\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/.test(c)) return c;
    return map[c] ?? "";
  });
  return (
    out
      .replace(keep, "")
      // Stripping mid-sentence leaves orphaned whitespace ("emoji ,"). Tidy the
      // seams so removals are invisible on the page — but never touch `- [ ]`,
      // which is a checklist marker and not a bracket with a stray space.
      .replace(/ +([,.;:!?)])/g, "$1")
      .replace(/(?<!\[) +\](?!\()/g, "]")
      .replace(/\( +/g, "(")
      .replace(/\[ +(?=[^\]])/g, "[")
      .replace(/[ ]+$/gm, "")
  );
}

// ── measured text with real tracking ───────────────────────────────────────
// pdf-lib has no letter-spacing, but the PDF text state does (Tc). Display type
// in this world runs -0.035em to -0.045em, so it gets drawn through the
// operator rather than faked, and every measurement compensates for it.

function widthOf(text: string, font: PDFFont, size: number, tracking = 0): number {
  return font.widthOfTextAtSize(text, size) + tracking * text.length;
}

interface TextOpts {
  x: number;
  y: number;
  size: number;
  font: PDFFont;
  color?: Color;
  tracking?: number;
}

function draw(page: PDFPage, text: string, o: TextOpts): void {
  if (!text) return;
  if (o.tracking) page.pushOperators(setCharacterSpacing(o.tracking));
  page.drawText(text, { x: o.x, y: o.y, size: o.size, font: o.font, color: o.color ?? C.ink });
  if (o.tracking) page.pushOperators(setCharacterSpacing(0));
}

// ── inline runs: bold, italic, code, links ─────────────────────────────────
type Style = "plain" | "bold" | "italic" | "code";
interface Tok {
  text: string;
  style: Style;
  /** Set on the run a reader can click, and on the printed URL beside it. */
  url?: string;
}

const URL_RE = /\bhttps?:\/\/[^\s<>()]+/;

/**
 * Split inline markdown into styled tokens.
 *
 * The URL stays visible because this is paper first — a link nobody can read is
 * useless once it is printed — and the run also carries the href so the digital
 * copy is actually clickable.
 */
function inlineTokens(s: string): Tok[] {
  const out: Tok[] = [];
  const md = /\[([^\]]+)\]\(([^)\s]+)\)/g;

  // Pass 1: markdown links become a labelled run plus the printed URL.
  const pieces: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = md.exec(s))) {
    if (m.index > last) pieces.push({ text: s.slice(last, m.index), style: "plain" });
    const label = m[1].trim();
    const url = m[2].trim();
    if (label.toLowerCase() === url.toLowerCase()) {
      pieces.push({ text: url, style: "plain", url });
    } else {
      pieces.push({ text: label, style: "plain", url });
      pieces.push({ text: ` (${url})`, style: "plain", url });
    }
    last = md.lastIndex;
  }
  if (last < s.length) pieces.push({ text: s.slice(last), style: "plain" });

  // Pass 2: emphasis, code, and bare URLs inside the plain pieces.
  const re = /(\*\*|__)(.+?)\1|(`)([^`]+)`|(?<![*\w])\*(?!\s)([^*]+?)(?<!\s)\*(?!\w)/g;
  for (const piece of pieces) {
    if (piece.url) {
      out.push(piece);
      continue;
    }
    let cursor = 0;
    re.lastIndex = 0;
    let mm: RegExpExecArray | null;
    const emit = (text: string): void => {
      // A bare URL in prose is still a link.
      let rest = text;
      let hit: RegExpExecArray | null;
      while ((hit = URL_RE.exec(rest))) {
        if (hit.index > 0) out.push({ text: rest.slice(0, hit.index), style: "plain" });
        out.push({ text: hit[0], style: "plain", url: hit[0] });
        rest = rest.slice(hit.index + hit[0].length);
      }
      if (rest) out.push({ text: rest, style: "plain" });
    };
    while ((mm = re.exec(piece.text))) {
      if (mm.index > cursor) emit(piece.text.slice(cursor, mm.index));
      if (mm[2] !== undefined) out.push({ text: mm[2], style: "bold" });
      else if (mm[4] !== undefined) out.push({ text: mm[4], style: "code" });
      else if (mm[5] !== undefined) out.push({ text: mm[5], style: "italic" });
      cursor = re.lastIndex;
    }
    if (cursor < piece.text.length) emit(piece.text.slice(cursor));
  }
  return out.filter((t) => t.text.length > 0);
}

interface Part {
  text: string;
  font: PDFFont;
  size: number;
  color: Color;
  url?: string;
}
type Line = Part[];

function styleOf(style: Style, f: Fonts, size: number, base: PDFFont, color: Color): { font: PDFFont; size: number; color: Color } {
  // A bold figure inside a numeric column stays mono: a bolded total set in the
  // sans breaks the column it is the total of.
  if (style === "bold") return { font: base === f.mono ? f.monoMedium : f.semibold, size, color };
  if (style === "italic") return { font: f.italic, size, color };
  if (style === "code") return { font: f.mono, size: size * 0.93, color: C.brandText };
  return { font: base, size, color };
}

/** Greedy wrap across styled runs, measured per word. */
function layoutRuns(toks: Tok[], f: Fonts, size: number, base: PDFFont, color: Color, maxW: number): Line[] {
  const lines: Line[] = [];
  let cur: Line = [];
  let w = 0;

  const push = () => {
    if (cur.length) lines.push(cur);
    cur = [];
    w = 0;
  };

  for (const tok of toks) {
    const st = styleOf(tok.style, f, size, base, color);
    // Keep the token's own spacing: split so separators survive as words.
    const words = tok.text.split(/(\s+)/).filter((x) => x.length);
    for (const word of words) {
      if (/^\s+$/.test(word)) {
        if (cur.length === 0) continue; // no leading space on a fresh line
        const sw = widthOf(" ", st.font, st.size);
        cur.push({ text: " ", ...st });
        w += sw;
        continue;
      }
      const url = tok.url;
      let ww = widthOf(word, st.font, st.size);
      if (w + ww > maxW && cur.length) {
        // Drop a trailing space before breaking.
        while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) cur.pop();
        push();
      }
      // A single token wider than the measure (a long URL) hard-breaks.
      if (ww > maxW) {
        let chunk = "";
        for (const ch of word) {
          if (widthOf(chunk + ch, st.font, st.size) > maxW) {
            cur.push({ text: chunk, ...st, url });
            push();
            chunk = ch;
          } else chunk += ch;
        }
        cur.push({ text: chunk, ...st, url });
        w = widthOf(chunk, st.font, st.size);
        continue;
      }
      cur.push({ text: word, ...st, url });
      w += ww;
    }
  }
  while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) cur.pop();
  push();
  return lines.length ? lines : [[]];
}

function lineWidth(line: Line): number {
  return line.reduce((a, p) => a + widthOf(p.text, p.font, p.size), 0);
}

// ── document context ───────────────────────────────────────────────────────
interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  f: Fonts;
  title: string;
  pageCount: number;
}

function runningHead(c: Ctx): void {
  // Continuation pages carry the document's name, not a second masthead: the
  // reader already knows what this is, they need to know they are still in it.
  c.page.drawRectangle({ x: M, y: PAGE_H - 56, width: FULL_W, height: 2, color: C.brand });
  // Geist, not mono: this is the document's name, and mono here would be a
  // costume for "technical" rather than a measured value.
  const label = c.title.length > 74 ? `${c.title.slice(0, 73)}...` : c.title;
  draw(c.page, label, { x: M, y: PAGE_H - 74, size: 8.5, font: c.f.medium, color: C.subtle, tracking: -0.1 });
  draw(c.page, "plus1", {
    x: PAGE_W - M - widthOf("plus1", c.f.semibold, 8.5, -0.15),
    y: PAGE_H - 74,
    size: 8.5,
    font: c.f.semibold,
    color: C.subtle,
    tracking: -0.15,
  });
}

function newPage(c: Ctx): void {
  c.page = c.doc.addPage([PAGE_W, PAGE_H]);
  c.pageCount += 1;
  runningHead(c);
  c.y = BODY_TOP;
}

/** Reserve vertical space, breaking the page when the block will not fit. */
function need(c: Ctx, h: number): void {
  if (c.y - h < BOTTOM) newPage(c);
}

/**
 * A real PDF link annotation. The URL is printed on the page either way — this
 * is paper first — but the copy that gets opened on a laptop should be
 * clickable, which a flattened string never is.
 */
function addLink(c: Ctx, x: number, baseline: number, w: number, size: number, url: string): void {
  const annot = c.doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, baseline - size * 0.25, x + w, baseline + size],
    Border: [0, 0, 0],
    F: 4, // print
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  const ref = c.doc.context.register(annot);
  const existing = c.page.node.lookup(PDFName.of("Annots"), PDFArray);
  if (existing) existing.push(ref);
  else c.page.node.set(PDFName.of("Annots"), c.doc.context.obj([ref]));
}

/** Draw one styled run at a baseline, registering its link when it has one. */
function drawPart(c: Ctx, p: Part, x: number, baseline: number, tracking = 0): number {
  draw(c.page, p.text, { x, y: baseline, size: p.size, font: p.font, color: p.color, tracking });
  const w = widthOf(p.text, p.font, p.size, tracking);
  if (p.url) addLink(c, x, baseline, w, p.size, p.url);
  return w;
}

/** Draw one already-laid-out line and advance. */
function putLine(c: Ctx, line: Line, x: number, leading: number, align: "left" | "right" = "left", boxW = 0): void {
  const maxSize = line.reduce((a, p) => Math.max(a, p.size), BODY);
  need(c, leading);
  let cx = align === "right" ? x + boxW - lineWidth(line) : x;
  for (const p of line) cx += drawPart(c, p, cx, c.y - maxSize);
  c.y -= leading;
}

interface BlockOpts {
  size?: number;
  font?: PDFFont;
  color?: Color;
  indent?: number;
  width?: number;
  lead?: number;
  tracking?: number;
  gapAfter?: number;
}

/** A paragraph of inline-styled text. */
function paragraph(c: Ctx, text: string, o: BlockOpts = {}): void {
  const size = o.size ?? BODY;
  const base = o.font ?? c.f.sans;
  const color = o.color ?? C.ink;
  const indent = o.indent ?? 0;
  const maxW = (o.width ?? PROSE_W) - indent;
  const leading = size * (o.lead ?? LEAD);
  const lines = layoutRuns(inlineTokens(text), c.f, size, base, color, maxW);

  if (o.tracking) {
    // Display type: one run, tracked, measured with the tracking included.
    const tracked = layoutRuns(inlineTokens(text), c.f, size, base, color, maxW - o.tracking * 1.2);
    for (const line of tracked) {
      need(c, leading);
      let cx = M + indent;
      for (const p of line) cx += drawPart(c, p, cx, c.y - size, o.tracking);
      c.y -= leading;
    }
  } else {
    for (const line of lines) putLine(c, line, M + indent, leading);
  }
  if (o.gapAfter) c.y -= o.gapAfter;
}

function rule(c: Ctx, color: Color = C.border, thickness = 1, width = FULL_W): void {
  need(c, thickness + 2);
  c.page.drawLine({
    start: { x: M, y: c.y },
    end: { x: M + width, y: c.y },
    thickness,
    color,
  });
  c.y -= thickness;
}

// ── figures: the numbers, as data ──────────────────────────────────────────
export interface Figure {
  label: string;
  value: string;
  note?: string;
}

const FIG_PAD = 18;

/**
 * The key-figure band. This exists because the thing a reader came for is
 * almost always a number, and a number inside a sentence is a number nobody
 * can check. Mono, large, labelled, on the one tinted ground in the document.
 */
function figureBand(c: Ctx, figures: Figure[]): void {
  const rows: Figure[][] = [];
  const perRow = figures.length === 4 ? 2 : Math.min(3, figures.length);
  for (let i = 0; i < figures.length; i += perRow) rows.push(figures.slice(i, i + perRow));

  const colW = (FULL_W - FIG_PAD * 2) / perRow;
  const LABEL = 7.5;
  const VALUE = 17;

  // Measure first: the band is one panel, so it needs its height up front.
  let h = FIG_PAD;
  const laid = rows.map((row) =>
    row.map((fig) => {
      const value = layoutRuns(
        [{ text: fig.value, style: "plain" }],
        c.f,
        VALUE,
        c.f.monoMedium,
        C.ink,
        colW - 14,
      );
      const note = fig.note
        ? layoutRuns([{ text: fig.note, style: "plain" }], c.f, 8.5, c.f.sans, C.muted, colW - 14)
        : [];
      return { fig, value, note };
    }),
  );
  for (const row of laid) {
    const tallest = Math.max(
      ...row.map((cell) => LABEL * 2.1 + cell.value.length * VALUE * 1.2 + cell.note.length * 11.5),
    );
    h += tallest + FIG_PAD;
  }

  need(c, h + 12);
  const top = c.y;
  c.page.drawRectangle({ x: M, y: top - h, width: FULL_W, height: h, color: C.bgSubtle });

  let y = top - FIG_PAD;
  for (const row of laid) {
    let tallest = 0;
    row.forEach((cell, i) => {
      const x = M + FIG_PAD + i * colW;
      // Label: the one place tracked mono uppercase is right — it is a field
      // name on an instrument, not an eyebrow over a heading.
      const label = cell.fig.label.toUpperCase();
      draw(c.page, label, { x, y: y - LABEL, size: LABEL, font: c.f.monoMedium, color: C.subtle, tracking: 0.45 });
      let cy = y - LABEL * 2.1;
      for (const line of cell.value) {
        let cx = x;
        for (const p of line) {
          draw(c.page, p.text, { x: cx, y: cy - VALUE, size: p.size, font: p.font, color: p.color });
          cx += widthOf(p.text, p.font, p.size);
        }
        cy -= VALUE * 1.2;
      }
      for (const line of cell.note) {
        let cx = x;
        for (const p of line) {
          draw(c.page, p.text, { x: cx, y: cy - 8.5, size: p.size, font: p.font, color: p.color });
          cx += widthOf(p.text, p.font, p.size);
        }
        cy -= 11.5;
      }
      tallest = Math.max(tallest, y - cy);
    });
    y -= tallest + FIG_PAD;
  }
  c.y = top - h - 18;
}

// ── tables: where the numbers live ────────────────────────────────────────
const NUMERIC = /^[-+(]?\s*[$€£¥]?\s*\d[\d,\u00A0 ]*(?:\.\d+)?\s*%?\)?$|^[-+]?\d+(?:\.\d+)?\s*(?:%|x|hrs?|h|d|mo|yr|km|kg|pts?)$/i;

/** Inline markers are styling, not content, when deciding what a column holds. */
const bare = (s: string): string => s.replace(/\*\*|__|`|\*/g, "").trim();

/**
 * An empty cell, a dash, or "n/a" is the absence of a figure, not a non-figure.
 * Counting these as text was demoting whole numeric columns to the prose face —
 * so a bolded total and an em-dash placeholder broke the column they belonged to.
 */
const PLACEHOLDER = /^(|-{1,2}|\u2013|\u2014|n\/?a|tbd|\u2022)$/i;

interface Table {
  head: string[];
  rows: string[][];
  align: ("left" | "right" | "center")[];
}

function isTableSeparator(s: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(s);
}

function splitRow(s: string): string[] {
  return s
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((x) => x.trim());
}

function parseTable(lines: string[], start: number): { table: Table; next: number } | null {
  const head = lines[start];
  if (!head.includes("|")) return null;
  const sep = lines[start + 1];
  if (!sep || !isTableSeparator(sep)) return null;

  const headCells = splitRow(head);
  const align = splitRow(sep).map((s) => {
    if (/^:-+:$/.test(s)) return "center" as const;
    if (/-+:$/.test(s)) return "right" as const;
    return "left" as const;
  });
  const rows: string[][] = [];
  let i = start + 2;
  for (; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || !raw.includes("|")) break;
    const cells = splitRow(raw);
    while (cells.length < headCells.length) cells.push("");
    rows.push(cells.slice(0, headCells.length));
  }
  return { table: { head: headCells, rows, align }, next: i };
}

const CELL = 9.8;
const CELL_PAD = 9;

/**
 * Tables with no vertical rules, no fills and no zebra: one rule under the
 * header, hairlines between rows, and numerals in mono so a column of figures
 * reads as a column. Numeric columns right-align themselves when the markdown
 * did not say so, because that is what makes them comparable.
 */
function drawTable(c: Ctx, t: Table): void {
  const cols = t.head.length;
  // A column whose body cells are all numbers is a numeric column.
  const numeric = t.head.map((_, i) => {
    const vals = t.rows.map((r) => bare(r[i] ?? "")).filter((v) => !PLACEHOLDER.test(v));
    return vals.length > 0 && vals.every((v) => NUMERIC.test(v));
  });
  const align = t.align.map((a, i) => (a === "left" && numeric[i] ? "right" : a));
  const fontFor = (i: number, header: boolean) =>
    header ? c.f.monoMedium : numeric[i] ? c.f.mono : c.f.sans;

  // Intrinsic widths, then scale to the measure.
  const intrinsic = t.head.map((h, i) => {
    const body = t.rows.reduce(
      (a, r) => Math.max(a, widthOf(bare(r[i] ?? ""), fontFor(i, false), CELL)),
      0,
    );
    return Math.max(widthOf(h.toUpperCase(), c.f.monoMedium, 8.2, 0.4), body) + CELL_PAD * 2;
  });
  const total = intrinsic.reduce((a, b) => a + b, 0);
  let widths = intrinsic.map((w) => (w / total) * FULL_W);
  if (total < FULL_W) {
    // Narrow table: keep columns honest and give the slack to the widest text
    // column instead of stretching numbers across the page.
    const slack = FULL_W - total;
    const widest = intrinsic.indexOf(Math.max(...intrinsic.filter((_, i) => !numeric[i])));
    widths = intrinsic.map((w, i) => w + (i === (widest < 0 ? 0 : widest) ? slack : 0));
  }

  const xs: number[] = [];
  let acc = M;
  for (const w of widths) {
    xs.push(acc);
    acc += w;
  }

  const header = (): void => {
    need(c, 34);
    t.head.forEach((h, i) => {
      const label = h.toUpperCase();
      const w = widths[i] - CELL_PAD * 2;
      const tw = widthOf(label, c.f.monoMedium, 8.2, 0.4);
      const x =
        align[i] === "right"
          ? xs[i] + CELL_PAD + Math.max(0, w - tw)
          : align[i] === "center"
            ? xs[i] + CELL_PAD + Math.max(0, (w - tw) / 2)
            : xs[i] + CELL_PAD;
      draw(c.page, label, { x, y: c.y - 8.2, size: 8.2, font: c.f.monoMedium, color: C.subtle, tracking: 0.4 });
    });
    c.y -= 15;
    c.page.drawLine({
      start: { x: M, y: c.y },
      end: { x: M + FULL_W, y: c.y },
      thickness: 1,
      color: C.borderStrong,
    });
    c.y -= 4;
  };

  c.y -= 6;
  header();

  for (const row of t.rows) {
    const laid = row.map((cell, i) =>
      layoutRuns(
        inlineTokens(cell),
        c.f,
        CELL,
        fontFor(i, false),
        i === 0 ? C.ink : C.muted,
        widths[i] - CELL_PAD * 2,
      ),
    );
    const rowH = Math.max(...laid.map((l) => l.length)) * CELL * 1.5 + 9;

    if (c.y - rowH < BOTTOM) {
      newPage(c);
      header(); // a table that spans pages repeats its header
    }

    const top = c.y;
    laid.forEach((lines, i) => {
      const boxW = widths[i] - CELL_PAD * 2;
      let cy = top - 5;
      for (const line of lines) {
        const lw = lineWidth(line);
        let cx =
          align[i] === "right"
            ? xs[i] + CELL_PAD + Math.max(0, boxW - lw)
            : align[i] === "center"
              ? xs[i] + CELL_PAD + Math.max(0, (boxW - lw) / 2)
              : xs[i] + CELL_PAD;
        for (const p of line) cx += drawPart(c, p, cx, cy - CELL);
        cy -= CELL * 1.5;
      }
    });
    c.y = top - rowH;
    // One hairline weight in this document: 1pt. A 0.6pt row rule was a third
    // treatment nobody chose.
    c.page.drawLine({
      start: { x: M, y: c.y + 3 },
      end: { x: M + FULL_W, y: c.y + 3 },
      thickness: 1,
      color: C.border,
    });
  }
  c.y -= 6;
}

// ── body blocks ────────────────────────────────────────────────────────────
const H_SIZES: Record<number, number> = { 1: 16.5, 2: 13, 3: 11.5 };

function checkbox(c: Ctx, x: number, y: number, done: boolean): void {
  const s = 8.6;
  c.page.drawRectangle({
    x,
    y: y - s,
    width: s,
    height: s,
    borderColor: done ? C.live : C.borderStrong,
    borderWidth: 1,
    color: undefined,
  });
  if (done) {
    // Drawn, not a glyph: two strokes, so it prints and scales like the rules.
    c.page.drawLine({ start: { x: x + 1.9, y: y - s + 4.3 }, end: { x: x + 3.5, y: y - s + 2.2 }, thickness: 1.2, color: C.live });
    c.page.drawLine({ start: { x: x + 3.5, y: y - s + 2.2 }, end: { x: x + 6.8, y: y - s + 6.5 }, thickness: 1.2, color: C.live });
  }
}

// The body is parsed into blocks before anything is drawn. Doing it in one pass
// was the bug that made generated documents look broken: an LLM hard-wraps its
// prose, and a per-line renderer turns one paragraph into five ragged ones and
// one blockquote into four stacked rules.
type Block =
  | { kind: "p"; text: string; indent?: number }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; text: string }
  | { kind: "ul2"; text: string }
  | { kind: "task"; done: boolean; text: string }
  | { kind: "ol"; num: string; text: string }
  | { kind: "def"; label: string; value: string }
  | { kind: "lead"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; table: Table };

const RE = {
  fence: /^```/,
  rule: /^(-{3,}|_{3,}|\*{3,})$/,
  heading: /^(#{1,4})\s+(.*)$/,
  quote: /^>\s?(.*)$/,
  task: /^[-*+]\s+\[([ xX])\]\s*(.*)$/,
  bullet: /^([-*+]|\u2022)\s+(.*)$/,
  ordered: /^(\d{1,2})[.)]\s+(.*)$/,
  def: /^\*\*(.{1,42}?)\*\*:\s*(.+)$/,
  lead: /^\*\*(.+)\*\*:?$/,
};

/** Is this line its own block, or prose that belongs to the paragraph above it? */
function structural(s: string): boolean {
  return (
    RE.fence.test(s) ||
    RE.rule.test(s) ||
    RE.heading.test(s) ||
    RE.quote.test(s) ||
    RE.task.test(s) ||
    RE.bullet.test(s) ||
    RE.ordered.test(s) ||
    RE.def.test(s) ||
    RE.lead.test(s) ||
    s.includes("|")
  );
}

function parseBlocks(src: string): Block[] {
  const lines = src.split("\n");
  const trimmed = lines.map((l) => l.trim());
  const out: Block[] = [];

  // Soft-wrapped prose and consecutive `>` lines each accumulate until the next
  // structural line or blank line closes them.
  let para: string[] = [];
  let quote: string[] = [];
  let lastListIndent: number | undefined;

  const flushPara = (): void => {
    if (!para.length) return;
    out.push({ kind: "p", text: para.join(" "), indent: lastListIndent });
    para = [];
  };
  const flushQuote = (): void => {
    if (!quote.length) return;
    out.push({ kind: "quote", text: quote.join(" ") });
    quote = [];
  };
  const flush = (): void => {
    flushPara();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const s = trimmed[i];

    if (!s) {
      flush();
      lastListIndent = undefined;
      continue;
    }

    if (RE.fence.test(s)) {
      flush();
      const block: string[] = [];
      i += 1;
      for (; i < lines.length && !RE.fence.test(trimmed[i]); i++) block.push(lines[i]);
      if (block.length) out.push({ kind: "code", lines: block });
      lastListIndent = undefined;
      continue;
    }

    // A table needs its separator row on the next line to be a table at all,
    // which also keeps a sentence containing a pipe out of the parser.
    if (s.includes("|") && isTableSeparator(trimmed[i + 1] ?? "")) {
      const parsed = parseTable(trimmed, i);
      if (parsed) {
        flush();
        out.push({ kind: "table", table: parsed.table });
        i = parsed.next - 1;
        lastListIndent = undefined;
        continue;
      }
    }

    const q = RE.quote.exec(s);
    if (q) {
      flushPara();
      quote.push(q[1]);
      continue;
    }
    flushQuote();

    if (RE.rule.test(s)) {
      flushPara();
      out.push({ kind: "rule" });
      lastListIndent = undefined;
      continue;
    }

    const h = RE.heading.exec(s);
    if (h) {
      flushPara();
      out.push({ kind: "h", level: Math.min(3, h[1].length), text: h[2] });
      lastListIndent = undefined;
      continue;
    }

    const task = RE.task.exec(s);
    if (task) {
      flushPara();
      out.push({ kind: "task", done: task[1].toLowerCase() === "x", text: task[2] });
      lastListIndent = 18;
      continue;
    }

    // Indentation decides nesting, so this has to be read off the raw line and
    // checked before the flush-left bullet.
    const indent = raw.length - raw.trimStart().length;
    const bullet = RE.bullet.exec(s);
    if (bullet) {
      flushPara();
      if (indent >= 2) {
        out.push({ kind: "ul2", text: bullet[2] });
        lastListIndent = 32;
      } else {
        out.push({ kind: "ul", text: bullet[2] });
        lastListIndent = 16;
      }
      continue;
    }

    const ol = RE.ordered.exec(s);
    if (ol) {
      flushPara();
      out.push({ kind: "ol", num: ol[1], text: ol[2] });
      lastListIndent = 24;
      continue;
    }

    const def = RE.def.exec(s);
    if (def) {
      flushPara();
      out.push({ kind: "def", label: def[1], value: def[2] });
      lastListIndent = undefined;
      continue;
    }

    if (RE.lead.test(s)) {
      flushPara();
      out.push({ kind: "lead", text: s });
      lastListIndent = undefined;
      continue;
    }

    // Plain prose: a continuation of the paragraph or list item above it.
    para.push(s);
    if (!structural(trimmed[i + 1] ?? "")) continue;
    flushPara();
  }
  flush();
  return out;
}

function renderBody(c: Ctx, body: string): void {
  const blocks = parseBlocks(normalizeText(body, c.f.geist));
  let prev: Block["kind"] | undefined;
  const isList = (k?: Block["kind"]) => k === "ul" || k === "ul2" || k === "ol" || k === "task";

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const next = blocks[bi + 1];
    // Space between blocks: list items sit tight together, prose breathes.
    if (prev) {
      if (isList(prev) && isList(block.kind)) c.y -= 2.5;
      else if (block.kind !== "h" && block.kind !== "rule" && prev !== "rule") c.y -= 8;
    }

    switch (block.kind) {
      case "h": {
        const size = H_SIZES[block.level];
        // Keep a heading with what follows it: two lines of anything, or three
        // rows when it opens a spec group, so a group never splits 1/2 across
        // a page break with its heading stranded above the fold.
        const follow =
          next?.kind === "def" || next?.kind === "lead" ? BODY * LEAD * 3 : BODY * LEAD * 2;
        need(c, size * 2.4 + follow);
        c.y -= block.level === 1 ? 15 : 12;
        paragraph(c, block.text, {
          size,
          font: c.f.semibold,
          width: FULL_W,
          lead: 1.28,
          tracking: block.level === 1 ? -0.5 : -0.3,
        });
        if (block.level === 1) {
          c.y -= 5;
          rule(c);
        }
        c.y -= block.level === 1 ? 11 : 6;
        break;
      }

      case "rule":
        c.y -= 9;
        rule(c);
        c.y -= 15;
        break;

      case "quote": {
        const top = c.y;
        paragraph(c, block.text, {
          size: 10.5,
          font: c.f.italic,
          color: C.muted,
          indent: 18,
          width: PROSE_W - 18,
        });
        c.page.drawLine({
          start: { x: M + 2.5, y: c.y + 4 },
          end: { x: M + 2.5, y: top - 2 },
          thickness: 1,
          color: C.borderStrong,
        });
        break;
      }

      case "task":
        need(c, BODY * LEAD);
        checkbox(c, M + 1, c.y - 2.5, block.done);
        paragraph(c, block.text, { indent: 18, color: block.done ? C.muted : C.ink });
        break;

      case "ul":
        need(c, BODY * LEAD);
        c.page.drawCircle({ x: M + 4.2, y: c.y - BODY * 0.62, size: 1.7, color: C.borderStrong });
        paragraph(c, block.text, { indent: 16 });
        break;

      case "ul2":
        need(c, BODY * LEAD);
        c.page.drawLine({
          start: { x: M + 20, y: c.y - BODY * 0.6 },
          end: { x: M + 25.5, y: c.y - BODY * 0.6 },
          thickness: 1,
          color: C.borderStrong,
        });
        paragraph(c, block.text, { indent: 32, size: 10.4, color: C.muted });
        break;

      case "ol": {
        need(c, BODY * LEAD);
        const num = `${block.num}.`;
        // Mono numerals, right-aligned on the period, so 9. and 10. line up.
        draw(c.page, num, {
          x: M + 18 - widthOf(num, c.f.monoMedium, 9.5),
          y: c.y - BODY,
          size: 9.5,
          font: c.f.monoMedium,
          color: C.subtle,
        });
        paragraph(c, block.text, { indent: 24 });
        break;
      }

      case "def": {
        // A spec row: the label holds its weight, the value runs beside it and
        // wraps under itself rather than under the label.
        //
        // Widow control: a group of spec rows breaks as a group. Reserving the
        // next row's height too is what keeps one lonely row from opening the
        // following page.
        need(c, next?.kind === "def" ? BODY * LEAD * 2 + 8 : BODY * LEAD);
        const lw = widthOf(block.label, c.f.semibold, BODY) + 10;
        draw(c.page, block.label, { x: M, y: c.y - BODY, size: BODY, font: c.f.semibold, color: C.ink });
        const value = layoutRuns(inlineTokens(block.value), c.f, BODY, c.f.sans, C.muted, PROSE_W - lw);
        for (const line of value) {
          need(c, BODY * LEAD);
          let cx = M + lw;
          for (const p of line) cx += drawPart(c, p, cx, c.y - BODY);
          c.y -= BODY * LEAD;
        }
        break;
      }

      case "lead":
        // A lead-in belongs to what follows it, never to the bottom of a page.
        need(c, BODY * LEAD * 2 + 8);
        c.y -= 3;
        paragraph(c, block.text, { font: c.f.semibold });
        break;

      case "code": {
        const lh = 9.5 * 1.5;
        const h = block.lines.length * lh + 22;
        need(c, h);
        const top = c.y;
        c.page.drawRectangle({ x: M, y: top - h, width: FULL_W, height: h, color: C.bgSubtle });
        let cy = top - 15;
        for (const l of block.lines) {
          draw(c.page, l.replace(/\s+$/, ""), {
            x: M + 14,
            y: cy - 9.5,
            size: 9.5,
            font: c.f.mono,
            color: C.ink,
          });
          cy -= lh;
        }
        c.y = top - h;
        break;
      }

      case "table":
        drawTable(c, block.table);
        break;

      case "p":
        paragraph(c, block.text, { indent: block.indent ?? 0 });
        break;
    }
    prev = block.kind;
  }
}

// ── the template ──────────────────────────────────────────────────────────
export interface TemplateSpec {
  title: string;
  subtitle?: string;
  body: string;
  figures?: Figure[];
  footer?: string;
}

/** Page numbers need the total, so footers are stamped after layout. */
function stampFooters(doc: PDFDocument, f: Fonts, footer: string): void {
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    page.drawLine({
      start: { x: M, y: FOOT_RULE },
      end: { x: M + FULL_W, y: FOOT_RULE },
      thickness: 1,
      color: C.border,
    });
    const y = FOOT_RULE - 15;
    // Footer note, truncated to whatever still fits beside the page number.
    const counter = `${i + 1} / ${pages.length}`;
    const cw = widthOf(counter, f.mono, 8.5, 0.2);
    let note = footer;
    while (note && widthOf(note, f.sans, 8.5) > FULL_W - cw - 24) note = note.slice(0, -2);
    draw(page, note, { x: M, y, size: 8.5, font: f.sans, color: C.subtle });
    draw(page, counter, { x: M + FULL_W - cw, y, size: 8.5, font: f.mono, color: C.subtle, tracking: 0.2 });
  });
}

/**
 * Render a full document. Returns the page count.
 */
export function renderTemplate(doc: PDFDocument, f: Fonts, spec: TemplateSpec): number {
  const title = normalizeText(spec.title, f.geist).trim() || "Document";
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c: Ctx = { doc, page, y: HEAD_TOP, f, title, pageCount: 1 };

  // Masthead: a 3pt amber bleed rule is the whole identity. Amber never
  // becomes text here — the wordmark is ink.
  page.drawRectangle({ x: M, y: PAGE_H - 46, width: FULL_W, height: 3, color: C.brand });
  draw(page, "plus1", { x: M, y: PAGE_H - 68, size: 11, font: f.semibold, color: C.ink, tracking: -0.2 });
  // Local calendar date, not UTC: a document generated at 8pm Toronto time
  // should not be stamped with tomorrow.
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  draw(page, stamp, {
    x: PAGE_W - M - widthOf(stamp, f.mono, 9, 0.2),
    y: PAGE_H - 68,
    size: 9,
    font: f.mono,
    color: C.subtle,
    tracking: 0.2,
  });

  // Title block
  c.y = PAGE_H - 102;
  paragraph(c, title, { size: 25, font: f.semibold, width: FULL_W, lead: 1.18, tracking: -1 });
  if (spec.subtitle?.trim()) {
    c.y -= 3;
    paragraph(c, normalizeText(spec.subtitle, f.geist), { size: 11, color: C.muted, width: PROSE_W });
  }
  c.y -= 14;
  rule(c);
  c.y -= 22;

  const figures = (spec.figures ?? [])
    .filter((x) => x?.label?.trim() && x?.value?.toString().trim())
    .slice(0, 6)
    .map((x) => ({
      label: normalizeText(String(x.label), f.geist).trim(),
      value: normalizeText(String(x.value), f.geist).trim(),
      note: x.note ? normalizeText(String(x.note), f.geist).trim() : undefined,
    }));
  if (figures.length) figureBand(c, figures);

  renderBody(c, spec.body ?? "");

  stampFooters(
    doc,
    f,
    normalizeText(spec.footer ?? `${title} - generated by plus1`, f.geist),
  );
  return c.pageCount;
}
