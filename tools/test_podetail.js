// Statistics from purchase orders drawn like the real ones (wrapped cells, ranges, hours, the same day on two POs, half days):
const { goTab, setLang, seedProfile } = require("./test_helpers");
// right days and amounts, the breakdown of a period, and the PDF preview (new-orders list and breakdown).
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path"), cp = require("child_process");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const dataHome = "/tmp/el-appdata-pd", PO = "/tmp/po-layouts", HERE = path.resolve(__dirname, "..");
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome);
  cp.execFileSync("node", [path.join(HERE, "tools/make_po_layouts.mjs"), PO]); fs.rmSync(PO + "/layouts.json");
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ dialog }) => { globalThis.__pick = ""; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__pick] }); });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message)); await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(600);
  const pick = (p) => app.evaluate((_, p) => { globalThis.__pick = p; }, p);
  const waitStats = async () => { await page.waitForSelector("#statsBody:not([hidden])", { timeout: 60000 }); await page.waitForFunction(() => document.querySelector("#scanNote").hidden, null, { timeout: 60000 }); };
  const table = () => page.$$eval("#stTable tbody tr", (r) => r.map((x) => [...x.children].map((c) => c.textContent.trim())).filter((c) => c[1] !== "–"));
  const foot = () => page.$$eval("#stTable tfoot td", (c) => c.map((x) => x.textContent.trim()));

  // ---- the new-orders list: preview a PO before adding it
  await pick(PO); await page.click("#npPick"); await page.waitForFunction(() => document.querySelectorAll("#npList li").length > 0, null, { timeout: 60000 });
  const npRows = await page.$$eval("#npList li .t", (l) => l.map((x) => x.textContent));
  eq(npRows.length, 6, "6 purchase orders listed (A, C, D, E, G + one re-issued; the layout with centred prices is not read: " + npRows.join(","));
  ok(await page.$$eval("#npList li", (l) => l.every((x) => !!x.querySelector("[data-nppreview]"))), "every row has a preview button");
  const meta = await page.$$eval("#npList li", (l) => Object.fromEntries(l.map((x) => [x.querySelector(".t").textContent, x.querySelector(".s").textContent])));
  ok(/ 1 werkdag| 1 werkdag/.test(meta["PO-005900"]) || /1 werkdag/.test(meta["PO-005900"]), "8 hours show as 1 day in the list: " + meta["PO-005900"]);
  ok(/5 werkdagen/.test(meta["PO-005800"]), "the range PO shows 5 days: " + meta["PO-005800"]);
  await page.click('#npList li:has(.t:text-is("PO-005637")) [data-nppreview]');
  await page.waitForSelector("#poDlg[open] canvas", { timeout: 20000 }); await page.waitForTimeout(500);
  const cv = await page.$eval("#poPages canvas", (c) => ({ w: c.width, h: c.height, nonWhite: (() => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 200) n++; return n; })() }));
  ok(cv.w > 1000 && cv.h > 1400, "the PDF page is drawn: " + cv.w + "x" + cv.h); ok(cv.nonWhite > 100, "the page shows text (" + cv.nonWhite + " dark samples)");
  eq(await page.textContent("#poDlgTitle"), "Inkooporder PO-005637", "dialog title names the PO");
  ok(await page.isVisible("#poDlgAdd"), "a PO that still has to be added can be added from the preview");
  await page.screenshot({ path: "/tmp/pd-preview.png" });
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#poDlg").open); ok(true, "Escape closes the preview");
  await page.click('#npList li:has(.t:text-is("PO-005637")) [data-nppreview]'); await page.waitForSelector("#poDlg[open] canvas");
  await page.click("#poDlgAdd"); await page.waitForFunction(() => document.querySelectorAll("article.po").length === 1, null, { timeout: 30000 });
  ok(!(await page.$eval("#poDlg", (d) => d.open)), "adding from the preview closes it"); eq(await page.$eval("article.po h3", (h) => h.textContent.trim().startsWith("PO-005637")), true, "and the PO is in the list below");
  ok(!(await page.$$eval("#npList li .t", (l) => l.map((x) => x.textContent))).includes("PO-005637"), "and it is gone from the new-orders list");

  // ---- statistics by work day
  await goTab(page, "stats"); await page.waitForTimeout(300); await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(300); await waitStats();
  await page.click('#statMode [data-mode="month"]'); await page.selectOption("#statYear", "2026"); await page.waitForTimeout(300);
  let t = await table(); console.log(t);
  eq(t, [["Maart", "1", "2", "€ 760,00"], ["April", "2", "4", "€ 1.520,00"], ["Juni", "5", "10", "€ 4.180,00"]], "months: work dates from the Omschrijving; range over 5 days; hours = 1 day; same day on two POs = 1 day; half days");
  eq(await foot(), ["Totaal", "7", "16", "€ 6.460,00"], "totals");
  const note = await page.textContent("#statsNote"); ok(/1 werkdagen staan op meer dan één inkooporder/.test(note), "note names the day that two POs share"); ok(/Klik op een periode/.test(note), "note explains the breakdown");
  const tiles = await page.$$eval("#kpis .kpi", (k) => k.map((x) => x.querySelector(".v").textContent)); eq(tiles[2], "16", "days tile");

  // ---- the list behind June: one row per purchase order, the work days under it
  await page.click('#stTable button[data-per="5"]'); await page.waitForSelector("#perDlg[open] tr.doc");
  eq(await page.textContent("#perDlgTitle"), "Juni 2026", "list title");
  eq(await page.textContent("#perSum"), "5 inkooporders · 10 dagen · € 4.180,00", "list summary");
  const docs = await page.$$eval("#perDlg tr.doc", (r) => r.map((x) => ({ c: [...x.children].map((c) => c.textContent.trim().replace(/\s+/g, " ")), flag: x.classList.contains("flag") })));
  eq(docs.map((d) => d.c[1].split(" ")[0]), ["PO-005800", "PO-005900", "PO-006000", "PO-006001", "PO-006100"], "one row per purchase order, in date order");
  eq(docs.map((d) => d.c.slice(2, 5)), [["01-06-2026 – 05-06-2026", "5", "€ 1.900,00"], ["10-06-2026", "1", "€ 380,00"], ["16-06-2026 – 17-06-2026", "1,5", "€ 760,00"], ["17-06-2026 – 18-06-2026", "1,5", "€ 760,00"], ["29-06-2026 – 30-06-2026", "1", "€ 380,00"]], "dates, days and value each PO adds to June (the shared 17 June is split)");
  ok(/besteld 08-06-2026/.test(docs[0].c[1]), "the order date is under the PO number");
  eq(docs.filter((d) => d.flag).map((d) => d.c[1].split(" ")[0]), ["PO-006000", "PO-006001"], "only the two POs that share a day are marked");
  ok(/zelfde dag staat op meer dan één PO/.test(docs[2].c[1]), "with the reason");
  ok(/uren omgerekend/.test(docs[1].c[1]) && !docs[1].flag, "the hours PO says its hours were converted, without a warning");
  eq(docs.reduce((a, d) => a + parseFloat(d.c[3].replace(",", ".")), 0), 10, "the POs add up to the days in the table");
  eq(await page.$$eval("#perDlg tfoot td", (c) => c.map((x) => x.textContent.trim())), ["", "Totaal", "10", "€ 4.180,00", ""], "list total equals the table");
  // the work days under each PO: shown for the marked ones, hidden for the rest, and they can be opened
  const vis = () => page.$$eval("#perDlg tr.ln", (r) => r.map((x) => [x.querySelector("td:nth-child(3)").textContent, !x.hidden]));
  let ln = await vis(); eq(ln.length, 12, "12 work days in June (5 + 1 + 4 + 2)"); eq(ln.filter((l) => l[1]).map((l) => l[0]), ["16-06-2026", "17-06-2026", "17-06-2026", "18-06-2026"], "work days of the marked POs are open already");
  await page.click('#perDlg button[data-tog="0"]'); ln = await vis(); eq(ln.filter((l) => l[1]).length, 9, "opening PO-005800 shows its 5 days");
  eq(await page.getAttribute('#perDlg button[data-tog="0"]', "aria-expanded"), "true", "toggle says it is open");
  await page.click("#perAll"); ln = await vis(); ok(ln.every((l) => l[1]), "show all days"); await page.click("#perAll"); ln = await vis(); ok(ln.every((l) => !l[1]), "hide all days");
  await page.click("#perAll"); const lines = await page.$$eval("#perDlg tr.ln", (r) => r.map((x) => [...x.children].map((c) => c.textContent.trim().replace(/\s+/g, " "))));
  eq(lines.filter((l) => l[2] === "17-06-2026").map((l) => l[3]), ["0,5", "0,5"], "each of the two lines on 17 June counts half a day");
  ok(lines.every((l) => /Externe Diensten/.test(l[1])), "each work day shows the text of its PO line");
  await page.screenshot({ path: "/tmp/pd-breakdown.png" });
  // preview from the list (a dialog on top of a dialog)
  await page.click('#perDlg button[data-prev="po"][data-key="PO-005800"]'); await page.waitForSelector("#poDlg[open] canvas", { timeout: 20000 });
  eq(await page.textContent("#poDlgTitle"), "Inkooporder PO-005800", "preview from the list");
  ok(await page.isVisible("#poDlgAdd"), "PO-005800 is still new: the preview offers to add it");
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#poDlg").open);
  ok(await page.$eval("#perDlg", (d) => d.open), "closing the preview returns to the list");
  await page.click("#perDlgClose"); await page.waitForFunction(() => !document.querySelector("#perDlg").open);
  // a PO that is already in the list below has nothing to add
  await page.click('#stTable button[data-per="3"]'); await page.waitForSelector("#perDlg[open] tr.doc");
  await page.click('#perDlg button[data-prev="po"][data-key="PO-005637"]'); await page.waitForSelector("#poDlg[open] canvas", { timeout: 20000 });
  ok(!(await page.isVisible("#poDlgAdd")), "no add button for PO-005637, which was added already");
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#poDlg").open); await page.click("#perDlgClose"); await page.waitForFunction(() => !document.querySelector("#perDlg").open);
  // the total row lists everything in the year
  await page.click('#stTable tfoot button[data-per="all"]'); await page.waitForSelector("#perDlg[open] tr.doc");
  eq(await page.textContent("#perDlgTitle"), "Totaal 2026", "total list title"); eq(await page.textContent("#perSum"), "7 inkooporders · 16 dagen · € 6.460,00", "total list summary = the table footer");
  eq(await page.$$eval("#perDlg tr.doc", (r) => r.length), 7, "all 7 purchase orders of the year are listed"); await page.click("#perDlgClose");

  // ---- other periods
  await page.click('#statMode [data-mode="week"]'); await page.waitForTimeout(300);
  t = await table(); console.log(t.slice(0, 3));
  eq(t[0].slice(1), ["1", "5", "€ 1.900,00"], "week 14 (30 March - 3 April) holds all 5 days of the first PO");
  await page.click('#statMode [data-mode="quarter"]'); await page.waitForTimeout(300);
  eq(await table(), [["Q1", "1", "2", "€ 760,00"], ["Q2", "7", "14", "€ 5.700,00"]], "quarters (PO-005637 has lines in both quarters, so it counts in both)");
  // whole PO on its order date: no work-day split, the same day rule
  await page.click('#statMode [data-mode="month"]'); await page.selectOption("#poBasis", "order"); await page.waitForTimeout(300);
  eq(await table(), [["April", "2", "6", "€ 2.280,00"], ["Juni", "4", "9", "€ 3.800,00"], ["Juli", "1", "1", "€ 380,00"]], "by order date");
  eq(await foot(), ["Totaal", "7", "16", "€ 6.460,00"], "same totals by order date");
  await page.click('#stTable button[data-per="3"]'); await page.waitForSelector("#perDlg[open] tr.doc");
  eq(await page.$$eval("#perDlg tr.doc", (r) => r.map((x) => [...x.children].map((c) => c.textContent.trim().replace(/\s+/g, " ")).slice(1, 5))), [["PO-005637 besteld 07-04-2026", "07-04-2026", "5", "€ 1.900,00"], ["PO-005700 besteld 28-04-2026", "28-04-2026", "1", "€ 380,00"]], "order-date list: one row per PO on its order date, whole PO counted");
  eq(await page.$$eval("#perDlg tr.ln, #perDlg button[data-tog]", (r) => r.length), 0, "no day rows in the order-date list"); ok(!(await page.isVisible("#perAll")), "no show-days button there");
  eq(await page.$$eval("#perTable thead th", (h) => h.map((x) => x.textContent)), ["", "Inkooporder", "Orderdatum", "Dagen", "Waarde (excl. BTW)", ""], "headers of the order-date list");
  await page.click("#perDlgClose"); await page.selectOption("#poBasis", "work");

  // ---- language
  await page.click('#statMode [data-mode="month"]'); await setLang(page, "pl"); await page.waitForTimeout(300);
  await page.click('#stTable button[data-per="5"]'); await page.waitForSelector("#perDlg[open] tbody tr");
  eq(await page.textContent("#perSum"), "5 zamówienia zakupu · 10 dni · € 4.180,00", "Polish summary");
  ok(/ten sam dzień jest w kilku zamówieniach/.test(await page.textContent("#perTable")), "Polish flag text");
  eq(await page.$$eval("#perTable thead th", (h) => h.map((x) => x.textContent)), ["", "Zamówienie", "Dni robocze", "Dni", "Wartość (bez VAT)", ""], "Polish headers");
  await page.click("#perDlgClose"); await setLang(page, "en"); await page.waitForTimeout(200);
  await page.click('#stTable button[data-per="5"]'); await page.waitForSelector("#perDlg[open] tbody tr");
  eq(await page.textContent("#perSum"), "5 purchase orders · 10 days · € 4.180,00", "English summary");
  await page.click("#perDlgClose"); await setLang(page, "nl");

  // ---- narrow window: the dialogs fit
  await page.setViewportSize({ width: 420, height: 900 }); await page.click('#stTable button[data-per="5"]'); await page.waitForSelector("#perDlg[open] tbody tr");
  const dw = await page.$eval("#perDlg", (d) => ({ l: d.getBoundingClientRect().left, r: d.getBoundingClientRect().right, vw: innerWidth })); ok(dw.l >= 0 && dw.r <= dw.vw + 1, "breakdown dialog fits a phone-width window " + JSON.stringify(dw));
  await page.screenshot({ path: "/tmp/pd-breakdown-narrow.png" }); await page.click("#perDlgClose");
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close(); console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
