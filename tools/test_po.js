const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { goTab, setLang, seedProfile } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const PO = "/tmp/po-folder", INV = "/tmp/inv-folder2", D = JSON.parse(fs.readFileSync(PO + "-items.json", "utf8"));
const dataHome = "/tmp/el-appdata-p";
// ---- expectations, computed independently from the item list (plain date maths, ISO weeks via the Thursday rule)
const parse = (s) => { const [d, m, y] = s.split("-").map(Number); return { y, m: m - 1, d }; };
const isoWeek = ({ y, m, d }) => { const t = new Date(Date.UTC(y, m, d)); const dow = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dow); const y0 = Date.UTC(t.getUTCFullYear(), 0, 1); return Math.ceil(((t - y0) / 864e5 + 1) / 7); };
const seen = new Map(); D.items.forEach((i) => seen.set(i.po + "|" + i.date, i)); const items = [...seen.values()];
const eur0 = (n) => "€ " + Math.round(n).toLocaleString("nl-NL"), eur2 = (n) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inY = (y) => items.filter((i) => parse(i.date).y === y);
const sum = (a) => a.reduce((t, i) => t + i.price, 0), pos = (a) => new Set(a.map((i) => i.po)).size;
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ dialog }) => { globalThis.__pick = ""; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__pick] }); });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(500); return { app, page };
};
const pick = (app, p) => app.evaluate((_, p) => { globalThis.__pick = p; }, p);
const waitStats = async (page, ms = 60000) => { await page.waitForSelector("#statsBody:not([hidden])", { timeout: ms }); await page.waitForFunction(() => document.querySelector("#scanNote").hidden, null, { timeout: ms }); };
const kv = (page) => page.$$eval("#kpis .kpi", (k) => k.map((x) => [x.querySelector(".eyebrow").textContent, x.querySelector(".v").textContent, x.querySelector(".s").textContent.trim()]));
const bars = (page) => page.$$eval("#chart .bc", (b) => b.map((x) => [x.querySelector(".bx").textContent, x.querySelector(".bv") ? x.querySelector(".bv").textContent : ""]));
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  let { app, page } = await launch(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await goTab(page, "stats"); await page.waitForTimeout(300);
  ok(await page.isVisible("#statSource"), "source switch visible (Facturen / Inkooporders)");
  eq(await page.$$eval("#statMode button", (b) => b.map((x) => x.textContent)), ["Per week", "Per maand", "Per kwartaal", "Per jaar"], "week is the first period option");
  console.log("invoice source says:", await page.textContent("#srcPath"));
  await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(300);
  ok((await page.textContent("#srcPath")).includes("Piguillet"), "PO source asks for a folder: " + (await page.textContent("#srcPath")));
  eq(await page.textContent("#statsEmpty"), "Kies bij Instellingen de map met je inkooporders: dan worden ze meegeteld.", "empty message for the PO source");
  ok(await page.isVisible("#poBasisLbl"), "basis (work date / order date) selector visible for POs");
  await pick(app, PO); await goTab(page, "settings"); await page.click("#poFolderPick"); await goTab(page, "stats"); await waitStats(page);
  eq(await page.textContent("#srcPath"), PO, "chosen PO folder shown");
  // ---- 2026, per month (work-date basis)
  await page.click('#statMode [data-mode="month"]'); await page.selectOption("#statYear", "2026"); await page.waitForTimeout(300);
  let k = await kv(page); console.log(k);
  const y26 = inY(2026);
  eq([k[0][0], k[0][1], k[1][0], k[1][1]], ["Orderwaarde (excl. BTW)", eur0(sum(y26)), "Inkooporders", String(pos(y26))], "2026 tiles: order value / POs (labels switch to PO wording)");
  eq(k[2][1], String(y26.length), "days = one per line");
  const mo = (m) => y26.filter((i) => parse(i.date).m === m);
  eq((await bars(page)).map((b) => b[1]), Array.from({ length: 12 }, (_, m) => (mo(m).length ? eur0(sum(mo(m))) : "")), "monthly bars split a PO over the months its days fall in");
  eq(await page.$$eval("#stTable thead th", (t) => t.map((x) => x.textContent)), ["Periode", "Inkooporders", "Dagen", "Waarde (excl. BTW)"], "PO table has no VAT columns");
  eq(await page.$$eval("#stTable tbody tr:nth-child(1) td, #stTable tbody tr:nth-child(2) td", (t) => t.map((x) => x.textContent)).then((a) => a.slice(0, 8)), ["Januari", String(pos(mo(0))), String(mo(0).length), eur2(sum(mo(0))), "Februari", String(pos(mo(1))), String(mo(1).length), eur2(sum(mo(1)))], "Jan and Feb rows (PO-100003 counts in both)");
  eq((await page.$$eval("#stTable tfoot td", (t) => t.map((x) => x.textContent))), ["Totaal", String(pos(y26)), String(y26.length), eur2(sum(y26))], "total row counts each PO once");
  ok(await page.isVisible("#clientPanel"), "client split (2 companies)");
  eq(await page.$$eval("#clTable tbody tr td:first-child", (t) => t.map((x) => x.textContent)), ["Piguillet BV", "KVK 12345678"], "client names: known KVK gets its name");
  const note = await page.textContent("#statsNote"); console.log("note:", note);
  ok(note.includes(`${D.poCount} inkooporders`) && note.includes("werkdatum uit de omschrijving") && note.includes("nooit als meer dan één dag"), "note explains the work-date rule");
  const un = await page.$$eval("#unreadList li", (l) => l.map((x) => x.textContent)); console.log(await page.textContent("#unreadSum"), un);
  eq(un.slice().sort(), D.unread.slice().sort(), "files that are no purchase orders are listed");
  // ---- weeks
  await page.click('#statMode [data-mode="week"]'); await page.waitForTimeout(300);
  const b = await bars(page);
  eq(b.length, 53, "2026 has 53 ISO weeks");
  ok(await page.$eval("#chart", (c) => c.classList.contains("dense")), "dense chart for weeks");
  eq(b.slice(0, 5).map((x) => x[0].trim()), ["1", "", "", "", "5"], "week labels: every fourth");
  const wk = new Map(); y26.forEach((i) => { const w = isoWeek(parse(i.date)); wk.set(w, (wk.get(w) || []).concat(i)); });
  const rows = await page.$$eval("#stTable tbody tr", (r) => r.map((x) => [...x.children].map((c) => c.textContent)));
  console.log(rows.slice(0, 4));
  eq(rows.map((r) => +r[0].match(/^Week (\d+)/)[1]), [...wk.keys()].sort((a, c) => a - c), "table lists the weeks that have work, in order");
  eq(rows.map((r) => r[3]), [...wk.keys()].sort((a, c) => a - c).map((w) => eur2(sum(wk.get(w)))), "value per week");
  ok(rows.some((r) => r[0].startsWith("Week 46 · 9–15 Nov") && r[2] === "2"), "current week present with its 2 days: " + rows.map((r) => r[0]).join(" | "));
  ok(await page.$$eval("#stTable tbody tr.now td:first-child", (e) => e.length === 1 && e[0].textContent.startsWith("Week 46")), "current week row highlighted");
  // the week that straddles New Year: 29-31 Dec 2025 sit in week 1, they show in the 2025 view (and not in 2026)
  await page.selectOption("#statYear", "2025"); await page.waitForTimeout(300);
  const r25 = await page.$$eval("#stTable tbody tr", (r) => r.map((x) => [...x.children].map((c) => c.textContent)));
  eq(r25[r25.length - 1], ["Week 1 · 29 Dec – 4 Jan", "1", "3", "€ 1.350,00"], "2025 view ends with week 1 (29 Dec - 4 Jan): 3 days");
  await page.selectOption("#statYear", "2026"); await page.waitForTimeout(300);
  ok((await page.$$eval("#chart .bc.now", (e) => e.length)) === 1, "exactly one current week marked");
  k = await kv(page); console.log(k);
  eq(k[3][0], "Gemiddeld per week", "4th tile becomes average per week");
  const bestW = [...wk.entries()].sort((a, c) => sum(c[1]) - sum(a[1]) || a[0] - c[0])[0];
  ok(k[3][2].startsWith("Beste week: Week " + bestW[0]) && k[3][2].includes(eur0(sum(bestW[1]))), "best week: " + k[3][2], bestW[0]);
  await page.screenshot({ path: "/tmp/po-week.png", fullPage: true });
  // ---- order date basis
  await page.click('#statMode [data-mode="month"]'); await page.selectOption("#poBasis", "order"); await page.waitForTimeout(300);
  const ord = new Map(); items.forEach((i) => { const o = parse(i.order); if (o.y === 2026) ord.set(i.po, { o, v: (ord.get(i.po) ? ord.get(i.po).v : 0) + i.price }); });
  const byM = Array.from({ length: 12 }, (_, m) => [...ord.values()].filter((x) => x.o.m === m).reduce((t, x) => t + x.v, 0));
  eq((await bars(page)).map((x) => x[1]), byM.map((v) => (v ? eur0(v) : "")), "order-date basis: a whole PO sits on its order date");
  ok(!(await page.textContent("#statsNote")).includes("per werkdag"), "no split note for order-date basis");
  await page.selectOption("#poBasis", "work");
  // ---- quarter + year, with the 2025 data
  await page.click('#statMode [data-mode="year"]'); await page.waitForTimeout(300);
  eq((await bars(page)).map((x) => x[1]), [eur0(sum(inY(2025))), eur0(sum(y26))], "years side by side (2025 / 2026)");
  // ---- CSV
  await page.click('#statMode [data-mode="month"]'); await page.selectOption("#statYear", "2026"); fs.rmSync("/tmp/po-dl", { recursive: true, force: true });
  await app.evaluate(({ session }) => { session.defaultSession.on("will-download", (e, item) => item.setSavePath("/tmp/po-dl-" + item.getFilename())); });
  await page.click("#statCsv"); await page.waitForTimeout(1200);
  const csv = "/tmp/po-dl-Inkooporders 2026.csv"; ok(fs.existsSync(csv), "PO csv saved");
  if (fs.existsSync(csv)) { const L = fs.readFileSync(csv, "utf8").replace(/^﻿/, "").trim().split("\r\n"); console.log(L.slice(0, 3)); eq(L.length, 1 + pos(y26), "one csv line per PO");
    ok(L.some((l) => l.startsWith('"PO-100003";"28/01/2026";"29/01/2026"') && l.endsWith(";4;1800,00") || l.startsWith('"PO-100003";"28/01/2026";"29/01/2026"')), "PO-100003 line"); }
  // ---- other source keeps its own state; folders are separate
  await page.click('#statSource [data-src="invoices"]'); await page.waitForTimeout(300);
  eq(await page.textContent("#srcPath"), "Alleen facturen die je in de app hebt gemaakt", "invoice source: no invoice folder chosen, the PO folder is not used");
  ok(await page.isVisible("#statsEmpty"), "invoice source is empty (no invoices)");
  ok(!(await page.isVisible("#poBasisLbl")), "basis selector hidden again");
  await goTab(page, "settings"); ok(!(await page.isVisible("#folderPath")) && await page.isVisible("#poFolderPath"), "in Settings the invoice folder is still unset and the PO folder is set"); await goTab(page, "stats");
  // ---- restart: choices and results are remembered
  await goTab(page, "stats"); await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(500);
  await app.close(); ({ app, page } = await launch());
  const cfg = JSON.parse(fs.readFileSync(path.join(dataHome, "Valkyrys app", "config.json"), "utf8")); eq([cfg.poFolder, cfg.folder], [PO, undefined], "config keeps the PO folder separately from the invoice folder");
  await goTab(page, "stats"); const t0 = Date.now(); await waitStats(page); console.log("after restart:", Date.now() - t0, "ms");
  eq(await page.$eval('#statSource [data-src="pos"]', (b) => b.getAttribute("aria-pressed")), "true", "PO source remembered");
  eq(await page.$eval('#statMode [aria-pressed="true"]', (b) => b.dataset.mode), "month", "period choice remembered");
  eq((await kv(page))[0][1], eur0(sum(y26)), "same numbers after restart");
  // ---- English + disconnect
  await setLang(page, "en"); await page.waitForTimeout(300);
  eq(await page.$$eval("#statMode button", (b) => b.map((x) => x.textContent)), ["By week", "By month", "By quarter", "By year"], "English period labels");
  eq((await kv(page))[1][0], "Purchase orders", "English tile label");
  await page.click('#statMode [data-mode="week"]'); await page.waitForTimeout(200);
  const enRows = await page.$$eval("#stTable tbody tr td:first-child", (t) => t.map((c) => c.textContent));
  ok(enRows.some((r) => r.startsWith("Week 46 · 9–15 Nov")) && enRows.every((r) => r.startsWith("Week ")), "English week range: " + enRows.join(" | "));
  await setLang(page, "pl"); await page.waitForTimeout(200);
  ok((await page.textContent("#chartTitle")).startsWith("Wartość zamówień tygodniowo"), "Polish chart title: " + (await page.textContent("#chartTitle")));
  await setLang(page, "nl"); await page.waitForTimeout(200);
  await goTab(page, "settings"); await page.click("#poFolderClear"); await page.waitForTimeout(600); await goTab(page, "stats");
  ok(await page.isVisible("#statsEmpty") && (await page.textContent("#srcPath")).includes("Piguillet"), "disconnecting the PO folder returns to the prompt");
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close(); console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
