// What's new (changelog.js) and in-app updates (Settings panel and bars).
"use strict";
// ------------------------------------------------------------ what's new (tool/changelog.js; last seen version in settings/news, localStorage as fallback)
const NEWS = Array.isArray(window.VALK_CHANGELOG) ? window.VALK_CHANGELOG : [];
const NEWS_LATEST = NEWS.length ? NEWS[0].version : "";
let newsSeen = null;
try { newsSeen = localStorage.getItem("valkyrys-news-seen"); } catch (e) {}
function renderNewsDot() {
  const un = !!NEWS_LATEST && newsSeen !== NEWS_LATEST;
  $("#newsDot").hidden = !un; $("#newsBtn").classList.toggle("unseen", un); $("#newsBtn").setAttribute("aria-label", tr(un ? "newsUnseen" : "newsBtnAria"));
}
/** the latest notes count as read: dot off, remembered in the browser and in the saved data */
function markNewsSeen() {
  if (!NEWS_LATEST || newsSeen === NEWS_LATEST) return;
  newsSeen = NEWS_LATEST;
  try { localStorage.setItem("valkyrys-news-seen", NEWS_LATEST); } catch (e) {}
  if (state.db) { try { state.db.doc("settings/news").set({ seen: NEWS_LATEST }); } catch (e) {} }
  renderNewsDot();
}
const NEWS_TYPES = [["new", "newsNew"], ["improved", "newsImproved"], ["fixed", "newsFixed"]];
function newsDate(d) { try { return new Date(d + "T12:00:00").toLocaleDateString({ nl: "nl-NL", en: "en-GB", pl: "pl-PL" }[state.lang] || "nl-NL", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return d; } }
/** the items of one release grouped New / Improved / Fixed in the current language (also used for the notes of an available update) */
function newsGroupsHtml(items) {
  const L = state.lang;
  return NEWS_TYPES.map(([type, key]) => { const its = (items || []).filter((it) => it.type === type); return its.length ? `<div class="ngrp" data-type="${type}"><span class="ntag ${type}">${esc(tr(key))}</span><ul>${its.map((it) => `<li>${esc(it[L] || it.nl || it.en || "")}</li>`).join("")}</ul></div>` : ""; }).join("");
}
function renderNews() {
  $("#newsList").innerHTML = NEWS.map((rel, i) => `<section class="nrel" data-version="${esc(rel.version)}"><h3>${esc(tr("newsVersion", rel.version))}<span class="ndate">${esc(newsDate(rel.date))}</span>${i === 0 ? `<span class="nlatest">${esc(tr("newsLatest"))}</span>` : ""}</h3>` +
    newsGroupsHtml(rel.items) + `</section>`).join("");
  $("#newsVer").textContent = NEWS_LATEST ? tr("newsVersion", NEWS_LATEST) : "";
}
$("#newsBtn").addEventListener("click", () => { renderNews(); const d = $("#newsDlg"); if (!d.open) d.showModal(); $("#newsList").scrollTop = 0; markNewsSeen(); });
$("#newsClose").addEventListener("click", () => $("#newsDlg").close());
$("#newsDlg").addEventListener("click", (e) => { if (e.target === $("#newsDlg")) $("#newsDlg").close(); });

// ------------------------------------------------------------ in-app updates: window.valkyrysUpdate from the desktop app's preload (none in a plain browser = no update UI).
// The app checks by itself 15 s after start (at most every 6 h) and pushes every change through onState.
// window.__valkUpdateFake: the tests put a stand-in here (the preload's bridge cannot be replaced); null acts as a plain browser.
const UPD = ("__valkUpdateFake" in window ? window.__valkUpdateFake : window.valkyrysUpdate) || null;
const UPD_DISMISS = "valkyrys-upd-dismissed", UPD_RB = "valkyrys-upd-rolledback-seen"; // localStorage: the available version whose bar was closed; the rolled-back version already told about
const upd = { st: null, later: "", fromBar: false, sig: "" };
const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const updLoc = () => ({ nl: "nl-NL", en: "en-GB", pl: "pl-PL" })[state.lang] || "nl-NL";
function updAgo(iso) {
  const t = Date.parse(iso || ""); if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000); if (s < 60) return tr("updJustNow");
  const [n, u] = s < 3600 ? [s / 60, "minute"] : s < 86400 ? [s / 3600, "hour"] : [s / 86400, "day"];
  try { return new Intl.RelativeTimeFormat(updLoc(), { numeric: "auto" }).format(-Math.floor(n), u); } catch (e) { return ""; }
}
const updSize = (b) => (b > 0 ? (b / 1048576).toLocaleString(updLoc(), { maximumFractionDigits: 1 }) + " MB" : "");
const updPct = (st) => Math.round(Math.min(1, Math.max(0, +st.progress || 0)) * 100);
const X_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
function updBarsList(st) {
  const s = st.status, lv = (st.latest && st.latest.version) || "", bars = [], onSet = state.tab === "settings";
  if (st.rolledBack && lsGet(UPD_RB) !== st.rolledBack) bars.push({ k: "rb", warn: true, text: tr("updRolledBack", st.rolledBack), btns: [["x"]] });
  if (s === "ready" && upd.later !== lv) bars.push({ k: "ready", text: tr("updReadyBar"), btns: [["restart", "primary", "updRestart"], ["later", "ghost", "updLater"]] });
  else if (s === "downloading" && upd.fromBar && !onSet) bars.push({ k: "dl", text: tr("updDlBar", lv, updPct(st)), prog: updPct(st), btns: [["x"]] });
  else if (s === "available" && lv && !onSet && lsGet(UPD_DISMISS) !== lv) bars.push({ k: "avail", text: tr("updAvailable", lv), btns: [["view", "", "updView"], ["install", "primary", "updInstall"], ["x"]] });
  return bars;
}
function renderUpdBars(st) {
  const bars = st ? updBarsList(st) : [], box = $("#updBars"), sig = bars.map((b) => b.k).join() + "|" + state.lang;
  box.hidden = !bars.length; document.body.classList.toggle("upd-on", !!bars.length);
  if (sig === upd.sig) { bars.forEach((b) => { const el = box.querySelector(`[data-upd="${b.k}"]`); if (!el) return; el.querySelector(".utext").textContent = b.text; const p = el.querySelector(".updprog > span"); if (p) p.style.width = b.prog + "%"; }); return; } // only text/progress changed: keep focus
  upd.sig = sig;
  box.innerHTML = bars.map((b) => `<div class="updbar${b.warn ? " warn" : ""}" role="${b.warn ? "alert" : "status"}" data-upd="${b.k}"><span class="utext">${esc(b.text)}</span>` +
    b.btns.map(([a, cls, key]) => a === "x" ? `<button type="button" class="ghost xbtn" data-upd-act="x" aria-label="${esc(tr("close"))}" title="${esc(tr("close"))}">${X_SVG}</button>` : `<button type="button"${cls ? ` class="${cls}"` : ""} data-upd-act="${a}">${esc(tr(key))}</button>`).join("") +
    (b.prog !== undefined ? `<div class="updprog"><span style="width:${b.prog}%"></span></div>` : "") + `</div>`).join("");
}
function renderUpd() {
  if (!UPD) { $("#updPanel").hidden = true; $("#updBars").hidden = true; $("#updDot").hidden = true; return; }
  const st = upd.st; $("#updPanel").hidden = !st; if (!st) return;
  const s = st.status, lv = (st.latest && st.latest.version) || "", busy = s === "checking" || s === "downloading", ago = updAgo(st.lastCheck);
  $("#updVer").textContent = tr("newsVersion", st.running || NEWS_LATEST);
  const line = { checking: tr("updChecking"), available: tr("updAvailable", lv), downloading: tr("updDownloading", updPct(st)), ready: tr("updReady", lv), error: tr("updError", st.error || "?"),
    uptodate: tr("updUpToDate") + (ago ? " · " + tr("updLastCheck", ago) : "") }[s] || (ago ? tr("updLastCheckCap", ago) : tr("updNever"));
  const sl = $("#updStatus"); sl.textContent = line; sl.dataset.status = s || "idle";
  $("#updProg").hidden = s !== "downloading"; $("#updProgBar").style.width = updPct(st) + "%";
  $("#updCheck").hidden = s === "ready"; $("#updCheck").disabled = busy;
  const size = updSize(st.latest && st.latest.size), ib = $("#updInstall");
  ib.hidden = s !== "available"; ib.textContent = tr("updInstall") + (size ? ` (${size})` : "");
  $("#updRestart").hidden = s !== "ready";
  const notes = (st.latest && Array.isArray(st.latest.notes) && st.latest.notes) || [], showNotes = !!notes.length && ["available", "downloading", "ready"].includes(s);
  $("#updNotes").hidden = !showNotes;
  if (showNotes) { $("#updNotesSum").textContent = tr("updNotesSum", lv); $("#updNotesList").innerHTML = newsGroupsHtml(notes); }
  const dot = ["available", "downloading", "ready"].includes(s); $("#updDot").hidden = !dot;
  $("#tabSettings").setAttribute("aria-label", tr(dot ? "updDotAria" : "tabSettings"));
  renderUpdBars(st);
}
function setUpd(st) { if (!st || typeof st !== "object") return; upd.st = st; renderUpd(); }
async function updCall(name, interim) {
  if (!UPD) return;
  if (interim && upd.st) setUpd(Object.assign({}, upd.st, interim));
  try { setUpd(await UPD[name]()); } catch (e) { setUpd(Object.assign({}, upd.st, { status: "error", error: String((e && e.message) || e) })); }
}
const updInstall = () => updCall("install", { status: "downloading", progress: 0 });
$("#updCheck").addEventListener("click", () => updCall("check", { status: "checking" }));
$("#updInstall").addEventListener("click", updInstall);
$("#updRestart").addEventListener("click", () => UPD && UPD.restart());
$("#updBars").addEventListener("click", (e) => {
  const b = e.target.closest("[data-upd-act]"), bar = b && b.closest("[data-upd]"), st = upd.st; if (!b || !st) return;
  const lv = (st.latest && st.latest.version) || "", k = bar.dataset.upd;
  switch (b.dataset.updAct) {
    case "x": if (k === "rb") lsSet(UPD_RB, st.rolledBack); else if (k === "avail") lsSet(UPD_DISMISS, lv); else if (k === "dl") upd.fromBar = false; break;
    case "view": openSettings("upd"); $("#updNotes").open = true; $("#updPanel").scrollIntoView({ block: "start" }); $("#updInstall").focus({ preventScroll: true }); break;
    case "install": upd.fromBar = true; updInstall(); break;
    case "restart": UPD.restart(); break;
    case "later": upd.later = lv; break;
  }
  renderUpd();
});
// the update state is fetched from js/init.js (once every file is loaded)
