// The Settings tab, Statistics as the first tab, the first-start question about the folders, and moving the data of "Valkyrys Facturen" along to "Valkyrys app".
const { tmp, goTab, setLang, seedProfile } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const INV = tmp("np-inv"), PO = tmp("po-folder"), HOME = tmp("el-appdata-set");
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
  // the fixture folders are made fresh by tools/dev.sh before each test
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
  ok(await page.isVisible("#lockScreen"), "very first start: the lock screen comes first");
  ok(await page.isVisible('#lockScreen [data-lang="nl"]'), "...with the language first"); await page.click('#lockScreen [data-lang="nl"]');
  eq(await page.textContent("#lkTitle"), "Wil je de app beveiligen met een pincode?", "then the PIN question");
  await page.click("#lkAskNo"); await page.waitForSelector("#welcomeDlg[open]", { timeout: 15000 });
  ok(await open(page) && (await page.textContent("#welcomeTitle")) === "Welkom bij Valkyrys app", "...and then the folders are asked for");
  await app.close();

  // ---- 'Later': nothing chosen, never asked again, but the statistics point to Settings
  seed(HOME, { "pin.json": SKIP });
  ({ app, page, errs, pick } = await launch(HOME));
  ok(await open(page), "welcome window again on a new profile"); await page.click("#wsLater"); await page.waitForTimeout(400);
  ok(!(await open(page)), "'Later' closes it"); c = cfg(); eq([c.welcomed, c.folder, c.poFolder], [true, undefined, undefined], "nothing chosen, but it is not asked again");
  ok(await page.isVisible("#statsEmpty"), "statistics say there is nothing yet");
  ok(!(await page.$("#srcRow, #srcPath, #srcDot, #srcSettings")), "no 'read from' line under the statistics bar any more");
  eq(await page.textContent("#statsGoSettings"), "Map instellen", "the empty statistics offer to set a folder"); ok(await page.$eval("#statsGoSettings", (b) => b.classList.contains("primary")), "...as the main button");
  await page.click("#statsGoSettings"); await page.waitForTimeout(200);
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
  eq(await page.title(), "Valkyrys app", "window title"); eq(await page.textContent("#side .side-app"), "App", "sidebar: Valkyrys logo + App");
  ok(await page.evaluate(() => !document.querySelector("#appbar, .appbar, .seg-ind")), "no black bar on top any more, no sliding pill");
  ok(await page.$eval("#side .side-logo", (l) => getComputedStyle(l).maskImage.includes("logo-white.png") && l.getAttribute("aria-label") === "Valkyrys"), "sidebar: logo drawn from the logo file (mask), named for screen readers");
  { const [s, w] = [await page.locator("#side").boundingBox(), await page.evaluate(() => [innerWidth, innerHeight])];
    ok(s && s.x === 0 && s.y === 0 && s.width >= 172 && s.width <= 188 && s.height >= w[1] - 1, "sidebar on the left, full height, ~180px wide", s); }
  ok(await page.$eval("#pageTitle", (h) => h.getBoundingClientRect().left >= document.querySelector("#side").getBoundingClientRect().right), "page content sits right of the sidebar");
  eq(await page.$eval("#tabs", (n) => [n.getAttribute("role"), n.getAttribute("aria-orientation"), n.closest("#side") !== null]), ["tablist", "vertical", true], "the tabs are a vertical list in the sidebar");
  { const ys = await page.$$eval("#side .navi", (b) => b.map((x) => [x.id, Math.round(x.getBoundingClientRect().top)]));
    eq(ys.map((y) => y[0]), ["tabStats", "tabInv", "tabDocs", "newsBtn", "tabSettings"], "sidebar order: three tabs, then What's new and Settings");
    ok(ys.every((y, i) => !i || y[1] > ys[i - 1][1]) && ys[3][1] > 600, "stacked top to bottom, What's new and Settings at the bottom", ys); }
  eq(await page.textContent("#pageTitle"), "Statistieken", "page title: the selected tab");
  eq(await page.$$eval("#tabs [role=tab]", (t) => t.map((x) => [x.dataset.tab, x.textContent.trim(), x.getAttribute("aria-selected")])), [["stats", "Statistieken", "true"], ["inv", "Facturen", "false"], ["docs", "Documenten", "false"]], "tabs: Statistieken (selected), Facturen, Documenten");
  eq(await page.$eval("#tabSettings", (b) => [b.closest("#tabs") === null, b.getAttribute("role"), b.getAttribute("aria-label"), b.getAttribute("aria-pressed"), b.textContent.trim(), b.previousElementSibling && b.previousElementSibling.id]), [true, null, "Instellingen", "false", "Instellingen", "newsBtn"], "Settings is a gear item after What's new, outside the tabs");
  ok(await page.isVisible("#statsView") && !(await page.isVisible("#viewInv")) && !(await page.isVisible("#settingsView")), "the app opens on the statistics");
  eq(await page.textContent("#tagline"), "Je omzet en facturen in cijfers.", "its tagline");
  ok(await page.$eval("#side", (h) => !h.querySelector("#themeBtn, #lang, select, button:not([role=tab]):not(#newsBtn):not(#tabSettings):not(#sideToggle)")), "the sidebar has no theme button or language list, only the tabs, What's new, Settings and the collapse toggle");
  { const sel = await page.$eval("#tabStats", (b) => { const c = getComputedStyle(b), o = getComputedStyle(document.querySelector("#tabInv")); return [c.backgroundColor !== o.backgroundColor, getComputedStyle(b, "::before").content !== "none"]; });
    eq(sel, [true, true], "the selected tab is highlighted (tint + accent bar)"); }
  ok(await page.evaluate(() => !document.querySelector("#srcRow, #srcPath, #srcDot, #srcSettings, #srcPick, #srcOpen, #srcClear")), "no 'read from' line on the statistics: the folders are in Settings");
  ok(!(await page.isVisible("#statsGoSettings")), "folders set and found: no button to Settings on the statistics");
  await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(400); ok(!(await page.isVisible("#statsGoSettings")), "PO source with its folder: no button to Settings either");
  await goTab(page, "inv"); ok(await page.isVisible("#viewInv"), "Invoices tab opens");
  ok(!(await page.isVisible("#pinPanel")), "PIN is not on the Invoices tab");
  ok(await page.isVisible("#settingsBox") && await page.$eval("#settingsBox", (d) => d.tagName === "DETAILS" && d.closest("#viewInv") !== null && d.open), "invoice details are a fold-out in the Invoices sidebar, open while no client is set");
  ok(!(await page.$("#folderPanel")) && !(await page.isVisible("#folderPick")), "no folder list in the Invoices sidebar any more (it is the Documents tab), the choosing is in Settings");
  await goTab(page, "docs"); await page.waitForTimeout(200); ok(await page.isVisible("#docsView") && !(await page.isVisible("#viewInv")), "Documents tab opens"); eq(await page.textContent("#pageTitle"), "Documenten", "page title: Documenten");
  await goTab(page, "settings"); await page.waitForTimeout(200);
  ok(await page.isVisible("#settingsView") && !(await page.isVisible("#viewInv")) && !(await page.isVisible("#statsView")), "Settings tab opens");
  eq(await page.textContent("#tagline"), "Mappen, e-mail, pincode en weergave.", "its tagline"); eq(await page.textContent("#pageTitle"), "Instellingen", "page title follows the tab");
  ok(await page.$eval("#tabSettings", (b) => getComputedStyle(b, "::before").content !== "none"), "Settings item highlighted like a tab while open");
  eq([await page.getAttribute("#tabSettings", "aria-pressed"), await page.$$eval("#tabs [aria-selected=true]", (t) => t.length)], ["true", 0], "the gear button shows it is open, no tab is selected");
  eq(await page.$eval("#settingsView .col", (c) => [...c.children].filter((x) => !x.hidden)[0].id), "lookPanel", "theme and language come first in Settings");
  for (const [sel, what] of [["#setFolders", "folders"], ["#pinPanel", "PIN"], ["#lookPanel", "appearance"], ["#themeBtn", "theme button"], ["#lang", "language list"], ["#folderPick", "invoice folder button"], ["#poFolderPick", "PO folder button"]]) ok(await page.isVisible(sel), "Settings has: " + what);
  eq(await page.textContent("#folderPath"), INV, "invoice folder shown"); eq(await page.textContent("#poFolderPath"), PO, "PO folder shown");
  eq(await page.$$eval("#setFolders .fsub", (e) => e.map((x) => x.textContent)), ["Map met facturen", "Map met inkooporders"], "both folders have their own block");
  eq([await page.textContent("#folderPick"), await page.textContent("#poFolderPick")], ["Andere map…", "Andere map…"], "buttons say 'change' when a folder is set");
  ok(await page.isVisible("#folderOpen") && await page.isVisible("#folderClear") && await page.isVisible("#poFolderOpen") && await page.isVisible("#poFolderClear"), "open and disconnect for both");
  await page.click("#poFolderOpen"); await page.waitForTimeout(200); eq(await app.evaluate(() => globalThis.__opened), [PO], "open folder opens the PO folder");
  // change the PO folder here and see it on the statistics
  fs.rmSync(tmp("po-other"), { recursive: true, force: true }); fs.mkdirSync(tmp("po-other")); await pick(tmp("po-other"));
  await page.click("#poFolderPick"); await page.waitForTimeout(800); eq(await page.textContent("#poFolderPath"), tmp("po-other"), "PO folder changed in Settings"); eq(cfg().poFolder, tmp("po-other"), "...and remembered");
  await goTab(page, "stats"); await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(500); eq(await page.textContent("#statsEmpty"), "Geen inkooporders gevonden in deze map.", "the statistics read from the new (empty) PO folder"); ok(!(await page.isVisible("#statsGoSettings")), "...the folder is set, so no button to Settings");
  // the PO folder disappears: the statistics warn in their empty state (no permanent line) and offer a way to Settings
  fs.rmSync(tmp("po-other"), { recursive: true, force: true }); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.waitForTimeout(1500);
  eq(await page.textContent("#statsEmpty"), "Deze map is niet gevonden. Is de schijf aangesloten? Kies de map opnieuw.", "missing PO folder: said in the statistics");
  ok(await page.$eval("#statsEmpty", (e) => e.classList.contains("bad")), "...as a warning");
  eq(await page.textContent("#statsGoSettings"), "Naar instellingen", "...with a button to Settings"); await page.click("#statsGoSettings"); await page.waitForTimeout(200);
  ok(await page.isVisible("#settingsView") && !(await page.isVisible("#statsView")), "which opens Settings");
  await goTab(page, "settings"); await page.click("#poFolderClear"); await page.waitForTimeout(500);
  ok(!(await page.isVisible("#poFolderPath")) && (await page.textContent("#poFolderPick")) === "Kies map…", "disconnecting the PO folder works from Settings");
  await pick(PO); await page.click("#poFolderPick"); await page.waitForTimeout(600);
  const labelsFit = () => page.evaluate(() => [...document.querySelectorAll("#side .navi, #side .side-brand")].filter((b) => { const l = b.querySelector(".lbl") || b; return l.scrollWidth > l.clientWidth + 0.5 || b.getBoundingClientRect().right > document.querySelector("#side").getBoundingClientRect().right - 12 || (b.querySelector(".lbl") && b.querySelector(".lbl").getBoundingClientRect().height > 24); }).map((b) => b.textContent.trim()));
  await page.evaluate(() => { document.querySelector("#newsDot").hidden = false; }); // the dot must fit next to the longest "What's new" too
  eq(await labelsFit(), [], "180px: every sidebar label fits on one line (nl)");
  // language and theme live here now
  await page.selectOption("#lang", "en"); await page.waitForTimeout(300);
  eq(await page.$$eval("#tabs [role=tab]", (t) => t.map((x) => x.textContent.trim())), ["Statistics", "Invoices", "Documents"], "language list in Settings switches the app (English)"); eq(await page.getAttribute("#tabSettings", "aria-label"), "Settings", "gear button label in English"); eq(await labelsFit(), [], "180px: every sidebar label fits on one line (en)");
  eq(await page.textContent("#pageTitle"), "Settings", "page title in English");
  eq(await page.textContent("#folderHelp"), "Choose a folder where your invoices are kept. New invoices are saved there automatically and the app shows everything that is already in it.", "English help text for the invoice folder");
  await page.selectOption("#lang", "pl"); await page.waitForTimeout(300);
  eq(await page.$$eval("#tabs [role=tab]", (t) => t.map((x) => x.textContent.trim())), ["Statystyki", "Faktury", "Dokumenty"], "Polish"); eq(await page.getAttribute("#tabSettings", "aria-label"), "Ustawienia", "gear button label in Polish"); eq(await page.textContent("#pageTitle"), "Ustawienia", "page title in Polish"); eq(await labelsFit(), [], "180px: every sidebar label fits on one line (pl, with the What's new dot)");
  eq([await page.getAttribute("#sideToggle", "aria-label"), await page.textContent("#sideToggle")], ["Zwiń pasek boczny", "Zwiń"], "collapse toggle in Polish");
  eq(await page.textContent("#poFolderPick"), "Zmień folder…", "Polish button");
  await page.selectOption("#lang", "nl"); await page.waitForTimeout(300);
  await page.click("#themeBtn"); ok(await page.$eval("#themeDlg", (d) => d.open), "theme button opens the theme window"); await page.click("#themeClose");
  ok(!(await page.isVisible("#settings")), "invoice details are not on the Settings tab");
  // invoice details are saved from the Invoices tab
  await goTab(page, "inv"); await page.$eval("#settingsBox", (d) => { d.open = true; }); await page.fill("#sTerm", "21 dagen"); await page.fill("#cName", "Piguillet BV test"); await page.click('#settings button[type="submit"]'); await page.waitForTimeout(600);
  const saved = JSON.parse(fs.readFileSync(D(HOME) + "/data.json", "utf8"))["settings/main"]; eq([saved.betaaltermijn, saved.client.name], ["21 dagen", "Piguillet BV test"], "invoice details are saved from the Invoices tab"); await goTab(page, "settings");
  // keyboard: arrows move through the three tabs
  ok(await page.$eval("#tabStats", (b) => b.tabIndex === 0), "with Settings open the first tab can still be reached with Tab");
  await page.focus("#tabDocs"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
  eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "stats", "arrow right from the last tab wraps to the first (Settings is not in the round)");
  eq(await page.getAttribute("#tabSettings", "aria-pressed"), "false", "gear button no longer pressed");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
  eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "docs", "two more arrows reach Documents");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "tabDocs"), "focus follows the selected tab");
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(100); eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "inv", "arrow left goes back to Facturen");
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(100); eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "stats", "arrow up goes to the tab above (vertical list)");
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(100); eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "docs", "arrow up from the first wraps to the last");
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(100); eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "stats", "arrow down wraps to the first");
  await page.keyboard.press("Home"); await page.keyboard.press("End"); await page.waitForTimeout(150);
  eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "docs", "End reaches Documents, the last work tab");
  await page.keyboard.press("Home"); await page.waitForTimeout(100); eq(await page.$eval("#tabs [aria-selected=true]", (t) => t.dataset.tab), "stats", "Home reaches the first tab");
  // the collapse toggle: icon rail and back, remembered
  const sideState = () => page.evaluate(() => { const s = document.querySelector("#side").getBoundingClientRect(), b = [...document.querySelectorAll("#side .navi")], t = document.querySelector("#sideToggle");
    return { w: Math.round(s.width), labelsHidden: b.every((x) => x.querySelector(".lbl").getBoundingClientRect().width <= 1), titles: b.map((x) => x.title), aria: [t.getAttribute("aria-label"), t.getAttribute("aria-expanded")], icons: b.map((x) => { const r = x.querySelector("svg").getBoundingClientRect(); return Math.round(r.left + r.width / 2); }), content: Math.round(document.querySelector("#pageTitle").getBoundingClientRect().left - s.right), stored: localStorage.getItem("valkyrys-side") }; });
  const open0 = await sideState();
  eq([open0.aria, open0.labelsHidden, open0.titles.every((t) => !t)], [["Zijbalk inklappen", "true"], false, true], "expanded: toggle says 'Zijbalk inklappen', aria-expanded, labels shown, no tooltips");
  await page.screenshot({ path: "/tmp/sb2_open_light.png" });
  await page.click("#sideToggle"); await page.waitForTimeout(400);
  const shut = await sideState();
  ok(shut.w <= 72 && shut.w >= 56 && shut.labelsHidden, "collapsed: an icon rail, labels hidden", shut);
  eq(shut.titles, ["Statistieken", "Facturen", "Documenten", "Nieuw", "Instellingen"], "collapsed: labels as tooltips");
  eq([shut.aria, shut.stored], [["Zijbalk uitklappen", "false"], "min"], "collapsed: toggle says 'Zijbalk uitklappen', aria-expanded=false, remembered");
  eq(shut.icons, open0.icons, "the icons do not move sideways between the two states");
  ok(shut.content >= 0 && open0.content >= 0 && shut.w + shut.content < open0.w + open0.content + 1, "the page follows the sidebar (moves left, never under it)", [shut, open0]);
  ok(await page.$eval("#side .side-app", (e) => !e.offsetWidth), "collapsed: only the emblem of the logo");
  await page.waitForTimeout(800); eq((JSON.parse(fs.readFileSync(D(HOME) + "/data.json", "utf8"))["settings/prefs"] || {}).side, "min", "...also saved in settings/prefs");
  await page.reload(); await page.waitForSelector("#statsView", { state: "attached" }); await page.waitForTimeout(1200);
  ok((await sideState()).w <= 72, "collapsed state stays after a reload");
  await page.keyboard.press("Control+b"); await page.waitForTimeout(400);
  { const r = await sideState(); ok(r.w >= 172 && r.w <= 188 && !r.labelsHidden && r.aria[1] === "true" && r.stored === "full", "Ctrl+B expands it again", r); }
  await page.keyboard.press("Control+b"); await page.waitForTimeout(400); ok((await sideState()).w <= 72, "Ctrl+B collapses it");
  await page.click("#sideToggle"); await page.waitForTimeout(400); ok((await sideState()).w >= 172, "the toggle expands it");
  // narrow windows: an icon rail at 800px (labels as tooltips), a bar at the bottom at 420px
  await page.setViewportSize({ width: 800, height: 900 }); await page.waitForTimeout(300);
  { const r = await page.evaluate(() => { const s = document.querySelector("#side").getBoundingClientRect(), b = [...document.querySelectorAll("#side .navi")];
      return { w: s.width, h: s.height, labelsHidden: b.every((x) => x.querySelector(".lbl").getBoundingClientRect().width <= 1), titles: b.map((x) => x.title), names: b.map((x) => x.getAttribute("aria-label") || x.textContent.trim()), content: document.querySelector("#pageTitle").getBoundingClientRect().left >= s.right, fits: document.documentElement.scrollWidth <= innerWidth + 1 }; });
    ok(r.w >= 56 && r.w <= 80 && r.labelsHidden && r.content && r.fits, "800px: the sidebar is an icon rail, the page beside it", r);
    eq(r.titles, ["Statistieken", "Facturen", "Documenten", "Nieuw", "Instellingen"], "800px: labels as tooltips");
    ok(r.names.every((n) => n.length > 2), "800px: every item keeps a name for screen readers", r.names); }
  ok(!(await page.isVisible("#sideToggle")), "800px: the rail is forced, no toggle");
  await page.keyboard.press("Control+b"); await page.waitForTimeout(300); eq(await page.evaluate(() => localStorage.getItem("valkyrys-side")), "full", "800px: Ctrl+B does nothing");
  await page.click("#tabInv"); eq(await page.textContent("#pageTitle"), "Facturen", "800px: the rail switches tabs");
  await page.setViewportSize({ width: 420, height: 860 }); await page.waitForTimeout(300);
  { const r = await page.evaluate(() => { const s = document.querySelector("#side").getBoundingClientRect(), b = [...document.querySelectorAll("#side .navi")].map((x) => x.getBoundingClientRect());
      return { bottom: Math.round(s.bottom) === innerHeight, wide: s.width >= document.documentElement.clientWidth - 1, row: b.every((x) => Math.abs(x.top - b[0].top) < 2), big: b.every((x) => x.width >= 60 && x.height >= 44), fits: document.documentElement.scrollWidth <= innerWidth + 1 }; });
    eq(r, { bottom: true, wide: true, row: true, big: true, fits: true }, "420px: a bar at the bottom with five items, big enough to tap, nothing too wide"); }
  await page.click("#tabDocs"); eq(await page.textContent("#pageTitle"), "Documenten", "420px: the bottom bar switches tabs"); await page.click("#tabStats");
  await page.setViewportSize({ width: 1280, height: 1000 }); await page.waitForTimeout(200);
  ok(await page.$eval("#tabStats", (b) => !b.title), "wide again: no tooltips on the labelled items");
  // the Settings tab on a phone
  await goTab(page, "settings"); await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Settings fits a phone-width window");
  await page.screenshot({ path: "/tmp/settings-phone.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 }); await page.waitForTimeout(200); await page.screenshot({ path: "/tmp/settings-wide.png", fullPage: true });
  console.log("errors:", errs); ok(errs.length === 0, "no page errors");
  // collapse, restart the app: still collapsed (dark screenshots of both states)
  await page.click("#sideToggle"); await page.waitForTimeout(800); await app.close();
  ({ app, page, errs } = await launch(HOME));
  await page.evaluate(() => { const t = { id: "dark", custom: null }; window.ValkTheme.save(t); window.ValkTheme.apply(t); });
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(400);
  ok((await sideState()).w <= 72 && (await page.getAttribute("#sideToggle", "aria-expanded")) === "false", "collapsed state stays after a restart");
  await page.screenshot({ path: "/tmp/sb2_closed.png" });
  await page.click("#sideToggle"); await page.mouse.move(700, 500); await page.waitForTimeout(400); await page.screenshot({ path: "/tmp/sb2_open.png" });
  ok(errs.length === 0, "no page errors after the restart", errs);
  await app.close();
  console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
