// The app's usual port is taken (another Windows user has the app open, or another program uses it): the app starts on another port and
// still knows the language, theme, sidebar and animations (js/boot-prefs.js fills the window's empty storage from the saved settings).
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path"), net = require("net");
const { tmp, seedProfile, APP_DIR } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const HOME = tmp("el-appdata-port");
const launch = async (port) => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME, VALKYRYS_PORT: String(port) } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(800); return { app, page };
};
const look = (page) => page.evaluate(() => ({ lang: state.lang, theme: document.documentElement.getAttribute("data-theme"), noMotion: document.documentElement.classList.contains("no-motion"),
  sideMin: document.documentElement.classList.contains("side-min"), langStep: !!document.querySelector("#langScreen"), chosen: window.ValkLangChosen(), port: location.port }));
(async () => {
  fs.rmSync(HOME, { recursive: true, force: true }); const dir = seedProfile(HOME);
  const data = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8"));
  Object.assign(data, { "settings/prefs": { lang: "pl", langChosen: true, side: "min", motion: "off" }, "settings/theme": { id: "dark", custom: null } });
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(data));
  // something else is listening on the app's port
  const blocker = net.createServer(); await new Promise((r) => blocker.listen(0, "127.0.0.1", r)); const taken = blocker.address().port;
  let { app, page } = await launch(taken); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  let l = await look(page);
  ok(l.port && Number(l.port) !== taken, "the usual port is taken: the app starts on another one", l);
  ok(l.lang === "pl" && l.chosen && !l.langStep, "...in the saved language, without asking for it again", l);
  ok(l.theme === "dark" && l.noMotion && l.sideMin, "...with the saved theme, animations off and the narrow sidebar", l);
  await app.close();
  ({ app, page } = await launch(taken)); l = await look(page); // again another port, another empty storage
  ok(Number(l.port) !== taken && l.lang === "pl" && l.theme === "dark" && l.noMotion && !l.langStep, "the next start (another port again): the same", l);
  await app.close(); blocker.close();
  ok(!errs.length, "no page errors", errs);
  console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
