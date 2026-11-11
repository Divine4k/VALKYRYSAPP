// A tiny fake IMAP server (plain TCP) for the mail tests: LOGIN, LIST, SELECT/EXAMINE, UID SEARCH (SINCE / UID n:* / SUBJECT), UID FETCH BODY.PEEK[], LOGOUT.
// Everything the client sends is kept in `log`, so a test can check that nothing was ever written (no STORE, no SELECT, only BODY.PEEK).
const net = require("net");

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** a purchase-order mail like the client sends: subject "Inkooporder PO-<n>", text, and the PDF attached (base64) */
function poMail({ po, pdf, subject, file, from = '"Secretariaat | Piguillet" <secretariaat@piguillet.nl>', date = new Date() }) {
  const b = "----=_Part_" + po, b64 = Buffer.from(pdf).toString("base64").replace(/.{76}/g, "$&\r\n");
  return Buffer.from([
    "From: " + from, "To: someone@wp.pl", "Subject: " + (subject || "Inkooporder PO-" + po), "Date: " + date.toUTCString(), "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${b}"`, "", "--" + b, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "",
    "Geachte heer/mevrouw, Hierbij ontvangt u de inkooporder behorend bij de reeds uitgevoerde werkzaamheden.", "--" + b,
    `Content-Type: application/pdf; name="${file || "PO-" + po + ".pdf"}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${file || "PO-" + po + ".pdf"}"`, "", b64, "--" + b + "--", ""].join("\r\n"), "latin1");
}

/** start the server: users { "user": "pass" }, boxes { INBOX: [{ uid, date, subject, raw }] }, opts.allMail = name of a \All mailbox (Gmail). -> { port, log, boxes, close } */
function start({ users, boxes, uidValidity = 777, allMail = "", sentBox = "" }) {
  const log = [];
  const server = net.createServer((s) => {
    let buf = "", authed = false, box = null, pendingLit = null;
    s.write("* OK fake IMAP ready\r\n");
    const reply = (t) => s.write(t + "\r\n");
    s.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        if (pendingLit && pendingLit.n) { if (buf.length < pendingLit.n) return; pendingLit.line += buf.slice(0, pendingLit.n); buf = buf.slice(pendingLit.n); pendingLit.n = 0; }
        if (pendingLit) { // the rest of the line after a literal
          const i0 = buf.indexOf("\r\n"); if (i0 < 0) return;
          const l = pendingLit.line + buf.slice(0, i0); buf = buf.slice(i0 + 2);
          const lm = /\{(\d+)\}$/.exec(l);
          if (lm) { pendingLit = { line: l.slice(0, lm.index), n: Number(lm[1]) }; reply("+ go"); continue; }
          pendingLit = null; handle(l); continue;
        }
        const i = buf.indexOf("\r\n"); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const m = /\{(\d+)\}$/.exec(line);
        if (m) { pendingLit = { line: line.slice(0, m.index), n: Number(m[1]) }; reply("+ go"); continue; }
        handle(line);
      }
    });
    const unq = (x) => (x.startsWith('"') ? x.slice(1, -1).replace(/\\(.)/g, "$1") : x);
    function handle(line) {
      log.push(line.replace(/^(\S+ LOGIN \S+ ).*/i, "$1***"));
      const [tag, cmdRaw] = [line.split(" ")[0], line.slice(line.indexOf(" ") + 1)];
      const cmd = cmdRaw.toUpperCase();
      if (cmd.startsWith("LOGIN ")) {
        const m = /^LOGIN ("(?:[^"\\]|\\.)*"|\S+) (.*)$/i.exec(cmdRaw); const u = m && unq(m[1]), p = m && unq(m[2]);
        if (m && users[u] === Buffer.from(p, "latin1").toString("utf8")) { authed = true; reply(tag + " OK logged in"); } else reply(tag + " NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)");
        return;
      }
      if (cmd.startsWith("LOGOUT")) { reply("* BYE"); reply(tag + " OK bye"); s.end(); return; }
      if (!authed) { reply(tag + " BAD not logged in"); return; }
      if (cmd.startsWith("APPEND ")) { // a sent copy: APPEND "box" (flags) {n} + the mail
        const m = /^APPEND ("(?:[^"\\]|\\.)*"|\S+) (?:\([^)]*\) )?([\s\S]*)$/i.exec(cmdRaw); const name = m && unq(m[1]);
        if (!m || !boxes[name]) { reply(tag + " NO no such mailbox"); return; }
        const uid = boxes[name].reduce((a, x) => Math.max(a, x.uid), 0) + 1; boxes[name].push({ uid, date: new Date(), subject: "", raw: Buffer.from(m[2], "latin1") });
        reply(tag + " OK append done"); return;
      }
      if (cmd.startsWith("LIST")) { for (const k of Object.keys(boxes)) reply(`* LIST (${k === allMail ? "\\HasNoChildren \\All" : k === sentBox ? "\\HasNoChildren \\Sent" : "\\HasNoChildren"}) "/" "${k}"`); reply(tag + " OK"); return; }
      if (cmd.startsWith("EXAMINE ") || cmd.startsWith("SELECT ")) {
        const name = unq(cmdRaw.slice(cmdRaw.indexOf(" ") + 1)); box = boxes[name];
        if (!box) { reply(tag + " NO no such mailbox"); return; }
        const next = box.reduce((a, x) => Math.max(a, x.uid), 0) + 1;
        reply(`* ${box.length} EXISTS`); reply(`* OK [UIDVALIDITY ${uidValidity}] ok`); reply(`* OK [UIDNEXT ${next}] ok`); reply(tag + " OK [READ-ONLY] done"); return;
      }
      if (cmd.startsWith("UID SEARCH ")) {
        let list = box.slice();
        let m;
        if ((m = /SINCE (\d+)-(\w{3})-(\d{4})/i.exec(cmdRaw))) { const d = new Date(Number(m[3]), MON.indexOf(m[2]), Number(m[1])); list = list.filter((x) => x.date >= d); }
        if ((m = /UID (\d+):\*/i.exec(cmdRaw))) { const from = Number(m[1]); const max = box.reduce((a, x) => Math.max(a, x.uid), 0); list = list.filter((x) => x.uid >= from || x.uid === max); } // n:* always includes the last one (as real servers do)
        if ((m = /SUBJECT "([^"]*)"/i.exec(cmdRaw))) list = list.filter((x) => x.subject.toLowerCase().includes(m[1].toLowerCase()));
        reply("* SEARCH" + list.map((x) => " " + x.uid).join("")); reply(tag + " OK search done"); return;
      }
      if (cmd.startsWith("UID FETCH ")) {
        const set = /UID FETCH ([\d,:*]+)/i.exec(cmdRaw)[1].split(",").map(Number), hdr = /HEADER\.FIELDS/i.test(cmdRaw);
        for (const uid of set) {
          const x = box.find((y) => y.uid === uid); if (!x) continue;
          const body = hdr ? Buffer.from("Subject: " + x.subject + "\r\n\r\n", "latin1") : x.raw;
          s.write(`* ${box.indexOf(x) + 1} FETCH (UID ${uid} BODY[${hdr ? "HEADER.FIELDS (SUBJECT)" : ""}] {${body.length}}\r\n`); s.write(body); s.write(")\r\n");
        }
        reply(tag + " OK fetch done"); return;
      }
      reply(tag + " BAD unknown");
    }
  });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res({ port: server.address().port, log, boxes, close: () => new Promise((r) => server.close(r)) })));
}
/** a fake SMTP server (plain TCP): EHLO, AUTH PLAIN, MAIL FROM, RCPT TO, DATA, QUIT. Mails it took: sent [{ from, to, data }]. rejectRcpt: addresses it refuses */
function startSmtp({ users, rejectRcpt = [] }) {
  const sent = [], log = [];
  const server = net.createServer((s) => {
    let buf = "", data = null, authed = false, cur = null;
    const reply = (t) => s.write(t + "\r\n");
    reply("220 fake SMTP ready");
    s.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        if (data !== null) { const end = buf.indexOf("\r\n.\r\n"); if (end < 0) return; data += buf.slice(0, end); buf = buf.slice(end + 5); cur.data = Buffer.from(data, "latin1"); sent.push(cur); data = null; cur = null; reply("250 queued"); continue; }
        const i = buf.indexOf("\r\n"); if (i < 0) return; const line = buf.slice(0, i); buf = buf.slice(i + 2);
        log.push(line.replace(/^AUTH PLAIN .*/i, "AUTH PLAIN ***")); const U = line.toUpperCase();
        if (U.startsWith("EHLO")) { reply("250-fake"); reply("250 AUTH PLAIN LOGIN"); }
        else if (U.startsWith("AUTH PLAIN ")) { const [, u, p] = Buffer.from(line.slice(11), "base64").toString("utf8").split("\0"); if (users[u] === p) { authed = true; reply("235 ok"); } else reply("535 5.7.8 Username and Password not accepted"); }
        else if (U.startsWith("MAIL FROM:")) { if (!authed) { reply("530 auth first"); continue; } cur = { from: line.slice(10).replace(/[<>]/g, ""), to: [] }; reply("250 ok"); }
        else if (U.startsWith("RCPT TO:")) { const r = line.slice(8).replace(/[<>]/g, ""); if (rejectRcpt.includes(r)) reply("550 5.1.1 no such user"); else { cur.to.push(r); reply("250 ok"); } }
        else if (U === "DATA") { data = ""; reply("354 go"); }
        else if (U === "QUIT") { reply("221 bye"); s.end(); }
        else reply("500 unknown");
      }
    });
  });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res({ port: server.address().port, sent, log, close: () => new Promise((r) => server.close(r)) })));
}
module.exports = { start, startSmtp, poMail };
