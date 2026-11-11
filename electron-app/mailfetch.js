// Fetching purchase orders from e-mail (Settings › Connections). Plain Node, no Electron: app-main.js passes in what it needs, so it is testable on its own
// (tools/test_mailfetch.mjs, against a fake IMAP server).
//
// Accounts (Gmail, WP, any IMAP server) are kept in <data folder>/mail.json; the password only encrypted (encrypt/decrypt from app-main.js = Electron safeStorage,
// Windows DPAPI). Every few minutes the app looks in the mailbox, READ-ONLY (EXAMINE + BODY.PEEK: nothing is marked read, moved or deleted), for mails
// whose subject is "Inkooporder PO-######" with the PO PDF attached, and saves that PDF into the purchase-order folder, unless a file of that name is
// already there. The first check of an account looks back FIRST_DAYS days; after that only mails newer than the last one seen (IMAP UIDs), so a PO
// deleted from the folder on purpose is not fetched again.
"use strict";
const fs = require("fs"), path = require("path"), net = require("net"), tls = require("tls"), crypto = require("crypto");

const PROVIDERS = { gmail: { host: "imap.gmail.com", port: 993 }, wp: { host: "imap.wp.pl", port: 993 } };
const FIRST_DAYS = 30, EVERY_MS = 5 * 60 * 1000, FIRST_AFTER_MS = 20 * 1000, MAX_PER_RUN = 200, TIMEOUT_MS = 45000;
const SUBJECT_RE = /inkooporder\b[^\n]*?\bPO[-\s]?(\d{3,})/i;
const PO_FILE_RE = /\bPO[-_\s]?(\d{3,})\b/i;

// ------------------------------------------------------------------ a small IMAP client: just what is needed here (LOGIN, LIST, EXAMINE, UID SEARCH/FETCH)
class Imap {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.parts = []; this.lits = []; this.n = 0; this.cur = null; this.cont = null; this.closed = null;
    this.greeting = new Promise((res, rej) => { this.greet = { res, rej }; });
    sock.on("data", (d) => { this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d; try { this.pump(); } catch (e) { this.fail(e); } });
    sock.on("error", (e) => this.fail(e));
    sock.on("close", () => this.fail(Object.assign(new Error("connection closed"), { code: "ECONNRESET" })));
    sock.setTimeout(TIMEOUT_MS, () => { this.fail(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })); sock.destroy(); });
  }
  static open({ host, port, plain }) {
    return new Promise((res, rej) => {
      const sock = plain ? net.connect({ host, port }) : tls.connect({ host, port, servername: net.isIP(host) ? undefined : host });
      const c = new Imap(sock);
      c.greeting.then(() => res(c), rej);
    });
  }
  fail(e) {
    if (this.closed) return; this.closed = e;
    if (this.greet) { this.greet.rej(e); this.greet = null; }
    if (this.cur) { this.cur.rej(e); this.cur = null; }
    if (this.cont) { this.cont.rej(e); this.cont = null; }
  }
  // a response is one line, or a line ending in {n} followed by n bytes and more of the same line; literals are kept apart as Buffers
  pump() {
    for (;;) {
      const i = this.buf.indexOf("\r\n"); if (i < 0) return;
      const line = this.buf.subarray(0, i).toString("latin1"), m = /\{(\d+)\}$/.exec(line);
      if (m) {
        const n = Number(m[1]); if (this.buf.length < i + 2 + n) return;
        this.parts.push(line); this.lits.push(Buffer.from(this.buf.subarray(i + 2, i + 2 + n))); this.buf = this.buf.subarray(i + 2 + n); continue;
      }
      this.buf = this.buf.subarray(i + 2);
      const text = this.parts.join("") + line, lits = this.lits; this.parts = []; this.lits = [];
      this.onResp(text, lits);
    }
  }
  onResp(text, lits) {
    if (this.greet) { const g = this.greet; this.greet = null; if (/^\* (OK|PREAUTH)/i.test(text)) g.res(); else g.rej(Object.assign(new Error(text), { code: "EPROTO" })); return; }
    if (text.startsWith("+")) { if (this.cont) { const c = this.cont; this.cont = null; c.res(); } return; }
    if (text.startsWith("* ")) { if (this.cur) this.cur.untagged.push({ text, lits }); return; }
    const m = /^(A\d+) (OK|NO|BAD)\b ?(.*)$/i.exec(text);
    if (m && this.cur && this.cur.tag === m[1]) { const c = this.cur; this.cur = null; c.res({ status: m[2].toUpperCase(), text: m[3], untagged: c.untagged }); }
  }
  // parts: strings, and { lit: string } for values sent as a literal (anything a quoted string cannot carry)
  async cmd(...parts) {
    if (this.closed) throw this.closed;
    const tag = "A" + ++this.n;
    const done = new Promise((res, rej) => { this.cur = { tag, untagged: [], res, rej }; });
    let line = tag + " ";
    for (const p of parts) {
      if (typeof p === "string") { line += p; continue; }
      const b = Buffer.from(p.lit, "utf8");
      const go = new Promise((res, rej) => { this.cont = { res, rej }; });
      this.sock.write(line + "{" + b.length + "}\r\n", "latin1"); await go;
      this.sock.write(b); line = "";
    }
    this.sock.write(line + "\r\n", "latin1");
    return done;
  }
  async ok(...parts) { const r = await this.cmd(...parts); if (r.status !== "OK") throw Object.assign(new Error(r.text || r.status), { code: "EIMAP", imap: r }); return r; }
  close() { try { if (!this.closed) { this.sock.write("A" + ++this.n + " LOGOUT\r\n"); this.sock.end(); } } catch (e) {} this.closed = this.closed || new Error("closed"); setTimeout(() => { try { this.sock.destroy(); } catch (e) {} }, 2000).unref(); }
}
// a string as an IMAP argument: quoted when it can be, else a literal
const arg = (s) => (/^[\x20-\x7e]*$/.test(s) ? '"' + s.replace(/(["\\])/g, "\\$1") + '"' : { lit: s });

// ------------------------------------------------------------------ reading a mail (MIME): headers, the parts, attachments with their names
const unfold = (h) => h.replace(/\r?\n[ \t]+/g, " ");
function headers(text) {
  const out = {};
  for (const l of unfold(text).split(/\r?\n/)) { const i = l.indexOf(":"); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in out)) out[k] = l.slice(i + 1).trim(); } }
  return out;
}
const charsetDecode = (buf, cs) => { try { return new TextDecoder(String(cs || "utf-8").toLowerCase().replace(/^(us-ascii|ascii)$/, "utf-8")).decode(buf); } catch (e) { return buf.toString("latin1"); } };
const qp = (s, underscore) => { const out = []; s = underscore ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, ""); for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === "=" && /^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else out.push(s.charCodeAt(i) & 255); } return Buffer.from(out); };
/** "=?UTF-8?B?...?=" words in a header */
const words = (s) => String(s || "").replace(/\?=\s+=\?/g, "?==?").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (m, cs, enc, t) => charsetDecode(enc.toLowerCase() === "b" ? Buffer.from(t, "base64") : qp(t, true), cs.replace(/\*.*$/, "")));
/** `type; a=b; c="d"` -> { value, params }, with RFC 2231 names (name*=utf-8''x, name*0=, name*1=) */
function params(v) {
  const s = String(v || ""), semi = s.indexOf(";"), value = (semi < 0 ? s : s.slice(0, semi)).trim().toLowerCase(), raw = {}, re = /;\s*([^=\s;]+)\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]*)/g;
  let m; while ((m = re.exec(s))) raw[m[1].toLowerCase()] = m[3] !== undefined ? m[3].replace(/\\(.)/g, "$1") : m[2].trim();
  const p = {}, star = {};
  for (const [k, val] of Object.entries(raw)) {
    const r = /^([^*]+)\*(?:(\d+)\*?|)$/.exec(k);
    if (r && (k.endsWith("*") || /\*\d+$/.test(k))) { (star[r[1]] = star[r[1]] || []).push({ i: Number(r[2] || 0), v: val, enc: k.endsWith("*") }); } else p[k] = words(val);
  }
  for (const [k, list] of Object.entries(star)) {
    list.sort((a, b) => a.i - b.i); let cs = "utf-8", bytes = [];
    list.forEach((x, n) => { let v = x.v; if (x.enc) { if (n === 0) { const q = /^([^']*)'[^']*'(.*)$/.exec(v); if (q) { cs = q[1] || cs; v = q[2]; } } bytes.push(Buffer.from(v.replace(/%([0-9a-f]{2})/gi, (mm, h) => String.fromCharCode(parseInt(h, 16))), "latin1")); } else bytes.push(Buffer.from(v, "latin1")); });
    p[k] = charsetDecode(Buffer.concat(bytes), cs);
  }
  return { value, params: p };
}
/** a whole mail (Buffer) -> { subject, from, attachments: [{ name, type, data }] } */
function parseMail(raw) {
  const atts = [];
  const walk = (s, depth) => {
    const i = s.search(/\r?\n\r?\n/), h = headers(i < 0 ? s : s.slice(0, i)), body = i < 0 ? "" : s.slice(i).replace(/^\r?\n\r?\n/, "");
    const ct = params(h["content-type"] || "text/plain"), cd = params(h["content-disposition"] || "");
    if (ct.value.startsWith("multipart/") && ct.params.boundary && depth < 8) {
      const b = "--" + ct.params.boundary, chunks = body.split(new RegExp("(?:^|\\r?\\n)" + b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:--)?[ \\t]*(?:\\r?\\n|$)"));
      for (const c of chunks.slice(1)) if (c.trim()) walk(c, depth + 1);
      return { h };
    }
    const name = cd.params.filename || ct.params.name || "";
    if (name || cd.value === "attachment" || ct.value === "application/pdf") {
      const enc = String(h["content-transfer-encoding"] || "").trim().toLowerCase();
      const data = enc === "base64" ? Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64") : enc === "quoted-printable" ? qp(body) : Buffer.from(body, "latin1");
      atts.push({ name, type: ct.value, data });
    }
    return { h };
  };
  const top = walk(raw.toString("latin1"), 0).h;
  return { subject: words(top.subject || "").trim(), from: words(top.from || "").trim(), attachments: atts };
}
/** the PO PDFs in a mail, if it is a purchase-order mail ("Inkooporder PO-######" with the PDF): [{ name, data }] */
function poFiles(mail) {
  const sm = SUBJECT_RE.exec(mail.subject || ""); if (!sm) return [];
  const out = [];
  for (const a of mail.attachments) {
    const pdf = a.data.subarray(0, 1024).includes("%PDF"); if (!pdf) continue;
    const base = path.basename(String(a.name || "").replace(/\\/g, "/"));
    let name = PO_FILE_RE.test(base) && /\.pdf$/i.test(base) ? base : "PO-" + sm[1] + ".pdf";
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/^\.+/, "").trim() || "PO-" + sm[1] + ".pdf";
    if (!out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ name, data: a.data });
  }
  return out;
}

// ------------------------------------------------------------------ one check of one account
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const imapDate = (d) => `${d.getDate()}-${MON[d.getMonth()]}-${d.getFullYear()}`;
const errCode = (e) => {
  const t = String((e && e.message) || "");
  if (e && e.code === "EAUTH") return /application-specific|app.?password|webloginrequired/i.test(t) ? "apppass" : "auth";
  if (e && ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT", "ECONNRESET"].includes(e.code)) return "net";
  if (e && /CERT|SSL|TLS/i.test(String(e.code || "") + t)) return "tls";
  return "other";
};
/** the mailbox to look in: Gmail's "All Mail" (so mails moved away from the inbox by a filter are found too), else INBOX */
async function pickBox(c, acc) {
  if (acc.provider !== "gmail") return "INBOX";
  try {
    const r = await c.cmd('LIST "" "*"');
    for (const u of r.untagged) { const m = /^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i.exec(u.text); if (m && /\\All\b/i.test(m[1])) return u.lits.length ? u.lits[0].toString("utf8") : m[2]; }
  } catch (e) {}
  return "INBOX";
}
const boxArg = (b) => (/^".*"$/.test(b) ? b : arg(b));

/** log in, look for new PO mails and save their PDFs. st = { uidValidity, lastUid } of this account (updated in place). Returns { saved: [names], seen } */
async function checkAccount(acc, pass, st, { poFolder, exists, save, plain, now = new Date() }) {
  let c;
  try { c = await Imap.open({ host: acc.host, port: acc.port, plain }); } catch (e) { throw Object.assign(e, { kind: errCode(e) }); }
  try {
    const lr = await c.cmd("LOGIN ", arg(acc.user), " ", arg(pass));
    if (lr.status !== "OK") { const e = Object.assign(new Error(lr.text || "login failed"), { code: "EAUTH" }); throw Object.assign(e, { kind: errCode(e) }); }
    const box = st.box || (st.box = await pickBox(c, acc));
    const ex = await c.ok("EXAMINE ", boxArg(box)); // read-only: nothing gets marked as read
    let uv = 0, next = 0;
    for (const u of ex.untagged) { let m; if ((m = /\[UIDVALIDITY (\d+)\]/i.exec(u.text))) uv = Number(m[1]); if ((m = /\[UIDNEXT (\d+)\]/i.exec(u.text))) next = Number(m[1]); }
    const fresh = !st.lastUid || st.uidValidity !== uv;
    const since = new Date(now.getTime() - FIRST_DAYS * 86400000);
    const sr = await c.ok("UID SEARCH ", fresh ? "SINCE " + imapDate(since) : "UID " + (st.lastUid + 1) + ":*", ' SUBJECT "Inkooporder"');
    let uids = [];
    for (const u of sr.untagged) { const m = /^\* SEARCH\b(.*)$/i.exec(u.text); if (m) uids.push(...m[1].trim().split(/\s+/).filter(Boolean).map(Number)); }
    uids = [...new Set(uids)].filter((u) => u > 0 && (fresh || u > st.lastUid)).sort((a, b) => a - b).slice(0, MAX_PER_RUN);
    const saved = []; let last = fresh ? 0 : st.lastUid;
    for (const uid of uids) {
      const fr = await c.ok("UID FETCH " + uid + " (BODY.PEEK[])");
      const lit = fr.untagged.find((u) => u.lits.length && /FETCH/i.test(u.text));
      if (lit) for (const f of poFiles(parseMail(lit.lits[0]))) if (!exists(f.name)) { await save(f.name, f.data); saved.push(f.name); }
      last = Math.max(last, uid);
    }
    if (uids.length < MAX_PER_RUN && next) last = Math.max(last, next - 1);
    st.uidValidity = uv; st.lastUid = last;
    return { saved, seen: uids.length };
  } finally { c.close(); }
}

// ------------------------------------------------------------------ the accounts, the timer, and what the page sees
function create({ dataDir, poFolder, encrypt, decrypt, canRun = () => true, send = () => {}, plain = false }) {
  const file = path.join(dataDir, "mail.json");
  const read = () => { try { const d = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(d.accounts) ? d : { accounts: [] }; } catch (e) { return { accounts: [] }; } };
  const write = (d) => { fs.mkdirSync(dataDir, { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(d, null, 2)); fs.renameSync(t, file); };
  const busy = new Set(); let timer = null, running = null;
  const pub = (a) => ({ id: a.id, provider: a.provider, user: a.user, host: a.host, port: a.port, enabled: a.enabled !== false, lastCheck: a.lastCheck || 0, lastOk: a.lastOk || 0,
    error: a.error || "", found: a.found || 0, lastFiles: a.lastFiles || [], busy: busy.has(a.id) });
  const state = () => ({ accounts: read().accounts.map(pub) });
  const emit = (extra) => { try { send(Object.assign(state(), extra || {})); } catch (e) {} };
  const where = (provider, host) => { if (PROVIDERS[provider]) return PROVIDERS[provider]; const m = /^\s*([^\s:/]+)(?::(\d+))?\s*$/.exec(String(host || "")); return m ? { host: m[1].toLowerCase(), port: Number(m[2] || 993) } : null; };

  // the PO folder: which names are there already (in it or a subfolder, any case), and saving into it without ever overwriting
  const names = (root) => {
    const out = new Set(); let n = 0;
    const walk = (d, depth) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const e of es) { if (++n > 20000) return; if (e.isDirectory()) { if (depth < 2) walk(path.join(d, e.name), depth + 1); } else out.add(e.name.toLowerCase()); } };
    walk(root, 0); return out;
  };

  async function runOne(acc, data, folder, have) {
    busy.add(acc.id); emit();
    const st = acc.state || (acc.state = {});
    try {
      const pass = decrypt(acc.pass);
      const r = await checkAccount(acc, pass, st, { poFolder: folder, plain, exists: (n) => have.has(n.toLowerCase()),
        save: async (n, bytes) => { have.add(n.toLowerCase()); try { fs.writeFileSync(path.join(folder, n), bytes, { flag: "wx" }); } catch (e) { if (e.code !== "EEXIST") throw e; } } });
      Object.assign(acc, { lastCheck: Date.now(), lastOk: Date.now(), error: "" });
      if (r.saved.length) { acc.found = (acc.found || 0) + r.saved.length; acc.lastFiles = r.saved.slice(-20); }
      return r.saved;
    } catch (e) {
      Object.assign(acc, { lastCheck: Date.now(), error: e.kind || errCode(e) });
      return [];
    } finally { busy.delete(acc.id); }
  }

  /** check every switched-on account (or just one id). Saved file names come back, and go to the page as { saved: [...] } */
  function check(id) {
    if (running) return running.then(() => (id ? check(id) : { saved: [] }));
    running = (async () => {
      const folder = poFolder();
      const data = read(), list = data.accounts.filter((a) => (id ? a.id === id : a.enabled !== false));
      if (!list.length) return { saved: [] };
      if (!folder || !fs.existsSync(folder)) { for (const a of list) Object.assign(a, { lastCheck: Date.now(), error: "nofolder" }); write(data); emit(); return { saved: [], error: "nofolder" }; }
      const have = names(folder), saved = [];
      for (const a of list) {
        saved.push(...(await runOne(a, data, folder, have)));
        const cur = read(); const i = cur.accounts.findIndex((x) => x.id === a.id); if (i >= 0) { cur.accounts[i] = Object.assign(cur.accounts[i], { state: a.state, lastCheck: a.lastCheck, lastOk: a.lastOk, error: a.error, found: a.found, lastFiles: a.lastFiles }); write(cur); }
      }
      emit(saved.length ? { saved } : null);
      return { saved };
    })().finally(() => { running = null; });
    return running;
  }

  /** add an account: the login is tried first, and it is only kept when that works. { ok, account } or { error } */
  async function add({ provider, user, pass, host }) {
    provider = PROVIDERS[provider] ? provider : "imap";
    user = String(user || "").trim(); pass = String(pass || "");
    const w = where(provider, host);
    if (!user || !pass) return { error: "missing" };
    if (!w) return { error: "host" };
    const acc = { id: crypto.randomBytes(6).toString("hex"), provider, user, host: w.host, port: w.port, enabled: true };
    const data = read();
    if (data.accounts.some((a) => a.user.toLowerCase() === user.toLowerCase() && a.host === acc.host)) return { error: "dup" };
    try { await testLogin(acc, pass); } catch (e) { return { error: e.kind || errCode(e), detail: String(e.message || "").slice(0, 200) }; }
    acc.pass = encrypt(pass); acc.added = Date.now();
    data.accounts.push(acc); write(data); emit();
    setTimeout(() => check(acc.id).catch(() => {}), 50);
    return { ok: true, account: pub(acc) };
  }
  async function testLogin(acc, pass) {
    let c; try { c = await Imap.open({ host: acc.host, port: acc.port, plain }); } catch (e) { throw Object.assign(e, { kind: errCode(e) }); }
    try {
      const r = await c.cmd("LOGIN ", arg(acc.user), " ", arg(pass));
      if (r.status !== "OK") { const e = Object.assign(new Error(r.text || "login failed"), { code: "EAUTH" }); throw Object.assign(e, { kind: errCode(e) }); }
    } finally { c.close(); }
  }
  function remove(id) { const d = read(); d.accounts = d.accounts.filter((a) => a.id !== id); write(d); emit(); return true; }
  function setEnabled(id, on) { const d = read(), a = d.accounts.find((x) => x.id === id); if (a) { a.enabled = !!on; if (on) a.error = ""; write(d); emit(); if (on) setTimeout(() => check(id).catch(() => {}), 50); } return !!a; }
  function auto() {
    if (timer) return;
    const tick = () => { if (canRun()) check().catch(() => {}); };
    setTimeout(tick, FIRST_AFTER_MS).unref?.();
    timer = setInterval(tick, EVERY_MS); timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { state, add, remove, setEnabled, check, auto, stop };
}

module.exports = { create, parseMail, poFiles, checkAccount, PROVIDERS, Imap, imapDate, errCode, params, words };
