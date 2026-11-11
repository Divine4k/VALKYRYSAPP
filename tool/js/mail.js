// Settings › Connections: e-mail accounts the app fetches purchase orders from ("Inkooporder PO-######" mails with the PDF), into the PO folder.
// The work (logging in, looking, saving) happens in the desktop app (electron-app/mailfetch.js); this page only shows the accounts and adds/removes them.
"use strict";
const MAIL = window.valkyrysMail || null;
const mailUi = { st: null, prov: "gmail", sure: "" };
const MAIL_NAMES = { gmail: "Gmail", wp: "WP Poczta", imap: "IMAP" };
const MAIL_ICON = { gmail: "G", wp: "WP", imap: "@" };
const mailLocale = () => ({ nl: "nl-NL", en: "en-GB", pl: "pl-PL" })[state.lang] || "nl-NL";
function mailWhen(ms) {
  const d = new Date(ms), now = new Date(), t = d.toLocaleTimeString(mailLocale(), { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? t : d.toLocaleDateString(mailLocale(), { day: "numeric", month: "short" }) + " " + t;
}
const mailErr = (code, prov) => tr("mailE_" + (["auth", "apppass", "net", "tls", "missing", "host", "dup", "nofolder"].includes(code) ? code : "other")) + (code === "auth" && (prov === "gmail" || prov === "wp") ? " " + tr("mailEauth_" + prov) : "");

function mailStatus(a) {
  if (a.busy) return { cls: "", text: tr("mailBusy") };
  if (!a.enabled) return { cls: "", text: tr("mailOff") };
  if (a.error) return { cls: "bad", text: mailErr(a.error, a.provider) };
  if (!a.lastCheck) return { cls: "", text: tr("mailNever") };
  const inMail = typeof a.inMail === "number" ? " · " + tr(a.inMail === 0 ? "mailInMail0" : a.inMail === 1 ? "mailInMail1" : "mailInMailN", a.inMail) : "";
  return { cls: "ok", text: tr("mailChecked", mailWhen(a.lastCheck)) + inMail + (a.found ? " · " + tr(a.found === 1 ? "mailFound1" : "mailFoundN", a.found) : "") };
}
function renderMail() {
  const panel = $("#mailPanel"); if (!panel) return;
  panel.hidden = !(MAIL && desk); if (panel.hidden) return;
  $("#mailNoPo").hidden = !(state.poChecked && !(state.poFolder && state.poFolder.exists));
  const list = (mailUi.st && mailUi.st.accounts) || [];
  const ul = $("#mailList"); ul.hidden = !list.length;
  ul.innerHTML = list.map((a) => {
    const s = mailStatus(a), sure = mailUi.sure === a.id;
    return `<li class="mrow${a.enabled ? "" : " off"}" data-id="${esc(a.id)}"><span class="mico" aria-hidden="true">${MAIL_ICON[a.provider] || "@"}</span><div class="minfo">`
      + `<p class="fsub">${esc(MAIL_NAMES[a.provider] || a.host)} <span class="muser">${esc(a.user)}</span></p>`
      + `<p class="small mstat ${s.cls}" role="status">${esc(s.text)}</p>`
      + `<div class="frow"><label class="mtog"><input type="checkbox" data-mtog${a.enabled ? " checked" : ""}>${esc(tr("mailOn"))}</label>`
      + `<button type="button" data-mcheck${a.busy ? ' class="spin" disabled' : ""}${a.enabled ? "" : " disabled"}>${esc(tr("mailCheck"))}</button>`
      + `<button type="button" class="ghost" data-mdel>${esc(tr(sure ? "mailDelSure" : "mailDel"))}</button></div></div></li>`;
  }).join("");
  const add = $("#mailAdd"); add.classList.toggle("primary", !list.length); add.textContent = tr(list.length ? "mailAddMore" : "mailAdd");
  const mode = (mailUi.st && mailUi.st.mode) || "auto";
  $("#mailMode").hidden = !list.length;
  document.querySelectorAll('#mailMode input[name="mailMode"]').forEach((r) => { r.checked = r.value === mode; });
  const pend = (mailUi.st && mailUi.st.pending) || [];
  $("#mailPend").hidden = !pend.length;
  $("#mailPendList").innerHTML = pend.map((p) => `<li data-key="${esc(p.key)}"><span class="pname">${esc(mailPo(p.name))}${p.at ? `<span class="pwhen">${esc(mailWhen(p.at))}</span>` : ""}</span>`
    + `<button type="button" class="primary" data-pdl>${esc(tr("mailDownload"))}</button><button type="button" class="ghost" data-pign>${esc(tr("mailIgnore"))}</button></li>`).join("");
  $("#mailPendAll").hidden = $("#mailPendIgn").hidden = pend.length < 2;
  renderMailNotes();
}
// ---- the notice at the top of the Invoices tab ("you have new purchase orders in your email"), and a dot on Facturen in the sidebar
const mailPo = (n) => String(n).replace(/\.pdf$/i, "");
const mailNames = (list) => { const n = list.map(mailPo); return n.length > 4 ? n.slice(0, 4).join(", ") + " " + tr("mailMore", n.length - 4) : n.join(", "); };
const mailGotText = (names) => tr(names.length === 1 ? "mailNoteTitle1" : "mailNoteTitleN") + " " + mailNames(names);
const mailFoundText = mailGotText;
const MAIL_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
function renderMailNotes() {
  const box = $("#mailNotes"), st = mailUi.st; if (!box) return;
  const notes = [];
  if (MAIL && desk && st) {
    const pend = st.pending || [], unseen = st.unseen || [], psig = pend.map((p) => p.key).join();
    if (pend.length && mailUi.hideFound !== psig) notes.push({ k: "found", title: tr(pend.length === 1 ? "mailNoteTitle1" : "mailNoteTitleN"), sub: tr(pend.length === 1 ? "mailNoteAsk1" : "mailNoteAskN", mailNames(pend.map((p) => p.name))),
      btns: [["dl", "primary", pend.length > 1 ? "mailDlAll" : "mailDownload"], ["ign", "ghost", pend.length > 1 ? "mailIgnAll" : "mailIgnore"], ["x"]] });
    if (unseen.length) notes.push({ k: "got", title: tr(unseen.length === 1 ? "mailNoteTitle1" : "mailNoteTitleN"), sub: tr(unseen.length === 1 ? "mailNoteGot1" : "mailNoteGotN", mailNames(unseen)), btns: [["ok", "primary", "mailNoteOk"]] });
  }
  box.hidden = !notes.length;
  const dot = $("#invDot"); if (dot) dot.hidden = !notes.length;
  const sig = JSON.stringify(notes.map((b) => [b.k, b.title, b.sub]));
  if (sig === mailUi.noteSig) return; mailUi.noteSig = sig; // unchanged: keep focus
  box.innerHTML = notes.map((b) => `<div class="panel mailnote" role="status" data-mnote="${b.k}"><span class="mnico">${MAIL_SVG}</span><div class="mntext"><p class="mntitle">${esc(b.title)}</p><p class="mnsub">${esc(b.sub)}</p></div><div class="mnact">` +
    b.btns.map(([a, cls, key]) => a === "x" ? `<button type="button" class="ghost xbtn" data-mnote-act="x" aria-label="${esc(tr("close"))}" title="${esc(tr("close"))}">${X_SVG}</button>` : `<button type="button"${cls ? ` class="${cls}"` : ""} data-mnote-act="${a}">${esc(tr(key))}</button>`).join("") + `</div></div>`).join("");
}
function mailSet(st) {
  if (!st || !Array.isArray(st.accounts)) return;
  mailUi.st = st; renderMail();
  const away = !document.hasFocus();
  if (st.saved && st.saved.length) {
    refreshPoFolder();
    if (st.downloaded) toast(st.saved.length === 1 ? tr("mailDownloaded1", mailPo(st.saved[0])) : tr("mailDownloadedN", st.saved.length));
    else if (away) MAIL.notify(tr("mailNotifTitle"), mailGotText(st.saved)).catch(() => {});
  }
  if (st.found && st.found.length && away) MAIL.notify(tr("mailNotifTitle"), mailFoundText(st.found)).catch(() => {});
}
/** check every switched-on mailbox now (the refresh buttons); resolves when done, never fails */
function mailCheckAll() {
  const list = (mailUi.st && mailUi.st.accounts) || [];
  if (!(MAIL && desk) || !list.some((a) => a.enabled)) return Promise.resolve();
  return MAIL.check().catch(() => {});
}
async function mailDownload(keys) {
  let r; try { r = await MAIL.download(keys || null); } catch (e) { r = { error: "other" }; }
  if (r && r.error && !(r.saved && r.saved.length)) toast(mailErr(r.error));
}

// ---- the add dialog
function mailProvUi() {
  const p = mailUi.prov;
  $("#mailHelp").textContent = tr("mailHelp_" + p);
  $("#mailPassLbl").textContent = tr(p === "gmail" ? "mailAppPass" : "mailPass");
  $("#mailHostWrap").hidden = p !== "imap";
  $("#mailUser").placeholder = p === "gmail" ? "naam@gmail.com" : p === "wp" ? "naam@wp.pl" : "";
}
function openMailDlg() {
  mailUi.prov = "gmail";
  document.querySelectorAll('#mailForm input[name="mailProv"]').forEach((r) => { r.checked = r.value === "gmail"; });
  ["#mailUser", "#mailPass", "#mailHost"].forEach((i) => { $(i).value = ""; });
  $("#mailErr").hidden = true; $("#mailSave").disabled = false; $("#mailSave").textContent = tr("mailConnect");
  mailProvUi();
  const d = $("#mailDlg"); if (!d.open) d.showModal();
  $("#mailUser").focus();
}

if (MAIL && desk) {
  const gate = window.__valkUnlock || Promise.resolve(); // after the PIN, like every folder access
  gate.then(() => MAIL.state()).then(mailSet, () => {});
  MAIL.onChange(mailSet);
  $("#mailAdd").addEventListener("click", openMailDlg);
  $("#mailDlgClose").addEventListener("click", () => $("#mailDlg").close());
  $("#mailForm").addEventListener("change", (e) => { if (e.target.name === "mailProv") { mailUi.prov = e.target.value; $("#mailErr").hidden = true; mailProvUi(); } });
  $("#mailForm").addEventListener("input", () => { $("#mailErr").hidden = true; });
  $("#mailForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#mailSave"); if (btn.disabled) return;
    const p = mailUi.prov, user = $("#mailUser").value.trim();
    let pass = $("#mailPass").value; if (p === "gmail") pass = pass.replace(/\s+/g, ""); // Google shows app passwords in groups of four
    const err = (code) => { const el = $("#mailErr"); el.textContent = mailErr(code, p); el.hidden = false; };
    if (!user || !pass) return err("missing");
    if (p === "imap" && !$("#mailHost").value.trim()) return err("host");
    btn.disabled = true; btn.textContent = tr("mailConnecting");
    let r; try { r = await MAIL.add({ provider: p, user, pass, host: $("#mailHost").value.trim() }); } catch (x) { r = { error: "other" }; }
    btn.disabled = false; btn.textContent = tr("mailConnect");
    if (!r || !r.ok) return err((r && r.error) || "other");
    $("#mailPass").value = "";
    $("#mailDlg").close();
    toast(tr("mailAdded", user));
    try { mailSet(await MAIL.state()); } catch (x) {}
  });
  $("#mailList").addEventListener("change", (e) => {
    const t = e.target.closest("[data-mtog]"), li = e.target.closest("li[data-id]"); if (!t || !li) return;
    MAIL.setEnabled(li.dataset.id, t.checked).catch(() => {});
  });
  $("#mailMode").addEventListener("change", (e) => { if (e.target.name === "mailMode") MAIL.setMode(e.target.value).catch(() => {}); });
  $("#mailPendList").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-key]"); if (!li) return;
    if (e.target.closest("[data-pdl]")) { e.target.closest("button").disabled = true; mailDownload([li.dataset.key]); }
    else if (e.target.closest("[data-pign]")) MAIL.ignore([li.dataset.key]).catch(() => {});
  });
  $("#mailPendAll").addEventListener("click", () => mailDownload());
  $("#mailPendIgn").addEventListener("click", () => MAIL.ignore(null).catch(() => {}));
  $("#mailNotes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mnote-act]"), note = b && b.closest("[data-mnote]"); if (!b) return;
    const act = b.dataset.mnoteAct, st = mailUi.st || {};
    if (note.dataset.mnote === "got") { MAIL.seen().catch(() => {}); mailSet(Object.assign({}, st, { unseen: [], saved: null, found: null })); return; }
    if (act === "dl") { b.disabled = true; mailDownload(); return; }
    if (act === "ign") { MAIL.ignore(null).catch(() => {}); return; }
    if (act === "x") { mailUi.hideFound = (st.pending || []).map((p) => p.key).join(); renderMailNotes(); }
  });
  let sureTimer = 0;
  $("#mailList").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]"); if (!li) return; const id = li.dataset.id;
    if (e.target.closest("[data-mcheck]")) { MAIL.check(id).catch(() => {}); return; }
    if (e.target.closest("[data-mdel]")) {
      clearTimeout(sureTimer);
      if (mailUi.sure !== id) { mailUi.sure = id; renderMail(); const b = $(`#mailList li[data-id="${id}"] [data-mdel]`); if (b) b.focus(); sureTimer = setTimeout(() => { mailUi.sure = ""; renderMail(); }, 5000); return; } // ask once: press again to disconnect
      mailUi.sure = ""; MAIL.remove(id).catch(() => {});
    }
  });
}
