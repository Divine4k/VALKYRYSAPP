// Start: runs last, after every other file is loaded.
"use strict";
// ------------------------------------------------------------ started here (not in their own files) so that nothing async runs before every file is loaded
if (desk) refreshFolder(); // from js/folder.js
if (desk) refreshPoFolder(); // knows whether a purchase-order folder is set (reading starts only when you look at that source)
// from js/news.js: in-app update state
if (UPD) {
  try { if (typeof UPD.onState === "function") UPD.onState(setUpd); } catch (e) {}
  Promise.resolve().then(() => UPD.state()).then(setUpd, () => {});
  setInterval(() => { if (state.tab === "settings" && upd.st) renderUpd(); }, 30000); // "last checked … ago" stays current
}
// ------------------------------------------------------------ start
fillSettingsForm(); fillDetails("sd", currentSender());
applyLang();
storeKey = "loading"; applyLang();
setTab("stats"); // the statistics are what opens first
(async () => {
  await unlockGate; // with a PIN set, nothing is loaded before it is entered
  let langPicked = window.ValkLangPicked in LANGS; // chosen on the first-start lock screen: it wins, and is saved once the data is there
  if (langPicked && window.ValkLangPicked !== state.lang) { state.lang = window.ValkLangPicked; applyLang(); }
  if (LK) { try { const ps = await LK.status(); pinHas = !!ps.has; renderPin(); } catch (e) {} } // a PIN made on the first-start screen
  const use = window.claude && window.claude.use ? (n) => window.claude.use(n) : async () => null;
  const [db, dl] = await Promise.all([use("db"), use("downloads")]);
  state.db = db; state.dl = dl;
  if (db) { try { const c = await db.doc("cache/folderindex").get(); const d = c.exists && c.data(); if (d && d.v === PARSER_VERSION && d.files) Object.entries(d.files).forEach(([k, v]) => state.parseCache.set(k, v)); } catch (e) {} }
  if (db) { try { const c = await db.doc("cache/poindex").get(); const d = c.exists && c.data(); if (d && d.v === PARSER_VERSION && d.files) Object.entries(d.files).forEach(([k, v]) => state.poCache.set(k, v)); } catch (e) {} }
  if (db) { try { const c = await db.doc("settings/theme").get();
    if (c.exists && !themeTouched) { const n = TH.sanitize(c.data()); if (n && JSON.stringify(n) !== JSON.stringify(themeState)) { themeState = n; TH.save(n); TH.apply(n); renderThemeUi(); } }
    else if (!c.exists && themeState.id !== "auto") themeSaveDb(); } catch (e) {} }
  if (db) { try { const c = await db.doc("settings/poskip").get(); if (c.exists && Array.isArray(c.data().list)) state.poSkip = new Set(c.data().list); } catch (e) {} }
  if (db) { try { const c = await db.doc("settings/sent").get(); if (c.exists && Array.isArray(c.data().list)) state.sent = new Set(c.data().list.map(String)); } catch (e) {} }
  if (db) { try { const c = await db.doc("settings/keptstale").get(); if (c.exists && Array.isArray(c.data().list)) state.keptStale = new Set(c.data().list.map(String)); } catch (e) {} }
  if (db) for (const [doc, k] of [["keptmissing", "keptMissing"], ["keptdupinv", "keptDupInv"]]) { try { const c = await db.doc("settings/" + doc).get(); if (c.exists && Array.isArray(c.data().list)) state[k] = new Set(c.data().list.map(String)); } catch (e) {} }
  if (db) { try { const c = await db.doc("settings/docsprefs").get(); if (c.exists) applyDocsPrefs(c.data()); } catch (e) {} renderDocs(); }
  if (db) { try { const c = await db.doc("settings/news").get(); const s = c.exists && c.data().seen; // seen in either place counts
    if (s && newsSeen !== NEWS_LATEST) { newsSeen = s; try { localStorage.setItem("valkyrys-news-seen", s); } catch (e) {} }
    else if (!s && newsSeen) db.doc("settings/news").set({ seen: newsSeen }); renderNewsDot(); } catch (e) {} }
  if (db) { try { const c = await db.doc("settings/statprefs").get(); if (c.exists) { applyStatPrefs(c.data()); if (state.tab === "stats") renderStats(); if (desk) refreshPoFolder(); } } catch (e) {} }
  state.dbResolve();
  storeKey = db ? "stored" : "notStored"; $("#storeNote").textContent = tr(storeKey);
  if (!dl) toast(tr("dlOnlyClaude"));
  await loadClients(db);
  if (!db) { state.invoicesLoaded = true; renderNewPos(); firstRun(); return; }
  db.doc("settings/main").onSnapshot((snap) => {
    if (snap.exists) { state.settings = Object.assign(structuredClone(DEFAULTS), snap.data()); state.settings.client = Object.assign({}, DEFAULTS.client, snap.data().client || {}); }
    if (!$("#settingsBox").contains(document.activeElement)) fillSettingsForm();
    syncDesign(); firstRun();
    render();
  }, () => {});
  db.doc("settings/prefs").onSnapshot((snap) => {
    const l = snap.exists && snap.data().lang;
    if (snap.exists) { prefsData = Object.assign({}, snap.data()); const sd = prefsData.side; if (sd === "min" || sd === "full") window.ValkSide.set(sd === "min"); }
    if (langPicked) { langPicked = false; saveLang(); return; }
    if (l && l in LANGS && l !== state.lang) { state.lang = l; try { localStorage.setItem("valkyrys-lang", l); } catch (e) {} applyLang(); }
  }, () => {});
  db.collection("invoices").onSnapshot((snap) => {
    // older saves could store a number that differs from the one on the invoice: the invoice number wins
    state.invoices = new Map(snap.docs.map((d) => { const x = d.data(); const m = /^(\d+)-(\d{4})$/.exec(String(x.factuurnr || "")); if (m) { x.nummer = +m[1]; x.jaar = +m[2]; } return [d.id, x]; }));
    state.invoicesLoaded = true;
    render();
  }, () => { state.invoicesLoaded = true; render(); });
})();
