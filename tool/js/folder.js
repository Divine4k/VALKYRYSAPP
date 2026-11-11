// The invoice folder (desktop app): listing it and reading the invoices in it for the statistics.
"use strict";
// ------------------------------------------------------------ invoice folder (desktop app only)
const NUM_IN_NAME = /(?<![\d-])(\d{1,4})-(20\d{2})(?![\d-])/; // 62-2026, but not the 01-2026 inside 15-01-2026
const fmtDate = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
async function refreshFolder() {
  if (!desk) return;
  let folder = null, files = [];
  try { folder = await desk.getFolder(); if (folder && folder.exists) files = await desk.listFiles(); } catch (e) { folder = null; files = []; }
  if (!Array.isArray(files)) { folder = Object.assign({}, folder, { exists: false }); files = []; } // read only in part (drive pulled out): as if not there
  const sig = JSON.stringify([folder, files.map((f) => [f.rel, f.mtime, f.size])]);
  if (sig === state.folderSig) return;
  state.folderSig = sig; state.folder = folder; state.files = files;
  rebuildFileNums();
  renumber(); render();
  scanFolder();
}
/** invoice numbers already in the folder: from the file names, and from what the invoices themselves say */
function rebuildFileNums() {
  const m = new Map();
  const add = (y, n, name) => { if (!m.has(y)) m.set(y, new Map()); if (!m.get(y).has(n)) m.get(y).set(n, name); };
  for (const f of state.files) { const x = NUM_IN_NAME.exec(f.name.replace(/\.[^.]+$/, "")); if (x) add(+x[2], +x[1], f.name); }
  for (const f of state.files) {
    const e = state.parseCache.get(f.rel);
    if (e && e.mt === f.mtime && e.sz === f.size && isInvoiceRec(e.r) && e.r.nr) { const x = /^(\d+)-(\d{4})$/.exec(e.r.nr); if (x) add(+x[2], +x[1], f.name); }
  }
  state.fileNums = m;
}

// ---- reading the finished invoices in the folder (for the statistics)
const PARSER_VERSION = 3; // 2: PO lines keep their work dates and unit; 3: invoice days count hours as 1/8 day
const isInvoiceRec = (r) => !!(r && r.total != null && !isNaN(r.total));
const unxml = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const docxLines = (xml) => xml.split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unxml(m[1])).join("")).filter(Boolean);
async function pdfLines(bytes, maxPages) {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise; let lines = [];
  for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) lines = lines.concat(core.linesFromTextItems((await (await pdf.getPage(p)).getTextContent()).items));
  return lines;
}
async function readInvoiceFile(f) {
  const raw = await desk.readFile(f.rel); if (!raw) return null;
  const bytes = new Uint8Array(raw);
  let lines = [];
  if (f.ext === "pdf") lines = await pdfLines(bytes, 3);
  else {
    const zip = await JSZip.loadAsync(bytes); const entry = zip.file("word/document.xml");
    if (!entry) return null;
    lines = docxLines(await entry.async("string"));
  }
  return core.parseInvoiceText(lines, TP.owners(currentSender()));
}
const tick = () => new Promise((r) => setTimeout(r, 0));
let scanSeq = 0;
async function scanFolder() {
  const id = ++scanSeq;
  if (!desk || !state.folder || !state.folder.exists) { state.folderInvoices = []; state.unread = []; state.scan = null; state.folderScanned = true; if (state.tab === "stats") renderStats(); renderNewPos(); return; }
  await state.dbReady;
  if (id !== scanSeq) return;
  const files = state.files.filter((f) => f.ext === "pdf" || f.ext === "docx");
  const order = [...files.filter((f) => f.ext === "pdf"), ...files.filter((f) => f.ext === "docx")];
  const okBase = new Set(), recs = [], unread = []; let changed = false, done = 0;
  state.scan = { done: 0, total: order.length };
  for (const f of order) {
    if (id !== scanSeq) return;
    const base = f.rel.replace(/\.(pdf|docx)$/i, "");
    if (f.ext === "docx" && okBase.has(base)) { done++; continue; } // the PDF next to it already told us everything
    let e = state.parseCache.get(f.rel);
    if (!e || e.mt !== f.mtime || e.sz !== f.size) {
      let r = null; try { r = await readInvoiceFile(f); } catch (err) { r = null; }
      e = { mt: f.mtime, sz: f.size, r }; state.parseCache.set(f.rel, e); changed = true;
    }
    const nm = NUM_IN_NAME.exec(f.name.replace(/\.[^.]+$/, ""));
    const nr = (e.r && e.r.nr) || (nm ? `${+nm[1]}-${nm[2]}` : "");
    if (isInvoiceRec(e.r) && nr) { okBase.add(base); recs.push({ f, r: e.r, nr }); } else unread.push(f.rel);
    if (++done % 4 === 0) { state.scan = { done, total: order.length }; if (state.tab === "stats") renderStats(); await tick(); }
  }
  if (id !== scanSeq) return;
  // one invoice per number (a PDF and a copy of it count once)
  const byNr = new Map();
  for (const x of recs) { const old = byNr.get(x.nr); if (!old || (x.f.ext === "pdf" && old.f.ext !== "pdf") || (x.f.ext === old.f.ext && x.f.mtime > old.f.mtime)) byNr.set(x.nr, x); }
  state.folderInvoices = [...byNr.values()].map(({ f, r, nr }) => {
    const [n, y] = nr.split("-").map(Number); const d = new Date(f.mtime);
    return { factuurnr: nr, nummer: n, jaar: y, po: r.po || "", datum: r.datum || `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`, dateGuess: !r.datum,
      client: { name: r.client || (r.kvk ? "KVK " + r.kvk : "") }, btw: r.btw || "verlegd", amounts: { sub: r.sub, vat: r.vat, total: r.total, days: r.days || 0, hours: r.hourLines || 0 }, source: "folder", file: f.rel };
  });
  state.unread = unread; state.scan = null;
  // forget files that are gone, remember the rest
  const here = new Set(state.files.map((f) => f.rel));
  for (const k of [...state.parseCache.keys()]) if (!here.has(k)) { state.parseCache.delete(k); changed = true; }
  if (changed && state.db) { try { await state.db.doc("cache/folderindex").set({ v: PARSER_VERSION, files: Object.fromEntries(state.parseCache) }); } catch (err) {} }
  state.folderScanned = true;
  rebuildFileNums(); renumber(); render();
}
function renderFolder() {
  if (!desk) { $("#setFolders").hidden = true; return; }
  $("#setFolders").hidden = false;
  const f = state.folder, pick = $("#folderPick");
  const pk = f ? "folderChange" : "folderPick"; pick.dataset.i18n = pk; pick.textContent = tr(pk); pick.classList.toggle("primary", !f);
  const pathEl = $("#folderPath"); pathEl.hidden = !f;
  if (f) { pathEl.textContent = f.path; pathEl.title = f.path; pathEl.classList.toggle("bad", !f.exists); }
  $("#folderOpen").hidden = !(f && f.exists); $("#folderClear").hidden = !f;
} // what is in the folder is shown on the Documents tab (renderDocs)
if (desk) {
  $("#folderPick").addEventListener("click", async () => {
    try { const r = await desk.pickFolder(tr("folderDialog")); if (r && !r.canceled) { await refreshFolder(); toast(tr("folderSet")); } } catch (e) {}
  });
  $("#folderClear").addEventListener("click", async () => { try { await desk.clearFolder(); await refreshFolder(); toast(tr("folderCleared")); } catch (e) {} });
  $("#folderOpen").addEventListener("click", () => { desk.openFolder().catch(() => {}); });
  // refreshFolder() is started in js/init.js (once every file is loaded)
}

