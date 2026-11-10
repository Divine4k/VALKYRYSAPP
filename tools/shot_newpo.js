const { _electron: electron } = require("playwright"); const fs = require("fs");
const dataHome = "/tmp/el-appdata-shot";
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ dialog }) => { globalThis.__pick = ""; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__pick] }); });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick"); await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.screenshot({ path: "/tmp/np-0.png" });
  await app.evaluate((_, p) => { globalThis.__pick = p; }, "/tmp/np-inv"); await page.click("#folderPick"); await page.waitForTimeout(600);
  await app.evaluate((_, p) => { globalThis.__pick = p; }, "/tmp/po-folder"); await page.click("#npPick");
  await page.waitForFunction(() => document.querySelectorAll("#npList li").length > 0); await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/np-1.png" });
  await page.click('[data-npadd="PO-100002"]'); await page.waitForSelector("article.po"); await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/np-2.png", fullPage: true });
  await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: "/tmp/np-3.png" });
  console.log("overflow:", await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  await app.close();
})();
