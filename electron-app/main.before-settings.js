// Valkyrys Facturen: desktop app (Electron). Shows the invoice tool in its own window; data is kept in a file on this computer.
const { app, BrowserWindow, Menu, session, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createServer } = require("./server");

app.setName("Valkyrys Facturen");
app.setAppUserModelId("nl.valkyrys.facturen");
app.setPath("userData", path.join(app.getPath("appData"), "Valkyrys Facturen"));

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
    const r = await dialog.showOpenDialog(getWin() || undefined, { title: title || "Valkyrys Facturen", defaultPath: cur && isDir(cur) ? cur : app.getPath("documents"), properties: ["openDirectory", "createDirectory"] });
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

const APP_PORT = 47831;
const arg = process.argv.find((a) => a.startsWith("--splash-ms="));
const SPLASH_MS = arg ? Number(arg.slice(12)) : 3500; // how long the logo animation plays at least

function showSplash() {
  const splash = new BrowserWindow({ width: 640, height: 360, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, center: true, show: false, hasShadow: false, backgroundColor: "#00000000", title: "Valkyrys Facturen",
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
    win = new BrowserWindow({ width: 1280, height: 900, minWidth: 420, minHeight: 600, backgroundColor: "#0e0e0f", title: "Valkyrys Facturen", show: false,
      icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.js") } });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(origin)) e.preventDefault(); }); // a PDF dropped beside the drop zone must not open
    win.on("closed", () => { win = null; });
    // ready-to-show, or give up waiting after 20 s so the splash can never hang on screen
    const loaded = Promise.race([new Promise((res) => win.once("ready-to-show", res)), new Promise((res) => setTimeout(res, 20000))]);
    win.loadURL(origin + "/");
    // show the app once it is ready AND the logo animation has played; then fade the splash out
    loaded.then(async () => {
      const wait = Math.max(0, SPLASH_MS - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      if (!win) return;
      win.show(); win.focus();
      if (splash && !splash.isDestroyed()) {
        try { await splash.webContents.executeJavaScript("document.body.classList.add('exit')"); } catch (e) {}
        setTimeout(() => { if (!splash.isDestroyed()) splash.close(); }, 420);
      }
    });
  });
});
app.on("window-all-closed", () => app.quit());
