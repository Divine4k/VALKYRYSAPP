// Settings › Connections: connect a mailbox (fake IMAP server, tools/fake_imap.js), purchase orders fetched into the PO folder, check now, switch off, disconnect.
const { tmp, goTab, goSet, seedProfile, APP_DIR, saved } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const F = require("./fake_imap.js");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const HOME = tmp("el-appdata-mail"), POF = tmp("mail-po"), PO = process.argv[3];
const pdf = fs.readFileSync(PO), PASS = "geheim wachtwoord 1";
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME, VALKYRYS_MAIL_PLAIN: "1" } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await app.evaluate(({ shell }) => { globalThis.__links = []; shell.openExternal = async (u) => { globalThis.__links.push(u); }; }); // no real browser in tests
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 }).catch(() => {});
  await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(1200);
  await goSet(page, "mail"); await page.waitForTimeout(300);
  return { app, page, errs };
};
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 200)); } return false; };

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true }); fs.rmSync(POF, { recursive: true, force: true }); fs.mkdirSync(POF, { recursive: true });
  const now = Date.now();
  const inbox = [
    { uid: 4, date: new Date(now - 2 * 86400000), subject: "Inkooporder PO-008148", raw: F.poMail({ po: "008148", pdf }) },
    { uid: 5, date: new Date(now - 86400000), subject: "Uitnodiging", raw: F.poMail({ po: "1", pdf, subject: "Uitnodiging" }) },
  ];
  const srv = await F.start({ users: { "jan@wp.pl": PASS }, boxes: { INBOX: inbox } });
  seedProfile(HOME, { poFolder: POF });
  fs.writeFileSync(path.join(HOME, APP_DIR, "mail.json"), JSON.stringify({ mode: "auto" })); // 'ask first' is the default; this part tests downloading by itself
  let { app, page, errs } = await launch();

  ok(await page.isVisible("#mailPanel"), "Connections panel in Settings");
  ok(!(await page.isVisible("#mailList")) && /koppelen/i.test(await page.textContent("#mailAdd")), "no accounts yet: 'E-mail koppelen…'");
  ok(!(await page.isVisible("#mailNoPo")), "PO folder set: no warning");
  await page.click("#mailAdd");
  ok(await page.isVisible("#mailDlg"), "add dialog opens");
  ok((await page.$$("#mailGuide li")).length === 3 && /verificatie in twee stappen/.test(await page.textContent("#mailGuide")) && /app-wachtwoord/.test(await page.textContent("#mailGuide")) && (await page.textContent("#mailPassLbl")) === "App-wachtwoord", "Gmail first: a 3-step guide (2-step verification, app password, fill in)");
  eq(await page.$$eval("#mailGuide [data-link]", (b) => b.map((x) => x.dataset.link)), ["gTwoSv", "gAppPw"], "...with buttons to the two Google pages");
  await page.click('#mailGuide [data-link="gAppPw"]'); await page.waitForTimeout(300);
  eq(await app.evaluate(() => globalThis.__links || []), ["https://myaccount.google.com/apppasswords"], "the button opens the app-password page in the browser");
  await page.click('.mprov label:has(input[value="wp"])');
  ok(/Opcje › IMAP\/POP/.test(await page.textContent("#mailGuide")) && (await page.$$("#mailGuide [data-link]")).length === 2 && !(await page.isVisible("#mailHostWrap")), "WP: its own guide (IMAP switch, two-step password), no server field");
  await page.click('.mprov label:has(input[value="imap"])');
  ok(await page.isVisible("#mailHostWrap"), "Other: a server field");
  await page.click('.mprov label:has(input[value="gmail"])'); await page.screenshot({ path: "/tmp/mail-dialog.png" }); await page.click('.mprov label:has(input[value="imap"])');
  await page.click("#mailSave");
  ok(/e-mailadres en wachtwoord/i.test(await page.textContent("#mailErr")), "empty: asks for address and password");
  await page.fill("#mailPass", "geheim"); await page.click("#mailForm .pweye");
  ok((await page.getAttribute("#mailPass", "type")) === "text" && (await page.getAttribute("#mailForm .pweye", "aria-pressed")) === "true", "the eye shows the password");
  await page.click("#mailForm .pweye"); ok((await page.getAttribute("#mailPass", "type")) === "password", "...and hides it again");
  await page.fill("#mailUser", "jan@wp.pl"); await page.fill("#mailPass", "fout"); await page.fill("#mailHost", "127.0.0.1:" + srv.port);
  await page.click("#mailSave");
  ok(await until(() => page.isVisible("#mailErr")) && /Inloggen lukt niet/.test(await page.textContent("#mailErr")), "wrong password: 'Inloggen lukt niet'", await page.textContent("#mailErr"));
  ok(await page.isVisible("#mailDlg"), "...the dialog stays open");
  await page.fill("#mailPass", PASS); await page.click("#mailSave");
  ok(await until(async () => !(await page.isVisible("#mailDlg"))), "right password: dialog closes");
  ok(await until(() => page.isVisible("#mailList li")), "the account is listed");
  ok(/jan@wp\.pl/.test(await page.textContent("#mailList")), "...with the address");

  // the first check runs by itself: the PO mail is fetched, the other one not
  const f1 = path.join(POF, "PO-008148.pdf");
  ok(await saved(f1, 15000), "PO PDF saved into the PO folder");
  ok(fs.existsSync(f1) && fs.readFileSync(f1).equals(pdf), "...the same bytes as attached");
  ok(fs.readdirSync(POF).length === 1, "the other mail is ignored", fs.readdirSync(POF));
  ok(await until(async () => /Gecontroleerd om .*1 inkooporder in je e-mail \(laatste 30 dagen\) · 1 inkooporder opgehaald/.test(await page.textContent("#mailList .mstat"))), "status: checked, 1 fetched", await page.textContent("#mailList .mstat"));
  ok(await until(() => page.evaluate(() => state.poFiles.some((f) => f.name === "PO-008148.pdf"))), "the app read the PO folder again (new POs)");
  ok(await until(() => page.isVisible("#invDot")), "a dot on Facturen in the sidebar");
  await goTab(page, "inv");
  ok(await until(async () => (await page.isVisible("#mailNotes [data-mnote=got]")) && /Je hebt een nieuwe inkooporder in je mail!/.test(await page.textContent("#mailNotes")) && /PO-008148 staat al in je map/.test(await page.textContent("#mailNotes"))), "Invoices tab: 'Je hebt een nieuwe inkooporder in je mail!'", await page.textContent("#mailNotes"));
  ok(await page.evaluate(() => { const n = document.querySelector("#mailNotes"), d = document.querySelector("#drop"); return !!(n.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING); }), "...at the top, above the drop zone");
  await page.screenshot({ path: "/tmp/mail-note.png" });
  await goSet(page, "mail"); await page.waitForTimeout(200);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/mail-settings.png" });
  await page.$eval("#mailPanel", (el) => el.scrollIntoView()); await page.screenshot({ path: "/tmp/mail-panel.png" });
  ok(!srv.log.some((l) => /\b(STORE|SELECT|EXPUNGE|MOVE|COPY)\b/i.test(l)), "nothing written to the mailbox");
  const mj = fs.readFileSync(path.join(HOME, APP_DIR, "mail.json"), "utf8");
  ok(!mj.includes(PASS) && /"pass": "[sb]:/.test(mj), "password not stored as plain text", mj.slice(0, 300));

  // a new mail; "Nu controleren"
  inbox.push({ uid: 6, date: new Date(), subject: "Inkooporder PO-008149", raw: F.poMail({ po: "008149", pdf }) });
  await page.click("#mailList [data-mcheck]");
  ok(await saved(path.join(POF, "PO-008149.pdf"), 10000), "check now: the new PO is fetched");
  ok(await until(async () => /2 inkooporders opgehaald/.test(await page.textContent("#mailList .mstat"))), "status counts 2");

  ok(await until(async () => /Je hebt nieuwe inkooporders in je mail!.*PO-008148, PO-008149 staan al/.test(await page.textContent("#mailNotes"))), "the notice lists both until looked at");

  // the notice is still there after a restart, until "Bekijken"
  await app.close();
  ({ app, page, errs } = await launch());
  ok(await until(() => page.isVisible("#invDot")), "after a restart: the dot on Facturen is back");
  await goTab(page, "inv");
  ok(await until(() => page.isVisible("#mailNotes [data-mnote=got]")), "...and the notice on the Invoices tab");
  await page.click("#mailNotes [data-mnote-act=ok]");
  ok(await until(async () => !(await page.isVisible("#mailNotes [data-mnote]")) && !(await page.isVisible("#invDot"))), "'Top, bedankt': notice and dot gone");
  ok(await until(() => JSON.parse(fs.readFileSync(path.join(HOME, APP_DIR, "mail.json"), "utf8")).unseen.length === 0), "...remembered as seen");
  await goSet(page, "mail"); await page.waitForTimeout(300);

  // ask first
  ok(await page.isVisible("#mailMode") && (await page.isChecked('#mailMode input[value="auto"]')), "mode choice shown ('Automatisch downloaden' as set)");
  await page.click('#mailMode label:has(input[value="ask"])');
  ok(await until(() => JSON.parse(fs.readFileSync(path.join(HOME, APP_DIR, "mail.json"), "utf8")).mode === "ask"), "'Eerst vragen' stored");
  inbox.push({ uid: 7, date: new Date(), subject: "Inkooporder PO-008150", raw: F.poMail({ po: "008150", pdf }) });
  inbox.push({ uid: 8, date: new Date(), subject: "Inkooporder PO-008151", raw: F.poMail({ po: "008151", pdf }) });
  await page.click("#mailList [data-mcheck]");
  ok(await until(async () => /PO-008150, PO-008151\. Wil je ze downloaden\?/.test(await page.textContent("#mailNotes"))), "found: the notice asks", await page.textContent("#mailNotes"));
  ok(!fs.existsSync(path.join(POF, "PO-008150.pdf")), "...nothing downloaded yet");
  ok(await page.isVisible("#mailPend") && (await page.$$("#mailPendList li")).length === 2, "...listed in Connections with Downloaden / Negeren");
  await page.$eval("#mailPend", (el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(200);
  await page.screenshot({ path: "/tmp/mail-ask.png" });
  await page.click('#mailPendList li:has-text("PO-008151") [data-pign]');
  ok(await until(async () => (await page.$$("#mailPendList li")).length === 1), "Negeren: one left");
  await goTab(page, "inv"); await page.click("#mailNotes [data-mnote-act=dl]");
  ok(await saved(path.join(POF, "PO-008150.pdf"), 10000), "Downloaden from the notice: saved");
  ok(!fs.existsSync(path.join(POF, "PO-008151.pdf")), "the ignored one not");
  ok(await until(async () => !(await page.isVisible("#mailNotes [data-mnote]")) && (await page.isHidden("#mailPend"))), "notice and list gone");
  await goSet(page, "mail"); await page.waitForTimeout(200);
  ok(await until(async () => /Gedownload: PO-008150/.test(await page.textContent("#toast"))), "toast: downloaded");

  // a PO deleted from the folder outside the app comes back at the next check
  await page.click('#mailMode label:has(input[value="auto"])'); await page.waitForTimeout(300);
  fs.unlinkSync(path.join(POF, "PO-008148.pdf"));
  await page.click("#mailList [data-mcheck]");
  ok(await saved(path.join(POF, "PO-008148.pdf"), 10000), "a PO missing from the folder is fetched again");

  // the refresh button at "Nieuwe inkooporders" also checks the mail
  fs.unlinkSync(path.join(POF, "PO-008148.pdf")); srv.log.length = 0;
  await goTab(page, "inv"); await page.click("#newPo [data-refresh]");
  ok(await until(async () => /E-mail controleren…|Mappen lezen…/.test(await page.textContent("#newPo .rstat")), 3000), "beside the button while it works: 'E-mail controleren…'");
  await page.screenshot({ path: "/tmp/refresh-status.png", clip: { x: 200, y: 0, width: 720, height: 420 } });
  ok(await saved(path.join(POF, "PO-008148.pdf"), 10000) && srv.log.some((l) => / EXAMINE /.test(l)), "refresh at Nieuwe inkooporders: the mail is checked too");
  ok(await until(async () => !(await page.isVisible("#newPo .rstat")) && !(await page.$eval("#newPo [data-refresh]", (b) => b.classList.contains("spin")))), "when done, the status is gone");
  await goSet(page, "mail"); await page.waitForTimeout(200);

  // switched off, then disconnect (asks once)
  await page.click("#mailList [data-mtog]");
  ok(await until(async () => /Uitgezet/.test(await page.textContent("#mailList .mstat")) && (await page.isDisabled("#mailList [data-mcheck]"))), "switched off");
  await page.click("#mailList [data-mdel]");
  ok(/Echt ontkoppelen/.test(await page.textContent("#mailList [data-mdel]")), "disconnect asks once");
  await page.click("#mailList [data-mdel]");
  ok(await until(async () => !(await page.isVisible("#mailList"))), "disconnected");
  ok(!(JSON.parse(fs.readFileSync(path.join(HOME, APP_DIR, "mail.json"), "utf8")).accounts.length), "...and removed from mail.json");
  ok(!errs.length, "no page errors", errs);
  await app.close();

  // no PO folder: Connections says so
  fs.rmSync(HOME, { recursive: true, force: true }); seedProfile(HOME, {});
  ({ app, page, errs } = await launch());
  ok(await until(() => page.isVisible("#mailNoPo")), "no PO folder: the panel asks for one first");
  ok(!errs.length, "no page errors", errs);
  await app.close(); await srv.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack || e)); process.exit(1); });
