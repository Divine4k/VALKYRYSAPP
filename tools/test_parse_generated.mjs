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
// money formats
for (const [s, v] of [["1.350,00", 1350], ["2,250.00", 2250], ["450.00", 450], ["450,00", 450], ["€ 12.345,67", 12345.67], ["1,234,567.89", 1234567.89]]) { const g = core.parseMoney(s); const ok = g === v; if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", "parseMoney", s, g); }
if (!bad) console.log("ALL PASSED");
process.exit(bad ? 1 : 0);
