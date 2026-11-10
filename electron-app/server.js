// Local data + file server used by the app window (no internet needed, nothing leaves this computer).
const http = require("http"), fs = require("fs"), path = require("path");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".map": "application/json" };

const DEFAULT_SETTINGS = { startNumber: 62, startYear: 2026, betaaltermijn: "14 dagen", btw: "verlegd", fileTemplate: "VALKYRYS {nummer}",
  client: { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" } };

function createServer(webDir, dataFile, isUnlocked = () => true) {
  let docs = {}, existed = false;
  try { docs = JSON.parse(fs.readFileSync(dataFile, "utf8")); existed = true; } catch (e) { docs = { "settings/main": DEFAULT_SETTINGS }; }

  function save() {
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      if (fs.existsSync(dataFile)) fs.copyFileSync(dataFile, dataFile + ".bak");
      fs.writeFileSync(dataFile + ".tmp", JSON.stringify(docs, null, 2));
      fs.renameSync(dataFile + ".tmp", dataFile);
    } catch (e) { console.error("save failed", e); }
  }

  // data from before the invoice designs existed: those invoices use the Valkyrys design (a fresh install has no template yet, so the app asks)
  if (existed && docs && typeof docs === "object" && !(docs["settings/main"] && docs["settings/main"].template)) { docs["settings/main"] = { ...(docs["settings/main"] || {}), template: "valkyrys" }; save(); }

  const server = http.createServer((req, res) => {
    // only requests addressed to this exact address are answered (blocks other web pages from reaching the app through a changed host name)
    const addr = server.address(), host = String(req.headers.host || "").toLowerCase();
    if (addr && host !== `127.0.0.1:${addr.port}` && host !== `localhost:${addr.port}`) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      if (url.pathname === "/api/ping") { res.writeHead(204); return res.end(); }
      if (!isUnlocked()) { res.writeHead(401); return res.end(); } // a PIN is set and has not been entered yet: no saved data
      if (url.pathname === "/api/db") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(docs)); }
      if (url.pathname === "/api/doc") {
        const p = url.searchParams.get("path");
        if (!p) { res.writeHead(400); return res.end("path required"); }
        if (req.method === "DELETE") { delete docs[p]; save(); res.writeHead(204); return res.end(); }
        if (req.method === "PUT") {
          const chunks = []; let size = 0;
          req.on("data", (c) => { size += c.length; if (size > 5e6) req.destroy(); else chunks.push(c); });
          req.on("end", () => { try { docs[p] = JSON.parse(Buffer.concat(chunks).toString("utf8")); save(); res.writeHead(204); } catch (e) { res.writeHead(400); } res.end(); });
          return;
        }
      }
      res.writeHead(404); return res.end();
    }
    // static files from the web folder
    let rel = decodeURIComponent(url.pathname); if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(webDir, rel));
    if (!file.startsWith(path.normalize(webDir + path.sep))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return server;
}
module.exports = { createServer, DEFAULT_SETTINGS };
