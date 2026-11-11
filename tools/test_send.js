// Sending invoices by email from the Documents tab: tick invoices, "Per e-mail versturen…", one email with their PDFs (a fake SMTP server and IMAP server,
// tools/fake_imap.js), subject and text with placeholders, remembered recipient per client and text, rows marked as sent; no mail connected: a way to connect.
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { tmp, goTab, seedProfile, APP_DIR } = require("./test_helpers");
const F = require("./fake_imap.js"), M = require("../electron-app/mailfetch.js");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const TOOL = path.join(__dirname, "..", "tool");
const core = require(TOOL + "/invoice-core.js");
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib");
const HOME = tmp("el-appdata-send"), INV = tmp("send-inv"), PASS = "geheim1";
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 150)); } return false; };

async function launch() {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME, VALKYRYS_MAIL_PLAIN: "1" } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
  await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(800);
  await goTab(page, "docs");
  return { app, page, errs };
}

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true }); fs.rmSync(INV, { recursive: true, force: true }); fs.mkdirSync(INV, { recursive: true });
  const rd = (f) => fs.readFileSync(`${TOOL}/img/${f}`), images = { logo: rd("logo-white.png"), sidebar: rd("sidebar.png") };
  const client = { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" };
  const data = (nr, datum, desc, rate, qty) => ({ factuurnr: nr, datum, betaaltermijn: "14 dagen", client, lines: [{ desc, tarief: rate, aantal: qty }], btw: "verlegd", sender: core.SENDER });
  fs.writeFileSync(`${INV}/VALKYRYS 1-2026.pdf`, await core.renderInvoice(PDFLib, { fontkit: null, fonts: null, images }, data("1-2026", "12/01/2026", "PO-100002", 450, 5)));
  fs.writeFileSync(`${INV}/VALKYRYS 2-2026.pdf`, await core.renderInvoice(PDFLib, { fontkit: null, fonts: null, images }, data("2-2026", "03/02/2026", "PO-100003", 450, 4)));
  const dir = seedProfile(HOME, { folder: INV });
  const db = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8"));
  const lines = [{ desc: "PO-100005", tarief: 400, aantal: 2 }];
  db["invoices/3-2026"] = { factuurnr: "3-2026", nummer: 3, jaar: 2026, po: "PO-100005", datum: "15/02/2026", betaaltermijn: "14 dagen", client, lines, btw: "verlegd", totaal: 800, dagen: [], createdAt: new Date(Date.now() + 864e5).toISOString() }; // only in the app (still in its grace period): drawn again
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(db));

  // ---- no mail connected: ticking works, sending says to connect first
  let { app, page, errs } = await launch();
  ok(await until(async () => (await page.$$("#docsList li[data-nr]:not(.po-only)")).length === 3), "three invoice rows");
  ok(await page.isVisible("#docsSendStart") && /Facturen versturen/.test(await page.textContent("#docsSendStart")) && !(await page.isVisible("#docsList input[data-sel]")) && !(await page.isVisible("#sendBar")), "a 'Facturen versturen' button; no tick boxes and no bar yet");
  await page.screenshot({ path: "/tmp/send-start.png" });
  await page.click("#docsSendStart");
  ok(await page.isVisible("#sendBar") && /Vink de facturen aan/.test(await page.textContent("#sendBarText")) && (await page.isDisabled("#sendBarGo")) && !(await page.isVisible("#docsSendStart")), "choosing: tick boxes, a bar that says what to do, send off until one is ticked");
  ok((await page.$$("#docsList input[data-sel]")).length === 3 && await page.isVisible('#docsList input[data-sel="1-2026"]'), "every invoice row has a tick box now");
  await page.click("#sendBarClear"); ok(!(await page.isVisible("#sendBar")) && !(await page.isVisible("#docsList input[data-sel]")) && await page.isVisible("#docsSendStart"), "Annuleren: back to the list");
  await page.click("#docsSendStart");
  await page.check('#docsList input[data-sel="1-2026"]');
  ok(await until(() => page.isVisible("#sendBar")) && /1 factuur geselecteerd · € 2\.250,00/.test(await page.textContent("#sendBarText")), "one ticked: '1 factuur geselecteerd · € 2.250,00'", await page.textContent("#sendBarText"));
  await page.click("#sendBarGo");
  ok(await page.isVisible("#sendNoAcc") && !(await page.isVisible("#sendFields")), "no mail connected: it says to connect it first");
  await page.click("#sendGoMail"); ok(await until(() => page.isVisible("#mailPanel")), "...and the button opens Settings › Connections");
  await app.close();

  // ---- a connected mailbox (fake IMAP + SMTP)
  const imap = await F.start({ users: { "jan@wp.pl": PASS }, boxes: { INBOX: [], Sent: [] }, sentBox: "Sent" });
  const smtp = await F.startSmtp({ users: { "jan@wp.pl": PASS }, rejectRcpt: ["weg@piguillet.nl"] });
  fs.writeFileSync(path.join(dir, "mail.json"), JSON.stringify({ mode: "ask", accounts: [{ id: "acc1", provider: "imap", user: "jan@wp.pl", host: "127.0.0.1", port: imap.port, smtp: { host: "127.0.0.1", port: smtp.port }, enabled: true, pass: "b:" + Buffer.from(PASS).toString("base64") }] }));
  ({ app, page, errs } = await launch());
  ok(await until(async () => (await page.$$("#docsList li[data-nr]:not(.po-only)")).length === 3), "rows back");
  await page.click("#docsSendStart");
  ok(/Alle niet-verzonden aanvinken \(3\)/.test(await page.textContent("#sendBarUnsent")), "'Alle niet-verzonden aanvinken (3)'");
  await page.click("#sendBarUnsent");
  ok(await until(async () => /3 facturen geselecteerd/.test(await page.textContent("#sendBarText"))) && !(await page.isVisible("#sendBarUnsent")), "one click ticks all unsent; the button goes away");
  await page.screenshot({ path: "/tmp/send-pick.png" });
  await page.uncheck("#docsSelAll"); await page.check("#docsSelAll");
  ok(await until(async () => /3 facturen geselecteerd · € 4\.850,00/.test(await page.textContent("#sendBarText"))), "the head box ticks all shown: 3 invoices, € 4.850,00", await page.textContent("#sendBarText"));
  await page.uncheck('#docsList input[data-sel="2-2026"]');
  ok(await until(async () => /2 facturen geselecteerd/.test(await page.textContent("#sendBarText"))), "untick one: 2");
  await page.click("#sendBarGo");
  ok(await until(() => page.isVisible("#sendFields")) && (await page.textContent("#sendDlgTitle")) === "2 facturen versturen", "the send window: '2 facturen versturen'");
  eq([await page.inputValue("#sendTo"), await page.inputValue("#sendSubj"), await page.inputValue("#sendText")], ["", "", ""], "address, subject and message start empty");
  ok(!(await page.isVisible("#sendBook")) && !(await page.isVisible("#sendSaveWrap")), "no saved addresses yet, nothing to save yet");
  ok(!(await page.isVisible("#sendFromWrap")), "one mailbox: no 'Van' list");
  ok(await until(async () => (await page.$$eval("#sendAttList li small", (s) => s.map((x) => x.textContent))).every((t) => /kB|MB/.test(t))), "both PDFs ready, with their size (one drawn again from the app)", await page.$$eval("#sendAttList li", (s) => s.map((x) => x.textContent)));
  eq(await page.$$eval("#sendAttList li span", (s) => s.map((x) => x.textContent)), ["VALKYRYS 1-2026.pdf", "VALKYRYS 3-2026.pdf"], "attachments: the folder's PDF, and one made from the record");
  await page.fill("#sendSubj", "{Factuur} {nummers}"); await page.fill("#sendText", "Beste,\n\n{lijst}\n\nTotaal: {totaal}");
  await page.click("#sendPrev summary");
  eq(await page.textContent("#sendPrevSubj"), "Facturen 1-2026, 3-2026", "preview: placeholders in the subject filled in");
  ok(/• Factuur 1-2026 – PO-100002 – € 2\.250,00\n• Factuur 3-2026 – PO-100005 – € 800,00/.test(await page.textContent("#sendPrevText")) && /Totaal: € 3\.050,00/.test(await page.textContent("#sendPrevText")), "preview: the list and the total", await page.textContent("#sendPrevText"));
  await page.screenshot({ path: "/tmp/send-dialog.png" });
  await page.click("#sendSubmit");
  ok(/Vul in naar wie/.test(await page.textContent("#sendErr")), "no address: asks for one");
  await page.fill("#sendTo", "facturen@piguillet.nl, geen-adres"); await page.click("#sendSubmit");
  ok(/„geen-adres” is geen e-mailadres/.test(await page.textContent("#sendErr")), "not an address: says which");
  await page.fill("#sendTo", "weg@piguillet.nl"); await page.click("#sendSubmit");
  ok(await until(async () => /weigert het adres „weg@piguillet\.nl”/.test(await page.textContent("#sendErr"))), "the server refuses an address: says which", await page.textContent("#sendErr"));
  await page.fill("#sendTo", "facturen@piguillet.nl, boekhouding@piguillet.nl");
  ok(await page.isVisible("#sendSaveWrap") && (await page.isChecked("#sendSave")) && /Deze adressen bewaren: facturen@piguillet\.nl, boekhouding@piguillet\.nl/.test(await page.textContent("#sendSaveWrap")), "new addresses: 'bewaren' offered, ticked");
  await page.fill("#sendText", "Beste,\n\nHierbij de {factuur} {nummers}.\n\nGroet,\n{naam}");
  await page.click("#sendSubmit");
  ok(await until(() => smtp.sent.length === 1), "sent: one email");
  const got = M.parseMail(smtp.sent[0].data);
  eq(smtp.sent[0].to, ["facturen@piguillet.nl", "boekhouding@piguillet.nl"], "to both addresses");
  eq(got.subject, "Facturen 1-2026, 3-2026", "subject filled in");
  eq(got.attachments.map((a) => a.name), ["VALKYRYS 1-2026.pdf", "VALKYRYS 3-2026.pdf"], "both PDFs attached");
  ok(got.attachments.every((a) => a.data.subarray(0, 5).toString() === "%PDF-"), "...real PDFs");
  ok(got.attachments[0].data.equals(fs.readFileSync(`${INV}/VALKYRYS 1-2026.pdf`)), "the folder's PDF as it is");
  ok(await until(async () => !(await page.$eval("#sendDlg", (d) => d.open))), "the window closes");
  ok(await until(async () => /2 facturen verstuurd naar facturen@piguillet\.nl, boekhouding@piguillet\.nl/.test(await page.textContent("#toast"))), "toast: sent to whom");
  ok(await until(async () => (await page.isChecked('#docsList input[data-sent="1-2026"]')) && (await page.isChecked('#docsList input[data-sent="3-2026"]')) && !(await page.isChecked('#docsList input[data-sent="2-2026"]'))), "the two are marked as sent, the other not");
  ok(!(await page.isVisible("#sendBar")) && !(await page.$$eval("#docsList input[data-sel]:checked", (x) => x.length)) && !(await page.isVisible("#docsList input[data-sel]")), "done: selection cleared, back to the plain list");
  await page.click("#docsSendStart"); eq(await page.textContent("#sendBarUnsent"), "Alle niet-verzonden aanvinken (1)", "'all unsent' now counts only the one left");
  ok(imap.boxes.Sent.length === 1, "a copy in the mailbox's Sent folder");

  // ---- next time: empty again, the saved addresses one click away
  await page.check('#docsList input[data-sel="2-2026"]'); await page.click("#sendBarGo");
  ok(await until(() => page.isVisible("#sendBook")), "saved addresses shown");
  eq([await page.inputValue("#sendTo"), await page.inputValue("#sendSubj"), await page.inputValue("#sendText")], ["", "", ""], "everything empty again");
  eq(await page.$$eval("#sendBookList [data-addr]", (b) => b.map((x) => x.dataset.addr)), ["facturen@piguillet.nl", "boekhouding@piguillet.nl"], "both addresses saved");
  await page.click('#sendBookList [data-addr="facturen@piguillet.nl"]');
  eq([await page.inputValue("#sendTo"), await page.getAttribute('#sendBookList [data-addr="facturen@piguillet.nl"]', "aria-pressed")], ["facturen@piguillet.nl", "true"], "a click puts it in 'Aan'");
  ok(!(await page.isVisible("#sendSaveWrap")), "a saved address: nothing to save");
  await page.click('#sendBookList [data-addr="boekhouding@piguillet.nl"]'); eq(await page.inputValue("#sendTo"), "facturen@piguillet.nl, boekhouding@piguillet.nl", "a second click: both");
  await page.click('#sendBookList [data-addr="facturen@piguillet.nl"]'); eq(await page.inputValue("#sendTo"), "boekhouding@piguillet.nl", "clicking again takes it out");
  await page.screenshot({ path: "/tmp/send-book.png" });
  await page.click('#sendBookList [data-forget="boekhouding@piguillet.nl"]');
  ok(await until(async () => (await page.$$("#sendBookList [data-addr]")).length === 1), "× forgets an address");
  ok(await until(() => { const d = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8"))["settings/mailsend"]; return d && d.book.length === 1 && d.book[0] === "facturen@piguillet.nl"; }), "...also in the saved data");
  await page.fill("#sendSubj", "{Factuur} {nummers}"); await page.click("#sendPrev summary").catch(() => {}); eq(await page.textContent("#sendPrevSubj"), "Factuur 2-2026", "one invoice: 'Factuur' (singular)");
  await page.click("#sendDlgClose");
  ok(!errs.length, "no page errors", errs);
  await app.close(); await imap.close(); await smtp.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack || e)); process.exit(1); });
