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
  const srv = await F.start({ users: { "jan@firma.example": PASS }, boxes: { INBOX: inbox } });
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
  await page.click('.mprov label:has(input[value="onet"])');
  ok(/Konto Główne/.test(await page.textContent("#mailGuide")) && /hasło do aplikacji/.test(await page.textContent("#mailGuide")) && !(await page.isVisible("#mailHostWrap")) && (await page.getAttribute("#mailUser", "placeholder")) === "naam@onet.pl", "Onet: its own guide (IMAP switch, app password only with two-step), no server field");
  eq(await page.$$eval("#mailGuide [data-link]", (b) => b.map((x) => x.dataset.link)), ["onetMail", "onetAppPw"], "...with buttons to Onet Poczta and Onet's app-password help");
  await page.click('#mailGuide [data-link="onetMail"]'); await page.waitForTimeout(300);
  ok((await app.evaluate(() => globalThis.__links || [])).includes("https://poczta.onet.pl/"), "...the first opens Onet Poczta");
  // the address tells the service: the right one is chosen while typing, known servers are filled in, Outlook is explained
  const prov = () => page.$eval('#mailForm input[name="mailProv"]:checked', (r) => r.value);
  await page.fill("#mailUser", "piet@gmail.com"); eq(await prov(), "gmail", "a gmail.com address: Gmail is chosen");
  await page.fill("#mailUser", "jan@op.pl"); eq(await prov(), "onet", "an op.pl address: Onet");
  await page.fill("#mailUser", "jan@interia.pl");
  eq([await prov(), await page.inputValue("#mailHost"), await page.isVisible("#mailHint")], ["imap", "poczta.interia.pl", true], "an interia.pl address: Other, with Interia's server filled in and a line on what to switch on");
  ok(/korzystam z programu pocztowego/.test(await page.textContent("#mailHint")), "...the line names Interia's setting");
  await page.fill("#mailUser", "jan@tlen.pl"); eq(await page.inputValue("#mailHost"), "poczta.o2.pl", "a tlen.pl address: o2's server replaces the one filled in before");
  await page.fill("#mailUser", "jan@hotmail.com"); await page.fill("#mailPass", "x");
  ok(await page.isVisible("#mailHint") && /Microsoft/.test(await page.textContent("#mailHint")), "a hotmail.com address: says at once that Microsoft mailboxes cannot be connected");
  srv.log.length = 0; await page.click("#mailSave");
  ok(/Outlook-, Hotmail- en Live-adressen kunnen niet gekoppeld worden/.test(await page.textContent("#mailErr")) && !srv.log.length, "...and Koppelen explains it without trying to log in");
  await page.fill("#mailUser", ""); await page.fill("#mailPass", "");
  ok(!(await page.isVisible("#mailHint")) && (await page.inputValue("#mailHost")) === "", "address cleared: the hint and the filled-in server are gone");
  await page.click('.mprov label:has(input[value="imap"])');
  ok(await page.isVisible("#mailHostWrap"), "Other: a server field");
  await page.click('.mprov label:has(input[value="gmail"])'); await page.screenshot({ path: "/tmp/mail-dialog.png" }); await page.click('.mprov label:has(input[value="imap"])');
  await page.click("#mailSave");
  ok(/e-mailadres en wachtwoord/i.test(await page.textContent("#mailErr")), "empty: asks for address and password");
  await page.fill("#mailPass", "geheim"); await page.click("#mailForm .pweye");
  ok((await page.getAttribute("#mailPass", "type")) === "text" && (await page.getAttribute("#mailForm .pweye", "aria-pressed")) === "true", "the eye shows the password");
  await page.click("#mailForm .pweye"); ok((await page.getAttribute("#mailPass", "type")) === "password", "...and hides it again");
  await page.fill("#mailUser", "jan@firma.example"); await page.fill("#mailPass", "fout"); await page.fill("#mailHost", "127.0.0.1:" + srv.port);
  await page.click("#mailSave");
  ok(await until(() => page.isVisible("#mailErr")) && /Inloggen lukt niet/.test(await page.textContent("#mailErr")), "wrong password: 'Inloggen lukt niet'", await page.textContent("#mailErr"));
  ok(await page.isVisible("#mailDlg"), "...the dialog stays open");
  await page.fill("#mailPass", PASS); await page.click("#mailSave");
  ok(await until(async () => !(await page.isVisible("#mailDlg"))), "right password: dialog closes");
  ok(await until(() => page.isVisible("#mailList li")), "the account is listed");
  ok(/jan@firma\.example/.test(await page.textContent("#mailList")), "...with the address");

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
  // the notice on the Invoices tab: every waiting PO on its own line, to look at before it is downloaded
  await goTab(page, "inv"); await page.waitForTimeout(200);
  eq(await page.$$eval("#mailNotes .mnlist li", (l) => l.map((x) => [x.querySelector(".num").textContent, [...x.querySelectorAll("button")].map((b) => b.dataset.mnotePo).join()])),
    [["PO-008150", "view,dl,ign"], ["PO-008151", "view,dl,ign"]], "the notice lists each waiting PO with Voorbeeld / Downloaden / Negeren");
  srv.log.length = 0;
  await page.click('#mailNotes .mnlist li:has-text("PO-008150") [data-mnote-po=view]'); await page.waitForSelector("#poDlg[open]");
  ok(await until(async () => (await page.$$("#poPages canvas")).length >= 1) && !(await page.isVisible("#poDlgErr")), "Voorbeeld: the PO's PDF is shown, straight from the mail");
  ok(/PO-008150 \(in je e-mail, nog niet gedownload\)/.test(await page.textContent("#poDlgTitle")) && await page.isVisible("#poDlgGet") && await page.isHidden("#poDlgOpen") && await page.isHidden("#poDlgAdd"), "...the title says it is not downloaded yet; a Downloaden button, nothing to open or add", await page.textContent("#poDlgTitle"));
  await page.screenshot({ path: "/tmp/mail-preview.png" });
  ok(!fs.existsSync(path.join(POF, "PO-008150.pdf")) && !srv.log.some((l) => /\b(STORE|SELECT|EXPUNGE|COPY|MOVE)\b/i.test(l)) && srv.log.some((l) => / EXAMINE /.test(l)), "...nothing is saved and nothing changes in the mailbox");
  await page.click("#poDlgClose"); await page.waitForTimeout(150);
  ok((await page.$$("#mailNotes .mnlist li")).length === 2, "...both still wait");
  await page.screenshot({ path: "/tmp/mail-note-list.png", clip: { x: 180, y: 0, width: 1100, height: 330 } });
  await goSet(page, "mail"); await page.waitForTimeout(200);
  ok(await page.isVisible("#mailPend") && (await page.$$("#mailPendList li")).length === 2, "...listed in Connections with Downloaden / Negeren");
  await page.$eval("#mailPend", (el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(200);
  await page.screenshot({ path: "/tmp/mail-ask.png" });
  await page.click('#mailPendList li:has-text("PO-008151") [data-pign]');
  ok(await until(async () => (await page.$$("#mailPendList li")).length === 1), "Negeren: one left");
  await goTab(page, "inv");
  eq(await page.$$eval("#mailNotes .mnlist li button", (b) => b.map((x) => x.dataset.mnotePo)), ["view"], "one PO waits: its line only has Voorbeeld (Downloaden / Negeren are the notice's own buttons)");
  await page.click("#mailNotes [data-mnote-act=dl]");
  ok(await saved(path.join(POF, "PO-008150.pdf"), 10000), "Downloaden from the notice: saved");
  ok(!fs.existsSync(path.join(POF, "PO-008151.pdf")), "the ignored one not");
  ok(await until(async () => !(await page.isVisible("#mailNotes [data-mnote]")) && (await page.isHidden("#mailPend"))), "notice and list gone");
  ok(await until(async () => /Gedownload: PO-008150/.test(await page.textContent("#toast"))), "toast: downloaded");
  // looked at first, then downloaded from the preview window; and one of two skipped on its own line
  inbox.push({ uid: 9, date: new Date(), subject: "Inkooporder PO-008152", raw: F.poMail({ po: "008152", pdf }) });
  inbox.push({ uid: 10, date: new Date(), subject: "Inkooporder PO-008153", raw: F.poMail({ po: "008153", pdf }) });
  await page.evaluate(() => mailCheckAll()); ok(await until(async () => (await page.$$("#mailNotes .mnlist li")).length === 2), "two more arrive");
  await page.click('#mailNotes .mnlist li:has-text("PO-008153") [data-mnote-po=ign]');
  ok(await until(async () => (await page.$$("#mailNotes .mnlist li")).length === 1) && /PO-008152/.test(await page.textContent("#mailNotes .mnlist")), "Negeren on a line: only that PO is skipped");
  await page.click("#mailNotes .mnlist [data-mnote-po=view]"); await page.waitForSelector("#poDlg[open]"); await until(async () => (await page.$$("#poPages canvas")).length >= 1);
  await page.click("#poDlgGet");
  ok(await saved(path.join(POF, "PO-008152.pdf"), 10000) && !(await page.evaluate(() => document.querySelector("#poDlg").open)), "Downloaden in the preview window: saved, the window closes");
  ok(!fs.existsSync(path.join(POF, "PO-008153.pdf")) && await until(async () => !(await page.isVisible("#mailNotes [data-mnote]"))), "...the skipped one is not, and the notice is gone");
  await goSet(page, "mail"); await page.waitForTimeout(200);

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

  // an invoice names a PO that is not in the PO folder (here PO-008151, ignored before, so the checks leave it): Documents says so and gets it from the mail
  {
    const INVF = tmp("mail-inv"); fs.rmSync(INVF, { recursive: true, force: true }); fs.mkdirSync(INVF, { recursive: true });
    const PL = require("/home/claude/.npm-global/lib/node_modules/pdf-lib"), doc = await PL.PDFDocument.create(), pg = doc.addPage([595, 842]), font = await doc.embedFont(PL.StandardFonts.Helvetica);
    ["Factuur nr: 9-2026", "Datum: 10-11-2026", "Factuur aan:", "Piguillet BV", "PO-008151 werkzaamheden € 500,00 1 € 500,00", "Totaal € 500,00", "BTW verlegd"].forEach((t, i) => pg.drawText(t, { x: 50, y: 780 - i * 24, size: 11, font }));
    fs.writeFileSync(path.join(INVF, "Factuur 9-2026.pdf"), await doc.save());
    const cfgF = path.join(HOME, APP_DIR, "config.json"); fs.writeFileSync(cfgF, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgF, "utf8")), folder: INVF }));
    ok(JSON.parse(fs.readFileSync(path.join(HOME, APP_DIR, "mail.json"), "utf8")).skip.includes("8151") && !fs.existsSync(path.join(POF, "PO-008151.pdf")), "PO-008151 was ignored: skipped by the checks, not in the folder");
    await page.evaluate(() => refreshAll()); await goTab(page, "docs");
    ok(await until(async () => /PO-008151 \(factuur 9-2026\) staat niet in de map met inkooporders/.test(await page.textContent("#docsWarn"))), "Documents: the invoice's PO is not in the PO folder", await page.textContent("#docsWarn"));
    ok(await page.isVisible('#docsWarn [data-dw="pofetch"]') && /Uit e-mail halen/.test(await page.textContent('#docsWarn [data-dw="pofetch"]')), "...with 'Uit e-mail halen' (a mailbox is connected)");
    await page.screenshot({ path: "/tmp/mail-nopo.png", clip: { x: 180, y: 0, width: 1100, height: 360 } });
    await page.click('#docsWarn [data-dw="pofetch"]');
    ok(await saved(path.join(POF, "PO-008151.pdf"), 10000), "...clicked: fetched from the mail although it was ignored before");
    ok(await until(async () => /Gedownload: PO-008151/.test(await page.textContent("#toast"))), "...toast: downloaded (every mail here carries the same sample PO PDF, so the notice itself stays in this test)");
    ok(!JSON.parse(fs.readFileSync(path.join(HOME, APP_DIR, "mail.json"), "utf8")).skip.includes("8151"), "...no longer skipped by the checks");
    const cfg = JSON.parse(fs.readFileSync(cfgF, "utf8")); delete cfg.folder; fs.writeFileSync(cfgF, JSON.stringify(cfg)); await page.evaluate(() => refreshAll());
    await goSet(page, "mail"); await page.waitForTimeout(300);
  }

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
