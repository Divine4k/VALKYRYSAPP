// Deleting an invoice (history × and the bin on a Documents row): the app's record, and if wanted its files (to the Recycle Bin, stubbed here),
// the PO only on request; refreshing the folders (buttons, coming back to the app); records whose files vanished outside the app (banner).
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { goTab, seedProfile, APP_DIR } = require("./test_helpers");
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const INV = "/tmp/del-inv", PO = "/tmp/del-po", TRASH = "/tmp/trash-test", dataHome = "/tmp/el-appdata-del";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function makePo(file, po, order, items) {
  const doc = await PDFLib.PDFDocument.create(), page = doc.addPage([595, 842]), f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const money = (n) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2 }), total = items.reduce((a, [, p]) => a + p, 0);
  const lines = ["Piguillet", "Groep", "Inkooporder Inkooporder", "Aan: Afleveradres:", "Valkyrys", "Harderwijkstraat 115", "2573ZC 's-gravenhage", "Aflevernotitie:", `Ordernummer : ${po}`, "Levering : DDP (Incoterms 2020)", `Besteldatum : ${order}`, `Leverdatum : ${order}`, "Besteld door : Annelies Hartman-Kuivenhoven", "Aantal Nummer Omschrijving Prijs Totaalbedrag",
    ...items.map(([d, p]) => `1 Dagprijs ${d} - Przemyslaw Wodecki - TB/2025-08/006531 ${money(p)} ${money(p)}`), `Totaalbedrag inkooporder ${money(total)}`, "Alle genoemde prijzen zijn exc. btw", "Facturatievoorwaarden:", "KvK nr. 52742938 BTW nr. NL850577950B01 IBAN NL48 INGB0009237048"];
  lines.forEach((t, i) => page.drawText(t, { x: 40, y: 800 - i * 18, size: 10, font: f })); fs.writeFileSync(file, await doc.save());
}
const db = () => { try { return JSON.parse(fs.readFileSync(path.join(dataHome, APP_DIR, "data.json"), "utf8")); } catch (e) { return {}; } };
const exists = (n) => fs.existsSync(path.join(INV, n));
(async () => {
  for (const d of [INV, PO, TRASH, dataHome]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
  fs.writeFileSync(path.join(INV, "VALKYRYS 61-2026.pdf"), "x"); // an older invoice already in the folder (not readable, its name has the number)
  const POS = ["PO-200001", "PO-200002", "PO-200003", "PO-200004", "PO-200005"];
  for (let i = 0; i < POS.length; i++) await makePo(path.join(PO, POS[i] + ".pdf"), POS[i], `0${i + 1}-09-2026`, [[`0${i + 1}-09-2026`, 600]]);
  seedProfile(dataHome, { folder: INV, poFolder: PO });
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  // the Recycle Bin: move the file into /tmp/trash-test and remember the call
  await app.evaluate(({ shell }, T) => { const fs = process.mainModule.require("fs"); globalThis.__trash = []; shell.trashItem = async (p) => { globalThis.__trash.push(p); fs.renameSync(p, T + "/" + p.split("/").pop()); }; }, TRASH);
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await sleep(200); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv");
  await page.waitForFunction(() => document.querySelectorAll("#npList li").length === 5, null, { timeout: 60000 });
  ok(true, "5 new purchase orders listed");
  // refresh buttons present where they are useful
  for (const sel of ["#newPo [data-refresh]", "aside [data-refresh]"]) ok(await page.isVisible(sel), "refresh button visible: " + sel);
  // make 5 invoices into the folder: 62..66 (PDF + Word)
  await page.click("#npAll"); await page.waitForFunction(() => document.querySelectorAll("article.po h3").length === 5, null, { timeout: 30000 });
  await page.click("#zipAll"); for (let i = 0; i < 300 && !exists("VALKYRYS 66-2026.docx"); i++) await sleep(200); await sleep(1500);
  ok([62, 63, 64, 65, 66].every((n) => exists(`VALKYRYS ${n}-2026.pdf`) && exists(`VALKYRYS ${n}-2026.docx`)), "invoices 62..66 saved as PDF + Word");
  const rec = db()["invoices/66-2026"];
  ok(rec && Array.isArray(rec.savedFiles) && rec.savedFiles.length > 0, "the record remembers the files written into the folder", rec && rec.savedFiles);
  ok((await page.textContent("#nextNr")) === "67-2026", "next number 67-2026");
  await page.click("#clear"); await sleep(300); // the finished cards would keep their numbers taken

  // ---- 1. delete from the history with its files: record gone, files to the bin, the PO stays
  await page.click('#hist button[data-del="66-2026"]'); await page.waitForSelector("#delDlg[open]");
  ok((await page.textContent("#delDlgTitle")).includes("66-2026"), "dialog title names the invoice");
  ok(await page.isChecked("#delFiles") && await page.isVisible("#delFilesWrap"), "files checkbox shown and checked (files exist)");
  ok(await page.isVisible("#delPoWrap") && !(await page.isChecked("#delPo")), "PO checkbox shown, not checked");
  const list = await page.$$eval("#delList li", (l) => l.map((x) => x.textContent + (x.classList.contains("keep") ? " [keep]" : "")));
  console.log("dialog list:", list);
  ok(list.some((t) => t.includes("VALKYRYS 66-2026.pdf")) && list.some((t) => t.includes("PO-200005") && t.includes("[keep]")), "dialog lists the files and the (kept) PO");
  await page.screenshot({ path: "/tmp/del_dlg.png" });
  await page.click("#delGo"); await sleep(1500);
  ok(!db()["invoices/66-2026"], "record 66-2026 deleted");
  ok(!exists("VALKYRYS 66-2026.pdf") && !exists("VALKYRYS 66-2026.docx") && fs.existsSync(path.join(TRASH, "VALKYRYS 66-2026.pdf")), "its PDF and Word went to the bin");
  ok(fs.existsSync(path.join(PO, "PO-200005.pdf")), "the PO file stays");
  ok((await app.evaluate(() => globalThis.__trash.length)) === 2, "2 trash calls");
  ok((await page.textContent("#nextNr")) === "66-2026", "number 66 free again: " + (await page.textContent("#nextNr")));
  console.log("toast:", await page.textContent("#toast"));

  // ---- 2. Documents: delete 65 with the files checkbox off → files stay; then delete the folder-only 65 → files go
  await goTab(page, "docs"); await page.waitForSelector('#docsList li[data-nr="65-2026"]');
  ok(await page.isVisible("#docsBar [data-refresh]"), "refresh button in the Documents toolbar");
  await page.click('#docsList button[data-deldoc="65-2026"]'); await page.waitForSelector("#delDlg[open]");
  await page.uncheck("#delFiles"); await page.click("#delGo"); await sleep(1200);
  ok(!db()["invoices/65-2026"] && exists("VALKYRYS 65-2026.pdf") && exists("VALKYRYS 65-2026.docx"), "record gone, files kept");
  console.log("toast:", await page.textContent("#toast"));
  ok(/nog in de map/.test(await page.textContent("#toast")), "toast says the file is still in the folder");
  ok(await page.isVisible('#docsList li[data-nr="65-2026"]'), "65 still listed (its files are in the folder)");
  await page.click('#docsList button[data-deldoc="65-2026"]'); await page.waitForSelector("#delDlg[open]");
  const l2 = await page.$$eval("#delList li", (l) => l.map((x) => x.textContent));
  ok(!l2.some((t) => /in de app/.test(t)) && await page.isChecked("#delFiles"), "folder-only invoice: no app record listed, files checked", l2);
  await page.click("#delGo"); await sleep(1200);
  ok(!exists("VALKYRYS 65-2026.pdf") && !exists("VALKYRYS 65-2026.docx"), "folder-only invoice files trashed");
  ok(!(await page.isVisible('#docsList li[data-nr="65-2026"]')), "65 no longer listed");
  // cancel keeps everything
  await page.click('#docsList button[data-deldoc="64-2026"]'); await page.waitForSelector("#delDlg[open]"); await page.click("#delCancel"); await sleep(400);
  ok(db()["invoices/64-2026"] && exists("VALKYRYS 64-2026.pdf"), "cancel deletes nothing");

  // ---- 3. the IPC refuses paths outside the folder and other files
  const refused = await page.evaluate(async () => Promise.all([window.valkyrys.trashFile("../del-po/PO-200001.pdf"), window.valkyrys.trashFile("/tmp/del-po/PO-200001.pdf"), window.valkyrys.trashFile("../../etc/passwd"), window.valkyrys.trashFile("nope.pdf")]));
  ok(refused.every((r) => r && r.error && !r.ok), "outside / missing paths refused", refused);
  ok(fs.existsSync(path.join(PO, "PO-200001.pdf")), "file outside the folder untouched");

  // ---- 4. coming back to the app re-reads the folder; files deleted in Explorer → "only in app" + banner
  fs.rmSync(path.join(INV, "VALKYRYS 64-2026.pdf")); fs.rmSync(path.join(INV, "VALKYRYS 64-2026.docx"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => { const r = document.querySelector('#docsList li[data-nr="64-2026"] .c-nr small'); return !!r; }, null, { timeout: 5000 }).then(() => ok(true, "focus refresh: 64 now 'only in app'"), () => ok(false, "focus refresh: 64 now 'only in app'"));
  await page.waitForSelector("#staleBarD:not([hidden])", { timeout: 5000 }).catch(() => {});
  ok(await page.isVisible("#staleBarD") && (await page.textContent("#staleBarD")).includes("64-2026"), "Documents banner names 64-2026");

  // ---- 5. the refresh button picks up a file deleted on disk
  fs.rmSync(path.join(INV, "VALKYRYS 63-2026.pdf")); fs.rmSync(path.join(INV, "VALKYRYS 63-2026.docx"));
  await page.click("#docsBar [data-refresh]"); await sleep(1500);
  ok(await page.isVisible('#docsList li[data-nr="63-2026"] .c-nr small'), "refresh button: 63 now 'only in app'");
  ok((await page.textContent("#staleBarD")).includes("63-2026"), "banner names 63-2026 too");
  ok(!(await page.$eval("#docsBar [data-refresh]", (b) => b.classList.contains("spin"))), "spinner stops");

  // ---- 6. the banner on the Invoices tab removes the stale records: their POs are new again, numbering drops back
  await goTab(page, "inv"); await sleep(400);
  const st = await page.textContent("#staleBar"); console.log("banner:", st);
  ok(await page.isVisible("#staleBar") && st.includes("63-2026") && st.includes("64-2026") && !st.includes("62-2026"), "Invoices banner lists 63 and 64 only");
  const npBefore = await page.$$eval("#npList li", (l) => l.length);
  await page.click('#staleBar button[data-stale="del"]'); await sleep(1500);
  ok(!db()["invoices/63-2026"] && !db()["invoices/64-2026"] && db()["invoices/62-2026"], "63 and 64 removed from the app, 62 kept");
  ok(!(await page.isVisible("#staleBar")), "banner gone");
  const npAfter = await page.$$eval("#npList li .t", (l) => l.map((x) => x.textContent));
  ok(npAfter.length === npBefore + 2 && npAfter.includes("PO-200002") && npAfter.includes("PO-200003"), "their POs are new again", { npBefore, npAfter });
  ok((await page.textContent("#nextNr")) === "63-2026", "next number drops back to 63: " + (await page.textContent("#nextNr")));

  // ---- 7. "Keep" remembers; an older record without savedFiles counts by the folder's range
  fs.rmSync(path.join(INV, "VALKYRYS 62-2026.pdf")); fs.rmSync(path.join(INV, "VALKYRYS 62-2026.docx"));
  await page.click("aside [data-refresh]"); await sleep(1500);
  ok(await page.isVisible("#staleBar") && (await page.textContent("#staleBar")).includes("62-2026"), "history refresh button: 62 flagged");
  await page.click('#staleBar button[data-stale="keep"]'); await sleep(800);
  ok(!(await page.isVisible("#staleBar")) && db()["invoices/62-2026"], "keep: banner gone, record kept");
  ok(((db()["settings/keptstale"] || {}).list || []).includes("62-2026"), "kept numbers stored");

  // ---- 8. the Statistics source line has a refresh button that works
  await goTab(page, "stats"); await sleep(300);
  ok(await page.isVisible("#srcRow [data-refresh]"), "refresh button on the Statistics source line");
  await page.click("#srcRow [data-refresh]"); await sleep(800);
  ok(!(await page.$eval("#srcRow [data-refresh]", (b) => b.classList.contains("spin"))), "stats refresh done");
  ok((await page.getAttribute("#srcRow [data-refresh]", "aria-label")) === "Vernieuwen", "aria-label Vernieuwen");
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close();
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
