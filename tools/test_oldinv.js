// Invoices a person made by hand in Word before the app (their own layout, see tools/test_handmade.mjs), in the invoice folder of a new install:
// an old .doc with the price table as an embedded Excel sheet, the same layout saved as .docx, file names like "Extreme building 1- 2026".
// They are read (statistics, numbering), listed in Documents, can be looked at and deleted. The PO folder also holds PDFs that are no POs.
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { tmp, goTab, seedProfile } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const HOME = tmp("el-appdata-old"), INV = tmp("old-inv"), POF = tmp("old-po"), FIX = path.join(__dirname, "fixtures");
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 150)); } return false; };
(async () => {
  for (const d of [HOME, INV, POF]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
  const doc1 = fs.readFileSync(path.join(FIX, "handmade-1-2026.doc"));
  fs.writeFileSync(path.join(INV, "Extreme building 1- 2026.doc"), doc1);
  // the same invoice with another number and date (same length, so the file stays a valid .doc)
  let doc2 = doc1; for (const [a, b] of [["1-2026.", "2-2026."], ["21/1/2026", "28/1/2026"]]) for (const enc of ["latin1", "utf16le"]) { let i; const A = Buffer.from(a, enc), B = Buffer.from(b, enc); doc2 = Buffer.from(doc2); while ((i = doc2.indexOf(A)) >= 0) B.copy(doc2, i); }
  fs.writeFileSync(path.join(INV, "Extreme building 2- 2026.doc"), doc2);
  fs.copyFileSync(path.join(FIX, "handmade-3-2026.docx"), path.join(INV, "Extreme building 3- 2026.docx"));
  fs.copyFileSync(process.argv[3], path.join(POF, "PO-008148.pdf"));
  fs.writeFileSync(path.join(POF, "1+2 Jaarrekening 2023 Extreme Building.pdf"), "%PDF-1.4\n% not a purchase order\n"); // other PDFs kept in the same folder
  fs.writeFileSync(path.join(POF, "Polis aansprakelijkheid.pdf"), "%PDF-1.4\n% not a purchase order\n");
  fs.writeFileSync(path.join(POF, "PO-999999.pdf"), "%PDF-1.4\n% damaged\n");                                        // looks like a PO, cannot be read
  seedProfile(HOME, { folder: INV, poFolder: POF });
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME } });
  await app.evaluate(({ shell }) => { const f = process.mainModule.require("fs"); globalThis.__trash = []; shell.trashItem = async (p) => { globalThis.__trash.push(p); f.rmSync(p); }; });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 950 }); await page.waitForSelector("#pick", { state: "attached" });
  await page.waitForFunction(() => state.folderScanned && !state.scan && state.poChecked && !state.poScan && state.poScanSig === state.poSig, null, { timeout: 60000 }); await page.waitForTimeout(500);

  // read: number, date, client, amount; days = the hours worked / 8 (travel hours not)
  const inv = await page.evaluate(() => state.folderInvoices.map((i) => [i.factuurnr, i.datum, i.client.name, i.amounts.total, i.amounts.days, i.btw, i.file]).sort());
  eq(inv, [["1-2026", "21/01/2026", "Piguillet BV", 2484, 4.6875, "verlegd", "Extreme building 1- 2026.doc"], ["2-2026", "28/01/2026", "Piguillet BV", 2484, 4.6875, "verlegd", "Extreme building 2- 2026.doc"],
    ["3-2026", "04/02/2026", "Piguillet BV", 2484, 4.6875, "verlegd", "Extreme building 3- 2026.docx"]], "the three hand-made invoices are read (.doc, .doc, .docx with the table as an embedded sheet)");
  eq(await page.evaluate(() => [state.unread, inFolder(2026).sort()]), [[], [1, 2, 3]], "nothing unread; their numbers count as used (also from a name like '1- 2026')");

  // statistics
  await goTab(page, "stats"); await page.waitForTimeout(400);
  const k = await page.$$eval("#kpis .kpi .v", (v) => v.map((x) => x.textContent.trim()));
  ok(k[0] === "€ 7.452" && k[1] === "3" && /^14,06/.test(k[2]), "statistics: revenue, 3 invoices, 14,06 days (3 x 37,5 hours)", k);

  // new purchase orders: only a file that looks like a PO is named as not read
  await goTab(page, "inv"); await page.waitForTimeout(300);
  const note = (await page.textContent("#newPo")).replace(/\s+/g, " ");
  ok(/1 PDF/.test(note) && note.includes("PO-999999.pdf") && !/Jaarrekening|Polis/.test(note), "new orders: the damaged PO file is named; the other PDFs in the folder are not", note.slice(0, 260));
  eq(await page.evaluate(() => state.poUnread.length), 3, "(all three are still known as not read, for the list in Statistics)");

  // Documents: a row each, the Word file to look at
  await goTab(page, "docs"); await page.waitForTimeout(400);
  const rows = await page.$$eval("#docsList li.drow:not(.po-only):not(.loose)", (l) => l.map((x) => [x.dataset.nr, x.querySelector(".c-cl").textContent, x.querySelector(".c-dt").textContent, x.querySelector(".c-amt").textContent.replace(/\s/g, " "), [...x.querySelectorAll("button.dchip:not(:disabled)")].map((b) => b.dataset.doc).join("+")]));
  eq(rows.sort(), [["1-2026", "Piguillet BV", "21/01/2026", "€ 2.484,00", "word"], ["2-2026", "Piguillet BV", "28/01/2026", "€ 2.484,00", "word"], ["3-2026", "Piguillet BV", "04/02/2026", "€ 2.484,00", "word"]], "Documents: three invoice rows with client, date and amount");
  ok(!(await page.$("#docsList li.loose")), "...none of them is a 'file without a number'");
  for (const [nr, kind] of [["1-2026", "an old .doc"], ["3-2026", "a .docx with an embedded sheet"]]) {
    await page.click(`#docsList li[data-nr="${nr}"] button[data-doc=word]`); await page.waitForSelector("#poDlg[open]");
    ok(await until(async () => (await page.$$("#poPages table")).length === 1) && !(await page.isVisible("#poDlgErr")), `preview of ${kind}: a page with the price table`);
    const cells = await page.$$eval("#poPages table tr", (r) => r.map((x) => [...x.children].map((c) => c.textContent.trim()).filter(Boolean).join("|")));
    ok(cells.includes("week: 3|€ 46,00|37,5|€ 1.725,00") && cells.some((c) => /^Total inc, btw\|€ 2\.484,00$/.test(c)), "...the rows of the table, amounts in their own cells", cells.slice(0, 4));
    const txt = (await page.textContent("#poPages")).replace(/\s+/g, " ");
    ok(txt.includes("Extreme Building") && txt.includes(`Factuur nr: ${nr}.`) && txt.includes("Piguillet BV") && txt.includes("ING-nr"), "...with the header, the text and the footer");
    if (nr === "1-2026") await page.screenshot({ path: "/tmp/oldinv_doc.png" });
    await page.click("#poDlgClose"); await page.waitForTimeout(200);
  }

  // deleting one: its Word file (.doc) goes to the Recycle Bin, the number is free again
  await page.click('#docsList li[data-nr="2-2026"] button[data-deldoc]'); await page.waitForSelector("#delDlg[open]");
  ok(await page.isVisible("#delWordWrap") && (await page.textContent("#delWordWrap")).includes("Extreme building 2- 2026.doc") && await page.isChecked("#delWord"), "delete: the .doc is offered as the Word file");
  await page.click("#delGo");
  ok(await until(() => !fs.existsSync(path.join(INV, "Extreme building 2- 2026.doc"))) && await until(async () => !(await page.$('#docsList li[data-nr="2-2026"]'))), "...deleted: the file is gone and so is the row");
  eq(await page.evaluate(() => inFolder(2026).sort()), [1, 3], "...and its number is no longer taken");
  ok(!errs.length, "no page errors", errs);
  await app.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
