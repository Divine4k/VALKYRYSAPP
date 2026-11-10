// "What's new": button in the app bar, dot until opened, dialog follows the language, remembered after a restart; a fresh install gets no dot.
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { goTab, setLang, seedProfile, APP_DIR } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const dataHome = "/tmp/el-appdata-news", shots = process.env.NEWS_SHOTS; // NEWS_SHOTS=1 also writes /tmp/news_*.png
const launch = async (home = dataHome) => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: home, XDG_CONFIG_HOME: home } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(1200); return { app, page };
};
const items = (page) => page.$$eval("#newsList .nrel:first-child li", (l) => l.map((x) => x.textContent));
(async () => {
  const CL = (() => { const w = {}; new Function("window", fs.readFileSync(path.join(__dirname, "../tool/changelog.js"), "utf8"))(w); return w.VALK_CHANGELOG; })();
  const latest = CL[0].version;
  eq(latest, require("../electron-app/package.json").version, "changelog top entry = app version");
  ok(CL.every((r) => r.items.every((it) => it.nl && it.en && it.pl && ["new", "improved", "fixed"].includes(it.type))), "every item has nl/en/pl and a known type");

  fs.rmSync(dataHome, { recursive: true, force: true }); const dir = seedProfile(dataHome);
  let { app, page } = await launch(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.emulateMedia({ colorScheme: "light" });
  ok(await page.isVisible("#appbar #newsBtn"), "button in the app bar");
  eq(await page.$eval("#appbar .appbar-in", (h) => [...h.children].map((c) => c.id || c.className)), ["brand", "tabs", "newsBtn"], "button comes after the tabs");
  const r = await page.evaluate(() => { const t = document.querySelector("#tabs").getBoundingClientRect(), b = document.querySelector("#newsBtn").getBoundingClientRect(); return { sameRow: Math.abs((t.top + t.bottom) / 2 - (b.top + b.bottom) / 2) < 2, gap: Math.round(b.left - t.right) }; });
  ok(r.sameRow && r.gap > 0 && r.gap < 20, "button sits right next to the tabs", r);
  eq(await page.textContent("#newsBtn .nlabel"), "Nieuw", "Dutch label");
  ok(await page.isVisible("#newsDot"), "dot shows for unseen notes");
  eq(await page.getAttribute("#newsBtn", "aria-label"), "Wat is er nieuw (nieuwe wijzigingen)", "aria-label says there is something new");
  ok(!(await page.$eval("#newsDlg", (d) => d.open)), "nothing opens by itself");
  if (shots) await page.screenshot({ path: "/tmp/news_appbar.png", clip: { x: 0, y: 0, width: 1280, height: 80 } });

  // ---- open
  await page.click("#newsBtn"); await page.waitForTimeout(200);
  ok(await page.$eval("#newsDlg", (d) => d.open), "dialog opens");
  eq(await page.textContent("#newsTitle"), "Wat is er nieuw", "title");
  eq(await page.$$eval("#newsList .nrel", (s) => s.map((x) => x.dataset.version)), CL.map((r) => r.version), "releases newest first");
  eq(await page.$$eval("#newsList .nrel:first-child .ngrp", (g) => g.map((x) => x.dataset.type)), ["new", "improved", "fixed"], "grouped New / Improved / Fixed");
  eq(await page.$$eval("#newsList .nrel:first-child .ntag", (g) => g.map((x) => x.textContent)), ["Nieuw", "Verbeterd", "Opgelost"], "Dutch tags");
  const order = ["new", "improved", "fixed"].flatMap((t) => CL[0].items.filter((i) => i.type === t));
  eq(await items(page), order.map((i) => i.nl), "1.1.0 items in Dutch");
  ok((await page.textContent("#newsList .nrel:first-child h3")).includes("Versie " + latest) && (await page.textContent("#newsList .nrel:first-child h3")).includes("10 november 2026"), "version + Dutch date heading");
  eq(await page.textContent("#newsVer"), "Versie " + latest, "version in the footer");
  ok(!(await page.isVisible("#newsDot")), "dot gone after opening");
  if (shots) { await page.screenshot({ path: "/tmp/news_light.png" }); await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(200); await page.screenshot({ path: "/tmp/news_dark.png" }); await page.emulateMedia({ colorScheme: "light" }); }

  // ---- language switch while open
  await setLang(page, "pl"); await page.waitForTimeout(200);
  eq([await page.textContent("#newsTitle"), (await items(page))[0]], ["Co nowego", order[0].pl], "Polish");
  eq(await page.$$eval("#newsList .nrel:first-child .ntag", (g) => g.map((x) => x.textContent)), ["Nowość", "Ulepszenie", "Poprawka"], "Polish tags");
  eq(await page.textContent("#newsBtn .nlabel"), "Co nowego", "Polish label");
  await setLang(page, "en"); await page.waitForTimeout(200);
  eq([await page.textContent("#newsTitle"), (await items(page)).slice(-1)[0], await page.textContent("#newsVer")], ["What's new", order.slice(-1)[0].en, "Version " + latest], "English");
  ok((await page.textContent("#newsList .nrel:first-child h3")).includes("10 November 2026"), "English date");
  await setLang(page, "nl"); await page.waitForTimeout(150);

  // ---- close: button and Esc
  await page.click("#newsClose"); await page.waitForTimeout(150); ok(!(await page.$eval("#newsDlg", (d) => d.open)), "close button closes");
  await page.click("#newsBtn"); await page.waitForTimeout(150); await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  ok(!(await page.$eval("#newsDlg", (d) => d.open)), "Esc closes");
  eq(await page.getAttribute("#newsBtn", "aria-label"), "Wat is er nieuw", "aria-label without 'new changes'");
  await goTab(page, "inv"); await page.waitForTimeout(150); ok(await page.isVisible("#pick"), "tabs still work");
  await page.waitForTimeout(800); await app.close();
  eq(JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8"))["settings/news"], { seen: latest }, "seen version saved in data.json");

  // ---- restart: still seen; and from the saved data when browser storage is empty
  ({ app, page } = await launch()); page.on("pageerror", (e) => errs.push(e.message));
  ok(await page.isVisible("#newsBtn") && !(await page.isVisible("#newsDot")), "after restart: no dot");
  await page.evaluate(() => localStorage.removeItem("valkyrys-news-seen")); await page.reload(); await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(1500);
  ok(!(await page.isVisible("#newsDot")), "...also when browser storage is empty (from the saved data)");
  // an older version seen -> dot again
  await app.close(); const d = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8")); d["settings/news"] = { seen: "1.0.0" }; fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(d));
  ({ app, page } = await launch()); page.on("pageerror", (e) => errs.push(e.message));
  await page.evaluate(() => localStorage.removeItem("valkyrys-news-seen")); await page.reload(); await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(1500);
  ok(await page.isVisible("#newsDot"), "seen an older version -> dot again");
  await app.close();

  // ---- fresh install: first-start picker, no dot afterwards
  const fresh = dataHome + "-fresh"; fs.rmSync(fresh, { recursive: true, force: true }); seedProfile(fresh, {}, { template: null });
  ({ app, page } = await launch(fresh)); page.on("pageerror", (e) => errs.push(e.message));
  ok(await page.$eval("#tplDlg", (x) => x.open), "fresh install: design picker shows");
  ok(!(await page.isVisible("#newsDot")) && !(await page.$eval("#newsDlg", (x) => x.open)), "fresh install: no dot, no news dialog");
  await page.waitForTimeout(600); await app.close();
  eq((JSON.parse(fs.readFileSync(path.join(fresh, APP_DIR, "data.json"), "utf8"))["settings/news"] || {}).seen, latest, "fresh install: marked seen silently");

  console.log("errors:", errs); ok(!errs.length, "no page errors");
  console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
