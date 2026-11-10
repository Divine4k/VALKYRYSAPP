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
  getWelcomed: () => call("app:welcomed"),
  setWelcomed: () => call("app:welcomed-set"),
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
