// Invoices made by hand in Word before the app existed (the person's own layout): the old .doc file (text + the price table, an
// embedded Excel sheet) and the PDF Word printed of it. Fixture: tools/fixtures/handmade-1-2026.doc (the real one, personal details replaced).
//   node tools/test_handmade.mjs <toolDir>
import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const toolDir = process.argv[2] || new URL("../tool", import.meta.url).pathname;
const core = require(`${toolDir}/invoice-core.js`), T = require(`${toolDir}/invoice-templates.js`), W = require(`${toolDir}/js/docread.js`);
let bad = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c ? "" : "  -> " + JSON.stringify(extra))); if (!c) bad++; };
const want = { nr: "1-2026", datum: "21/01/2026", client: "Piguillet BV", kvk: "52742938", po: null, sub: 2484, vat: 0, total: 2484, btw: "verlegd", days: 6.0625 };
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

// amounts: a space only joins groups of three
const m = (s) => core.parseInvoiceText(["Factuur 5-2026", "Datum 01-02-2026", s], T.owners(null)).total;
ok(m("Totaal € 1 725,00") === 1725 && m("Totaal € 1.725,00") === 1725 && m("TOTAAL INCL. BTW € 12 345,67") === 12345.67, "totals with a space, a dot, or none between thousands");
ok(m("Totaal € 46,00 37") === 46, "a space does not join an amount with the number after it");
console.log(bad ? `${bad} FAILED` : "ALL PASS"); process.exit(bad ? 1 : 0);
