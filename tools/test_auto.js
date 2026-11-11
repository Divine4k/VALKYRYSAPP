// The automatic "beta" run on the Invoices tab: a PO in the folder and one waiting in the mail -> warning, client with an invoice email,
// invoices made and saved (PDF + Word), one email to the client with both PDFs (fake IMAP/SMTP from tools/fake_imap.js), marked as sent.
// Also: no client email -> it says so; something to check on a card -> it stops before saving or sending anything.
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { tmp, goTab, seedProfile, APP_DIR } = require("./test_helpers");
const F = require("./fake_imap.js"), M = require("../electron-app/mailfetch.js");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const REAL = path.join(__dirname, "..", "realpo");
const HOME = tmp("el-appdata-auto"), INV = tmp("auto-inv"), POF = tmp("auto-po"), PASS = "geheim1";
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 200)); } return false; };
const db = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8"));

async function launch() {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME, VALKYRYS_MAIL_PLAIN: "1" } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 }).catch(() => {});
  await page.waitForSelector("#pick", { state: "attached" });
  await goTab(page, "inv");
  return { app, page, errs };
}

(async () => {
  for (const d of [HOME, INV, POF]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
  fs.copyFileSync(path.join(REAL, "PO-006344.pdf"), path.join(POF, "PO-006344.pdf"));      // a new PO in the folder
  const imap = await F.start({ users: { "jan@wp.pl": PASS }, boxes: { INBOX: [{ uid: 3, date: new Date(), subject: "Inkooporder PO-006475", raw: F.poMail({ po: "006475", pdf: fs.readFileSync(path.join(REAL, "PO-006475.pdf")) }) },
    { uid: 4, date: new Date(), subject: "Inkooporder PO-006551", raw: F.poMail({ po: "006551", pdf: fs.readFileSync(path.join(REAL, "PO-006551.pdf")) }) }], Sent: [] }, sentBox: "Sent" }); // PO-006551 already has an invoice (below)
  const smtp = await F.startSmtp({ users: { "jan@wp.pl": PASS } });
  const dir = seedProfile(HOME, { folder: INV, poFolder: POF });
  { const d0 = db(dir); d0["invoices/50-2026"] = { factuurnr: "50-2026", nummer: 50, jaar: 2026, po: "PO-006551", datum: "01/06/2026", client: { name: "Piguillet BV" }, lines: [{ desc: "PO-006551", tarief: 400, aantal: 1 }], btw: "verlegd", totaal: 400, dagen: [] }; fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(d0)); }
  fs.writeFileSync(path.join(dir, "mail.json"), JSON.stringify({ mode: "ask", accounts: [{ id: "acc1", provider: "imap", user: "jan@wp.pl", host: "127.0.0.1", port: imap.port, smtp: { host: "127.0.0.1", port: smtp.port }, enabled: true, pass: "b:" + Buffer.from(PASS).toString("base64") }] }));

  let { app, page, errs } = await launch();
  ok(await until(() => page.isVisible("#autoCard")), "the beta card shows on the Invoices tab");
  ok(/2 nieuwe inkooporders/.test(await page.textContent("#autoTitle")) && /BETA/.test(await page.textContent("#autoCard")), "...counting the PO in the folder and the new one in the mail (not the one in the mail that already has an invoice), marked BETA", await page.textContent("#autoTitle"));
  await page.screenshot({ path: "/tmp/auto-card.png", clip: { x: 180, y: 0, width: 1100, height: 420 } });

  // ---- the warning first
  await page.click("#autoGo");
  ok(await page.isVisible("#autoStep1") && /bètafunctie/.test(await page.textContent("#autoStep1")) && /niet terughalen/.test(await page.textContent("#autoStep1")), "a beta warning: what it does, that a sent email cannot be taken back");
  ok(await page.isDisabled("#autoNext"), "'Verder' only after ticking 'Ik begrijp het risico'");
  await page.screenshot({ path: "/tmp/auto-warn.png" });
  await page.check("#autoAgree"); await page.click("#autoNext");
  ok(await until(() => page.isVisible("#autoStep2")), "then the choices");
  eq(await page.$$eval("#autoList li .num", (l) => l.map((x) => x.textContent)), ["PO-006344", "PO-006475"], "the two POs listed");
  ok(/Geen enkele klant heeft een e-mailadres/.test(await page.textContent("#autoErr")) && (await page.isDisabled("#autoRun")), "no client with an invoice email: says where to fill it in, cannot run");
  await page.click("#autoDlgClose");

  // ---- give the client an invoice email (Invoices tab › Klant), update the saved client
  await page.evaluate(() => { document.querySelector("#settingsBox").open = true; document.querySelector("#clientBox").open = true; });
  await page.fill("#cEmail", "facturen@piguillet.nl");
  await page.click("#clUpdate"); await page.waitForTimeout(400);
  ok(await until(() => { const c = db(dir)["settings/clients"]; return c && c.list[0].fields.email === "facturen@piguillet.nl"; }), "the invoice email is stored with the client");
  await page.click("#autoGo"); await page.check("#autoAgree"); await page.click("#autoNext");
  ok(await until(async () => (await page.textContent("#autoClientHint")) === "De facturen gaan naar: facturen@piguillet.nl") && !(await page.isDisabled("#autoRun")), "the client is picked, it says where the invoices go");
  eq([await page.inputValue("#autoSubj")], ["{Factuur} {nummers}"], "a subject to start from");
  await page.screenshot({ path: "/tmp/auto-choose.png" });

  // ---- run
  await page.click("#autoRun");
  ok(await until(async () => !(await page.isHidden("#autoDone")) && /Klaar: 2 facturen gemaakt en verstuurd naar facturen@piguillet\.nl/.test(await page.textContent("#autoDone")), 40000), "done: '2 facturen gemaakt en verstuurd'", await page.textContent("#autoDone").catch(() => ""));
  await page.screenshot({ path: "/tmp/auto-done.png" });
  eq(await page.$$eval("#autoSteps li", (l) => l.map((x) => x.className)), ["ok", "ok", "ok", "ok", "ok"], "every step ticked");
  ok(fs.existsSync(path.join(POF, "PO-006475.pdf")), "the PO from the mail is in the PO folder");
  const inv = fs.readdirSync(INV).sort();
  ok(inv.filter((n) => n.endsWith(".pdf")).length === 2 && inv.filter((n) => n.endsWith(".docx")).length === 2, "two invoices saved, PDF and Word", inv);
  eq(smtp.sent.length, 1, "one email");
  const mail = M.parseMail(smtp.sent[0].data), recs = Object.entries(db(dir)).filter(([k]) => k.startsWith("invoices/")).map(([, v]) => v).filter((v) => v.nummer !== 50).sort((a, b) => a.nummer - b.nummer);
  eq(smtp.sent[0].to, ["facturen@piguillet.nl"], "to the client's invoice address");
  eq(recs.filter((r) => r.nummer !== 50).map((r) => r.po), ["PO-006344", "PO-006475"], "invoices logged for both POs");
  eq(mail.subject, "Facturen " + recs.map((r) => r.factuurnr).join(", "), "subject with the invoice numbers");
  eq(mail.attachments.map((a) => a.name), inv.filter((n) => n.endsWith(".pdf")).sort(), "the two PDFs attached");
  ok(mail.attachments.every((a, i) => a.data.equals(fs.readFileSync(path.join(INV, inv.filter((n) => n.endsWith(".pdf"))[i])))), "...the same files as in the folder");
  ok(await until(() => { const s = db(dir)["settings/sent"]; return s && recs.every((r) => s.list.includes(r.factuurnr)); }), "both marked as sent");
  await page.click("#autoClose2");
  ok(await until(async () => !(await page.isVisible("#autoCard")) && !(await page.$$("#cards .po")).length), "afterwards: no card left, nothing waiting on the Invoices tab");

  // ---- something to check: a new PO that the client's KVK does not match -> stops before saving or sending
  fs.copyFileSync(path.join(REAL, "PO-006476.pdf"), path.join(POF, "PO-006476.pdf"));
  const c = db(dir)["settings/clients"]; c.list.push({ id: "kz", name: "Zeta Bouw", fields: { client: { name: "Zeta Bouw", street: "", city: "", kvk: "11111111", btw: "" }, betaaltermijn: "14 dagen", btw: "verlegd", email: "zeta@bouw.nl" } });
  await app.close();
  const d2 = db(dir); d2["settings/clients"] = c; fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(d2));
  ({ app, page, errs } = await launch());
  ok(await until(() => page.isVisible("#autoCard")), "a new PO: the card again");
  await page.click("#autoGo"); await page.check("#autoAgree"); await page.click("#autoNext");
  await until(() => page.isVisible("#autoStep2"));
  await page.selectOption("#autoClient", "kz"); await page.click("#autoRun");
  ok(await until(async () => /Er is iets na te kijken \(PO-006476\)/.test(await page.textContent("#autoDone")), 30000), "the PO's KVK is not Zeta's: it stops and says which", await page.textContent("#autoDone").catch(() => ""));
  ok(fs.readdirSync(INV).length === 4 && smtp.sent.length === 1, "nothing saved, nothing sent");
  await page.click("#autoClose2");
  ok(await page.isVisible("#cards .po"), "the invoice waits on the Invoices tab to be checked");
  ok(!errs.length, "no page errors", errs);
  await app.close(); await imap.close(); await smtp.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack || e)); process.exit(1); });
