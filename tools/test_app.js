const { chromium } = require("playwright"); const fs = require("fs");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.route(/jsdelivr|googleapis|gstatic/, (r) => r.abort());
  await page.goto("http://127.0.0.1:47631/"); await page.waitForTimeout(800);
  console.log("next:", await page.textContent("#nextNr"), "| store:", await page.textContent("#storeNote"));
  await page.setInputFiles("#file", process.argv[2]); await page.waitForSelector("article.po h3");
  console.log("card:", (await page.textContent("article.po h3")), await page.inputValue('[data-k="nr"]'), await page.textContent("[data-total]"));
  // settings (client) then download
  await page.evaluate(() => { document.querySelector("#settingsBox").open = true; });
  await page.fill("#cName", "Piguillet BV"); await page.fill("#cKvk", "52742938"); await page.evaluate(() => document.querySelector("#settings").requestSubmit()); await page.waitForTimeout(400);
  const [d1] = await Promise.all([page.waitForEvent("download"), page.click('article.po [data-act="download"]')]);
  await d1.saveAs("/tmp/vf-dl.pdf"); console.log("pdf:", d1.suggestedFilename(), fs.statSync("/tmp/vf-dl.pdf").size);
  const [d2] = await Promise.all([page.waitForEvent("download"), page.click('article.po [data-act="download-docx"]')]);
  await d2.saveAs("/tmp/vf-dl.docx"); console.log("docx:", d2.suggestedFilename(), fs.statSync("/tmp/vf-dl.docx").size);
  await page.click('article.po [data-act="preview"]'); await page.waitForTimeout(2500);
  console.log("preview canvas px:", await page.evaluate(() => { const c = document.querySelector("#dlgCanvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4000) if (d[i] > 200) n++; return c.width + "x" + c.height + " light samples " + n; }));
  await page.screenshot({ path: "/tmp/vf-shot.png" });
  await page.reload(); await page.waitForTimeout(1000);
  console.log("after reload: next", await page.textContent("#nextNr"), "| documents:", await (async () => { await page.click("#tabDocs"); await page.waitForTimeout(200); const l = await page.$$eval("#docsList li", (x) => x.map((e) => e.dataset.nr).join(",")); await page.click("#tabInv"); return l; })(), "| #hist gone:", !(await page.$("#hist")), "| client:", await page.inputValue("#cName"));
  console.log("errors:", errs); await b.close();
})();
