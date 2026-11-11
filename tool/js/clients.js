// Client presets (settings/clients) in Settings and on the cards.
"use strict";
// ------------------------------------------------------------ client presets: settings/clients = { list: [{ id, name, fields }], active }
// fields = what belongs to a client: client {name, street, city, kvk, btw}, betaaltermijn and the VAT mode (btw). Start number and file name stay global.
// The active client's fields are copied into settings/main, which is what invoices use (as before presets existed).
const CL = { list: [], active: null };
const CL_KEYS = ["name", "street", "city", "kvk", "btw"];
const clientFields = (s) => ({ client: Object.fromEntries(CL_KEYS.map((k) => [k, String((s && s.client && s.client[k]) || "").trim()])),
  betaaltermijn: String((s && s.betaaltermijn) || "").trim() || DEFAULTS.betaaltermijn, btw: (s && s.btw) || DEFAULTS.btw });
const formClientFields = () => clientFields({ client: { name: $("#cName").value, street: $("#cStreet").value, city: $("#cCity").value, kvk: $("#cKvk").value, btw: $("#cBtw").value }, betaaltermijn: $("#sTerm").value, btw: $("#sBtw").value });
const sameFields = (a, b) => JSON.stringify(clientFields(a)) === JSON.stringify(clientFields(b));
const clientById = (id) => (id && CL.list.find((c) => c.id === id)) || null;
const newClientId = () => "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function putClientFields(f) {
  $("#cName").value = f.client.name; $("#cStreet").value = f.client.street; $("#cCity").value = f.client.city; $("#cKvk").value = f.client.kvk; $("#cBtw").value = f.client.btw;
  $("#sTerm").value = f.betaaltermijn; $("#sBtw").value = f.btw;
}
/** the client a card's invoice goes to: its own preset when it was made for another than the active one, else what settings/main says */
function cardClient(c) {
  if (c && c.noPo && !c.clientId) return clientFields(c.own); // an invoice without a PO, for a client typed on the card
  const p = c && c.clientId && c.clientId !== CL.active && clientById(c.clientId); return p ? clientFields(p.fields) : clientFields(state.settings);
}
function renderClientMod() {
  const act = clientById(CL.active), mod = !!act && !sameFields(act.fields, formClientFields());
  $("#clMod").hidden = !mod; $("#clUpdate").disabled = !mod; $("#clDelete").disabled = !act;
}
function renderClients() {
  const sel = $("#clPick");
  sel.innerHTML = CL.list.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("") + `<option value="">${esc(tr("clNew"))}</option>`;
  sel.value = clientById(CL.active) ? CL.active : "";
  renderClientMod();
}
async function saveClients() {
  renderClients();
  if (state.db) { try { await state.db.doc("settings/clients").set({ list: CL.list, active: CL.active }); } catch (e) { toast(tr("saveFail")); } }
}
/** make these client fields the ones invoices use (settings/main); cards that follow the active client get its VAT mode */
async function applyClient(f) {
  state.cards.forEach((c) => { if (!c.error && !c.done && (!c.clientId || c.clientId === CL.active)) { c.clientId = CL.active; c.btw = f.btw; } });
  await saveSettingsDoc({ ...state.settings, ...structuredClone(f) });
  render(); renderClientMod();
}
async function loadClients(db) {
  if (db) { try {
    const c = await db.doc("settings/clients").get();
    if (c.exists) { const d = c.data(); CL.list = (Array.isArray(d.list) ? d.list : []).filter((x) => x && x.id && x.fields); CL.active = clientById(d.active) ? d.active : null; }
    else { // first start with presets: the client that was filled in becomes the first preset
      const m = await db.doc("settings/main").get(), s = m.exists && m.data();
      if (s && s.client && String(s.client.name || "").trim()) { const f = clientFields(s), id = newClientId(); CL.list = [{ id, name: f.client.name, fields: f }]; CL.active = id; await saveClients(); }
    } } catch (e) {} }
  renderClients();
}
$("#clPick").addEventListener("change", async (e) => {
  const p = clientById(e.target.value);
  $("#clNameRow").hidden = true;
  if (!p) { CL.active = null; putClientFields(clientFields({})); $("#cName").focus(); await saveClients(); return; } // a new client: empty fields, saved with "Opslaan als klant"
  CL.active = p.id; putClientFields(clientFields(p.fields)); await saveClients();
  await applyClient(clientFields(p.fields)); toast(tr("clActive", p.name));
});
$("#settings").addEventListener("input", (e) => { if (e.target.id !== "clNewName") renderClientMod(); });
$("#settings").addEventListener("change", (e) => { if (e.target.id !== "clPick") renderClientMod(); });
$("#clSaveNew").addEventListener("click", () => { $("#clNameRow").hidden = false; const n = $("#clNewName"); n.value = $("#cName").value.trim(); n.focus(); n.select(); });
$("#clNameCancel").addEventListener("click", () => { $("#clNameRow").hidden = true; });
$("#clNewName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#clNameOk").click(); } else if (e.key === "Escape") { e.preventDefault(); $("#clNameRow").hidden = true; } });
$("#clNameOk").addEventListener("click", async () => {
  const name = $("#clNewName").value.trim(); if (!name) { toast(tr("clNeedName")); $("#clNewName").focus(); return; }
  const f = formClientFields(), id = newClientId();
  CL.list.push({ id, name, fields: f }); CL.active = id; $("#clNameRow").hidden = true;
  await saveClients(); await applyClient(f); toast(tr("clSaved", name));
});
$("#clUpdate").addEventListener("click", async () => {
  const p = clientById(CL.active); if (!p) return;
  p.fields = formClientFields(); await saveClients(); await applyClient(p.fields); toast(tr("clUpdated", p.name));
});
$("#clDelete").addEventListener("click", async () => {
  const p = clientById(CL.active); if (!p || !confirm(tr("clDelAsk", p.name))) return;
  CL.list = CL.list.filter((c) => c !== p); CL.active = null;
  state.cards.forEach((c) => { if (c.clientId === p.id) c.clientId = null; });
  await saveClients(); render(); toast(tr("clDeleted", p.name));
});

