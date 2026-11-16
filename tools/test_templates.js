// Invoice designs: a new install starts without designs (add your own Word design, or later; invoices wait), the person's own details, changing the design in Settings,
// an installation from before the designs existed (it stays on the Valkyrys design), and that old invoices keep the design they were made in.
const { tmp, goTab, setLang, seedProfile, chooseDesign } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const HOME = tmp("el-appdata-tpl"), INV = tmp("tpl-inv");
const D = path.join(HOME, "Valkyrys app");
const pdfText = (f) => execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
const docxXml = (f) => execFileSync("unzip", ["-p", f, "word/document.xml"], { encoding: "utf8", maxBuffer: 1e8 });
const data = () => JSON.parse(fs.readFileSync(path.join(D, "data.json"), "utf8"));
const wait = (cond, ms = 15000) => new Promise(async (res) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return res(true); await new Promise((r) => setTimeout(r, 150)); } res(false); });
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 }).catch(() => {});
  await page.waitForSelector("#statsView", { state: "attached" });
  return { app, page, errs };
};
const D1 = { person: "J. Jansen", street: "Voorbeeldstraat 12", city: "1234 AB Teststad", phone: "0612345678", email: "info@extreme.example", iban: "NL91 ABNA 0417 1643 00", btw: "NL123456789B01", kvk: "12345678" };
/** one card: its PDF button, and its Word button (the batch button only shows with two or more cards) */
const dl = async (page, word) => { await page.click("button[data-act=download]"); if (await page.waitForSelector("#poDupDlg[open]", { timeout: 1000 }).catch(() => null)) await page.click("#poDupGo"); /* same PO as an earlier invoice: save anyway */ if (word) { await page.waitForTimeout(1000); await page.click("button[data-act=download-docx]"); } };
const fillWz = async (page, p) => { for (const [k, v] of Object.entries(D1)) await page.fill("#" + p + k, v); };

(async () => {
  // ---------------------------------------------------------------- 1. a fresh install: no built-in designs; the person adds their own Word design (or later)
  const JSZip = require("/opt/npm-tools/node_modules/jszip"), { OWN, makeCustomDocx } = require("./make_custom_docx.js");
  const FIX = tmp("tpl-fixture/Bouw ontwerp.docx"); fs.mkdirSync(path.dirname(FIX), { recursive: true });
  fs.writeFileSync(FIX, await makeCustomDocx(JSZip, fs.readFileSync(path.join(__dirname, "../tool/templates/extreme.docx"))));
  const mockOpen = (app) => app.evaluate(({ dialog }, F) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [F] }); }, FIX);
  const year = new Date().getFullYear(), PO = process.argv[3];
  const file = (n, ext) => path.join(INV, `VALKYRYS ${n}-${year}.${ext}`);
  const isOpen = (page, sel) => page.evaluate((s) => document.querySelector(s).open, sel);
  const fresh = (n, ext) => path.join(INV, `Factuur ${n}-${year}.${ext}`); // a new install: numbering from 1, a neutral file name

  // 1a. "add later": invoices wait until a design is added
  fs.rmSync(HOME, { recursive: true, force: true }); fs.rmSync(INV, { recursive: true, force: true }); fs.mkdirSync(INV, { recursive: true });
  seedProfile(HOME, { folder: INV }, { fresh: true });
  let { app, page, errs } = await launch();
  await page.waitForSelector("#tplDlg[open]");
  eq(await page.$$eval("#tplGrid [data-tpl]", (b) => b.map((x) => x.dataset.tpl)), ["standard"], "a new install offers the Standard design (for anyone), not the two personal ones");
  ok((await page.textContent("#tplIntro")).includes("Kies het standaardontwerp, of voeg je eigen ontwerp toe als Word-bestand") && !(await page.$("#tplEmpty")), "the dialog says: the standard design, or your own Word file: " + (await page.textContent("#tplIntro")));
  eq(await page.$eval('#tplGrid [data-tpl="standard"]', (b) => [b.querySelector(".tname").textContent, b.querySelector("img").naturalWidth > 0]), ["Standaard", true], "...shown with its name and picture");
  ok(await page.isVisible("#tplAdd") && await page.isVisible("#tplSkip") && await page.isDisabled("#tplNext"), "the choices: add a design, or add it later");
  ok(await page.isHidden("#tplDlgClose"), "no close button at the first start");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300); ok(await isOpen(page, "#tplDlg"), "Escape does not close it");
  await page.screenshot({ path: "/tmp/fr_design_empty.png" });
  await page.click("#tplSkip"); await page.waitForFunction(() => !document.querySelector("#tplDlg").open);
  const s0 = data()["settings/main"]; eq([s0.builtins, !!s0.template, s0.designSkipped], [false, false, true], "'add later': no design, and that is remembered");
  await goTab(page, "settings");
  eq([await page.textContent("#tplCurName"), await page.textContent("#tplChange"), await page.inputValue("#sdname"), await page.inputValue("#sdiban")], ["Nog geen factuurontwerp", "Ontwerp toevoegen…", "", ""], "Settings: no design, no details of someone else");
  await goTab(page, "inv");
  ok(await page.isVisible("#detBar") && (await page.textContent("#detBarText")).includes("Voeg eerst een factuurontwerp toe"), "the invoices page says a design is needed: " + (await page.textContent("#detBarText")));
  await page.setInputFiles("#file", PO); await page.waitForSelector("article.po h3");
  await dl(page, false); await page.waitForTimeout(1500);
  ok(!fs.existsSync(fresh(1, "pdf")), "no invoice is made without a design");
  ok((await page.textContent("#toast")).includes("Voeg eerst een factuurontwerp toe") && await page.isVisible("#settingsView"), "it says why and opens Settings");
  ok(errs.length === 0, "no page errors in part 1a: " + errs.join(" | ")); await app.close();
  ({ app, page, errs } = await launch()); await page.waitForTimeout(1500);
  ok(!(await isOpen(page, "#tplDlg")), "the next start does not ask again");
  await mockOpen(app);
  await goTab(page, "inv"); await page.waitForSelector("#detBar", { state: "visible" }); await page.click("#detBarGo");
  await page.waitForSelector("#tplDlg[open]"); ok(await page.isVisible("#tplDlgClose") && (await page.$$("#tplGrid [data-tpl]")).length === 1, "the banner button opens the design list");
  await page.click("#tplAdd"); await page.waitForSelector("#tplGrid [data-tpl^=c]");
  eq(await page.$$eval("#tplGrid [data-tpl]", (b) => b.length), 2, "the own design is listed beside the Standard one");
  await page.click("#tplNext"); await page.waitForFunction(() => !document.querySelector("#tplDlg").open);
  eq([await page.textContent("#tplCurName"), await page.inputValue("#sdiban")], ["Bouw ontwerp", OWN.iban], "Settings shows the own design and its details");
  await goTab(page, "inv"); ok(await page.isHidden("#detBar"), "the warning is gone");
  await page.setInputFiles("#file", PO); await page.waitForSelector("article.po h3");
  await dl(page, true); ok(await wait(() => fs.existsSync(fresh(1, "pdf")) && fs.existsSync(fresh(1, "docx"))), "now an invoice is made (number 1, 'Factuur 1-" + year + "')");
  ok(pdfText(fresh(1, "pdf")).includes(OWN.iban) && !/valkyrys/i.test(pdfText(fresh(1, "pdf"))), "with the details of the own design, and nothing of Valkyrys on it");
  ok(errs.length === 0, "no page errors in part 1a (2): " + errs.join(" | ")); await app.close();

  // 1b. adding the design in the first-start dialog: then the details, then the folders
  fs.rmSync(HOME, { recursive: true, force: true }); seedProfile(HOME, { welcomed: false }, { fresh: true });
  ({ app, page, errs } = await launch()); await mockOpen(app);
  await page.waitForSelector("#tplDlg[open]");
  ok(!(await isOpen(page, "#welcomeDlg")), "the folder question waits for the design");
  await page.click("#tplAdd"); await page.waitForSelector("#tplGrid [data-tpl^=c]");
  ok(!(await page.isDisabled("#tplNext")), "the added design is chosen");
  await page.click("#tplNext"); await page.waitForSelector("#tplStep2", { state: "visible" });
  eq([await page.inputValue("#wzname"), await page.inputValue("#wziban")], [OWN.name, OWN.iban], "the details step has the details from the Word file");
  await page.click("#tplDone"); await page.waitForSelector("#welcomeDlg[open]"); ok(true, "after the design come the folders");
  await page.click("#wsLater");
  const s1 = data()["settings/main"];
  ok(/^c/.test(s1.template || "") && s1.builtins === false && s1.sender.iban === OWN.iban, "the own design and details are saved", s1.template);
  ok(errs.length === 0, "no page errors in part 1b: " + errs.join(" | ")); await app.close();

  // 1c. a new user without a Word file of their own: the Standard design, their details, the first invoice
  fs.rmSync(HOME, { recursive: true, force: true }); fs.rmSync(INV, { recursive: true, force: true }); fs.mkdirSync(INV, { recursive: true });
  seedProfile(HOME, { folder: INV }, { fresh: true });
  ({ app, page, errs } = await launch()); await page.waitForSelector("#tplDlg[open]");
  await page.click('#tplGrid [data-tpl="standard"]'); ok(!(await page.isDisabled("#tplNext")), "the Standard design can be chosen");
  await page.screenshot({ path: "/tmp/fr_design_standard.png" });
  await page.click("#tplNext"); await page.waitForSelector("#tplStep2", { state: "visible" });
  eq([await page.inputValue("#wzname"), await page.inputValue("#wziban"), await page.inputValue("#wzstart")], ["", "", "1"], "its details step is empty (nobody else's details) and numbering starts at 1");
  const ME = { name: "Schildersbedrijf Internationaal Vastgoedonderhoud", ...D1 };
  for (const [k, v] of Object.entries(ME)) await page.fill("#wz" + k, v);
  await page.click("#tplDone"); await page.waitForFunction(() => !document.querySelector("#tplDlg").open);
  const s2 = data()["settings/main"];
  eq([s2.template, s2.fileTemplate, s2.startNumber, s2.sender.name, s2.builtins], ["standard", "Factuur {nummer}", 1, ME.name, false], "the Standard design, a neutral file name, numbering from 1 and the person's details are saved");
  await goTab(page, "settings"); eq([await page.textContent("#tplCurName"), await page.inputValue("#sFile")], ["Standaard", "Factuur {nummer}"], "Settings shows the Standard design");
  await goTab(page, "inv"); ok(await page.isHidden("#detBar"), "nothing is missing");
  await page.setInputFiles("#file", PO); await page.waitForSelector("article.po h3");
  await dl(page, true); ok(await wait(() => fs.existsSync(fresh(1, "pdf")) && fs.existsSync(fresh(1, "docx"))), "the first invoice is made: Factuur 1-" + year);
  { const tp = pdfText(fresh(1, "pdf")), tw = docxXml(fresh(1, "docx"));
    ok(tp.includes("Internationaal") && tp.includes(ME.iban) && tp.includes(`1-${year}`) && tp.includes("Piguillet BV") && !/valkyrys/i.test(tp), "the PDF has the person's own name and details, and nothing of Valkyrys");
    ok(tw.includes(ME.iban) && tw.includes("Internationaal") && !/valkyrys/i.test(tw), "and so has the Word file"); }
  ok(errs.length === 0, "no page errors in part 1c: " + errs.join(" | ")); await app.close();

  // ---------------------------------------------------------------- 2. an installation from before the designs: Valkyrys, nothing is asked
  fs.rmSync(HOME, { recursive: true, force: true }); fs.rmSync(INV, { recursive: true, force: true }); fs.mkdirSync(INV, { recursive: true });
  seedProfile(HOME, { folder: INV }, { template: null });
  fs.writeFileSync(path.join(D, "data.json"), JSON.stringify({ "settings/main": { startNumber: 62, startYear: new Date().getFullYear(), betaaltermijn: "14 dagen", btw: "verlegd", fileTemplate: "VALKYRYS {nummer}",
    client: { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" } } }));
  ({ app, page, errs } = await launch()); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => !document.querySelector("#tplDlg").open), "an older installation is not asked for a design");
  eq(data()["settings/main"].template, "valkyrys", "it is saved as the Valkyrys design");
  await goTab(page, "settings");
  eq([await page.textContent("#tplCurName"), await page.inputValue("#sdname"), await page.inputValue("#sdiban")], ["Valkyrys", "Valkyrys", "NL42 INGB 0103 2069 73"], "its details are the Valkyrys ones");
  ok(await page.isHidden("#detBar"), "no warning about missing details");

  await goTab(page, "inv"); await page.setInputFiles("#file", PO); await page.waitForSelector("article.po h3");
  await dl(page, true); ok(await wait(() => fs.existsSync(file(62, "pdf")) && fs.existsSync(file(62, "docx"))), "an invoice is saved as PDF and Word");
  let t = pdfText(file(62, "pdf"));
  ok(t.includes("Valkyrys") && t.includes("NL42 INGB 0103 2069 73") && t.includes(`62-${year}`), "the PDF is in the Valkyrys design with its details");
  ok(docxXml(file(62, "docx")).includes("NL003608498B64"), "and so is the Word file");

  // change the design: the details of the other design are empty, so nothing can be made until they are filled in
  await page.click("button[data-act=remove]"); await goTab(page, "settings");
  await page.click("#tplChange"); await page.waitForSelector("#tplDlg[open]");
  eq(await page.$$eval("#tplGrid [data-tpl]", (b) => b.map((x) => x.dataset.tpl)), ["valkyrys", "extreme", "standard"], "an older installation still has its built-in designs, and the Standard one beside them");
  ok(await page.isVisible("#tplDlgClose"), "changing the design can be cancelled");
  eq(await page.getAttribute("#tplGrid [data-tpl=valkyrys]", "aria-checked"), "true", "the current design is marked");
  await page.click("#tplGrid [data-tpl=extreme]"); await page.click("#tplNext");
  await page.waitForFunction(() => !document.querySelector("#tplDlg").open);
  eq([await page.textContent("#tplCurName"), await page.inputValue("#sdname")], ["Extreme Building", "Extreme Building"], "the design and its company name are in Settings");
  ok(await page.isVisible("#detWarn"), "Settings says which details are missing");
  await goTab(page, "inv"); ok(await page.isVisible("#detBar"), "so does the invoices page: " + (await page.textContent("#detBarText")));
  await page.setInputFiles("#file", PO); await page.waitForSelector("article.po h3");
  await dl(page, false); await page.waitForTimeout(1500);
  ok(!fs.existsSync(file(63, "pdf")), "no invoice is made while the details are incomplete");
  ok((await page.textContent("#toast")).includes("Vul eerst je gegevens in") && await page.isVisible("#settingsView"), "it says why and opens Settings");
  for (const [k, v] of Object.entries(D1)) await page.fill("#sd" + k, v);
  await page.click("#detForm button[type=submit]"); await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("opgeslagen"));
  await goTab(page, "inv"); ok(await page.isHidden("#detBar"), "the warning is gone once the details are in");
  await dl(page, true); ok(await wait(() => fs.existsSync(file(63, "pdf")) && fs.existsSync(file(63, "docx"))), "now the invoice is made");
  t = pdfText(file(63, "pdf"));
  ok(t.includes("Extreme Building") && t.includes("J. Jansen") && t.includes(D1.iban) && t.includes(D1.kvk) && t.includes(`63-${year}`) && !t.includes("Valkyrys"), "the PDF is in the Extreme Building design with the person's details");
  const w = docxXml(file(63, "docx"));
  ok(w.includes(D1.iban) && w.includes("Voorbeeldstraat 12") && w.includes("J. Jansen") && !/\[(IBAN|Naam|nr|bedrag|tarief)/.test(w), "the Word file has the details and no placeholders left");

  // an invoice made earlier keeps the design it was made in
  fs.rmSync(file(62, "pdf")); // its PDF is gone: Documents offers "Opnieuw maken"
  ok(!(await page.$("#hist")), "no 'Gemaakte facturen' list on the Invoices tab");
  await goTab(page, "docs"); await page.click("#docsView button[data-refresh]");
  const remake = `#docsList li[data-nr="62-${year}"] button[data-remake]`; await page.waitForSelector(remake, { timeout: 10000 });
  await page.click(remake); ok(await wait(() => fs.existsSync(file(62, "pdf"))), "an old invoice can be made again"); await goTab(page, "inv");
  t = pdfText(file(62, "pdf"));
  ok(t.includes("Valkyrys") && t.includes("NL42 INGB 0103 2069 73") && !t.includes("Extreme Building"), "and it still has the design and details it was made with");
  const inv = data();
  eq([inv[`invoices/62-${year}`].template, inv[`invoices/63-${year}`].template, inv[`invoices/63-${year}`].sender.iban], ["valkyrys", "extreme", D1.iban], "each saved invoice remembers its design and details");

  // back to the first design: the company name follows, what the person typed stays
  await goTab(page, "settings"); await page.click("#tplChange"); await page.waitForSelector("#tplDlg[open]");
  await page.click("#tplGrid [data-tpl=valkyrys]"); await page.click("#tplNext"); await page.waitForFunction(() => !document.querySelector("#tplDlg").open);
  eq([await page.textContent("#tplCurName"), await page.inputValue("#sdname"), await page.inputValue("#sdperson")], ["Valkyrys", "Valkyrys", "J. Jansen"], "switching back: the name follows the design, the typed details stay");
  ok(errs.length === 0, "no page errors in part 2: " + errs.join(" | "));
  await app.close();

  // ---------------------------------------------------------------- 3. an own design: a Word file in the Extreme style with the person's details typed in
  fs.rmSync(HOME, { recursive: true, force: true }); fs.rmSync(INV, { recursive: true, force: true }); fs.mkdirSync(INV, { recursive: true });
  seedProfile(HOME, { folder: INV });
  ({ app, page, errs } = await launch());
  await app.evaluate(({ dialog }, F) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [F] }); }, FIX);
  await goTab(page, "settings"); await page.click("#tplChange"); await page.waitForSelector("#tplDlg[open]");
  ok(await page.isVisible("#tplAdd"), "the picker offers to add a design");
  await page.click("#tplAdd"); await page.waitForSelector("#tplGrid [data-tpl^=c]");
  const cid = await page.getAttribute("#tplGrid [data-tpl^=c]", "data-tpl");
  eq([await page.textContent(`#tplGrid [data-tpl="${cid}"] .tname`), await page.getAttribute(`#tplGrid [data-tpl="${cid}"]`, "aria-checked")], ["Bouw ontwerp", "true"], "the Word file is listed under its name and chosen");
  const saved = data()["settings/main"].customTemplates || [];
  ok(saved.length === 1 && saved[0].id === cid && fs.existsSync(path.join(D, "templates", saved[0].file)), "a copy is kept in the data folder and listed in the settings", saved);
  await page.click("#tplNext"); await page.waitForFunction(() => !document.querySelector("#tplDlg").open);
  eq(await page.evaluate((ks) => ks.map((k) => document.querySelector("#sd" + k).value), Object.keys(OWN)), Object.values(OWN), "choosing it fills in the details written in the file");
  ok(await page.isVisible("#detFromTpl") && await page.isHidden("#detWarn"), "it says so, and nothing is missing");
  eq(await page.textContent("#tplCurName"), "Bouw ontwerp", "Settings shows the own design");
  ok(errs.length === 0, "no page errors in part 3a: " + errs.join(" | ")); await app.close();

  ({ app, page, errs } = await launch()); // the design comes back after a restart (its file is read through the desktop app)
  await goTab(page, "settings"); await page.waitForFunction(() => document.querySelector("#tplCurName").textContent === "Bouw ontwerp");
  await page.waitForFunction((v) => document.querySelector("#sdiban").value === v, OWN.iban);
  await goTab(page, "inv"); await page.setInputFiles("#file", PO); await page.waitForSelector("article.po h3");
  await dl(page, true); ok(await wait(() => fs.existsSync(file(62, "pdf")) && fs.existsSync(file(62, "docx"))), "an invoice is made as PDF and Word in the own design");
  const wt = docxXml(file(62, "docx")).split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")).join("\n");
  ok(wt.includes(OWN.iban) && wt.includes(OWN.street) && wt.includes("K. de Bouwer") && wt.includes(`62-${year}`) && wt.includes("Piguillet BV") && !/\[[^\]]*\]/.test(wt), "the Word file has the details, the invoice and no placeholders left", wt.match(/\[[^\]]*\]/g));
  t = pdfText(file(62, "pdf"));
  ok(t.includes(OWN.iban) && t.includes("Bouw BV") && t.includes(`62-${year}`), "the PDF (Valkyrys layout) has the details");
  eq(data()[`invoices/62-${year}`].template, cid, "the invoice remembers the own design");
  await goTab(page, "settings"); await page.click("#tplChange"); await page.waitForSelector("#tplDlg[open]");
  page.once("dialog", (d) => d.accept()); await page.click(`[data-tpl-del="${cid}"]`);
  await page.waitForFunction(() => !document.querySelector("#tplGrid [data-tpl^=c]"));
  ok(!fs.existsSync(path.join(D, "templates", saved[0].file)) && !(data()["settings/main"].customTemplates || []).length && data()["settings/main"].template === "valkyrys", "a removed design is gone, the first design is used again");
  ok(errs.length === 0, "no page errors in part 3b: " + errs.join(" | "));
  await app.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(1); });
