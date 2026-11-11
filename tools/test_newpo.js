// The Facturen tab lists purchase orders from the Piguillet folder that have no invoice yet, and loads them like dropped PDFs.
const { tmp, saved: fileSaved, goTab, setLang, seedProfile, goSet } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const PO = tmp("po-folder"), INV = tmp("np-inv"), dataHome = tmp("el-appdata-np");
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib");
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ dialog }) => { globalThis.__pick = ""; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__pick] }); });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(600); return { app, page };
};
const pick = (app, p) => app.evaluate((_, p) => { globalThis.__pick = p; }, p);
const rows = (page) => page.$$eval("#npList li", (l) => l.map((x) => ({ po: x.querySelector(".t").textContent, meta: x.querySelector(".s").textContent })));
const pos = async (page) => (await rows(page)).map((r) => r.po);
const cards = (page) => page.$$eval("article.po", (a) => a.map((x) => ({ po: (x.querySelector("h3") || {}).textContent, nr: (x.querySelector('input[data-k="nr"]') || {}).value })));
const waitRows = (page, n) => page.waitForFunction((n) => document.querySelectorAll("#npList li").length === n, n, { timeout: 60000 });
const note = (page) => page.textContent("#npNote");
async function makePo(file, po, order, items) {
  const doc = await PDFLib.PDFDocument.create(), page = doc.addPage([595, 842]), f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const money = (n) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2 }), total = items.reduce((a, [, p]) => a + p, 0);
  const lines = ["Piguillet", "Groep", "Inkooporder Inkooporder", "Aan: Afleveradres:", "Valkyrys", "Harderwijkstraat 115", "2573ZC 's-gravenhage", "Aflevernotitie:", `Ordernummer : ${po}`, "Levering : DDP (Incoterms 2020)", `Besteldatum : ${order}`, `Leverdatum : ${order}`, "Besteld door : Annelies Hartman-Kuivenhoven", "Aantal Nummer Omschrijving Prijs Totaalbedrag",
    ...items.map(([d, p]) => `1 Dagprijs ${d} - Przemyslaw Wodecki - TB/2025-08/006531 ${money(p)} ${money(p)}`), `Totaalbedrag inkooporder ${money(total)}`, "Alle genoemde prijzen zijn exc. btw", "Facturatievoorwaarden:", "KvK nr. 52742938 BTW nr. NL850577950B01 IBAN NL48 INGB0009237048"];
  lines.forEach((t, i) => page.drawText(t, { x: 40, y: 800 - i * 18, size: 10, font: f })); fs.writeFileSync(file, await doc.save());
}
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome); fs.rmSync(tmp("po-folder/PO-100010.pdf"), { force: true });
  let { app, page } = await launch(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  // ---- A. nothing connected yet: a friendly prompt
  ok(await page.isVisible("#newPo"), "panel is on the Facturen tab");
  ok((await note(page)).startsWith("Kies de map met de inkooporders van Piguillet"), "no PO folder: asks for it -> " + (await note(page)));
  ok(await page.isVisible("#npPick") && !(await page.isVisible("#npAll")), "prompt has a choose-folder button only");

  // ---- B. connect both folders
  await pick(app, INV); await goSet(page, "folders"); await page.click("#folderPick"); await page.waitForTimeout(800); await goTab(page, "inv");
  await pick(app, PO); await page.click("#npPick"); await waitRows(page, 6);
  eq(await pos(page), ["PO-100009", "PO-100008", "PO-100002", "PO-100004", "PO-100007", "PO-100005"], "6 of the 7 new POs shown, oldest order first (100001 and 100003 have invoices; copy of 100002 counts once)");
  ok((await note(page)).startsWith("7 inkooporders in je map hebben nog geen factuur."), "note counts 7: " + (await note(page)));
  ok((await note(page)).includes("2 PDF’s in de map zijn niet als inkooporder gelezen"), "unreadable PDFs are mentioned");
  const r2 = (await rows(page)).find((r) => r.po === "PO-100002");
  ok(r2 && r2.meta.includes("besteld 05-01-2026") && r2.meta.includes("5 werkdagen") && r2.meta.includes("€ 2.250,00"), "row shows order date, days and value: " + (r2 && r2.meta));
  ok(await page.isVisible("#npAll") && (await page.textContent("#npAll")) === "Alles toevoegen (7)", "add-all button counts all 7");
  eq(await page.textContent("#npMore"), "Toon alle 7", "'show all' button");
  await page.click("#npMore"); await waitRows(page, 7);
  eq((await pos(page))[6], "PO-100006", "all 7 shown after 'show all'"); eq(await page.textContent("#npMore"), "Toon minder", "button flips");
  await page.click("#npMore"); await waitRows(page, 6);

  // ---- C. add one, save it, it is gone from the list for good
  await page.click('[data-npadd="PO-100002"]'); await page.waitForSelector("article.po");
  let c = await cards(page); ok(c.length === 1 && c[0].po.includes("PO-100002"), "one card for PO-100002"); eq(c[0].nr, "62-2026", "gets the next invoice number (the app starts at 62-2026)");
  await page.waitForFunction(() => document.querySelectorAll("#npList li").length === 6 && ![...document.querySelectorAll("#npList .t")].some((e) => e.textContent === "PO-100002"));
  ok(true, "PO-100002 left the list while its card is open");
  const bytesBefore = (await page.textContent("#npNote"));
  await page.click('article.po [data-act="download"]'); await page.waitForTimeout(1000); await fileSaved(INV + "/VALKYRYS 62-2026.pdf");
  ok(fs.existsSync(INV + "/VALKYRYS 62-2026.pdf"), "invoice saved in the invoice folder");
  await page.click('article.po [data-act="remove"]'); await page.waitForTimeout(1500);
  ok(!(await pos(page)).includes("PO-100002"), "after removing the card, PO-100002 stays out (it has an invoice now)");
  ok((await note(page)).startsWith("6 inkooporders"), "note now says 6: " + (await note(page)));

  // ---- D. skip one
  await page.click('[data-npskip="PO-100007"]'); await page.waitForTimeout(400);
  ok(!(await pos(page)).includes("PO-100007") && (await note(page)).includes("1 overgeslagen."), "skipped PO leaves the list: " + (await note(page)));
  ok(await page.isVisible("#npRestore"), "restore button appears");

  // ---- E. add all remaining
  await page.waitForSelector("#npAll:not([hidden])");
  eq(await page.textContent("#npAll"), "Alles toevoegen (5)", "add-all says 5");
  await page.click("#npAll"); await page.waitForFunction(() => document.querySelectorAll("article.po").length === 5);
  c = await cards(page);
  eq(c.map((x) => x.po.trim().slice(0, 9)), ["PO-100009", "PO-100008", "PO-100004", "PO-100005", "PO-100006"], "cards in order-date order");
  eq(c.map((x) => x.nr), ["63-2026", "64-2026", "65-2026", "66-2026", "67-2026"], "consecutive invoice numbers");
  eq(await rows(page), [], "list is empty now (all open as cards, one skipped)");
  ok((await note(page)).startsWith("1 overgeslagen."), "note: " + (await note(page)));
  ok(await page.$eval("#toast", (t) => !t.hidden && t.textContent.includes("5 toegevoegd")), "toast says how many were added");

  // ---- F. restart: cards are not kept, but invoices and skips are
  await app.close(); ({ app, page } = await launch()); page.on("pageerror", (e) => errs.push(e.message));
  await waitRows(page, 5);
  eq(await pos(page), ["PO-100009", "PO-100008", "PO-100004", "PO-100005", "PO-100006"], "after restart: the 5 without invoice are back, 100002 (invoiced) and 100007 (skipped) are not");
  await page.click("#npRestore"); await waitRows(page, 6);
  ok((await pos(page)).includes("PO-100007") && !(await page.isVisible("#npRestore")), "restore brings the skipped PO back");

  // ---- G. a new PO PDF arrives in the folder while the app is open
  await makePo(PO + "/PO-100010.pdf", "PO-100010", "08-11-2026", [["10-11-2026", 450], ["11-11-2026", 450]]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.waitForFunction(() => [...document.querySelectorAll("#npList .t")].some((e) => e.textContent === "PO-100010") || document.querySelector("#npMore:not([hidden])"), null, { timeout: 30000 });
  await page.click("#npMore"); await waitRows(page, 7);
  const last = (await rows(page)).pop(); ok(last.po === "PO-100010" && last.meta.includes("2 werkdagen") && last.meta.includes("€ 900,00"), "new PO shows up after coming back to the app: " + JSON.stringify(last));

  // ---- H. languages
  await setLang(page, "en"); await page.waitForTimeout(300);
  eq(await page.textContent("#newPo .eyebrow"), "New purchase orders", "English title");
  ok((await note(page)).startsWith("7 purchase orders in your folder have no invoice yet."), "English note: " + (await note(page)));
  eq(await page.textContent('#npList li button[data-npadd]'), "Add", "English add button"); eq(await page.textContent("#npAll"), "Add all (7)", "English add-all");
  ok((await rows(page))[0].meta.includes("ordered 28-10-2025"), "English row meta: " + (await rows(page))[0].meta);
  await setLang(page, "pl"); await page.waitForTimeout(300);
  eq(await page.textContent("#newPo .eyebrow"), "Nowe zamówienia zakupu", "Polish title"); eq(await page.textContent("#npAll"), "Dodaj wszystkie (7)", "Polish add-all");
  await setLang(page, "nl"); await page.waitForTimeout(200);

  // ---- I. disconnecting the PO folder (on the statistics tab) brings the prompt back
  await goSet(page, "folders"); await page.click("#poFolderClear"); await page.waitForTimeout(700); await goTab(page, "stats"); await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(300);
  await goTab(page, "inv"); await page.waitForTimeout(200);
  ok((await note(page)).startsWith("Kies de map met de inkooporders van Piguillet") && (await rows(page)).length === 0, "PO folder disconnected: prompt is back");

  console.log("errors:", errs); ok(!errs.length, "no page errors");
  fs.rmSync(tmp("po-folder/PO-100010.pdf"), { force: true });
  await app.close(); console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
