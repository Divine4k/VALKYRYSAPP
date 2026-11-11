// Valkyrys app: start-up loader. This file ships with the installer as resources/app/main.js and is never replaced by an in-app update,
// so keep it small and stable. It starts the newest installed update from %APPDATA%\Valkyrys app\versions\<version>\ (written by updater.js)
// when that is newer than the app that came with the installer, and the bundled app (app-main.js next to this file) otherwise.
//
// Markers inside a version folder: .pending (written here at its first start: {pid, at}), .ok (written by app-main once its page has loaded),
// .bad (written here when a version was started before but never became ok: it crashed or hung). A bad version is never started again;
// the one before it (or the bundled app) is used and versions/rollback.json says which version was given up, for the Updates panel.
const { app } = require("electron");
const path = require("path"), fs = require("fs");

const LOADER_VERSION = 1; // an update whose package.json asks for a higher "minLoader" needs the full installer
const bundled = require("./package.json").version;
const versionsDir = path.join(app.getPath("appData"), "Valkyrys app", "versions");
const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const has = (dir, f) => fs.existsSync(path.join(dir, f));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
const write = (f, o) => { try { fs.writeFileSync(f, JSON.stringify(o)); } catch (e) {} };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
let rolledBack = "";
const markBad = (ver, dir, why) => { write(path.join(dir, ".bad"), { at: new Date().toISOString(), why }); write(path.join(versionsDir, "rollback.json"), { version: ver, at: new Date().toISOString(), why }); rolledBack = ver; };

function candidates() {
  let names = []; try { names = fs.readdirSync(versionsDir); } catch (e) { return []; }
  return names.filter((v) => parse(v) && cmp(v, bundled) > 0).sort(cmp).reverse().map((v) => ({ v, dir: path.join(versionsDir, v) }))
    .filter(({ v, dir }) => {
      if (has(dir, ".bad") || !has(dir, "app-main.js") || !has(dir, "package.json")) return false;
      const pj = readJson(path.join(dir, "package.json")) || {};
      return pj.version === v && (pj.minLoader || 1) <= LOADER_VERSION;
    });
}

const state = { loaderVersion: LOADER_VERSION, bundled, versionsDir, running: bundled, dir: __dirname, get rolledBack() { return rolledBack; },
  markOk() { if (state.dir !== __dirname && !has(state.dir, ".ok")) { write(path.join(state.dir, ".ok"), { at: new Date().toISOString() }); try { fs.unlinkSync(path.join(versionsDir, "rollback.json")); } catch (e) {} } } };
global.valkyrysLoader = state;

let started = false;
for (const { v, dir } of candidates()) {
  const pending = readJson(path.join(dir, ".pending"));
  if (pending && !has(dir, ".ok")) {
    // started before and never became ok: it failed, unless that start is still running (a second launch while the first is loading)
    const busy = pending.pid && pending.pid !== process.pid && alive(pending.pid) && Date.now() - Date.parse(pending.at) < 120000;
    if (!busy) { markBad(v, dir, "did not start"); continue; }
  }
  if (!pending) write(path.join(dir, ".pending"), { pid: process.pid, at: new Date().toISOString() });
  state.running = v; state.dir = dir;
  try { require(path.join(dir, "app-main.js")); started = true; break; }
  catch (e) { console.error("update " + v + " failed to load:", e); markBad(v, dir, String((e && e.message) || e).slice(0, 300)); state.running = bundled; state.dir = __dirname; }
}
if (!started) {
  try { require("./app-main.js"); }
  catch (e) { if (rolledBack) { app.relaunch(); app.exit(0); } else throw e; } // a failed update may have left half its set-up behind: start clean
}
