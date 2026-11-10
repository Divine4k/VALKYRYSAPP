// Generates invoices with the app's own renderer (several shapes) and checks the importer reads back exactly what went in.
import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const toolDir = process.argv[2];
const core = require(toolDir + "/invoice-core.js");
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib");
const pdfjs = await import("/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const images = { logo: fs.readFileSync(`${toolDir}/img/logo-white.png`), sidebar: fs.readFileSync(`${toolDir}/img/sidebar.png`) };
const client = { name: "Andere Klant B.V.", street: "Straat 1", city: "1234 AB Plaats", kvk: "12345678", btw: "NL123456789B01" };
const cases = [
  { nr: "123-2026", datum: "01/02/2026", btw: "21", client, lines: [{ desc: "PO-100001", tarief: 450, aantal: 2.5 }, { desc: "PO-100002", tarief: 475.5, aantal: 10 }] },
  { nr: "7-2025", datum: "31/12/2025", btw: "verlegd", client, lines: [{ desc: "PO-200001", tarief: 450, aantal: 22 }, { desc: "PO-200002", tarief: 450, aantal: 21 }] },
  { nr: "8-2025", datum: "05/01/2025", btw: "9", client, lines: [{ desc: "PO-300001", tarief: 1234.56, aantal: 1 }] },
  // hours: a Saturday of 8 hours at 57 is 1 day, not 8; 15,5 hours at 43,43 is under 2 days; travel costs are no days
  { nr: "9-2026", datum: "22/06/2026", btw: "verlegd", client, lines: [{ desc: "PO-006344", tarief: 380, aantal: 5 }, { desc: "PO-006476", tarief: 57, aantal: 8 }, { desc: "PO-006552", tarief: 57, aantal: 8 }] },
  { nr: "1-2026", datum: "15/01/2026", btw: "verlegd", client, lines: [{ desc: "Uren januari", tarief: 43.43, aantal: 15.5 }] },
  { nr: "2-2026", datum: "16/02/2026", btw: "verlegd", client, lines: [{ desc: "PO-100001", tarief: 450, aantal: 2 }, { desc: "Reiskosten km", tarief: 0.23, aantal: 150 }] },
];
let bad = 0;
for (const c of cases) {
  const data = { factuurnr: c.nr, datum: c.datum, betaaltermijn: "14 dagen", client: c.client, lines: c.lines, btw: c.btw, sender: core.SENDER };
  const bytes = await core.renderInvoice(PDFLib, { fontkit: null, fonts: null, images }, data);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  let lines = []; for (let p = 1; p <= pdf.numPages; p++) lines = lines.concat(core.linesFromTextItems((await (await pdf.getPage(p)).getTextContent()).items));
  const got = core.parseInvoiceText(lines), t = core.totals(c.lines, c.btw), days = c.lines.reduce((a, l) => a + core.lineDays(l.tarief, l.aantal, l.desc), 0);
  const want = { nr: c.nr, datum: c.datum, client: c.client.name, kvk: c.client.kvk, sub: t.sub, vat: t.vat, total: t.total, btw: c.btw, days };
  const okk = Object.entries(want).every(([k, v]) => got[k] === v);
  if (!okk) bad++;
  console.log(okk ? "PASS" : "FAIL", c.nr, okk ? "" : JSON.stringify({ got, want }));
}
// ---- the second design (Extreme Building): PDF and Word, read back the same way
const T = require(toolDir + "/invoice-templates.js");
const JSZip = require("/opt/npm-tools/node_modules/jszip");
const docx = require("/home/claude/.npm-global/lib/node_modules/docx"), InvoiceDocx = require(toolDir + "/invoice-docx.js");
const rd = (p) => new Uint8Array(fs.readFileSync(`${toolDir}/${p}`));
const xAssets = { fontkit: null, fonts: { regular: rd("fonts/Carlito-Regular.ttf"), bold: rd("fonts/Carlito-Bold.ttf"), italic: rd("fonts/Carlito-Italic.ttf") },
  images: { logo: rd("img/logo-white.png"), sidebar: rd("img/sidebar.png"), extremeLogo: rd("img/extreme-logo.png"), extremeEmblem: rd("img/extreme-emblem.png") },
  docx: { logo: rd("img/logo-white.png"), logoW: 1365, logoH: 318, accent: rd("img/accent.png"), background: rd("img/background.png") }, extremeDocx: rd("templates/extreme.docx") };
const mine = { name: "Extreme Building", person: "J. Jansen", street: "Voorbeeldstraat 12", city: "1234 AB Teststad", phone: "0612345678", email: "info@extreme.example", iban: "NL91 ABNA 0417 1643 00", btw: "NL123456789B01", kvk: "87654321" };
const piguillet = { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" };
const unxml = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); // same as the app
const docxLines = (xml) => xml.split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unxml(m[1])).join("")).filter(Boolean);
const xcases = [
  { nr: "62-2026", datum: "09/11/2026", btw: "verlegd", client: piguillet, lines: [{ desc: "PO-008148", tarief: 450, aantal: 3 }] },
  { nr: "63-2026", datum: "10/11/2026", btw: "21", client: piguillet, lines: [{ desc: "PO-008151", tarief: 450, aantal: 3 }, { desc: "PO-008160", tarief: 475.5, aantal: 10 }] },
  { nr: "64-2026", datum: "11/11/2026", btw: "verlegd", client: piguillet, lines: [{ desc: "PO-006552", tarief: 57, aantal: 8 }, { desc: "PO-006344", tarief: 380, aantal: 5 }] },
  { nr: "65-2026", datum: "12/11/2026", btw: "9", client: { name: "Andere Klant B.V.", street: "Straat 1", city: "1234 AB Plaats", kvk: "12345678", btw: "NL123456789B02" }, lines: [{ desc: "PO-100001", tarief: 1234.56, aantal: 1 }] },
  // a client without a KVK: the sender's own KVK in the footer must not be taken for it
  { nr: "66-2026", datum: "13/11/2026", btw: "verlegd", client: { name: "Particulier Jansen", street: "Straat 2", city: "1111 AA Dorp", kvk: "", btw: "" }, lines: [{ desc: "PO-100002", tarief: 450, aantal: 2 }], kvk: null },
];
for (const c of xcases) {
  const sender = T.forRender(mine);
  const data = { template: "extreme", factuurnr: c.nr, datum: c.datum, betaaltermijn: "14 dagen", client: c.client, lines: c.lines, btw: c.btw, sender };
  const t = core.totals(c.lines, c.btw), days = c.lines.reduce((a, l) => a + core.lineDays(l.tarief, l.aantal, l.desc), 0);
  const want = { nr: c.nr, datum: c.datum, client: c.client.name, kvk: c.kvk === undefined ? c.client.kvk : c.kvk, sub: t.sub, vat: t.vat, total: t.total, btw: c.btw, days };
  const check = (what, got) => { const okk = Object.entries(want).every(([k, v]) => got[k] === v); if (!okk) bad++; console.log(okk ? "PASS" : "FAIL", "extreme", what, c.nr, okk ? "" : JSON.stringify({ got, want })); };
  const bytes = await T.renderPdf(PDFLib, xAssets, data, core);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  let lines = []; for (let p = 1; p <= pdf.numPages; p++) lines = lines.concat(core.linesFromTextItems((await (await pdf.getPage(p)).getTextContent()).items));
  check("pdf", core.parseInvoiceText(lines, T.owners(mine)));
  const word = await T.buildWord({ docx, InvoiceDocx, JSZip }, xAssets, data, core);
  const zip = await JSZip.loadAsync(word);
  check("word", core.parseInvoiceText(docxLines(await zip.file("word/document.xml").async("string")), T.owners(mine)));
}

// money formats
for (const [s, v] of [["1.350,00", 1350], ["2,250.00", 2250], ["450.00", 450], ["450,00", 450], ["€ 12.345,67", 12345.67], ["1,234,567.89", 1234567.89]]) { const g = core.parseMoney(s); const ok = g === v; if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", "parseMoney", s, g); }
if (!bad) console.log("ALL PASSED");
process.exit(bad ? 1 : 0);
