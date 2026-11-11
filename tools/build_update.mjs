// Builds an in-app update: out/update/valkyrys-app-<version>.zip + out/update/latest.json (signed). Publish with tools/publish_update.sh <version>.
//   node tools/build_update.mjs                      the version in electron-app/package.json, built from app/web (run tools/dev.sh build first; dev.sh update does)
// Options (used by tools/test_update.js): --version X  --out DIR  --url URL (zip URL in the manifest)  --key PEM  --app DIR (an already staged app folder)
//
// Hosted as files on main of the updates repo (not GitHub Releases): latest.json and packages/valkyrys-app-<version>.zip.
// Zip = the staged resources/app (tools/stage_app.py) minus the loader main.js: app-main.js, updater.js, preload.js, server.js, package.json, splash/, web/, build/.
// latest.json = { version, date, url, sha256, size, minLoader, notes, signature }; signature: Ed25519 over canonical(manifest without signature),
// see canonical() in electron-app/updater.js (sorted keys, no whitespace). The private key keys/update-signing.pem is made once when missing.
import fs from "fs"; import path from "path"; import crypto from "crypto"; import vm from "vm"; import os from "os";
import { execFileSync } from "child_process"; import { createRequire } from "module"; import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const SP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const U = require(path.join(SP, "electron-app", "updater.js"));
const JSZip = require("/opt/npm-tools/node_modules/jszip");

const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const keyFile = args.key || path.join(SP, "keys", "update-signing.pem");
if (!fs.existsSync(keyFile)) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  console.log("new signing key", keyFile, "- put this PUBLIC_KEY in electron-app/updater.js:", publicKey.export({ type: "spki", format: "der" }).toString("base64"));
}
const key = crypto.createPrivateKey(fs.readFileSync(keyFile));

// the app folder: staged fresh from the sources unless --app is given
let appDir = args.app, tmp = "";
if (!appDir) {
  if (!fs.existsSync(path.join(SP, "app", "web", "index.html"))) { console.error("app/web missing: run tools/dev.sh build first"); process.exit(1); }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "valk-upd-")); appDir = path.join(tmp, "app");
  execFileSync("python3", ["-I", path.join(SP, "tools", "stage_app.py"), appDir, ...(args.version ? [args.version] : [])]);
}
const pj = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
const version = args.version || pj.version;
if (pj.version !== version) { console.error(`package.json of the app says ${pj.version}, not ${version}`); process.exit(1); }
for (const f of U.REQUIRED) if (!fs.existsSync(path.join(appDir, f))) { console.error("missing in the app folder: " + f); process.exit(1); }
// every local file the app's own scripts require must be in the package (1.3.10 shipped without drives.js and would not start)
for (const f of fs.readdirSync(appDir).filter((n) => n.endsWith(".js"))) {
  for (const m of fs.readFileSync(path.join(appDir, f), "utf8").matchAll(/require\(\s*["']\.\/([^"']+)["']\s*\)/g)) {
    const r = m[1].endsWith(".js") || m[1].endsWith(".json") ? m[1] : m[1] + ".js";
    if (!fs.existsSync(path.join(appDir, r))) { console.error(`missing in the app folder: ${r} (required by ${f})`); process.exit(1); }
  }
}

const zip = new JSZip();
const add = (dir, rel) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) add(path.join(dir, e.name), r);
    else if (r !== "main.js" && !e.name.startsWith(".")) zip.file(r, fs.readFileSync(path.join(dir, e.name)), { date: new Date("2026-01-01T00:00:00Z") });
  }
};
add(appDir, "");
const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });

// notes: the items of the top entry of tool/changelog.js
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(SP, "tool", "changelog.js"), "utf8"), ctx);
const top = (ctx.window.VALK_CHANGELOG || [])[0] || { items: [] };
// --no-notes: a quiet fix without its own changelog entry, released without notes (else it would show the notes of the version before)
const quiet = process.argv.includes("--no-notes");
if (top.version !== version && !quiet) console.warn(`warning: the top changelog entry is ${top.version}, the update is ${version}`);
const notes = quiet ? [] : (top.items || []).map((i) => ({ type: i.type, nl: i.nl, en: i.en, pl: i.pl }));

const out = args.out || path.join(SP, "out", "update");
fs.mkdirSync(out, { recursive: true });
const zipName = `valkyrys-app-${version}.zip`;
fs.writeFileSync(path.join(out, zipName), buf);
const m = { version, date: new Date().toISOString().slice(0, 10), url: args.url || U.ASSET_URL(version), sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length, minLoader: pj.minLoader || 1, notes };
m.signature = crypto.sign(null, Buffer.from(U.canonical(m), "utf8"), key).toString("base64");
if (!args.key && !U.verify(m)) { console.error("the signature does not verify with PUBLIC_KEY in electron-app/updater.js: wrong key in keys/?"); process.exit(1); }
fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(m, null, 2) + "\n");
if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
console.log(`update ${version}: ${path.join(out, zipName)} (${(buf.length / 1048576).toFixed(1)} MB), latest.json, ${notes.length} notes`);
