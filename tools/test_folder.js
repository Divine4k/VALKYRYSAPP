const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { tmp, saved: fileSaved, goTab, setLang, seedProfile } = require("./test_helpers");
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const dataHome = tmp("el-appdata-f"); fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  const F = tmp("inv-folder"); fs.rmSync(F, { recursive: true, force: true }); fs.mkdirSync(F + "/2025", { recursive: true });
  for (const n of ["VALKYRYS 64-2026.pdf", "VALKYRYS 64-2026.docx", "Factuur 15-01-2026.pdf", "~$VALKYRYS 64-2026.docx", "notes.txt", "2025/VALKYRYS 10-2025.pdf"]) fs.writeFileSync(path.join(F, n), "x");
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  // stub the OS dialogs / file opening
  await app.evaluate(({ dialog, shell }, F) => { globalThis.__opened = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [F] }); shell.openPath = async (p) => { globalThis.__opened.push(p); return ""; }; }, F);
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(600);
  ok(await page.isVisible("#tabDocs"), "Documents tab in the desktop app");
  ok((await page.textContent("#nextNr")) === "62-2026", "next number before folder = " + (await page.textContent("#nextNr")));
  await goTab(page, "docs"); ok(await page.isVisible("#docsNoFolder") && await page.isVisible("#docsGoSet"), "Documents tab says where to set the folder");
  await goTab(page, "settings"); ok(await page.isVisible("#setFolders") && !(await page.isVisible("#folderOpen")) && !(await page.isVisible("#folderPath")), "Settings: folder not chosen yet, no path");
  ok((await page.textContent("#dlgTitle")) !== null, "page alive");
  await page.click("#folderPick"); await page.waitForTimeout(800);
  ok((await page.textContent("#folderPath")) === F, "path shown: " + (await page.textContent("#folderPath")));
  ok(await page.isVisible("#folderOpen") && await page.isVisible("#folderClear"), "open and disconnect buttons appear");
  await goTab(page, "docs"); await page.waitForTimeout(400);
  ok(!(await page.isVisible("#docsNoFolder")), "Documents tab: the folder card is gone once a folder is set");
  const items = await page.$$eval("#docsList li", (li) => li.map((l) => ({ nr: l.dataset.nr, on: [...l.querySelectorAll("button[data-doc]")].map((b) => b.dataset.doc) })));
  console.log(JSON.stringify(items));
  ok(items.length === 2, "2 invoice numbers listed (date-named file, lock file and txt ignored): " + items.length);
  ok(items.some((t) => t.nr === "64-2026" && t.on.includes("pdf") && t.on.includes("word")), "64-2026 has its PDF + Word");
  ok(items.some((t) => t.nr === "10-2025" && t.on.includes("pdf")), "the file in a subfolder is listed too");
  console.log("info:", await page.textContent("#docsInfo"));
  ok((await page.textContent("#docsInfo")).includes("64-2026"), "highest number shown");
  await goTab(page, "inv");
  ok((await page.textContent("#nextNr")) === "65-2026", "next number skips the folder's 64: " + (await page.textContent("#nextNr")));
  ok((await page.textContent("#zipAll")) === "Alles opslaan in de map", "batch button relabelled");
  // add a PO, save
  await page.setInputFiles("#file", process.argv[3]); await page.waitForSelector("article.po h3");
  ok((await page.inputValue('[data-k="nr"]')) === "65-2026", "card numbered 65-2026");
  const foot = () => page.$$eval("article.po .po-foot button", (b) => b.map((x) => x.dataset.act + (x.classList.contains("primary") ? "*" : "") + ":" + x.textContent));
  const ft = await foot(); console.log("footer:", ft);
  ok(JSON.stringify(ft) === JSON.stringify(["preview:Bekijken", "download-docx:Opslaan als Word", "download:Opslaan als PDF", "download-both*:Opslaan (PDF + Word)"]), "footer: Bekijken | Word | PDF | PDF + Word (orange)");
  const xb = await page.$eval('article.po [data-act="remove"]', (b) => ({ t: b.textContent.trim(), title: b.title, aria: b.getAttribute("aria-label"), svg: !!b.querySelector("svg"), w: b.offsetWidth, h: b.offsetHeight }));
  ok(!xb.t && xb.svg && xb.title === "Verwijderen uit de lijst" && xb.aria.includes("Verwijderen uit de lijst") && Math.abs(xb.w - xb.h) < 2, "remove is a round × icon button with the translated label: " + JSON.stringify(xb));
  const rec = (n) => JSON.parse(fs.readFileSync(path.join(dataHome, "Valkyrys app", "data.json"), "utf8"))["invoices/" + n];
  // what the invoice's row in Documents offers: the PDF / Word chips that are on, make again, the eye (as the app draws it), delete
  const hbtns = async (n) => { await goTab(page, "docs"); await page.waitForTimeout(300);
    const r = await page.$$eval(`#docsList li[data-nr="${n}"]`, (li) => li.length ? [...li[0].querySelectorAll("button")].filter((b) => !b.disabled && b.dataset.doc !== "po" && !b.dataset.reveal && !b.dataset.missignore).map((b) => b.dataset.doc || (b.dataset.remake ? "remake" : b.dataset.draw ? "draw" : b.dataset.deldoc ? "del" : "?")) : null);
    await goTab(page, "inv"); return r; };
  ok(!(await page.$("#hist")) && !(await page.$("#histEmpty")), "no 'Gemaakte facturen' list on the Invoices tab");
  await page.click('article.po [data-act="download"]'); await page.waitForTimeout(1000); await fileSaved(F + "/VALKYRYS 65-2026.pdf");
  ok(fs.existsSync(F + "/VALKYRYS 65-2026.pdf") && fs.statSync(F + "/VALKYRYS 65-2026.pdf").size > 10000, "PDF saved into the folder (" + (fs.existsSync(F + "/VALKYRYS 65-2026.pdf") && fs.statSync(F + "/VALKYRYS 65-2026.pdf").size) + " bytes)");
  console.log("toast:", await page.textContent("#toast"));
  ok(JSON.stringify(await hbtns("65-2026")) === '["pdf","del"]', "Documents: only PDF on while only the PDF exists: " + (await hbtns("65-2026")));
  ok(JSON.stringify(rec("65-2026").formats) === '["pdf"]', "record formats [pdf]: " + JSON.stringify(rec("65-2026").formats));
  const ft2 = await foot(); ok(ft2.includes("download:Opnieuw opslaan (PDF)") && ft2.includes("download-both*:Opnieuw opslaan (PDF + Word)") && ft2.includes("download-docx:Opnieuw opslaan (Word)") && (await page.textContent("article.po .done")).includes("Opgeslagen als 65-2026"), "after saving: note + 'opnieuw' labels: " + ft2);
  await page.click('article.po [data-act="download-docx"]'); await page.waitForTimeout(1000); await fileSaved(F + "/VALKYRYS 65-2026.docx");
  ok(fs.existsSync(F + "/VALKYRYS 65-2026.docx"), "Word saved into the folder");
  ok(!fs.readdirSync(F).some((n) => n.endsWith(".part")), "no temp files left");
  const r65 = rec("65-2026");
  ok(JSON.stringify(r65.formats) === '["pdf","docx"]' && JSON.stringify(r65.savedFiles) === '["VALKYRYS 65-2026.pdf","VALKYRYS 65-2026.docx"]', "record keeps both formats and both file names: " + JSON.stringify([r65.formats, r65.savedFiles]));
  ok(JSON.stringify(await hbtns("65-2026")) === '["pdf","word","del"]', "Documents: PDF + Word once both exist");
  await goTab(page, "docs"); await page.waitForTimeout(300); ok((await page.$$eval("#docsList li", (l) => l.length)) === 3, "Documents now lists 3 invoices"); await goTab(page, "inv");
  ok((await page.textContent("#nextNr")) === "66-2026", "next number now " + (await page.textContent("#nextNr")));
  // Documents PDF / Word: preview the file in the folder, nothing written
  const mt = (e) => fs.statSync(`${F}/VALKYRYS 65-2026.${e}`).mtimeMs, files0 = fs.readdirSync(F).join("|"), m0 = [mt("pdf"), mt("docx")];
  await goTab(page, "docs"); await page.waitForTimeout(300);
  await page.click('#docsList li[data-nr="65-2026"] button[data-doc="pdf"]'); await page.waitForSelector("#poDlg[open] #poPages canvas", { timeout: 10000 });
  ok((await page.textContent("#poDlgTitle")).includes("65-2026"), "Documents PDF opens the preview of 65-2026");
  await page.click("#poDlgClose");
  await page.click('#docsList li[data-nr="65-2026"] button[data-doc="word"]'); await page.waitForSelector("#poDlg[open] #poPages .wpage", { timeout: 10000 });
  ok((await page.textContent("#poPages")).includes("65-2026"), "Documents Word shows the Word file");
  await page.click("#poDlgClose"); await page.waitForTimeout(300); await goTab(page, "inv");
  ok(fs.readdirSync(F).join("|") === files0 && mt("pdf") === m0[0] && mt("docx") === m0[1], "previewing writes nothing (same files, same times)");
  // save both from the card: both rewritten (same number: no question), no (2) copy
  await page.waitForTimeout(50); await page.click('article.po [data-act="download-both"]'); await page.waitForTimeout(3000);
  ok(!(await page.isVisible("#poDupDlg")), "no 'already invoiced' question for the card's own invoice");
  ok(mt("pdf") > m0[0] && mt("docx") > m0[1], "save both rewrote the PDF and the Word file");
  ok(!fs.readdirSync(F).some((n) => n.includes("(2)")), "re-saving the same invoice replaces the file");
  ok(JSON.stringify(rec("65-2026").savedFiles) === '["VALKYRYS 65-2026.pdf","VALKYRYS 65-2026.docx"]', "file names not doubled in the record");
  // no file left in the folder: Documents shows it as the app draws it (eye), the stale banner names it
  fs.renameSync(`${F}/VALKYRYS 65-2026.pdf`, tmp("65.pdf")); fs.renameSync(`${F}/VALKYRYS 65-2026.docx`, tmp("65.docx"));
  await page.click("#newPo button[data-refresh]").catch(() => {}); await goTab(page, "docs"); await page.click("#docsView button[data-refresh]"); await page.waitForTimeout(1500); await goTab(page, "inv");
  { const b = await hbtns("65-2026"); ok(JSON.stringify(b) === '["draw","del"]', "Documents: eye + delete when no file is in the folder: " + b); }
  ok(await page.isVisible("#staleBar") && (await page.textContent("#staleBar")).includes("65-2026"), "the stale banner names 65-2026");
  await goTab(page, "docs"); await page.click('#docsList li[data-nr="65-2026"] button[data-draw]'); await page.waitForSelector("#poDlg[open] #poPages canvas", { timeout: 15000 });
  ok((await page.textContent("#poDlgTitle")).includes("65-2026"), "the eye shows 65-2026 as the app draws it");
  await page.click("#poDlgClose"); await page.waitForTimeout(300);
  ok(!fs.existsSync(`${F}/VALKYRYS 65-2026.pdf`), "viewing writes nothing");
  // only the Word file missing: "Opnieuw maken" in its row makes it again
  fs.renameSync(tmp("65.pdf"), `${F}/VALKYRYS 65-2026.pdf`); await page.click("#docsView button[data-refresh]"); await page.waitForTimeout(1500); await goTab(page, "inv");
  { const b = await hbtns("65-2026"); ok(JSON.stringify(b) === '["pdf","del","remake"]', "Documents: PDF + 'Opnieuw maken' when the Word file is missing: " + b); }
  await goTab(page, "docs");
  ok((await page.textContent('#docsList li[data-nr="65-2026"] button[data-remake]')) === "Opnieuw maken", "button says 'Opnieuw maken'");
  await page.click('#docsList li[data-nr="65-2026"] button[data-remake]'); await page.waitForTimeout(3000); await goTab(page, "inv");
  ok(fs.existsSync(`${F}/VALKYRYS 65-2026.pdf`) && fs.existsSync(`${F}/VALKYRYS 65-2026.docx`), "made again: PDF and Word back in the folder");
  ok(JSON.stringify(await hbtns("65-2026")) === '["pdf","word","del"]', "Documents shows PDF + Word again");
  await page.locator("main:visible").first().screenshot({ path: "/tmp/inv_card.png" }); // card footer + sidebar
  // open a file from the list
  await goTab(page, "docs"); await page.click('#docsList button[data-doc="pdf"][data-nr="65-2026"]'); await page.waitForSelector("#poPages canvas", { timeout: 10000 });
  await page.click("#poDlgOpen"); await page.waitForTimeout(300); await page.click("#poDlgClose"); await goTab(page, "inv");
  console.log("opened:", await app.evaluate(() => globalThis.__opened));
  ok((await app.evaluate(() => globalThis.__opened)).includes(F + "/VALKYRYS 65-2026.pdf"), "PDF from the Documents tab opens the file");
  await page.screenshot({ path: "/tmp/folder-shot.png", fullPage: true });
  // config persisted
  const cfg = JSON.parse(fs.readFileSync(path.join(dataHome, "Valkyrys app", "config.json"), "utf8")); ok(cfg.folder === F, "folder remembered in config.json");
  // missing folder
  fs.renameSync(F, F + "-gone"); await page.click('article.po [data-act="download"]'); await page.waitForTimeout(1500);
  console.log("toast (missing):", await page.textContent("#toast"));
  ok((await page.textContent("#toast")).includes("niet gevonden"), "missing folder gives a clear message");
  fs.renameSync(F + "-gone", F);
  // disconnect (in Settings)
  await goTab(page, "settings"); await page.click("#folderClear"); await page.waitForTimeout(800);
  ok(!(await page.isVisible("#folderPath")), "disconnect: the path is gone in Settings");
  await goTab(page, "docs"); ok(await page.isVisible("#docsNoFolder"), "disconnect returns to the folder card on the Documents tab"); await goTab(page, "inv");
  ok((await page.textContent("#zipAll")) === "Alles downloaden (.zip)", "batch button back to zip");
  ok((await page.textContent('article.po [data-act="download"]')).startsWith("Opnieuw downloaden") || (await page.textContent('article.po [data-act="download"]')).startsWith("Download"), "button back to download");
  // "Save all to the folder" with several POs: consecutive numbers (saving re-reads the folder; that must not shift the waiting cards)
  await goTab(page, "settings"); await page.click("#folderPick"); await page.waitForTimeout(800); await goTab(page, "inv");
  const pos = ["PO-100003", "PO-100004", "PO-100005", "PO-100006"].map((p) => tmp("po-folder/") + p + ".pdf");
  await page.setInputFiles("#file", pos); await page.waitForFunction(() => document.querySelectorAll("article.po h3").length === 5, null, { timeout: 20000 });
  const nrs = () => page.$$eval('article.po [data-k="nr"]', (i) => i.map((x) => x.value).filter((v) => v !== "65-2026")); const planned = await nrs(); console.log("planned:", planned);
  const pn = planned.map((x) => +x.split("-")[0]).sort((a, b) => a - b);
  ok(pn.every((n, i) => n === pn[0] + i), "the 4 cards have consecutive numbers: " + planned);
  await page.click("#zipAll"); for (let i = 0; i < 300 && !fs.existsSync(`${F}/VALKYRYS ${pn[pn.length - 1]}-2026.docx`); i++) await page.waitForTimeout(200); await page.waitForTimeout(1500);
  const saved = fs.readdirSync(F).filter((n) => /^VALKYRYS \d+-2026\.pdf$/.test(n)).map((n) => +n.match(/(\d+)-2026/)[1]).filter((n) => n >= pn[0]).sort((a, b) => a - b);
  ok(JSON.stringify(saved) === JSON.stringify(pn), "save all writes exactly those numbers, no gaps: " + saved);
  ok(pn.every((n) => fs.existsSync(`${F}/VALKYRYS ${n}-2026.docx`)), "and a Word file for each");
  const after = await nrs();
  ok(JSON.stringify([...after].sort()) === JSON.stringify([...planned].sort()), "the cards keep the numbers they were saved as: " + after);
  ok((await page.textContent("#nextNr")) === `${pn[pn.length - 1] + 1}-2026`, "next number follows the last saved one: " + (await page.textContent("#nextNr")));
  // the same PO again (65-2026 has it): ask before a second invoice
  await page.click("#clear"); await page.setInputFiles("#file", process.argv[3]); await page.waitForSelector("article.po h3");
  const nrDup = await page.inputValue('[data-k="nr"]'), dupFile = `${F}/VALKYRYS ${nrDup}.pdf`;
  ok((await page.textContent("article.po .checks")).includes("al gefactureerd als 65-2026"), "the card warns it was invoiced as 65-2026");
  await page.click('article.po [data-act="download-both"]'); await page.waitForSelector("#poDupDlg[open]");
  ok((await page.textContent("#poDupText")) === "PO-008148 is al gefactureerd als 65-2026. Toch nog een factuur maken?", "question: " + (await page.textContent("#poDupText")));
  ok((await page.textContent("#poDupGo")) === "Toch opslaan" && (await page.textContent("#poDupCancel")) === "Annuleren" && !(await page.isVisible("#poDupSkip")), "buttons Toch opslaan / Annuleren");
  await page.click("#poDupCancel"); await page.waitForTimeout(1500);
  ok(!fs.existsSync(dupFile) && !(await page.$("article.po .done")), "cancel: nothing saved");
  await page.click('article.po [data-act="download-both"]'); await page.waitForSelector("#poDupDlg[open]"); await page.click("#poDupGo");
  for (let i = 0; i < 50 && !fs.existsSync(dupFile.replace(".pdf", ".docx")); i++) await page.waitForTimeout(200); await page.waitForTimeout(500);
  ok(fs.existsSync(dupFile) && fs.existsSync(dupFile.replace(".pdf", ".docx")), "save anyway: " + nrDup + " saved as PDF + Word");
  // the × takes the card off the list
  await page.click('article.po [data-act="remove"]'); await page.waitForTimeout(300);
  ok((await page.$$("article.po")).length === 0, "the × removes the card");
  // IPC from a foreign page is refused
  const blocked = await app.evaluate(async ({ BrowserWindow, app }) => { const w = new BrowserWindow({ show: false, webPreferences: { preload: app.getAppPath() + "/preload.js", sandbox: true } }); await w.loadURL("data:text/html,<p>x</p>"); const r = await w.webContents.executeJavaScript("window.valkyrys.getFolder().then(()=>'ALLOWED',()=>'REFUSED')"); w.destroy(); return r; });
  ok(blocked === "REFUSED", "other pages cannot use the folder bridge (" + blocked + ")");
  console.log("errors:", errs);
  await app.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
