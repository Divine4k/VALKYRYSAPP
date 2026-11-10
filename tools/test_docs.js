// The Documents tab: one row per invoice number with its PDF and Word file from the invoice folder, its purchase order from the PO folder, and invoices made in the app
// that were never saved as a file. Sorting, search, the "sent" check marks (kept after a reload and a restart), the filter, and the previews (PDF, Word, PO).
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const { goTab, setLang, seedProfile, APP_DIR } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const TOOL = path.join(__dirname, "..", "tool");
const core = require(TOOL + "/invoice-core.js"), { buildDocx } = require(TOOL + "/invoice-docx.js");
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib"), docx = require("/home/claude/.npm-global/lib/node_modules/docx");

const HOME = "/tmp/el-appdata-docs", INV = "/tmp/docs-inv", PO = "/tmp/docs-po";
async function fixtures() {
  execFileSync("node", [path.join(__dirname, "make_po_folder.mjs"), TOOL, PO]); // PO-100001 … PO-100009 (some in a subfolder)
  for (const p of ["archief/PO-100001.pdf", "archief/PO-100008.pdf", "archief/PO-100009.pdf"]) fs.rmSync(`${PO}/${p}`, { force: true }); // left without an invoice: PO-100006, and PO-100007 (skipped)
  fs.rmSync(INV, { recursive: true, force: true }); fs.mkdirSync(INV, { recursive: true });
  const rd = (f) => fs.readFileSync(`${TOOL}/img/${f}`), images = { logo: rd("logo-white.png"), sidebar: rd("sidebar.png") };
  const client = { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" };
  const data = (nr, datum, desc, rate, qty) => ({ factuurnr: nr, datum, betaaltermijn: "14 dagen", client, lines: [{ desc, tarief: rate, aantal: qty }], btw: "verlegd", sender: core.SENDER });
  const pdf = async (file, d) => fs.writeFileSync(`${INV}/${file}`, await core.renderInvoice(PDFLib, { fontkit: null, fonts: null, images }, d));
  const word = async (file, d) => fs.writeFileSync(`${INV}/${file}`, await buildDocx(docx, { logo: images.logo, logoW: 1365, logoH: 318, accent: rd("accent.png"), background: rd("background.png"), footGap: 1500 }, d, core));
  await pdf("VALKYRYS 1-2026.pdf", data("1-2026", "12/01/2026", "PO-100002", 450, 5));      // PDF + Word, PO named inside
  await word("VALKYRYS 1-2026.docx", data("1-2026", "12/01/2026", "PO-100002", 450, 5));
  await pdf("VALKYRYS 2-2026 PO-100003.pdf", data("2-2026", "03/02/2026", "Werkzaamheden", 450, 4)); // PO only in the file name
  await word("VALKYRYS 3-2026.docx", data("3-2026", "10/03/2026", "PO-100004", 475, 2));     // Word only
  fs.writeFileSync(`${INV}/notities.txt`, "x");
}
const inv = (nr, datum, po, client, lines) => { const [n, y] = nr.split("-").map(Number); return { factuurnr: nr, nummer: n, jaar: y, po, datum, betaaltermijn: "14 dagen", client: { name: client }, lines, btw: "verlegd", totaal: core.totals(lines, "verlegd").total, dagen: [], createdAt: "2026-01-01T10:00:00Z" }; };

async function launch() {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME } });
  await app.evaluate(({ shell }) => { globalThis.__opened = []; globalThis.__shown = []; shell.openPath = async (p) => { globalThis.__opened.push(p); return ""; }; shell.showItemInFolder = (p) => { globalThis.__shown.push(p); }; });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
  await page.waitForSelector("#pick", { state: "attached" });
  return { app, page, errs };
}
const rows = (page) => page.$$eval("#docsList li:not(.po-only)", (li) => li.map((l) => l.dataset.nr)); // invoice rows; purchase orders without an invoice: poRows
const poRows = (page) => page.$$eval("#docsList li.po-only", (li) => li.map((l) => l.dataset.po));
const rowInfo = (page) => page.$$eval("#docsList li:not(.po-only)", (li) => li.map((l) => ({ nr: l.dataset.nr, client: l.querySelector(".c-cl").textContent, date: l.querySelector(".c-dt").textContent, po: l.querySelector(".c-po").textContent, amt: l.querySelector(".c-amt").textContent,
  docs: [...l.querySelectorAll("button.dchip:not(:disabled)")].map((b) => b.dataset.doc), off: [...l.querySelectorAll("button.dchip:disabled")].map((b) => b.textContent), sent: l.querySelector("input[data-sent]").checked, app: !!l.querySelector(".c-nr small") })));
const sortBy = async (page, v) => { await page.selectOption("#docsSort", v); await page.waitForTimeout(120); };
const readyAll = (page) => page.waitForFunction(() => { const l = [...document.querySelectorAll("#docsList li:not(.po-only)")]; return l.length === 5 && document.querySelectorAll("#docsList li.po-only").length === 2 && l.filter((x) => x.querySelector('button[data-doc="po"]')).length === 4; }, null, { timeout: 30000 }).then(() => true, () => false);

(async () => {
  await fixtures();
  fs.rmSync(HOME, { recursive: true, force: true }); seedProfile(HOME, { folder: INV, poFolder: PO });
  const dataFile = path.join(HOME, APP_DIR, "data.json"), db = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  db["settings/main"].client = { name: "Piguillet BV", street: "a", city: "b", kvk: "52742938", btw: "NL85" };
  db["invoices/4-2026"] = inv("4-2026", "15/01/2026", "PO-100005", "Aannemer Alfa BV", [{ desc: "PO-100005", tarief: 450, aantal: 3 }]); // made in the app, never saved as a file
  db["invoices/5-2026"] = inv("5-2026", "07/11/2026", "", "Zeta Bouw", [{ desc: "Advies", tarief: 500, aantal: 1 }]);                 // no purchase order
  db["settings/poskip"] = { list: ["PO-100007"] };
  fs.writeFileSync(dataFile, JSON.stringify(db));

  let { app, page, errs } = await launch();
  const allErrs = () => errs;
  eq(await page.$$eval("#tabs [role=tab]", (t) => t.map((x) => x.dataset.tab)), ["stats", "inv", "docs", "settings"], "four tabs, Documents third");
  await goTab(page, "docs");
  ok(await page.isVisible("#docsView") && !(await page.isVisible("#statsView")) && !(await page.isVisible("#viewInv")), "Documents tab opens");
  eq([await page.textContent("#pageTitle"), await page.textContent("#tagline")], ["Documenten", "Al je facturen met hun PDF, Word-bestand en inkooporder bij elkaar."], "page title and tagline");
  ok(await readyAll(page), "the folder and the purchase orders are read: 5 rows, 4 with a PO");
  ok(!(await page.isVisible("#docsNoFolder")) && !(await page.isVisible("#docsEmpty")), "no empty-state cards when there is something to show");

  // ---- the sets
  let R = await rowInfo(page); console.log(JSON.stringify(R));
  const by = (nr) => R.find((r) => r.nr === nr) || {};
  eq(R.map((r) => r.nr), ["5-2026", "4-2026", "3-2026", "2-2026", "1-2026"], "default: by number, newest first");
  eq(by("1-2026").docs, ["pdf", "word", "po"], "1-2026: PDF + Word + PO"); eq(by("1-2026").po, "PO-100002", "1-2026: PO named in the invoice");
  eq(by("2-2026").docs, ["pdf", "po"], "2-2026: PDF + PO"); eq(by("2-2026").off, ["Word"], "2-2026: Word shown as missing"); eq(by("2-2026").po, "PO-100003", "2-2026: PO from the file name");
  eq(by("3-2026").docs, ["word", "po"], "3-2026: Word only + PO"); eq(by("3-2026").po, "PO-100004", "3-2026: PO read from the Word file");
  eq(by("4-2026").docs, ["pdf", "po"], "4-2026 (app only): drawn PDF + PO"); ok(by("4-2026").app, "4-2026 is marked as only in the app");
  eq(by("5-2026").docs, ["pdf"], "5-2026: drawn PDF, no PO"); eq(by("5-2026").po, "–", "5-2026: no PO number");
  eq([by("1-2026").amt, by("4-2026").amt, by("5-2026").amt], ["€ 2.250,00", "€ 1.350,00", "€ 500,00"], "amounts like elsewhere");
  eq([by("4-2026").client, by("5-2026").client, by("4-2026").date], ["Aannemer Alfa BV", "Zeta Bouw", "15/01/2026"], "client and date");
  ok(by("1-2026").client.includes("Piguillet"), "client read from the invoice file: " + by("1-2026").client);
  { const t = await page.textContent("#docsInfo"); ok(t.includes("Facturen in de map: 3") && t.includes("Hoogste nummer dit jaar: 3-2026") && t.includes("met inkooporder: 4"), "info line: " + t); }
  ok(await page.$eval('#docsList li[data-nr="4-2026"] button[data-doc="pdf"]', (b) => b.classList.contains("gen")), "a drawn PDF looks different (dashed)");

  // ---- purchase orders without an invoice
  const P = await page.$$eval("#docsList li.po-only", (li) => li.map((l) => ({ po: l.dataset.po, nr: l.dataset.nr, badge: l.querySelector(".c-nr .chip").textContent, note: (l.querySelector(".c-nr small") || {}).textContent || "", client: l.querySelector(".c-cl").textContent,
    date: l.querySelector(".c-dt").textContent, poc: l.querySelector(".c-po").textContent, amt: l.querySelector(".c-amt").textContent, docs: [...l.querySelectorAll("button.dchip:not(:disabled)")].map((b) => b.dataset.doc),
    off: [...l.querySelectorAll("button.dchip:disabled")].map((b) => b.textContent), sent: !!l.querySelector("input[data-sent]"), mk: (l.querySelector("button[data-mkinv]") || {}).textContent })));
  console.log(JSON.stringify(P));
  eq(P.map((p) => p.po), ["PO-100006", "PO-100007"], "two POs without an invoice, the skipped one after");
  eq(await page.$$eval("#docsList li", (li) => li.slice(0, 2).map((l) => l.classList.contains("po-only"))), [true, true], "they come first in the default view");
  eq([P[0].nr, P[0].badge, P[0].note, P[0].client, P[0].date, P[0].poc, P[0].amt], ["", "Geen factuur", "", "Piguillet BV", "06/11/2026", "PO-100006", "€ 900,00"], "PO-only row: badge, client, order date, PO, PO total");
  eq([P[0].docs, P[0].off, P[0].sent, P[0].mk], [["po"], ["PDF", "Word"], false, "Factuur maken"], "PO-only row: only the PO chip, no sent box, a make-invoice button");
  eq([P[1].note, P[1].amt], ["overgeslagen", "€ 500,00"], "a skipped PO is still shown, marked skipped");
  await page.fill("#docsSearch", "100006"); await page.waitForTimeout(120); eq([await rows(page), await poRows(page)], [[], ["PO-100006"]], "search finds a PO without an invoice");
  await page.fill("#docsSearch", ""); await page.waitForTimeout(120);
  await sortBy(page, "date"); eq((await page.$$eval("#docsList li", (li) => li.map((l) => l.dataset.nr || l.dataset.po))).slice(0, 4), ["5-2026", "PO-100006", "PO-100007", "3-2026"], "by date: PO rows sorted by order date among the invoices");
  await sortBy(page, "nr");
  await page.screenshot({ path: "/tmp/docs_poonly.png" });

  // ---- sorting
  await sortBy(page, "date"); eq(await rows(page), ["5-2026", "3-2026", "2-2026", "4-2026", "1-2026"], "by date, newest first");
  await sortBy(page, "client"); R = await rowInfo(page); console.log("by client:", R.map((r) => r.nr + " " + r.client).join(" | "));
  eq(R.map((r) => r.client.startsWith("Piguillet") ? "P" : r.client), ["Aannemer Alfa BV", "P", "P", "P", "Zeta Bouw"], "by client A-Z");
  await sortBy(page, "po"); eq(await rows(page), ["1-2026", "2-2026", "3-2026", "4-2026", "5-2026"], "by PO number (ascending, no PO last)");
  await page.click("#docsDir"); await page.waitForTimeout(120); eq(await rows(page), ["4-2026", "3-2026", "2-2026", "1-2026", "5-2026"], "PO descending, no PO still last");
  const amtDesc = ["1-2026", "2-2026", "4-2026", "3-2026", "5-2026"]; // 2250, 1800, 1350, 950, 500
  await sortBy(page, "amount"); eq(await rows(page), amtDesc, "by amount, highest first");
  await page.click('#docsHead [data-sort="amount"]'); await page.waitForTimeout(120); eq(await rows(page), amtDesc.slice().reverse(), "clicking the amount head: lowest first");
  eq(await page.$eval("#docsDir", (b) => b.getAttribute("aria-label")), "Oplopend", "the direction button says ascending");
  eq(await page.$eval('#docsHead [data-sort="amount"]', (b) => !!b.getAttribute("aria-sort")), true, "sorted column head carries aria-sort");
  await page.click('#docsHead [data-sort="nr"]'); await page.waitForTimeout(120); eq(await rows(page), ["5-2026", "4-2026", "3-2026", "2-2026", "1-2026"], "number head: back to newest first");
  eq(await page.inputValue("#docsSort"), "nr", "the select follows the column head");

  // ---- search
  await page.fill("#docsSearch", "zeta"); await page.waitForTimeout(120); eq(await rows(page), ["5-2026"], "search by client");
  await page.fill("#docsSearch", "100003"); await page.waitForTimeout(120); eq(await rows(page), ["2-2026"], "search by PO");
  await page.fill("#docsSearch", "3-2026"); await page.waitForTimeout(120); eq(await rows(page), ["3-2026"], "search by number");
  await page.fill("#docsSearch", "nothing like this"); await page.waitForTimeout(120);
  ok(await page.isVisible("#docsEmpty") && (await page.textContent("#docsEmptyT")) === "Niets gevonden" && !(await page.isVisible("#docsTable")), "nothing found: its own message");
  await page.fill("#docsSearch", ""); await page.waitForTimeout(120); eq((await rows(page)).length, 5, "search cleared");

  // ---- sent check marks and the filter
  eq(await page.textContent("#docsCount"), "0 van 5 verzonden", "count: none sent yet");
  await page.check('input[data-sent="1-2026"]'); await page.check('input[data-sent="4-2026"]'); await page.waitForTimeout(400);
  eq(await page.textContent("#docsCount"), "2 van 5 verzonden", "count: 2 of 5 sent");
  ok(await page.$eval('#docsList li[data-nr="1-2026"]', (l) => l.classList.contains("sent")), "a sent row looks done");
  await page.click('#docsFilter [data-f="sent"]'); await page.waitForTimeout(150); eq(await rows(page), ["4-2026", "1-2026"], "filter: sent");
  await page.click('#docsFilter [data-f="open"]'); await page.waitForTimeout(150); eq(await rows(page), ["5-2026", "3-2026", "2-2026"], "filter: not sent");
  eq(await page.$$eval("#docsFilter .n", (n) => n.map((x) => x.textContent.trim())), ["7", "3", "2", "2"], "the filter buttons count (sent / not sent: invoices only)");
  await page.click('#docsFilter [data-f="noinv"]'); await page.waitForTimeout(150);
  eq([await rows(page), await poRows(page)], [[], ["PO-100006", "PO-100007"]], "filter: without invoice");
  await page.click('#docsFilter [data-f="open"]'); await page.waitForTimeout(150);
  await sortBy(page, "client"); await page.waitForTimeout(500);
  const saved = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  eq(saved["settings/sent"] && saved["settings/sent"].list.slice().sort(), ["1-2026", "4-2026"], "sent invoices saved in settings/sent");
  eq(saved["settings/docsprefs"], { sort: "client", dir: "asc", filter: "open" }, "sort and filter saved in settings/docsprefs");
  await page.reload(); await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "docs");
  await page.waitForFunction(() => document.querySelectorAll("#docsList li").length === 3, null, { timeout: 20000 }).catch(() => {});
  eq([await page.inputValue("#docsSort"), await page.$eval('#docsFilter [aria-pressed="true"]', (b) => b.dataset.f)], ["client", "open"], "after a reload: sort and filter kept");
  await page.click('#docsFilter [data-f="all"]'); await readyAll(page);
  eq((await rowInfo(page)).filter((r) => r.sent).map((r) => r.nr).sort(), ["1-2026", "4-2026"], "after a reload: check marks kept");
  await page.uncheck('input[data-sent="4-2026"]'); await page.waitForTimeout(400);
  await app.close(); ({ app, page, errs } = await launch()); await goTab(page, "docs"); await readyAll(page);
  eq((await rowInfo(page)).filter((r) => r.sent).map((r) => r.nr), ["1-2026"], "after a restart: only 1-2026 is still sent");
  eq(await page.$eval('#docsFilter [aria-pressed="true"]', (b) => b.dataset.f), "all", "after a restart: filter kept");
  await page.click('#docsHead [data-sort="nr"]'); await page.waitForTimeout(150);
  if ((await rows(page))[0] !== "5-2026") { await page.click('#docsHead [data-sort="nr"]'); await page.waitForTimeout(150); }

  // ---- previews
  await page.click('#docsList li[data-nr="1-2026"] button[data-doc="pdf"]'); await page.waitForSelector("#poPages canvas", { timeout: 15000 }).catch(() => {});
  ok(await page.$eval("#poDlg", (d) => d.open) && (await page.$$("#poPages canvas")).length >= 1, "PDF preview opens"); eq(await page.textContent("#poDlgTitle"), "Factuur 1-2026", "its title");
  eq(await page.textContent("#poDlgOpen"), "Openen in je PDF-lezer", "open-with button for a PDF");
  await page.click("#poDlgOpen"); await page.waitForTimeout(300); eq(await app.evaluate(() => globalThis.__opened), [INV + "/VALKYRYS 1-2026.pdf"], "the PDF opens outside the app");
  await page.click("#poDlgClose");
  await page.click('#docsList li[data-nr="4-2026"] button[data-doc="pdf"]'); await page.waitForSelector("#poPages canvas", { timeout: 15000 }).catch(() => {});
  ok((await page.$$("#poPages canvas")).length >= 1 && !(await page.isVisible("#poDlgOpen")), "an invoice only in the app is drawn again (nothing to open)"); await page.click("#poDlgClose");
  await page.click('#docsList li[data-nr="3-2026"] button[data-doc="word"]'); await page.waitForSelector("#poPages .wpage", { timeout: 15000 }).catch(() => {});
  const wtxt = (await page.$eval("#poPages", (p) => p.innerText).catch(() => "")).replace(/\s+/g, " "); console.log("word page:", wtxt.slice(0, 300));
  ok(await page.isVisible("#poPages .wpage"), "Word preview: a page is drawn"); ok(wtxt.includes("3-2026") && wtxt.includes("PO-100004"), "Word preview shows the invoice text");
  ok(await page.$eval("#poPages .wpage", (p) => !!p.querySelector("table td") && !!p.querySelector("img")), "Word preview has the table and the logo");
  ok(!(await page.isVisible("#poDlgErr")), "no error message");
  eq([await page.textContent("#poDlgTitle"), await page.textContent("#poDlgOpen")], ["Factuur 3-2026 (Word)", "Openen in Word"], "Word title and 'Open in Word'");
  await page.screenshot({ path: "/tmp/docs_word.png" });
  { const w = await page.$eval("#poDlg", (d) => { const r = d.getBoundingClientRect().left + d.clientWidth; return { sw: d.scrollWidth, cw: d.clientWidth, wide: [...d.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > r + 1).slice(0, 4).map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right)) }; });
    ok(w.sw <= w.cw + 1, "the Word page fits the window (no sideways scrolling)", w); }
  await page.click("#poDlgOpen"); await page.waitForTimeout(300); ok((await app.evaluate(() => globalThis.__opened)).includes(INV + "/VALKYRYS 3-2026.docx"), "the Word file opens in Word");
  await page.click("#poDlgClose");
  // a broken Word file falls back to the old message
  fs.writeFileSync(INV + "/VALKYRYS 1-2026.docx", "not a zip");
  await page.click('#docsList li[data-nr="1-2026"] button[data-doc="word"]'); await page.waitForTimeout(1200);
  ok(await page.isVisible("#poDlgErr") && (await page.textContent("#poDlgErr")).includes("Word"), "a damaged Word file: 'open it in Word' message"); await page.click("#poDlgClose");
  await page.click('#docsList li[data-nr="2-2026"] button[data-doc="po"]'); await page.waitForSelector("#poPages canvas", { timeout: 15000 }).catch(() => {});
  eq(await page.textContent("#poDlgTitle"), "Inkooporder PO-100003", "PO preview title"); ok((await page.$$("#poPages canvas")).length >= 1, "PO preview drawn"); await page.click("#poDlgClose");
  await page.click('#docsList li[data-nr="2-2026"] button[data-reveal]'); await page.waitForTimeout(300);
  eq(await app.evaluate(() => globalThis.__shown), [INV + "/VALKYRYS 2-2026 PO-100003.pdf"], "show in folder");
  // a PO without an invoice: its preview, then "Make invoice" puts it on the Invoices tab
  await page.click('#docsList li.po-only[data-po="PO-100006"] button[data-doc="po"]'); await page.waitForSelector("#poPages canvas", { timeout: 15000 }).catch(() => {});
  eq(await page.textContent("#poDlgTitle"), "Inkooporder PO-100006", "PO-only row: PO preview title"); ok((await page.$$("#poPages canvas")).length >= 1, "PO-only row: PO preview drawn");
  ok(await page.isVisible("#poDlgAdd"), "PO-only row: the preview offers to add it"); await page.click("#poDlgClose");
  await page.click('#docsList li.po-only[data-po="PO-100006"] button[data-mkinv]');
  const added = await page.waitForFunction(() => /PO-100006/.test((document.querySelector("#cards") || {}).textContent || ""), null, { timeout: 20000 }).then(() => true, () => false);
  ok(await page.isVisible("#viewInv") && added, "Make invoice: Invoices tab open with PO-100006 in the list");
  await goTab(page, "docs"); await page.waitForTimeout(300);

  // ---- languages
  await setLang(page, "en"); await page.waitForTimeout(250);
  eq([await page.textContent("#tabDocs"), await page.textContent("#pageTitle"), await page.textContent("#docsCount")], ["Documents", "Documents", "1 of 5 sent"], "English");
  eq([await page.textContent('#docsFilter [data-f="noinv"] [data-i18n]'), await page.textContent("#docsList li.po-only .chip"), await page.textContent("#docsList li.po-only button[data-mkinv]")], ["Without invoice", "No invoice", "Make invoice"], "English: PO-only texts");
  eq(await page.$$eval("#docsHead > *", (h) => h.map((x) => x.textContent.replace(/[▲▼]/g, "").trim()).filter(Boolean)), ["Number", "Client", "Date", "Purchase order", "Amount", "Documents", "Sent"], "English column heads");
  await setLang(page, "pl"); await page.waitForTimeout(250);
  eq([await page.textContent("#tabDocs"), await page.textContent("#docsCount"), await page.textContent('#docsFilter [data-f="open"] [data-i18n]')], ["Dokumenty", "Wysłane: 1 z 5", "Niewysłane"], "Polish");
  eq([await page.textContent('#docsFilter [data-f="noinv"] [data-i18n]'), await page.textContent("#docsList li.po-only .chip"), await page.textContent("#docsList li.po-only button[data-mkinv]")], ["Bez faktury", "Brak faktury", "Utwórz fakturę"], "Polish: PO-only texts");
  await setLang(page, "nl"); await page.waitForTimeout(250);

  // ---- looks: light, dark, phone width
  await page.evaluate(() => window.ValkTheme.apply({ id: "light" })); await page.waitForTimeout(250); await page.screenshot({ path: "/tmp/docs_light.png", fullPage: true });
  await page.evaluate(() => window.ValkTheme.apply({ id: "dark" })); await page.waitForTimeout(250); await page.screenshot({ path: "/tmp/docs_dark.png", fullPage: true });
  await page.evaluate(() => window.ValkTheme.apply({ id: "light" }));
  for (const w of [900, 700, 390]) {
    await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `fits a ${w}px window`);
    ok(await page.evaluate(() => { const t = [...document.querySelectorAll("#tabs [role=tab]")]; return t.every((b) => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= window.innerWidth); }), `all four tabs fit at ${w}px`);
  }
  await page.waitForTimeout(300); { const [a, b] = [await page.locator("#tabs .seg-ind").boundingBox(), await page.locator("#tabDocs").boundingBox()]; ok(a && b && Math.abs(a.x - b.x) <= 2 && Math.abs(a.width - b.width) <= 2, "indicator under Documenten on a phone", { a, b }); }
  await page.screenshot({ path: "/tmp/docs_phone.png", fullPage: true });
  console.log("errors:", allErrs()); ok(errs.length === 0, "no page errors");
  await app.close();

  // ---- no invoice folder: the card that points to Settings, invoices from the app still listed
  fs.rmSync(HOME, { recursive: true, force: true }); seedProfile(HOME, {});
  ({ app, page, errs } = await launch()); await goTab(page, "docs"); await page.waitForTimeout(600);
  ok(await page.isVisible("#docsNoFolder") && await page.isVisible("#docsGoSet"), "no folder: a card that points to Settings");
  ok(!(await page.isVisible("#docsEmpty")), "...and no second empty message");
  await page.click("#docsGoSet"); await page.waitForTimeout(200); ok(await page.isVisible("#settingsView"), "the button opens Settings");
  console.log("errors:", errs); ok(errs.length === 0, "no page errors (no folder)");
  await app.close();
  console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
