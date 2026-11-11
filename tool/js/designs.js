// First start (folders) and invoice design + own details (templates, imported Word designs).
"use strict";
// ------------------------------------------------------------ first start: the folders are asked for before anything else
function renderWelcome() {
  const put = (path, row, pick, f) => {
    const e = $(path); e.textContent = f ? f.path : tr("welcomeNone"); e.classList.toggle("dim", !f); e.classList.toggle("bad", !!(f && !f.exists)); $(row).classList.toggle("ok", !!(f && f.exists));
    const k = f ? "folderChange" : "folderPick"; $(pick).textContent = tr(k); $(pick).classList.toggle("primary", !f);
  };
  put("#wsInvPath", "#wsInv", "#wsInvPick", state.folder); put("#wsPoPath", "#wsPo", "#wsPoPick", state.poFolder);
  $("#wsDone").disabled = !(state.folder || state.poFolder);
}
function markWelcomed() { if (state.welcomed) return; state.welcomed = true; try { desk.setWelcomed(); } catch (e) {} }
async function maybeWelcome() {
  if (!desk || !desk.getWelcomed) return;
  let done = false; try { done = await desk.getWelcomed(); } catch (e) { return; }
  if (done) { state.welcomed = true; return; }
  await Promise.all([refreshFolder(), refreshPoFolder()]);
  if (state.folder || state.poFolder) { markWelcomed(); return; } // the folders were set before (an update of the older version): nothing to ask
  renderWelcome(); const dlg = $("#welcomeDlg"); if (!dlg.open) dlg.showModal();
}
if (desk) {
  $("#wsInvPick").addEventListener("click", async () => { try { const r = await desk.pickFolder(tr("folderDialog")); if (r && !r.canceled) { await refreshFolder(); renderWelcome(); } } catch (e) {} });
  $("#wsPoPick").addEventListener("click", async () => { try { const r = await desk.pickFolder(tr("folderDialogPo"), "pos"); if (r && !r.canceled) { await refreshPoFolder(); renderWelcome(); } } catch (e) {} });
  $("#wsDone").addEventListener("click", () => $("#welcomeDlg").close());
  $("#wsLater").addEventListener("click", () => $("#welcomeDlg").close());
  $("#welcomeDlg").addEventListener("close", () => { markWelcomed(); });
}

// ------------------------------------------------------------ invoice design and own details
// The design (Valkyrys, Extreme Building, ...) and the person's details live in settings/main: state.settings.template and state.settings.sender.
// Only what the person typed is saved in sender; everything else comes from the design's defaults (see invoice-templates.js).
// builtins === false: an install made since the designs are the person's own (written by server.js on a fresh install). The built-in designs are
// not offered there and there is no design until one is imported; absent = an older install, which keeps the built-ins. Old invoices keep theirs (recordLook).
const builtinsHidden = () => state.settings.builtins === false;
const offered = () => TP.TEMPLATES.filter((t) => t.custom || !builtinsHidden());
const hasDesign = () => !builtinsHidden() || offered().some((t) => t.id === state.settings.template);
const currentTemplate = () => (hasDesign() ? TP.get(state.settings.template).id : "");
const currentSender = () => (hasDesign() ? TP.senderFor(currentTemplate(), state.settings.sender) : Object.fromEntries(TP.FIELDS.map((k) => [k, String((state.settings.sender || {})[k] || "").trim()])));
const DET_LABEL = { name: "dName", person: "dPerson", street: "dStreet", city: "dCity", phone: "dPhone", email: "dEmail", iban: "dIban", btw: "dBtw", kvk: "dKvk" };
const missingLabels = (miss) => miss.map((k) => tr(DET_LABEL[k])).join(", ");
const detailsOk = () => hasDesign() && !TP.missing(currentSender()).length;
function needDetails() { toast(hasDesign() ? tr("detMissing", missingLabels(TP.missing(currentSender()))) : tr("tplNoneToast")); openSettings("me"); return false; }
const mountDetails = (host, p) => { host.innerHTML = $("#detTpl").innerHTML.replace(/\{p\}/g, p); };
const readDetails = (p) => Object.fromEntries(TP.FIELDS.map((k) => [k, $("#" + p + k).value.trim()]));
const fillDetails = (p, s) => TP.FIELDS.forEach((k) => { $("#" + p + k).value = s[k] || ""; });
mountDetails($("#detFields"), "sd"); mountDetails($("#wzFields"), "wz");

async function saveSettingsDoc(next) {
  state.settings = next;
  if (state.db) { try { await state.db.doc("settings/main").set(next); return true; } catch (err) { toast(tr("saveFail")); return false; } }
  toast(tr("notPersisted")); return false;
}
function renderTplUi() {
  const has = hasDesign(), id = currentTemplate(), t = TP.get(id), miss = TP.missing(currentSender());
  const img = $("#tplCurImg"); img.hidden = !has; if (has && img.getAttribute("src") !== t.preview) img.src = t.preview;
  $("#tplCurName").textContent = has ? t.name : tr("tplNone"); $("#tplCurDesc").textContent = has ? tplDesc(t) : tr("tplNoneDesc");
  $("#tplCurHint").textContent = tr(has ? "tplCurHint" : "tplEmptyHint"); $("#tplChange").textContent = tr(has ? "tplChange" : "tplAddBtn");
  $("#detWarn").hidden = !miss.length; $("#detWarn").textContent = miss.length ? tr("detMissing", missingLabels(miss)) : "";
  $("#detBar").hidden = has && !miss.length; $("#detBarText").textContent = !has ? tr("tplNoneBar") : miss.length ? tr("detBar", missingLabels(miss)) : "";
  $("#detBarGo").textContent = tr(has ? "detBarGo" : "tplNoneGo");
}
const tplDesc = (t) => tr(t.custom ? "tplDesc_custom" : "tplDesc_" + t.id);

// Own designs: Word files the person imported. settings.customTemplates = [{ id, name, file }] (file in <data folder>/templates, read through the
// desktop app); the browser version keeps the file itself in the list (b64). The designs are listed at once and their files are read afterwards.
const customLoads = new Map();
const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const customReady = (id) => customLoads.get(id) || Promise.resolve(null);
function syncCustoms() {
  const entries = Array.isArray(state.settings.customTemplates) ? state.settings.customTemplates : [];
  for (const t of TP.setCustomList(entries)) {
    if (t.bytes || customLoads.has(t.id)) continue;
    const e = entries.find((c) => c.id === t.id) || {};
    customLoads.set(t.id, (async () => {
      const raw = e.b64 ? fromB64(e.b64) : desk && desk.readTemplate && e.file ? await desk.readTemplate(e.file) : null;
      if (!raw || !window.JSZip) return null;
      await TP.loadCustom(JSZip, t.id, new Uint8Array(raw));
      if (currentTemplate() === t.id) syncDesign(); else renderTplUi();
      if ($("#tplDlg").open && !$("#tplStep1").hidden) renderTplDlg();
      return t;
    })().catch(() => null));
  }
}
/** a design's own details go into the fields the person left empty (or that still hold the previous design's details); returns the filled fields */
function fillFromDesign(stored, t, old) {
  const filled = [];
  for (const k of TP.FIELDS) {
    const v = String(t.sender[k] || ""), cur = stored[k] === undefined ? undefined : String(stored[k]).trim();
    if (!v) continue;
    if (cur === undefined || cur === "" || (old && cur === String(old.sender[k] || "") && cur !== v)) { delete stored[k]; filled.push(k); }
  }
  return filled;
}
async function addCustomBytes(name, bytes, imported) {
  const fail = () => { if (desk && imported && imported.file) desk.removeTemplate(imported.file).catch(() => {}); $("#tplAddWarn").textContent = tr("tplAddFail"); $("#tplAddWarn").hidden = false; };
  try { const z = await JSZip.loadAsync(bytes); if (!z.file("word/document.xml")) return fail(); } catch (err) { return fail(); }
  const id = imported ? imported.id : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const entry = imported ? { id, name, file: imported.file } : { id, name, b64: toB64(bytes) };
  const list = [...(Array.isArray(state.settings.customTemplates) ? state.settings.customTemplates : []), entry];
  TP.setCustomList(list);
  const p = TP.loadCustom(JSZip, id, bytes).catch(() => null); customLoads.set(id, p); await p;
  await saveSettingsDoc({ ...state.settings, customTemplates: list });
  tplPick = id; renderTplDlg(); toast(tr("tplAdded", name));
  const nb = $("#tplGrid [data-tpl='" + id + "']"); if (nb) nb.focus();
}
async function addCustom() {
  $("#tplAddWarn").hidden = true;
  if (!(desk && desk.importTemplate)) { $("#tplFile").value = ""; $("#tplFile").click(); return; } // the browser version: a file input
  let r; try { r = await desk.importTemplate(tr("tplAdd")); } catch (err) { r = { error: "read" }; }
  if (!r || r.canceled) return;
  if (r.error || !r.bytes) { $("#tplAddWarn").textContent = tr("tplAddFail"); $("#tplAddWarn").hidden = false; return; }
  await addCustomBytes(r.name || "Ontwerp", new Uint8Array(r.bytes), r);
}
$("#tplFile").addEventListener("change", async () => {
  const f = $("#tplFile").files[0]; if (!f) return;
  if (!/\.docx$/i.test(f.name) || f.size > 30 * 1024 * 1024) { $("#tplAddWarn").textContent = tr("tplAddFail"); $("#tplAddWarn").hidden = false; return; }
  await addCustomBytes(f.name.replace(/\.docx$/i, ""), new Uint8Array(await f.arrayBuffer()), null);
});
async function removeCustom(id) {
  const t = TP.get(id), list = (state.settings.customTemplates || []).filter((c) => c.id !== id), e = (state.settings.customTemplates || []).find((c) => c.id === id);
  if (!t.custom || !confirm(tr("tplRemoveAsk", t.name))) return;
  const next = { ...state.settings, customTemplates: list };
  if (state.settings.template === id) { const rest = builtinsHidden() ? list[0] : { id: "valkyrys" }; if (rest) next.template = rest.id; else delete next.template; } // own designs only: the next one, or none
  if (desk && desk.removeTemplate && e && e.file) desk.removeTemplate(e.file).catch(() => {});
  customLoads.delete(id); TP.setCustomList(list);
  await saveSettingsDoc(next);
  if (tplPick === id) tplPick = tplMode === "first" ? "" : currentTemplate();
  renderTplDlg(); syncDesign(); render();
}
const syncDesign = () => { syncCustoms(); if (!$("#detForm").contains(document.activeElement)) fillDetails("sd", currentSender()); renderTplUi(); };

let tplMode = "change", tplPick = "", wzShown = {};
function renderTplDlg() {
  const list = offered(), own = builtinsHidden();
  $("#tplGrid").innerHTML = (list.length ? "" : `<p class="tplempty" id="tplEmpty"><strong>${esc(tr("tplEmpty"))}</strong><span>${esc(tr("tplEmptyHint"))}</span></p>`) + list.map((t) => `<div class="tplitem"><button type="button" class="tplopt" role="radio" aria-checked="${t.id === tplPick}" data-tpl="${esc(t.id)}"><img src="${esc(t.preview)}" alt=""><span class="tname">${esc(t.name)}</span><span class="tdesc">${esc(tplDesc(t))}</span></button>`
    + (t.custom ? `<button type="button" class="ghost tdel" data-tpl-del="${esc(t.id)}" title="${esc(tr("tplRemove"))}" aria-label="${esc(tr("tplRemove") + ": " + t.name)}">×</button>` : "") + `</div>`).join("")
    + `<div class="tplitem"><button type="button" class="tplopt tpladd" id="tplAdd"><span class="tplplus" aria-hidden="true">+</span><span class="tname">${esc(tr("tplAdd"))}</span><span class="tdesc">${esc(tr("tplAddHint"))}</span></button></div>`;
  $("#tplIntro").textContent = tr(tplMode === "first" ? (own ? "tplIntroOwn" : "tplIntroFirst") : "tplIntroChange");
  $("#tplSkip").hidden = !(tplMode === "first" && own); // a fresh install may start without a design (invoices wait until one is added)
  $("#tplNext").textContent = tr(tplMode === "first" ? "tplNext" : "tplUse");
  $("#tplNext").disabled = !tplPick; $("#tplDlgClose").hidden = tplMode === "first";
}
function openTpl(mode) {
  tplMode = mode; tplPick = mode === "first" ? "" : currentTemplate();
  $("#tplStep1").hidden = false; $("#tplStep2").hidden = true; $("#wzWarn").hidden = true;
  renderTplDlg(); const d = $("#tplDlg"); if (!d.open) d.showModal();
  if (mode === "first" && document.activeElement && document.activeElement.blur) document.activeElement.blur(); // no card looks chosen before the person chose
}
$("#tplGrid").addEventListener("click", (e) => {
  if (e.target.closest("#tplAdd")) { addCustom(); return; }
  const del = e.target.closest("[data-tpl-del]"); if (del) { removeCustom(del.dataset.tplDel); return; }
  const b = e.target.closest("[data-tpl]"); if (!b) return;
  tplPick = b.dataset.tpl; renderTplDlg(); const nb = $("#tplGrid [data-tpl='" + tplPick + "']"); if (nb) nb.focus();
});
$("#tplChange").addEventListener("click", () => openTpl("change"));
$("#tplDlgClose").addEventListener("click", () => $("#tplDlg").close());
$("#tplDlg").addEventListener("cancel", (e) => { if (tplMode === "first") e.preventDefault(); }); // the first choice cannot be skipped
$("#tplNext").addEventListener("click", async () => {
  if (!tplPick) return;
  if (tplMode === "change") { // the details stay; only the company name follows the design when it was never changed by hand
    const old = hasDesign() ? TP.get(currentTemplate()) : null, stored = { ...(state.settings.sender || {}) };
    if (stored.name === undefined || (old && stored.name === old.sender.name)) delete stored.name;
    await customReady(tplPick); // an own design: its details are read from its Word file
    const filled = old && old.id === tplPick ? [] : fillFromDesign(stored, TP.get(tplPick), old);
    await saveSettingsDoc({ ...state.settings, template: tplPick, sender: stored });
    $("#detFromTpl").hidden = filled.length < 2; // (one field, the company name, is no news)
    $("#tplDlg").close(); syncDesign(); render(); return;
  }
  await customReady(tplPick);
  const t = TP.get(tplPick), stored = { ...(state.settings.sender || {}) }, filled = fillFromDesign(stored, t, null), sender = TP.senderFor(t.id, stored);
  // what the person already typed in this step (anything that is not what the previous design put there) stays
  for (const k of TP.FIELDS) { const cur = $("#wz" + k).value.trim(); if (cur && cur !== String(wzShown[k] || "")) sender[k] = cur; }
  wzShown = { ...sender };
  fillDetails("wz", sender);
  $("#wzFromTpl").hidden = filled.filter((k) => sender[k] === t.sender[k]).length < 2;
  $("#wzstart").value = t.settings.startNumber ?? state.settings.startNumber;
  $("#tplStep1").hidden = true; $("#tplStep2").hidden = false; $("#wzWarn").hidden = true;
  $("#wz" + (TP.FIELDS.find((k) => !sender[k]) || "name")).focus();
});
$("#tplBack").addEventListener("click", () => { $("#tplStep2").hidden = true; $("#tplStep1").hidden = false; });
async function finishFirst(strict) {
  const sender = readDetails("wz"), miss = TP.missing(sender);
  if (strict && miss.length) { $("#wzWarn").textContent = tr("detMissing", missingLabels(miss)); $("#wzWarn").hidden = false; $("#wz" + miss[0]).focus(); return; }
  const t = TP.get(tplPick), start = Math.max(1, parseInt($("#wzstart").value, 10) || 1);
  await saveSettingsDoc({ ...state.settings, ...t.settings, template: t.id, sender, startNumber: start, startYear: new Date().getFullYear() });
  $("#tplDlg").close(); fillSettingsForm(); syncDesign(); renumber(); render();
}
$("#tplStep2").addEventListener("submit", (e) => { e.preventDefault(); finishFirst(true); });
$("#tplLater").addEventListener("click", () => finishFirst(false));
$("#tplSkip").addEventListener("click", async () => { await saveSettingsDoc({ ...state.settings, designSkipped: true }); $("#tplDlg").close(); syncDesign(); render(); }); // not asked again at the next start
$("#detForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#detFromTpl").hidden = true;
  if (await saveSettingsDoc({ ...state.settings, ...(hasDesign() ? { template: currentTemplate() } : {}), sender: readDetails("sd") })) toast(tr("detSaved"));
  renderTplUi(); render();
});
$("#detBarGo").addEventListener("click", () => { openSettings("me"); if (!hasDesign()) return openTpl("change"); const m = TP.missing(currentSender())[0]; if (m) $("#sd" + m).focus(); });
/** first start: the design is chosen (and the details filled in) before the folders are asked for */
async function firstRun() {
  if (state.firstRunDone) return; state.firstRunDone = true;
  const fresh = state.db && !state.settings.template && !state.settings.designSkipped; // (designSkipped: a fresh install that chose to add its design later)
  if (fresh) markNewsSeen(); // a fresh install: everything is new, no "what's new" dot
  if (fresh && window.ValkLangStep && !window.ValkLangChosen()) { // no lock screen came first (it asks the language itself): ask it here, once
    let asked = false; try { const c = await state.db.doc("settings/prefs").get(); asked = c.exists && !!c.data().langChosen; } catch (e) {}
    if (!asked) { const l = await window.ValkLangStep(); if (l in LANGS) { state.lang = l; saveLang(); applyLang(); } }
  }
  if (fresh) await new Promise((res) => { $("#tplDlg").addEventListener("close", res, { once: true }); openTpl("first"); });
  maybeWelcome();
}

