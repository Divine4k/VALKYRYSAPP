// The nine real purchase orders (work days in June, two hourly Saturdays): make invoices of them, then read the statistics from the invoices and from the POs.
const { goTab, setLang, seedProfile } = require("./test_helpers");
// Usage: node test_realpo.js <electron> <dir with the PO PDFs>
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const dataHome = "/tmp/el-appdata-real", PO = "/tmp/po-real", SRC = process.argv[3];
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  fs.rmSync(PO, { recursive: true, force: true }); fs.mkdirSync(PO, { recursive: true });
  const names = ["006344", "006475", "006476", "006551", "006552", "006682", "006683", "006684", "006738"].map((n) => `PO-${n}.pdf`);
  names.forEach((n) => fs.copyFileSync(path.join(SRC, n), path.join(PO, n)));
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ dialog }) => { globalThis.__pick = ""; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__pick] }); });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message)); await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(600);
  const waitStats = async () => { await page.waitForSelector("#statsBody:not([hidden])", { timeout: 60000 }); await page.waitForFunction(() => document.querySelector("#scanNote").hidden, null, { timeout: 60000 }); };
  const table = () => page.$$eval("#stTable tbody tr", (r) => r.map((x) => [...x.children].map((c) => c.textContent.trim())).filter((c) => c[1] !== "–"));
  const foot = () => page.$$eval("#stTable tfoot td", (c) => c.map((x) => x.textContent.trim()));

  // ---- 1. the nine POs become nine invoices
  await app.evaluate((_, p) => { globalThis.__pick = p; }, PO); await page.click("#npPick");
  await page.waitForFunction(() => document.querySelectorAll("#npList li").length >= 6, null, { timeout: 60000 });
  ok(/9 inkooporders/.test(await page.textContent("#npNote")), "all 9 purchase orders are read: " + (await page.textContent("#npNote")));
  ok(!/niet als inkooporder gelezen/.test(await page.textContent("#npNote")), "none is left unread");
  await page.click("#npAll"); await page.waitForFunction(() => document.querySelectorAll("article.po").length === 9, null, { timeout: 60000 });
  const cards = await page.$$eval("article.po", (a) => a.map((x) => ({ po: x.querySelector("h3").textContent.trim().split(/\s/)[0], lines: [...x.querySelectorAll('input[data-k="tarief"]')].map((t, i) => [t.value, x.querySelectorAll('input[data-k="aantal"]')[i].value]) })));
  console.log(JSON.stringify(cards.map((c) => c.po + ":" + c.lines.map((l) => l.join("x")).join("+"))));
  eq(cards.find((c) => c.po === "PO-006476").lines, [["57,00", "8"]], "the hourly PO becomes one line of 8 at 57,00");
  eq(cards.find((c) => c.po === "PO-006551").lines.map((l) => l.join("x")), ["570,00x1", "380,00x1"], "the night-shift PO keeps its two rates");
  await page.click("#zipAll"); await page.waitForFunction(() => /gedownload|opgeslagen|Facturen/i.test((document.querySelector("#toast") || {}).textContent || ""), null, { timeout: 90000 }); await page.waitForTimeout(1500);

  // ---- 2. statistics from the invoices: 21 days, not 35
  await goTab(page, "stats"); await page.waitForTimeout(400);
  await page.click('#statMode [data-mode="month"]'); await page.selectOption("#statYear", String(new Date().getFullYear())); await page.waitForTimeout(300);
  let t = await table(); console.log(t);
  eq(t.length, 1, "the invoices all fall in one month (today)");
  eq(t[0].slice(1, 4), ["9", "21", "€ 8.322,00"], "invoices: 9 invoices, 21 days (19 days + two 8-hour days), € 8.322,00");
  ok(/2 facturen hebben regels met een uurtarief/.test(await page.textContent("#statsNote")), "note says two invoices have hour lines");
  await page.click("#stTable button[data-per]"); await page.waitForSelector("#perDlg[open] tr.doc");
  const rows = await page.$$eval("#perDlg tr.doc", (r) => r.map((x) => [...x.children].map((c) => c.textContent.trim().replace(/\s+/g, " "))));
  eq(rows.length, 9, "the list shows the 9 invoices"); eq(rows.filter((r) => /uren omgerekend/.test(r[1])).length, 2, "two of them are marked as hours converted");
  eq(rows.filter((r) => /uren omgerekend/.test(r[1])).map((r) => r[3] + " " + r[4]), ["1 € 456,00", "1 € 456,00"], "each of those is 1 day for € 456,00");
  eq(rows.reduce((a, r) => a + parseFloat(r[3].replace(",", ".")), 0), 21, "the invoices in the list add up to 21 days");
  const first = rows[0][1].split(" ")[0];
  await page.click(`#perDlg button[data-prev="inv"][data-key="${first}"]`); await page.waitForSelector("#poDlg[open] canvas", { timeout: 30000 }); await page.waitForTimeout(400);
  eq(await page.textContent("#poDlgTitle"), "Factuur " + first, "preview of an invoice made here is drawn from what was saved");
  const dark = await page.$eval("#poPages canvas", (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 200) n++; return n; }); ok(dark > 100, "it shows the invoice (" + dark + " dark samples)");
  await page.screenshot({ path: "/tmp/real-invoice-preview.png" });
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#poDlg").open);
  await page.click("#perDlgClose");

  // ---- 3. statistics from the purchase orders (by work day)
  await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(300); await waitStats();
  t = await table(); console.log(t);
  eq(t, [["Juni", "9", "21", "€ 8.322,00"]], "POs by work day: all in June, 21 days, € 8.322,00");
  eq(await foot(), ["Totaal", "9", "21", "€ 8.322,00"], "totals");
  await page.click('#statMode [data-mode="week"]'); await page.waitForTimeout(300);
  t = await table(); console.log(t);
  eq(t.map((r) => r.slice(1)), [["1", "5", "€ 1.900,00"], ["2", "6", "€ 2.356,00"], ["2", "3", "€ 1.406,00"], ["3", "5", "€ 1.900,00"], ["1", "2", "€ 760,00"]], "weeks: 5 days; 5 + the hourly Saturday 13 Jun; 15-16 Jun + Saturday 20 Jun; 22-26 Jun; 29-30 Jun");
  await page.click('#statMode [data-mode="month"]'); await page.selectOption("#poBasis", "order"); await page.waitForTimeout(300);
  eq(await table(), [["Juni", "5", "14", "€ 5.662,00"], ["Juli", "4", "7", "€ 2.660,00"]], "by order date: POs ordered in June and in July");
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close(); console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
