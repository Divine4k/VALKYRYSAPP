// Valkyrys app: desktop app (Electron). Shows the invoice tool in its own window; data is kept in a file on this computer.
const { app, BrowserWindow, Menu, session, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createServer } = require("./server");

app.setName("Valkyrys app");
app.setAppUserModelId("nl.valkyrys.app");
// The app used to be called "Valkyrys Facturen". Its data folder is moved along to the new name, so nothing is lost: the whole folder when there is no new one yet,
// otherwise only the three files that matter, and only the ones that are missing. When even that cannot be done, the old folder is simply kept in use.
{
  const roaming = app.getPath("appData"), NEW = path.join(roaming, "Valkyrys app"), OLD = path.join(roaming, "Valkyrys Facturen");
  let dir = NEW;
  try {
    if (fs.existsSync(OLD)) {
      if (!fs.existsSync(NEW)) fs.renameSync(OLD, NEW);
      else for (const f of ["data.json", "config.json", "pin.json"]) if (!fs.existsSync(path.join(NEW, f)) && fs.existsSync(path.join(OLD, f))) fs.copyFileSync(path.join(OLD, f), path.join(NEW, f));
    }
  } catch (e) { if (fs.existsSync(OLD) && !fs.existsSync(NEW)) dir = OLD; }
  app.setPath("userData", dir);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
let win = null;
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });


// ---- the invoice folder: chosen by the user, remembered in config.json next to the data file
let appOrigin = "";
const configFile = () => path.join(app.getPath("userData"), "config.json");
const readConfig = () => { try { return JSON.parse(fs.readFileSync(configFile(), "utf8")) || {}; } catch (e) { return {}; } };
const writeConfig = (c) => { fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify(c, null, 2)); };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const CFG = { invoices: "folder", pos: "poFolder" }; // two folders: the finished invoices, and the purchase orders (PDFs from the client)
const cfgKey = (kind) => CFG[kind] || CFG.invoices;
const folderPath = (kind) => { const f = readConfig()[cfgKey(kind)]; return typeof f === "string" && f ? f : ""; };
const folderInfo = (kind) => { const p = folderPath(kind); return p ? { path: p, exists: isDir(p) } : null; };
const inside = (root, rel) => { const full = path.resolve(root, rel); const r = path.relative(root, full); return r && !r.startsWith("..") && !path.isAbsolute(r) ? full : ""; };
const SAVE_EXT = /\.(pdf|docx)$/i;

function listInvoiceFiles(root) {
  const out = []; let seen = 0;
  const walk = (dir, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (++seen > 5000) return;
      if (e.name.startsWith(".") || e.name.startsWith("~$")) continue; // hidden files and Word's temporary lock files
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 2) walk(full, depth + 1); continue; }
      if (!e.isFile() || !SAVE_EXT.test(e.name)) continue;
      try { const st = fs.statSync(full); out.push({ rel: path.relative(root, full).split(path.sep).join("/"), name: e.name, ext: path.extname(e.name).slice(1).toLowerCase(), mtime: st.mtimeMs, size: st.size }); } catch (err) {}
    }
  };
  walk(root, 0);
  return out;
}

// ---- the PIN: set at the first start, asked at every start. Kept in pin.json (salted scrypt hash, never the PIN itself).
// Delete pin.json to remove the PIN. It locks the app; it does not encrypt the files on disk.
const pinFile = () => path.join(app.getPath("userData"), "pin.json");
const pinRead = () => { try { return JSON.parse(fs.readFileSync(pinFile(), "utf8")) || {}; } catch (e) { return {}; } };
const pinWrite = (o) => { fs.mkdirSync(path.dirname(pinFile()), { recursive: true }); fs.writeFileSync(pinFile(), JSON.stringify(o)); };
const PIN_RE = /^\d{4,8}$/;
const pinHash = (pin, saltHex) => crypto.scryptSync(pin, Buffer.from(saltHex, "hex"), 32).toString("hex");
const pinSet = (pin) => { const salt = crypto.randomBytes(16).toString("hex"); pinWrite({ v: 1, salt, hash: pinHash(pin, salt), fails: 0, until: 0 }); };
let unlocked = !pinRead().hash; // locked from the start when a PIN exists
const MAX_FREE_TRIES = 5; // after this many wrong PINs in a row the next try has to wait: 30 s, then doubling up to 15 min
const pinState = () => { const p = pinRead(); return { has: !!p.hash, skipped: !!p.skipped, unlocked, wait: Math.max(0, (p.until || 0) - Date.now()) }; };
/** checks a PIN and keeps count of wrong tries (stored, so closing the app does not reset it) */
function pinCheck(pin) {
  const p = pinRead();
  if (!p.hash) return { ok: true };
  const wait = (p.until || 0) - Date.now();
  if (wait > 0) return { ok: false, wait };
  let good = false;
  if (PIN_RE.test(pin)) { const a = Buffer.from(pinHash(pin, p.salt), "hex"), b = Buffer.from(p.hash, "hex"); good = a.length === b.length && crypto.timingSafeEqual(a, b); }
  if (good) { if (p.fails || p.until) pinWrite(Object.assign(p, { fails: 0, until: 0 })); return { ok: true }; }
  p.fails = (p.fails || 0) + 1;
  p.until = p.fails >= MAX_FREE_TRIES ? Date.now() + Math.min(30000 * 2 ** (p.fails - MAX_FREE_TRIES), 15 * 60000) : 0;
  pinWrite(p);
  return { ok: false, left: Math.max(0, MAX_FREE_TRIES - p.fails), wait: Math.max(0, p.until - Date.now()) };
}
const fromApp = (e) => { const url = e.senderFrame && e.senderFrame.url; return !!(appOrigin && url && url.startsWith(appOrigin + "/")); };
function registerPinIpc() {
  const guard = (fn) => async (e, ...a) => { if (!fromApp(e)) throw new Error("not allowed"); return fn(e, ...a); };
  ipcMain.on("pin:state-sync", (e) => { e.returnValue = fromApp(e) ? pinState() : { has: true, skipped: false, unlocked: false }; });
  ipcMain.handle("pin:state", guard(() => pinState()));
  ipcMain.handle("pin:verify", guard((e, pin) => { const r = pinCheck(pin); if (r.ok) unlocked = true; return r; }));
  ipcMain.handle("pin:setup", guard((e, pin) => { // only when no PIN is set yet
    if (pinRead().hash) return { ok: false, error: "exists" };
    if (!PIN_RE.test(pin)) return { ok: false, error: "format" };
    pinSet(pin); unlocked = true; return { ok: true };
  }));
  ipcMain.handle("pin:change", guard((e, oldPin, pin) => {
    if (!unlocked) return { ok: false, error: "locked" };
    const r = pinCheck(oldPin); if (!r.ok) return r;
    if (!PIN_RE.test(pin)) return { ok: false, error: "format" };
    pinSet(pin); return { ok: true };
  }));
  ipcMain.handle("pin:remove", guard((e, oldPin) => {
    if (!unlocked) return { ok: false, error: "locked" };
    const r = pinCheck(oldPin); if (!r.ok) return r;
    pinWrite({ v: 1, skipped: true }); return { ok: true };
  }));
  ipcMain.handle("pin:skip", guard(() => { if (!pinRead().hash) pinWrite({ v: 1, skipped: true }); return { ok: true }; }));
}

function registerFolderIpc(getWin) {
  const guard = (fn) => async (e, ...a) => {
    if (!fromApp(e) || !unlocked) throw new Error("not allowed");
    return fn(e, ...a);
  };
  ipcMain.handle("folder:get", guard((e, kind) => folderInfo(kind)));
  ipcMain.handle("folder:pick", guard(async (e, title, kind) => {
    const cur = folderPath(kind);
    const r = await dialog.showOpenDialog(getWin() || undefined, { title: title || "Valkyrys app", defaultPath: cur && isDir(cur) ? cur : app.getPath("documents"), properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    writeConfig(Object.assign(readConfig(), { [cfgKey(kind)]: r.filePaths[0] }));
    return { canceled: false, folder: folderInfo(kind) };
  }));
  ipcMain.handle("folder:clear", guard((e, kind) => { const c = readConfig(); delete c[cfgKey(kind)]; writeConfig(c); return true; }));
  ipcMain.handle("folder:open", guard(async (e, kind) => { const p = folderPath(kind); if (!p || !isDir(p)) return false; await shell.openPath(p); return true; }));
  ipcMain.handle("folder:list", guard((e, kind) => { const p = folderPath(kind); return p && isDir(p) ? listInvoiceFiles(p) : []; }));
  ipcMain.handle("folder:read", guard(async (e, rel, kind) => { // file contents, so the page can read invoices and purchase orders
    const p = folderPath(kind); const full = p && inside(p, rel);
    if (!full || !SAVE_EXT.test(full)) return null;
    try { const st = fs.statSync(full); return st.isFile() && st.size <= 40 * 1024 * 1024 ? fs.readFileSync(full) : null; } catch (err) { return null; }
  }));
  ipcMain.handle("folder:reveal", guard(async (e, rel, kind) => { // shows the file in its folder (selected), so a wrong one can be deleted there
    const p = folderPath(kind); const full = p && inside(p, rel);
    if (!full || !SAVE_EXT.test(full) || !fs.existsSync(full)) return { error: "missing" };
    shell.showItemInFolder(full); return { ok: true };
  }));
  ipcMain.handle("app:welcomed", guard(() => readConfig().welcomed === true)); // the first-start question about the folders has been asked
  ipcMain.handle("app:welcomed-set", guard(() => { writeConfig(Object.assign(readConfig(), { welcomed: true })); return true; }));
  ipcMain.handle("folder:openfile", guard(async (e, rel, kind) => {
    const p = folderPath(kind); const full = p && inside(p, rel);
    if (!full || !SAVE_EXT.test(full) || !fs.existsSync(full)) return { error: "missing" };
    const err = await shell.openPath(full); return err ? { error: err } : { ok: true };
  }));
  ipcMain.handle("folder:save", guard(async (e, name, bytes, overwrite) => {
    const p = folderPath();
    if (!p || !isDir(p)) return { ok: false, error: "missing" };
    if (name !== path.basename(name) || !SAVE_EXT.test(name)) return { ok: false, error: "name" };
    const buf = Buffer.from(bytes);
    if (!buf.length || buf.length > 50 * 1024 * 1024) return { ok: false, error: "size" };
    let file = path.join(p, name);
    if (!overwrite) { // never replace a different invoice: add " (2)", " (3)" ...
      const ext = path.extname(name), base = name.slice(0, -ext.length);
      for (let i = 2; fs.existsSync(file) && i < 500; i++) file = path.join(p, `${base} (${i})${ext}`);
    }
    try {
      const tmp = file + ".part"; fs.writeFileSync(tmp, buf);
      try { fs.renameSync(tmp, file); } catch (err) { try { fs.unlinkSync(tmp); } catch (e2) {} throw err; }
      return { ok: true, name: path.basename(file) };
    } catch (err) { return { ok: false, error: String((err && err.code) || "write") }; }
  }));
}

// ---- "Save as…": save the ready invoices (and their POs) anywhere. The page can only write into a folder or a .zip path
// the user picked in a native dialog in this run; the names it sends must be plain file names.
function registerSaveIpc(getWin) {
  const guard = (fn) => async (e, ...a) => { if (!fromApp(e) || !unlocked) throw new Error("not allowed"); return fn(e, ...a); };
  const pickedDirs = new Set(), pickedZips = new Set();
  const okName = (n) => typeof n === "string" && n.length > 0 && n.length < 240 && n === path.basename(n) && n !== "." && n !== ".." && !/[\\/:*?"<>|\u0000-\u001f]/.test(n);
  const toBuf = (bytes) => { const b = Buffer.from(bytes || []); return b.length && b.length <= 200 * 1024 * 1024 ? b : null; };
  const writeAtomic = (file, buf) => { const tmp = file + ".part"; fs.writeFileSync(tmp, buf); try { fs.renameSync(tmp, file); } catch (err) { try { fs.unlinkSync(tmp); } catch (e2) {} throw err; } };
  ipcMain.handle("save:pickDir", guard(async (e, title) => {
    const r = await dialog.showOpenDialog(getWin() || undefined, { title: String(title || "Valkyrys app"), defaultPath: app.getPath("documents"), properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths || !r.filePaths[0] || !isDir(r.filePaths[0])) return { canceled: true };
    const dir = path.resolve(r.filePaths[0]); pickedDirs.add(dir); return { canceled: false, dir };
  }));
  ipcMain.handle("save:toDir", guard(async (e, dir, name, bytes) => {
    const d = typeof dir === "string" ? path.resolve(dir) : "";
    if (!d || !pickedDirs.has(d)) return { ok: false, error: "dir" };
    if (!isDir(d)) return { ok: false, error: "missing" };
    if (!okName(name) || !SAVE_EXT.test(name)) return { ok: false, error: "name" };
    const buf = toBuf(bytes); if (!buf) return { ok: false, error: "size" };
    const ext = path.extname(name), base = name.slice(0, -ext.length); let file = path.join(d, name);
    for (let i = 2; fs.existsSync(file) && i < 500; i++) file = path.join(d, `${base} (${i})${ext}`); // never replace a file already there
    try { writeAtomic(file, buf); return { ok: true, name: path.basename(file) }; } catch (err) { return { ok: false, error: String((err && err.code) || "write") }; }
  }));
  ipcMain.handle("save:zipDialog", guard(async (e, defaultName, title) => {
    const n = okName(defaultName) && /\.zip$/i.test(defaultName) ? defaultName : "facturen.zip";
    const r = await dialog.showSaveDialog(getWin() || undefined, { title: String(title || "Valkyrys app"), defaultPath: path.join(app.getPath("documents"), n), filters: [{ name: "ZIP", extensions: ["zip"] }], properties: ["createDirectory", "showOverwriteConfirmation"] });
    if (r.canceled || !r.filePath) return { canceled: true };
    let p = path.resolve(r.filePath); if (!/\.zip$/i.test(p)) p += ".zip";
    pickedZips.add(p); return { canceled: false, path: p };
  }));
  ipcMain.handle("save:writePath", guard(async (e, p, bytes) => {
    const f = typeof p === "string" ? path.resolve(p) : "";
    if (!f || !pickedZips.has(f) || !/\.zip$/i.test(f)) return { ok: false, error: "path" };
    if (!isDir(path.dirname(f))) return { ok: false, error: "missing" };
    const buf = toBuf(bytes); if (!buf) return { ok: false, error: "size" };
    try { writeAtomic(f, buf); pickedZips.delete(f); return { ok: true, path: f, name: path.basename(f) }; } catch (err) { return { ok: false, error: String((err && err.code) || "write") }; }
  }));
}
registerSaveIpc(() => win);

// ---- the person's own invoice designs: Word files (.docx with [placeholders]) they import, copied to <data folder>/templates/<id>.docx
const tplDir = () => path.join(app.getPath("userData"), "templates");
const tplPath = (file) => (typeof file === "string" && /^c[a-z0-9]{4,40}\.docx$/.test(file) ? path.join(tplDir(), file) : "");
function registerTplIpc(getWin) {
  const guard = (fn) => async (e, ...a) => { if (!fromApp(e) || !unlocked) throw new Error("not allowed"); return fn(e, ...a); };
  ipcMain.handle("tpl:import", guard(async (e, title) => { // asks for a Word file and keeps a copy: { id, name, file, bytes }
    const r = await dialog.showOpenDialog(getWin() || undefined, { title: title || "Valkyrys app", defaultPath: app.getPath("documents"), properties: ["openFile"], filters: [{ name: "Word", extensions: ["docx"] }] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const src = r.filePaths[0];
    let buf; try { if (fs.statSync(src).size > 30 * 1024 * 1024) return { canceled: false, error: "size" }; buf = fs.readFileSync(src); } catch (err) { return { canceled: false, error: "read" }; }
    if (!/\.docx$/i.test(src) || buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return { canceled: false, error: "format" }; // a .docx is a zip file
    const id = "c" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex"), file = id + ".docx";
    try { fs.mkdirSync(tplDir(), { recursive: true }); fs.writeFileSync(tplPath(file), buf); } catch (err) { return { canceled: false, error: "write" }; }
    return { canceled: false, id, file, name: path.basename(src).replace(/\.docx$/i, ""), bytes: buf };
  }));
  ipcMain.handle("tpl:read", guard((e, file) => { const p = tplPath(file); try { return p ? fs.readFileSync(p) : null; } catch (err) { return null; } }));
  ipcMain.handle("tpl:remove", guard((e, file) => { const p = tplPath(file); try { if (p) fs.unlinkSync(p); } catch (err) {} return true; }));
}
registerTplIpc(() => win);

const APP_PORT = 47831;
const arg = process.argv.find((a) => a.startsWith("--splash-ms="));
// --splash-ms=N: keep the splash at least N ms from start (tests). Without it the splash page decides: it says when its animation
// plus a short hold of the finished logo is done (window.splashDone, ~4.2 s); SPLASH_FALLBACK_MS is the minimum if the page can't answer.
const SPLASH_MS = arg ? Number(arg.slice(12)) : 0;
const SPLASH_FALLBACK_MS = 4200, SPLASH_FADE_MS = 550;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// fade a window's opacity (Windows/macOS; on Linux setOpacity does nothing and the window is simply there)
async function fadeOpacity(w, from, to, ms) {
  if (!w || w.isDestroyed() || typeof w.setOpacity !== "function") return;
  const steps = Math.max(1, Math.round(ms / 16)), ease = (t) => 1 - Math.pow(1 - t, 3);
  for (let i = 0; i <= steps; i++) {
    if (w.isDestroyed()) return;
    try { w.setOpacity(from + (to - from) * ease(i / steps)); } catch (e) { return; }
    if (i < steps) await sleep(ms / steps);
  }
}

function showSplash() {
  const splash = new BrowserWindow({ width: 640, height: 360, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, center: true, show: false, hasShadow: false, backgroundColor: "#00000000", title: "Valkyrys app",
    icon: path.join(__dirname, "build", "icon.png"), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  splash.once("ready-to-show", () => splash.show());
  splash.loadFile(path.join(__dirname, "splash", "splash.html"));
  return splash;
}

app.whenReady().then(() => {
  if (!gotLock) return; // a second launch only wakes the first window; it gets no splash
  Menu.setApplicationMenu(null);
  registerFolderIpc(() => win); registerPinIpc();
  const started = Date.now();
  const splash = process.argv.includes("--no-splash") ? null : showSplash();
  const server = createServer(path.join(__dirname, "web"), path.join(app.getPath("userData"), "data.json"), () => unlocked);
  // a fixed port keeps the address of the app the same from start to start, so the window remembers things like the theme and language;
  // when something else is using that port, any free port is taken instead
  const listen = (port) => new Promise((res, rej) => { server.once("error", rej); server.listen(port, "127.0.0.1", () => { server.removeListener("error", rej); res(); }); });
  listen(APP_PORT).catch(() => listen(0)).then(() => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    appOrigin = origin;
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(false));
    win = new BrowserWindow({ width: 1280, height: 900, minWidth: 420, minHeight: 600, backgroundColor: "#0e0e0f", title: "Valkyrys app", show: false,
      icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.js") } });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(origin)) e.preventDefault(); }); // a PDF dropped beside the drop zone must not open
    win.on("closed", () => { win = null; });
    // ready-to-show, or give up waiting after 20 s so the splash can never hang on screen
    const loaded = Promise.race([new Promise((res) => win.once("ready-to-show", res)), new Promise((res) => setTimeout(res, 20000))]);
    win.loadURL(origin + "/");
    // show the app once it is ready AND the logo animation has played and held a moment; then cross-fade:
    // the app fades in behind the (always-on-top) splash while the splash fades out, and the splash closes after its fade has ended
    const splashLive = () => splash && !splash.isDestroyed();
    const splashDone = !splashLive() ? Promise.resolve() : Promise.race([
      splash.webContents.executeJavaScript("window.splashDone").catch(() => sleep(Math.max(0, SPLASH_FALLBACK_MS - (Date.now() - started)))),
      sleep(12000)]);
    loaded.then(async () => {
      await splashDone;
      await sleep(Math.max(0, SPLASH_MS - (Date.now() - started)));
      if (!win) { if (splashLive()) splash.close(); return; }
      if (!splashLive()) { win.show(); win.focus(); return; }
      try { win.setOpacity(0); } catch (e) {}
      win.showInactive(); // behind the splash, so it never pops over it
      const out = Promise.race([splash.webContents.executeJavaScript("window.splashExit()").catch(() => {}), sleep(SPLASH_FADE_MS + 700)]);
      await Promise.all([out, fadeOpacity(win, 0, 1, SPLASH_FADE_MS)]);
      if (splashLive()) splash.close();
      if (win) { try { win.setOpacity(1); } catch (e) {} win.focus(); }
    });
  });
});
app.on("window-all-closed", () => app.quit());
