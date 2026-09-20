import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { loadDocFonts, renderTemplate } from "./src/docTemplate.js";
import zlib from "node:zlib";

const doc = await PDFDocument.create();
const f = await loadDocFonts(doc);
renderTemplate(doc, f, {
  title: "T",
  body: `1. Underwriting accepted the 2023 claim as not-at-fault, so the surcharge came off.`,
});
const bytes = await doc.save();
fs.writeFileSync("/tmp/doc-review/dbg.pdf", bytes);

// Dump the page content stream so the Tj / Td operators are visible.
const raw = Buffer.from(bytes);
const txt = raw.toString("latin1");
const streams = [...txt.matchAll(/stream\r?\n([\s\S]*?)endstream/g)];
for (const s of streams) {
  const buf = Buffer.from(s[1], "latin1");
  let body = buf;
  try {
    body = zlib.inflateSync(buf);
  } catch {}
  const str = body.toString("latin1");
  if (str.includes("Tj") || str.includes("TJ")) {
    const ops = str.split("\n").filter((l) => /T[djJfmw*]|Tc|Td/.test(l));
    console.log(ops.slice(0, 60).join("\n"));
    break;
  }
}
