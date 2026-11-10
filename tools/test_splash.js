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
  // animations start only after the logo images are decoded (class "go"); everything animated is transform/opacity only
  await splash.waitForFunction(() => document.body.classList.contains("go"), null, { timeout: 5000 });
  const props = await splash.evaluate(() => [...new Set(document.getAnimations().flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p)))))]);
  console.log("animated props:", props); if (props.some((p) => p !== "opacity" && p !== "transform")) throw new Error("non-compositor property animated: " + props);
  const times = (process.env.T || "0.3,0.6,1.2,1.8,2.4,3.0,3.5").split(",").map(Number);
  fs.mkdirSync("/tmp/splash", { recursive: true });
  for (const t of times) {
    await splash.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t * 1000; }), t);
    await splash.waitForTimeout(120);
    await splash.screenshot({ path: `/tmp/splash/f_${String(Math.round(t * 100)).padStart(3, "0")}.png`, omitBackground: true });
  }
  // mask loaded?
  console.log("mask ok:", await splash.evaluate(() => { return getComputedStyle(document.querySelector(".mark .masked")).webkitMaskImage; }));
  // Windows with "Animation effects" off reports reduced motion: the logo animation must still play
  await splash.emulateMedia({ reducedMotion: "reduce" }); await splash.waitForTimeout(100);
  const anims = await splash.evaluate(() => document.getAnimations().map((a) => a.animationName));
  console.log("with reduced motion:", anims.length, "animations"); if (!["markIn", "toLeft", "wordIn", "shine"].every((n) => anims.includes(n))) throw new Error("logo animation skipped with reduced motion: " + anims);
  console.log("errors:", errs);
  await app.close();
  if (errs.length) throw new Error("splash errors: " + errs.join(" | "));

  // real timing (no --splash-ms): the finished logo stays a moment after the animation ends, then the splash fades out and closes
  const app2 = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app2.firstWindow(); const sp = app2.windows().find((w) => w.url().includes("splash")); if (!sp) throw new Error("no splash window (2nd run)");
  let closedAt = 0; sp.on("close", () => { closedAt = Date.now(); });
  await sp.waitForFunction(() => window.splash && window.splash.state === "holding", null, { timeout: 10000, polling: 20 });
  const endAt = Date.now();
  await sp.waitForTimeout(300);
  if (sp.isClosed()) throw new Error("splash closed right after its animation ended");
  console.log("300 ms after animation end: state", await sp.evaluate(() => window.splash.state), "| opacity", await sp.evaluate(() => getComputedStyle(document.querySelector(".panel")).opacity));
  for (let i = 0; i < 100 && !closedAt; i++) await new Promise((r) => setTimeout(r, 50));
  if (!closedAt) throw new Error("splash not closed 5 s after its animation ended");
  const held = closedAt - endAt; console.log("splash closed", held, "ms after the animation ended (hold ~800 + fade ~550)");
  if (held < 1100) throw new Error("splash closed too early: " + held + " ms");
  if (held > 3500) throw new Error("splash closed too late: " + held + " ms");
  if (!app2.windows().some((w) => !w.url().includes("splash"))) throw new Error("main window missing");
  const shown = await app2.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => [w.getTitle(), w.isVisible()]));
  console.log("windows after hand-over:", shown); if (shown.length !== 1 || !shown[0][1]) throw new Error("main window not visible after hand-over");
  await app2.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
