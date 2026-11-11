// The same work day on more than one purchase order: the notice on the statistics, the list to check them in (preview, show in folder),
const { tmp, goTab, setLang, seedProfile } = require("./test_helpers");
// and the same PO number in several files. It only informs: the figures of the statistics do not change.
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib");
const dataHome = tmp("el-appdata-dup"), PO = tmp("po-dups");
const money = (n) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2 });
async function makePo(file, po, order, items, mtime) {
  const doc = await PDFLib.PDFDocument.create(), page = doc.addPage([595, 842]), f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const total = items.reduce((a, [, pr]) => a + pr, 0);
  const lines = ["Piguillet", "Groep", "Inkooporder Inkooporder", "Aan: Afleveradres:", "Valkyrys", "Harderwijkstraat 115", "2573ZC 's-gravenhage", "Aflevernotitie:",
    `Ordernummer : ${po}`, "Levering : DDP (Incoterms 2020)", `Besteldatum : ${order}`, `Leverdatum : ${order}`, "Besteld door : Annelies Hartman-Kuivenhoven",
    "Aantal Nummer Omschrijving Prijs Totaalbedrag", ...items.map(([d, pr]) => `1 Dagprijs ${d} - Przemyslaw Wodecki - TB/2025-08/006531 ${money(pr)} ${money(pr)}`),
    `Totaalbedrag inkooporder ${money(total)}`, "Alle genoemde prijzen zijn exc. btw", "Facturatievoorwaarden:", "KvK nr. 52742938 BTW nr. NL850577950B01 IBAN NL48 INGB0009237048"];
  lines.forEach((t, i) => page.drawText(t, { x: 40, y: 800 - i * 18, size: 10, font: f }));
  fs.writeFileSync(path.join(PO, file), await doc.save());
  if (mtime) fs.utimesSync(path.join(PO, file), mtime, mtime);
}
const seed = () => { fs.rmSync(dataHome, { recursive: true, force: true }); seedProfile(dataHome, { poFolder: PO }); };
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.evaluate(({ shell }) => { globalThis.__shown = []; shell.showItemInFolder = (p) => globalThis.__shown.push(p); });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 }).catch(() => {});
  await page.waitForSelector("#statsView", { state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#scanNote") || document.querySelector("#scanNote").hidden, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  return { app, page, errs };
};
(async () => {
  seed(); fs.rmSync(PO, { recursive: true, force: true }); fs.mkdirSync(PO, { recursive: true });
  const older = new Date(Date.now() - 5 * 86400000), newer = new Date(Date.now() - 1 * 86400000);
  // a first PO with a wrong rate, and the corrected one that came after it: three work days are on both
  await makePo("PO-200001.pdf", "PO-200001", "01-04-2026", [["14-04-2026", 450], ["15-04-2026", 450], ["16-04-2026", 450]]);
  await makePo("PO-200002.pdf", "PO-200002", "20-04-2026", [["14-04-2026", 500], ["15-04-2026", 500], ["16-04-2026", 500], ["17-04-2026", 500]]);
  // two real jobs on one day: same rate, different orders
  await makePo("PO-200003.pdf", "PO-200003", "18-05-2026", [["20-05-2026", 450]]);
  await makePo("PO-200004.pdf", "PO-200004", "19-05-2026", [["20-05-2026", 450]]);
  // the same PO number in two files, with another amount; the newer file is the one that counts
  await makePo("PO-200005.pdf", "PO-200005", "01-06-2026", [["02-06-2026", 450]], older);
  await makePo("PO-200005 gecorrigeerd.pdf", "PO-200005", "01-06-2026", [["02-06-2026", 480]], newer);
  // an unrelated order
  await makePo("PO-200006.pdf", "PO-200006", "01-07-2026", [["06-07-2026", 450]]);

  let { app, page, errs } = await launch();
  ok(await page.isVisible("#dupBar"), "the notice is shown on the statistics");
  eq(await page.textContent("#dupText"), "Let op: 4 werkdagen op meer dan één inkooporder. Inkooporders in meerdere bestanden: 1.", "the notice counts the days and the PO in two files");
  ok(await page.isVisible("#dupOpen"), "it has a button to look at them");
  // the figures are not changed by it: each work day is still one day (April: 14, 15, 16, 17 = 4 days)
  await page.click('#statSource [data-src="pos"]'); await page.waitForTimeout(500);
  const rows = await page.$$eval("#stTable tbody tr", (r) => r.map((x) => [...x.children].map((c) => c.textContent.trim())));
  const april = rows.find((r) => r[0] === "April"), may = rows.find((r) => r[0] === "Mei");
  eq(april && april[2], "4", "April still counts 4 days: " + JSON.stringify(april)); eq(may && may[2], "1", "20 May is one day however many orders mention it: " + JSON.stringify(may));
  ok(await page.isVisible("#dupBar"), "the notice stays when the source is switched to purchase orders");
  await page.click('#statSource [data-src="invoices"]'); await page.waitForTimeout(300);
  ok(await page.isVisible("#dupBar"), "...and on the invoice source too (it is about the PO folder)");

  await page.click("#dupOpen"); await page.waitForSelector("#dupDlg[open]");
  eq(await page.textContent("#dupDlgTitle"), "Inkooporders controleren", "dialog title");
  const sections = await page.$$eval("#dupBody .dsec", (s) => s.map((x) => x.textContent));
  eq(sections, ["Dubbele dagen op inkooporders", "Dezelfde inkooporder in meerdere bestanden"], "two sections");
  const groups = await page.$$eval("#dupBody .dgrp", (g) => g.map((x) => ({ h: x.querySelector("h3").innerText.replace(/\s+/g, " ").trim(), dates: x.querySelector(".dd") ? x.querySelector(".dd").textContent : "", pos: [...x.querySelectorAll(".dpo")].map((p) => p.querySelector(".dn").innerText.replace(/\s+/g, " ").trim()) })));
  console.log(JSON.stringify(groups, null, 1));
  eq(groups.length, 3, "three groups");
  ok(groups[0].h.startsWith("3 werkdagen op 2 inkooporders") && groups[0].h.includes("Ander tarief"), "the wrong/corrected pair: 3 days, flagged 'Ander tarief': " + groups[0].h);
  eq(groups[0].dates, "Dagen: 14-04-2026, 15-04-2026, 16-04-2026", "its days are listed");
  eq(groups[0].pos, ["PO-200001", "PO-200002"], "its two orders");
  ok(groups[1].h.startsWith("1 werkdag op 2 inkooporders") && !groups[1].h.includes("Ander tarief"), "two real jobs on one day: no 'other rate' flag: " + groups[1].h);
  eq(groups[1].pos, ["PO-200003", "PO-200004"], "...with both orders");
  ok(groups[2].h.startsWith("PO-200005") && groups[2].h.includes("Ander bedrag"), "same PO number in two files, other amount: " + groups[2].h);
  ok(groups[2].pos[0].includes("PO-200005 gecorrigeerd.pdf") && groups[2].pos[0].includes("Wordt geteld") && !groups[2].pos[1].includes("Wordt geteld"), "the newer file is marked as the one that counts: " + JSON.stringify(groups[2].pos));
  const meta = await page.$$eval("#dupBody .dgrp:first-of-type .dpo .dm", (m) => m.map((x) => x.textContent));
  console.log(meta);
  ok(meta.some((t) => t.includes("besteld 01-04-2026") && t.includes("tarief € 450,00") && t.includes("€ 1.350,00 voor deze dagen")), "the first order: order date, rate and its amount for those days");
  ok(meta.some((t) => t.includes("besteld 20-04-2026") && t.includes("tarief € 500,00") && t.includes("€ 1.500,00 voor deze dagen")), "the corrected order: other rate and amount");
  ok((await page.$$eval("#dupBody .dpo", (d) => d.every((x) => x.querySelector("[data-dprev]") && x.querySelector("[data-dshow]")))), "every order has Voorbeeld and Toon in map");

  // preview a PO from the list
  await page.click('#dupBody .dpo:has-text("PO-200002") [data-dprev]'); await page.waitForSelector("#poDlg[open] canvas", { timeout: 20000 });
  eq(await page.textContent("#poDlgTitle"), "Inkooporder PO-200002", "preview title"); await page.click("#poDlgClose"); await page.waitForTimeout(200);
  ok(await page.$eval("#dupDlg", (d) => d.open), "the list is still open behind the preview");
  // show in folder
  await page.click('#dupBody .dpo:has-text("PO-200001") [data-dshow]'); await page.waitForTimeout(400);
  eq(await app.evaluate(() => globalThis.__shown), [PO + "/PO-200001.pdf"], "'Toon in map' shows that file in its folder");
  // narrow window: no sideways scrolling
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(300);
  ok(await page.$eval("#dupDlg", (d) => d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone-width window");
  await page.screenshot({ path: "/tmp/dups-phone.png" }); await page.setViewportSize({ width: 1280, height: 1000 });
  await page.screenshot({ path: "/tmp/dups-wide.png" });
  await page.click("#dupDlgClose");

  // languages
  await setLang(page, "en"); await page.waitForTimeout(200);
  eq(await page.textContent("#dupText"), "Heads-up: 4 working days on more than one purchase order. Purchase orders in more than one file: 1.", "English notice");
  await setLang(page, "pl"); await page.waitForTimeout(200);
  eq(await page.textContent("#dupText"), "Uwaga: 4 dni robocze na więcej niż jednym zamówieniu zakupu. Zamówienia zakupu w kilku plikach: 1.", "Polish notice");
  await page.click("#dupOpen"); await page.waitForSelector("#dupDlg[open]");
  ok((await page.textContent("#dupBody .dgrp h3")).startsWith("3 dni robocze na 2 zamówieniach zakupu"), "Polish list: " + (await page.textContent("#dupBody .dgrp h3")));
  await page.click("#dupDlgClose"); await setLang(page, "nl");

  // after the wrong ones are removed from the folder, the notice is gone
  await app.close();
  for (const f of ["PO-200002.pdf", "PO-200004.pdf", "PO-200005.pdf"]) fs.rmSync(path.join(PO, f));
  ({ app, page, errs } = await launch());
  ok(!(await page.isVisible("#dupBar")), "no notice once the duplicates are gone from the folder");
  console.log("errors:", errs); ok(errs.length === 0, "no page errors");
  await app.close();
  console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
