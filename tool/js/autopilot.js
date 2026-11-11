// The automatic "beta" run (Facturen tab): new purchase orders (in the PO folder, and the ones waiting in the mail) -> downloaded, invoices made
// and saved like "Opslaan (PDF + Word)", then mailed in one email to a saved client's invoice address, and marked as sent. A warning first; it stops
// (and says what was done) at the first problem, and never mails when anything on the cards needs checking.
"use strict";
const AUTO_SUBJ = "{Factuur} {nummers}";
const AUTO_TEXT = "Beste,\n\nIn de bijlage vindt u de {factuur}:\n{lijst}\n\nTotaal: {totaal}\n\nMet vriendelijke groet,\n{naam}";
const autoUi = { running: false, prefs: null, plan: null };
const poDigits = (s) => { const m = /PO[-_\s]?(\d{3,})/i.exec(String(s || "")); return m ? String(Number(m[1])) : ""; };

/** what an automatic run would take: the new POs in the folder (no invoice, not skipped) and the ones waiting in the mail ("ask first"), one per PO number */
function autoWork() {
  if (!(desk && MAIL) || !state.poFolder || !state.poFolder.exists || state.poScanSig === "" || state.poScan || !state.invoicesLoaded || !state.folderScanned) return null;
  const folder = newPoItems().show, seen = new Set(folder.map((x) => poDigits(x.r.po))), mail = [];
  for (const p of (mailUi.st && mailUi.st.pending) || []) { const k = poDigits(p.name); if (k && !seen.has(k)) { seen.add(k); mail.push(p); } }
  return { folder, mail, n: folder.length + mail.length };
}
function renderAuto() {
  const card = $("#autoCard"); if (!card) return;
  const w = autoWork(); card.hidden = !w || !w.n || autoUi.running; if (card.hidden) return;
  $("#autoTitle").textContent = tr(w.n === 1 ? "autoT1" : "autoTN", w.n);
}
const autoClients = () => CL.list.map((p) => ({ id: p.id, name: p.name, f: clientFields(p.fields) }));
function autoShowStep(n) { [1, 2, 3].forEach((i) => { $("#autoStep" + i).hidden = i !== n; }); }
async function openAuto() {
  const w = autoWork(); if (!w || !w.n) return;
  autoUi.plan = w;
  $("#autoAgree").checked = false; $("#autoNext").disabled = true; $("#autoErr").hidden = true;
  autoShowStep(1);
  const d = $("#autoDlg"); if (!d.open) d.showModal();
  $("#autoAgree").focus();
}
async function autoStep2() {
  const w = autoUi.plan, err = (k, ...a) => { const el = $("#autoErr"); el.textContent = tr(k, ...a); el.hidden = false; $("#autoRun").disabled = true; };
  autoShowStep(2); $("#autoErr").hidden = true; $("#autoRun").disabled = false;
  $("#autoListT").textContent = tr(w.n === 1 ? "autoListT1" : "autoListTN", w.n);
  $("#autoList").innerHTML = w.folder.map(({ r }) => { const val = r.items.reduce((a, i) => a + (isFinite(i.total) ? i.total : 0), 0); return `<li><span class="num">${esc(r.po)}</span><small>${esc([r.orderDate && tr("npOrdered", r.orderDate), core.eur(val)].filter(Boolean).join(" · "))}</small></li>`; }).join("")
    + w.mail.map((p) => `<li><span class="num">${esc(p.name.replace(/\.pdf$/i, ""))}</span><small>${esc(tr("autoFromMail"))}</small></li>`).join("");
  let p = autoUi.prefs; if (!p) { p = {}; try { const doc = await state.db.doc("settings/autosend").get(); if (doc.exists) p = doc.data() || {}; } catch (e) {} autoUi.prefs = p; }
  const cls = autoClients(), withMail = cls.filter((c) => c.f.email);
  $("#autoClient").innerHTML = cls.map((c) => `<option value="${esc(c.id)}"${c.f.email ? "" : " disabled"}>${esc(c.f.email ? c.name : tr("autoNoEmail", c.name))}</option>`).join("");
  const pick = withMail.find((c) => c.id === p.client) || withMail.find((c) => c.id === CL.active) || withMail[0];
  if (pick) $("#autoClient").value = pick.id;
  const accs = ((mailUi.st && mailUi.st.accounts) || []).filter((a) => a.enabled);
  $("#autoFrom").innerHTML = accs.map((a) => `<option value="${esc(a.id)}">${esc(a.user)}</option>`).join(""); $("#autoFromWrap").hidden = accs.length < 2;
  if (p.from && accs.some((a) => a.id === p.from)) $("#autoFrom").value = p.from;
  $("#autoSubj").value = p.subject != null ? p.subject : AUTO_SUBJ; $("#autoText").value = p.text != null ? p.text : AUTO_TEXT;
  autoClientHint();
  // what has to be there before anything happens
  if (!accs.length) return err("autoE_noacc");
  if (!(folderSet() && state.folder && state.folder.exists)) return err("autoE_folder");
  if (!detailsOk()) return err("autoE_details");
  if (!withMail.length) return err("autoE_noemail");
  $("#autoClient").focus();
}
function autoClientHint() { const c = autoClients().find((x) => x.id === $("#autoClient").value); $("#autoClientHint").textContent = c && c.f.email ? tr("autoClientTo", c.f.email) : ""; }
const autoWait = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return fn(); };

async function autoRun(e) {
  e.preventDefault();
  if (autoUi.running) return;
  const client = autoClients().find((c) => c.id === $("#autoClient").value);
  if (!client || !client.f.email) { const el = $("#autoErr"); el.textContent = tr("autoE_noemail"); el.hidden = false; return; }
  const plan = autoUi.plan, subjT = $("#autoSubj").value, textT = $("#autoText").value, from = $("#autoFrom").value;
  const wanted = new Set([...plan.folder.map((x) => poDigits(x.r.po)), ...plan.mail.map((p) => poDigits(p.name))]);
  autoUi.prefs = Object.assign(autoUi.prefs || {}, { client: client.id, from, subject: subjT, text: textT });
  try { await state.db.doc("settings/autosend").set(autoUi.prefs); } catch (x) {}
  autoUi.running = true; renderAuto(); autoShowStep(3); $("#autoDone").hidden = true; $("#autoClose2").hidden = true; $("#autoDlgClose").disabled = true;
  // the steps, shown as a list that fills in
  const S = [];
  if (plan.mail.length) S.push({ k: "mail", t: tr("autoS_mail") });
  S.push({ k: "read", t: tr("autoS_read") }, { k: "make", t: tr("autoS_make", 0, wanted.size) }, { k: "send", t: tr("autoS_send", client.f.email) }, { k: "mark", t: tr("autoS_mark") });
  const draw = () => { $("#autoSteps").innerHTML = S.map((s) => `<li class="${s.st || ""}">${esc(s.t)}</li>`).join(""); };
  const step = (k, st, t) => { const s = S.find((x) => x.k === k); s.st = st; if (t) s.t = t; draw(); };
  const finish = (cls, k, ...a) => { const el = $("#autoDone"); el.className = "chip " + cls; el.textContent = tr(k, ...a); el.hidden = false; autoUi.running = false; $("#autoClose2").hidden = false; $("#autoDlgClose").disabled = false; $("#autoClose2").focus(); renderAuto(); };
  draw();
  try {
    // 1. the POs waiting in the mail into the PO folder
    if (plan.mail.length) {
      step("mail", "run");
      let r; try { r = await MAIL.download(plan.mail.map((p) => p.key)); } catch (x) { r = { error: "other" }; }
      if (r && r.error && !(r.saved && r.saved.length)) { step("mail", "bad"); return finish("error", "autoE_mail"); }
      step("mail", "ok");
    }
    // 2. read the PO folder again, and wait until it is all read
    step("read", "run");
    await refreshPoFolder();
    await autoWait(() => !state.poScan && state.poScanSig === state.poSig && state.folderScanned && !state.npBusy, 30000);
    const items = newPoItems().show.filter((x) => wanted.has(poDigits(x.r.po)));
    if (!items.length) { step("read", "bad"); return finish("error", "autoE_none"); }
    step("read", "ok");
    // 3. the invoice cards, exactly as if the PDFs were dropped on the Invoices tab, all for the chosen client
    step("make", "run", tr("autoS_make", 0, items.length));
    const files = [];
    for (const x of items) { const raw = await desk.readFile(x.f.rel, "pos"); if (raw) files.push(new File([new Uint8Array(raw)], x.f.name, { type: "application/pdf" })); }
    const before = new Set(state.cards);
    await addFiles(files);
    const fresh = state.cards.filter((c) => !before.has(c)), cards = fresh.filter((c) => !c.error), bad = fresh.filter((c) => c.error);
    for (const c of cards) { c.clientId = client.id; c.btw = client.f.btw; }
    renumber(); render();
    if (!cards.length) { step("make", "bad"); return finish("error", "autoE_none"); }
    // anything to check (number taken, PO already invoiced, other client's KVK on the PO…): stop here, nothing saved or sent
    const warns = cards.filter((c) => cardNotes(c).some((n) => n.level === "warn"));
    if (warns.length || bad.length) { step("make", "bad"); return finish("error", "autoE_check", [...warns.map((c) => c.po), ...bad.map((c) => c.fileName)].join(", ")); }
    const sets = [];
    for (const c of cards) {
      const data = invoiceData(c), pdf = await buildPdf(data), fmts = [], names = [];
      state.savedTo = "";
      if (!(await saveToFolder(fileName(data, c.po, "pdf"), new Blob([pdf], { type: MIME.pdf })))) { step("make", "bad"); return finish("error", "autoE_save", sets.length); }
      const pdfName = state.savedTo; fmts.push("pdf"); names.push(pdfName); state.savedTo = "";
      try { if (await saveToFolder(fileName(data, c.po, "docx"), new Blob([await buildWord(data)], { type: MIME.docx }))) { fmts.push("docx"); names.push(state.savedTo); } } catch (x) {}
      await logInvoice(c, data, fmts, names);
      sets.push({ nr: data.factuurnr, po: c.po, total: core.totals(data.lines, data.btw).total, name: pdfName, bytes: new Uint8Array(pdf) });
      step("make", "run", tr("autoS_make", sets.length, cards.length));
    }
    renumber(); render(); step("make", "ok");
    // 4. one email to the client's invoice address
    step("send", "run");
    let r; try { r = await MAIL.send({ account: from, to: [client.f.email], subject: sendFill(subjT, sets), text: sendFill(textT, sets), fromName: (currentSender().name || "").trim(), attachments: sets.map((s) => ({ name: s.name, bytes: s.bytes })) }); } catch (x) { r = { error: "other" }; }
    if (!r || !r.ok) {
      step("send", "bad");
      const k = r && r.error, known = ["auth", "apppass", "net", "tls", "size", "to", "noaccount"];
      return finish("error", "autoE_send", r && k === "rcpt" ? tr("sendE_rcpt", r.rcpt || "") : tr(known.includes(k) ? "sendE_" + k : "sendE_other"));
    }
    step("send", "ok");
    // 5. marked as sent; the finished cards leave the Invoices tab
    for (const s of sets) state.sent.add(s.nr); saveSent();
    state.cards = state.cards.filter((c) => !cards.includes(c)); renumber(); render();
    step("mark", "ok");
    finish("ok", sets.length === 1 ? "autoDone1" : "autoDoneN", sets.length, client.f.email);
  } catch (x) {
    const run = S.find((s) => s.st === "run"); if (run) step(run.k, "bad");
    finish("error", "autoE_other");
  }
}
if (desk && MAIL) {
  $("#autoGo").addEventListener("click", openAuto);
  $("#autoAgree").addEventListener("change", (e) => { $("#autoNext").disabled = !e.target.checked; });
  $("#autoNext").addEventListener("click", () => { if ($("#autoAgree").checked) autoStep2(); });
  $("#autoClient").addEventListener("change", autoClientHint);
  $("#autoStep2").addEventListener("submit", autoRun);
  $("#autoDlgClose").addEventListener("click", () => { if (!autoUi.running) $("#autoDlg").close(); });
  $("#autoClose2").addEventListener("click", () => $("#autoDlg").close());
  $("#autoDlg").addEventListener("cancel", (e) => { if (autoUi.running) e.preventDefault(); }); // no Esc in the middle of a run
}
