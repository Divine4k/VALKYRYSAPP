// Numbering, reading dropped POs, building/saving invoices (PDF/Word, Save as...), the invoice cards (render), toast/busy.
"use strict";
// ------------------------------------------------------------ numbering
const logged = (year) => [...state.invoices.values()].filter((i) => i.jaar === year);
const inFolder = (year) => [...(state.fileNums.get(year) || new Map()).keys()];
function nextNumber(year, exceptCard) {
  const used = new Set([...logged(year).map((i) => i.nummer), ...inFolder(year)]);
  state.cards.forEach((c) => { if (c !== exceptCard && c.jaar === year && !c.error) used.add(c.nummer); });
  let n = state.settings.startYear === year ? state.settings.startNumber : 1;
  n = Math.max(n, ...logged(year).map((i) => i.nummer + 1), ...inFolder(year).map((x) => x + 1), 1);
  while (used.has(n)) n++;
  return n;
}
const nr = (c) => `${c.nummer}-${c.jaar}`;
// oldest PO first: by the first work day on the PO, else the order date
const dkey = (d) => (d ? d.split("-").reverse().join("") : "");
const sortKey = (c) => { const p = c.parsed || {}; const d = (c.dates && c.dates[0]) || p.orderDate; return dkey(d) || "99999999"; };
const byDate = (a, b) => sortKey(a).localeCompare(sortKey(b)) || String(a.po).localeCompare(String(b.po), "nl", { numeric: true }) || a.id.localeCompare(b.id);
/** (re)number all invoices that are not downloaded or hand-numbered yet: oldest PO gets the lowest number */
function renumber() {
  // a card that is being saved keeps its number: saving a file re-reads the folder, which calls this mid-save
  const auto = state.cards.filter((c) => !c.error && !c.done && !c.manual && !c.saving).sort(byDate);
  auto.forEach((c) => { c.nummer = 0; });
  for (const c of auto) c.nummer = nextNumber(c.jaar, c);
  state.cards.sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0) || byDate(a, b));
}

// ------------------------------------------------------------ reading POs
async function readPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    lines = lines.concat(core.linesFromTextItems(tc.items));
  }
  return core.parsePO(lines);
}

async function addFiles(files) {
  if (!libsOk) return;
  const list = [...files];
  for (const f of list) {
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { toast(tr("notPdf", f.name)); continue; }
    const card = { id: "c" + (++state.seq), fileName: f.name };
    try { card.poBytes = new Uint8Array(await f.arrayBuffer()); } catch (e) {} // the original PO, for "Save as…" (own copy: pdf.js may take over its buffer)
    try {
      const parsed = await readPdf(f);
      const year = new Date().getFullYear();
      Object.assign(card, {
        parsed, po: parsed.po || "", dates: core.poDates(parsed), checks: core.checkPO(parsed),
        lines: core.invoiceLinesFromPO(parsed), dateISO: isoToday(), jaar: year, btw: state.settings.btw, done: false, clientId: CL.active,
      });
      if (!parsed.items.length) card.error = "noItems";
      card.nummer = 0;
    } catch (e) {
      console.error("PO lezen mislukt:", e);
      card.error = "unreadable";
    }
    state.cards.push(card);
  }
  renumber();
  render();
}

// ------------------------------------------------------------ invoices
function invoiceData(c) {
  const cc = cardClient(c);
  return { factuurnr: nr(c), datum: isoToNl(c.dateISO), betaaltermijn: cc.betaaltermijn,
    client: { ...cc.client }, lines: c.lines.map((l) => ({ desc: l.desc, tarief: +l.tarief || 0, aantal: +l.aantal || 0 })),
    btw: c.btw, template: currentTemplate(), sender: TP.forRender(currentSender()) };
}
/** the design and details a saved invoice was made with (invoices from before the designs existed are in the first design) */
function recordLook(rec) { const id = TP.get(rec && rec.template).id; return { template: id, sender: TP.forRender(TP.senderFor(id, rec && rec.sender)) }; }
async function buildPdf(data) { const assets = await loadAssets(); await customReady(data.template); return TP.renderPdf(PDFLib, assets, data, core); }
async function buildWord(data) {
  const assets = await loadAssets(); await customReady(data.template);
  if (!window.docx || !window.InvoiceDocx) throw new Error("docx");
  return TP.buildWord({ docx: window.docx, InvoiceDocx: window.InvoiceDocx, JSZip: window.JSZip }, assets, data, core);
}
const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const build = (fmt, data) => (fmt === "docx" ? buildWord(data) : buildPdf(data));
const fileName = (data, po, fmt = "pdf") => {
  const tpl = (state.settings.fileTemplate || "").trim() || DEFAULTS.fileTemplate;
  const vals = { nummer: data.factuurnr, po: po || "", datum: String(data.datum || "").replace(/\//g, "-"), klant: (data.client && data.client.name) || "" };
  let base = tpl.replace(/\{(\w+)\}/gi, (m, k) => (vals[k.toLowerCase()] ?? m)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (!base) base = "Factuur " + data.factuurnr;
  return `${base}.${fmt}`;
};

const rawDesk = window.valkyrys || null; // only exists in the desktop app
const unlockGate = window.__valkUnlock || Promise.resolve();
const desk = rawDesk && Object.fromEntries(Object.entries(rawDesk).map(([k, f]) => [k, (...a) => unlockGate.then(() => f(...a))])); // folder access waits for the PIN
const folderSet = () => !!(desk && state.folder);
async function saveToFolder(filename, data) {
  try {
    const bytes = new Uint8Array(await data.arrayBuffer());
    // a name with the invoice number in it is unique, so saving the same invoice again simply replaces the file; otherwise never overwrite
    const unique = /\{nummer\}/i.test((state.settings.fileTemplate || DEFAULTS.fileTemplate));
    const r = await desk.saveFile(filename, bytes, unique);
    if (r && r.ok) { state.savedTo = r.name; refreshFolder(); return true; }
    toast(r && r.error === "missing" ? tr("folderMissing") : tr("folderWriteFail"));
  } catch (e) { toast(tr("folderWriteFail")); }
  return false;
}
const doneToast = (what) => (state.savedTo ? tr("savedIn", what) : tr("downloaded", what));
async function save(filename, data, opts) {
  state.savedTo = "";
  if (folderSet() && !(opts && opts.plain)) return saveToFolder(filename, data);
  if (!state.dl) { toast(tr("dlOnlyClaude")); return false; }
  try { await state.dl.save({ filename, data }); return true; }
  catch (e) {
    const code = e && e.code;
    if (code === "declined") toast(tr("declined"));
    else if (code === "rate_limited") toast(tr("rate"));
    else toast(tr("dlFail") + (e && e.message ? ": " + e.message : "."));
    return false;
  }
}

/** number and year as written on the invoice ("62-2026"); the card's own fields as a fallback */
const nrOf = (factuurnr, c) => { const m = /^(\d+)-(\d{4})$/.exec(String(factuurnr || "")); return m ? [+m[1], +m[2]] : [c.nummer, c.jaar]; };
/** what was saved for an invoice number, added to what the record already had: formats ("pdf", "docx") and the file names written into the invoice folder */
function mergeSaved(doc, prev, fmts, names) {
  const kinds = new Set(Array.isArray(prev && prev.formats) ? prev.formats : []), files = new Set(Array.isArray(prev && prev.savedFiles) ? prev.savedFiles : []);
  (fmts || []).forEach((f) => kinds.add(f)); (names || []).forEach((n) => n && files.add(n));
  if (kinds.size) doc.formats = [...kinds]; if (files.size) doc.savedFiles = [...files];
  return doc;
}
/** fmts: the formats just saved; names: the files just written into the invoice folder (none for downloads or "Save as…") */
async function logInvoice(c, data, fmts, names) {
  const [nummer, jaar] = nrOf(data.factuurnr, c);
  c.nummer = nummer; c.jaar = jaar; c.done = true; c.saving = false;
  const t = core.totals(data.lines, data.btw);
  const doc = { factuurnr: data.factuurnr, nummer, jaar, po: c.po, datum: data.datum, betaaltermijn: data.betaaltermijn,
    client: data.client, lines: data.lines, btw: data.btw, totaal: t.total, dagen: c.dates || [], createdAt: new Date().toISOString(),
    template: data.template, sender: Object.fromEntries(TP.FIELDS.map((k) => [k, (data.sender && data.sender[k]) || ""])) };
  // the formats and files saved for this number over time, so the app can tell later when a file was deleted from the folder
  mergeSaved(doc, state.invoices.get(doc.factuurnr), fmts, names);
  state.invoices.set(doc.factuurnr, doc);
  if (state.db) { try { await state.db.doc("invoices/" + doc.factuurnr).set(doc); } catch (e) { toast(tr("notLogged")); } }
}

/** the number of another invoice that already names the card's PO (same matching as the new-orders list), or "" */
function poInvoicedAs(c) {
  const po = c && c.po, own = nr(c); if (!po) return "";
  for (const i of state.invoices.values()) if (i.factuurnr !== own && poMentioned(i.po, po)) return i.factuurnr;
  for (const i of state.folderInvoices || []) if (i.factuurnr && i.factuurnr !== own && poMentioned(i.po, po)) return i.factuurnr;
  for (const f of (desk && state.folder ? state.files : []) || []) {
    const m = NUM_IN_NAME.exec(f.name.replace(/\.[^.]+$/, "")), n = m ? `${+m[1]}-${m[2]}` : "";
    if (n && n !== own && poMentioned(f.name, po)) return n;
  }
  return "";
}
let poDupAsk = null;
const poDupAnswer = (v) => { const r = poDupAsk; poDupAsk = null; if ($("#poDupDlg").open) $("#poDupDlg").close(); if (r) r(v); };
/** before saving: cards whose PO another invoice already has. Resolves to the cards to save ([] = cancelled) */
async function confirmPoDupes(cards) {
  const dups = cards.filter((c) => !c.done).map((c) => [c, poInvoicedAs(c)]).filter((x) => x[1]); // a saved card is saved again under its own number: asked before already
  if (!dups.length) return cards;
  $("#poDupText").textContent = dups.length === 1 ? tr("poDupOne", dups[0][0].po, dups[0][1]) : tr("poDupMany");
  const list = $("#poDupList"); list.hidden = dups.length < 2 && cards.length < 2;
  list.innerHTML = dups.map(([c, n]) => `<li>${esc(tr("poDupItem", c.po, n))}</li>`).join("");
  $("#poDupSkip").hidden = dups.length === cards.length; // skipping would leave nothing to save
  const dlg = $("#poDupDlg"); if (!dlg.open) dlg.showModal(); $("#poDupCancel").focus();
  const ans = await new Promise((res) => { poDupAsk = res; });
  if (ans === "go") return cards;
  if (ans === "skip") { const skip = new Set(dups.map((x) => x[0])); return cards.filter((c) => !skip.has(c)); }
  return [];
}
$("#poDupGo").addEventListener("click", () => poDupAnswer("go"));
$("#poDupSkip").addEventListener("click", () => poDupAnswer("skip"));
$("#poDupCancel").addEventListener("click", () => poDupAnswer(null));
$("#poDupClose").addEventListener("click", () => poDupAnswer(null));
$("#poDupDlg").addEventListener("close", () => poDupAnswer(null));

/** fmt: "pdf", "docx" or "both" (the PDF and the Word file, logged once) */
async function downloadCard(c, btn, fmt = "pdf") {
  if (!detailsOk()) return needDetails();
  if (!(await confirmPoDupes([c])).length) return;
  const data = invoiceData(c), fmts = fmt === "both" ? ["pdf", "docx"] : [fmt], done = [], names = [];
  busy(btn, true); c.saving = true;
  let failed = false;
  for (const f of fmts) {
    try {
      const bytes = await build(f, data);
      if (!(await save(fileName(data, c.po, f), new Blob([bytes], { type: MIME[f] })))) break;
      done.push(f); if (state.savedTo) names.push(state.savedTo);
    } catch (e) { failed = true; break; }
  }
  if (done.length) { await logInvoice(c, data, done, names); toast(tr(names.length ? "savedIn" : "downloaded", data.factuurnr)); }
  if (failed) toast(tr("buildFail"));
  c.saving = false; renumber();
  busy(btn, false); render();
}

async function downloadAll(btn) {
  let ready = state.cards.filter((c) => !c.error);
  if (!ready.length) return;
  if (!detailsOk()) return needDetails();
  ready = await confirmPoDupes(ready); if (!ready.length) return;
  busy(btn, true);
  if (folderSet()) { // straight into the folder: one PDF and one Word file per invoice, no zip
    try {
      let n = 0;
      ready.forEach((c) => { c.saving = true; }); // fix every number before the first file is written
      try {
        for (const c of ready) {
          const data = invoiceData(c), fmts = [], names = [];
          state.savedTo = "";
          if (!(await saveToFolder(fileName(data, c.po), new Blob([await buildPdf(data)], { type: MIME.pdf })))) break;
          fmts.push("pdf"); names.push(state.savedTo); state.savedTo = "";
          try { if (await saveToFolder(fileName(data, c.po, "docx"), new Blob([await buildWord(data)], { type: MIME.docx }))) { fmts.push("docx"); names.push(state.savedTo); } } catch (e) {}
          await logInvoice(c, data, fmts, names); n++;
        }
      } finally { ready.forEach((c) => { c.saving = false; }); renumber(); }
      if (n) toast(n === 1 ? tr("savedIn", nr(ready[0])) : tr("savedMany", n));
    } catch (e) { toast(tr("buildFailMany")); }
    busy(btn, false); render(); return;
  }
  try {
    const zip = new JSZip(); const made = [];
    for (const c of ready) { const data = invoiceData(c), fmts = ["pdf"]; zip.file(fileName(data, c.po), await buildPdf(data)); try { zip.file(fileName(data, c.po, "docx"), await buildWord(data)); fmts.push("docx"); } catch (e) {} made.push([c, data, fmts]); }
    const blob = await zip.generateAsync({ type: "blob" });
    const d = new Date();
    if (await save(`Facturen ${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}.zip`, blob)) {
      for (const [c, data, fmts] of made) await logInvoice(c, data, fmts, []);
      toast(made.length === 1 ? tr("downloadedOne") : tr("downloadedMany", made.length));
    }
  } catch (e) { toast(tr("buildFailMany")); }
  busy(btn, false); render();
}

// ---- "Save as…": the ready invoices (and the POs they came from) to any folder, or as one .zip with chosen contents
const readyCards = () => state.cards.filter((c) => !c.error);
/** e.g. "62-68-2026" (one year), "62-2026" (one invoice), "62-2026-3-2027" (two years) */
function rangeLabel(cards) {
  const s = [...cards].sort((a, b) => a.jaar - b.jaar || a.nummer - b.nummer), f = s[0], l = s[s.length - 1];
  if (!f) return "";
  if (f === l || nr(f) === nr(l)) return nr(f);
  return f.jaar === l.jaar ? `${f.nummer}-${l.nummer}-${f.jaar}` : `${nr(f)}-${nr(l)}`;
}
const zipName = (cards) => tr("saveAsZipName", rangeLabel(cards));
const poFileName = (c) => { let n = String(c.fileName || (c.po || "PO") + ".pdf").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim() || "PO.pdf"; if (!/\.pdf$/i.test(n)) n += ".pdf"; return n; };
function saveDlgSync() {
  const ready = readyCards(), withPo = ready.filter((c) => c.poBytes && c.poBytes.length).length;
  const po = $("#saveInPo"), any = $("#saveInPo").checked || $("#saveInPdf").checked || $("#saveInDocx").checked;
  po.disabled = !withPo; if (!withPo) po.checked = false;
  $("#saveInPoWrap").classList.toggle("off", !withPo);
  $("#saveInPoNote").textContent = !withPo ? tr("saveAsPoNone") : withPo < ready.length ? tr("saveAsPoSome", withPo, ready.length) : "";
  $("#saveModeDirWrap").hidden = !desk; if (!desk) $("#saveModeZip").checked = true;
  $("#saveDlgIntro").textContent = tr("saveAsIntro", ready.length, ready.map(nr).join(", "));
  $("#saveGo").disabled = !any || !ready.length;
}
function openSaveAs() {
  const ready = readyCards(); if (!ready.length) return;
  if (!detailsOk()) return needDetails();
  $("#saveInPo").checked = ready.some((c) => c.poBytes && c.poBytes.length); $("#saveInPdf").checked = true; $("#saveInDocx").checked = true;
  saveDlgSync(); const d = $("#saveDlg"); if (!d.open) d.showModal();
}
async function saveAsRun() {
  const ready = readyCards(); if (!ready.length) return;
  if (!detailsOk()) { $("#saveDlg").close(); return needDetails(); }
  const want = { po: $("#saveInPo").checked && !$("#saveInPo").disabled, pdf: $("#saveInPdf").checked, docx: $("#saveInDocx").checked };
  if (!want.po && !want.pdf && !want.docx) return;
  const mode = desk && $("#saveModeDir").checked ? "dir" : "zip", zname = zipName(ready);
  let target = ""; // ask where first, so cancelling costs nothing
  try {
    if (desk && mode === "dir") { const r = await desk.pickAnyDir(tr("saveAsDirPick")); if (!r || r.canceled || !r.dir) return; target = r.dir; }
    else if (desk) { const r = await desk.saveAsZip(zname, tr("saveAsZipPick")); if (!r || r.canceled || !r.path) return; target = r.path; }
  } catch (e) { toast(tr("saveAsFail")); return; }
  $("#saveDlg").close();
  const btn = $("#saveAs"); busy(btn, true);
  try {
    const files = [], made = [], noPo = [];
    for (const c of ready) {
      const data = invoiceData(c);
      if (want.pdf) files.push([fileName(data, c.po), await buildPdf(data)]);
      if (want.docx) { try { files.push([fileName(data, c.po, "docx"), await buildWord(data)]); } catch (e) {} }
      if (want.po) { if (c.poBytes && c.poBytes.length) files.push([poFileName(c), c.poBytes]); else noPo.push(c.po || c.fileName); }
      made.push([c, data]);
    }
    if (!files.length) { toast(tr("saveAsNothing")); busy(btn, false); return; }
    const seen = new Set(); // two POs with the same file name: keep both
    for (const f of files) { let n = f[0]; const ext = n.slice(n.lastIndexOf(".")), base = n.slice(0, -ext.length); for (let i = 2; seen.has(n.toLowerCase()); i++) n = `${base} (${i})${ext}`; seen.add(n.toLowerCase()); f[0] = n; }
    let ok = false, msg = "";
    if (mode === "dir") {
      let n = 0;
      for (const [name, b] of files) { const bytes = b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : b; const r = await desk.saveToDir(target, name, bytes); if (!(r && r.ok)) break; n++; }
      ok = n === files.length; msg = ok ? tr("saveAsDoneDir", n, target) : tr("saveAsFail");
    } else {
      const zip = new JSZip(); for (const [name, bytes] of files) zip.file(name, bytes);
      const bytes = await zip.generateAsync({ type: "uint8array" });
      if (desk) { const r = await desk.writePicked(target, bytes); ok = !!(r && r.ok); msg = ok ? tr("saveAsDoneZip", r.name || target) : tr("saveAsFail"); }
      else { ok = await save(zname, new Blob([bytes], { type: "application/zip" }), { plain: true }); msg = ok ? tr("downloaded", zname) : ""; }
    }
    if (ok && (want.pdf || want.docx)) { // the invoices are made: record them like the normal save does (once; saving again elsewhere adds nothing)
      for (const [c, data] of made) if (!(c.done && state.invoices.has(data.factuurnr))) await logInvoice(c, data, ["pdf", "docx"].filter((f) => want[f]), []);
    }
    if (ok && noPo.length) msg += tr("saveAsNoPo", noPo.join(", "));
    if (msg) toast(msg);
    if (ok && folderSet()) refreshFolder();
  } catch (e) { toast(tr("buildFailMany")); }
  busy(btn, false); render();
}

async function preview(data) {
  const dlg = $("#dlg"), cv = $("#dlgCanvas");
  $("#dlgTitle").textContent = tr("preview", data.factuurnr); $("#dlgTitle").dataset.nr = data.factuurnr;
  try {
    const bytes = await buildPdf(data);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 2 });
    cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    if (!dlg.open) dlg.showModal();
  } catch (e) { toast(tr("previewFail")); }
}

function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.label = btn.textContent; btn.textContent = tr("busy"); } else if (btn.dataset.label) btn.textContent = btn.dataset.label; }
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3800); }

// ------------------------------------------------------------ rendering
function daysText(dates) {
  if (!dates.length) return "";
  const short = dates.map((d, i) => (i < dates.length - 1 && d.slice(6) === dates[dates.length - 1].slice(6) ? d.slice(0, 5) : d));
  const list = short.length > 1 ? short.slice(0, -1).join(", ") + tr("and") + short[short.length - 1] : short[0];
  return `<b>${dates.length} ${tr(plural(dates.length))}:</b> ${esc(list)}`;
}

function cardNotes(c) {
  const notes = (c.checks || []).map((n) => ({ level: n.level, text: n.code ? tr(n.code, ...(n.args || [])) : n.text }));
  const prev = [...state.invoices.values()].find((i) => i.po && i.po === c.po && !(c.done && i.factuurnr === nr(c)));
  if (prev) notes.push({ level: "warn", text: tr("alreadyInv", c.po, prev.factuurnr, prev.datum) });
  else { const other = poInvoicedAs(c); if (other) notes.push({ level: "warn", text: tr("alreadyInvNr", c.po, other) }); } // an invoice in the folder names it
  const taken = state.invoices.get(nr(c));
  if (taken && !(c.done && taken.po === c.po)) notes.push({ level: "warn", text: tr("numTaken", nr(c), taken.po || tr("otherInvoice")) });
  const inF = !c.done && (state.fileNums.get(c.jaar) || new Map()).get(c.nummer);
  if (inF) notes.push({ level: "warn", text: tr("numInFolder", nr(c), inF) });
  const dup = state.cards.find((o) => o !== c && !o.error && nr(o) === nr(c));
  if (dup) notes.push({ level: "warn", text: tr("numDup", nr(c), dup.po) });
  const cc = cardClient(c).client, k = cc.kvk;
  if (c.parsed && c.parsed.kvk && k && c.parsed.kvk !== k) notes.push({ level: "warn", text: tr("otherClient", c.parsed.kvk, k) });
  if (!cc.name) notes.push({ level: "warn", text: tr("fillClient") });
  if (c.lines.length > core.MAX_LINES) notes.push({ level: "warn", text: tr("maxLines", core.MAX_LINES) });
  return notes;
}

/** the round × in a card's corner: takes the card off the list (nothing is deleted) */
function removeBtn(what) { return `<button type="button" class="ghost xbtn" data-act="remove" aria-label="${esc(tr("removeCardAria", what || ""))}" title="${esc(tr("removeCard"))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`; }
function cardHtml(c) {
  if (c.error) {
    return `<article class="panel po" data-id="${c.id}"><div class="po-head"><div><h3>${esc(c.fileName)}</h3></div>
        ${removeBtn(c.fileName)}</div>
        <ul class="checks"><li class="chip error">${esc(tr(c.error))}</li></ul></article>`;
  }
  const t = core.totals(c.lines, c.btw);
  const meta = [c.parsed.orderDate && tr("ordered", c.parsed.orderDate), c.parsed.orderedBy && tr("by", c.parsed.orderedBy), c.fileName].filter(Boolean).map(esc).join(" · ");
  const lines = c.lines.map((l, i) => `
      <div class="line">
        <label class="f" for="${c.id}-d${i}">${esc(tr("desc"))}<input id="${c.id}-d${i}" data-line="${i}" data-k="desc" value="${esc(l.desc)}"></label>
        <label class="f" for="${c.id}-a${i}">${esc(tr("qty"))}<input id="${c.id}-a${i}" data-line="${i}" data-k="aantal" inputmode="decimal" value="${esc(core.qty(l.aantal))}"></label>
        <label class="f" for="${c.id}-t${i}">${esc(tr("rate2"))}<input id="${c.id}-t${i}" data-line="${i}" data-k="tarief" inputmode="decimal" value="${esc(core.eur(l.tarief).replace("€ ", ""))}"></label>
        <span class="amt num" data-amt="${i}">${esc(core.eur(core.round2(l.tarief * l.aantal)))}</span>
      </div>`).join("");
  const notes = cardNotes(c).map((n) => `<li class="chip ${n.level}">${esc(n.text)}</li>`).join("");
  return `<article class="panel po" data-id="${c.id}">
      <div class="po-head"><div><h3>${esc(c.po || tr("unknownPo"))}</h3><p class="meta">${meta}</p></div>
        ${removeBtn(c.po || c.fileName)}</div>
      ${c.dates.length ? `<p class="days">${daysText(c.dates)}</p>` : ""}
      <div class="fields">
        <label class="f" for="${c.id}-nr">${esc(tr("invNo"))}<input id="${c.id}-nr" data-k="nr" value="${esc(nr(c))}" inputmode="numeric" autocomplete="off"></label>
        <label class="f" for="${c.id}-date">${esc(tr("invDate"))}<input id="${c.id}-date" data-k="date" type="date" value="${esc(c.dateISO)}"></label>
        <label class="f" for="${c.id}-btw">${esc(tr("vat"))}<select id="${c.id}-btw" data-k="btw">${Object.entries(core.BTW).map(([v, b]) => `<option value="${v}"${v === c.btw ? " selected" : ""}>${esc(tr("btw." + v))}</option>`).join("")}</select></label>
        ${CL.list.length > 1 ? `<label class="f" for="${c.id}-cl">${esc(tr("cardClient"))}<select id="${c.id}-cl" data-k="client">${CL.list.map((p) => `<option value="${esc(p.id)}"${p.id === (clientById(c.clientId) ? c.clientId : CL.active) ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : ""}
      </div>
      <div class="lines">${lines}</div>
      ${notes ? `<ul class="checks">${notes}</ul>` : ""}
      <div class="po-foot">
        <div class="total">${esc(tr("totalPay"))}<b class="num" data-total>${esc(core.eur(t.total))}</b>${c.done ? `<span class="done">${esc(tr(folderSet() ? "doneSaved" : "doneAs", nr(c)))}</span>` : ""}</div>
        <div class="actions">
          <button type="button" data-act="preview">${esc(tr("view"))}</button>
          <button type="button" data-act="download-docx">${esc(tr(folderSet() ? (c.done ? "saveWordAgain" : "saveWord") : c.done ? "dlWordAgain" : "dlWord"))}</button>
          <button type="button" data-act="download">${esc(tr(folderSet() ? (c.done ? "saveAgain" : "savePdf") : c.done ? "dlAgain" : "dlPdf"))}</button>
          <button type="button" class="primary" data-act="download-both">${esc(tr(folderSet() ? (c.done ? "saveBothAgain" : "saveBoth") : c.done ? "dlBothAgain" : "dlBoth"))}</button>
        </div>
      </div>
    </article>`;
}

function render() {
  const a = document.activeElement, focusId = a && a.id, sel = a && "selectionStart" in a ? [a.selectionStart, a.selectionEnd] : null;
  $("#cards").innerHTML = state.cards.map(cardHtml).join("");
  const ok = state.cards.filter((c) => !c.error);
  $("#noCards").hidden = state.cards.length > 0;
  $("#batch").hidden = ok.length < 2;
  $("#batchText").textContent = tr("batchText", ok.length, ok.map(nr).join(", "));
  const year = new Date().getFullYear();
  $("#nextNr").textContent = `${nextNumber(year)}-${year}`;
  $("#nextNote").textContent = state.cards.some((c) => !c.error && !c.done) ? tr("nextNote") : "";
  const za = $("#zipAll"), zk = folderSet() ? "saveAll" : "zipAll";
  if (za.dataset.i18n !== zk) za.dataset.i18n = zk;
  if (!za.disabled) za.textContent = tr(zk);
  renderFolder(); renderPoFolderSet(); renderNewPos(); renderClients();
  if (state.tab === "stats") renderStats();
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
}

function updateFileHint() {
  const prev = Object.assign({}, state.settings, { fileTemplate: $("#sFile").value });
  const keep = state.settings; state.settings = prev;
  const year = new Date().getFullYear();
  const name = fileName({ factuurnr: `${nextNumber(year)}-${year}`, datum: isoToNl(isoToday()), client: keep.client }, "PO-008148", "pdf");
  state.settings = keep;
  $("#sFileHint").textContent = tr("sFileHint", name);
}
$("#sFile").addEventListener("input", updateFileHint);

function fillSettingsForm() {
  const s = state.settings;
  $("#sFile").value = s.fileTemplate || DEFAULTS.fileTemplate; updateFileHint(); $("#sStart").value = s.startNumber; $("#sTerm").value = s.betaaltermijn; $("#sBtw").value = s.btw;
  $("#cName").value = s.client.name || ""; $("#cStreet").value = s.client.street || ""; $("#cCity").value = s.client.city || "";
  $("#cKvk").value = s.client.kvk || ""; $("#cBtw").value = s.client.btw || "";
  if (!s.client.name) $("#settingsBox").open = true; // nothing filled in yet: show the form
  renderClients();
}

