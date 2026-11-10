// Purchase orders drawn like the real Piguillet PO (table with columns, cells that wrap onto a second line), in several variants.
// Usage: node make_po_layouts.mjs <outDir>   -> writes the PDFs and layouts.json (what the true days/amounts per date are)
import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib");
const { PDFDocument, StandardFonts } = PDFLib;
const out = process.argv[2]; fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const money = (n) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2 });
// rows: { qty, nummer: [line, line], desc: [line, line], price, total }   priceAlign: "top" | "middle"
async function make(file, { po, order, rows, priceAlign = "top" }) {
  const doc = await PDFDocument.create(), page = doc.addPage([595, 842]), f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  const T = (t, x, y, size = 9, font = f) => page.drawText(t, { x, y, size, font });
  let y = 790; T("Piguillet", 40, y, 20, b); T("Groep", 40, y - 18, 12, b); T("Inkooporder", 330, y - 80, 28, b);
  T("Aan:", 40, 640, 9, b); T("Valkyrys", 40, 628); T("Harderwijkstraat 115", 40, 616); T("2573ZC 's-gravenhage", 40, 604); T("Afleveradres:", 300, 640, 9, b); T("Aflevernotitie:", 300, 600, 9, b);
  T("Ordernummer", 40, 570, 9, b); T(": " + po, 110, 570, 9, b); T("Levering", 40, 558, 9, b); T(": DDP (Incoterms 2020)", 110, 558);
  T("Besteldatum", 40, 546, 9, b); T(": " + order, 110, 546); T("Leverdatum", 40, 534, 9, b); T(": " + order, 110, 534); T("Besteld door", 40, 522, 9, b); T(": Rosanne Vlot", 110, 522);
  y = 490; ["Aantal", "Nummer", "Omschrijving", "Prijs", "Totaalbedrag"].forEach((h, i) => T(h, [40, 85, 210, 420, 480][i], y, 8, b)); y -= 20;
  let sum = 0;
  for (const r of rows) {
    const h = Math.max(r.nummer.length, r.desc.length), py = priceAlign === "middle" ? y - (h - 1) * 5.5 : y;
    T(String(r.qty), 40, y); r.nummer.forEach((t, i) => T(t, 85, y - i * 11, 8)); r.desc.forEach((t, i) => T(t, 210, y - i * 11, 8));
    T(money(r.price), 410, py, 8); T(money(r.total), 480, py, 8); sum += r.total; y -= h * 11 + 12;
  }
  T("Totaalbedrag inkooporder", 330, y - 4, 9, b); T(money(sum), 485, y - 4, 9, b); T("Alle genoemde prijzen zijn exc. btw", 40, y - 22, 7);
  T("KvK nr. 52742938 BTW nr. NL850577950B01 IBAN NL48 INGB0009237048", 40, 40, 7);
  fs.writeFileSync(`${out}/${file}`, await doc.save());
}
const N1 = ["Externe Diensten - Dagprijs", "(5.00/21.30 ma/vr)"], who = "Przemyslaw Wodecki -";
const day = (d, ref = "LW/2025-03/005512/2", price = 380) => ({ qty: 1, nummer: N1, desc: [`${d} - ${who}`, ref], price, total: price });
const truth = {};
const add = (file, spec, days) => { truth[file] = days; return make(file, spec); };
// A: the layout of the PO in the screenshot (price on the first line of the row)
await add("A-spring-top.pdf", { po: "PO-005637", order: "07-04-2026", rows: ["30-03-2026", "31-03-2026", "01-04-2026", "02-04-2026", "03-04-2026"].map((d) => day(d)) }, { po: "PO-005637", days: ["30-03-2026", "31-03-2026", "01-04-2026", "02-04-2026", "03-04-2026"].map((d) => [d, 1, 380]) });
// B: same, price vertically centred in the 2-line row
await add("B-spring-middle.pdf", { po: "PO-005638", order: "14-04-2026", priceAlign: "middle", rows: ["06-04-2026", "07-04-2026", "08-04-2026"].map((d) => day(d)) }, { po: "PO-005638", days: ["06-04-2026", "07-04-2026", "08-04-2026"].map((d) => [d, 1, 380]) });
// C: a line with a second date in the description (a reference date) -> still one work day
await add("C-two-dates.pdf", { po: "PO-005700", order: "28-04-2026", rows: [{ qty: 1, nummer: N1, desc: [`28-04-2026 - ${who}`, "LW/2025-03/005512/2 t/m 15-05-2026"], price: 380, total: 380 }] }, { po: "PO-005700", days: [["28-04-2026", 1, 380]] });
// D: one line for a whole week, written as a range
await add("D-range.pdf", { po: "PO-005800", order: "08-06-2026", rows: [{ qty: 5, nummer: N1, desc: [`01-06-2026 t/m 05-06-2026 - ${who}`, "LW/2025-03/005512/2"], price: 380, total: 1900 }] }, { po: "PO-005800", days: ["01-06-2026", "02-06-2026", "03-06-2026", "04-06-2026", "05-06-2026"].map((d) => [d, 1, 380]) });
// E: hours: 8 hours of 47,50 on one date
await add("E-hours.pdf", { po: "PO-005900", order: "15-06-2026", rows: [{ qty: 8, nummer: ["Externe Diensten - Uurprijs", "(5.00/21.30 ma/vr)"], desc: [`10-06-2026 - ${who}`, "LW/2025-03/005512/2"], price: 47.5, total: 380 }] }, { po: "PO-005900", days: [["10-06-2026", 1, 380]] });
// F: the same work day on two different POs (a PO that was re-issued under a new number)
await add("F-dup-a.pdf", { po: "PO-006000", order: "22-06-2026", rows: [day("16-06-2026"), day("17-06-2026")] }, { po: "PO-006000", days: [["16-06-2026", 1, 380], ["17-06-2026", 1, 380]] });
await add("F-dup-b.pdf", { po: "PO-006001", order: "23-06-2026", rows: [day("17-06-2026"), day("18-06-2026")] }, { po: "PO-006001", days: [["17-06-2026", 1, 380], ["18-06-2026", 1, 380]] });
// G: half days
await add("G-half.pdf", { po: "PO-006100", order: "01-07-2026", rows: [{ qty: 0.5, nummer: N1, desc: [`29-06-2026 - ${who}`, "LW/2025-03/005512/2"], price: 380, total: 190 }, { qty: 0.5, nummer: N1, desc: [`30-06-2026 - ${who}`, "LW/2025-03/005512/2"], price: 380, total: 190 }] }, { po: "PO-006100", days: [["29-06-2026", 0.5, 190], ["30-06-2026", 0.5, 190]] });
fs.writeFileSync(`${out}/layouts.json`, JSON.stringify(truth, null, 1)); console.log(Object.keys(truth).length, "files");
