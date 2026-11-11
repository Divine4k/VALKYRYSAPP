// Fetching purchase orders from e-mail (electron-app/mailfetch.js), against the fake IMAP server in tools/fake_imap.js. No window.   node tools/test_mailfetch.mjs
import { createRequire } from "module"; import fs from "fs"; import os from "os"; import path from "path";
const require = createRequire(import.meta.url);
const M = require("../electron-app/mailfetch.js"), F = require("./fake_imap.js");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const pdf = (n) => Buffer.from(`%PDF-1.4\n% fake PO ${n}\n` + "x".repeat(300) + "\n%%EOF\n");
const day = 86400000, now = Date.now();

// ---- reading mails
{
  const m = M.parseMail(F.poMail({ po: "008248", pdf: pdf(1) }));
  eq(m.subject, "Inkooporder PO-008248", "subject");
  ok(/Secretariaat/.test(m.from), "from");
  eq(m.attachments.map((a) => a.name), ["PO-008248.pdf"], "the attachment and its name");
  ok(m.attachments[0].data.equals(pdf(1)), "attachment bytes decoded from base64");
  eq(M.poFiles(m).map((f) => f.name), ["PO-008248.pdf"], "a PO mail gives its PDF");
  eq(M.poFiles(M.parseMail(F.poMail({ po: "1", pdf: pdf(1), subject: "Factuur 2026-12" }))), [], "another subject: nothing");
  eq(M.poFiles(M.parseMail(F.poMail({ po: "008250", pdf: pdf(1), file: "scan0001.pdf" }))).map((f) => f.name), ["PO-008250.pdf"], "an attachment with another name is named after the subject");
  eq(M.poFiles(M.parseMail(F.poMail({ po: "008251", pdf: Buffer.from("not a pdf at all") }))), [], "an attachment that is no PDF is skipped");
  eq(M.poFiles(M.parseMail(F.poMail({ po: "008252", pdf: pdf(1), subject: "=?UTF-8?B?" + Buffer.from("Inkooporder PO-008252").toString("base64") + "?=" }))).map((f) => f.name), ["PO-008252.pdf"], "encoded subject");
  eq(M.poFiles(M.parseMail(F.poMail({ po: "008253", pdf: pdf(1), subject: "Fwd: Inkooporder PO-008253", file: "../../evil/PO-008253.pdf" }))).map((f) => f.name), ["PO-008253.pdf"], "a path in the file name is dropped");
  eq(M.params(`attachment; filename*=utf-8''PO-0099%20b.pdf`).params.filename, "PO-0099 b.pdf", "RFC 2231 file name");
  eq(M.words("=?iso-8859-1?Q?Inkooporder_PO-1_=E9?="), "Inkooporder PO-1 é", "Q-encoded words");
  eq(M.imapDate(new Date(2026, 10, 3)), "3-Nov-2026", "IMAP date");
}

// ---- an account against the fake server
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-mail-")), po = path.join(dir, "po"), data = path.join(dir, "data");
fs.mkdirSync(po);
fs.writeFileSync(path.join(po, "PO-000100.pdf"), "already here");
const mails = [
  { uid: 3, date: new Date(now - 40 * day), subject: "Inkooporder PO-000090", raw: F.poMail({ po: "000090", pdf: pdf(90) }) },   // too old for the first check
  { uid: 7, date: new Date(now - 5 * day), subject: "Inkooporder PO-000100", raw: F.poMail({ po: "000100", pdf: pdf(100) }) },   // already in the folder
  { uid: 8, date: new Date(now - 4 * day), subject: "Inkooporder PO-000101", raw: F.poMail({ po: "000101", pdf: pdf(101) }) },
  { uid: 9, date: new Date(now - 3 * day), subject: "Nieuwsbrief", raw: F.poMail({ po: "x", pdf: pdf(0), subject: "Nieuwsbrief" }) },
  { uid: 11, date: new Date(now - 2 * day), subject: "Inkooporder PO-000102", raw: F.poMail({ po: "000102", pdf: pdf(102) }) },
];
const srv = await F.start({ users: { "jan@wp.pl": 'p@ss "w0rd" ł' }, boxes: { INBOX: mails } });
const events = [];
const mf = M.create({ dataDir: data, poFolder: () => po, plain: true, encrypt: (s) => "ENC:" + Buffer.from(s).toString("base64"), decrypt: (s) => Buffer.from(s.slice(4), "base64").toString(), send: (st) => events.push(st) });
const host = "127.0.0.1:" + srv.port;
eq(mf.state().mode, "ask", "'ask first' by default");
mf.setMode("auto");
let r = await mf.add({ provider: "imap", user: "jan@wp.pl", pass: "wrong", host });
eq(r.error, "auth", "wrong password: not added, error 'auth'");
eq(mf.state().accounts.length, 0, "...and nothing stored");
r = await mf.add({ provider: "imap", user: "", pass: "x", host }); eq(r.error, "missing", "no address: 'missing'");
r = await mf.add({ provider: "imap", user: "a@b.c", pass: "x", host: "127.0.0.1:1" }); eq(r.error, "net", "nothing listening: 'net'");
r = await mf.add({ provider: "imap", user: "jan@wp.pl", pass: 'p@ss "w0rd" ł', host });
ok(r.ok && r.account && r.account.user === "jan@wp.pl" && r.account.port === srv.port, "right password (quotes and a non-ASCII letter, sent as a literal): added", r);
const stored = JSON.parse(fs.readFileSync(path.join(data, "mail.json"), "utf8"));
ok(stored.accounts[0].pass.startsWith("ENC:") && !JSON.stringify(stored).includes("w0rd"), "the password is only stored encrypted");
ok(!("pass" in mf.state().accounts[0]), "the page never gets the password");
r = await mf.add({ provider: "imap", user: "JAN@wp.pl", pass: 'p@ss "w0rd" ł', host }); eq(r.error, "dup", "the same account twice: 'dup'");

await new Promise((res) => setTimeout(res, 300)); // add() starts a first check by itself
r = await mf.check();
const files = () => fs.readdirSync(po).sort();
eq(files(), ["PO-000100.pdf", "PO-000101.pdf", "PO-000102.pdf"], "first check: the PO mails of the last 30 days saved, the old one and the newsletter not");
ok(fs.readFileSync(path.join(po, "PO-000101.pdf")).equals(pdf(101)), "saved bytes are the PDF");
eq(fs.readFileSync(path.join(po, "PO-000100.pdf"), "utf8"), "already here", "a file already in the folder is never overwritten");
ok(events.some((e) => e.saved && e.saved.includes("PO-000101.pdf")), "the page is told which files came in", events.map((e) => e.saved));
let a = mf.state().accounts[0];
ok(a.lastOk > 0 && !a.error && a.found === 2 && !a.busy, "account state: checked, no error, 2 found", a);
ok(!srv.log.some((l) => /\b(STORE|SELECT|EXPUNGE|COPY|MOVE|APPEND|DELETE)\b/i.test(l)) && srv.log.some((l) => / EXAMINE /.test(l)) && srv.log.filter((l) => / UID FETCH /.test(l)).every((l) => /BODY\.PEEK\[/.test(l)), "read-only: EXAMINE and BODY.PEEK, nothing marked or moved");

// a PO missing from the folder is fetched again (with a new mail); one deleted through the app (forget) is not
fs.unlinkSync(path.join(po, "PO-000102.pdf"));
mails.push({ uid: 12, date: new Date(now), subject: "Inkooporder PO-000103", raw: F.poMail({ po: "000103", pdf: pdf(103) }) });
srv.log.length = 0;
r = await mf.check();
eq(r.saved.sort(), ["PO-000102.pdf", "PO-000103.pdf"], "next check: the new mail and the PO missing from the folder");
ok(srv.log.some((l) => /UID FETCH [\d,]+ \(UID BODY\.PEEK\[HEADER\.FIELDS \(SUBJECT\)\]\)/.test(l)) && srv.log.filter((l) => /BODY\.PEEK\[\]/.test(l)).length === 2, "subjects read in one go, whole mails only for the 2 missing", srv.log);
eq(mf.state().accounts[0].inMail, 4, "the account knows how many POs are in the mail (30 days)");
srv.log.length = 0; r = await mf.check(); eq(r.saved, [], "nothing missing: nothing saved");
ok(!srv.log.some((l) => /BODY\.PEEK\[\]/.test(l)), "...and no whole mail fetched");
fs.renameSync(path.join(po, "PO-000103.pdf"), path.join(po, "PO-000103 kopie.pdf"));
fs.mkdirSync(path.join(po, "2026")); fs.renameSync(path.join(po, "PO-000101.pdf"), path.join(po, "2026", "PO-000101.pdf"));
r = await mf.check(); eq(r.saved, [], "a PO renamed, or moved into a subfolder, counts as there (by PO number)");
fs.unlinkSync(path.join(po, "PO-000102.pdf")); mf.forget(path.join(po, "PO-000102.pdf"));
r = await mf.check(); eq(r.saved, [], "deleted through the app: not fetched again");
ok(!fs.existsSync(path.join(po, "PO-000102.pdf")), "...stays deleted");

// "seen": fetched POs stay listed for the page until it has shown them
eq(mf.state().unseen.slice().sort(), ["PO-000101.pdf", "PO-000102.pdf", "PO-000103.pdf"], "fetched POs are kept as 'unseen' for the notice");
mf.seen(); eq(mf.state().unseen, [], "seen() clears them");

// ask first: found, not saved, until downloaded; ignored ones go away
mf.setMode("ask"); eq(mf.state().mode, "ask", "mode 'ask' stored");
mails.push({ uid: 13, date: new Date(now), subject: "Inkooporder PO-000104", raw: F.poMail({ po: "000104", pdf: pdf(104) }) });
mails.push({ uid: 14, date: new Date(now), subject: "Inkooporder PO-000105", raw: F.poMail({ po: "000105", pdf: pdf(105) }) });
events.length = 0;
r = await mf.check();
eq(r.found.slice().sort(), ["PO-000104.pdf", "PO-000105.pdf"], "ask first: the new POs are found");
ok(!fs.existsSync(path.join(po, "PO-000104.pdf")), "...but not saved");
eq(mf.state().pending.map((p) => p.name).sort(), ["PO-000104.pdf", "PO-000105.pdf"], "...and wait in 'pending'");
ok(events.some((e) => e.found && e.found.length === 2), "the page is told what was found");
r = await mf.check(); eq(r.found, [], "checking again does not offer them twice");
const [p104, p105] = mf.state().pending.slice().sort((a, b) => a.name.localeCompare(b.name));
r = await mf.download([p104.key]);
eq(r.saved, ["PO-000104.pdf"], "download one");
ok(fs.readFileSync(path.join(po, "PO-000104.pdf")).equals(pdf(104)), "...the right PDF");
eq(mf.state().pending.map((p) => p.name), ["PO-000105.pdf"], "...the other still waits");
ok(srv.log.filter((l) => / UID FETCH /.test(l)).every((l) => /BODY\.PEEK\[/.test(l)), "download is read-only too");
mf.ignore([p105.key]); eq(mf.state().pending, [], "ignore removes it");
r = await mf.check(); eq(r.found, [], "an ignored PO is not offered again");
mails.push({ uid: 15, date: new Date(now), subject: "Inkooporder PO-000106", raw: F.poMail({ po: "000106", pdf: pdf(106) }) });
await mf.check(); r = await mf.download(); eq(r.saved, ["PO-000106.pdf"], "download all");
eq(mf.state().unseen, [], "downloaded by hand: no 'unseen' notice");
mf.setMode("auto");

// switched off: not checked; no PO folder: error, nothing fetched
mf.setEnabled(a.id, false); srv.log.length = 0; await mf.check();
eq(srv.log.length, 0, "switched off: not checked");
mf.setEnabled(a.id, true); await new Promise((res) => setTimeout(res, 300)); await mf.check();
const mf2 = M.create({ dataDir: data, poFolder: () => path.join(dir, "gone"), plain: true, encrypt: (s) => s, decrypt: (s) => Buffer.from(s.slice(4), "base64").toString() });
r = await mf2.check(); eq(r.error, "nofolder", "no PO folder: nothing fetched, error 'nofolder'");
eq(mf2.state().accounts[0].error, "nofolder", "...shown on the account");

// a password changed on the server: the account shows 'auth'
const mf3 = M.create({ dataDir: data, poFolder: () => po, plain: true, encrypt: (s) => s, decrypt: () => "old" });
await mf3.check(); eq(mf3.state().accounts[0].error, "auth", "password no longer right: 'auth' on the account");

// Gmail: looks in the \All mailbox (mails a filter moved out of the inbox), found with LIST
const g = await F.start({ users: { "x@gmail.com": "app" }, boxes: { INBOX: [], "[Gmail]/Alle berichten": [{ uid: 5, date: new Date(now), subject: "Inkooporder PO-000200", raw: F.poMail({ po: "000200", pdf: pdf(200) }) }] }, allMail: "[Gmail]/Alle berichten" });
const got = [], st = {};
const res = await M.checkAccount({ provider: "gmail", user: "x@gmail.com", host: "127.0.0.1", port: g.port }, "app", st, { plain: true, have: () => false, save: async (n) => { got.push(n); return true; } });
eq(got, ["PO-000200.pdf"], "Gmail: found in All Mail");
eq(st.box, '"[Gmail]/Alle berichten"', "...and the mailbox is remembered");
eq(M.errCode(Object.assign(new Error("[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833"), { code: "EAUTH" })), "apppass", "Gmail's 'app password required' is recognised");

mf.remove(a.id); eq(mf.state().accounts.length, 0, "disconnect removes the account");
await srv.close(); await g.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
