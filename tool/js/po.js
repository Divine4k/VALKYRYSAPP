// The purchase-order folder, duplicate days dialog, new purchase orders (on the Invoices tab).
"use strict";
// ---- the second source: purchase order PDFs from the client, read from their own folder
const isPoRec = (r) => !!(r && r.po && r.items && r.items.length);
const slimPo = (p) => ({ po: p.po, orderDate: p.orderDate, orderedBy: p.orderedBy, kvk: p.kvk, btw: p.btw, poTotal: p.poTotal, items: p.items.map((i) => ({ qty: i.qty, price: i.price, total: i.total, dates: i.dates, work: i.work, kind: i.kind, desc: String(i.desc || "").slice(0, 120) })) });
async function refreshPoFolder() {
  if (!desk) return;
  let folder = null, files = [];
  try { folder = await desk.getFolder("pos"); if (folder && folder.exists) files = (await desk.listFiles("pos")).filter((f) => f.ext === "pdf"); } catch (e) { folder = null; files = []; }
  const sig = JSON.stringify([folder, files.map((f) => [f.rel, f.mtime, f.size])]);
  state.poFolder = folder; state.poChecked = true; renderPoFolderSet();
  if (sig !== state.poSig) {
    state.poSig = sig; state.poFiles = files;
    if (!folder || !folder.exists) { state.poRecs = []; state.poUnread = []; state.poScan = null; state.poScanSig = sig; state.poDup = null; state.poSame = []; }
  }
  if (state.tab === "stats") renderStats();
  renderNewPos();
  ensurePoScan();
}
const ensurePoScan = () => { if (state.poFolder && state.poFolder.exists && state.poScanSig !== state.poSig && !state.poScan) scanPos(); };
let poScanSeq = 0;
async function scanPos() {
  const id = ++poScanSeq, sig = state.poSig, files = state.poFiles;
  await state.dbReady; if (id !== poScanSeq) return;
  const recs = [], unread = []; let changed = false, done = 0;
  state.poScan = { done: 0, total: files.length };
  if (state.tab === "stats") renderStats();
  for (const f of files) {
    if (id !== poScanSeq) return;
    let e = state.poCache.get(f.rel);
    if (!e || e.mt !== f.mtime || e.sz !== f.size) {
      let r = null; try { const raw = await desk.readFile(f.rel, "pos"); if (raw) r = slimPo(core.parsePO(await pdfLines(new Uint8Array(raw), 5))); } catch (err) { r = null; }
      e = { mt: f.mtime, sz: f.size, r }; state.poCache.set(f.rel, e); changed = true;
    }
    if (isPoRec(e.r)) recs.push({ f, r: e.r }); else unread.push(f.rel);
    if (++done % 4 === 0) { state.poScan = { done, total: files.length }; if (state.tab === "stats") renderStats(); renderNewPos(); await tick(); }
  }
  if (id !== poScanSeq) return;
  const byPo = new Map(), same = new Map();
  for (const x of recs) { const o = byPo.get(x.r.po); if (!o || x.f.mtime > o.f.mtime) byPo.set(x.r.po, x); (same.get(x.r.po) || same.set(x.r.po, []).get(x.r.po)).push(x); } // one entry per PO number, newest file wins
  state.poRecs = [...byPo.values()]; state.poUnread = unread; state.poScan = null; state.poScanSig = sig;
  state.poSame = [...same.values()].filter((a) => a.length > 1).map((a) => a.slice().sort((x, y) => y.f.mtime - x.f.mtime)).sort((a, b) => natPo(a[0].r.po, b[0].r.po));
  try { state.poDup = poDupes(); } catch (e) { state.poDup = null; }
  const here = new Set(files.map((f) => f.rel)); for (const k of [...state.poCache.keys()]) if (!here.has(k)) { state.poCache.delete(k); changed = true; }
  if (changed && state.db) { try { await state.db.doc("cache/poindex").set({ v: PARSER_VERSION, files: Object.fromEntries(state.poCache) }); } catch (err) {} }
  if (state.tab === "stats") renderStats();
  renderNewPos();
  ensurePoScan(); // files may have changed while this scan was running
}

function renderPoFolderSet() {
  if (!desk) return;
  const f = state.poFolder, pick = $("#poFolderPick"), k = f ? "folderChange" : "folderPick";
  pick.dataset.i18n = k; pick.textContent = tr(k); pick.classList.toggle("primary", !f);
  const pe = $("#poFolderPath"); pe.hidden = !f; if (f) { pe.textContent = f.path; pe.title = f.path; pe.classList.toggle("bad", !f.exists); }
  $("#poFolderOpen").hidden = !(f && f.exists); $("#poFolderClear").hidden = !f;
  if (typeof renderMail === "function") renderMail(); // Connections says when there is no PO folder to fetch into
}

// ---- the same work day on more than one purchase order: a notice on the statistics, and a list to check them in
function renderDup() {
  const bar = $("#dupBar"), days = state.poDup ? state.poDup.days : 0, files = (state.poSame || []).length;
  const show = !!desk && !state.poScan && (days > 0 || files > 0);
  bar.hidden = !show; if (!show) return;
  $("#dupText").textContent = [days && tr("dupBanner", `${days} ${tr(plural(days))}`), files && tr("dupBannerSame", files)].filter(Boolean).join(" ");
}
function openDup() {
  const p2 = (n) => String(n).padStart(2, "0"), ymd = (t) => `${p2(t.d)}-${p2(t.mo + 1)}-${t.y}`, tag = (k, cls = "tagw") => `<span class="${cls}">${esc(tr(k))}</span>`;
  const btns = (f, po) => `<span class="da"><button type="button" data-dprev="${esc(f.rel)}" data-po="${esc(po)}">${esc(tr("npPreview"))}</button><button type="button" class="ghost" data-dshow="${esc(f.rel)}">${esc(tr("dupShow"))}</button></span>`;
  let html = "";
  const d = state.poDup;
  if (d && d.groups.length) {
    html += `<p class="dsec">${esc(tr("dupTitle"))}</p><p class="dintro">${esc(tr("dupIntro"))}</p>`;
    for (const g of d.groups) {
      html += `<div class="dgrp"><h3><span>${esc(tr("dupGroup", `${g.dates.length} ${tr(plural(g.dates.length))}`, g.pos.length))}</span>${g.rateDiffers ? tag("dupRateDiff") : ""}</h3><p class="dd">${esc(tr("dupDates", g.dates.map(ymd).join(", ")))}</p>`;
      for (const r of g.rows) {
        const meta = [r.orderDate && tr("dupOrdered", r.orderDate), r.prices.length && tr("dupRate", r.prices.map((x) => core.eur(x)).join(" / ")), tr("dupForDays", core.eur(r.sub))].filter(Boolean).join(" · ");
        html += `<div class="dpo"><div class="dn"><span class="num">${esc(r.po)}</span></div><div class="dm">${esc(meta)}</div><div class="dm">${esc(r.f.rel)}</div>${btns(r.f, r.po)}</div>`;
      }
      html += `</div>`;
    }
  }
  if ((state.poSame || []).length) {
    html += `<p class="dsec">${esc(tr("dupSameTitle"))}</p><p class="dintro">${esc(tr("dupSameIntro"))}</p>`;
    for (const arr of state.poSame) {
      const val = (x) => core.round2(x.r.items.reduce((a, i) => a + (isFinite(i.total) ? i.total : 0), 0));
      html += `<div class="dgrp"><h3><span class="num">${esc(arr[0].r.po)}</span>${new Set(arr.map(val)).size > 1 ? tag("dupAmountDiff") : ""}</h3>`;
      arr.forEach((x, n) => {
        const meta = [tr("dupModified", fmtDate(x.f.mtime)), x.r.orderDate && tr("dupOrdered", x.r.orderDate), core.eur(val(x))].filter(Boolean).join(" · ");
        html += `<div class="dpo"><div class="dn"><span>${esc(x.f.name)}</span>${n === 0 ? tag("dupCounted", "tagi") : ""}</div><div class="dm">${esc(meta)}</div><div class="dm">${esc(x.f.rel)}</div>${btns(x.f, x.r.po)}</div>`;
      });
      html += `</div>`;
    }
  }
  $("#dupBody").innerHTML = html;
  const dlg = $("#dupDlg"); if (!dlg.open) dlg.showModal();
}

// ---- new purchase orders: the ones in the Piguillet folder that have no invoice yet (shown on the Facturen tab)
const poMentioned = (text, po) => { if (!text || !po) return false; const e = String(po).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return new RegExp("(?<![A-Za-z0-9])" + e + "(?![A-Za-z0-9])", "i").test(text); };
/** a PO counts as invoiced when an invoice names it: one made in the app, one read from the invoice folder, or an invoice file with the PO number in its name */
const poInvoiced = (po) => {
  for (const i of state.invoices.values()) if (poMentioned(i.po, po)) return true;
  for (const i of state.folderInvoices || []) if (poMentioned(i.po, po)) return true;
  for (const f of state.files) if (NUM_IN_NAME.test(f.name.replace(/\.[^.]+$/, "")) && poMentioned(f.name, po)) return true;
  return false;
};
const poSortKey = (r) => {
  const re = /^(\d{1,2})-(\d{1,2})-(\d{4})$/, first = (r.items.find((i) => i.dates && i.dates.length) || { dates: [] }).dates[0] || "";
  const m = re.exec(r.orderDate || "") || re.exec(first); return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : 0;
};
function newPoItems() {
  const open = new Set(state.cards.filter((c) => !c.error && c.po).map((c) => c.po)); // already in the list below
  const all = state.poRecs.filter((x) => !poInvoiced(x.r.po) && !open.has(x.r.po));
  all.sort((a, b) => poSortKey(a.r) - poSortKey(b.r) || String(a.r.po).localeCompare(String(b.r.po), "nl", { numeric: true })); // oldest first: they get the lowest invoice numbers
  return { show: all.filter((x) => !state.poSkip.has(x.r.po)), skipped: all.filter((x) => state.poSkip.has(x.r.po)).length };
}
const NP_ROWS = 6;
function renderNewPos() {
  renderDocs(); // the Documents tab follows the same updates (folders read, invoices changed, purchase orders read)
  if (typeof renderAuto === "function") renderAuto(); // the automatic (beta) run card
  renderStale(); renderDocWarns();
  const panel = $("#newPo"); panel.hidden = !desk || !state.poChecked; if (panel.hidden) return;
  const note = $("#npNote"), list = $("#npList"), on = (id, v) => { $(id).hidden = !v; };
  ["#npAll", "#npMore", "#npSkipAll", "#npPick", "#npRestore"].forEach((i) => on(i, false));
  list.innerHTML = "";
  const f = state.poFolder, pick = $("#npPick");
  const setPick = (key, primary) => { pick.dataset.i18n = key; pick.textContent = tr(key); pick.classList.toggle("primary", primary); pick.classList.toggle("ghost", !primary); pick.title = ""; on("#npPick", true); };
  if (!f) { note.textContent = tr("npNoFolder"); setPick("folderPick", true); return; }
  if (!f.exists) { note.textContent = tr("folderMissing"); setPick("folderChange", true); return; }
  if (state.poScanSig === "" || !state.invoicesLoaded || !state.folderScanned) { // not everything is known yet: do not guess
    const total = state.poScan ? state.poScan.total : state.poFiles.length;
    note.textContent = total ? tr("npReading", state.poScan ? state.poScan.done : 0, total) : ""; return;
  }
  const { show, skipped } = newPoItems(), shown = state.npAll ? show : show.slice(0, NP_ROWS);
  const parts = [];
  if (show.length) parts.push(tr(show.length === 1 ? "npOne" : "npMany", show.length));
  else if (!skipped) parts.push(state.poRecs.length ? tr("npNone", state.poRecs.length) : tr("npEmpty"));
  if (skipped) parts.push(tr("npSkipped", skipped));
  if (state.poUnread.length) parts.push(tr("npUnread", state.poUnread.length, state.poUnread.slice(0, 3).join(", ") + (state.poUnread.length > 3 ? "…" : "")));
  note.textContent = parts.join(" ");
  const dis = state.npBusy ? " disabled" : "";
  list.innerHTML = shown.map(({ r }) => {
    const days = r.items.reduce((a, i) => a + core.dayEquivalent(i, !!(i.work && i.work.length)), 0), val = r.items.reduce((a, i) => a + (isFinite(i.total) ? i.total : 0), 0);
    const meta = [r.orderDate && tr("npOrdered", r.orderDate), days > 0 && `${core.qty(days)} ${tr(plural(days))}`, core.eur(val)].filter(Boolean).join(" · ");
    return `<li><span class="t num">${esc(r.po)}</span><span class="s">${esc(meta)}</span><span class="redo"><button type="button" class="primary" data-npadd="${esc(r.po)}"${dis}>${esc(tr("npAdd"))}</button><button type="button" class="ghost" data-nppreview="${esc(r.po)}" title="${esc(tr("npPreviewTitle"))}">${esc(tr("npPreview"))}</button><button type="button" class="ghost" data-npskip="${esc(r.po)}" title="${esc(tr("npSkipTitle"))}"${dis}>${esc(tr("npSkip"))}</button></span></li>`;
  }).join("");
  const all = $("#npAll"); all.textContent = tr("npAddAll", show.length); all.disabled = state.npBusy; on("#npAll", show.length > 1);
  $("#npMore").textContent = tr(state.npAll ? "npLess" : "npMore", show.length); on("#npMore", show.length > NP_ROWS);
  on("#npSkipAll", show.length > 1); on("#npRestore", skipped > 0);
  setPick("folderChange", false); pick.title = f.path; // changing the folder is possible from here too
}
const savePoSkip = () => { if (state.db) { try { state.db.doc("settings/poskip").set({ list: [...state.poSkip] }); } catch (e) {} } };
/** loads the chosen purchase orders into the list below, exactly as if their PDFs were dropped on it */
async function addPos(pos) {
  if (state.npBusy || !pos.length) return;
  state.npBusy = true; renderNewPos();
  let added = 0, failed = false;
  try {
    const files = [];
    for (const po of pos) {
      const x = state.poRecs.find((y) => y.r.po === po); if (!x) continue;
      const raw = await desk.readFile(x.f.rel, "pos"); if (!raw) { failed = true; continue; }
      files.push(new File([new Uint8Array(raw)], x.f.name, { type: "application/pdf" }));
    }
    const before = state.cards.length;
    if (files.length) await addFiles(files);
    added = state.cards.length - before;
  } catch (e) { failed = true; }
  state.npBusy = false;
  render();
  if (added) { toast(tr("npAdded", added)); $("#cards").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  if (failed || !added) toast(tr("npFail"));
}
const skipPos = (pos) => { pos.forEach((p) => state.poSkip.add(p)); savePoSkip(); renderNewPos(); };

