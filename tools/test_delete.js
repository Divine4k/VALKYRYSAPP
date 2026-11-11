// Deleting an invoice (history × and the bin on a Documents row): the app's record, and if wanted its files (to the Recycle Bin, stubbed here),
// the PO only on request; refreshing the folders (buttons, coming back to the app); records whose files vanished outside the app are removed on their own (the folder is the truth).
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { tmp, goTab, seedProfile, APP_DIR } = require("./test_helpers");
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const INV = tmp("del-inv"), PO = tmp("del-po"), TRASH = tmp("trash-test"), dataHome = tmp("el-appdata-del");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function makePo(file, po, order, items) {
  const doc = await PDFLib.PDFDocument.create(), page = doc.addPage([595, 842]), f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const money = (n) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2 }), total = items.reduce((a, [, p]) => a + p, 0);
  const lines = ["Piguillet", "Groep", "Inkooporder Inkooporder", "Aan: Afleveradres:", "Valkyrys", "Harderwijkstraat 115", "2573ZC 's-gravenhage", "Aflevernotitie:", `Ordernummer : ${po}`, "Levering : DDP (Incoterms 2020)", `Besteldatum : ${order}`, `Leverdatum : ${order}`, "Besteld door : Annelies Hartman-Kuivenhoven", "Aantal Nummer Omschrijving Prijs Totaalbedrag",
    ...items.map(([d, p]) => `1 Dagprijs ${d} - Przemyslaw Wodecki - TB/2025-08/006531 ${money(p)} ${money(p)}`), `Totaalbedrag inkooporder ${money(total)}`, "Alle genoemde prijzen zijn exc. btw", "Facturatievoorwaarden:", "KvK nr. 52742938 BTW nr. NL850577950B01 IBAN NL48 INGB0009237048"];
  lines.forEach((t, i) => page.drawText(t, { x: 40, y: 800 - i * 18, size: 10, font: f })); fs.writeFileSync(file, await doc.save());
}
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 200)); } return false; };
const db = () => { try { return JSON.parse(fs.readFileSync(path.join(dataHome, APP_DIR, "data.json"), "utf8")); } catch (e) { return {}; } };
const exists = (n) => fs.existsSync(path.join(INV, n));
const eq2 = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
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
  ok(await page.isVisible("#newPo [data-refresh]"), "refresh button visible: #newPo [data-refresh]");
  ok(!(await page.$("#hist")) && !(await page.$("#histEmpty")) && !(await page.$("aside [data-refresh]")), "no 'Gemaakte facturen' list in the sidebar any more");
  // make 5 invoices into the folder: 62..66 (PDF + Word)
  await page.click("#npAll"); await page.waitForFunction(() => document.querySelectorAll("article.po h3").length === 5, null, { timeout: 30000 });
  await page.click("#zipAll"); for (let i = 0; i < 300 && !exists("VALKYRYS 66-2026.docx"); i++) await sleep(200); await sleep(1500);
  ok([62, 63, 64, 65, 66].every((n) => exists(`VALKYRYS ${n}-2026.pdf`) && exists(`VALKYRYS ${n}-2026.docx`)), "invoices 62..66 saved as PDF + Word");
  const rec = db()["invoices/66-2026"];
  ok(rec && Array.isArray(rec.savedFiles) && rec.savedFiles.length > 0, "the record remembers the files written into the folder", rec && rec.savedFiles);
  ok((await page.textContent("#nextNr")) === "67-2026", "next number 67-2026");
  await page.click("#clear"); await sleep(300); // the finished cards would keep their numbers taken

  // ---- 1. delete from Documents with its files: record gone, files to the bin, the PO stays
  await goTab(page, "docs"); await page.waitForSelector('#docsList li[data-nr="66-2026"] button[data-deldoc]', { timeout: 15000 });
  await page.click('#docsList li[data-nr="66-2026"] button[data-deldoc]'); await page.waitForSelector("#delDlg[open]");
  ok((await page.textContent("#delDlgTitle")).includes("66-2026"), "dialog title names the invoice");
  ok(await page.isVisible("#delPdfWrap") && await page.isChecked("#delPdf") && (await page.textContent("#delPdfWrap")).includes("VALKYRYS 66-2026.pdf"), "PDF checkbox shown, checked, with its file name");
  ok(await page.isVisible("#delWordWrap") && await page.isChecked("#delWord") && (await page.textContent("#delWordWrap")).includes("VALKYRYS 66-2026.docx"), "Word checkbox shown, checked, with its file name");
  ok(await page.isVisible("#delPoWrap") && !(await page.isChecked("#delPo")) && (await page.textContent("#delPoWrap")).includes("PO-200005.pdf"), "PO checkbox shown, not checked, with its file name");
  const dlist = () => page.$$eval("#delList li", (l) => l.map((x) => x.textContent + (x.classList.contains("keep") ? " [keep]" : "")));
  const list = await dlist(); console.log("dialog list:", list);
  ok(list.some((t) => t.includes("in de app")) && list.some((t) => t === "VALKYRYS 66-2026.pdf") && list.some((t) => t === "VALKYRYS 66-2026.docx") && list.some((t) => t.includes("PO-200005") && t.includes("[keep]")), "dialog lists the record, both files and the (kept) PO");
  await page.uncheck("#delWord"); ok((await dlist()).includes("VALKYRYS 66-2026.docx [keep]"), "unticking Word strikes it through in the list");
  await page.check("#delPo"); ok((await dlist()).some((t) => t.includes("PO-200005") && !t.includes("[keep]")), "ticking the PO puts it in the list");
  await page.uncheck("#delPo"); await page.check("#delWord");
  { const c = await page.$eval("#delGo", (b) => { const s = getComputedStyle(b); return [s.backgroundColor, s.color]; }); ok(c[0] === "rgb(196, 43, 33)" && c[1] === "rgb(255, 255, 255)", "Delete button: solid red with white text", c); }
  await page.evaluate(() => window.ValkTheme.apply({ id: "dark" })); await page.waitForTimeout(200);
  { const c = await page.$eval("#delGo", (b) => { const s = getComputedStyle(b); return [s.backgroundColor, s.color]; }); ok(c[0] === "rgb(196, 43, 33)" && c[1] === "rgb(255, 255, 255)", "Delete button in dark: same red, white text", c); }
  await page.screenshot({ path: "/tmp/del_dlg2.png" });
  await page.evaluate(() => window.ValkTheme.apply({ id: "light" })); await page.waitForTimeout(200);
  await page.screenshot({ path: "/tmp/del_dlg.png" });
  await page.click("#delGo"); await sleep(1500);
  ok(!db()["invoices/66-2026"], "record 66-2026 deleted");
  ok(!exists("VALKYRYS 66-2026.pdf") && !exists("VALKYRYS 66-2026.docx") && fs.existsSync(path.join(TRASH, "VALKYRYS 66-2026.pdf")), "its PDF and Word went to the bin");
  ok(fs.existsSync(path.join(PO, "PO-200005.pdf")), "the PO file stays");
  ok((await app.evaluate(() => globalThis.__trash.length)) === 2, "2 trash calls");
  ok((await page.textContent("#nextNr")) === "66-2026", "number 66 free again: " + (await page.textContent("#nextNr")));
  console.log("toast:", await page.textContent("#toast"));
  ok(!(await page.$('#docsList li[data-nr="66-2026"]')), "66-2026 gone from Documents");
  await goTab(page, "inv");

  // ---- 1b. a file deleted outside the app: the row says the PDF is missing, banners on Documents and in the new-orders panel, the Incomplete filter, make again, ignore
  fs.rmSync(path.join(INV, "VALKYRYS 62-2026.pdf"));
  await page.click("#newPo [data-refresh]"); await sleep(1500);
  const npw = await page.textContent("#npWarn").catch(() => ""); console.log("new-orders line:", npw);
  ok(await page.isVisible("#npWarn") && npw.includes("1 factuur mist een bestand: 62-2026 (PDF)"), "new-orders panel: '1 factuur mist een bestand: 62-2026 (PDF)'");
  ok(!(await page.isVisible("#staleBar")), "not listed as stale (its Word file is still there)");
  await page.click('#npWarn button[data-dw="miss"]'); await sleep(500);
  ok(await page.isVisible("#docsView"), "'Bekijken' opens Documents");
  eq2(await page.$eval('#docsFilter [aria-pressed="true"]', (b) => b.dataset.f), "miss", "...with the Incomplete filter on");
  eq2(await page.$$eval("#docsList li", (l) => l.map((x) => x.dataset.nr)), ["62-2026"], "Incomplete filter: only 62-2026");
  eq2((await page.textContent('#docsFilter [data-f="miss"]')).replace(/\s+/g, " ").trim(), "Onvolledig 1", "Incomplete filter button with its count");
  ok(await page.isVisible("#docsWarn") && (await page.textContent("#docsWarn")).includes("62-2026 (PDF)"), "Documents banner names 62-2026 (PDF)");
  const r62 = '#docsList li[data-nr="62-2026"]';
  ok(await page.$eval(r62 + " button.k-pdf", (b) => b.disabled && b.classList.contains("miss")) && await page.$eval(r62 + " button.k-word", (b) => !b.disabled), "62: PDF chip off (missing), Word chip on");
  eq2((await page.textContent(r62 + " .c-warn .tagw")).trim(), "PDF ontbreekt", "62: warn badge 'PDF ontbreekt'");
  await page.screenshot({ path: "/tmp/docs_missing.png" });
  await page.click(r62 + " button[data-remake]");
  for (let i = 0; i < 100 && !exists("VALKYRYS 62-2026.pdf"); i++) await sleep(150); await sleep(1500);
  ok(exists("VALKYRYS 62-2026.pdf"), "'Opnieuw maken' writes the PDF into the folder again");
  ok(!(await page.$(r62 + " .c-warn")) && !(await page.isVisible("#docsWarn")), "warning and banner gone");
  ok(await page.$eval(r62 + " button.k-pdf", (b) => !b.disabled), "62: PDF chip on again");
  eq2(await page.$eval('#docsFilter [aria-pressed="true"]', (b) => b.dataset.f), "all", "nothing incomplete any more: back to All");
  ok((db()["invoices/62-2026"].savedFiles || []).includes("VALKYRYS 62-2026.pdf"), "the record knows the file again");
  console.log("toast:", await page.textContent("#toast"));
  // ignore: the Word file goes; 'Negeren' silences it, also after a reload
  fs.rmSync(path.join(INV, "VALKYRYS 62-2026.docx"));
  await page.click("#docsBar [data-refresh]"); await sleep(1500);
  eq2((await page.textContent(r62 + " .c-warn .tagw").catch(() => "")).trim(), "Word ontbreekt", "62: 'Word ontbreekt' after deleting the Word file");
  await page.click(r62 + " button[data-missignore]"); await sleep(600);
  ok(!(await page.$(r62 + " .c-warn")) && !(await page.isVisible("#docsWarn")), "ignore: warning and banner gone");
  ok(await page.$eval(r62 + " button.k-word", (b) => b.disabled), "the Word chip still says the truth (off)");
  ok(((db()["settings/keptmissing"] || {}).list || []).includes("62-2026"), "ignored number stored in settings/keptmissing");
  await page.reload(); await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "docs");
  await page.waitForSelector(r62, { timeout: 20000 }); await sleep(1500);
  ok(!(await page.$(r62 + " .c-warn")) && !(await page.isVisible("#docsWarn")), "ignore kept after a reload");
  await goTab(page, "inv"); await sleep(300);
  ok(!(await page.isVisible("#npWarn")), "no line in the new-orders panel either");

  // ---- 2. Documents: delete 65 with only the Word box ticked → files stay; then delete the folder-only 65 → files go
  await goTab(page, "docs"); await page.waitForSelector('#docsList li[data-nr="65-2026"]');
  ok(await page.isVisible("#docsBar [data-refresh]"), "refresh button in the Documents toolbar");
  await page.click('#docsList button[data-deldoc="65-2026"]'); await page.waitForSelector("#delDlg[open]");
  await page.uncheck("#delPdf"); await page.click("#delGo"); await sleep(1200);
  ok(!db()["invoices/65-2026"] && exists("VALKYRYS 65-2026.pdf") && !exists("VALKYRYS 65-2026.docx") && fs.existsSync(path.join(TRASH, "VALKYRYS 65-2026.docx")), "only Word ticked: record gone, Word to the bin, PDF kept");
  console.log("toast:", await page.textContent("#toast"));
  ok(/nog in de map/.test(await page.textContent("#toast")), "toast says the file is still in the folder");
  ok(await page.isVisible('#docsList li[data-nr="65-2026"]'), "65 still listed (its PDF is in the folder)");
  ok(!(await page.$('#docsList li[data-nr="65-2026"] .c-warn')), "65 is now folder-only: no missing-Word warning");
  await page.click('#docsList button[data-deldoc="65-2026"]'); await page.waitForSelector("#delDlg[open]");
  const l2 = await page.$$eval("#delList li", (l) => l.map((x) => x.textContent));
  ok(!l2.some((t) => /in de app/.test(t)) && await page.isChecked("#delPdf") && !(await page.isVisible("#delWordWrap")), "folder-only invoice: no app record listed, PDF checked, no Word box (no file)", l2);
  await page.click("#delGo"); await sleep(1200);
  ok(!exists("VALKYRYS 65-2026.pdf") && !exists("VALKYRYS 65-2026.docx"), "folder-only invoice files trashed");
  ok(!(await page.isVisible('#docsList li[data-nr="65-2026"]')), "65 no longer listed");
  // cancel keeps everything
  await page.click('#docsList button[data-deldoc="64-2026"]'); await page.waitForSelector("#delDlg[open]"); await page.click("#delCancel"); await sleep(400);
  ok(db()["invoices/64-2026"] && exists("VALKYRYS 64-2026.pdf"), "cancel deletes nothing");

  // ---- 3. the IPC refuses paths outside the folder and other files
  const refused = await page.evaluate(async (abs) => Promise.all([window.valkyrys.trashFile("../del-po/PO-200001.pdf"), window.valkyrys.trashFile(abs), window.valkyrys.trashFile("../../etc/passwd"), window.valkyrys.trashFile("nope.pdf")]), path.join(PO, "PO-200001.pdf"));
  ok(refused.every((r) => r && r.error && !r.ok), "outside / missing paths refused", refused);
  ok(fs.existsSync(path.join(PO, "PO-200001.pdf")), "file outside the folder untouched");

  // ---- 4. the folder is the truth: files deleted in Explorer → coming back to the app removes the record on its own (no banner), its PO is new again
  await goTab(page, "inv"); await sleep(300); const npBefore = await page.$$eval("#npList li", (l) => l.length);
  await page.evaluate(() => { window.__staleGraceMs = 0; }); // no grace period for a save under way
  await goTab(page, "docs"); await sleep(300);
  fs.rmSync(path.join(INV, "VALKYRYS 64-2026.pdf")); fs.rmSync(path.join(INV, "VALKYRYS 64-2026.docx"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await until(async () => !db()["invoices/64-2026"] && !(await page.$('#docsList li[data-nr="64-2026"]'))), "focus refresh: 64-2026 removed from the app and the list");
  ok(await until(async () => ((await page.textContent("#toast").catch(() => "")) || "").includes("64-2026")), "a short note names it", await page.textContent("#toast").catch(() => ""));
  ok(!(await page.isVisible("#staleBarD")) && !(await page.isVisible("#staleBar")), "no banner");

  // ---- 5. the refresh button too
  fs.rmSync(path.join(INV, "VALKYRYS 63-2026.pdf")); fs.rmSync(path.join(INV, "VALKYRYS 63-2026.docx"));
  await page.click("#docsBar [data-refresh]");
  ok(await until(async () => !db()["invoices/63-2026"] && !(await page.$('#docsList li[data-nr="63-2026"]'))), "refresh button: 63-2026 removed");
  ok(db()["invoices/62-2026"], "62-2026 kept (its PDF is still there)");
  ok(await until(async () => !(await page.$eval("#docsBar [data-refresh]", (b) => b.classList.contains("spin")))), "spinner stops");
  await goTab(page, "inv"); await sleep(400);
  const npAfter = await page.$$eval("#npList li .t", (l) => l.map((x) => x.textContent));
  ok(npAfter.length === npBefore + 2 && npAfter.includes("PO-200002") && npAfter.includes("PO-200003"), "their POs are new again", { npBefore, npAfter });
  ok((await page.textContent("#nextNr")) === "63-2026", "next number drops back to 63: " + (await page.textContent("#nextNr")));

  // ---- 7b. two invoices for one purchase order: 62-2026 (made here for PO-200001) and a file "VALKYRYS 70-2026 PO-200001.pdf"
  fs.writeFileSync(path.join(INV, "VALKYRYS 70-2026 PO-200001.pdf"), "x");
  await page.click("#newPo [data-refresh]"); await sleep(1500);
  const dupLine = await page.textContent("#npWarn").catch(() => ""); console.log("dup line:", dupLine);
  ok(await page.isVisible("#npWarn") && dupLine.includes("PO-200001 heeft 2 facturen: 62-2026 en 70-2026"), "new-orders panel: 'PO-200001 heeft 2 facturen: 62-2026 en 70-2026'");
  await page.click('#npWarn button[data-dw="dup"]'); await sleep(500);
  ok(await page.isVisible("#docsView") && (await page.inputValue("#docsSearch")) === "PO-200001", "'Bekijken': Documents searched on PO-200001");
  eq2((await page.$$eval("#docsList li", (l) => l.map((x) => x.dataset.nr))).sort(), ["62-2026", "70-2026"], "both invoices shown");
  ok(await page.isVisible("#docsWarn") && (await page.textContent("#docsWarn")).includes("PO-200001 heeft 2 facturen"), "Documents banner too");
  eq2(await page.$$eval("#docsList li .c-warn .tagw.dup", (l) => l.map((x) => x.textContent)), ["Dubbel · PO-200001", "Dubbel · PO-200001"], "both rows marked 'Dubbel'");
  await page.screenshot({ path: "/tmp/docs_dup.png" });
  await page.click('#docsWarn button[data-dw="dupignore"]'); await sleep(600);
  ok(!(await page.isVisible("#docsWarn")) && !(await page.$("#docsList .c-warn")), "'Negeren': banner and labels gone");
  ok(((db()["settings/keptdupinv"] || {}).list || []).some((k) => k.startsWith("PO-200001|")), "ignored in settings/keptdupinv", db()["settings/keptdupinv"]);
  await page.fill("#docsSearch", ""); fs.rmSync(path.join(INV, "VALKYRYS 70-2026 PO-200001.pdf")); await page.click("#docsBar [data-refresh]"); await sleep(1200);

  // ---- 8. no 'read from' line (and so no refresh button) on the Statistics: coming back to the app refreshes on its own
  await goTab(page, "stats"); await sleep(300);
  ok(!(await page.$("#srcRow, #srcPath, #srcDot, #srcSettings")) && !(await page.$("#statsView [data-refresh]")), "no 'read from' line or refresh button on the Statistics");
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(1200);
  ok(!(await page.isVisible("#statsGoSettings")), "folder set and found: no button to Settings on the Statistics");
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close();
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
