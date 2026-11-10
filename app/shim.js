/* Local stand-ins for what the Claude page provides: saved data (db), file downloads, and the PDF reader. */
(function () {
  "use strict";
  // --- PDF reader: pdf.js is an ES module, expose the old global API on top of it
  window.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument(src) {
      const p = import("/vendor/pdf.min.mjs").then((m) => { m.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs"; return m.getDocument(src).promise; });
      return { promise: p };
    },
  };

  // --- keep the server alive while the window is open
  const ping = () => fetch("/api/ping", { cache: "no-store" }).catch(() => {});
  ping(); setInterval(ping, 4000);

  // --- saved data: a file on this computer, reached through the local server
  let cache = null; const listeners = [];
  const load = async () => {
    for (let i = 0; !cache; i++) {
      try { const r = await fetch("/api/db", { cache: "no-store" }); if (r.status === 401 && i < 7200) { await new Promise((ok) => setTimeout(ok, 500)); continue; } cache = await r.json(); } catch (e) { cache = {}; }
    }
    return cache;
  };
  const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const snapDoc = (path) => ({ id: path.split("/").pop(), exists: path in cache, data: () => structuredClone(parse(cache[path])) });
  const notify = () => listeners.forEach((l) => l());
  const db = {
    doc(path) {
      return {
        async set(obj) { cache[path] = structuredClone(obj); notify(); await fetch("/api/doc?path=" + encodeURIComponent(path), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(obj) }); },
        async delete() { delete cache[path]; notify(); await fetch("/api/doc?path=" + encodeURIComponent(path), { method: "DELETE" }); },
        async get() { return snapDoc(path); },
        onSnapshot(cb) { const f = () => cb(snapDoc(path)); listeners.push(f); setTimeout(f, 0); return () => listeners.splice(listeners.indexOf(f), 1); },
      };
    },
    collection(name) {
      const list = () => Object.keys(cache).filter((k) => k.startsWith(name + "/") && !k.slice(name.length + 1).includes("/")).map(snapDoc);
      return { onSnapshot(cb) { const f = () => cb({ docs: list() }); listeners.push(f); setTimeout(f, 0); return () => listeners.splice(listeners.indexOf(f), 1); } };
    },
  };

  // --- downloads: the browser's normal file download
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = filename; a.style.display = "none";
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      return { status: "saved" };
    },
  };

  window.claude = { use: async (name) => { if (name === "db") { await load(); return db; } if (name === "downloads") return downloads; return null; } };
})();
