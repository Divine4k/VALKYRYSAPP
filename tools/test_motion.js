// Animations (css/motion.css, js/boot-motion.js): short entrances on tabs, settings tabs, dialogs and the toast; a switch in
// Settings › Weergave turns them off (html.no-motion: nothing moves, spinners still turn), remembered after a restart.
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { tmp, goTab, seedProfile, goSet } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const dataHome = tmp("el-appdata-mo");
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(500); return { app, page };
};
const anims = (page, sel) => page.$eval(sel, (e) => e.getAnimations().map((a) => [a.animationName || "transition", Math.round(a.effect.getTiming().duration)]));
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  let { app, page } = await launch(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  ok(await page.evaluate(() => document.documentElement.classList.contains("mo") && !document.documentElement.classList.contains("no-motion")), "animations are on by default");

  // a tab that opens comes in quickly; nothing stays transformed afterwards
  await goTab(page, "inv"); let a = await anims(page, "#viewInv");
  ok(a.some(([n, d]) => n === "mo-in" && d > 0 && d <= 200), "the tab that opens plays a short entrance (≤ 200 ms)", a);
  await page.waitForTimeout(350);
  ok(await page.$eval("#viewInv", (e) => !e.classList.contains("mo-in") && getComputedStyle(e).transform === "none"), "after it played the view has no transform left (fixed bars and toasts stay in place)");
  await goTab(page, "inv"); ok((await anims(page, "#viewInv")).length === 0, "clicking the open tab again plays nothing");

  // settings tabs, the switch
  await goSet(page, "look"); await page.waitForTimeout(300);
  ok(await page.isVisible("#motionPanel #motionOn") && await page.$eval("#motionOn", (e) => e.checked), "Settings › Weergave has the Animaties switch, on");
  await page.click("#stab-pin"); a = await anims(page, '#setCol > [data-stab="pin"]:not([hidden])');
  ok(a.some(([n]) => n === "mo-in"), "a settings tab that opens comes in", a);
  await page.click("#stab-look"); await page.waitForTimeout(300);

  // dialogs and the toast
  const dlg = await page.evaluate(() => { const d = document.querySelector("dialog"); d.showModal(); const r = d.getAnimations().map((x) => x.animationName); d.close(); return r; });
  ok(dlg.includes("mo-pop"), "a window opens with a short pop", dlg);
  const ts = await page.evaluate(() => { toast("test"); return document.querySelector("#toast").getAnimations().map((x) => x.animationName); });
  ok(ts.includes("mo-toast"), "the toast slides in", ts);
  ok(await page.$eval("button", (b) => getComputedStyle(b).transitionDuration.split(",").every((d) => parseFloat(d) <= 0.12)), "button transitions are 120 ms or less");

  // off
  await page.click("#motionPanel .mswitch"); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.documentElement.classList.contains("no-motion") && !document.documentElement.classList.contains("mo")), "switch off: html.no-motion");
  await goTab(page, "docs"); ok((await anims(page, "#docsView")).length === 0, "off: a tab opens without animation");
  const dlg2 = await page.evaluate(() => { const d = document.querySelector("dialog"); d.showModal(); const r = d.getAnimations().length; d.close(); return r; });
  ok(dlg2 === 0, "off: a window opens without animation", dlg2);
  ok(await page.$eval("button", (b) => getComputedStyle(b).transitionDuration.split(",").every((d) => parseFloat(d) === 0)), "off: no transitions on buttons");
  const spin = await page.evaluate(() => { const b = document.createElement("button"); b.className = "refresh spin"; b.innerHTML = "<svg width='10' height='10'></svg>"; document.body.append(b); const n = b.querySelector("svg").getAnimations().length; b.remove(); return n; });
  ok(spin === 1, "off: a busy spinner still turns", spin);
  await page.waitForTimeout(600); await app.close();

  // remembered after a restart (localStorage before drawing, and settings/prefs.motion)
  const data = JSON.parse(fs.readFileSync(path.join(dataHome, "Valkyrys app", "data.json"), "utf8"));
  ok((data["settings/prefs"] || {}).motion === "off", "saved in settings/prefs", data["settings/prefs"]);
  ({ app, page } = await launch());
  ok(await page.evaluate(() => document.documentElement.classList.contains("no-motion")), "after a restart the animations are still off");
  await goSet(page, "look"); ok(!(await page.$eval("#motionOn", (e) => e.checked)), "and the switch shows off");
  await page.click("#motionPanel .mswitch"); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.documentElement.classList.contains("mo")), "switched back on");
  await app.close();
  ok(!errs.length, "no page errors", errs);
  console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
