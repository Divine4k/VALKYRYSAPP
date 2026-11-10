// Node test of invoice-core.js on a real PO: parse it, then draw the invoice (standard font, no fontkit here).
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const [poPath, toolDir, outPdf] = process.argv.slice(2);
const core = require(`${toolDir}/invoice-core.js`);
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib");
const pdfjs = await import("/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build/pdf.mjs");

const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(poPath)), useSystemFonts: true }).promise;
let lines = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const tc = await (await pdf.getPage(p)).getTextContent();
  lines = lines.concat(core.linesFromTextItems(tc.items));
}
const parsed = core.parsePO(lines);
const invLines = core.invoiceLinesFromPO(parsed);
console.log("PO:", parsed.po, "| besteld:", parsed.orderDate, "| door:", parsed.orderedBy);
console.log("items:", parsed.items.map((i) => `${i.qty} x ${i.unit} ${i.dates.join(",")} @ ${i.price} = ${i.total}`));
console.log("PO total:", parsed.poTotal, "| client KvK:", parsed.kvk, "| client BTW:", parsed.btw);
console.log("dates:", core.poDates(parsed));
console.log("invoice lines:", invLines);
console.log("checks:", core.checkPO(parsed));
console.log("totals verlegd:", core.totals(invLines, "verlegd"), "| 21%:", core.totals(invLines, "21"));

const bytes = await core.renderInvoice(PDFLib, {
  fontkit: null, fonts: { regular: new Uint8Array(fs.readFileSync(`${toolDir}/fonts/Carlito-Regular.ttf`)), bold: new Uint8Array(fs.readFileSync(`${toolDir}/fonts/Carlito-Bold.ttf`)), italic: new Uint8Array(fs.readFileSync(`${toolDir}/fonts/Carlito-Italic.ttf`)) },
  images: { logo: fs.readFileSync(`${toolDir}/img/logo-white.png`), sidebar: fs.readFileSync(`${toolDir}/img/sidebar.png`) },
}, {
  factuurnr: "62-2026", datum: "08/11/2026", betaaltermijn: "14 dagen",
  client: { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" },
  lines: invLines, btw: "verlegd", sender: core.SENDER,
});
fs.writeFileSync(outPdf, bytes);
console.log("wrote", outPdf, bytes.length, "bytes");
