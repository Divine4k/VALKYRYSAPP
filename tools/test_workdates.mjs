// Core: which work day(s) a PO line is for, and what it is billed per. Usage: node test_workdates.mjs <toolDir> [layoutsDir]
import { createRequire } from "node:module"; import fs from "node:fs";
const require = createRequire(import.meta.url);
const core = require(process.argv[2] + "/invoice-core.js");
let fails = 0; const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); console.log((ok ? "PASS " : "FAIL ") + m + (ok ? "" : "  got " + JSON.stringify(a) + " want " + JSON.stringify(b))); if (!ok) fails++; };
const W = core.workDatesOf;
eq(W("Dagprijs 28-10-2026 - Przemysław Wodecki - TB/2025-08/006531"), ["28-10-2026"], "one date, name and reference after it");
eq(W("Externe Diensten - Dagprijs 30-03-2026 - Przemyslaw Wodecki -"), ["30-03-2026"], "date after the Nummer text");
eq(W("Dagprijs 28-04-2026 - Przemyslaw Wodecki - ref 15-05-2026"), ["28-04-2026"], "a later date in the text is not a work day");
eq(W("Dagprijs 28-04-2026 - Wodecki t/m 15-05-2026"), ["28-04-2026"], "a name between the dates: no range");
eq(W("01-06-2026 t/m 05-06-2026 - Wodecki"), ["01-06-2026", "02-06-2026", "03-06-2026", "04-06-2026", "05-06-2026"], "t/m range = the five work days");
eq(W("Dagprijs 01-06-2026 - 05-06-2026 - Wodecki"), ["01-06-2026", "02-06-2026", "03-06-2026", "04-06-2026", "05-06-2026"], "dash range");
eq(W("29-06-2026 tot 03-07-2026"), ["29-06-2026", "30-06-2026", "01-07-2026", "02-07-2026", "03-07-2026"], "range over a month end");
eq(W("03-07-2026 t/m 12-07-2026"), ["03-07-2026", "06-07-2026", "07-07-2026", "08-07-2026", "09-07-2026", "10-07-2026"], "weekends are left out of a range");
eq(W("29-10-2026, 30-10-2026 en 31-10-2026"), ["29-10-2026", "30-10-2026", "31-10-2026"], "a list of dates");
eq(W("04-07-2026 t/m 05-07-2026"), ["04-07-2026", "05-07-2026"], "a range of only a weekend keeps its dates");
eq(W("05-06-2026 t/m 01-06-2026"), ["05-06-2026"], "backwards range: just the first");
eq(W("01-01-2026 t/m 31-12-2026"), ["01-01-2026"], "a year-long range is not expanded");
eq(W("31-02-2026 - Wodecki"), [], "an impossible date is no date");
eq(W("geen datum hier"), [], "no date");
eq(W("29-02-2028 - Wodecki"), ["29-02-2028"], "leap day");
const K = core.unitKind;
eq([K("Externe Diensten - Dagprijs 30-03-2026"), K("Dagprijs 28-10-2026"), K("Uurprijs 10-06-2026"), K("Externe Diensten - Uurprijs"), K("Reiskosten 12-05-2026"), K("")], ["day", "day", "hour", "hour", "other", "other"], "unit kinds");
const E = core.dayEquivalent;
eq([E({ qty: 1, kind: "day" }, true), E({ qty: 8, kind: "hour" }, true), E({ qty: 4, kind: "hour" }, false), E({ qty: 1, kind: "other" }, true), E({ qty: 1, kind: "other" }, false), E({ qty: 0.5, kind: "day" }, false)], [1, 1, 0.5, 1, 0, 0.5], "day equivalents");
const L = core.lineDays;
eq([L(380, 1, "PO-1"), L(450, 2.5, "PO-2"), L(57, 8, "PO-006476"), L(43.43, 15.5, "PO-x"), L(30, 18, "Uren"), L(99.99, 8, ""), L(100, 1, ""), L(380, 0.5, ""), L(0.23, 150, "Reiskosten"), L(380, 0, ""), L(570, 1, "PO-006551")], [1, 2.5, 1, 1.9375, 2.25, 1, 1, 0.5, 0, 0, 1], "invoice line days: day rates as written, hour rates /8, costs 0");
eq([core.isHourLine(57, "PO-1"), core.isHourLine(380, "PO-1"), core.isHourLine(0.23, "Reiskosten km"), core.isHourLine(0, "")], [true, false, false, false], "hour line detection");
if (process.argv[3]) { // the drawn layouts: what the parser reads from real PDF text
  const pdfjs = await import("/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build/pdf.min.mjs"); const dir = process.argv[3];
  const read = async (f) => { const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(dir + "/" + f)), useSystemFonts: true }).promise; let l = []; for (let p = 1; p <= pdf.numPages; p++) l = l.concat(core.linesFromTextItems((await (await pdf.getPage(p)).getTextContent()).items)); return core.parsePO(l); };
  const A = await read("A-spring-top.pdf"); eq(A.items.map((i) => i.work), [["30-03-2026"], ["31-03-2026"], ["01-04-2026"], ["02-04-2026"], ["03-04-2026"]], "layout A: one work date per line");
  eq(A.items.map((i) => i.kind), ["day", "day", "day", "day", "day"], "layout A: day price");
  const D = await read("D-range.pdf"); eq([D.items[0].qty, D.items[0].work.length], [5, 5], "layout D: 5 days over 5 work dates");
  const Ee = await read("E-hours.pdf"); eq([Ee.items[0].kind, Ee.items[0].qty, Ee.items[0].work], ["hour", 8, ["10-06-2026"]], "layout E: hours");
}
console.log(fails ? `${fails} FAILED` : "ALL PASSED"); process.exit(fails ? 1 : 0);
