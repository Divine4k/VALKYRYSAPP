const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { goTab, setLang, seedProfile } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const inv = (nr, datum, lines, btw, client, extra = {}) => { const [n, y] = nr.split("-").map(Number); return { factuurnr: nr, nummer: n, jaar: y, po: "PO-" + nr, datum, betaaltermijn: "14 dagen", client: { name: client || "Piguillet BV" }, lines, btw: btw || "verlegd", totaal: 0, dagen: [], createdAt: "2026-01-01T10:00:00Z", ...extra }; };
const L = (t, a) => ({ desc: "x", tarief: t, aantal: a });
(async () => {
  const dataHome = "/tmp/el-appdata-s"; fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  fs.mkdirSync(path.join(dataHome, "Valkyrys app"), { recursive: true });
  const docs = { "settings/main": { startNumber: 7, startYear: 2026, betaaltermijn: "14 dagen", btw: "verlegd", fileTemplate: "VALKYRYS {nummer}", client: { name: "Piguillet BV", street: "a", city: "b", kvk: "1", btw: "2" } } };
  for (const i of [
    inv("5-2025", "05/03/2025", [L(400, 10)]), inv("6-2025", "05/11/2025", [L(400, 5)]), inv("7-2025", "14/11/2025", [L(400, 14)]), inv("8-2025", "15/12/2025", [L(400, 10)]),
    inv("1-2026", "12/01/2026", [L(400, 8)]), inv("2-2026", "03/02/2026", [L(400, 3), L(400, 2)], "21"), inv("3-2026", "20/03/2026", [L(400, 10)]),
    inv("4-2026", "28/03/2026", [L(400, 2)], "verlegd", "Andere BV"), inv("5-2026", "10/04/2026", [], "21", "Piguillet BV", { totaal: 1210 }), inv("6-2026", "29/10/2026", [L(400, 6)]),
  ]) docs["invoices/" + i.factuurnr] = i;
  fs.writeFileSync(path.join(dataHome, "Valkyrys app", "data.json"), JSON.stringify(docs));
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ session }) => { session.defaultSession.on("will-download", (e, item) => item.setSavePath("/tmp/st-dl-" + item.getFilename())); });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 }).catch(() => {});
  await page.waitForSelector("#hist li", { state: "attached" }); await page.waitForTimeout(500);
  console.log("today:", new Date().toISOString().slice(0, 10));
  ok(await page.isVisible("#statsView") && !(await page.isVisible("#viewInv")), "starts on the statistics tab"); eq(await page.$$eval("#tabs [role=tab]", (t) => t.map((x) => x.dataset.tab)), ["stats", "inv", "docs", "settings"], "tabs: statistics, invoices, documents, settings");
  await goTab(page, "stats"); await page.waitForTimeout(300);
  ok(await page.isVisible("#statsView") && !(await page.isVisible("#viewInv")), "statistics tab opens");
  eq(await page.textContent("#tagline"), "Je omzet en facturen in cijfers.", "tagline follows the tab"); eq(await page.textContent("#pageTitle"), "Statistieken", "page title follows the tab");
  const kv = async () => page.$$eval("#kpis .kpi", (k) => k.map((x) => [x.querySelector(".v").textContent, x.querySelector(".s").textContent.trim()]));
  let k = await kv(); console.log(k);
  eq(k.map((x) => x[0]), ["€ 13.400", "6", "31", "€ 1.218"], "2026 tiles: revenue / invoices / days / avg per month");
  ok(k[0][1] === "+123% t.o.v. 2025 tot dezelfde datum", "YTD comparison vs 2025", k[0][1]);
  eq(k[1][1], "gem. € 2.233 per factuur", "avg per invoice");
  eq(k[2][1], "gem. dagtarief € 432", "avg day rate");
  eq(k[3][1], "Beste maand: Maart (€ 4.800)", "best month");
  eq(await page.$$eval("#chart .bc", (b) => b.length), 12, "12 monthly bars");
  eq(await page.$$eval("#chart .bar:not(.zero)", (b) => b.length), 5, "5 months with revenue (Jan, Feb, Mar, Apr, Oct)");
  eq(await page.$$eval("#chart .bc", (b) => b.map((x) => x.querySelector(".bv") ? x.querySelector(".bv").textContent : "")), ["€ 3.200", "€ 2.000", "€ 4.800", "€ 1.000", "", "", "", "", "", "€ 2.400", "", ""], "bar labels per month");
  eq(await page.$$eval("#chart .bc.now .bx", (b) => b.map((x) => x.textContent)), ["Nov"], "current month marked (Nov)");
  const foot = async () => page.$$eval("#stTable tfoot td", (t) => t.map((x) => x.textContent));
  eq(await foot(), ["Totaal", "6", "31", "€ 13.400,00", "€ 630,00", "€ 14.030,00"], "table totals (VAT of 21% invoices incl. the one without lines)");
  eq(await page.$$eval("#stTable tbody tr", (r) => r.length), 12, "12 month rows");
  eq(await page.$$eval("#stTable tbody tr:nth-child(3) td", (t) => t.map((x) => x.textContent)), ["Maart", "2", "12", "€ 4.800,00", "–", "€ 4.800,00"], "March row");
  eq(await page.$$eval("#stTable tbody tr:nth-child(2) td", (t) => t.map((x) => x.textContent)), ["Februari", "1", "5", "€ 2.000,00", "€ 420,00", "€ 2.420,00"], "February row (21% VAT)");
  ok(await page.isVisible("#clientPanel"), "client panel visible (2 clients in 2026)");
  eq(await page.$$eval("#clTable tbody tr", (r) => r.map((x) => [...x.querySelectorAll("td")].map((t) => t.textContent))), [["Piguillet BV", "5", "€ 12.600,00", "94%"], ["Andere BV", "1", "€ 800,00", "6%"]], "client split");
  console.log("note:", await page.textContent("#statsNote"));
  await page.screenshot({ path: "/tmp/stats-month.png", fullPage: true });
  // quarter
  await page.click('#statMode [data-mode="quarter"]'); await page.waitForTimeout(200);
  eq(await page.$$eval("#chart .bc .bx", (b) => b.map((x) => x.textContent)), ["Q1", "Q2", "Q3", "Q4"], "quarter labels");
  eq(await page.$$eval("#chart .bc", (b) => b.map((x) => x.querySelector(".bv") ? x.querySelector(".bv").textContent : "")), ["€ 10.000", "€ 1.000", "", "€ 2.400"], "quarter revenue");
  eq(await page.$$eval("#stTable tbody tr:nth-child(1) td", (t) => t.map((x) => x.textContent)), ["Q1", "4", "25", "€ 10.000,00", "€ 420,00", "€ 10.420,00"], "Q1 row (for the VAT return)");
  await page.screenshot({ path: "/tmp/stats-quarter.png", fullPage: true });
  // year
  await page.click('#statMode [data-mode="year"]'); await page.waitForTimeout(200);
  eq(await page.$$eval("#chart .bc .bx", (b) => b.map((x) => x.textContent)), ["2025", "2026"], "year bars");
  eq((await kv()).map((x) => x[0]), ["€ 29.000", "10", "70", "€ 1.381"], "all-years tiles (1.381 = 29000 / 21 months)");
  eq((await kv())[0][1], "alle jaren samen", "scope text");
  ok(await page.$eval("#statYear", (s) => s.disabled), "year select disabled in year mode");
  eq(await foot(), ["Totaal", "10", "70", "€ 29.000,00", "€ 630,00", "€ 29.630,00"], "all-years totals");
  // back to month, pick 2025
  await page.click('#statMode [data-mode="month"]'); await page.selectOption("#statYear", "2025"); await page.waitForTimeout(200);
  k = await kv(); console.log(k);
  eq(k.map((x) => x[0]), ["€ 15.600", "4", "39", "€ 1.300"], "2025 tiles");
  eq(k[0][1], "in 2025", "no comparison without 2024 data");
  eq(k[3][1], "Beste maand: November (€ 7.600)", "best month 2025");
  ok(!(await page.isVisible("#clientPanel")), "client panel hidden with one client");
  eq(await page.$$eval("#chart .bc.now", (b) => b.length), 0, "no current-month marker in a past year");
  // CSV for 2025
  await page.click("#statCsv"); await page.waitForTimeout(1200);
  const csvPath = "/tmp/st-dl-Facturen 2025.csv"; ok(fs.existsSync(csvPath), "CSV downloaded");
  if (fs.existsSync(csvPath)) { const raw = fs.readFileSync(csvPath, "utf8"); ok(raw.charCodeAt(0) === 0xfeff, "CSV starts with a BOM (Excel reads accents)"); const lines = raw.replace(/^﻿/, "").trim().split("\r\n"); console.log(lines.slice(0, 3));
    eq(lines.length, 5, "CSV: header + 4 invoices of 2025"); eq(lines[2], '"6-2025";"05/11/2025";"PO-6-2025";"Piguillet BV";2000,00;0,00;2000,00;5', "CSV row for 6-2025"); }
  // language
  await setLang(page, "en"); await page.waitForTimeout(300);
  eq(await page.textContent("#tabStats"), "Statistics", "tab label in English"); eq(await page.textContent("#tabDocs"), "Documents", "Documents tab in English");
  eq(await page.textContent("#kpis .kpi .eyebrow"), "Revenue (excl. VAT)", "tile label in English");
  eq(await page.$$eval("#statMode button", (b) => b.map((x) => x.textContent)), ["By week", "By month", "By quarter", "By year"], "segment labels in English");
  eq(await page.textContent("#tagline"), "Your revenue and invoices in numbers.", "tagline in English"); eq(await page.textContent("#pageTitle"), "Statistics", "page title in English");
  await setLang(page, "pl"); await page.waitForTimeout(300);
  eq(await page.textContent("#tabStats"), "Statystyki", "tab label in Polish"); eq(await page.textContent("#tabDocs"), "Dokumenty", "Documents tab in Polish");
  eq(await page.$$eval("#stTable tbody tr td:first-child", (t) => t.slice(0, 3).map((x) => x.textContent)), ["Styczeń", "Luty", "Marzec"], "Polish month names");
  await setLang(page, "nl"); await page.waitForTimeout(200);
  // back to invoices tab
  await goTab(page, "inv"); await page.waitForTimeout(200);
  ok(await page.isVisible("#viewInv") && !(await page.isVisible("#statsView")), "back on the invoices tab");
  eq(await page.textContent("#tagline"), "Sleep inkooporders erin en download kant-en-klare facturen.", "tagline restored"); eq(await page.textContent("#pageTitle"), "Facturen", "page title: Facturen");
  // new invoice shows up in the statistics straight away
  await page.setInputFiles("#file", process.argv[3]); await page.waitForSelector("article.po h3");
  console.log("card nr:", await page.inputValue('[data-k="nr"]'));
  await page.click('article.po [data-act="download"]'); await page.waitForTimeout(2500);
  await goTab(page, "stats"); await page.selectOption("#statYear", "2026"); await page.waitForTimeout(300);
  eq((await kv())[1][0], "7", "downloaded invoice counted at once (7 invoices in 2026)");
  // tile filter: choose which statistic tiles show; the choice survives a reload
  const kids = async () => page.$$eval("#kpis .kpi", (k) => k.map((x) => x.dataset.k));
  eq(await kids(), ["rev", "count", "days", "avg"], "default tiles");
  ok(!(await page.isVisible("#kpiMenu")), "tile menu closed at first");
  await page.click("#kpiFilter"); await page.waitForTimeout(150);
  ok(await page.isVisible("#kpiMenu"), "filter button opens the tile menu");
  eq(await page.getAttribute("#kpiFilter", "aria-expanded"), "true", "filter button aria-expanded");
  eq(await page.$$eval("#kpiMenu input[data-kpi]", (c) => c.length), 14, "14 tiles to choose from");
  eq(await page.$$eval("#kpiMenu input:checked", (c) => c.map((x) => x.dataset.kpi)), ["rev", "count", "days", "avg"], "default four ticked");
  ok(await page.$eval('#kpiMenu input[data-kpi="weekday"]', (c) => c.closest("label").classList.contains("na")), "busiest weekday marked as not for invoices");
  await page.uncheck('#kpiMenu input[data-kpi="days"]'); await page.check('#kpiMenu input[data-kpi="inc"]'); await page.check('#kpiMenu input[data-kpi="rate"]'); await page.waitForTimeout(200);
  eq(await kids(), ["rev", "count", "avg", "inc", "rate"], "days off, incl. VAT and day rate on");
  eq(await page.textContent('#kpis [data-k="inc"] .eyebrow'), "Omzet (incl. BTW)", "incl. VAT tile label");
  ok((await page.textContent('#kpis [data-k="inc"] .s')).startsWith("waarvan BTW € "), "incl. VAT tile shows the VAT amount");
  ok(await page.isVisible("#kpiMenu"), "menu stays open while ticking");
  ok(await page.$eval("#kpiFilter", (b) => b.classList.contains("custom")), "filter button marked as changed");
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  ok(!(await page.isVisible("#kpiMenu")), "Escape closes the tile menu");
  await page.reload(); await page.waitForSelector("#hist li", { state: "attached" }); await page.waitForTimeout(500);
  await goTab(page, "stats"); await page.selectOption("#statYear", "2026"); await page.waitForTimeout(300);
  eq(await kids(), ["rev", "count", "avg", "inc", "rate"], "tile choice survives a reload");
  await page.click("#kpiFilter"); await page.waitForTimeout(150);
  await page.click("#kpiReset"); await page.waitForTimeout(200);
  eq(await kids(), ["rev", "count", "days", "avg"], "reset to default tiles");
  await page.click("#chartTitle"); await page.waitForTimeout(100);
  ok(!(await page.isVisible("#kpiMenu")), "click outside closes the tile menu");
  // narrow window
  await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(300);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(over <= 1, "no horizontal page scroll at phone width (" + over + "px)");
  await page.screenshot({ path: "/tmp/stats-narrow.png", fullPage: true });
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close(); console.log(fails ? "FAILED: " + fails : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
