// Folders on a USB stick / external drive: pulled out while the app runs (the folders vanish), plugged in again (they come back).
// Pulled out: the app notices by itself within seconds, says the folder is not there, keeps every invoice record, saving says so.
// Plugged in: the app notices by itself (no click, no focus change), the rows and numbers are back, nothing was removed.
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { tmp, goTab, seedProfile, APP_DIR } = require("./test_helpers");
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const STICK = tmp("usb-stick"), OUT = tmp("usb-out"), INV = path.join(STICK, "Facturen"), PO = path.join(STICK, "Inkooporders"), dataHome = tmp("el-appdata-usb");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await sleep(200); } return false; };
const db = () => { try { return JSON.parse(fs.readFileSync(path.join(dataHome, APP_DIR, "data.json"), "utf8")); } catch (e) { return {}; } };
async function makePo(file, po, d) {
  const doc = await PDFLib.PDFDocument.create(), page = doc.addPage([595, 842]), f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const lines = ["Piguillet", "Groep", "Inkooporder Inkooporder", "Aan: Afleveradres:", "Valkyrys", "Harderwijkstraat 115", "2573ZC 's-gravenhage", "Aflevernotitie:", `Ordernummer : ${po}`, "Levering : DDP (Incoterms 2020)", `Besteldatum : ${d}`, `Leverdatum : ${d}`,
    "Aantal Omschrijving Prijs Bedrag", `1 Dagprijs ${d} - Przemyslaw Wodecki - TB/2025-08/006531 € 600,00 € 600,00`, "Totaalbedrag inkooporder € 600,00", "Alle genoemde prijzen zijn exc. btw", "Facturatievoorwaarden:", "KvK nr. 52742938 BTW nr. NL850577950B01"];
  lines.forEach((t, i) => page.drawText(t, { x: 40, y: 800 - i * 18, size: 10, font: f })); fs.writeFileSync(file, await doc.save());
}
(async () => {
  for (const d of [STICK, OUT, dataHome]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
  fs.mkdirSync(INV); fs.mkdirSync(PO);
  for (const [i, po] of ["PO-300001", "PO-300002", "PO-300003"].entries()) await makePo(path.join(PO, po + ".pdf"), po, `0${i + 1}-10-2026`);
  seedProfile(dataHome, { folder: INV, poFolder: PO });
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await sleep(200); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv");
  await page.waitForFunction(() => document.querySelectorAll("#npList li").length === 3, null, { timeout: 60000 }); ok(true, "3 new purchase orders from the stick");
  // two invoices onto the stick
  await page.click("#npAll"); await page.waitForFunction(() => document.querySelectorAll("article.po h3").length === 3, null, { timeout: 30000 });
  await page.click("#zipAll"); ok(await until(() => fs.readdirSync(INV).filter((n) => n.endsWith(".docx")).length === 3, 40000), "3 invoices saved on the stick");
  await sleep(1500); await page.click("#clear").catch(() => {}); await sleep(300);
  const recs = () => Object.keys(db()).filter((k) => k.startsWith("invoices/")).sort();
  const before = recs(); console.log("records:", before); ok(before.length >= 1, "records in the app");
  await goTab(page, "docs"); ok(await until(async () => (await page.$$("#docsList li[data-nr]")).length === before.length), "Documents: a row per invoice");
  const next = await page.evaluate(() => document.querySelector("#nextNr") && document.querySelector("#nextNr").textContent);

  // ---- pulled out: no click, no focus change
  fs.renameSync(STICK, OUT + "/stick");
  ok(await until(async () => (await page.evaluate(() => !!(state.folder && !state.folder.exists)))), "pulled out: noticed on its own");
  await sleep(4000); // a few more looks, and a refresh
  await page.click("#docsBar [data-refresh]").catch(() => {}); await sleep(2500);
  ok(JSON.stringify(recs()) === JSON.stringify(before), "pulled out: no invoice record removed", recs());
  ok(await page.evaluate(() => !!(state.poFolder && !state.poFolder.exists)), "the PO folder is seen as not there too");
  await page.screenshot({ path: "/tmp/usb_out.png" });

  // ---- plugged in again
  fs.renameSync(OUT + "/stick", STICK);
  ok(await until(async () => (await page.evaluate(() => !!(state.folder && state.folder.exists && state.poFolder && state.poFolder.exists))) && (await page.$$("#docsList li[data-nr]")).length === before.length), "plugged in: back on its own, every row there");
  await sleep(3500);
  ok(JSON.stringify(recs()) === JSON.stringify(before), "plugged in: still every record", recs());
  ok((await page.evaluate(() => document.querySelector("#nextNr") && document.querySelector("#nextNr").textContent)) === next, "next number unchanged: " + next);
  await goTab(page, "inv"); ok(await until(async () => (await page.$$("#npList li")).length === 3 - before.length), "new POs from the stick listed again");
  await page.screenshot({ path: "/tmp/usb_back.png" });
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close();
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
