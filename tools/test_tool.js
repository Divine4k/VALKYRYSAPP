// Headless test of the invoice tool page with local libraries and stand-ins for db/downloads.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const [toolDir, poPath, outDir] = process.argv.slice(2);
const LOCAL = {
  pdflib: "/opt/npm-tools/node_modules/pdf-lib/dist/pdf-lib.min.js",
  jszip: "/opt/npm-tools/node_modules/jszip/dist/jszip.min.js",
  pdfjs: "/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  worker: "/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
};
// pdf.js 3 UMD is not available offline: a shim exposes the same calls on top of the local pdf.js module
const SHIM = `window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument(src) {
  const p = import('http://localhost:8765/local/pdf.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = 'http://localhost:8765/local/pdf.worker.mjs'; return m.getDocument(src).promise; });
  return { promise: p }; } };`;

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let file = p === "/" ? path.join(toolDir, "_page.html") : p.startsWith("/local/") ? (p.endsWith("worker.mjs") ? LOCAL.worker : LOCAL.pdfjs) : path.join(toolDir, p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "access-control-allow-origin": "*", "content-type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  // the published page is wrapped in a skeleton; do the same here
  fs.writeFileSync(path.join(toolDir, "_page.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${fs.readFileSync(path.join(toolDir, "index.html"), "utf8").replace("// file picking and dropping", "window.__t = { state, renumber, render };\n  // file picking and dropping")}</body></html>`);
  await new Promise((r) => server.listen(8765, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1500 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf-lib\//, (r) => r.fulfill({ path: LOCAL.pdflib, contentType: "text/javascript" }));
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jszip\//, (r) => r.fulfill({ path: LOCAL.jszip, contentType: "text/javascript" }));
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/.*pdf\.min\.js/, (r) => r.fulfill({ body: SHIM, contentType: "text/javascript" }));
  await page.route(/jsdelivr|fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());

  // stand-ins for the platform's db and downloads, seeded like the real store
  await page.addInitScript(() => {
    const store = new Map(Object.entries({
      "settings/main": { startNumber: 62, startYear: 2026, betaaltermijn: "14 dagen", btw: "verlegd",
        client: { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" } },
      "invoices/61-2026": { factuurnr: "61-2026", nummer: 61, jaar: 2026, po: "PO-008074", datum: "29/10/2026", totaal: 2250, btw: "verlegd",
        lines: [{ desc: "PO-008074", tarief: 450, aantal: 5 }] },
    }));
    const subs = [];
    const snapDoc = (p) => ({ id: p.split("/").pop(), exists: store.has(p), data: () => store.get(p) });
    const notify = () => subs.forEach((s) => s());
    const db = {
      doc: (p) => ({ set: async (d) => { store.set(p, JSON.parse(JSON.stringify(d))); notify(); }, get: async () => snapDoc(p),
        onSnapshot: (next) => { const f = () => next(snapDoc(p)); subs.push(f); setTimeout(f, 0); return () => {}; } }),
      collection: (c) => ({ onSnapshot: (next) => { const f = () => { const docs = [...store.keys()].filter((k) => k.startsWith(c + "/")).map(snapDoc); next({ docs, size: docs.length, empty: !docs.length }); }; subs.push(f); setTimeout(f, 0); return () => {}; } }),
    };
    window.__saved = [];
    const downloads = { save: async ({ filename, data }) => { const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data; window.__saved.push({ filename, b64: btoa(Array.from(buf, (x) => String.fromCharCode(x)).join("")) }); return { status: "saved" }; } };
    window.claude = { use: async (n) => (n === "db" ? db : n === "downloads" ? downloads : null) };
  });

  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(800); await page.click("#tabInv");
  console.log("next number shown:", await page.textContent("#nextNr"));

  // one PO
  await page.setInputFiles("#file", poPath);
  await page.waitForSelector("article.po h3", { timeout: 15000 });
  const firstText = await page.textContent("article.po");
  if (!(await page.$("article.po .meta"))) { console.log("ERROR CARD:", firstText.replace(/\s+/g, " "), "| page errors:", errors); await page.evaluate(async () => { try { const r = await fetch('/local/pdf.mjs'); console.log('mjs status', r.status); } catch (e) { console.log('fetch fail', e.message); } }); }
  const card = await page.evaluate(() => {
    const a = document.querySelector("article.po");
    return { po: a.querySelector("h3").textContent, meta: a.querySelector(".meta").textContent, days: a.querySelector(".days").textContent,
      nr: a.querySelector('[data-k="nr"]').value, aantal: a.querySelector('[data-k="aantal"]').value, tarief: a.querySelector('[data-k="tarief"]').value,
      total: a.querySelector("[data-total]").textContent, checks: [...a.querySelectorAll(".chip")].map((c) => c.className + ": " + c.textContent) };
  });
  console.log("card:", JSON.stringify(card, null, 1));
  await page.screenshot({ path: path.join(outDir, "tool-card.png") });

  await page.click('article.po button[data-act="download"]');
  await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 15000 });
  const saved = await page.evaluate(() => window.__saved[0]);
  fs.writeFileSync(path.join(outDir, saved.filename), Buffer.from(saved.b64, "base64"));
  console.log("saved file:", saved.filename);
  await page.click('article.po button[data-act="download-docx"]');
  await page.waitForTimeout(3000); console.log("DBG", await page.evaluate(() => ({ docx: typeof window.docx, idocx: typeof window.InvoiceDocx, toast: (document.querySelector(".toast,#toast")||{}).textContent, saved: window.__saved.length }))); console.log(errors);
  console.log("TRY", await page.evaluate(async () => { try { const f = async (u)=>new Uint8Array(await (await fetch(u)).arrayBuffer()); const r = await window.InvoiceDocx.buildDocx(window.docx, { logo: await f("img/logo-white.png"), logoW: 1365, logoH: 318, accent: await f("img/accent.png"), background: await f("img/background.png") }, { factuurnr:"1", datum:"x", betaaltermijn:"14 dagen", btw:"verlegd", sender: InvoiceCore.SENDER, lines:[{desc:"a",tarief:1,aantal:1}], client:{name:"x"} }, InvoiceCore); return "ok " + (r.length||r.size); } catch (e) { return e.message + " | " + (e.stack||"").slice(0,300); } }));
  await page.waitForFunction(() => window.__saved.length === 2, null, { timeout: 20000 });
  const sw = await page.evaluate(() => window.__saved[1]);
  fs.writeFileSync(path.join(outDir, sw.filename), Buffer.from(sw.b64, "base64"));
  console.log("saved word file:", sw.filename);
  await page.waitForTimeout(300);
  console.log("after download, next number:", await page.textContent("#nextNr"), "| history:", await page.evaluate(() => [...document.querySelectorAll("#hist .t")].map((e) => e.textContent).join(", ")));

  // the same PO again: should warn it was already invoiced and get the next number
  await page.setInputFiles("#file", poPath);
  await page.waitForFunction(() => document.querySelectorAll("article.po").length === 2, null, { timeout: 15000 });
  const second = await page.evaluate(() => { const a = document.querySelectorAll("article.po")[1]; return { nr: a.querySelector('[data-k="nr"]').value, checks: [...a.querySelectorAll(".chip")].map((c) => c.textContent) }; });
  console.log("second card:", JSON.stringify(second));
  await page.screenshot({ path: path.join(outDir, "tool-two.png"), fullPage: true });
  // ordering by PO date + settings renumber
  await page.setInputFiles("#file", poPath);
  await page.waitForFunction(() => document.querySelectorAll("article.po").length === 3, null, { timeout: 15000 });
  const ord = await page.evaluate(() => {
    const { state, renumber, render } = window.__t;
    const [a, b, c] = state.cards; a.dates = ["15-01-2026"]; a.po = "A"; b.dates = ["01-01-2026"]; b.po = "B"; c.dates = ["10-01-2026"]; c.po = "C";
    renumber(); render();
    const show = () => state.cards.map((x) => x.po + ":" + x.nummer + "-" + x.jaar).join(" ");
    const r1 = show();
    document.querySelector("#sStart").value = "70"; document.querySelector("#settings").requestSubmit();
    return { r1, afterSettings: null };
  });
  await page.waitForTimeout(300);
  ord.afterSettings = await page.evaluate(() => window.__t.state.cards.filter(x=>!x.done).map((x) => x.po + ":" + x.nummer).join(" "));
  console.log("order test:", JSON.stringify(ord));
  await page.click('#hist button[data-del]'); await page.click('#hist button[data-del]'); await page.waitForTimeout(300);
  console.log("history after delete:", await page.evaluate(() => [...document.querySelectorAll("#hist .t")].map((e) => e.textContent).join(", ")));
  // language switch
  for (const lg of ["en", "pl", "nl"]) {
    await page.evaluate((v) => { const s = document.querySelector("#lang"); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, lg); await page.waitForTimeout(200);
    console.log("lang", lg, "|", await page.evaluate(() => [document.querySelector("h1").textContent, document.querySelector("#pick").textContent, document.querySelector("article.po .days").textContent, [...document.querySelectorAll("article.po .chip")].map(c=>c.textContent).join(" / "), document.querySelector('article.po [data-act="download"]').textContent, document.querySelector("#settingsBox .eyebrow").textContent].join(" | ")));
    if (lg === "pl") await page.screenshot({ path: path.join(outDir, "tool-pl.png"), fullPage: true });
  }
  await page.click("#tabSettings");
  await page.fill("#sFile", "Test {nummer} {po}/{datum}?"); console.log("hint:", await page.textContent("#sFileHint"));
  await page.fill("#sFile", "VALKYRYS {nummer}"); await page.evaluate(() => document.querySelector("#settings").requestSubmit()); await page.waitForTimeout(300); await page.click("#tabInv");
  const before = await page.evaluate(() => window.__saved.length);
  await page.click('article.po [data-act="download"]'); await page.waitForFunction((n) => window.__saved.length > n, before, { timeout: 15000 });
  console.log("file names:", await page.evaluate(() => window.__saved.map((x) => x.filename).join(" | ")));
  const phone = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await phone.route(/./, (r) => r.request().url().startsWith("http://localhost") ? r.continue() : r.abort());
  await phone.goto("http://localhost:8765/");
  await phone.waitForTimeout(600);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log("phone horizontal overflow px:", overflow);
  console.log("errors:", errors.length ? errors : "none");
  await browser.close(); server.close();
  fs.unlinkSync(path.join(toolDir, "_page.html"));
})().catch((e) => { console.error(e); process.exit(1); });
