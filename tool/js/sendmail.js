// Sending invoices by email (Documents tab): tick invoices, "Per e-mail versturen…", one email with their PDFs attached, through a connected mailbox
// (electron-app/mailfetch.js sends it by SMTP). The recipient (per client), subject and text are remembered in settings/mailsend; {placeholders} are filled in.
"use strict";
const sendUi = { sets: [], files: [], prefs: null, client: "", busy: false };

/** the ticked invoices that still exist, lowest number first */
function sendSets() {
  const sel = state.docs.sel, all = docSets().filter((s) => !s.poOnly && sel.has(s.nr));
  for (const n of [...sel]) if (!all.some((s) => s.nr === n)) sel.delete(n); // deleted in the meantime
  return all.sort((a, b) => a.y - b.y || a.n - b.n);
}
function renderSendBar() {
  const bar = $("#sendBar"); if (!bar) return;
  const sets = desk ? sendSets() : [], n = sets.length, total = sets.reduce((a, s) => a + (+s.total || 0), 0);
  bar.hidden = !n; if (!n) return;
  $("#sendBarText").textContent = tr(n === 1 ? "sendBar1" : "sendBarN", n, core.eur(total));
}
/** {placeholders}: {nummers} {lijst} {totaal} {aantal} {naam} {Factuur}/{factuur} (singular or plural) */
function sendFill(t, sets) {
  const snd = currentSender(), many = sets.length !== 1;
  const v = {
    nummers: sets.map((s) => s.nr).join(", "), aantal: String(sets.length), naam: (snd.person || snd.name || "").trim(),
    totaal: core.eur(sets.reduce((a, s) => a + (+s.total || 0), 0)), Factuur: many ? "Facturen" : "Factuur", factuur: many ? "facturen" : "factuur",
    lijst: sets.map((s) => "• Factuur " + s.nr + (s.po ? " – " + s.po : "") + (s.total != null ? " – " + core.eur(s.total) : "")).join("\n"),
  };
  return String(t || "").replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}
const sendSize = (n) => (n >= 1048576 ? (n / 1048576).toLocaleString(mailLocale(), { maximumFractionDigits: 1 }) + " MB" : Math.max(1, Math.round(n / 1024)) + " kB");
function renderSendAtt() {
  $("#sendAttList").innerHTML = sendUi.files.map((f) => `<li class="${f.bad ? "bad" : ""}"><span>${esc(f.name)}</span><small>${esc(f.bad ? tr("sendNoPdf") : f.bytes ? sendSize(f.bytes.length) : tr("sendLoading"))}</small></li>`).join("");
}
const sendAddrs = () => $("#sendTo").value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const sendBook = () => (sendUi.prefs && Array.isArray(sendUi.prefs.book) ? sendUi.prefs.book : []);
/** the saved addresses as buttons: a click puts one in "Aan" (or takes it out again); × forgets it. Below: save the new ones typed? */
function renderSendBook() {
  const book = sendBook(), now = sendAddrs().map((x) => x.toLowerCase());
  $("#sendBook").hidden = !book.length;
  $("#sendBookList").innerHTML = book.map((a) => { const on = now.includes(a.toLowerCase()); return `<span class="abook${on ? " on" : ""}"><button type="button" class="abpick" data-addr="${esc(a)}" aria-pressed="${on}">${on ? "✓ " : "+ "}${esc(a)}</button><button type="button" class="abdel" data-forget="${esc(a)}" aria-label="${esc(tr("sendForget", a))}" title="${esc(tr("sendForget", a))}">×</button></span>`; }).join("");
  const fresh = sendAddrs().filter((x) => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(x) && !book.some((b) => b.toLowerCase() === x.toLowerCase()));
  $("#sendSaveWrap").hidden = !fresh.length; $("#sendSaveLbl").textContent = tr(fresh.length === 1 ? "sendSave1" : "sendSaveN", fresh.join(", "));
}
const saveSendPrefs = async () => { try { await state.db.doc("settings/mailsend").set(sendUi.prefs || {}); } catch (x) {} };
function renderSendPrev() {
  $("#sendPrevSubj").textContent = sendFill($("#sendSubj").value, sendUi.sets);
  $("#sendPrevText").textContent = sendFill($("#sendText").value, sendUi.sets);
}
/** the PDF of each invoice: the file in the invoice folder, or drawn again from the app's record */
async function sendLoadFiles(sets) {
  sendUi.files = sets.map((s) => ({ nr: s.nr, name: s.pdf ? s.pdf.name : `${s.nr}.pdf`, bytes: null, bad: false }));
  renderSendAtt();
  await Promise.all(sets.map(async (s, i) => {
    const f = sendUi.files[i];
    try {
      if (s.pdf && desk) { const raw = await desk.readFile(s.pdf.rel); f.bytes = raw ? new Uint8Array(raw) : null; }
      else if (s.inv && s.inv.lines && s.inv.lines.length) {
        const i0 = s.inv, data = { factuurnr: i0.factuurnr, datum: i0.datum, betaaltermijn: i0.betaaltermijn || state.settings.betaaltermijn, client: i0.client || state.settings.client, lines: i0.lines, btw: i0.btw || "verlegd", ...recordLook(i0) };
        f.bytes = new Uint8Array(await buildPdf(data)); f.name = fileName(data, i0.po, "pdf");
      }
    } catch (e) { f.bytes = null; }
    f.bad = !f.bytes; renderSendAtt();
  }));
}
async function openSend() {
  const sets = sendSets(); if (!sets.length) return;
  sendUi.sets = sets; sendUi.busy = false;
  const accs = ((mailUi.st && mailUi.st.accounts) || []).filter((a) => a.enabled);
  $("#sendNoAcc").hidden = !!accs.length; $("#sendFields").hidden = !accs.length;
  $("#sendErr").hidden = true; $("#sendSubmit").disabled = false; $("#sendSubmit").textContent = tr("sendSubmit");
  $("#sendDlgTitle").textContent = tr(sets.length === 1 ? "sendTitle1" : "sendTitleN", sets.length);
  const d = $("#sendDlg"); if (!d.open) d.showModal();
  if (!accs.length) { $("#sendGoMail").focus(); return; }
  $("#sendFrom").innerHTML = accs.map((a) => `<option value="${esc(a.id)}">${esc(a.user)}</option>`).join(""); $("#sendFromWrap").hidden = accs.length < 2;
  let p = sendUi.prefs;
  if (!p) { p = {}; try { const doc = await state.db.doc("settings/mailsend").get(); if (doc.exists) p = doc.data() || {}; } catch (e) {} sendUi.prefs = p; }
  if (!Array.isArray(p.book)) { p.book = String(p.lastTo || "").split(/[\s,;]+/).filter(Boolean); delete p.to; delete p.lastTo; delete p.subject; delete p.text; } // from the first version: its last address becomes a saved one
  if (p.from && accs.some((a) => a.id === p.from)) $("#sendFrom").value = p.from;
  $("#sendTo").value = ""; $("#sendSubj").value = ""; $("#sendText").value = ""; $("#sendSave").checked = true; // empty every time
  renderSendBook(); renderSendPrev();
  $("#sendTo").focus();
  await sendLoadFiles(sets);
}
async function sendSubmit(e) {
  e.preventDefault();
  if (sendUi.busy) return;
  const err = (k, ...a) => { const el = $("#sendErr"); el.textContent = tr(k, ...a); el.hidden = false; };
  const to = sendAddrs();
  if (!to.length) return err("sendE_to");
  const bad = to.find((x) => !/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(x)); if (bad) return err("sendE_addr", bad);
  if (sendUi.files.some((f) => !f.bytes && !f.bad)) return err("sendE_wait");
  const miss = sendUi.files.filter((f) => f.bad); if (miss.length) return err("sendE_nopdf", miss.map((f) => f.nr).join(", "));
  sendUi.busy = true; const btn = $("#sendSubmit"); btn.disabled = true; btn.textContent = tr("sendSending");
  const sets = sendUi.sets, subjT = $("#sendSubj").value, textT = $("#sendText").value, from = $("#sendFrom").value;
  let r; try { r = await MAIL.send({ account: from, to, subject: sendFill(subjT, sets), text: sendFill(textT, sets), fromName: (currentSender().name || "").trim(), attachments: sendUi.files.map((f) => ({ name: f.name, bytes: f.bytes })) }); } catch (x) { r = { error: "other" }; }
  sendUi.busy = false; btn.disabled = false; btn.textContent = tr("sendSubmit");
  if (!r || !r.ok) {
    const k = r && r.error, known = ["auth", "apppass", "net", "tls", "size", "to", "noaccount"];
    return k === "rcpt" ? err("sendE_rcpt", r.rcpt || "") : err(known.includes(k) ? "sendE_" + k : "sendE_other");
  }
  // remembered: the account, and the new addresses when "save" is ticked
  const p = sendUi.prefs || {}; p.from = from;
  if (!$("#sendSaveWrap").hidden && $("#sendSave").checked) p.book = [...sendBook(), ...to.filter((x) => !sendBook().some((b) => b.toLowerCase() === x.toLowerCase()))].slice(0, 100);
  sendUi.prefs = p; await saveSendPrefs();
  const toRaw = to.join(", ");
  for (const s of sets) state.sent.add(s.nr); saveSent();
  state.docs.sel.clear();
  $("#sendDlg").close(); renderDocs();
  toast(tr(sets.length === 1 ? "sendDone1" : "sendDoneN", sets.length, toRaw));
}
if (desk && MAIL) {
  $("#sendBarGo").addEventListener("click", openSend);
  $("#sendBarClear").addEventListener("click", () => { state.docs.sel.clear(); renderDocs(); });
  $("#sendDlgClose").addEventListener("click", () => $("#sendDlg").close());
  $("#sendForm").addEventListener("submit", sendSubmit);
  $("#sendForm").addEventListener("input", (e) => { $("#sendErr").hidden = true; if (e.target.id === "sendSubj" || e.target.id === "sendText") renderSendPrev(); if (e.target.id === "sendTo") renderSendBook(); });
  $("#sendBookList").addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-addr]"), del = e.target.closest("[data-forget]");
    if (pick) { // in or out of "Aan"
      const a = pick.dataset.addr, cur = sendAddrs(), has = cur.some((x) => x.toLowerCase() === a.toLowerCase());
      $("#sendTo").value = (has ? cur.filter((x) => x.toLowerCase() !== a.toLowerCase()) : [...cur, a]).join(", "); $("#sendErr").hidden = true;
      renderSendBook(); const b = $(`#sendBookList [data-addr="${CSS.escape(a)}"]`); if (b) b.focus(); return;
    }
    if (del) { const a = del.dataset.forget; sendUi.prefs.book = sendBook().filter((x) => x !== a); await saveSendPrefs(); renderSendBook(); }
  });
  $("#sendGoMail").addEventListener("click", () => { $("#sendDlg").close(); openSettings("mail"); });
}
