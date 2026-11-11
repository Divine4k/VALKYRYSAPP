// Settings › Connections: connect a mailbox (fake IMAP server, tools/fake_imap.js), purchase orders fetched into the PO folder, check now, switch off, disconnect.
const { tmp, goTab, seedProfile, APP_DIR, saved } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const F = require("./fake_imap.js");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const HOME = tmp("el-appdata-mail"), POF = tmp("mail-po"), PO = process.argv[3];
const pdf = fs.readFileSync(PO), PASS = "geheim wachtwoord 1";
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME, VALKYRYS_MAIL_PLAIN: "1" } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 }).catch(() => {});
  await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(1200);
  await goTab(page, "settings"); await page.waitForTimeout(300);
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
  let { app, page, errs } = await launch();

  ok(await page.isVisible("#mailPanel"), "Connections panel in Settings");
  ok(!(await page.isVisible("#mailList")) && /koppelen/i.test(await page.textContent("#mailAdd")), "no accounts yet: 'E-mail koppelen…'");
  ok(!(await page.isVisible("#mailNoPo")), "PO folder set: no warning");
  await page.click("#mailAdd");
  ok(await page.isVisible("#mailDlg"), "add dialog opens");
  ok(/app-wachtwoord/i.test(await page.textContent("#mailHelp")) && (await page.textContent("#mailPassLbl")) === "App-wachtwoord", "Gmail first: asks for an app password");
  await page.click('.mprov label:has(input[value="wp"])');
  ok(/WP Poczta/.test(await page.textContent("#mailHelp")) && !(await page.isVisible("#mailHostWrap")), "WP: its own help, no server field");
  await page.click('.mprov label:has(input[value="imap"])');
  ok(await page.isVisible("#mailHostWrap"), "Other: a server field");
  await page.screenshot({ path: "/tmp/mail-dialog.png" });
  await page.click("#mailSave");
  ok(/e-mailadres en wachtwoord/i.test(await page.textContent("#mailErr")), "empty: asks for address and password");
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
  ok(await until(async () => /Gecontroleerd om .*1 inkooporder opgehaald/.test(await page.textContent("#mailList .mstat"))), "status: checked, 1 fetched", await page.textContent("#mailList .mstat"));
  ok(await until(() => page.evaluate(() => state.poFiles.some((f) => f.name === "PO-008148.pdf"))), "the app read the PO folder again (new POs)");
  ok(await until(async () => /Nieuwe inkooporder uit je e-mail/.test(await page.textContent("#toast"))), "a message says a PO came in");
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
