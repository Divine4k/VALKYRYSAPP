const { _electron: electron } = require("playwright"); const fs = require("fs");
const dataHome = "/tmp/el-appdata-ths";
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ dialog }) => { globalThis.__pick = ""; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__pick] }); });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick"); await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1100, height: 1000 });
  await app.evaluate((_, p) => { globalThis.__pick = p; }, "/tmp/inv-folder2"); await page.click("#folderPick"); await page.waitForTimeout(500);
  await app.evaluate((_, p) => { globalThis.__pick = p; }, "/tmp/po-folder"); await page.click("#npPick"); await page.waitForFunction(() => document.querySelectorAll("#npList li").length > 0); await page.waitForTimeout(400);
  await page.setInputFiles("#file", process.argv[3]); await page.waitForSelector("article.po h3"); await page.waitForTimeout(300);
  for (const id of ["light", "dark", "midnight", "paper", "forest", "contrast"]) {
    await page.evaluate((id) => ValkTheme.apply({ id, custom: null }), id); await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `/tmp/th-${id}.png` });
  }
  await page.evaluate(() => ValkTheme.apply({ id: "midnight", custom: null }));
  await page.click("#tabStats"); await page.waitForSelector("#statsBody:not([hidden])", { timeout: 60000 }); await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/th-stats-midnight.png" });
  await page.evaluate(() => ValkTheme.apply({ id: "paper", custom: null })); await page.waitForTimeout(150); await page.screenshot({ path: "/tmp/th-stats-paper.png" });
  await page.click("#tabInv"); await page.click('#themeGrid [data-theme-id="custom"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/th-dialog.png" });
  await app.close();
})();
