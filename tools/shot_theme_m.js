const { _electron: electron } = require("playwright"); const fs = require("fs");
const dataHome = "/tmp/el-appdata-thm"; fs.rmSync(dataHome, { recursive: true, force: true });
(async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick"); await page.setViewportSize({ width: 390, height: 760 }); await page.waitForTimeout(400);
  await page.click("#themeBtn"); await page.click('#themeGrid [data-theme-id="custom"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/thm-1.png" });
  console.log("overflow", await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200); await page.screenshot({ path: "/tmp/thm-0.png", clip: { x: 0, y: 0, width: 390, height: 200 } });
  await app.close();
})();
