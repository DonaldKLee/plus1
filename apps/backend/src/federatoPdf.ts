/**
 * One- or two-page commercial-property indication from a live Federato file.
 * Same Geist + console palette as docTemplate — not Helvetica-on-white.
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DeepDiveResult, RankedSubmission } from "@plus1/protocol";
import { C, PAGE_H, PAGE_W, loadDocFonts, normalizeText, type Fonts } from "./docTemplate.js";

const M = 48;
const RAIL = 8;
const FULL = PAGE_W - M - 40;

const money = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
};

const labelOf = (factor: string) =>
  factor.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function decisionColor(d: string) {
  if (d === "quote") return C.live;
  if (d === "refer") return C.brandText;
  if (d === "investigate") return rgb(0.25, 0.35, 0.55);
  return C.alert;
}

function tierColor(t: string) {
  if (t === "target") return C.live;
  if (t === "acceptable") return rgb(0.35, 0.45, 0.38);
  if (t === "missing") return C.subtle;
  return C.alert;
}

export interface IndicationInput {
  deepDive: DeepDiveResult;
  row?: RankedSubmission;
  broker?: string | null;
}

export async function renderFederatoIndication(input: IndicationInput): Promise<{ bytes: Uint8Array; pages: number; filename: string; title: string }> {
  const { deepDive: d, row, broker } = input;
  const doc = await PDFDocument.create();
  const fonts = await loadDocFonts(doc);
  const title = normalizeText(`${d.accountName} — indication`, fonts.geist);
  doc.setTitle(title);
  doc.setAuthor("plus1");
  doc.setProducer("plus1 × Federato");
  doc.setCreationDate(new Date());

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = paintChrome(page, fonts, d);

  // Hero name + decision stamp
  const name = normalizeText(d.accountName || "Unknown account", fonts.geist);
  const nameSize = name.length > 28 ? 22 : 28;
  page.drawText(name, { x: M, y: y - 6, size: nameSize, font: fonts.semibold, color: C.ink });
  const stamp = d.decision.toUpperCase();
  const stampW = Math.max(86, fonts.semibold.widthOfTextAtSize(stamp, 10) + 20);
  const stampX = PAGE_W - 40 - stampW;
  const sc = decisionColor(d.decision);
  page.drawRectangle({ x: stampX, y: y - 8, width: stampW, height: 22, color: sc });
  page.drawText(stamp, {
    x: stampX + (stampW - fonts.semibold.widthOfTextAtSize(stamp, 10)) / 2,
    y: y - 2,
    size: 10,
    font: fonts.semibold,
    color: rgb(1, 1, 1),
  });
  y -= 36;

  const sub = [
    d.policyNumber ? `Policy ${d.policyNumber}` : null,
    row?.businessType,
    row?.lineOfBusiness,
    broker,
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (sub) {
    page.drawText(normalizeText(sub, fonts.geist), { x: M, y, size: 9, font: fonts.medium, color: C.muted });
    y -= 22;
  }

  // Figure band
  const score = d.factors.reduce((n, f) => n + f.points, 0);
  const max = d.factors.length * 2;
  const cards = [
    { k: "Premium", v: money(row?.premium) },
    { k: "TIV", v: money(row?.tiv) },
    { k: "Score", v: `${score} / ${max}` },
    { k: "Primary", v: (row?.primaryState ?? d.state ?? "—").toUpperCase() },
  ];
  const gap = 10;
  const cardW = (FULL - gap * 3) / 4;
  const bandY = y - 58;
  page.drawRectangle({ x: M - 4, y: bandY - 8, width: FULL + 8, height: 74, color: C.bgSubtle });
  cards.forEach((c, i) => {
    const x = M + i * (cardW + gap);
    page.drawText(c.k.toUpperCase(), { x, y: y - 8, size: 7, font: fonts.medium, color: C.subtle });
    page.drawText(c.v, { x, y: y - 32, size: 16, font: fonts.semibold, color: C.ink });
  });
  y = bandY - 24;

  // Location + recommendation
  const loc = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
  const hazards = d.hazardTags.length ? d.hazardTags.join(", ") : "none tagged";
  y = heading(page, fonts, "The call", y);
  const rec = normalizeText(d.explanation || "No explanation on file.", fonts.geist);
  for (const line of wrap(rec, fonts.sans, 10.5, FULL)) {
    page.drawText(line, { x: M, y, size: 10.5, font: fonts.sans, color: C.ink });
    y -= 15;
  }
  y -= 6;
  page.drawText("Location", { x: M, y, size: 8, font: fonts.medium, color: C.subtle });
  y -= 13;
  page.drawText(normalizeText(loc || "n/a", fonts.geist), { x: M, y, size: 10, font: fonts.sans, color: C.ink });
  y -= 14;
  page.drawText(`Hazards  ${normalizeText(hazards, fonts.geist)}`, { x: M, y, size: 9, font: fonts.sans, color: C.muted });
  y -= 22;

  if (d.contradictionNotes.length) {
    y = heading(page, fonts, "Contradictions", y);
    for (const note of d.contradictionNotes.slice(0, 5)) {
      const lines = wrap(`—  ${normalizeText(note, fonts.geist)}`, fonts.sans, 9.5, FULL);
      for (const line of lines) {
        if (y < 88) {
          page = newPage(doc, fonts, d);
          y = PAGE_H - 72;
        }
        page.drawText(line, { x: M, y, size: 9.5, font: fonts.sans, color: C.alert });
        y -= 13;
      }
    }
    y -= 8;
  }

  y = heading(page, fonts, "Appetite factors", y);
  // table header
  page.drawRectangle({ x: M - 4, y: y - 6, width: FULL + 8, height: 18, color: C.ink });
  page.drawText("FACTOR", { x: M, y: y - 1, size: 7, font: fonts.medium, color: rgb(1, 1, 1) });
  page.drawText("VALUE", { x: M + 168, y: y - 1, size: 7, font: fonts.medium, color: rgb(1, 1, 1) });
  page.drawText("TIER", { x: M + 360, y: y - 1, size: 7, font: fonts.medium, color: rgb(1, 1, 1) });
  y -= 22;

  const factors = [...d.factors].sort((a, b) => a.points - b.points);
  for (const f of factors) {
    if (y < 92) {
      page = newPage(doc, fonts, d);
      y = PAGE_H - 72;
    }
    const tc = tierColor(f.tier);
    page.drawRectangle({ x: M - 4, y: y - 5, width: 3, height: 16, color: tc });
    page.drawText(clip(labelOf(f.factor), fonts.sans, 9, 160), { x: M + 6, y, size: 9, font: fonts.medium, color: C.ink });
    page.drawText(clip(normalizeText(f.value, fonts.geist), fonts.mono, 8.5, 180), {
      x: M + 168,
      y,
      size: 8.5,
      font: fonts.mono,
      color: C.ink,
    });
    const tier = f.tier.replace("_", " ").toUpperCase();
    page.drawText(tier, { x: M + 360, y, size: 8, font: fonts.semibold, color: tc });
    y -= 16;
    const rule = clip(normalizeText(f.rule, fonts.geist), fonts.sans, 8, FULL - 10);
    page.drawText(rule, { x: M + 6, y, size: 8, font: fonts.sans, color: C.subtle });
    y -= 18;
  }

  y -= 6;
  if (y < 120) {
    page = newPage(doc, fonts, d);
    y = PAGE_H - 72;
  }
  y = heading(page, fonts, "Next", y);
  const next =
    d.decision === "quote"
      ? "In appetite. Issue a formal quote subject to the usual binders and inspections."
      : d.decision === "refer"
        ? "Refer to a senior UW. Pull the missing items from the broker before a number goes out."
        : d.decision === "investigate"
          ? "Investigate the contradictions above before anyone talks price."
          : "Out of appetite. Decline citing the red-flag factors — do not quote a price.";
  for (const line of wrap(next, fonts.sans, 10.5, FULL)) {
    page.drawText(line, { x: M, y, size: 10.5, font: fonts.sans, color: C.ink });
    y -= 15;
  }

  const bytes = await doc.save();
  return {
    bytes,
    pages: doc.getPageCount(),
    filename: `${slug(d.accountName)}-indication.pdf`,
    title,
  };
}

function paintChrome(page: PDFPage, fonts: Fonts, d: DeepDiveResult): number {
  page.drawRectangle({ x: 0, y: 0, width: RAIL, height: PAGE_H, color: C.brand });
  page.drawRectangle({ x: 0, y: PAGE_H - 36, width: PAGE_W, height: 36, color: C.ink });
  page.drawText("plus1  x  FEDERATO", { x: M, y: PAGE_H - 22, size: 8, font: fonts.medium, color: C.brand });
  page.drawText("COMMERCIAL PROPERTY INDICATION", {
    x: M + 132,
    y: PAGE_H - 22,
    size: 8,
    font: fonts.medium,
    color: rgb(0.85, 0.85, 0.87),
  });
  const when = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  page.drawText(when, {
    x: PAGE_W - 40 - fonts.mono.widthOfTextAtSize(when, 8),
    y: PAGE_H - 22,
    size: 8,
    font: fonts.mono,
    color: rgb(0.7, 0.7, 0.72),
  });

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 36, color: C.ink });
  page.drawText("Indication only — not a binder. Appetite rules 2025. Grounded in the live Federato file.", {
    x: M,
    y: 16,
    size: 7,
    font: fonts.sans,
    color: rgb(0.7, 0.7, 0.72),
  });
  page.drawText(d.policyNumber || "", {
    x: PAGE_W - 40 - fonts.mono.widthOfTextAtSize(d.policyNumber || " ", 7),
    y: 16,
    size: 7,
    font: fonts.mono,
    color: rgb(0.55, 0.55, 0.58),
  });
  return PAGE_H - 64;
}

function newPage(doc: PDFDocument, fonts: Fonts, d: DeepDiveResult): PDFPage {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  paintChrome(page, fonts, d);
  return page;
}

function heading(page: PDFPage, fonts: Fonts, label: string, y: number): number {
  page.drawText(label.toUpperCase(), { x: M, y, size: 8, font: fonts.semibold, color: C.brandText });
  page.drawLine({
    start: { x: M + fonts.semibold.widthOfTextAtSize(label.toUpperCase(), 8) + 8, y: y + 3 },
    end: { x: M + FULL, y: y + 3 },
    thickness: 0.5,
    color: C.border,
  });
  return y - 16;
}

function clip(s: string, font: PDFFont, size: number, max: number): string {
  if (font.widthOfTextAtSize(s, size) <= max) return s;
  let out = s;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > max) out = out.slice(0, -1);
  return `${out}...`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "indication";
}
