// Invoice designs: the choice on first start (before the folders are asked), the person's own details, changing the design in Settings,
// an installation from before the designs existed (it stays on the Valkyrys design), and that old invoices keep the design they were made in.
const { goTab, setLang, seedProfile, chooseDesign } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const HOME = "/tmp/el-appdata-tpl", INV = "/tmp/tpl-inv";
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
const dl = async (page, word) => { await page.click("button[data-act=download]"); if (word) { await page.waitForTimeout(1000); await page.click("button[data-act=download-docx]"); } };
const fillWz = async (page, p) => { for (const [k, v] of Object.entries(D1)) await page.fill("#" + p + k, v); };

(async () => {
  // ---------------------------------------------------------------- 1. a fresh start: design first, then details, then the folders
  fs.rmSync(HOME, { recursive: true, force: true }); seedProfile(HOME, { welcomed: false }, { template: null });
  let { app, page, errs } = await launch();
  await page.waitForSelector("#tplDlg[open]");
  ok(await page.evaluate(() => !document.querySelector("#welcomeDlg").open), "the folder question waits for the design choice");
  ok(await page.isHidden("#tplDlgClose"), "the first choice has no close button");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelector("#tplDlg").open), "Escape does not skip the first choice");
  eq(await page.$$eval("#tplGrid [data-tpl]", (b) => b.map((x) => x.dataset.tpl)), ["valkyrys", "extreme"], "two designs to choose from");
  ok(await page.isDisabled("#tplNext"), "Next waits for a choice");
  await chooseDesign(page, "extreme");
  await page.waitForSelector("#tplStep2", { state: "visible" });
  eq([await page.inputValue("#wzname"), await page.inputValue("#wzstart"), await page.inputValue("#wziban")], ["Extreme Building", "1", ""], "the company name of the design is filled in, the rest is empty");
  await page.click("#tplDone");
  ok(await page.isVisible("#wzWarn") && (await page.textContent("#wzWarn")).includes("IBAN"), "empty details are refused: " + (await page.textContent("#wzWarn")));
  ok(await page.evaluate(() => document.querySelector("#tplDlg").open), "the dialog stays open until the details are in");
  await fillWz(page, "wz"); await page.fill("#wzstart", "17");
  await page.click("#tplDone");
  await page.waitForSelector("#welcomeDlg[open]");
  ok(await page.evaluate(() => !document.querySelector("#tplDlg").open), "after the design comes the folder question");
  await page.click("#wsLater");
  const s1 = data()["settings/main"];
  eq([s1.template, s1.startNumber, s1.fileTemplate, s1.sender.iban, s1.sender.person], ["extreme", 17, "EXTREME BUILDING {nummer}", D1.iban, D1.person], "design, numbering, file name and details are saved");
  await goTab(page, "settings");
  eq([await page.textContent("#tplCurName"), await page.inputValue("#sdperson"), await page.inputValue("#sStart")], ["Extreme Building", "J. Jansen", "17"], "Settings shows the design and the details");
  await setLang(page, "en");
  eq(await page.textContent("#tplPanel .eyebrow"), "Invoice design", "the new panels are translated");
  await setLang(page, "pl");
  eq(await page.textContent("#detPanel .eyebrow"), "Twoje dane", "also in Polish");
  await setLang(page, "nl");
  ok(errs.length === 0, "no page errors in part 1: " + errs.join(" | ")); await app.close();
  ({ app, page, errs } = await launch()); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => !document.querySelector("#tplDlg").open && !document.querySelector("#welcomeDlg").open), "a second start asks nothing again");
  await app.close();

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

  const year = new Date().getFullYear(), PO = process.argv[3];
  const file = (n, ext) => path.join(INV, `VALKYRYS ${n}-${year}.${ext}`);
  await goTab(page, "inv"); await page.setInputFiles("#file", PO); await page.waitForSelector("article.po h3");
  await dl(page, true); ok(await wait(() => fs.existsSync(file(62, "pdf")) && fs.existsSync(file(62, "docx"))), "an invoice is saved as PDF and Word");
  let t = pdfText(file(62, "pdf"));
  ok(t.includes("Valkyrys") && t.includes("NL42 INGB 0103 2069 73") && t.includes(`62-${year}`), "the PDF is in the Valkyrys design with its details");
  ok(docxXml(file(62, "docx")).includes("NL003608498B64"), "and so is the Word file");

  // change the design: the details of the other design are empty, so nothing can be made until they are filled in
  await page.click("button[data-act=remove]"); await goTab(page, "settings");
  await page.click("#tplChange"); await page.waitForSelector("#tplDlg[open]");
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
  fs.rmSync(file(62, "pdf"));
  await page.click(`button[data-redo="62-${year}"]:not([data-fmt])`); ok(await wait(() => fs.existsSync(file(62, "pdf"))), "an old invoice can be made again");
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
  console.log(fails ? `${fails} FAILED` : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(1); });
