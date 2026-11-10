const { _electron: electron } = require("playwright"); const fs = require("fs");
const { goTab, setLang, seedProfile } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const dataHome = "/tmp/el-appdata-th";
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(600); return { app, page };
};
const css = (page, sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop);
const v = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toUpperCase(), name);
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255})`; };
const choose = async (page, id) => { await page.click(`#themeGrid [data-theme-id="${id}"]`); await page.waitForTimeout(150); };
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  let { app, page } = await launch(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.emulateMedia({ colorScheme: "light" });
  ok(!(await page.isVisible("#themeBtn")) && (await page.$eval("#appbar", (h) => !h.querySelector("#themeBtn, #lang"))), "no theme button or language list in the header"); await goTab(page, "settings"); ok(await page.isVisible("#themeBtn") && await page.isVisible("#lang"), "theme button and language list are in Settings"); eq(await page.textContent("#themeBtn"), "Thema", "button label");
  await page.click("#themeBtn"); ok(await page.$eval("#themeDlg", (d) => d.open), "dialog opens");
  eq(await page.$$eval("#themeGrid [data-theme-id]", (b) => b.map((x) => x.dataset.themeId)), ["auto", "light", "dark", "midnight", "paper", "forest", "contrast", "custom"], "eight themes");
  eq(await page.$$eval("#themeGrid .tname", (b) => b.map((x) => x.textContent)), ["Automatisch", "Licht", "Donker", "Middernacht", "Papier", "Bos", "Hoog contrast", "Eigen thema"], "Dutch names");
  eq(await page.$eval('#themeGrid [aria-checked="true"]', (b) => b.dataset.themeId), "auto", "automatic is the default");
  ok(!(await page.isVisible("#customBox")), "custom editor hidden until chosen");

  // ---- automatic follows the system
  eq(await css(page, "body", "backgroundColor"), rgb("#F1F2F4"), "auto + light system -> light page");
  await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(150);
  eq(await css(page, "body", "backgroundColor"), rgb("#0D0E0F"), "auto + dark system -> dark page");
  await page.emulateMedia({ colorScheme: "light" }); await page.waitForTimeout(150);

  // ---- presets
  await choose(page, "dark"); eq(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "Donker sets data-theme=dark");
  eq(await css(page, "body", "backgroundColor"), rgb("#0D0E0F"), "Donker colours even when the system is light");
  await choose(page, "light"); eq(await css(page, "body", "backgroundColor"), rgb("#F1F2F4"), "Licht");
  await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(150);
  eq(await css(page, "body", "backgroundColor"), rgb("#F1F2F4"), "Licht stays light when the system is dark"); await page.emulateMedia({ colorScheme: "light" });
  const logoSrc = await page.$eval("#appbar .brand img", (i) => i.getAttribute("src"));
  for (const [id, bg, accent, band] of [["midnight", "#0A0F1E", "#6C9CFF", "#000000"], ["paper", "#F3EEE3", "#C4531B", "#111111"], ["forest", "#0C1410", "#4FD18B", "#000000"], ["contrast", "#000000", "#FFD500", "#000000"]]) {
    await choose(page, id);
    eq([await css(page, "body", "backgroundColor"), await v(page, "--accent"), await css(page, "#appbar", "backgroundColor")], [rgb(bg), accent, rgb(band)], `${id}: page, accent and the app bar`);
    eq([await css(page, "#tabs .seg-ind", "backgroundColor"), await page.$eval("#appbar .brand img", (i) => i.getAttribute("src"))], [rgb(accent), logoSrc], `${id}: tab pill in the accent, logo untouched`);
    await page.waitForTimeout(250); eq(await css(page, "#tabSettings", "backgroundColor"), rgb(accent), `${id}: the Settings gear (open) is filled with the accent`);
  }
  await choose(page, "midnight"); eq(await css(page, "button.primary, #npPick, #folderPick", "backgroundColor"), rgb("#6C9CFF"), "primary buttons use the theme accent");

  // ---- own theme: starts from what you see, live colours, warnings
  await choose(page, "custom");
  ok(await page.isVisible("#customBox"), "custom editor shows"); eq(await page.inputValue("#tc-bg-hex"), "#0A0F1E", "starts from the current theme (Middernacht)");
  await page.fill("#tc-bg-hex", "#102030"); await page.fill("#tc-surface-hex", "#18283C"); await page.fill("#tc-ink-hex", "#E0E6EE"); await page.fill("#tc-accent-hex", "#FF5577"); await page.waitForTimeout(200);
  eq([await v(page, "--bg"), await v(page, "--surface"), await v(page, "--ink"), await v(page, "--accent")], ["#102030", "#18283C", "#E0E6EE", "#FF5577"], "your colours are applied live");
  eq(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "a dark custom theme gets dark controls");
  eq(await css(page, "#appbar", "backgroundColor"), rgb("#000000"), "app bar still black"); ok(!(await page.isVisible("#themeWarn")), "no warning for readable colours");
  eq(await page.inputValue("#tc-accent"), "#ff5577", "colour picker follows the code");
  await page.fill("#tc-ink-hex", "#1A2A3E"); await page.waitForTimeout(200);
  ok(await page.isVisible("#themeWarn") && (await page.textContent("#themeWarn")).startsWith("Let op: de tekst"), "unreadable text gives a warning: " + (await page.textContent("#themeWarn")));
  await page.fill("#tc-ink-hex", "#E0E6EE"); await page.fill("#tc-accent-hex", "#18283C"); await page.waitForTimeout(200);
  ok((await page.textContent("#themeWarn")).includes("accent"), "invisible accent gives a warning: " + (await page.textContent("#themeWarn")));
  await page.fill("#tc-accent-hex", "#FF5577"); await page.fill("#tc-bg-hex", "#12"); await page.waitForTimeout(150);
  eq(await v(page, "--bg"), "#102030", "an unfinished code changes nothing");
  await page.evaluate(() => document.querySelector("#tc-bg-hex").dispatchEvent(new Event("change", { bubbles: true }))); await page.waitForTimeout(100);
  eq(await page.inputValue("#tc-bg-hex"), "#102030", "...and snaps back to the real colour");
  await page.selectOption("#tcBase", "paper"); await page.waitForTimeout(200);
  eq([await v(page, "--bg"), await v(page, "--accent"), await page.inputValue("#tc-bg-hex")], ["#F3EEE3", "#C4531B", "#F3EEE3"], "'start from' copies a theme's colours");
  eq(await page.evaluate(() => document.documentElement.dataset.theme), "light", "light custom -> light controls");
  await page.fill("#tc-accent-hex", "#00A3A3"); await page.fill("#tc-bg-hex", "#EAF4F4"); await page.waitForTimeout(150);

  // ---- remembered: restart; and from the saved data when the browser storage is empty
  await page.keyboard.press("Escape"); await page.waitForTimeout(1200);
  await app.close(); ({ app, page } = await launch()); page.on("pageerror", (e) => errs.push(e.message));
  eq([await v(page, "--bg"), await v(page, "--accent")], ["#EAF4F4", "#00A3A3"], "custom theme remembered after restart");
  await page.evaluate(() => localStorage.removeItem("valkyrys-theme")); await page.reload(); await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(1500);
  eq([await v(page, "--bg"), await v(page, "--accent")], ["#EAF4F4", "#00A3A3"], "...and restored from the saved data when browser storage is empty");

  // ---- keyboard, languages, tab views
  await goTab(page, "settings"); await page.click("#themeBtn"); await page.focus('#themeGrid [aria-checked="true"]'); await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(150);
  eq(await page.$eval('#themeGrid [aria-checked="true"]', (b) => b.dataset.themeId), "contrast", "arrow keys move through the themes"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(100);
  await setLang(page, "pl"); await page.waitForTimeout(200);
  eq([await page.textContent("#themeTitle"), (await page.$$eval("#themeGrid .tname", (b) => b.map((x) => x.textContent))).slice(0, 3)], ["Motyw", ["Automatyczny", "Jasny", "Ciemny"]], "Polish");
  await setLang(page, "en"); await page.waitForTimeout(200);
  eq((await page.$$eval("#themeGrid .tname", (b) => b.map((x) => x.textContent))).slice(-3), ["Forest", "High contrast", "Custom"], "English");
  await setLang(page, "nl");

  // ---- contrast audit of the presets (WCAG): text, muted text, button text, state colours
  const audit = await page.evaluate(() => { const T = ValkTheme, out = []; for (const id of ["midnight", "paper", "forest", "contrast"]) { const t = T.tokens(id), c = T.contrast;
    out.push([id, ["ink", t.ink, t.bg, 7], ["text", t.text, t.surface, 7], ["muted/bg", t.muted, t.bg, 4.5], ["muted/surface", t.muted, t.surface, 4.5], ["accent text", t.accentInk, t.accent, 4.5], ["accent/surface", t.accent, t.surface, 3],
      ["ok", t.ok, t.okBg, 4.5], ["warn", t.warn, t.warnBg, 4.5], ["err", t.err, t.errBg, 4.5], ["focus", t.focus, t.bg, 3]].slice(0).map((x) => Array.isArray(x) ? [x[0], +c(x[1], x[2]).toFixed(2), x[3]] : x)); } return out; });
  for (const [id, ...rows] of audit) { const bad = rows.filter((r) => r[1] < r[2]); ok(!bad.length, `${id}: contrast ok`, bad); }
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close(); console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
