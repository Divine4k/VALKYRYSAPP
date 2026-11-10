// Reads finished invoices (made by this app, and by the older Word-based design) and prints what the importer would take from them.
import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require(process.argv[2] + "/invoice-core.js");
const pdfjs = await import("/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
for (const f of process.argv.slice(3)) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true }).promise;
  let lines = []; for (let p = 1; p <= pdf.numPages; p++) lines = lines.concat(core.linesFromTextItems((await (await pdf.getPage(p)).getTextContent()).items));
  console.log(f.split("/").slice(-2).join("/"), JSON.stringify(core.parseInvoiceText(lines)));
}
