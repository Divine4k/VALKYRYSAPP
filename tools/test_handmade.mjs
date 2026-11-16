// Invoices made by hand in Word before the app existed (the person's own layout): the old .doc file (text + the price table, an
// embedded Excel sheet) and the PDF Word printed of it. Fixture: tools/fixtures/handmade-1-2026.doc (the real one, personal details replaced).
//   node tools/test_handmade.mjs <toolDir>
import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const toolDir = process.argv[2] || new URL("../tool", import.meta.url).pathname;
const core = require(`${toolDir}/invoice-core.js`), T = require(`${toolDir}/invoice-templates.js`), W = require(`${toolDir}/js/docread.js`);
let bad = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c ? "" : "  -> " + JSON.stringify(extra))); if (!c) bad++; };
// days: the 37,5 hours of work at the hour rate (8 hours = 1 day); the 11 travel hours ("Reisuren") are not time worked
const want = { nr: "1-2026", datum: "21/01/2026", client: "Piguillet BV", kvk: "52742938", po: null, sub: 2484, vat: 0, total: 2484, btw: "verlegd", days: 4.6875, hourLines: 1 };
const same = (got) => Object.entries(want).every(([k, v]) => got[k] === v);

// the .doc
const lines = W.docLines(new Uint8Array(fs.readFileSync(new URL("./fixtures/handmade-1-2026.doc", import.meta.url))));
ok(Array.isArray(lines) && lines.includes("Factuur nr: 1-2026.") && lines.includes("Piguillet BV"), ".doc: the text of the Word file", lines);
ok(lines.includes("week: 3 € 46,00 37,5 € 1.725,00") && lines.includes("Total inc, btw € 2.484,00"), ".doc: the embedded Excel price table, amounts as € 1.725,00", lines);
let got = core.parseInvoiceText(lines, T.owners(null)); ok(same(got), ".doc: read as invoice 1-2026", { got, want });
ok(W.docLines(new Uint8Array(100)) === null && W.docLines(new Uint8Array(fs.readFileSync(new URL("./fixtures/handmade-1-2026.doc", import.meta.url))).subarray(0, 600)) !== undefined, "not a Word file / cut off: null or lines, no crash");

// the PDF Word made of it: digits come in pieces, totals say "Total", amounts "2 484,00"
const pdfLines = ["Extreme Building .", "Voorbeeldweg 12a 1234 AB Teststad-Zuid. Tel: 0612345678.", "Factuur aan: Datum: 21 / 1 /20 2 6 .", "Piguillet BV", "Edisonstraat 8",
  "2652 XS Berkel en Rodenrijs", "Kvk nr: 52742938", "BTW nr: NL850577950B01", "Factuur nr: 1 - 20 2 6 .", "Omschrijving Uurtarief Aantal uren Bedrag", "Aangenomen som in",
  "week: 3 € 46,00 37,50 € 1 725,00", "Reisuren € 46,00 11,0 € 506,00", "Toeslag 200% € 92,00", "Delegatie € 30,00", "Diesel € 0,23 1100km € 253,00", "€ 2 484,00",
  "Total € 2 484,00", "Total inc, btw € 2 484,00", "Btw Verlegd.", "Gelieve te betalen binnen 7 tot 14 dagen.", "ING-nr: NL00TEST0123456789.", "BTW nr: NL 000000000B01 KVK: 12345678."];
got = core.parseInvoiceText(pdfLines, T.owners(null)); ok(same(got), "PDF from Word: read as invoice 1-2026", { got, want });

// the same layout saved as .docx: the price table is an embedded workbook there too (here an .xlsx inside the zip)
{
  const JSZip = require("/opt/npm-tools/node_modules/jszip");
  const zip = await JSZip.loadAsync(fs.readFileSync(new URL("./fixtures/handmade-3-2026.docx", import.meta.url)));
  const unxml = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const dl = (xml) => xml.split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unxml(m[1])).join("")).filter(Boolean); // as the app's docxLines
  const text = dl(await zip.file("word/document.xml").async("string")), grids = await W.docxGrids(JSZip, zip);
  ok(grids.length === 1 && W.gridRows(grids[0].grid).includes("week: 3 € 46,00 37,5 € 1.725,00"), ".docx: the embedded workbook is read (amounts as € 1.725,00)", grids.map((g) => [g.name, W.gridRows(g.grid)]));
  ok(core.parseInvoiceText(text, T.owners(null)).total == null, ".docx: without that table the total is not found (so the table is what makes it an invoice)");
  const g3 = core.parseInvoiceText([...text, ...grids.flatMap((g) => W.gridRows(g.grid))], T.owners(null));
  ok(g3.nr === "3-2026" && g3.datum === "04/02/2026" && g3.client === "Piguillet BV" && g3.total === 2484 && g3.btw === "verlegd" && g3.days === 4.6875, ".docx: read as invoice 3-2026", g3);
}

// what a preview of the .doc needs: the header, the text with the table where its object stands, the footer
{
  const P = W.docPreview(new Uint8Array(fs.readFileSync(new URL("./fixtures/handmade-1-2026.doc", import.meta.url)))), at = P.body.findIndex((x) => typeof x !== "string");
  ok(P.header[0] === "Extreme Building ." && P.footer.some((l) => l.startsWith("ING-nr")) && !P.body.includes("Extreme Building ."), ".doc preview: header and footer apart from the text", [P.header, P.footer]);
  ok(at > 0 && P.body[at - 1] === "Factuur nr: 1-2026." && P.body[at + 1] === "Hoogchtend." && P.body[at].grid.some((r) => r.map((c) => c[1]).join("|") === "week: 3|€ 46,00|37,5|€ 1.725,00"), ".doc preview: the table stands between 'Factuur nr' and the closing, its cells apart", P.body.map((x) => (typeof x === "string" ? x : "[table]")));
}

// what counts as time worked on such an invoice: hours at the hour rate and overtime rows; not travel hours, day allowances, fuel
{
  const days = (line) => core.parseInvoiceText(["Factuur nr: 9-2026", "Datum: 01/02/2026", line, "Total € 100,00"], T.owners(null)).days;
  const got = ["week: 5 € 46,00 40 € 1 840,00", "Toeslag 150% € 69,00 8 € 552,00", "Reisuren € 46,00 11,0 € 506,00", "Delegatie € 30,00 5 € 150,00", "Vetkanaal € 40,00 2 € 80,00", "Onshore binnen europa € 55,00 5 € 275,00", "Dagprijs offshore € 450,00 2 € 900,00"].map(days);
  ok(JSON.stringify(got) === JSON.stringify([5, 1, 0, 0, 0, 0, 2]), "days worked: work hours and overtime count; travel hours and day allowances do not; 'Dagprijs offshore' is work", got);
}

// amounts: a space only joins groups of three
const m = (s) => core.parseInvoiceText(["Factuur 5-2026", "Datum 01-02-2026", s], T.owners(null)).total;
ok(m("Totaal € 1 725,00") === 1725 && m("Totaal € 1.725,00") === 1725 && m("TOTAAL INCL. BTW € 12 345,67") === 12345.67, "totals with a space, a dot, or none between thousands");
ok(m("Totaal € 46,00 37") === 46, "a space does not join an amount with the number after it");
// an invoice line whose PO number a Word PDF split up: "PO - 008245" is read as PO-008245
got = core.parseInvoiceText(["Factuur nr: 88-2026", "Datum: 09/11/2026", "PO - 008245 week 45 € 500,00 1 € 500,00", "Totaal € 500,00"], T.owners(null));
ok(/^PO-008245\b/.test(got.po || "") && got.total === 500, "PO - 008245 on an invoice line is read as PO-008245", got);
console.log(bad ? `${bad} FAILED` : "ALL PASS"); process.exit(bad ? 1 : 0);
