// Builds a folder of finished invoices (PDF made with the app's renderer, one Word-only, plus files that are not invoices) and expected.json with the true totals.
import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const [toolDir, outDir] = process.argv.slice(2);
const core = require(toolDir + "/invoice-core.js"), { buildDocx } = require(toolDir + "/invoice-docx.js");
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib"), docx = require("/home/claude/.npm-global/lib/node_modules/docx");
const rd = (f) => fs.readFileSync(`${toolDir}/img/${f}`);
const images = { logo: rd("logo-white.png"), sidebar: rd("sidebar.png") };
const piguillet = { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" };
const other = { name: "Andere Klant B.V.", street: "Straat 1", city: "1234 AB Plaats", kvk: "12345678", btw: "NL123456789B01" };
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir + "/2025", { recursive: true });
const inv = []; let n25 = 0, n26 = 0;
const mk = (y, mo, d, days, rate, btw = "verlegd", client = piguillet) => { const nr = y === 2025 ? ++n25 : ++n26; inv.push({ nr: `${nr}-${y}`, datum: `${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${y}`, btw, client, lines: [{ desc: "PO-" + (100000 + inv.length), tarief: rate, aantal: days }], y, mo }); };
for (let mo = 1; mo <= 12; mo++) { mk(2025, mo, 5 + mo, 8 + mo, 450); if (mo % 3 === 0) mk(2025, mo, 25, 5, 450); }   // 16 invoices in 2025
for (let mo = 1; mo <= 10; mo++) mk(2026, mo, 10 + mo, 10 + (mo % 4), 450 + (mo > 6 ? 25 : 0), mo === 4 ? "21" : "verlegd", mo === 6 ? other : piguillet); // 10 in 2026
const wordOnly = { nr: "11-2026", datum: "03/11/2026", btw: "verlegd", client: piguillet, lines: [{ desc: "PO-900001", tarief: 475, aantal: 4 }], y: 2026, mo: 11 };
inv.push(wordOnly);
const files = [];
for (const c of inv) {
  const data = { factuurnr: c.nr, datum: c.datum, betaaltermijn: "14 dagen", client: c.client, lines: c.lines, btw: c.btw, sender: core.SENDER };
  if (c === wordOnly) { fs.writeFileSync(`${outDir}/VALKYRYS ${c.nr}.docx`, await buildDocx(docx, { logo: images.logo, logoW: 1365, logoH: 318, accent: rd("accent.png"), background: rd("background.png"), footGap: 1500 }, data, core)); continue; }
  const bytes = await core.renderInvoice(PDFLib, { fontkit: null, fonts: null, images }, data);
  const name = c.nr === "3-2025" ? "oude factuur zonder nummer.pdf" : `VALKYRYS ${c.nr}.pdf`;   // one file whose NAME has no number
  fs.writeFileSync(`${outDir}/${c.y === 2025 && c.mo <= 6 ? "2025/" : ""}${name}`, bytes);
  if (c.nr === "5-2025") fs.writeFileSync(`${outDir}/VALKYRYS ${c.nr} (kopie).pdf`, bytes);   // a copy: counts once
}
// a PDF + Word pair: only counted once
const pair = inv[20]; fs.writeFileSync(`${outDir}/VALKYRYS ${pair.nr}.docx`, await buildDocx(docx, { logo: images.logo, logoW: 1365, logoH: 318, accent: rd("accent.png"), background: rd("background.png"), footGap: 1500 }, { factuurnr: pair.nr, datum: pair.datum, betaaltermijn: "14 dagen", client: pair.client, lines: pair.lines, btw: pair.btw, sender: core.SENDER }, core));
fs.copyFileSync(process.argv[4], `${outDir}/PO-008148.pdf`);            // a purchase order: not an invoice
fs.writeFileSync(`${outDir}/kapot.pdf`, "this is not a pdf");              // damaged file
fs.writeFileSync(`${outDir}/notities.txt`, "x");                           // ignored altogether
const exp = { count: inv.length, unread: ["PO-008148.pdf", "kapot.pdf"], years: {} };
for (const c of inv) { const t = core.totals(c.lines, c.btw); const y = (exp.years[c.y] ||= { n: 0, sub: 0, vat: 0, total: 0, days: 0 }); y.n++; y.sub = core.round2(y.sub + t.sub); y.vat = core.round2(y.vat + t.vat); y.total = core.round2(y.total + t.total); y.days += c.lines[0].aantal; }
fs.writeFileSync(outDir + "-expected.json", JSON.stringify(exp, null, 1)); console.log(JSON.stringify(exp)); console.log(fs.readdirSync(outDir).length, "entries in", outDir);
