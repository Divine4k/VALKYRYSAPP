// PIN settings and the language.
"use strict";
// ------------------------------------------------------------ PIN settings (desktop app: the lock screen itself is the script in the head)
const LK = window.valkyrysLock || null;
let pinHas = !!(LK && LK.state && LK.state.has), pinMode = "set";
function renderPin() {
  const panel = $("#pinPanel"); panel.hidden = !LK; if (!LK) return;
  $("#pinNote").textContent = tr(pinHas ? "pinOn" : "pinOffNote");
  const b = $("#pinSetBtn"); b.textContent = tr(pinHas ? "pinChange" : "pinSet"); b.classList.toggle("primary", !pinHas);
  $("#pinOffBtn").hidden = !pinHas; $("#pinOffBtn").textContent = tr("pinOffBtn");
}
function openPin(mode) {
  pinMode = mode;
  $("#pinDlgTitle").textContent = tr(mode === "set" ? "pinSet" : mode === "change" ? "pinChange" : "pinDlgOff");
  $("#pinCurWrap").hidden = mode === "set"; $("#pinNewWrap").hidden = $("#pinRepWrap").hidden = mode === "off";
  $("#pinSave").textContent = tr(mode === "off" ? "pinOffConfirm" : "pinSaveBtn");
  ["#pinCur", "#pinNew", "#pinRep"].forEach((i) => { $(i).value = ""; }); $("#pinErr").hidden = true;
  const d = $("#pinDlg"); if (!d.open) d.showModal();
  (mode === "set" ? $("#pinNew") : $("#pinCur")).focus();
}
if (LK) {
  $("#pinSetBtn").addEventListener("click", () => openPin(pinHas ? "change" : "set"));
  $("#pinOffBtn").addEventListener("click", () => openPin("off"));
  $("#pinDlgClose").addEventListener("click", () => $("#pinDlg").close());
  $("#pinForm").addEventListener("input", (e) => { if (e.target.matches("input")) { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 8); $("#pinErr").hidden = true; } });
  $("#pinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = (k, ...a) => { const el = $("#pinErr"); el.textContent = tr(k, ...a); el.hidden = false; };
    const cur = $("#pinCur").value, nw = $("#pinNew").value, rep = $("#pinRep").value, PIN = /^\d{4,8}$/;
    if (pinMode !== "set" && !PIN.test(cur)) return err("pinEWrong");
    if (pinMode !== "off") { if (!PIN.test(nw)) return err("pinEFormat"); if (nw !== rep) return err("pinEMismatch"); }
    const btn = $("#pinSave"); btn.disabled = true;
    try {
      const r = await (pinMode === "set" ? LK.setup(nw) : pinMode === "change" ? LK.change(cur, nw) : LK.remove(cur));
      if (r && r.ok) { pinHas = pinMode !== "off"; $("#pinDlg").close(); renderPin(); toast(tr(pinMode === "set" ? "pinSaved" : pinMode === "change" ? "pinChanged" : "pinRemoved")); }
      else if (r && r.wait) err("pinEWait", Math.ceil(r.wait / 1000));
      else if (r && r.ok === false && r.error === "format") err("pinEFormat");
      else if (r && r.ok === false && !r.error) err("pinEWrong");
      else err("pinEGeneric");
    } catch (x) { err("pinEGeneric"); }
    btn.disabled = false;
  });
}

// ------------------------------------------------------------ language
let storeKey = "";
function applyLang() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", tr(el.dataset.i18nAria)));
  const sel = $("#lang");
  if (!sel.options.length) sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  sel.value = state.lang;
  if (storeKey) $("#storeNote").textContent = tr(storeKey);
  updateFileHint();
  if ($("#dlg").open) $("#dlgTitle").textContent = tr("preview", $("#dlgTitle").dataset.nr || "");
  renderThemeUi(); renderPin(); renderTplUi(); if ($("#tplDlg").open) renderTplDlg(); renderNewsDot(); if ($("#newsDlg").open) renderNews(); renderUpd(); renderMail(); renderEyes(); window.ValkLockLang = state.lang; if (desk && $("#welcomeDlg").open) renderWelcome();
  render(); syncTabHead();
}
function saveLang() {
  try { localStorage.setItem("valkyrys-lang", state.lang); localStorage.setItem("valkyrys-lang-chosen", "1"); } catch (e) {}
  if (state.db) savePrefs({ lang: state.lang, langChosen: true });
}
let prefsData = {}; // last known settings/prefs (set() replaces the whole doc, so every write merges into this)
function savePrefs(v) { prefsData = Object.assign({}, prefsData, v); try { state.db.doc("settings/prefs").set(prefsData); } catch (e) {} }
$("#lang").addEventListener("change", (e) => { state.lang = e.target.value in LANGS ? e.target.value : "nl"; saveLang(); applyLang(); });
try { const saved = localStorage.getItem("valkyrys-lang"); state.lang = saved in LANGS ? saved : "nl"; } catch (e) { state.lang = "nl"; }

