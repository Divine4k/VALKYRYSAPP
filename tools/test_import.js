const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { goTab, setLang, seedProfile } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const F = "/tmp/inv-folder2", exp = JSON.parse(fs.readFileSync(F + "-expected.json", "utf8"));
const dataHome = "/tmp/el-appdata-i";
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ dialog, shell }, F) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [F] }); }, F);
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(500); return { app, page };
};
const waitStats = async (page, ms = 60000) => { const t = Date.now(); await page.waitForSelector("#statsBody:not([hidden])", { timeout: ms }); await page.waitForFunction(() => document.querySelector("#scanNote").hidden, null, { timeout: ms }); return Date.now() - t; };
const kv = async (page) => page.$$eval("#kpis .kpi", (k) => k.map((x) => [x.querySelector(".v").textContent, x.querySelector(".s").textContent.trim()]));
const foot = async (page) => page.$$eval("#stTable tfoot td", (t) => t.map((x) => x.textContent));
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  let { app, page } = await launch(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await goTab(page, "stats"); await page.waitForTimeout(300);
  ok(await page.isVisible("#statsEmpty"), "no folder yet: friendly empty message");
  console.log("empty:", await page.textContent("#statsEmpty"));
  await goTab(page, "settings"); await page.click("#folderPick"); await page.waitForTimeout(500); await goTab(page, "inv");
  await goTab(page, "stats"); const t1 = await waitStats(page); console.log("first scan took", t1, "ms");
  await page.click('#statMode [data-mode="year"]'); await page.waitForTimeout(300);
  const Y = exp.years, all = { n: Y[2025].n + Y[2026].n, sub: Y[2025].sub + Y[2026].sub, vat: Y[2025].vat + Y[2026].vat, total: Y[2025].total + Y[2026].total, days: Y[2025].days + Y[2026].days };
  const eur0 = (n) => "€ " + Math.round(n).toLocaleString("nl-NL"), eur2 = (n) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let k = await kv(page); console.log(k);
  eq([k[0][0], k[1][0], k[2][0]], [eur0(all.sub), String(all.n), String(all.days)], "all years: revenue / invoices / days from the folder");
  eq(await foot(page), ["Totaal", String(all.n), String(all.days), eur2(all.sub), eur2(all.vat), eur2(all.total)], "table totals incl. VAT");
  eq(await page.$$eval("#chart .bc", (b) => b.map((x) => [x.querySelector(".bx").textContent, x.getAttribute("aria-label").split(", ")[1]])), [["2025", eur2(Y[2025].sub) + " excl. btw"], ["2026", eur2(Y[2026].sub) + " excl. btw"]], "yearly bars");
  eq(await page.$eval("#chart .bv", (v) => v.textContent), eur0(Math.max(Y[2025].sub, Y[2026].sub)), "value label on the highest year");
  eq(await page.$$eval("#stTable tbody tr", (r) => r.map((x) => x.children[1].textContent)), [String(Y[2025].n), String(Y[2026].n)], "invoices per year (copy counted once, number read from content, Word-only counted)");
  const note = await page.textContent("#statsNote"); console.log("note:", note);
  ok(note.includes(`${all.n} facturen: 0 uit de lijst Gemaakte facturen en ${all.n} uit je map`), "note says where the data came from");
  ok(await page.isVisible("#statsUnread"), "unread list shown");
  const sum = await page.textContent("#unreadSum"); const lst = await page.$$eval("#unreadList li", (l) => l.map((x) => x.textContent));
  console.log(sum, lst);
  eq(lst.slice().sort(), exp.unread.slice().sort(), "unread = the PO and the damaged file (not the .txt)");
  ok(await page.isVisible("#clientPanel"), "client panel (two clients in the folder)");
  await page.click('#statMode [data-mode="month"]'); await page.selectOption("#statYear", "2026"); await page.waitForTimeout(300);
  k = await kv(page); eq([k[0][0], k[1][0]], [eur0(Y[2026].sub), String(Y[2026].n)], "2026 in month view");
  // ---- the list behind the total, with a preview of each invoice file (a PDF is shown, a Word-only file can only be opened)
  await page.click('#stTable tfoot button[data-per="all"]'); await page.waitForSelector("#perDlg[open] tr.doc");
  eq(await page.$$eval("#perDlg tr.doc", (r) => r.length), Y[2026].n, "total list: one row per invoice of 2026");
  ok(await page.$$eval("#perDlg tr.doc", (r) => r.every((x) => !!x.querySelector('button[data-prev="inv"]'))), "every invoice has a preview button");
  await page.click('#perDlg button[data-prev="inv"][data-key="10-2026"]'); await page.waitForSelector("#poDlg[open] canvas", { timeout: 20000 });
  eq(await page.textContent("#poDlgTitle"), "Factuur 10-2026", "preview of an invoice PDF from the folder"); ok(await page.isVisible("#poDlgOpen"), "it can be opened in the PDF viewer too"); ok(!(await page.isVisible("#poDlgAdd")), "no add button for an invoice");
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#poDlg").open);
  await page.click('#perDlg button[data-prev="inv"][data-key="11-2026"]'); await page.waitForSelector("#poDlg[open]#poDlg", { timeout: 10000 }); await page.waitForTimeout(300);
  await page.waitForSelector("#poPages .wpage", { timeout: 15000 }).catch(() => {});
  ok(await page.isVisible("#poPages .wpage") && !(await page.isVisible("#poDlgErr")), "a Word-only invoice is shown as a Word preview page"); ok(await page.isVisible("#poDlgOpen"), "and can be opened in Word");
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#poDlg").open); await page.click("#perDlgClose");
  await page.screenshot({ path: "/tmp/import-month.png", fullPage: true });
  // cache is stored and the next start shows the same numbers
  const data = JSON.parse(fs.readFileSync(path.join(dataHome, "Valkyrys app", "data.json"), "utf8"));
  ok(data["cache/folderindex"] && Object.keys(data["cache/folderindex"].files).length >= 24, "read results are remembered (" + Object.keys((data["cache/folderindex"] || { files: {} }).files).length + " files)");
  eq(Object.keys(data).filter((x) => x.startsWith("invoices/")).length, 0, "nothing copied into the invoice list");
  await app.close();
  ({ app, page } = await launch());
  await goTab(page, "stats"); const t2 = await waitStats(page); console.log("second start: stats after", t2, "ms");
  await page.click('#statMode [data-mode="year"]'); await page.waitForTimeout(200);
  eq((await kv(page)).map((x) => x[0]).slice(0, 3), [eur0(all.sub), String(all.n), String(all.days)], "same numbers after a restart");
  // a new invoice appears in the folder while the app is open
  fs.copyFileSync(F + "/VALKYRYS 9-2025.pdf", F + "/VALKYRYS 99-2026.pdf");   // content says 9-2025: it is a copy of that invoice
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.waitForTimeout(2500);
  eq((await kv(page))[1][0], String(all.n), "a copy of an existing invoice (same number inside) does not double count");
  fs.unlinkSync(F + "/VALKYRYS 99-2026.pdf");
  // saving from the app: the invoice is in the list AND in the folder, counted once
  await goTab(page, "inv"); await page.setInputFiles("#file", process.argv[3]); await page.waitForSelector("article.po h3");
  const nr = await page.inputValue('[data-k="nr"]'); console.log("card number:", nr);
  await page.click('article.po [data-act="download"]'); await page.waitForTimeout(3000);
  await goTab(page, "stats"); await page.waitForTimeout(800);
  eq((await kv(page))[1][0], String(all.n + 1), "saved invoice counted once (list + folder)");
  ok((await page.textContent("#statsNote")).startsWith(`Gebaseerd op ${all.n + 1} facturen: 1 uit de lijst Gemaakte facturen en ${all.n} uit je map.`), "note updates");
  // disconnect the folder: only the app's own invoices remain
  await goTab(page, "settings"); await page.click("#folderClear"); await page.waitForTimeout(800); await goTab(page, "stats"); await page.waitForTimeout(500);
  eq((await kv(page))[1][0], "1", "without a folder only the invoice made in the app is counted");
  ok(!(await page.isVisible("#statsUnread")), "unread list gone");
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close(); console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
