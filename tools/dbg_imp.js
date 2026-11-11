const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const F = "/tmp/inv-folder2", exp = JSON.parse(fs.readFileSync(F + "-expected.json", "utf8"));
const dataHome = "/tmp/el-appdata-i";
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ dialog, shell }, F) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [F] }); }, F);
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick"); await page.waitForTimeout(500); return { app, page };
};
const waitStats = async (page, ms = 60000) => { const t = Date.now(); await page.waitForSelector("#statsBody:not([hidden])", { timeout: ms }); await page.waitForFunction(() => document.querySelector("#scanNote").hidden, null, { timeout: ms }); return Date.now() - t; };
const kv = async (page) => page.$$eval("#kpis .kpi", (k) => k.map((x) => [x.querySelector(".v").textContent, x.querySelector(".s").textContent.trim()]));
const foot = async (page) => page.$$eval("#stTable tfoot td", (t) => t.map((x) => x.textContent));
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true });
  let { app, page } = await launch(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.click("#tabStats"); await page.waitForTimeout(300);
  ok(await page.isVisible("#statsEmpty"), "no folder yet: friendly empty message");
  console.log("empty:", await page.textContent("#statsEmpty"));
  await page.click("#tabInv"); await page.click("#folderPick"); await page.waitForTimeout(500);
  page.on("console", (m) => console.log("console:", m.type(), m.text()));
  await page.click("#tabStats"); await page.waitForTimeout(6000);
  console.log(await page.evaluate(() => ({ body: document.querySelector("#statsBody").hidden, empty: document.querySelector("#statsEmpty").hidden, scan: document.querySelector("#scanNote").hidden, scanTxt: document.querySelector("#scanNote").textContent, src: document.querySelector("#statSource") && document.querySelector("#statSource").innerHTML.slice(0,300), emptyTxt: document.querySelector("#statsEmpty").textContent.slice(0,200), ls: localStorage.getItem("valkyrys-stats") })));
  console.log(await page.evaluate(async () => { const f = await window.valkyrys.getFolder(); const l = await window.valkyrys.listFiles(); return { f, n: l.length, info: document.querySelector("#folderInfo") && document.querySelector("#folderInfo").textContent.slice(0,200), statsEmpty: document.querySelector("#statsEmpty").textContent }; }));
  console.log("errs", errs);
  await app.close(); process.exit(0);
})();
