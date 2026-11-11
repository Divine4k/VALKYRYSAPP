// Bridge between the app page and the desktop app: the invoice folder (choose, save into it, list, open). Nothing else is exposed.
const { contextBridge, ipcRenderer } = require("electron");
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld("valkyrys", {
  // "kind" is "invoices" (default) or "pos" (purchase orders)
  getFolder: (kind) => call("folder:get", kind),
  pickFolder: (title, kind) => call("folder:pick", String(title || ""), kind),
  clearFolder: (kind) => call("folder:clear", kind),
  openFolder: (kind) => call("folder:open", kind),
  saveFile: (name, bytes, overwrite) => call("folder:save", String(name), bytes, !!overwrite),
  listFiles: (kind) => call("folder:list", kind),
  openFile: (rel, kind) => call("folder:openfile", String(rel), kind),
  readFile: (rel, kind) => call("folder:read", String(rel), kind),
  revealFile: (rel, kind) => call("folder:reveal", String(rel), kind),
  trashFile: (rel, kind) => call("folder:trash", String(rel), kind), // to the Recycle Bin
  getWelcomed: () => call("app:welcomed"),
  setWelcomed: () => call("app:welcomed-set"),
  // "Save as…": any folder / one .zip, chosen in a native dialog (main only writes where the user picked)
  pickAnyDir: (title) => call("save:pickDir", String(title || "")),
  saveToDir: (dir, name, bytes) => call("save:toDir", String(dir), String(name), bytes),
  saveAsZip: (defaultName, title) => call("save:zipDialog", String(defaultName || ""), String(title || "")),
  writePicked: (p, bytes) => call("save:writePath", String(p), bytes),
  // own invoice designs (Word files): import one (native dialog, copied into the data folder), read its file, delete it
  importTemplate: (title) => call("tpl:import", String(title || "")),
  readTemplate: (file) => call("tpl:read", String(file)),
  removeTemplate: (file) => call("tpl:remove", String(file)),
});

// The PIN lock. Not gated by the lock itself (it is what unlocks); the answer about "is a PIN set" is known before the page is drawn.
let lockState = { has: false, skipped: true, unlocked: true };
try { lockState = ipcRenderer.sendSync("pin:state-sync") || lockState; } catch (e) {}
contextBridge.exposeInMainWorld("valkyrysLock", {
  state: lockState,
  status: () => call("pin:state"),
  verify: (pin) => call("pin:verify", String(pin)),
  setup: (pin) => call("pin:setup", String(pin)),
  change: (oldPin, pin) => call("pin:change", String(oldPin), String(pin)),
  remove: (oldPin) => call("pin:remove", String(oldPin)),
  skip: () => call("pin:skip"),
});

// In-app updates (see updater.js). Undefined in a plain browser, so the Updates panel hides itself there.
contextBridge.exposeInMainWorld("valkyrysUpdate", {
  state: () => call("upd:state"),
  check: () => call("upd:check"),
  install: () => call("upd:install"),
  restart: () => { call("upd:restart").catch(() => {}); },
  onState: (cb) => {
    if (typeof cb !== "function") return () => {};
    const h = (e, st) => { try { cb(st); } catch (err) {} };
    ipcRenderer.on("upd:changed", h);
    return () => ipcRenderer.removeListener("upd:changed", h);
  },
});

// E-mail connections (Settings › Connections, see mailfetch.js): the page never gets a password back, only the accounts and how their last check went.
contextBridge.exposeInMainWorld("valkyrysMail", {
  state: () => call("mail:state"),
  add: (o) => call("mail:add", { provider: String((o && o.provider) || ""), user: String((o && o.user) || ""), pass: String((o && o.pass) || ""), host: String((o && o.host) || "") }),
  remove: (id) => call("mail:remove", String(id)),
  setEnabled: (id, on) => call("mail:enable", String(id), !!on),
  check: (id) => call("mail:check", id ? String(id) : ""),
  setMode: (m) => call("mail:mode", m === "ask" ? "ask" : "auto"),          // "auto": download right away, "ask": list them first
  download: (keys) => call("mail:download", Array.isArray(keys) ? keys.map(String) : null),
  ignore: (keys) => call("mail:ignore", Array.isArray(keys) ? keys.map(String) : null),
  seen: () => call("mail:seen"),                                             // the notice about fetched POs has been read
  notify: (title, body) => call("mail:notify", String(title || ""), String(body || "")),
  onChange: (cb) => {
    if (typeof cb !== "function") return () => {};
    const h = (e, st) => { try { cb(st); } catch (err) {} };
    ipcRenderer.on("mail:changed", h);
    return () => ipcRenderer.removeListener("mail:changed", h);
  },
});
