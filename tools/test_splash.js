// Launch the real app (Linux Electron), grab splash frames at fixed animation times.
const { goTab, setLang, seedProfile } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs");
(async () => {
  const dataHome = "/tmp/el-appdata2"; fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  const t0 = Date.now();
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--splash-ms=60000"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.firstWindow(); const splash = app.windows().find((w) => w.url().includes("splash")); if (!splash) throw new Error("no splash window: " + app.windows().map((w) => w.url()));
  console.log("first window:", await splash.title(), "| url:", splash.url().split("/").slice(-2).join("/"), "| after", Date.now() - t0, "ms");
  const errs = []; splash.on("pageerror", (e) => errs.push(e.message)); splash.on("console", (m) => errs.push("console:" + m.text()));
  const size = await splash.evaluate(() => [innerWidth, innerHeight]); console.log("splash size", size);
  const times = (process.env.T || "0.3,0.4,0.5,0.6").split(",").map(Number);
  fs.mkdirSync("/tmp/splash", { recursive: true });
  for (const t of times) {
    await splash.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t * 1000; }), t);
    await splash.waitForTimeout(120);
    await splash.screenshot({ path: `/tmp/splash/f_${String(Math.round(t * 100)).padStart(3, "0")}.png`, omitBackground: true });
  }
  // mask loaded?
  console.log("mask ok:", await splash.evaluate(() => { return getComputedStyle(document.querySelector(".mark")).webkitMaskImage; }));
  console.log("errors:", errs);
  await app.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
