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
  return { cls: "ok", text: tr("mailChecked", mailWhen(a.lastCheck)) + (a.found ? " · " + tr(a.found === 1 ? "mailFound1" : "mailFoundN", a.found) : "") };
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
}
function mailSet(st) {
  if (!st || !Array.isArray(st.accounts)) return;
  mailUi.st = st; renderMail();
  if (st.saved && st.saved.length) { refreshPoFolder(); toast(st.saved.length === 1 ? tr("mailGot1", st.saved[0]) : tr("mailGotN", st.saved.length)); }
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
