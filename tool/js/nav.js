// Sidebar and tabs (setTab), statistics and new-PO event handlers.
"use strict";
const TABS = ["stats", "inv", "docs", "settings"], WORK_TABS = ["stats", "inv", "docs"], TAGLINE = { stats: "statsTagline", inv: "tagline", docs: "docsTagline", settings: "settingsTagline" };
const TABKEY = { stats: "tabStats", inv: "tabInvoices", docs: "tabDocs", settings: "tabSettings" };
// Page title follows the selected tab. In the icon rail (narrow window, labels hidden) the sidebar items get their label as a tooltip.
// The rail is html.rail (see ValkSide in the head): collapsed with the toggle at the bottom of the sidebar (or Ctrl+B), or forced in a narrow window.
function syncTabHead() {
  $("#pageTitle").textContent = tr(TABKEY[state.tab] || "tabStats");
  const rail = window.ValkSide.rail(), min = window.ValkSide.collapsed();
  document.querySelectorAll("#side .navi").forEach((b) => { const k = b.id === "newsBtn" ? "newsBtn" : TABKEY[b.dataset.tab]; if (rail) b.title = tr(k); else b.removeAttribute("title"); });
  const t = $("#sideToggle"), k = min ? "sideExpand" : "sideCollapse";
  t.dataset.i18nAria = k; t.setAttribute("aria-label", tr(k)); t.setAttribute("aria-expanded", String(!min)); t.title = tr(k) + " (Ctrl+B)";
}
window.ValkSideChanged = syncTabHead;
function setSide(min) { // the person's choice: remembered in localStorage (ValkSide) and settings/prefs.side
  if (!window.ValkSide.set(min)) return;
  if (state.db) savePrefs({ side: min ? "min" : "full" });
}
$("#sideToggle").addEventListener("click", () => setSide(!window.ValkSide.collapsed()));
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b" || window.ValkSide.forced()) return;
  const a = document.activeElement; if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || document.querySelector("dialog[open]")) return;
  e.preventDefault(); setSide(!window.ValkSide.collapsed());
});
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("side-anim"))); // no animation while the page is first drawn
function setTab(t) {
  state.tab = TABS.includes(t) ? t : "stats";
  const work = WORK_TABS.includes(state.tab); // with Settings open no tab is selected; the first tab stays reachable with Tab
  document.querySelectorAll("#tabs [role=tab]").forEach((b) => { const on = b.dataset.tab === state.tab; b.setAttribute("aria-selected", String(on)); b.tabIndex = on || (!work && b.dataset.tab === WORK_TABS[0]) ? 0 : -1; });
  $("#tabSettings").setAttribute("aria-pressed", String(state.tab === "settings"));
  $("#viewInv").hidden = state.tab !== "inv"; $("#statsView").hidden = state.tab !== "stats"; $("#settingsView").hidden = state.tab !== "settings"; $("#docsView").hidden = state.tab !== "docs";
  const tg = $("#tagline"); tg.dataset.i18n = TAGLINE[state.tab]; tg.textContent = tr(tg.dataset.i18n);
  syncTabHead(); renderUpd();
  if (state.tab === "stats") { renderStats(); if (desk) refreshPoFolder(); }
  if (state.tab === "docs") { renderDocs(); if (desk) refreshPoFolder(); } // the purchase orders are read if that has not happened yet
  window.scrollTo(0, 0);
}
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[role=tab]"); if (b) setTab(b.dataset.tab); });
$("#tabs").addEventListener("keydown", (e) => {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const T = WORK_TABS, cur = (e.target.closest("[role=tab]") || {}).dataset?.tab || state.tab, i = Math.max(0, T.indexOf(cur)); // the arrows go round the three work tabs only
  const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
  const next = e.key === "Home" ? T[0] : e.key === "End" ? T[T.length - 1] : T[(i + (back ? -1 : 1) + T.length) % T.length];
  setTab(next); document.querySelector(`#tabs [data-tab="${next}"]`).focus(); e.preventDefault();
});
$("#tabSettings").addEventListener("click", () => setTab("settings"));
$("#statsGoSettings").addEventListener("click", () => openSettings("folders"));
$("#dupOpen").addEventListener("click", openDup);
$("#dupDlgClose").addEventListener("click", () => $("#dupDlg").close());
$("#dupBody").addEventListener("click", async (e) => {
  const v = e.target.closest("button[data-dprev]"), s = e.target.closest("button[data-dshow]");
  if (v && desk) previewPo(v.dataset.dprev, v.dataset.po);
  else if (s && desk) { try { const r = await desk.revealFile(s.dataset.dshow, "pos"); if (r && r.error) toast(tr("dupShowFail")); } catch (err) { toast(tr("dupShowFail")); } }
});
$("#statMode").addEventListener("click", (e) => { const b = e.target.closest("button[data-mode]"); if (b) { state.statMode = b.dataset.mode; saveStatPrefs(); renderStats(); } });
$("#statSource").addEventListener("click", (e) => { const b = e.target.closest("button[data-src]"); if (b && desk) { state.statSource = b.dataset.src; saveStatPrefs(); renderStats(); if (state.statSource === "pos") refreshPoFolder(); } });
$("#poBasis").addEventListener("change", (e) => { state.poBasis = e.target.value === "order" ? "order" : "work"; saveStatPrefs(); renderStats(); });
$("#statYear").addEventListener("change", (e) => { state.statYear = +e.target.value; renderStats(); });
$("#statCsv").addEventListener("click", exportCsv);
$("#stTable").addEventListener("click", (e) => { if (clickSort("st", "#stTable", e)) return; const b = e.target.closest("button[data-per]"); if (b) openPeriod(b.dataset.per); });
$("#clTable").addEventListener("click", (e) => clickSort("cl", "#clTable", e));
$("#perDlgClose").addEventListener("click", () => $("#perDlg").close());
const setLines = (btn, on) => { btn.setAttribute("aria-expanded", String(on)); btn.firstElementChild.textContent = on ? "▾" : "▸"; $("#perTable").querySelectorAll(`tr[data-of="${btn.dataset.tog}"]`).forEach((r) => (r.hidden = !on)); };
$("#perTable").addEventListener("click", (e) => {
  const t = e.target.closest("button[data-tog]"); if (t) { setLines(t, t.getAttribute("aria-expanded") !== "true"); return; }
  const b = e.target.closest("button[data-prev]"); if (!b) return;
  if (b.dataset.prev === "po") { if (desk) previewPo(b.dataset.rel, b.dataset.key); }
  else { const x = (state.perRows || []).find((r) => r.key === b.dataset.key); if (x) previewInvoice(x); }
});
$("#perAll").addEventListener("click", (e) => { const all = e.currentTarget, on = all.dataset.on !== "1"; all.dataset.on = on ? "1" : "0"; all.textContent = tr(on ? "perHideLines" : "perShowLines"); $("#perTable").querySelectorAll("button[data-tog]").forEach((t) => setLines(t, on)); });
$("#poDlgClose").addEventListener("click", () => $("#poDlg").close());
$("#poDlg").addEventListener("close", () => { poPrevSeq++; $("#poPages").innerHTML = ""; }); // stops a page that is still being drawn
if (desk) {
  $("#npList").addEventListener("click", (e) => {
    const a = e.target.closest("[data-npadd]"), k = e.target.closest("[data-npskip]"), v = e.target.closest("[data-nppreview]");
    if (a) addPos([a.dataset.npadd]); else if (k) skipPos([k.dataset.npskip]);
    else if (v) { const x = state.poRecs.find((y) => y.r.po === v.dataset.nppreview); if (x) previewPo(x.f.rel, x.r.po); }
  });
  $("#poDlgOpen").addEventListener("click", async () => { try { const r = await desk.openFile($("#poDlg").dataset.rel, $("#poDlg").dataset.kind || undefined); if (r && r.error) toast(tr("openFail")); } catch (err) { toast(tr("openFail")); } });
  $("#poDlgAdd").addEventListener("click", () => { const po = $("#poDlgAdd").dataset.po; $("#poDlg").close(); addPos([po]); });
  $("#npAll").addEventListener("click", () => addPos(newPoItems().show.map((x) => x.r.po)));
  $("#npSkipAll").addEventListener("click", () => skipPos(newPoItems().show.map((x) => x.r.po)));
  $("#npRestore").addEventListener("click", () => { state.poSkip.clear(); savePoSkip(); renderNewPos(); });
  $("#npMore").addEventListener("click", () => { state.npAll = !state.npAll; renderNewPos(); });
  const pickPoFolder = async () => { try { const r = await desk.pickFolder(tr("folderDialogPo"), "pos"); if (r && !r.canceled) { await refreshPoFolder(); toast(tr("folderSetPo")); } } catch (e) {} };
  $("#npPick").addEventListener("click", pickPoFolder);
  $("#poFolderPick").addEventListener("click", pickPoFolder);
  $("#poFolderOpen").addEventListener("click", () => { desk.openFolder("pos").catch(() => {}); });
  $("#poFolderClear").addEventListener("click", async () => { try { await desk.clearFolder("pos"); await refreshPoFolder(); toast(tr("folderClearedPo")); } catch (e) {} });
  // refreshPoFolder() is started in js/init.js (once every file is loaded)
}

