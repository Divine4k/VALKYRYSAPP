// The data file (electron-app/server.js): what a new install starts with, and what happens when data.json is damaged.
//   node tools/test_datafile.mjs
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createServer, freshSettings } = require("../electron-app/server.js");
let bad = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c ? "" : "  -> " + JSON.stringify(extra))); if (!c) bad++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-data-")), file = path.join(dir, "data.json");
const web = path.join(dir, "web"); fs.mkdirSync(web); fs.writeFileSync(path.join(web, "index.html"), "<p>x</p>");
const open = async () => { const s = createServer(web, file); await new Promise((r) => s.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${s.address().port}`;
  return { db: async () => (await fetch(base + "/api/db")).json(), put: (p, v) => fetch(base + "/api/doc?path=" + encodeURIComponent(p), { method: "PUT", body: JSON.stringify(v) }), close: () => new Promise((r) => s.close(r)) }; };
const damaged = () => fs.readdirSync(dir).filter((n) => n.startsWith("data.json.damaged-"));

// a new install
let s = await open(), d = (await s.db())["settings/main"];
ok(d.startNumber === 1 && d.startYear === new Date().getFullYear() && d.fileTemplate === "Factuur {nummer}" && d.builtins === false, "new install: numbering from 1 this year, a neutral file name, no personal designs", d);
ok(JSON.stringify(d) === JSON.stringify(freshSettings()), "...the same as freshSettings()");
await s.put("invoices/1-2026", { factuurnr: "1-2026" }); await s.put("invoices/2-2026", { factuurnr: "2-2026" }); await s.close();
ok(fs.existsSync(file) && fs.existsSync(file + ".bak"), "saving keeps a copy of the save before (data.json.bak)");

// data.json damaged, the copy still good: the app goes on with the copy, the damaged file is kept aside
fs.writeFileSync(file, '{"settings/main": {"startNumber": 1, "sta');
s = await open(); d = await s.db();
ok(d["invoices/1-2026"] && d["settings/main"].builtins === false, "damaged data.json: the copy of the save before is used (invoice 1 is there)", Object.keys(d));
ok(damaged().length === 1, "...the damaged file is kept aside", fs.readdirSync(dir));
ok(JSON.parse(fs.readFileSync(file, "utf8"))["invoices/1-2026"], "...and data.json is readable again");
await s.put("invoices/3-2026", { factuurnr: "3-2026" }); await s.close();
ok(JSON.parse(fs.readFileSync(file + ".bak", "utf8"))["invoices/1-2026"], "the next save does not replace the good copy with the damaged file");

// an empty data.json and no readable copy: a new install, the unreadable file kept
fs.writeFileSync(file, ""); fs.writeFileSync(file + ".bak", "not json");
s = await open(); d = await s.db();
ok(Object.keys(d).length === 1 && d["settings/main"].startNumber === 1, "nothing readable: starts as a new install", Object.keys(d));
ok(damaged().length === 2, "...with the unreadable file kept aside");
await s.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad ? `${bad} FAILED` : "ALL PASS"); process.exit(bad ? 1 : 0);
