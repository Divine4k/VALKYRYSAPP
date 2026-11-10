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
});
