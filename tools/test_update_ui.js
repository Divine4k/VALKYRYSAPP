// In-app updates, the page side: the Updates panel in Settings, the bars at the bottom of the content, the dot on Settings.
// The real bridge (window.valkyrysUpdate from the preload) cannot be replaced, so a stand-in goes into window.__valkUpdateFake (read first by the page).
// Its starting state comes from localStorage "fake-upd" ({state} or {none: true} = a plain browser), set before a reload.
const { _electron: electron } = require("playwright"); const fs = require("fs");
const { tmp, goTab, setLang, seedProfile, goSet } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const HOME = tmp("el-appdata-upd");
const LATEST = (v = "1.2.1") => ({ version: v, date: "2026-11-12", size: 95 * 1048576, notes: [
  { type: "fixed", nl: "Fout opgelost", en: "Bug fixed", pl: "Błąd naprawiony" },
  { type: "new", nl: "Nieuw ding", en: "New thing", pl: "Nowa rzecz" }] });
const FAKE = () => {
  let cfg = {}; try { cfg = JSON.parse(localStorage.getItem("fake-upd") || "{}"); } catch (e) {}
  if (cfg.none) { window.__valkUpdateFake = null; return; }
  let st = cfg.state || { running: "1.2.0", bundled: "1.2.0", status: "uptodate", lastCheck: new Date(Date.now() - 10 * 60000).toISOString() };
  const subs = new Set(), calls = [];
  const push = (s) => { st = s; subs.forEach((f) => f(s)); };
  window.__fake = { calls, push, get st() { return st; }, finish: null };
  window.__valkUpdateFake = {
    state: async () => { calls.push("state"); return st; },
    check: async () => { calls.push("check"); await new Promise((r) => setTimeout(r, 400)); st = { ...st, status: "available", latest: cfg.latest, lastCheck: new Date().toISOString() }; return st; },
    install: () => { calls.push("install"); return new Promise((res) => { window.__fake.finish = () => { st = { ...st, status: "ready", progress: 1 }; subs.forEach((f) => f(st)); res(st); }; }); },
    restart: () => { calls.push("restart"); },
    onState: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  };
};
const vis = (page, sel) => page.isVisible(sel);
const txt = (page, sel) => page.textContent(sel).then((t) => (t || "").trim());
const bars = async (page) => ((await vis(page, "#updBars")) ? page.$$eval("#updBars .updbar", (b) => b.map((x) => x.dataset.upd)) : []);

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true }); seedProfile(HOME);
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(FAKE);
  const restart = async (cfg) => { // reload the page with a fake in this starting state
    await page.evaluate((c) => localStorage.setItem("fake-upd", JSON.stringify(c)), cfg || {});
    await page.reload(); await page.waitForSelector("#statsView", { state: "attached" }); await page.waitForTimeout(900);
  };
  await restart({ latest: LATEST() });

  // ---- panel: version + up to date
  ok(!(await vis(page, "#updDot")) && !(await bars(page)).length, "up to date: no dot, no bar");
  await goSet(page, "upd"); await page.waitForTimeout(150);
  ok(await vis(page, "#updPanel"), "Updates panel shows in Settings");
  eq(await page.$$eval("#settingsView .col > .panel", (p) => p.map((x) => x.id).slice(0, 2)), ["lookPanel", "updPanel"], "panel right after the look panel");
  eq(await txt(page, "#updPanel .eyebrow"), "Updates", "panel title");
  eq(await txt(page, "#updVer"), "Versie 1.2.0", "current version");
  eq(await txt(page, "#updStatus"), "Je hebt de nieuwste versie · laatst gecontroleerd 10 minuten geleden", "up to date + last checked");
  ok((await vis(page, "#updCheck")) && !(await vis(page, "#updInstall")) && !(await vis(page, "#updRestart")) && !(await vis(page, "#updNotes")), "only the check button");
  eq(await txt(page, "#updCheck"), "Controleren op updates", "check button text");

  // ---- check -> available, notes in nl/pl
  await page.click("#updCheck"); await page.waitForTimeout(80);
  eq(await txt(page, "#updStatus"), "Controleren…", "checking…");
  ok(await page.$eval("#updCheck", (b) => b.disabled), "check button disabled while checking");
  await page.waitForTimeout(600);
  eq(await txt(page, "#updStatus"), "Versie 1.2.1 is beschikbaar.", "version available");
  eq(await txt(page, "#updInstall"), "Installeren (95 MB)", "install button with the size");
  ok(await vis(page, "#updNotes"), "notes shown");
  eq(await txt(page, "#updNotesSum"), "Wat is er nieuw in versie 1.2.1", "notes summary");
  ok(!(await page.$eval("#updNotes", (d) => d.open)), "notes collapsed at first");
  await page.click("#updNotesSum"); await page.waitForTimeout(100);
  eq(await page.$$eval("#updNotesList .ngrp", (g) => g.map((x) => x.dataset.type)), ["new", "fixed"], "grouped like What's new");
  eq(await page.$$eval("#updNotesList li", (l) => l.map((x) => x.textContent)), ["Nieuw ding", "Fout opgelost"], "notes in Dutch");
  eq(await page.$$eval("#updNotesList .ntag", (l) => l.map((x) => x.textContent)), ["Nieuw", "Opgelost"], "Dutch tags");
  ok(await vis(page, "#updDot"), "dot on Settings while an update is available");
  eq(await page.getAttribute("#tabSettings", "aria-label"), "Instellingen (update beschikbaar)", "Settings aria-label mentions it");
  eq(await bars(page), [], "no bar while Settings is open (the panel says it)");
  await page.screenshot({ path: "/tmp/upd_panel.png" });
  await setLang(page, "pl"); await page.waitForTimeout(150);
  eq([await txt(page, "#updPanel .eyebrow"), await txt(page, "#updStatus"), await txt(page, "#updInstall"), await txt(page, "#updVer")], ["Aktualizacje", "Dostępna jest wersja 1.2.1.", "Zainstaluj (95 MB)", "Wersja 1.2.0"], "Polish panel");
  eq(await page.$$eval("#updNotesList li", (l) => l.map((x) => x.textContent)), ["Nowa rzecz", "Błąd naprawiony"], "notes in Polish");
  await setLang(page, "en"); await page.waitForTimeout(100);
  eq(await txt(page, "#updNotesSum"), "What's new in version 1.2.1", "English summary");
  await setLang(page, "nl"); await page.waitForTimeout(100);

  // ---- bar when the auto-check pushes an update
  await restart({ latest: LATEST() });
  ok(!(await bars(page)).length, "after restart: up to date, no bar");
  await page.evaluate((l) => window.__fake.push({ ...window.__fake.st, status: "available", latest: l, lastCheck: new Date().toISOString() }), LATEST());
  await page.waitForTimeout(150);
  eq(await bars(page), ["avail"], "bar appears on a pushed 'available'");
  eq(await txt(page, "#updBars .utext"), "Versie 1.2.1 is beschikbaar.", "bar text");
  eq(await page.$$eval("#updBars .updbar button", (b) => b.map((x) => x.textContent.trim() || x.getAttribute("aria-label"))), ["Bekijken", "Installeren", "Sluiten"], "bar buttons");
  ok(!(await page.$eval("#updBars", (b) => !!b.closest("dialog"))) && !(await page.evaluate(() => !!document.querySelector("dialog[open]"))), "not modal");
  const geo = await page.evaluate(() => { const b = document.querySelector("#updBars .updbar").getBoundingClientRect(), s = document.querySelector("#side").getBoundingClientRect(); return { right: b.left > s.right, bottom: innerHeight - b.bottom < 40 }; });
  ok(geo.right && geo.bottom, "bar at the bottom of the content, next to the sidebar", geo);
  ok(await vis(page, "#updDot"), "dot shows");
  await page.screenshot({ path: "/tmp/upd_banner.png" });
  await page.click("#updBars [data-upd-act=x]"); await page.waitForTimeout(100);
  eq(await bars(page), [], "× closes the bar");
  eq(await page.evaluate(() => localStorage.getItem("valkyrys-upd-dismissed")), "1.2.1", "closed version remembered");
  ok(await vis(page, "#updDot"), "dot stays");
  await restart({ state: { running: "1.2.0", status: "available", latest: LATEST(), lastCheck: new Date().toISOString() } });
  eq(await bars(page), [], "after a restart: no bar for the same version");
  await page.evaluate((l) => window.__fake.push({ ...window.__fake.st, status: "available", latest: l }), LATEST("1.2.2"));
  await page.waitForTimeout(150);
  eq([await bars(page), await txt(page, "#updBars .utext")], [["avail"], "Versie 1.2.2 is beschikbaar."], "a newer version: bar again");

  // ---- View -> Settings with the notes open
  await page.click("#updBars [data-upd-act=view]"); await page.waitForTimeout(200);
  ok((await vis(page, "#settingsView")) && (await page.$eval("#updNotes", (d) => d.open)), "View opens Settings with the notes open");
  eq(await bars(page), [], "bar hidden in Settings");

  // ---- install from the bar -> progress -> ready -> restart
  await goTab(page, "stats"); await page.waitForTimeout(100);
  await page.click("#updBars [data-upd-act=install]"); await page.waitForTimeout(100);
  ok((await page.evaluate(() => window.__fake.calls)).includes("install"), "install called");
  eq(await bars(page), ["dl"], "bar turns into a download bar");
  await page.evaluate(() => window.__fake.push({ ...window.__fake.st, status: "downloading", progress: 0.45 })); await page.waitForTimeout(100);
  eq([await txt(page, "#updBars .utext"), await page.$eval("#updBars .updprog > span", (s) => s.style.width)], ["Versie 1.2.2 wordt gedownload… 45%", "45%"], "bar progress 45%");
  await goSet(page, "upd"); await page.waitForTimeout(100);
  eq([await txt(page, "#updStatus"), await page.$eval("#updProgBar", (s) => s.style.width), await vis(page, "#updProg")], ["Downloaden… 45%", "45%", true], "panel progress bar 45%");
  ok(await page.$eval("#updCheck", (b) => b.disabled) && !(await vis(page, "#updInstall")), "check disabled, install hidden while downloading");
  await page.evaluate(() => window.__fake.push({ ...window.__fake.st, status: "downloading", progress: 0.8 })); await page.waitForTimeout(100);
  eq(await page.$eval("#updProgBar", (s) => s.style.width), "80%", "progress follows the pushes");
  await goTab(page, "stats"); await page.evaluate(() => window.__fake.finish()); await page.waitForTimeout(150);
  eq(await bars(page), ["ready"], "ready bar");
  eq(await txt(page, "#updBars .utext"), "De update is klaar. Herstart om te voltooien.", "ready text");
  eq(await page.$$eval("#updBars .updbar button", (b) => b.map((x) => x.textContent.trim())), ["Nu herstarten", "Later"], "ready buttons");
  await goSet(page, "upd"); await page.waitForTimeout(100);
  ok((await vis(page, "#updRestart")) && !(await vis(page, "#updCheck")) && !(await vis(page, "#updProg")), "panel: restart button");
  eq(await txt(page, "#updStatus"), "Versie 1.2.2 is klaar. Herstart om te voltooien.", "panel: ready text");
  eq(await bars(page), ["ready"], "ready bar also in Settings");
  await page.click("#updBars [data-upd-act=later]"); await page.waitForTimeout(100);
  eq(await bars(page), [], "Later hides the bar");
  await page.click("#updRestart"); await page.waitForTimeout(100);
  ok((await page.evaluate(() => window.__fake.calls)).includes("restart"), "restart called from the panel");
  await restart({ state: { running: "1.2.0", status: "ready", latest: LATEST("1.2.2"), progress: 1 } });
  await page.click("#updBars [data-upd-act=restart]"); await page.waitForTimeout(100);
  ok((await page.evaluate(() => window.__fake.calls)).includes("restart"), "restart called from the bar");

  // ---- an update that could not start
  await restart({ state: { running: "1.2.0", status: "uptodate", rolledBack: "1.2.1", lastCheck: new Date().toISOString() } });
  eq(await bars(page), ["rb"], "rolled back: warn bar");
  ok(await page.$eval("#updBars .updbar", (b) => b.classList.contains("warn")), "...styled as a warning");
  eq(await txt(page, "#updBars .utext"), "Update 1.2.1 kon niet starten; de vorige versie wordt gebruikt.", "rolled back text");
  ok(!(await vis(page, "#updDot")), "no dot for it");
  await page.click("#updBars [data-upd-act=x]"); await page.waitForTimeout(100);
  eq(await bars(page), [], "closed");
  await restart({ state: { running: "1.2.0", status: "uptodate", rolledBack: "1.2.1", lastCheck: new Date().toISOString() } });
  eq(await bars(page), [], "stays closed after a restart");

  // ---- error
  await restart({ state: { running: "1.2.0", status: "error", error: "Geen verbinding" } });
  await goSet(page, "upd"); await page.waitForTimeout(100);
  eq(await txt(page, "#updStatus"), "Bijwerken is niet gelukt: Geen verbinding", "error text");
  ok(await vis(page, "#updCheck") && !(await page.$eval("#updCheck", (b) => b.disabled)), "can check again after an error");

  // ---- plain browser: no update UI
  await restart({ none: true });
  await goTab(page, "settings"); await page.waitForTimeout(100);
  ok(!(await vis(page, "#updPanel")) && !(await vis(page, "#updBars")) && !(await vis(page, "#updDot")) && !(await vis(page, "#stab-upd")), "without the bridge: no panel, no bar, no dot, no Updates tab in Settings");
  await page.click("#stab-look"); ok(await vis(page, "#lookPanel"), "rest of Settings still there");

  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close();
  console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
