/**
 * Render a quote as a one-page PDF summary and hold it in memory so the dashboard
 * (or an email) can hand it to the customer. The tangible end-artifact of the
 * quoting flow — see INTACT_MCP_LLD.md §9.
 */
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { QuoteResult } from "@plus1/brain";

export interface QuoteApplicant {
  name?: string;
  province?: string;
  vehicle?: string; // "2020 Toyota Corolla"
  email?: string;
}

const store = new Map<string, { bytes: Uint8Array; at: number }>();
const TTL_MS = 60 * 60 * 1000; // an hour is plenty for a demo

function gc() {
  const now = Date.now();
  for (const [id, v] of store) if (now - v.at > TTL_MS) store.delete(id);
}

export function getQuotePdf(id: string): Uint8Array | undefined {
  return store.get(id)?.bytes;
}

const money = (n: number) => `$${n.toLocaleString("en-CA")}`;

export async function renderQuotePdf(q: QuoteResult, applicant: QuoteApplicant): Promise<string> {
  gc();
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.09, 0.11);
  const muted = rgb(0.4, 0.4, 0.45);
  const brand = rgb(0.86, 0.12, 0.12); // Intact red
  const M = 56;
  let y = 792 - M;

  const text = (s: string, x: number, yy: number, size = 11, f = font, color = ink) =>
    page.drawText(s, { x, y: yy, size, font: f, color });

  // header
  text("plus1 × Intact", M, y, 20, bold, brand);
  text("Insurance quote — estimate", M, y - 22, 12, font, muted);
  const ref = `Q-${randomUUID().slice(0, 8).toUpperCase()}`;
  text(ref, 612 - M - bold.widthOfTextAtSize(ref, 11), y, 11, bold);
  text(new Date().toLocaleDateString("en-CA"), 612 - M - font.widthOfTextAtSize(new Date().toLocaleDateString("en-CA"), 10), y - 16, 10, font, muted);
  y -= 52;
  page.drawLine({ start: { x: M, y }, end: { x: 612 - M, y }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });
  y -= 26;

  // applicant
  const product = q.product === "car" ? "Car insurance" : "Tenant insurance";
  text(product, M, y, 15, bold);
  y -= 20;
  const who = [applicant.name, applicant.province, applicant.vehicle].filter(Boolean).join(" · ");
  if (who) { text(who, M, y, 11, font, muted); y -= 22; } else y -= 4;

  // price block
  text("Estimated premium", M, y, 10, bold, muted);
  y -= 22;
  text(`${money(q.annualLow)}–${money(q.annualHigh)} / year`, M, y, 22, bold);
  y -= 18;
  text(`Pay annually ${money(q.payment.annual)}, or ${money(q.payment.monthly)}/month (incl. ~${Math.round(q.payment.instalmentFeePct * 100)}% instalment fee).`, M, y, 10, font, muted);
  y -= 16;
  text(`Payment methods: ${q.payment.methods.join(", ")}.`, M, y, 10, font, muted);
  y -= 30;

  // coverage
  text(`Coverage: ${q.coverageTier}`, M, y, 11, bold);
  y -= 20;
  for (const r of q.recommended) { text(`•  ${r}`, M + 6, y, 11); y -= 16; }
  y -= 10;

  // why / assumptions
  if (q.factors.length) {
    text("Main rating factors", M, y, 10, bold, muted); y -= 16;
    text(q.factors.map((f) => f.label).join(" · "), M + 6, y, 10, font, muted); y -= 22;
  }
  if (q.assumptions.length) {
    text("Assumptions", M, y, 10, bold, muted); y -= 16;
    for (const line of wrap(`${q.assumptions.join(", ")}.`, 92)) { text(line, M + 6, y, 10, font, muted); y -= 14; }
    y -= 10;
  }

  // next step + appetite
  if (q.appetite !== "standard" && q.handoffReason) {
    text("Next step", M, y, 11, bold, brand); y -= 16;
    for (const line of wrap(q.handoffReason, 92)) { text(line, M + 6, y, 10, font, ink); y -= 14; }
    text("Call an Intact broker: 1-866-464-2424", M + 6, y, 10, bold); y -= 20;
  } else {
    text("Next step", M, y, 11, bold); y -= 16;
    text("Ready to move forward? Book a call with a broker or continue with belairdirect.", M + 6, y, 10, font, muted); y -= 20;
  }

  // disclaimer footer
  y = M + 24;
  page.drawLine({ start: { x: M, y }, end: { x: 612 - M, y }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });
  y -= 14;
  for (const line of wrap(q.disclaimer, 100)) { text(line, M, y, 8, font, muted); y -= 10; }

  const bytes = await doc.save();
  const id = randomUUID();
  store.set(id, { bytes, at: Date.now() });
  return id;
}

/** naive width-based wrap for the fixed-width Helvetica lines above */
function wrap(s: string, max: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { lines.push(cur.trim()); cur = w; }
    else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}
