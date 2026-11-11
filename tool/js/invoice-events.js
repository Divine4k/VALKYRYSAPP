// Events of the invoice cards, the settings form, file picking and dropping.
"use strict";
// ------------------------------------------------------------ events
const findCard = (el) => { const art = el.closest("[data-id]"); return art && state.cards.find((c) => c.id === art.dataset.id); };

$("#cards").addEventListener("input", (e) => {
  const el = e.target, c = findCard(el); if (!c || el.dataset.line == null) return;
  const l = c.lines[+el.dataset.line], k = el.dataset.k;
  if (k === "desc") l.desc = el.value;
  else { const v = core.parseAmount(el.value || "0"); if (!isNaN(v)) l[k] = v; }
  const art = el.closest("[data-id]");
  art.querySelector(`[data-amt="${el.dataset.line}"]`).textContent = core.eur(core.round2(l.tarief * l.aantal));
  art.querySelector("[data-total]").textContent = core.eur(core.totals(c.lines, c.btw).total);
});
$("#cards").addEventListener("change", (e) => {
  const el = e.target, c = findCard(el); if (!c) return;
  const k = el.dataset.k;
  if (k === "nr") {
    const m = el.value.trim().match(/^(\d+)\s*-\s*(\d{4})$/);
    if (m) { c.nummer = +m[1]; c.jaar = +m[2]; c.done = false; c.manual = true; } else toast(tr("nrFormat"));
  } else if (k === "date" && el.value) {
    c.dateISO = el.value;
    const y = +el.value.slice(0, 4);
    if (y !== c.jaar) { c.jaar = y; c.nummer = nextNumber(y, c); }
  } else if (k === "btw") c.btw = el.value;
  else if (k === "client") { const p = clientById(el.value); c.clientId = p ? p.id : null; if (p && !c.done) c.btw = clientFields(p.fields).btw; }
  render();
});
$("#cards").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const c = findCard(b); if (!c) return;
  if (b.dataset.act === "remove") { state.cards = state.cards.filter((x) => x !== c); renumber(); render(); }
  if (b.dataset.act === "preview") preview(invoiceData(c));
  if (b.dataset.act === "download") downloadCard(c, b);
  if (b.dataset.act === "download-docx") downloadCard(c, b, "docx");
  if (b.dataset.act === "download-both") downloadCard(c, b, "both");
});
$("#zipAll").addEventListener("click", (e) => downloadAll(e.currentTarget));
$("#saveAs").addEventListener("click", openSaveAs);
$("#saveDlgClose").addEventListener("click", () => $("#saveDlg").close());
["#saveInPo", "#saveInPdf", "#saveInDocx", "#saveModeDir", "#saveModeZip"].forEach((s) => $(s).addEventListener("change", saveDlgSync));
$("#saveGo").addEventListener("click", saveAsRun);
$("#clear").addEventListener("click", () => { state.cards = []; render(); });
$("#dlgClose").addEventListener("click", () => $("#dlg").close());

$("#settings").addEventListener("submit", async (e) => {
  e.preventDefault();
  const s = {
    ...state.settings, startNumber: Math.max(1, parseInt($("#sStart").value, 10) || 1), startYear: new Date().getFullYear(),
    betaaltermijn: $("#sTerm").value.trim() || "14 dagen", btw: $("#sBtw").value, fileTemplate: $("#sFile").value.trim() || DEFAULTS.fileTemplate,
    client: { name: $("#cName").value.trim(), street: $("#cStreet").value.trim(), city: $("#cCity").value.trim(), kvk: $("#cKvk").value.trim(), btw: $("#cBtw").value.trim() },
  };
  state.settings = s;
  state.cards.forEach((c) => { c.manual = false; });
  renumber();
  if (state.db) { try { await state.db.doc("settings/main").set(s); toast(tr("settingsSaved")); } catch (err) { toast(tr("saveFail")); } }
  else toast(tr("notPersisted"));
  render(); renderClientMod();
});

// file picking and dropping
const drop = $("#drop"), file = $("#file");
file.addEventListener("change", () => { addFiles(file.files); file.value = ""; });
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => { e.preventDefault(); if (!drop.contains(e.target) && e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

