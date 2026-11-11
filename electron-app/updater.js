// In-app updates: a small zip of the app files instead of the full installer.
// Published as plain files on the main branch of the public repo UPDATE_REPO: latest.json (the signed manifest) and packages/valkyrys-app-<version>.zip,
// read through raw.githubusercontent.com (tools/build_update.mjs builds them, tools/publish_update.sh commits and pushes them).
// Installed into %APPDATA%\Valkyrys app\versions\<version>\, which the loader (main.js) starts at the next start.
//
// Manifest: { version, date, url, sha256, size, minLoader, notes: [{type, nl, en, pl}], signature }.
// signature = Ed25519 (base64) over canonical(manifest without "signature"): JSON with the keys of every object sorted (by UTF-16 code units),
// no whitespace, strings/numbers as JSON.stringify writes them. sha256 + size of the zip are inside, so the zip is covered too.
// The pure parts (constants, canonical, verify) need no Electron, so tools/build_update.mjs and the tests use this same file.
const path = require("path"), fs = require("fs"), crypto = require("crypto");

const UPDATE_REPO = "Divine4k/valkyrys-updates"; // public repo with the update releases: the only place this name is written
const RAW = `https://raw.githubusercontent.com/${UPDATE_REPO}/main`;
const MANIFEST_URL = `${RAW}/latest.json`;
const ASSET_URL = (ver) => `${RAW}/packages/valkyrys-app-${ver}.zip`;
// Ed25519 public key (SPKI DER, base64) of keys/update-signing.pem. SHA-256 of the DER: 0de2a657c544335c0fc5383b7408987f28f1da506b1e3b418ad1ef513fc130c1
const PUBLIC_KEY = "MCowBQYDK2VwAyEA8JAuqhMe2z3SlaVVluGEo5GC8zI143/vaTJFyunVXsw=";
const REQUIRED = ["app-main.js", "updater.js", "preload.js", "server.js", "package.json", "web/index.html", "splash/splash.html", "build/icon.png"];
const CHECK_EVERY_MS = 3600 * 1000; // while the app is open; and always once at the start

const canonical = (v) => {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
};
const unsigned = (m) => { const o = { ...m }; delete o.signature; return o; };
function verify(m, publicKey = PUBLIC_KEY) {
  if (!m || typeof m !== "object" || typeof m.signature !== "string") return false;
  try { return crypto.verify(null, Buffer.from(canonical(unsigned(m)), "utf8"), crypto.createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(m.signature, "base64")); }
  catch (e) { return false; }
}
const parseVer = (v) => (typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
const cmpVer = (a, b) => { const x = parseVer(a), y = parseVer(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

/** the main-process side: create(opts) once the app is ready. opts: { appDir, dataDir, send(state), canInstall() } */
function create(opts) {
  const { app, net } = require("electron");
  const loader = global.valkyrysLoader || null;
  const running = require(path.join(opts.appDir, "package.json")).version;
  const bundled = loader ? loader.bundled : running;
  const versionsDir = loader ? loader.versionsDir : path.join(app.getPath("appData"), "Valkyrys app", "versions");
  const metaFile = path.join(opts.dataDir, "update.json");
  const readMeta = () => { try { return JSON.parse(fs.readFileSync(metaFile, "utf8")) || {}; } catch (e) { return {}; } };
  const manifestUrl = () => { const u = process.env.VALKYRYS_UPDATE_URL || MANIFEST_URL; return u + (u.includes("?") ? "&" : "?") + "t=" + Date.now(); }; // the raw CDN caches ~5 min
  let manifest = null, status = "idle", progress, error, installing = null, checking = null;

  const rolledBack = () => {
    const r = loader && loader.rolledBack ? { version: loader.rolledBack } : (() => { try { return JSON.parse(fs.readFileSync(path.join(versionsDir, "rollback.json"), "utf8")); } catch (e) { return null; } })();
    return r && parseVer(r.version) && cmpVer(r.version, running) > 0 ? r.version : undefined;
  };
  const isBad = (v) => fs.existsSync(path.join(versionsDir, v, ".bad"));
  function state() {
    const s = { running, bundled, status };
    if (manifest) s.latest = { version: manifest.version, date: manifest.date, notes: Array.isArray(manifest.notes) ? manifest.notes : [], size: manifest.size };
    if (status === "downloading") s.progress = progress || 0;
    if (status === "error" && error) s.error = error;
    const rb = rolledBack(); if (rb) s.rolledBack = rb;
    const lc = readMeta().lastCheck; if (lc) s.lastCheck = lc;
    return s;
  }
  const set = (st, extra = {}) => { status = st; ({ progress, error } = { progress: extra.progress, error: extra.error }); try { opts.send(state()); } catch (e) {} return state(); };

  async function fetchBuf(url, onChunk, max) {
    const r = await net.fetch(url, { cache: "no-store", redirect: "follow" });
    if (!r.ok) throw new Error("http " + r.status);
    if (!r.body || !onChunk) { const b = Buffer.from(await r.arrayBuffer()); if (max && b.length > max) throw new Error("size"); return b; }
    const reader = r.body.getReader(), parts = []; let n = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      n += value.length; if (max && n > max) { try { reader.cancel(); } catch (e) {} throw new Error("size"); }
      parts.push(Buffer.from(value)); onChunk(n);
    }
    return Buffer.concat(parts);
  }

  function check() {
    if (installing) return Promise.resolve(state());
    if (checking) return checking;
    set("checking");
    checking = (async () => {
      try {
        const m = JSON.parse((await fetchBuf(manifestUrl(), null, 1024 * 1024)).toString("utf8"));
        if (!verify(m)) throw new Error("signature");
        if (!parseVer(m.version) || typeof m.url !== "string" || !/^[0-9a-f]{64}$/.test(m.sha256 || "") || !(m.size > 0)) throw new Error("manifest");
        try { fs.mkdirSync(opts.dataDir, { recursive: true }); fs.writeFileSync(metaFile, JSON.stringify({ ...readMeta(), lastCheck: new Date().toISOString() })); } catch (e) {}
        manifest = m;
        if (cmpVer(m.version, running) <= 0 || isBad(m.version)) return set("uptodate"); // a version that failed to start here is not offered again
        if ((m.minLoader || 1) > (loader ? loader.loaderVersion : 0)) return set("error", { error: "loader" }); // needs the full installer
        if (fs.existsSync(path.join(versionsDir, m.version, "app-main.js")) && !fs.existsSync(path.join(versionsDir, m.version, ".pending"))) return set("ready");
        return set("available");
      } catch (e) { return set("error", { error: String((e && e.message) || e).slice(0, 200) }); }
      finally { checking = null; }
    })();
    return checking;
  }

  const safeRel = (n) => { const p = path.posix.normalize(n); return p && !p.startsWith("../") && p !== ".." && !path.posix.isAbsolute(p) && !/[\\:]/.test(p) ? p : ""; };
  const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {} };

  function install() {
    if (installing) return installing;
    installing = (async () => {
      try {
        if (status !== "available" && status !== "ready") { const s = await check(); if (s.status !== "available" && s.status !== "ready") return s; }
        if (status === "ready") return state();
        const m = manifest;
        if (opts.canInstall && !opts.canInstall()) throw new Error("locked");
        set("downloading", { progress: 0 });
        let last = 0;
        const zip = await fetchBuf(m.url, (n) => { const p = Math.min(1, n / m.size); if (p - last >= 0.01 || p === 1) { last = p; set("downloading", { progress: p }); } }, m.size);
        if (zip.length !== m.size) throw new Error("size");
        if (crypto.createHash("sha256").update(zip).digest("hex") !== m.sha256) throw new Error("sha256");
        const JSZip = require(path.join(opts.appDir, "web", "vendor", "jszip.min.js"));
        const z = await JSZip.loadAsync(zip);
        fs.mkdirSync(versionsDir, { recursive: true });
        const tmp = path.join(versionsDir, m.version + ".tmp"), dest = path.join(versionsDir, m.version);
        rmrf(tmp); fs.mkdirSync(tmp);
        for (const f of Object.values(z.files)) {
          const rel = safeRel(f.name.replace(/\/$/, "")); if (!rel) throw new Error("zip path");
          const out = path.join(tmp, ...rel.split("/"));
          if (f.dir) { fs.mkdirSync(out, { recursive: true }); continue; }
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, await f.async("nodebuffer"));
        }
        for (const f of REQUIRED) if (!fs.existsSync(path.join(tmp, f))) { rmrf(tmp); throw new Error("missing " + f); }
        let pj = {}; try { pj = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8")); } catch (e) {}
        if (pj.version !== m.version) { rmrf(tmp); throw new Error("version"); }
        rmrf(dest);
        for (let i = 0; ; i++) { try { fs.renameSync(tmp, dest); break; } catch (e) { if (i >= 5) { rmrf(tmp); throw e; } await new Promise((r) => setTimeout(r, 300 * (i + 1))); } } // virus scanners can hold a file a moment
        prune();
        return set("ready");
      } catch (e) { return set("error", { error: String((e && e.message) || e).slice(0, 200) }); }
      finally { installing = null; }
    })();
    return installing;
  }

  /** keeps the running version, the newest one before it, and anything newer (installed, not started yet, or failed); deletes the rest and left-over .tmp folders */
  function prune() {
    let names = []; try { names = fs.readdirSync(versionsDir); } catch (e) { return; }
    const vers = names.filter(parseVer);
    const older = vers.filter((v) => cmpVer(v, running) < 0 && cmpVer(v, bundled) > 0).sort(cmpVer);
    const keep = new Set([...vers.filter((v) => cmpVer(v, running) >= 0 && cmpVer(v, bundled) > 0), ...older.slice(-1)]);
    for (const n of names) {
      if (n.endsWith(".tmp") && !installing) rmrf(path.join(versionsDir, n));
      else if (parseVer(n) && !keep.has(n)) rmrf(path.join(versionsDir, n));
    }
  }

  function restart() { app.relaunch(); app.exit(0); }

  /** check right at the start (while the splash plays; VALKYRYS_UPDATE_DELAY ms later in tests), then every hour while the app is open.
   *  Only checks: installing is always the user's choice. Returns the first check (resolves, never fails). */
  function auto() {
    const delay = process.env.VALKYRYS_UPDATE_DELAY ? Number(process.env.VALKYRYS_UPDATE_DELAY) : 0;
    const tick = () => (status !== "downloading" && status !== "ready" ? Promise.resolve(check()).catch(() => {}) : Promise.resolve());
    return new Promise((res) => { setTimeout(() => { tick().then(res, res); setInterval(tick, CHECK_EVERY_MS).unref(); }, delay).unref(); });
  }
  return { state, check, install, restart, prune, auto, running, bundled };
}

module.exports = { UPDATE_REPO, MANIFEST_URL, ASSET_URL, PUBLIC_KEY, REQUIRED, canonical, unsigned, verify, cmpVer, create };
