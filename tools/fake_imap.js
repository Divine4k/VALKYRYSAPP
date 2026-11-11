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
function start({ users, boxes, uidValidity = 777, allMail = "" }) {
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
      if (cmd.startsWith("LIST")) { for (const k of Object.keys(boxes)) reply(`* LIST (${k === allMail ? "\\HasNoChildren \\All" : "\\HasNoChildren"}) "/" "${k}"`); reply(tag + " OK"); return; }
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
        const uid = Number(/UID FETCH (\d+)/i.exec(cmdRaw)[1]), x = box.find((y) => y.uid === uid);
        if (x) { s.write(`* ${box.indexOf(x) + 1} FETCH (UID ${uid} BODY[] {${x.raw.length}}\r\n`); s.write(x.raw); s.write(")\r\n"); }
        reply(tag + " OK fetch done"); return;
      }
      reply(tag + " BAD unknown");
    }
  });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res({ port: server.address().port, log, boxes, close: () => new Promise((r) => server.close(r)) })));
}
module.exports = { start, poMail };
