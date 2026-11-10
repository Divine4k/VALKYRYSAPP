// Builds a folder of purchase order PDFs shaped like the real Piguillet PO (same text lines), plus files that are no POs. Writes <out>-items.json with every PO line.
import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const [toolDir, outDir] = process.argv.slice(2);
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib"), core = require(toolDir + "/invoice-core.js");
const { PDFDocument, StandardFonts } = PDFLib;
const money = (n) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2 });
const POS = [
  { po: "PO-100008", order: "10-11-2025", kvk: "52742938", items: [["17-11-2025", 450], ["18-11-2025", 450]] },
  { po: "PO-100009", order: "28-10-2025", kvk: "52742938", items: [["03-11-2025", 450]] },
  { po: "PO-100001", order: "29-12-2025", kvk: "52742938", items: [["29-12-2025", 450], ["30-12-2025", 450], ["31-12-2025", 450]] },
  { po: "PO-100002", order: "05-01-2026", kvk: "52742938", items: [["05-01-2026", 450], ["06-01-2026", 450], ["07-01-2026", 450], ["08-01-2026", 450], ["09-01-2026", 450]] },
  { po: "PO-100003", order: "28-01-2026", kvk: "52742938", items: [["29-01-2026", 450], ["30-01-2026", 450], ["02-02-2026", 450], ["03-02-2026", 450]] },
  { po: "PO-100004", order: "09-03-2026", kvk: "52742938", items: [["10-03-2026", 475], ["11-03-2026", 475]] },
  { po: "PO-100007", order: "10-04-2026", kvk: "12345678", items: [["14-04-2026", 500]] },
  { po: "PO-100005", order: "30-10-2026", kvk: "52742938", items: [["02-11-2026", 450], ["03-11-2026", 450], ["04-11-2026", 450]] },
  { po: "PO-100006", order: "06-11-2026", kvk: "52742938", items: [["09-11-2026", 450], ["10-11-2026", 450]] },
];
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir + "/archief", { recursive: true });
async function makePdf(lines) {
  const doc = await PDFDocument.create(), page = doc.addPage([595, 842]), f = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((t, i) => page.drawText(t, { x: 40, y: 800 - i * 18, size: 10, font: f }));
  return doc.save();
}
const items = [];
for (const p of POS) {
  const total = p.items.reduce((a, [, pr]) => a + pr, 0);
  const lines = ["Piguillet", "Groep", "Inkooporder Inkooporder", "Aan: Afleveradres:", "Valkyrys", "Harderwijkstraat 115", "2573ZC 's-gravenhage", "Aflevernotitie:",
    `Ordernummer : ${p.po}`, "Levering : DDP (Incoterms 2020)", `Besteldatum : ${p.order}`, `Leverdatum : ${p.order}`, "Besteld door : Annelies Hartman-Kuivenhoven",
    "Aantal Nummer Omschrijving Prijs Totaalbedrag",
    ...p.items.map(([d, pr]) => `1 Dagprijs ${d} - Przemyslaw Wodecki - TB/2025-08/006531 ${money(pr)} ${money(pr)}`),
    `Totaalbedrag inkooporder ${money(total)}`, "Alle genoemde prijzen zijn exc. btw", "Facturatievoorwaarden:",
    `KvK nr. ${p.kvk} BTW nr. NL850577950B01 IBAN NL48 INGB0009237048`];
  const bytes = await makePdf(lines);
  const dir = p.order.endsWith("2025") ? outDir + "/archief" : outDir;
  fs.writeFileSync(`${dir}/${p.po}.pdf`, bytes);
  if (p.po === "PO-100002") fs.writeFileSync(`${outDir}/kopie van ${p.po}.pdf`, bytes);   // same PO twice: counts once
  for (const [d, pr] of p.items) items.push({ po: p.po, order: p.order, date: d, price: pr, kvk: p.kvk });
}
// not purchase orders: an invoice made by the app, and a damaged file
const images = { logo: fs.readFileSync(`${toolDir}/img/logo-white.png`), sidebar: fs.readFileSync(`${toolDir}/img/sidebar.png`) };
fs.writeFileSync(`${outDir}/factuur 62-2026.pdf`, await core.renderInvoice(PDFLib, { fontkit: null, fonts: null, images }, { factuurnr: "62-2026", datum: "09/11/2026", betaaltermijn: "14 dagen", client: { name: "Piguillet BV", street: "a", city: "b", kvk: "52742938", btw: "NL85" }, lines: [{ desc: "PO-008148", tarief: 450, aantal: 3 }], btw: "verlegd", sender: core.SENDER }));
fs.writeFileSync(`${outDir}/kapot.pdf`, "no pdf");
fs.writeFileSync(`${outDir}-items.json`, JSON.stringify({ items, unread: ["factuur 62-2026.pdf", "kapot.pdf"], poCount: POS.length }, null, 1));
console.log(POS.length, "POs,", items.length, "lines,", fs.readdirSync(outDir).length, "entries");
