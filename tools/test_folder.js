const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { goTab, setLang, seedProfile } = require("./test_helpers");
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const dataHome = "/tmp/el-appdata-f"; fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  const F = "/tmp/inv-folder"; fs.rmSync(F, { recursive: true, force: true }); fs.mkdirSync(F + "/2025", { recursive: true });
  for (const n of ["VALKYRYS 64-2026.pdf", "VALKYRYS 64-2026.docx", "Factuur 15-01-2026.pdf", "~$VALKYRYS 64-2026.docx", "notes.txt", "2025/VALKYRYS 10-2025.pdf"]) fs.writeFileSync(path.join(F, n), "x");
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  // stub the OS dialogs / file opening
  await app.evaluate(({ dialog, shell }, F) => { globalThis.__opened = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [F] }); shell.openPath = async (p) => { globalThis.__opened.push(p); return ""; }; }, F);
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(600);
  ok(await page.isVisible("#folderPanel"), "folder panel visible in the desktop app");
  ok((await page.textContent("#nextNr")) === "62-2026", "next number before folder = " + (await page.textContent("#nextNr")));
  ok(await page.isVisible("#folderIntro") && await page.isVisible("#folderGoSet"), "Invoices tab says where to set the folder");
  await goTab(page, "settings"); ok(await page.isVisible("#setFolders") && !(await page.isVisible("#folderOpen")) && !(await page.isVisible("#folderPath")), "Settings: folder not chosen yet, no path");
  ok((await page.textContent("#dlgTitle")) !== null, "page alive");
  await page.click("#folderPick"); await page.waitForTimeout(800);
  ok((await page.textContent("#folderPath")) === F, "path shown: " + (await page.textContent("#folderPath")));
  ok(await page.isVisible("#folderOpen") && await page.isVisible("#folderClear"), "open and disconnect buttons appear");
  await goTab(page, "inv");
  const items = await page.$$eval("#files li", (li) => li.map((l) => l.innerText.replace(/\s+/g, " ")));
  console.log(items);
  ok(items.length === 3, "3 invoices listed (lock file and txt ignored): " + items.length);
  ok(items.some((t) => t.includes("VALKYRYS 64-2026") && t.includes("PDF") && t.includes("Word")), "64-2026 has PDF + Word buttons");
  ok(items.some((t) => t.includes("VALKYRYS 10-2025") && t.includes("2025")), "subfolder file listed with its folder");
  ok((await page.textContent("#nextNr")) === "65-2026", "next number skips the folder's 64: " + (await page.textContent("#nextNr")));
  console.log("info:", await page.textContent("#folderInfo"));
  ok((await page.textContent("#folderInfo")).includes("64-2026"), "highest number shown");
  ok((await page.textContent("#zipAll")) === "Alles opslaan in de map", "batch button relabelled");
  // add a PO, save
  await page.setInputFiles("#file", process.argv[3]); await page.waitForSelector("article.po h3");
  ok((await page.inputValue('[data-k="nr"]')) === "65-2026", "card numbered 65-2026");
  ok((await page.textContent('article.po [data-act="download"]')) === "Opslaan als PDF", "button says 'Opslaan als PDF'");
  await page.click('article.po [data-act="download"]'); await page.waitForTimeout(2500);
  ok(fs.existsSync(F + "/VALKYRYS 65-2026.pdf") && fs.statSync(F + "/VALKYRYS 65-2026.pdf").size > 10000, "PDF saved into the folder (" + (fs.existsSync(F + "/VALKYRYS 65-2026.pdf") && fs.statSync(F + "/VALKYRYS 65-2026.pdf").size) + " bytes)");
  console.log("toast:", await page.textContent("#toast"));
  await page.click('article.po [data-act="download-docx"]'); await page.waitForTimeout(2500);
  ok(fs.existsSync(F + "/VALKYRYS 65-2026.docx"), "Word saved into the folder");
  ok(!fs.readdirSync(F).some((n) => n.endsWith(".part")), "no temp files left");
  ok((await page.$$eval("#files li", (l) => l.length)) === 4, "list now has 4 invoices");
  ok((await page.textContent("#nextNr")) === "66-2026", "next number now " + (await page.textContent("#nextNr")));
  // redo from history overwrites, no (2) copy
  const before = fs.statSync(F + "/VALKYRYS 65-2026.pdf").mtimeMs; await page.waitForTimeout(50);
  await page.click('#hist button[data-redo="65-2026"]:not([data-fmt])'); await page.waitForTimeout(2500);
  ok(!fs.readdirSync(F).some((n) => n.includes("(2)")), "re-saving the same invoice replaces the file");
  ok(fs.statSync(F + "/VALKYRYS 65-2026.pdf").mtimeMs > before, "file was rewritten");
  // open a file from the list
  await page.click('#files button[data-open="VALKYRYS 65-2026.pdf"]'); await page.waitForTimeout(300);
  console.log("opened:", await app.evaluate(() => globalThis.__opened));
  ok((await app.evaluate(() => globalThis.__opened)).includes(F + "/VALKYRYS 65-2026.pdf"), "clicking PDF opens the file");
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
  await goTab(page, "inv"); ok(await page.isVisible("#folderIntro"), "disconnect returns to the intro on the Invoices tab");
  ok((await page.textContent("#zipAll")) === "Alles downloaden (.zip)", "batch button back to zip");
  ok((await page.textContent('article.po [data-act="download"]')).startsWith("Opnieuw downloaden") || (await page.textContent('article.po [data-act="download"]')).startsWith("Download"), "button back to download");
  // IPC from a foreign page is refused
  const blocked = await app.evaluate(async ({ BrowserWindow, app }) => { const w = new BrowserWindow({ show: false, webPreferences: { preload: app.getAppPath() + "/preload.js", sandbox: true } }); await w.loadURL("data:text/html,<p>x</p>"); const r = await w.webContents.executeJavaScript("window.valkyrys.getFolder().then(()=>'ALLOWED',()=>'REFUSED')"); w.destroy(); return r; });
  ok(blocked === "REFUSED", "other pages cannot use the folder bridge (" + blocked + ")");
  console.log("errors:", errs);
  await app.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
