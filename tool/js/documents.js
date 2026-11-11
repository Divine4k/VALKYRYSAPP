// Documents tab (docSets, renderDocs), deleting an invoice, refresh buttons, stale records.
"use strict";
// ------------------------------------------------------------ documents tab: one row per invoice number, with its PDF and Word file in the invoice folder and its purchase order
const DOC_SORTS = ["nr", "date", "client", "po", "amount"], DOC_FILTERS = ["all", "open", "sent", "noinv", "miss"];
state.sent = new Set(); state.docs = { sort: "nr", dir: "desc", filter: "all", q: "", sel: new Set(), selMode: false }; // selMode: choosing invoices to send by email; sel: the numbers ticked
const saveSent = () => { if (state.db) { try { state.db.doc("settings/sent").set({ list: [...state.sent] }); } catch (e) {} } };
const saveDocsPrefs = () => { if (state.db) { try { state.db.doc("settings/docsprefs").set({ sort: state.docs.sort, dir: state.docs.dir, filter: state.docs.filter }); } catch (e) {} } };
const applyDocsPrefs = (v) => { if (!v) return; if (DOC_SORTS.includes(v.sort)) state.docs.sort = v.sort; if (v.dir === "asc" || v.dir === "desc") state.docs.dir = v.dir; if (DOC_FILTERS.includes(v.filter)) state.docs.filter = v.filter; };
const nlDateKey = (t) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(t || "")); return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : 0; };
/** the invoice sets, from what is already read: the folder files (state.files + the parse cache), the folder invoices, the invoices made here, the purchase orders */
function docSets() {
  const sets = new Map(), byBase = new Map();
  const get = (nr) => { let s = sets.get(nr); if (!s) { const [n, y] = nr.split("-").map(Number); sets.set(nr, (s = { nr, n, y, pdf: null, docx: null, inv: null, fi: null })); } return s; };
  const better = (a, b) => !a || b.name.length < a.name.length || (b.name.length === a.name.length && b.mtime > a.mtime); // "VALKYRYS 5-2025.pdf" wins over its "(kopie)"
  const files = desk && state.folder && state.folder.exists ? state.files.filter((f) => f.ext === "pdf" || f.ext === "docx") : [], later = [];
  for (const f of files) {
    const e = state.parseCache.get(f.rel), cached = e && e.mt === f.mtime && e.sz === f.size && isInvoiceRec(e.r) && /^\d+-\d{4}$/.test(e.r.nr || "") ? e.r.nr : "";
    const m = NUM_IN_NAME.exec(f.name.replace(/\.[^.]+$/, "")), nr = cached || (m ? `${+m[1]}-${m[2]}` : "");
    if (!nr) { later.push(f); continue; }
    const s = get(nr); if (better(s[f.ext], f)) s[f.ext] = f; byBase.set(f.rel.replace(/\.(pdf|docx)$/i, ""), s);
  }
  for (const f of later) { const s = byBase.get(f.rel.replace(/\.(pdf|docx)$/i, "")); if (s && !s[f.ext]) s[f.ext] = f; } // a Word file next to its PDF, same name without a number
  for (const fi of files.length ? state.folderInvoices : []) get(fi.factuurnr).fi = fi;
  for (const i of state.invoices.values()) if (/^\d+-\d{4}$/.test(i.factuurnr || "")) get(i.factuurnr).inv = i;
  const out = [...sets.values()].map((s) => {
    const i = s.inv, fi = s.fi, poText = (i && i.po) || (fi && fi.po) || "", names = [s.pdf, s.docx].filter(Boolean).map((f) => f.name).join(" ");
    const poRec = (desk && (state.poRecs.find((x) => poMentioned(poText, x.r.po)) || (names && state.poRecs.find((x) => poMentioned(names, x.r.po))))) || null;
    let total = null;
    if (i && i.lines && i.lines.length) total = core.totals(i.lines, i.btw || "verlegd").total; else if (i && +i.totaal) total = +i.totaal; else if (fi && fi.amounts && isFinite(fi.amounts.total)) total = fi.amounts.total;
    const datum = (i && i.datum) || (fi && fi.datum) || "", client = ((i && i.client && i.client.name) || (fi && fi.client && fi.client.name) || "").trim();
    const ment = [i && i.po, fi && fi.po, names].filter(Boolean).join(" "); // everything that can name a purchase order (for two invoices on one PO)
    return { ...s, po: poRec ? poRec.r.po : poText, poRec, total, datum, dkey: nlDateKey(datum), client, sent: state.sent.has(s.nr), gen: !s.pdf && !!(i && i.lines && i.lines.length), ment };
  });
  return out.concat(poOnlySets(out));
}
/** purchase orders in the PO folder that no invoice names yet (same matching as the new-orders list): one row each, once everything is read, so nothing is guessed */
function poOnlySets(invSets) {
  if (!desk || !state.poFolder || !state.poFolder.exists || state.poScanSig === "" || state.poScan || !state.invoicesLoaded || !state.folderScanned) return [];
  const used = new Set(invSets.filter((s) => s.poRec).map((s) => s.poRec.r.po)), cl = ((state.settings && state.settings.client && state.settings.client.name) || "").trim();
  return state.poRecs.filter((x) => !used.has(x.r.po) && !poInvoiced(x.r.po)).map((x) => {
    const r = x.r, m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(r.orderDate || ""), datum = m ? `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}` : "";
    const sum = r.items.reduce((a, i) => a + (isFinite(i.total) ? i.total : 0), 0), total = r.poTotal != null && isFinite(r.poTotal) ? r.poTotal : r.items.length ? sum : null;
    return { nr: "", n: 0, y: 0, poOnly: true, skipped: state.poSkip.has(r.po), pdf: null, docx: null, inv: null, fi: null, po: r.po, poRec: x, total, datum, dkey: poSortKey(r), client: cl || r.orderedBy || "", sent: false, gen: false };
  });
}
/** what is wrong with the sets, once the folder and the invoices are read: invoices missing a file they should have, and purchase orders named by more than one invoice.
 *  Expected files: the record's `formats` (every format ever saved), "pdf" + "docx" for older records without it; an invoice only in the folder expects what it has.
 *  A record with no file at all is the stale banner's business, so it is not listed here. Ignored ones: settings/keptmissing (numbers), settings/keptdupinv (PO|numbers). */
const DOC_LABEL = { pdf: "PDF", docx: "Word" };
const byNrKey = (a, b) => { const [x, y] = [a, b].map((v) => v.split("-").map(Number)); return x[1] - y[1] || x[0] - y[0]; };
function docWarns(sets) {
  const W = { ready: false, missAll: new Map(), miss: new Map(), dups: [], dupOf: new Map() };
  if (!desk || !state.folder || !state.folder.exists || !state.folderScanned || state.scan || !state.invoicesLoaded) return W;
  W.ready = true;
  const keptM = state.keptMissing || new Set(), keptD = state.keptDupInv || new Set();
  const invs = sets.filter((s) => !s.poOnly);
  for (const s of invs) {
    if (!s.inv || !(s.pdf || s.docx)) continue;
    // newer records: only what was written into the invoice folder counts (downloads and "Save as…" elsewhere are not expected here)
    const inFolder = (Array.isArray(s.inv.savedFiles) ? s.inv.savedFiles : []).map((n) => (/\.docx$/i.test(n) ? "docx" : /\.pdf$/i.test(n) ? "pdf" : "")).filter(Boolean);
    const want = Array.isArray(s.inv.formats) && s.inv.formats.length ? inFolder : ["pdf", "docx"];
    const miss = ["pdf", "docx"].filter((f) => want.includes(f) && !s[f]);
    if (!miss.length) continue;
    W.missAll.set(s.nr, miss); if (!keptM.has(s.nr)) W.miss.set(s.nr, miss);
  }
  const named = invs.filter((s) => s.ment), keys = new Map();
  for (const x of state.poRecs) keys.set(String(x.r.po).toUpperCase(), String(x.r.po));
  for (const s of named) if (s.po && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(s.po) && !keys.has(s.po.toUpperCase())) keys.set(s.po.toUpperCase(), s.po);
  for (const po of keys.values()) {
    const re = new RegExp("(?<![A-Za-z0-9])" + po.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9])", "i"); // as poMentioned, built once per PO
    const nrs = named.filter((s) => re.test(s.ment)).map((s) => s.nr).sort(byNrKey);
    if (nrs.length < 2) continue;
    const key = `${po.toUpperCase()}|${nrs.join(",")}`; if (keptD.has(key)) continue;
    W.dups.push({ po, nrs, key });
    for (const n of nrs) { const l = W.dupOf.get(n) || []; l.push({ po, others: nrs.filter((m) => m !== n) }); W.dupOf.set(n, l); }
  }
  W.dups.sort((a, b) => byNrKey(a.nrs[0], b.nrs[0]));
  return W;
}
const andList = (l) => (l.length > 1 ? l.slice(0, -1).join(", ") + tr("and") + l[l.length - 1] : l[0] || "");
/** the banners in Documents and the lines in the new-orders panel on the Invoices tab */
function renderDocWarns() {
  const W = docWarns(docSets()), items = [];
  if (W.miss.size) {
    const l = [...W.miss.entries()].sort((a, b) => byNrKey(a[0], b[0])).map(([nr, m]) => `${nr} (${m.map((f) => DOC_LABEL[f]).join(", ")})`);
    items.push({ text: W.miss.size === 1 ? tr("missOne", l[0]) : tr("missMany", W.miss.size, l.join(", ")), btns: [["miss", "", "warnView", false]] });
  }
  for (const d of W.dups) items.push({ text: tr("dupInv", d.po, d.nrs.length, andList(d.nrs)), btns: [["dup", d.po, "warnView", false], ["dupignore", d.key, "docsIgnore", true]] });
  const btns = (b) => b.map(([k, v, key, ghost]) => `<button type="button"${ghost ? ' class="ghost"' : ""} data-dw="${k}" data-v="${esc(v)}">${esc(tr(key))}</button>`).join("");
  const d = $("#docsWarn"), n = $("#npWarn");
  d.innerHTML = items.map((x) => `<div class="panel dupbar" role="status" data-w="${x.btns[0][0]}"><span class="dtext">${esc(x.text)}</span>${btns(x.btns)}</div>`).join(""); d.hidden = !items.length;
  n.innerHTML = items.map((x) => `<p data-w="${x.btns[0][0]}"><span>${esc(x.text)}</span>${btns(x.btns)}</p>`).join(""); n.hidden = !items.length;
}
const saveKept = (doc, set) => { if (state.db) { try { state.db.doc("settings/" + doc).set({ list: [...set] }); } catch (e) {} } };
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-dw]"); if (!b) return;
  const k = b.dataset.dw, v = b.dataset.v || "";
  if (k === "dupignore") { state.keptDupInv = new Set([...(state.keptDupInv || []), v]); saveKept("keptdupinv", state.keptDupInv); render(); return; }
  state.docs.filter = k === "miss" ? "miss" : "all"; state.docs.q = k === "dup" ? v : ""; saveDocsPrefs();
  setTab("docs"); renderDocs(); window.scrollTo({ top: 0 });
});
/** makes the missing PDF and/or Word file of an invoice made in the app again, into the invoice folder, from what was saved */
async function remakeMissing(nr, btn) {
  const all = docSets(), rec = state.invoices.get(nr), miss = docWarns(all).missAll.get(nr) || [];
  if (!desk || !rec || !rec.lines || !rec.lines.length || !miss.length || state.delBusy) return;
  busy(btn, true); const names = [];
  try {
    const data = { factuurnr: rec.factuurnr, datum: rec.datum, betaaltermijn: rec.betaaltermijn || state.settings.betaaltermijn, client: rec.client || state.settings.client, lines: rec.lines, btw: rec.btw || "verlegd", ...recordLook(rec) };
    for (const fmt of miss) {
      const bytes = await build(fmt, data); state.savedTo = "";
      if (await saveToFolder(fileName(data, rec.po, fmt), new Blob([bytes], { type: MIME[fmt] })) && state.savedTo) names.push(state.savedTo);
    }
    if (names.length) { // the record knows the files again (same fields as when it was saved)
      const want = Array.isArray(rec.formats) && rec.formats.length ? rec.formats : ["pdf", "docx"];
      const doc = { ...rec, savedFiles: [...new Set([...(Array.isArray(rec.savedFiles) ? rec.savedFiles : []), ...names])], formats: [...new Set([...want, ...miss])] };
      state.invoices.set(nr, doc);
      if (state.db) { try { await state.db.doc("invoices/" + nr).set(doc); } catch (e) {} }
    }
  } catch (e) { toast(tr("remakeFail")); }
  busy(btn, false);
  await refreshAll(); render();
  if (names.length === miss.length) toast(tr("remade", nr, miss.map((f) => DOC_LABEL[f]).join(", ")));
}
function sortDocs(list) {
  const { sort, dir } = state.docs, k = dir === "asc" ? 1 : -1, byNr = (a, b) => a.y - b.y || a.n - b.n || a.dkey - b.dkey;
  if (sort === "nr") { const top = list.filter((s) => s.poOnly).sort((a, b) => (a.skipped - b.skipped) || (b.dkey - a.dkey) || natPo(b.po, a.po)); // orders without an invoice first (newest first, skipped ones after), so they are noticed
    return top.concat(list.filter((s) => !s.poOnly).sort((a, b) => k * byNr(a, b))); }
  const cmp = { nr: byNr, date: (a, b) => a.dkey - b.dkey, client: (a, b) => a.client.localeCompare(b.client, state.lang, { sensitivity: "base", numeric: true }), po: (a, b) => natPo(a.po, b.po), amount: (a, b) => a.total - b.total }[sort] || byNr;
  const empty = (x) => (sort === "client" ? !x.client : sort === "po" ? !x.po : sort === "date" ? !x.dkey : sort === "amount" ? x.total == null : false);
  return list.sort((a, b) => (empty(a) - empty(b)) || k * cmp(a, b) || byNr(b, a)); // empty values last, then newest number first
}
const ICON_FOLDER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ICON_EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_TRASH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
const ICON_DIR = { asc:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>',
  desc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>' };
function renderDocs() {
  if (state.tab !== "docs") return;
  const D = state.docs, all = docSets(), f = desk ? state.folder : null, W = docWarns(all);
  if (D.filter === "miss" && W.ready && !W.miss.size) D.filter = "all"; // nothing incomplete (any more)
  const q = D.q.trim().toLowerCase(), match = (s) => !q || [s.nr, s.client, s.po].some((v) => String(v || "").toLowerCase().includes(q));
  const keepF = (s) => D.filter === "all" || (D.filter === "miss" ? W.miss.has(s.nr) : D.filter === "noinv" ? !!s.poOnly : !s.poOnly && (D.filter === "sent") === s.sent); // sent / not sent: invoices only
  const found = all.filter(match), shown = sortDocs(found.filter(keepF)), invs = all.filter((s) => !s.poOnly), nSent = invs.filter((s) => s.sent).length;
  $("#docsNoFolder").hidden = !(desk && !f);
  $("#docsBar").hidden = !all.length;
  const counts = { all: found.length, open: found.filter((s) => !s.poOnly && !s.sent).length, sent: found.filter((s) => !s.poOnly && s.sent).length, noinv: found.filter((s) => s.poOnly).length, miss: found.filter((s) => W.miss.has(s.nr)).length };
  $("#docsFilter").querySelectorAll("button[data-f]").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.f === D.filter)); b.querySelector(".n").textContent = ` ${counts[b.dataset.f]}`; if (b.dataset.f === "miss") b.hidden = !W.miss.size && D.filter !== "miss"; });
  $("#docsSort").value = D.sort;
  const dirB = $("#docsDir"), dk = D.dir === "asc" ? "docsAsc" : "docsDesc"; dirB.innerHTML = ICON_DIR[D.dir]; dirB.setAttribute("aria-label", tr(dk)); dirB.title = tr(dk);
  const sIn = $("#docsSearch"); sIn.placeholder = tr("docsSearch"); if (sIn.value !== D.q) sIn.value = D.q;
  $("#docsCount").textContent = tr("docsCount", nSent, invs.length); $("#docsProg .pb i").style.width = (invs.length ? Math.round(nSent / invs.length * 100) : 0) + "%";
  // one line about the folder and what is still being read
  const year = new Date().getFullYear(), nums = inFolder(year), withFile = all.filter((s) => s.pdf || s.docx).length, withPo = invs.filter((s) => s.poRec).length;
  const info = f && !f.exists ? [tr("folderMissing")] : [f && (withFile || state.scan ? tr("folderCount", withFile) : tr("folderEmpty")), f && nums.length && tr("folderHighest", `${Math.max(...nums)}-${year}`), withPo && tr("docsWithPo", withPo),
    state.scan && tr("scanning", state.scan.done, state.scan.total), state.poScan && tr("npReading", state.poScan.done, state.poScan.total)].filter(Boolean);
  $("#docsInfo").innerHTML = info.map((x) => `<span class="nw">${esc(x)}</span>`).join(" · "); $("#docsInfo").hidden = !info.length;
  // the column heads sort too
  const cols = [["nr", "docsByNr"], ["client", "docsByClient"], ["date", "docsByDate"], ["po", "docsByPo"], ["amount", "docsByAmount", "r"]];
  const selShown = shown.filter((s) => !s.poOnly), allSel = selShown.length > 0 && selShown.every((s) => D.sel.has(s.nr)), someSel = selShown.some((s) => D.sel.has(s.nr));
  $("#docsHead").innerHTML = `<span class="c-sel"><input type="checkbox" id="docsSelAll"${allSel ? " checked" : ""} aria-label="${esc(tr("docsSelAll"))}" title="${esc(tr("docsSelAll"))}"></span>` + cols.map(([k, key, cls]) => `<button type="button" data-sort="${k}"${cls ? ` class="${cls}"` : ""}${D.sort === k ? ` aria-sort="${D.dir === "asc" ? "ascending" : "descending"}"` : ""}>${esc(tr(key))}${D.sort === k ? `<i aria-hidden="true">${D.dir === "asc" ? "▲" : "▼"}</i>` : ""}</button>`).join("")
    + `<span>${esc(tr("docsColDocs"))}</span><span>${esc(tr("docsSent"))}</span><span></span>`;
  { const sa = $("#docsSelAll"); if (sa) sa.indeterminate = someSel && !allSel; }
  $("#docsTable").classList.toggle("selmode", !!(D.selMode && desk));
  renderSendBar();
  // keep the focus on the same control when the list is drawn again
  const a = document.activeElement, keep = a && $("#docsList").contains(a) ? (a.dataset.sent ? `[data-sent="${a.dataset.sent}"]` : a.dataset.mkinv ? `[data-mkinv="${a.dataset.mkinv}"]` : a.dataset.doc && a.dataset.po ? `[data-doc="po"][data-po="${a.dataset.po}"]` : a.dataset.doc ? `[data-doc="${a.dataset.doc}"][data-nr="${a.dataset.nr}"]` : "") : "";
  const showApp = !!(f && f.exists);
  /** a purchase order without an invoice: no number, PDF and Word missing, its PO to look at, and a button that puts it on the Invoices tab */
  const poRow = (s) => {
    const off = (kind, label) => `<button type="button" class="dchip k-${kind}" disabled title="${esc(tr("docsMissing", label))}">${label}</button>`;
    return `<li class="drow po-only${s.skipped ? " skipped" : ""}" data-nr="" data-po="${esc(s.po)}" title="${esc(tr("docsPoOnlyTitle"))}">
        <span class="c-sel"></span>
        <span class="c-nr"><span class="chip warn noinv">${esc(tr("docsNoInvBadge"))}</span>${s.skipped ? `<small>${esc(tr("docsPoSkipped"))}</small>` : ""}</span>
        <span class="c-cl${s.client ? "" : " none"}" title="${esc(s.client)}">${esc(s.client || tr("noClient"))}</span>
        <span class="c-dt">${esc(s.datum || "–")}</span>
        <span class="c-po">${esc(s.po)}</span>
        <span class="c-amt">${s.total == null ? "–" : esc(core.eur(s.total))}</span>
        <span class="c-docs">${off("pdf", "PDF")}${off("word", "Word")}<button type="button" class="dchip k-po" data-doc="po" data-po="${esc(s.po)}" aria-label="${esc(tr("docsPoViewAria", s.po))}" title="${esc(s.poRec.f.name)}">PO</button></span>
        <span class="c-sent"><button type="button" class="primary mkinv" data-mkinv="${esc(s.po)}" aria-label="${esc(tr("docsMakeInvAria", s.po))}"${state.npBusy ? " disabled" : ""}>${esc(tr("docsMakeInv"))}</button></span>
        <span class="c-act"></span>
      </li>`;
  };
  $("#docsList").innerHTML = shown.map((s) => {
    if (s.poOnly) return poRow(s);
    const miss = W.miss.get(s.nr) || [], dup = W.dupOf.get(s.nr) || [];
    const chip = (kind, label, on, extra) => on ? `<button type="button" class="dchip k-${kind}${extra || ""}" data-doc="${kind}" data-nr="${esc(s.nr)}" aria-label="${esc(tr("docsViewAria", label, s.nr))}" title="${esc(on)}">${label}</button>`
      : `<button type="button" class="dchip k-${kind}${extra || ""}" disabled title="${esc(tr(extra ? "docsMissTitle" : "docsMissing", label))}">${label}</button>`;
    // with an invoice folder the chips tell only what is really in it; a plain browser has no folder, so an invoice made here is drawn again (dashed chip)
    const pdfOn = s.pdf ? s.pdf.name : s.gen && !showApp ? tr("docsGen") : "", rel = (s.pdf || s.docx || {}).rel;
    const pdfX = s.pdf ? "" : pdfOn ? " gen" : miss.includes("pdf") ? " miss" : "", wordX = !s.docx && miss.includes("docx") ? " miss" : "";
    const canRemake = !!(s.inv && s.inv.lines && s.inv.lines.length);
    const warn = miss.length || dup.length ? `<span class="c-warn">${miss.map((m) => `<span class="tagw" title="${esc(tr("docsMissTitle", DOC_LABEL[m]))}">${esc(tr("docsMissBadge", DOC_LABEL[m]))}</span>`).join("")}`
      + dup.map((d) => `<span class="tagw dup" title="${esc(tr("docsDupTitle", d.po, d.others.join(", ")))}">${esc(tr("docsDupBadge"))} · ${esc(d.po)}</span>`).join("")
      + (miss.length && canRemake ? `<button type="button" data-remake="${esc(s.nr)}" title="${esc(tr("docsRemakeTitle", miss.map((m) => DOC_LABEL[m]).join(", ")))}">${esc(tr("docsRemake"))}</button>` : "")
      + (miss.length ? `<button type="button" class="ghost" data-missignore="${esc(s.nr)}" title="${esc(tr("docsIgnoreTitle"))}">${esc(tr("docsIgnore"))}</button>` : "") + "</span>" : "";
    const draw = showApp && s.gen && !rel ? `<button type="button" data-draw="${esc(s.nr)}" aria-label="${esc(tr("docsDrawAria", s.nr))}" title="${esc(tr("docsDraw"))}">${ICON_EYE}</button>` : "";
    return `<li class="drow${s.sent ? " sent" : ""}${miss.length ? " miss" : ""}${dup.length ? " dupinv" : ""}${D.sel.has(s.nr) ? " picked" : ""}" data-nr="${esc(s.nr)}">
        <span class="c-sel"><input type="checkbox" data-sel="${esc(s.nr)}"${D.sel.has(s.nr) ? " checked" : ""} aria-label="${esc(tr("docsSelAria", s.nr))}"></span>
        <span class="c-nr num">${esc(s.nr)}${showApp && !s.pdf && !s.docx ? `<small>${esc(tr("docsOnlyApp"))}</small>` : ""}</span>
        <span class="c-cl${s.client ? "" : " none"}" title="${esc(s.client)}">${esc(s.client || tr("noClient"))}</span>
        <span class="c-dt">${esc(s.datum || "–")}</span>
        <span class="c-po${s.po ? "" : " none"}">${esc(s.po || "–")}</span>
        <span class="c-amt">${s.total == null ? "–" : esc(core.eur(s.total))}</span>
        <span class="c-docs">${chip("pdf", "PDF", pdfOn, pdfX)}${chip("word", "Word", s.docx ? s.docx.name : "", wordX)}${chip("po", "PO", s.poRec ? s.poRec.f.name : "")}</span>
        <span class="c-sent"><label class="sentbox"><input type="checkbox" data-sent="${esc(s.nr)}"${s.sent ? " checked" : ""} aria-label="${esc(tr("docsSentAria", s.nr))}"><span aria-hidden="true">${esc(tr("docsSent"))}</span></label></span>
        <span class="c-act">${rel ? `<button type="button" data-reveal="${esc(rel)}" aria-label="${esc(tr("docsRevealAria", s.nr))}" title="${esc(tr("dupShow"))}">${ICON_FOLDER}</button>` : draw}<button type="button" class="del" data-deldoc="${esc(s.nr)}" aria-label="${esc(tr("delSetAria", s.nr))}" title="${esc(tr("delGo"))}">${ICON_TRASH}</button></span>
        ${warn}
      </li>`;
  }).join("");
  if (keep) { const el = $("#docsList").querySelector(keep); if (el) el.focus(); }
  $("#docsTable").hidden = !shown.length;
  const em = $("#docsEmpty"); em.hidden = !!shown.length || (!all.length && desk && !f); // no folder: the folder card says it already
  $("#docsEmptyT").textContent = tr(all.length ? "docsNoMatch" : "docsEmptyT"); $("#docsEmptyP").textContent = tr(all.length ? "docsNoMatchP" : "docsEmptyP");
}
const docOf = (nr) => (nr ? docSets().find((s) => s.nr === nr && !s.poOnly) : undefined);
$("#docsList").addEventListener("click", async (e) => {
  const c = e.target.closest("button[data-doc]"), r = e.target.closest("button[data-reveal]");
  if (r && desk) { try { const x = await desk.revealFile(r.dataset.reveal); if (x && x.error) toast(tr("dupShowFail")); } catch (err) { toast(tr("dupShowFail")); } return; }
  const dd = e.target.closest("button[data-deldoc]"); if (dd) { deleteSet(dd.dataset.deldoc, dd); return; }
  const rm = e.target.closest("button[data-remake]"); if (rm) { remakeMissing(rm.dataset.remake, rm); return; }
  const ig = e.target.closest("button[data-missignore]"); if (ig) { state.keptMissing = new Set([...(state.keptMissing || []), ig.dataset.missignore]); saveKept("keptmissing", state.keptMissing); render(); return; }
  const dw = e.target.closest("button[data-draw]"); if (dw) { previewInvoice({ key: dw.dataset.draw, i: {} }); return; }
  const mk =e.target.closest("button[data-mkinv]");
  if (mk && desk) { setTab("inv"); addPos([mk.dataset.mkinv]); return; } // a purchase order without an invoice: onto the Invoices tab, like "Toevoegen" under new purchase orders
  if (c && c.dataset.po) { const x = desk && state.poRecs.find((y) => y.r.po === c.dataset.po); if (x) previewPo(x.f.rel, x.r.po); return; }
  const s = c && docOf(c.dataset.nr); if (!s) return;
  if (c.dataset.doc === "pdf") { if (s.pdf && desk) previewDoc({ title: tr("invPrevTitle", s.nr), load: () => desk.readFile(s.pdf.rel), open: { rel: s.pdf.rel } }); else previewInvoice({ key: s.nr, i: {} }); }
  else if (c.dataset.doc === "word" && s.docx && desk) previewDoc({ title: tr("wordPrevTitle", s.nr), load: () => desk.readFile(s.docx.rel), open: { rel: s.docx.rel }, word: true });
  else if (c.dataset.doc === "po" && s.poRec && desk) previewPo(s.poRec.f.rel, s.poRec.r.po);
});
$("#docsList").addEventListener("change", (e) => {
  const sb = e.target.closest("input[data-sel]");
  if (sb) { if (sb.checked) state.docs.sel.add(sb.dataset.sel); else state.docs.sel.delete(sb.dataset.sel); renderDocs(); return; }
  const b = e.target.closest("input[data-sent]"); if (!b) return;
  if (b.checked) state.sent.add(b.dataset.sent); else state.sent.delete(b.dataset.sent);
  saveSent(); renderDocs();
});
/** a new sort key starts names A-Z and the rest newest/highest first; the same column head again turns the order round */
const sortBy = (k, toggle) => { const D = state.docs; if (D.sort === k) { if (toggle) D.dir = D.dir === "asc" ? "desc" : "asc"; } else { D.sort = k; D.dir = k === "client" || k === "po" ? "asc" : "desc"; } saveDocsPrefs(); renderDocs(); };
$("#docsHead").addEventListener("click", (e) => { const b = e.target.closest("button[data-sort]"); if (b) { sortBy(b.dataset.sort, true); const n = $(`#docsHead [data-sort="${b.dataset.sort}"]`); if (n) n.focus(); } });
$("#docsSort").addEventListener("change", (e) => { if (DOC_SORTS.includes(e.target.value)) sortBy(e.target.value); });
$("#docsDir").addEventListener("click", () => { state.docs.dir = state.docs.dir === "asc" ? "desc" : "asc"; saveDocsPrefs(); renderDocs(); });
$("#docsFilter").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (b) { state.docs.filter = b.dataset.f; saveDocsPrefs(); renderDocs(); } });
$("#docsSearch").addEventListener("input", (e) => { state.docs.q = e.target.value; renderDocs(); });
$("#docsGoSet").addEventListener("click", () => openSettings("folders"));
$("#docsHead").addEventListener("change", (e) => { // tick all invoices shown (or none)
  if (e.target.id !== "docsSelAll") return;
  const shownNrs = [...$("#docsList").querySelectorAll("input[data-sel]")].map((x) => x.dataset.sel);
  shownNrs.forEach((n) => (e.target.checked ? state.docs.sel.add(n) : state.docs.sel.delete(n))); renderDocs();
});

// ------------------------------------------------------------ deleting an invoice: the app's record and, if wanted, its files in the folder (to the Recycle Bin).
// One flow for the × in "Gemaakte facturen" and the bin on a Documents row. The files are the ones docSets() matched to the number.
const DRIVE_POLL_MS = 3000;
const refreshAll = () => (desk ? Promise.all([refreshFolder(), refreshPoFolder()]) : Promise.resolve());
let delAsk = null; // resolves the open delete dialog
function askDelete(s, rec) {
  // one checkbox per file that is really there: PDF and Word on, the PO (the client's document) only on request
  const opts = [["Pdf", desk && s.pdf, true], ["Word", desk && s.docx, true], ["Po", desk && s.poRec && s.poRec.f, false]].map(([k, f, on]) => ({ k, f: f || null, box: $("#del" + k), on }));
  $("#delDlgTitle").textContent = tr("delSetTitle", s.nr);
  for (const o of opts) { o.box.checked = !!o.f && o.on; $(`#del${o.k}Wrap`).hidden = !o.f; $(`#del${o.k}Name`).textContent = o.f ? o.f.name : ""; }
  $("#delOpts").hidden = !opts.some((o) => o.f);
  const draw = () => {
    const items = [];
    if (rec) items.push([tr("delItemRec"), false]);
    for (const o of opts) if (o.f) items.push([o.k === "Po" ? tr("delItemPo", o.f.name) : o.f.name, !o.box.checked]);
    $("#delList").innerHTML = items.map(([t, keep]) => `<li${keep ? ' class="keep"' : ""}>${esc(t)}</li>`).join("");
  };
  for (const o of opts) o.box.onchange = draw;
  draw();
  const dlg = $("#delDlg"); if (!dlg.open) dlg.showModal(); $("#delCancel").focus();
  return new Promise((res) => { delAsk = res; });
}
const delAnswer = (v) => { const r = delAsk; delAsk = null; if ($("#delDlg").open) $("#delDlg").close(); if (r) r(v); };
$("#delGo").addEventListener("click", () => { const on = (k) => $("#del" + k).checked && !$(`#del${k}Wrap`).hidden; delAnswer({ pdf: on("Pdf"), docx: on("Word"), po: on("Po") }); });
$("#delCancel").addEventListener("click", () => delAnswer(null));
$("#delDlgClose").addEventListener("click", () => delAnswer(null));
$("#delDlg").addEventListener("close", () => delAnswer(null));
async function deleteSet(nr, btn) {
  if (state.delBusy || !nr) return;
  state.delBusy = true;
  try {
    await refreshAll(); // what is in the folders right now
    const rec = state.invoices.get(nr) || null, s = docOf(nr) || { nr, pdf: null, docx: null, poRec: null };
    if (!rec && !s.pdf && !s.docx) { render(); return; }
    const ans = await askDelete(s, rec); if (!ans) return;
    let bad = 0, trashed = 0;
    const trash = async (rel, kind) => { try { const r = await desk.trashFile(rel, kind); if (r && r.ok) trashed++; else bad++; } catch (e) { bad++; } };
    if (desk && ans.pdf && s.pdf) await trash(s.pdf.rel, "invoices");
    if (desk && ans.docx && s.docx) await trash(s.docx.rel, "invoices");
    if (desk && ans.po && s.poRec) await trash(s.poRec.f.rel, "pos");
    if (rec) { state.invoices.delete(nr); if (state.db) { try { await state.db.doc("invoices/" + nr).delete(); } catch (e) { bad++; } } }
    if (state.sent.delete(nr)) saveSent();
    await refreshAll();
    renumber(); render();
    const kept = rec && (state.fileNums.get(rec.jaar) || new Map()).has(rec.nummer); // a file with the number is still in the folder: the number stays taken
    toast(bad ? tr("delSomeFail") : !rec ? tr("delToastFiles", nr) : trashed && !kept ? tr("delToastAll", nr) : tr(kept ? "delToastKept" : "delToast", nr));
  } finally { state.delBusy = false; if (btn && btn.isConnected) btn.focus(); }
}

// ---- refresh: the small circular-arrow buttons, and coming back to the app (focus / visible again, debounced) re-read both folders
document.querySelectorAll("button[data-refresh]").forEach((b) => { b.hidden = !desk; });
// next to the button a short status says what it is doing right now (checking the mail can take a few seconds); gone when done
const rstat = (b) => { let el = b.previousElementSibling; if (!el || !el.classList.contains("rstat")) { el = document.createElement("span"); el.className = "rstat"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); b.before(el); } return el; };
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-refresh]"); if (!b || !desk || b.classList.contains("spin")) return;
  const st = rstat(b), say = (k) => { st.textContent = tr(k); st.hidden = false; };
  b.classList.add("spin"); b.setAttribute("aria-busy", "true");
  const withMail = typeof mailCheckAll === "function" && mailHasAccounts();
  try {
    if (withMail) { say("rfMail"); await mailCheckAll(); } // like "Nu controleren" in Settings › Verbindingen (js/mail.js)
    say("rfFolders");
    await Promise.all([refreshAll(), new Promise((r) => setTimeout(r, 450))]);
  } catch (err) {}
  b.classList.remove("spin"); b.removeAttribute("aria-busy");
  st.hidden = true; st.textContent = ""; // only while it works: what came in shows in the list and the mail notice
});
if (desk) {
  let backT = 0;
  const onBack = () => { if (document.visibilityState === "hidden") return; clearTimeout(backT); backT = setTimeout(() => { refreshAll().catch(() => {}); }, 500); };
  window.addEventListener("focus", onBack); document.addEventListener("visibilitychange", onBack);
  // folders on a USB stick or an external drive: a quick look every few seconds (one check per folder, no listing) notices the drive
  // being pulled out or plugged in again (also under another drive letter, see electron-app/drives.js) without waiting for a click.
  // When the PO folder is back, the mail is checked at once, so orders that came in meanwhile are saved into it.
  const there = (f) => (f ? f.path + "|" + !!f.exists : "");
  setInterval(async () => {
    if (document.visibilityState === "hidden" || !state.folderScanned) return;
    let inv, pos; try { [inv, pos] = await Promise.all([desk.getFolder(), desk.getFolder("pos")]); } catch (e) { return; } // locked
    const invCh = there(inv) !== there(state.folder), posCh = there(pos) !== there(state.poFolder); if (!invCh && !posCh) return;
    const posBack = posCh && pos && pos.exists;
    await refreshAll().catch(() => {});
    if (posBack && typeof mailCheckAll === "function" && mailHasAccounts()) { await mailCheckAll().catch(() => {}); refreshPoFolder().catch(() => {}); }
  }, DRIVE_POLL_MS);
}

// ---- the invoice folder is the truth: an invoice in the app with no file of its number in the folder (deleted outside the app, or never saved
// there) is removed from the app by itself, once the folder is set, there, and read completely. Records from the last minute are left alone
// (a save that the folder listing has not caught up with yet). A missing folder (disk not connected) never removes anything.
const STALE_GRACE_MS = 60000;
function staleRecords() {
  if (!desk || !state.folder || !state.folder.exists || !state.folderScanned || state.scan || !state.invoicesLoaded) return [];
  // a folder without a single invoice file (a new or wrong folder picked) never empties the app
  if (![...state.fileNums.values()].some((m) => m && m.size)) return [];
  const now = Date.now();
  return [...state.invoices.values()].filter((i) => {
    const m = /^(\d+)-(\d{4})$/.exec(i.factuurnr || ""); if (!m) return false;
    if (state.cards.some((c) => c.saving)) return false; // something is being saved right now
    const t = Date.parse(i.createdAt || ""); if (t && now - t < (window.__staleGraceMs ?? STALE_GRACE_MS)) return false; // (tests shorten it)
    return !(state.fileNums.get(+m[2]) || new Map()).has(+m[1]);
  }).sort((a, b) => a.jaar - b.jaar || a.nummer - b.nummer);
}
async function renderStale() {
  document.querySelectorAll(".stalebar").forEach((b) => { b.hidden = true; });
  document.querySelectorAll("button[data-refresh]").forEach((b) => { b.title = tr("refresh"); });
  if (state.delBusy || state.staleBusy) return;
  const gone = staleRecords().map((i) => i.factuurnr); if (!gone.length) return;
  state.staleBusy = true;
  try {
    for (const n of gone) { state.invoices.delete(n); state.sent.delete(n); state.docs && state.docs.sel && state.docs.sel.delete(n); if (state.db) { try { await state.db.doc("invoices/" + n).delete(); } catch (err) {} } }
    saveSent();
  } finally { state.staleBusy = false; }
  renumber(); render();
  toast(tr(gone.length === 1 ? "staleAuto1" : "staleAutoN", gone.slice(0, 8).join(", ") + (gone.length > 8 ? ", …" : "")));
}
