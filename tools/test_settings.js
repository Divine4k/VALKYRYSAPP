// The Settings tab, Statistics as the first tab, the first-start question about the folders, and moving the data of "Valkyrys Facturen" along to "Valkyrys app".
const { goTab, setLang, seedProfile } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const INV = "/tmp/np-inv", PO = "/tmp/po-folder", HOME = "/tmp/el-appdata-set";
const D = (h = HOME, n = "Valkyrys app") => path.join(h, n);
const seed = (home, files, dirName = "Valkyrys app") => { if (!files["data.json"]) files = { ...files, "data.json": { "settings/main": { ...require("../electron-app/server.js").DEFAULT_SETTINGS, template: "valkyrys" } } }; // the design is chosen already (test_templates covers choosing it)
  fs.rmSync(home, { recursive: true, force: true }); fs.mkdirSync(path.join(home, dirName), { recursive: true }); for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(home, dirName, n), typeof c === "string" ? c : JSON.stringify(c)); };
const SKIP = '{"v":1,"skipped":true}';
const launch = async (home) => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: home, XDG_CONFIG_HOME: home } });
  await app.evaluate(({ dialog, shell }) => { globalThis.__pick = ""; globalThis.__opened = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__pick] }); shell.openPath = async (p) => { globalThis.__opened.push(p); return ""; }; });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 }).catch(() => {});
  await page.waitForSelector("#statsView", { state: "attached" }); await page.waitForTimeout(1800);
  return { app, page, errs, pick: (p) => app.evaluate((_, p) => { globalThis.__pick = p; }, p) };
};
const cfg = (home = HOME) => { try { return JSON.parse(fs.readFileSync(path.join(D(home), "config.json"), "utf8")); } catch (e) { return null; } };
const open = (page) => page.$eval("#welcomeDlg", (d) => d.open);
(async () => {
  // ================= first start: the folders are asked for first
  require("child_process").execSync("/tmp/rt/fresh.sh");
  seed(HOME, { "pin.json": SKIP });
  let { app, page, errs, pick } = await launch(HOME);
  ok(await open(page), "first start: the welcome window is open");
  eq(await page.textContent("#welcomeTitle"), "Welkom bij Valkyrys app", "it greets with the new name");
  ok((await page.textContent("#welcomeText")).startsWith("Stel eerst je mappen in."), "and asks for the folders first: " + (await page.textContent("#welcomeText")).slice(0, 60));
  eq([await page.textContent("#wsInvPath"), await page.textContent("#wsPoPath")], ["Nog niet gekozen", "Nog niet gekozen"], "neither folder is chosen yet");
  ok(await page.isDisabled("#wsDone"), "'Klaar' waits for at least one folder");
  ok(await page.isVisible("#statsView"), "the statistics are what is behind it");
  await pick(INV); await page.click("#wsInvPick"); await page.waitForTimeout(800);
  eq(await page.textContent("#wsInvPath"), INV, "invoice folder chosen in the window"); ok(await page.$eval("#wsInv", (e) => e.classList.contains("ok")), "step 1 is marked as done");
  ok(!(await page.isDisabled("#wsDone")), "'Klaar' works now");
  await pick(PO); await page.click("#wsPoPick"); await page.waitForTimeout(800);
  eq(await page.textContent("#wsPoPath"), PO, "PO folder chosen in the window");
  await page.screenshot({ path: "/tmp/welcome.png" });
  await page.click("#wsDone"); await page.waitForTimeout(600);
  ok(!(await open(page)), "the window closes");
  let c = cfg(); eq([c.folder, c.poFolder, c.welcomed], [INV, PO, true], "both folders and 'asked' are remembered");
  await app.close();
  ({ app, page, errs, pick } = await launch(HOME));
  ok(!(await open(page)), "next start: not asked again");
  eq(await page.textContent("#folderPath").catch(() => ""), INV, "the invoice folder is still set (Settings)");
  await app.close();

  // ---- the very first start has the PIN question too: after it, the folders are asked for
  seed(HOME, {});
  ({ app, page } = await launch(HOME));
  ok(await page.isVisible("#lockScreen"), "very first start: the PIN question comes first");
  await page.click("#lkLater"); await page.waitForSelector("#welcomeDlg[open]", { timeout: 15000 });
  ok(await open(page) && (await page.textContent("#welcomeTitle")) === "Welkom bij Valkyrys app", "...and then the folders are asked for");
  await app.close();

  // ---- 'Later': nothing chosen, never asked again, but the statistics point to Settings
  seed(HOME, { "pin.json": SKIP });
  ({ app, page, errs, pick } = await launch(HOME));
  ok(await open(page), "welcome window again on a new profile"); await page.click("#wsLater"); await page.waitForTimeout(400);
  ok(!(await open(page)), "'Later' closes it"); c = cfg(); eq([c.welcomed, c.folder, c.poFolder], [true, undefined, undefined], "nothing chosen, but it is not asked again");
  ok(await page.isVisible("#statsEmpty"), "statistics say there is nothing yet");
  eq(await page.textContent("#srcSettings"), "Map instellen", "the line under the tabs offers to set a folder"); ok(await page.$eval("#srcSettings", (b) => b.classList.contains("primary")), "...as the main button");
  await page.click("#srcSettings"); await page.waitForTimeout(200);
  ok(await page.isVisible("#settingsView") && await page.isVisible("#setFolders") && !(await page.isVisible("#statsView")), "it opens Settings");
  await app.close();
  ({ app, page } = await launch(HOME)); ok(!(await open(page)), "after 'Later' the next start does not ask"); await app.close();

  // ---- an update of the older version: the folders are there already, so nothing is asked
  seed(HOME, { "pin.json": SKIP, "config.json": { folder: INV } });
  ({ app, page } = await launch(HOME));
  ok(!(await open(page)), "folders already set: no welcome window"); await page.waitForTimeout(500); eq(cfg().welcomed, true, "and it is remembered that nothing needs asking");
  await app.close();

  // ================= the data of the old name is moved along
  fs.rmSync(HOME, { recursive: true, force: true });
  seed(HOME, { "pin.json": SKIP, "config.json": { folder: INV, poFolder: PO, welcomed: true }, "data.json": { "settings/main": { startNumber: 77, startYear: 2026, betaaltermijn: "30 dagen", btw: "verlegd", fileTemplate: "VALKYRYS {nummer}", client: { name: "Piguillet BV", street: "x", city: "y", kvk: "52742938", btw: "NL1" } } } }, "Valkyrys Facturen");
  ({ app, page } = await launch(HOME));
  ok(fs.existsSync(D(HOME)) && !fs.existsSync(D(HOME, "Valkyrys Facturen")), "the old data folder was renamed to the new name");
  eq(await page.inputValue("#sStart"), "77", "settings of the old version are there (start number)"); eq(await page.inputValue("#sTerm"), "30 dagen", "...and the payment term");
  eq(await page.textContent("#folderPath"), INV, "...and the invoice folder"); eq(await page.textContent("#poFolderPath"), PO, "...and the PO folder");
  eq(await app.evaluate(({ app }) => app.getPath("userData")), D(HOME), "userData is the new folder");
  await app.close();
  // a new folder exists already (empty leftover): the three files are copied over when missing, nothing is overwritten
  seed(HOME, { "pin.json": SKIP, "config.json": { folder: INV, welcomed: true }, "data.json": { "settings/main": { startNumber: 91, startYear: 2026, betaaltermijn: "14 dagen", btw: "verlegd", fileTemplate: "VALKYRYS {nummer}", client: { name: "Piguillet BV", street: "x", city: "y", kvk: "52742938", btw: "NL1" } } } }, "Valkyrys Facturen");
  fs.mkdirSync(D(HOME), { recursive: true }); fs.writeFileSync(D(HOME) + "/config.json", JSON.stringify({ poFolder: PO, welcomed: true }));
  ({ app, page } = await launch(HOME));
  eq(await page.inputValue("#sStart"), "91", "leftover new folder: data.json copied from the old one"); eq(await page.textContent("#poFolderPath"), PO, "an existing config.json in the new folder is kept, not overwritten");
  await app.close();

  // ================= the tabs and the Settings tab (a profile that is set up)
  seed(HOME, { "pin.json": SKIP, "config.json": { folder: INV, poFolder: PO, welcomed: true } });
  ({ app, page, errs, pick } = await launch(HOME));
  eq(await page.title(), "Valkyrys app", "window title"); eq(await page.textContent("header.band h1"), "APP".replace("APP", "App"), "header: Valkyrys + App");
  eq(await page.$$eval("#tabs [role=tab]", (t) => t.map((x) => [x.dataset.tab, x.textContent.trim(), x.getAttribute("aria-selected")])), [["stats", "Statistieken", "true"], ["inv", "Facturen", "false"], ["settings", "Instellingen", "false"]], "tabs: Statistieken (selected), Facturen, Instellingen");
  ok(await page.isVisible("#statsView") && !(await page.isVisible("#viewInv")) && !(await page.isVisible("#settingsView")), "the app opens on the statistics");
  eq(await page.textContent("#tagline"), "Je omzet en facturen in cijfers.", "its tagline");
  ok(await page.$eval("header.band", (h) => !h.querySelector("#themeBtn, #lang, select, button")), "the header has no theme button or language list any more");
  ok(await page.evaluate(() => !document.querySelector("#srcPick, #srcOpen, #srcClear")), "the read-from line has no folder buttons any more");
  eq(await page.textContent("#srcSettings"), "Wijzigen bij Instellingen", "it links to Settings instead");
  ok(await page.isVisible("#srcPath") && (await page.textContent("#srcPath")) === INV, "and still says where the figures come from: " + (await page.textContent("#srcPath")));
  await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(400); eq(await page.textContent("#srcPath"), PO, "PO source: the PO folder");
  await goTab(page, "inv"); ok(await page.isVisible("#viewInv"), "Invoices tab opens");
  ok(!(await page.isVisible("#pinPanel")) && !(await page.isVisible("#settings")), "PIN and invoice settings are no longer there");
  ok(await page.isVisible("#folderPanel") && !(await page.isVisible("#folderPick")) && !(await page.isVisible("#folderGoSet")), "folder list stays (what is in it), the choosing moved");
  await goTab(page, "settings"); await page.waitForTimeout(200);
  ok(await page.isVisible("#settingsView") && !(await page.isVisible("#viewInv")) && !(await page.isVisible("#statsView")), "Settings tab opens");
  eq(await page.textContent("#tagline"), "Mappen, pincode, weergave en je factuurgegevens.", "its tagline");
  for (const [sel, what] of [["#setFolders", "folders"], ["#pinPanel", "PIN"], ["#lookPanel", "appearance"], ["#settingsBox", "invoice details"], ["#themeBtn", "theme button"], ["#lang", "language list"], ["#folderPick", "invoice folder button"], ["#poFolderPick", "PO folder button"]]) ok(await page.isVisible(sel), "Settings has: " + what);
  eq(await page.textContent("#folderPath"), INV, "invoice folder shown"); eq(await page.textContent("#poFolderPath"), PO, "PO folder shown");
  eq(await page.$$eval("#setFolders .fsub", (e) => e.map((x) => x.textContent)), ["Map met facturen", "Map met inkooporders"], "both folders have their own block");
  eq([await page.textContent("#folderPick"), await page.textContent("#poFolderPick")], ["Andere map…", "Andere map…"], "buttons say 'change' when a folder is set");
  ok(await page.isVisible("#folderOpen") && await page.isVisible("#folderClear") && await page.isVisible("#poFolderOpen") && await page.isVisible("#poFolderClear"), "open and disconnect for both");
  await page.click("#poFolderOpen"); await page.waitForTimeout(200); eq(await app.evaluate(() => globalThis.__opened), [PO], "open folder opens the PO folder");
  // change the PO folder here and see it on the statistics
  fs.rmSync("/tmp/po-other", { recursive: true, force: true }); fs.mkdirSync("/tmp/po-other"); await pick("/tmp/po-other");
  await page.click("#poFolderPick"); await page.waitForTimeout(800); eq(await page.textContent("#poFolderPath"), "/tmp/po-other", "PO folder changed in Settings"); eq(cfg().poFolder, "/tmp/po-other", "...and remembered");
  await goTab(page, "stats"); await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(500); eq(await page.textContent("#srcPath"), "/tmp/po-other", "the statistics read from the new PO folder");
  await goTab(page, "settings"); await page.click("#poFolderClear"); await page.waitForTimeout(500);
  ok(!(await page.isVisible("#poFolderPath")) && (await page.textContent("#poFolderPick")) === "Kies map…", "disconnecting the PO folder works from Settings");
  await pick(PO); await page.click("#poFolderPick"); await page.waitForTimeout(600);
  // language and theme live here now
  await page.selectOption("#lang", "en"); await page.waitForTimeout(300);
  eq(await page.$$eval("#tabs [role=tab]", (t) => t.map((x) => x.textContent.trim())), ["Statistics", "Invoices", "Settings"], "language list in Settings switches the app (English)");
  eq(await page.textContent("#folderHelp"), "Choose a folder where your invoices are kept. New invoices are saved there automatically and the app shows everything that is already in it.", "English help text for the invoice folder");
  await page.selectOption("#lang", "pl"); await page.waitForTimeout(300);
  eq(await page.$$eval("#tabs [role=tab]", (t) => t.map((x) => x.textContent.trim())), ["Statystyki", "Faktury", "Ustawienia"], "Polish");
  eq(await page.textContent("#poFolderPick"), "Zmień folder…", "Polish button");
  await page.selectOption("#lang", "nl"); await page.waitForTimeout(300);
  await page.click("#themeBtn"); ok(await page.$eval("#themeDlg", (d) => d.open), "theme button opens the theme window"); await page.click("#themeClose");
  // invoice details are saved from Settings
  await page.fill("#sTerm", "21 dagen"); await page.fill("#cName", "Piguillet BV test"); await page.click('#settings button[type="submit"]'); await page.waitForTimeout(600);
  const saved = JSON.parse(fs.readFileSync(D(HOME) + "/data.json", "utf8"))["settings/main"]; eq([saved.betaaltermijn, saved.client.name], ["21 dagen", "Piguillet BV test"], "invoice details are saved from Settings");
  // keyboard: arrows move through the three tabs
  await page.focus("#tabSettings"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
  eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "stats", "arrow right from the last tab wraps to the first");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
  eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "settings", "two more arrows reach Settings");
  // the Settings tab on a phone
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Settings fits a phone-width window");
  await page.screenshot({ path: "/tmp/settings-phone.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 }); await page.waitForTimeout(200); await page.screenshot({ path: "/tmp/settings-wide.png", fullPage: true });
  console.log("errors:", errs); ok(errs.length === 0, "no page errors");
  await app.close();
  console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
