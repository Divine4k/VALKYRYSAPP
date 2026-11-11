// Real launch with default timing: when does the splash show, when does the app window appear, when does the splash close?
const { _electron: electron } = require("playwright");
const fs = require("fs");
const { tmp } = require("./test_helpers");
(async () => {
  const t0 = Date.now();
  { const d = tmp("el-ad4/Valkyrys app"); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(d + "/pin.json", '{"v":1,"skipped":true}'); fs.writeFileSync(d + "/config.json", '{"welcomed":true}'); }
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu"], env: { ...process.env, APPDATA: tmp("el-ad4"), XDG_CONFIG_HOME: tmp("el-ad4") } });
  const t1 = Date.now(); console.log("attached after", t1 - t0, "ms (launch time included)");
  const ev = [];
  let last = "";
  for (let i = 0; i < 80; i++) {
    const st = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => (w.webContents.getURL().includes("splash") ? "splash" : "app") + (w.isVisible() ? ":visible" : ":hidden")).sort().join(" + "));
    if (st !== last) { ev.push([Date.now() - t1, st]); last = st; }
    if (st === "app:visible") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(ev.map((e) => `${e[0]} ms: ${e[1] || "(none)"}`).join("\n"));
  const page = app.windows().find((w) => !w.url().includes("splash")); await page.waitForSelector("#pick", { state: "attached" });
  console.log("app page ready:", await page.title());
  await app.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
