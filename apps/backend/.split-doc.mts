import fs from "node:fs";
import { PDFDocument } from "pdf-lib";

const src = await PDFDocument.load(fs.readFileSync("/tmp/doc-review/sample.pdf"));
for (let i = 0; i < src.getPageCount(); i++) {
  const out = await PDFDocument.create();
  const [p] = await out.copyPages(src, [i]);
  out.addPage(p);
  fs.writeFileSync(`/tmp/doc-review/page-${i + 1}.pdf`, await out.save());
}
console.log("split", src.getPageCount());
