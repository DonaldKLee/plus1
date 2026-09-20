/**
 * Intact personal-lines quote PDF. Same Geist console template as the Federato
 * indication — branded Intact, never Federato.
 */
import { randomUUID } from "node:crypto";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { QuoteResult } from "@plus1/brain";
import { stashPdfBytes } from "./docPdf.js";
import { C, PAGE_H, PAGE_W, loadDocFonts, normalizeText, type Fonts } from "./docTemplate.js";

export interface QuoteApplicant {
  name?: string;
  province?: string;
  city?: string;
  vehicle?: string;
  email?: string;
}

const store = new Map<string, { bytes: Uint8Array; at: number }>();
const TTL_MS = 60 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [id, v] of store) if (now - v.at > TTL_MS) store.delete(id);
}

export function getQuotePdf(id: string): Uint8Array | undefined {
  return store.get(id)?.bytes;
}

const M = 48;
const RAIL = 8;
const FULL = PAGE_W - M - 40;
const INTACT = rgb(0.78, 0.11, 0.16);

const money = (n: number) => `$${n.toLocaleString("en-CA")}`;

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

function clip(s: string, font: PDFFont, size: number, max: number): string {
  if (font.widthOfTextAtSize(s, size) <= max) return s;
  let out = s;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > max) out = out.slice(0, -1);
  return `${out}...`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "intact-quote";
}

function appetiteColor(a: QuoteResult["appetite"]) {
  if (a === "standard") return C.live;
  if (a === "refer") return C.brandText;
  return INTACT;
}

function effectColor(e: QuoteResult["factors"][number]["effect"]) {
  if (e === "lowers") return C.live;
  if (e === "raises") return INTACT;
  return C.muted;
}

export interface IntactPdfResult {
  id: string;
  pdfUrl: string;
  shareUrl?: string;
  filename: string;
}

export async function renderQuotePdf(q: QuoteResult, applicant: QuoteApplicant): Promise<IntactPdfResult> {
  gc();
  const doc = await PDFDocument.create();
  const fonts = await loadDocFonts(doc);
  const product = q.product === "car" ? "Car insurance" : "Tenant insurance";
  const who = applicant.name || applicant.vehicle || product;
  const title = normalizeText(`${who} — Intact quote`, fonts.geist);
  const ref = `Q-${randomUUID().slice(0, 8).toUpperCase()}`;

  doc.setTitle(title);
  doc.setAuthor("plus1");
  doc.setProducer("plus1 x Intact");
  doc.setCreationDate(new Date());

  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = paintChrome(page, fonts, q, ref);

  const name = normalizeText(who, fonts.geist);
  const nameSize = name.length > 28 ? 22 : 28;
  page.drawText(name, { x: M, y: y - 6, size: nameSize, font: fonts.semibold, color: C.ink });

  const stamp = q.appetite === "standard" ? "ESTIMATE" : q.appetite === "refer" ? "REFER" : "HIGH RISK";
  const stampW = Math.max(86, fonts.semibold.widthOfTextAtSize(stamp, 10) + 20);
  const stampX = PAGE_W - 40 - stampW;
  const sc = appetiteColor(q.appetite);
  page.drawRectangle({ x: stampX, y: y - 8, width: stampW, height: 22, color: sc });
  page.drawText(stamp, {
    x: stampX + (stampW - fonts.semibold.widthOfTextAtSize(stamp, 10)) / 2,
    y: y - 2,
    size: 10,
    font: fonts.semibold,
    color: rgb(1, 1, 1),
  });
  y -= 36;

  const sub = [product, applicant.province, applicant.city, applicant.vehicle, applicant.email]
    .filter(Boolean)
    .join("  ·  ");
  if (sub) {
    page.drawText(normalizeText(sub, fonts.geist), { x: M, y, size: 9, font: fonts.medium, color: C.muted });
    y -= 22;
  }

  const showPrice = q.appetite === "standard";
  const cards = showPrice
    ? [
        { k: "Annual", v: `${money(q.annualLow)}–${money(q.annualHigh)}` },
        { k: "Monthly", v: `${money(q.monthlyLow)}–${money(q.monthlyHigh)}` },
        { k: "Pay in full", v: money(q.payment.annual) },
        { k: "Coverage", v: q.coverageTier.split(" ")[0] ?? q.coverageTier },
      ]
    : [
        { k: "Appetite", v: q.appetite.replace("_", " ") },
        { k: "Coverage", v: q.coverageTier.split(" ")[0] ?? q.coverageTier },
        { k: "Currency", v: q.currency },
        { k: "Next", v: "Broker" },
      ];
  const gap = 10;
  const cardW = (FULL - gap * 3) / 4;
  const bandY = y - 58;
  page.drawRectangle({ x: M - 4, y: bandY - 8, width: FULL + 8, height: 74, color: C.bgSubtle });
  cards.forEach((c, i) => {
    const x = M + i * (cardW + gap);
    page.drawText(c.k.toUpperCase(), { x, y: y - 8, size: 7, font: fonts.medium, color: C.subtle });
    page.drawText(clip(c.v, fonts.semibold, 14, cardW - 4), {
      x,
      y: y - 32,
      size: 14,
      font: fonts.semibold,
      color: C.ink,
    });
  });
  y = bandY - 24;

  if (showPrice) {
    const pay = normalizeText(
      `Pay annually ${money(q.payment.annual)}, or ${money(q.payment.monthly)}/month (incl. ~${Math.round(q.payment.instalmentFeePct * 100)}% instalment fee). ${q.payment.methods.join(", ")}.`,
      fonts.geist,
    );
    for (const line of wrap(pay, fonts.sans, 9, FULL)) {
      page.drawText(line, { x: M, y, size: 9, font: fonts.sans, color: C.muted });
      y -= 13;
    }
    y -= 10;
  }

  y = heading(page, fonts, "Coverage", y);
  page.drawText(normalizeText(q.coverageTier, fonts.geist), { x: M, y, size: 10.5, font: fonts.medium, color: C.ink });
  y -= 16;
  for (const r of q.recommended) {
    page.drawText(clip(`—  ${normalizeText(r, fonts.geist)}`, fonts.sans, 10, FULL), {
      x: M,
      y,
      size: 10,
      font: fonts.sans,
      color: C.ink,
    });
    y -= 14;
  }
  y -= 8;

  if (q.factors.length) {
    y = heading(page, fonts, "Rating factors", y);
    page.drawRectangle({ x: M - 4, y: y - 6, width: FULL + 8, height: 18, color: C.ink });
    page.drawText("FACTOR", { x: M, y: y - 1, size: 7, font: fonts.medium, color: rgb(1, 1, 1) });
    page.drawText("EFFECT", { x: M + 360, y: y - 1, size: 7, font: fonts.medium, color: rgb(1, 1, 1) });
    y -= 22;
    for (const f of q.factors) {
      const ec = effectColor(f.effect);
      page.drawRectangle({ x: M - 4, y: y - 5, width: 3, height: 16, color: ec });
      page.drawText(clip(normalizeText(f.label, fonts.geist), fonts.medium, 9, 340), {
        x: M + 6,
        y,
        size: 9,
        font: fonts.medium,
        color: C.ink,
      });
      page.drawText(f.effect.toUpperCase(), { x: M + 360, y, size: 8, font: fonts.semibold, color: ec });
      y -= 16;
    }
    y -= 8;
  }

  if (q.assumptions.length) {
    y = heading(page, fonts, "Assumptions", y);
    for (const line of wrap(normalizeText(q.assumptions.join(" · "), fonts.geist), fonts.sans, 9.5, FULL)) {
      page.drawText(line, { x: M, y, size: 9.5, font: fonts.sans, color: C.muted });
      y -= 13;
    }
    y -= 8;
  }

  y = heading(page, fonts, "Next", y);
  const next = q.handoffReason
    ? `${q.handoffReason} Call an Intact broker: 1-866-464-2424.`
    : "Ready to move forward? Book a call with an Intact broker or continue with belairdirect.";
  for (const line of wrap(normalizeText(next, fonts.geist), fonts.sans, 10.5, FULL)) {
    page.drawText(line, { x: M, y, size: 10.5, font: fonts.sans, color: C.ink });
    y -= 15;
  }

  const bytes = await doc.save();
  const filename = `${slug(who)}-intact-quote.pdf`;
  const stored = await stashPdfBytes({
    bytes,
    filename,
    title,
    pages: 1,
  });
  store.set(stored.id, { bytes, at: Date.now() });
  return {
    id: stored.id,
    pdfUrl: stored.pdfUrl,
    shareUrl: stored.shareUrl,
    filename,
  };
}

function paintChrome(page: PDFPage, fonts: Fonts, q: QuoteResult, ref: string): number {
  const kind = q.product === "car" ? "PERSONAL AUTO QUOTE" : "TENANT QUOTE";
  page.drawRectangle({ x: 0, y: 0, width: RAIL, height: PAGE_H, color: INTACT });
  page.drawRectangle({ x: 0, y: PAGE_H - 36, width: PAGE_W, height: 36, color: C.ink });
  page.drawText("plus1  x  INTACT", { x: M, y: PAGE_H - 22, size: 8, font: fonts.medium, color: INTACT });
  page.drawText(kind, {
    x: M + 108,
    y: PAGE_H - 22,
    size: 8,
    font: fonts.medium,
    color: rgb(0.85, 0.85, 0.87),
  });
  const when = new Date().toLocaleDateString("en-CA");
  page.drawText(when, {
    x: PAGE_W - 40 - fonts.mono.widthOfTextAtSize(when, 8),
    y: PAGE_H - 22,
    size: 8,
    font: fonts.mono,
    color: rgb(0.7, 0.7, 0.72),
  });

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 36, color: C.ink });
  const foot = clip(normalizeText(q.disclaimer, fonts.geist), fonts.sans, 7, FULL - 80);
  page.drawText(foot, { x: M, y: 16, size: 7, font: fonts.sans, color: rgb(0.7, 0.7, 0.72) });
  page.drawText(ref, {
    x: PAGE_W - 40 - fonts.mono.widthOfTextAtSize(ref, 7),
    y: 16,
    size: 7,
    font: fonts.mono,
    color: rgb(0.55, 0.55, 0.58),
  });
  return PAGE_H - 64;
}

function heading(page: PDFPage, fonts: Fonts, label: string, y: number): number {
  page.drawText(label.toUpperCase(), { x: M, y, size: 8, font: fonts.semibold, color: INTACT });
  page.drawLine({
    start: { x: M + fonts.semibold.widthOfTextAtSize(label.toUpperCase(), 8) + 8, y: y + 3 },
    end: { x: M + FULL, y: y + 3 },
    thickness: 0.5,
    color: C.border,
  });
  return y - 16;
}
