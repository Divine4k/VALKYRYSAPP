/* Invoice designs ("templates"): the list the person chooses from, their own details (sender), and the second design (Extreme Building).
   Valkyrys keeps its drawing code in invoice-core.js / invoice-docx.js; this file picks the right one and holds the other designs.
   Browser: window.InvoiceTemplates; Node: module.exports.
   To add a design for another person: add an entry to TEMPLATES, a PDF drawing function (measure their invoice with tools/measure_pdf.mjs),
   a Word file with placeholders in tool/templates/, and pictures in tool/img/. See NOTES.md. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.InvoiceTemplates = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** The details a person fills in once: they end up on every invoice. */
  const FIELDS = ["name", "person", "street", "city", "phone", "email", "iban", "btw", "kvk"];
  const REQUIRED = ["name", "person", "street", "city", "iban", "btw", "kvk"];
  const BLANK = { name: "", person: "", street: "", city: "", phone: "", email: "", iban: "", btw: "", kvk: "" };

  const TEMPLATES = [
    {
      id: "valkyrys", name: "Valkyrys", preview: "img/tpl-valkyrys.png",
      sender: { name: "Valkyrys", person: "P. Wodecki", street: "Harderwijkstraat 115", city: "2573 ZC ’s-Gravenhage", phone: "0685029456", email: "Valkyrys.bv@gmail.com",
        iban: "NL42 INGB 0103 2069 73", btw: "NL003608498B64", kvk: "81828233" },
      settings: {}, // what choosing this design changes in the other settings the first time
    },
    {
      id: "extreme", name: "Extreme Building", preview: "img/tpl-extreme.png",
      sender: { ...BLANK, name: "Extreme Building" },
      settings: { fileTemplate: "EXTREME BUILDING {nummer}", startNumber: 1 },
    },
  ];

  const get = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];

  /** The details to print: what the person entered, and for every field they never touched the design's own default. */
  function senderFor(id, stored) {
    const d = get(id).sender, o = {};
    for (const k of FIELDS) o[k] = String(stored && Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : d[k] || "").trim();
    return o;
  }
  const missing = (sender) => REQUIRED.filter((k) => !String(sender[k] || "").trim());

  /** The shape the drawing code reads (the first design wants the address as three lines). */
  function forRender(s) {
    const o = { ...BLANK, ...s };
    o.address = [o.street, o.city, o.phone ? "Tel: " + o.phone : ""];
    return o;
  }

  /** Who is "me" on an invoice, so the reader does not mistake the sender for the client: every design's own name and chamber of commerce number, and the current ones. */
  function owners(sender) {
    const list = TEMPLATES.map((t) => ({ name: t.sender.name, kvk: t.sender.kvk })).filter((o) => o.name || o.kvk);
    if (sender && (sender.name || sender.kvk)) list.push({ name: sender.name || "", kvk: sender.kvk || "" });
    return list;
  }

  // ---------------------------------------------------------------- Extreme Building: PDF
  // Positions in pt from the top of an A4 page, measured from the Word invoice of this design (tools/measure_pdf.mjs).
  const PAGE_W = 595.28, PAGE_H = 841.89;
  const X = { L: 41.1, R: 554.3, VAL: 543.4, TARIEF: 384.36, QTY: 416.8, DESC: 52.1 };
  const C = { BAND: "0A0A0B", GOLD: "C9A55C", WHITE: "FFFFFF", LABEL: "6B7078", BODY: "333333", INK: "111111", SOFT: "C9CED6", NOTE: "8D949C", HAIR: "E4E6EA", BOX: "8D949C", FOOTRULE: "2C2E31" };
  const ROW_TOP = 320.95, ROW_H = 24.24, MAX_LINES = 6;

  async function renderExtreme(PDFLib, assets, data, core) {
    const { PDFDocument, rgb } = PDFLib;
    const color = (h) => { const n = parseInt(h, 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
    const S = { ...BLANK, ...(data.sender || {}) };
    if (!S.street && S.address) { S.street = S.address[0] || ""; S.city = S.address[1] || ""; S.phone = S.phone || String(S.address[2] || "").replace(/^Tel:\s*/i, ""); }
    const doc = await PDFDocument.create();
    doc.setTitle(`Factuur ${data.factuurnr}`);
    doc.setAuthor(S.name);
    doc.setSubject(data.lines.map((l) => l.desc).join(", "));
    doc.setCreator("Valkyrys app");
    doc.setLanguage("nl-NL");
    const { R, B, I, safe } = await core.setupFonts(PDFLib, doc, assets);
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const rect = (x, top, w, h, hex) => page.drawRectangle({ x, y: PAGE_H - top - h, width: w, height: h, color: color(hex) });
    const width = (s, font, size, tracking = 0) => { s = safe(s); return tracking ? [...s].reduce((a, ch) => a + font.widthOfTextAtSize(ch, size), 0) + tracking * (s.length - 1) : font.widthOfTextAtSize(s, size); };
    /** baseline = distance from the top of the page */
    function text(s, x, baseline, size, font, hex, opt = {}) {
      s = safe(s); if (!s) return;
      if (opt.max) while (size > 6 && width(s, font, size, opt.tracking || 0) > opt.max) size -= 0.25; // long text gets a little smaller instead of running into its neighbour
      const w = width(s, font, size, opt.tracking || 0);
      if (opt.align === "right") x -= w; else if (opt.align === "center") x -= w / 2;
      const y = PAGE_H - baseline;
      if (opt.tracking) { for (const ch of s) { page.drawText(ch, { x, y, size, font, color: color(hex) }); x += font.widthOfTextAtSize(ch, size) + opt.tracking; } }
      else page.drawText(s, { x, y, size, font, color: color(hex) });
    }
    const label = (s, x, base, size, hex, align, tracking) => text(s.toUpperCase(), x, base, size, B, hex, { tracking: tracking ?? (size === 7 ? 1.8 : 2), align });

    // --- black header and footer bands, gold line under the header
    rect(0, 0, PAGE_W, 128.85, C.BAND);
    rect(0, 128.9, PAGE_W, 1.5, C.GOLD);
    rect(0, 699.9, PAGE_W, PAGE_H - 699.9, C.BAND);
    const logo = await doc.embedPng(assets.images.extremeLogo);
    page.drawImage(logo, { x: 41.0, y: PAGE_H - 47.45 - 36, width: 247.5, height: 36 });
    text("FACTUUR", X.R, 63.8, 23, R, C.WHITE, { tracking: 11, align: "right" });
    rect(524.35, 77.45, 30, 1.5, C.GOLD);

    // --- client
    label("Factuur aan", X.L, 169, 7, C.LABEL);
    rect(41.0, 175.75, 22.5, 1.5, C.GOLD);
    const K = data.client || {};
    text(K.name || "", X.L, 208.3, 15, B, C.INK);
    if (K.street) text(K.street, X.L, 226.75, 10, R, C.BODY);
    if (K.city) text(K.city, X.L, 239.55, 10, R, C.BODY);
    [["KVK  ", K.kvk, 253.35], ["BTW  ", K.btw, 264.9]].forEach(([lab, v, base]) => {
      if (!v) return;
      text(lab, X.L, base, 9, R, C.LABEL);
      text(v, X.L + width(lab, R, 9), base, 9, R, C.BODY);
    });

    // --- invoice number, date and term in a box
    rect(339.25, 162.425, 215.45, 0.75, C.BOX); rect(339.25, 249.225, 215.45, 0.75, C.BOX);
    rect(339.225, 162.4, 0.75, 87.55, C.BOX); rect(553.925, 162.4, 0.75, 87.55, C.BOX);
    rect(340.05, 191.5, 213.85, 0.5, C.HAIR); rect(340.05, 220.3, 213.85, 0.5, C.HAIR);
    [["Factuurnr.", data.factuurnr, 179.35], ["Datum", data.datum, 208.2], ["Betaaltermijn", data.betaaltermijn, 237.05]].forEach(([l, v, base]) => {
      label(l, 351.7, base, 7, C.LABEL);
      text(v, 542.7, base + 1.25, 10.5, B, C.INK, { align: "right" });
    });

    // --- lines
    rect(41.0, 298.9, 513.25, 22.05, C.BAND);
    label("Omschrijving", X.DESC, 312.05, 7, C.SOFT, undefined, 2);
    label("Tarief", X.TARIEF, 312.05, 7, C.SOFT, "right", 2);
    label("Aantal", X.QTY, 312.05, 7, C.SOFT, "center", 2);
    label("Bedrag", X.VAL, 312.05, 7, C.SOFT, "right", 2);
    const lines = data.lines.slice(0, MAX_LINES);
    for (let r = 0; r < MAX_LINES; r++) {
      const top = ROW_TOP + r * ROW_H, base = top + 15.1, l = lines[r];
      if (l) {
        text(l.desc, X.DESC, base, 10, B, C.INK);
        text(core.eur(l.tarief), X.TARIEF, base, 10, R, C.BODY, { align: "right" });
        text(core.qty(l.aantal), X.QTY, base, 10, R, C.BODY, { align: "center" });
        text(core.eur(core.round2(l.tarief * l.aantal)), X.VAL, base, 10, B, C.INK, { align: "right" });
      }
      rect(41.0, top + ROW_H - 0.25, 513.3, 0.5, C.HAIR);
    }

    // --- totals
    const t = core.totals(lines, data.btw);
    text("Subtotaal", 316.4, 492.55, 10, R, C.LABEL); text(core.eur(t.sub), X.VAL, 492.55, 10, R, C.BODY, { align: "right" });
    text(t.btwLabel, 316.4, 512.3, 10, R, C.LABEL); text(core.eur(t.vat), X.VAL, 512.3, 10, R, C.BODY, { align: "right" });
    rect(304.3, 531.2, 250, 40.35, C.BAND);
    rect(304.3, 531.2, 250, 1.5, C.GOLD);
    label("Totaal te betalen", 316.4, 554.4, 7.5, C.GOLD);
    text(core.eur(t.total), 543.35, 557, 15, B, C.WHITE, { align: "right" });

    // --- sign-off
    text("Met vriendelijke groet,", X.L, 609.1, 10, R, C.BODY);
    text(S.person, X.L, 632.35, 10.5, B, C.INK, { max: 250 });
    text(S.name, X.L, 644.3, 9, R, C.LABEL);

    // --- footer: sender, contact, payment, tax numbers
    label("Van", X.L, 732.05, 6.5, C.GOLD); label("Contact", 162.05, 732.05, 6.5, C.GOLD);
    label("Betaalgegevens", 279.55, 732.05, 6.5, C.GOLD); label("BTW nr", 409.55, 732.05, 6.5, C.GOLD); label("KVK", 409.55, 763, 6.5, C.GOLD);
    text(S.name, X.L, 746.7, 9.5, B, C.WHITE, { max: 112 });
    text(S.street, X.L, 758.35, 9, R, C.SOFT, { max: 112 });
    text(S.city, X.L, 769.9, 9, R, C.SOFT, { max: 112 });
    [S.phone ? "Tel: " + S.phone : "", S.email].filter(Boolean).forEach((l, i) => text(l, 162.05, 746.2 + i * 11.55, 9, R, C.SOFT, { max: 112 }));
    text(S.iban, 279.55, 746.7, 9.5, B, C.WHITE, { max: 125 });
    text("t.n.v. " + S.name, 279.55, 758.35, 9, R, C.SOFT, { max: 125 });
    text(S.btw, 409.55, 746.7, 9.5, B, C.WHITE, { max: 90 });
    text(S.kvk, 409.55, 777.65, 9.5, B, C.WHITE, { max: 90 });
    const emblem = await doc.embedPng(assets.images.extremeEmblem);
    page.drawImage(emblem, { x: 504.85, y: PAGE_H - 725.8 - 49.5, width: 49.5, height: 49.5 });
    rect(41.0, 791.75, 513.25, 0.5, C.FOOTRULE);
    text("Vermeld bij betaling het factuurnummer.", X.L, 810.85, 8, I, C.NOTE);
    text("Bedankt voor de samenwerking.", 554.36, 810.85, 8, R, C.NOTE, { align: "right" });
    return doc.save();
  }

  // ---------------------------------------------------------------- Extreme Building: Word
  // The Word file of this design (tool/templates/extreme.docx) has placeholders in square brackets; they are replaced here, so the file is the design itself.
  const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const withSpace = (xml) => xml.replace(/<w:t>/g, '<w:t xml:space="preserve">'); // keeps leading and trailing spaces such as "KVK  "

  // ---------------------------------------------------------------- Word designs with [placeholders]: fill in, and read the sender's details out
  // Works for any Word file made in the style of tool/templates/extreme.docx: the same [placeholders], or real text in their place
  // (a design where the person already typed their own details). Placeholders split over several runs by Word are joined first.
  const unXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const T_RE = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
  function runsOf(xml) {
    const out = []; let m; T_RE.lastIndex = 0;
    while ((m = T_RE.exec(xml))) out.push({ pos: m.index, len: m[0].length, open: m[1], orig: m[2], text: unXml(m[2]), changed: false });
    return out;
  }
  function joinRuns(xml, runs) {
    let out = "", at = 0;
    for (const r of runs) {
      const open = r.changed && !/xml:space/.test(r.open) ? r.open.replace("<w:t", '<w:t xml:space="preserve"') : r.open;
      out += xml.slice(at, r.pos) + open + (r.changed ? xmlEsc(r.text) : r.orig) + "</w:t>"; at = r.pos + r.len;
    }
    return out + xml.slice(at);
  }
  const setRun = (r, text) => { if (r.text !== text) { r.text = text; r.changed = true; } };
  /** "[Post" + "code]" in two runs (Word does that after spell checking or editing) becomes one run */
  function mergeSplit(runs) {
    for (let i = 0; i < runs.length; i++) {
      const t = runs[i].text, o = t.lastIndexOf("[");
      if (o < 0 || t.lastIndexOf("]") > o) continue;
      let acc = t; const used = [];
      for (let j = i + 1; j < runs.length && j <= i + 10 && acc.length < 160; j++) {
        const k = runs[j].text.indexOf("]");
        if (k < 0) { acc += runs[j].text; used.push([j, ""]); continue; }
        acc += runs[j].text; used.push([j, ""]); // the rest of that run comes along ("[n" + "r]-2026" -> "[nr]-2026")
        if (/^\[[^\[\]<>]{1,40}\]/.test(acc.slice(o))) { setRun(runs[i], acc); for (const [n, rest] of used) setRun(runs[n], rest); }
        break;
      }
    }
  }
  const phKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hasPh = (s) => /\[[^\[\]]{1,40}\]/.test(s);
  const ROW_PH = { omschrijving: "desc", nummer: "desc", po: "desc", ponummer: "desc", tarief: "tarief", prijs: "tarief", aantal: "aantal", bedrag: "bedrag" };
  const rowRole = (s) => { const m = s.match(/\[([^\[\]]{1,40})\]/); return m ? ROW_PH[phKey(m[1])] : undefined; };
  const isLabel = (s) => /^(van|contact|betaalgegevens|btw[ -]?(nr|nummer)\.?|kvk([ -]?(nr|nummer))?\.?|iban|bank|factuur( aan)?|factuurnr\.?|factuurnummer|datum|betaaltermijn|omschrijving|tarief|aantal|bedrag|subtotaal|totaal( te betalen)?|met vriendelijke groet,?)\s*:?$/i.test(s.trim());
  const BTW_RE = /\b(NL\s?\d{9}\s?B\s?\d{2})\b/i, IBAN_RE = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?)\b/, MAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
  const PHONE_RE = /^(?:tel(?:efoon)?\.?|t\.?)\s*:?\s*(\+?[\d][\d\s()./-]{7,})$/i, PC_RE = /^\d{4}\s?[A-Z]{2}\b/;
  /** where the client's block is (between "Factuur aan" and the invoice number), so the client is never taken for the sender: [from, to) in runs */
  function clientWindow(runs) {
    const a = runs.findIndex((r) => /^factuur aan:?$/i.test(r.text.trim()));
    if (a < 0) return [-1, -1];
    let b = runs.findIndex((r, i) => i > a && /^(factuurnr\.?|factuurnummer|datum|omschrijving)\s*:?$/i.test(r.text.trim()));
    if (b < 0) b = Math.min(runs.length, a + 12);
    return [a + 1, b];
  }
  /** the sender's details that are written in a design (real text, not [placeholders]); texts = the runs' text in order, client block left out */
  function readSender(texts) {
    const o = {};
    const set = (k, v) => { v = String(v || "").trim(); if (v && !hasPh(v) && !isLabel(v) && !o[k]) o[k] = v; };
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i], next = texts[i + 1] || "";
      if (/^van:?$/i.test(t)) { // footer block: company, street, postcode and town
        const blk = []; for (let j = i + 1; j < texts.length && blk.length < 3 && !isLabel(texts[j]); j++) blk.push(texts[j]);
        if (blk[0]) set("name", blk[0]);
        const pc = blk.findIndex((s) => PC_RE.test(s));
        if (pc > 0) { set("city", blk[pc]); if (pc > 1) set("street", blk[pc - 1]); }
        else { set("street", blk[1]); set("city", blk[2]); }
      }
      if (/^met vriendelijke groet,?$/i.test(t)) {
        if (!isLabel(next)) set("person", next);
        const after = texts[i + 2] || ""; if (after && !isLabel(after) && !MAIL_RE.test(after)) set("name", after);
      }
      if (/^btw[ -]?(nr|nummer)\.?:?$/i.test(t) && BTW_RE.test(next)) set("btw", next.match(BTW_RE)[1]);
      if (/^kvk([ -]?(nr|nummer))?\.?:?$/i.test(t) && /^\d{8}$/.test(next.replace(/\s/g, ""))) set("kvk", next.replace(/\s/g, ""));
      if (/^iban:?$/i.test(t) && IBAN_RE.test(next)) set("iban", next.match(IBAN_RE)[1]);
      let m;
      if ((m = t.match(/^kvk(?:[ -]?(?:nr|nummer))?\.?\s*:?\s*(\d{8})$/i))) set("kvk", m[1]);
      if ((m = t.match(/^t\.?\s*n\.?\s*v\.?\s+(.+)$/i))) set("name", m[1]);
      if ((m = t.match(PHONE_RE))) set("phone", m[1]);
      else if (/^(\+31|0)[\d\s-]{8,}$/.test(t)) set("phone", t);
      if ((m = t.match(MAIL_RE))) set("email", m[0]);
      if ((m = t.match(BTW_RE))) set("btw", m[1].toUpperCase());
      if (!/^(nl\s?\d{9}\s?b)/i.test(t) && (m = t.match(IBAN_RE)) && /\d{6}/.test(m[1].replace(/\s/g, ""))) set("iban", m[1]);
    }
    if (!o.city) { const i = texts.findIndex((s) => PC_RE.test(s) && s.length < 60); if (i >= 0) { set("city", texts[i]); if (i > 0 && /\d/.test(texts[i - 1]) && /[a-z]/i.test(texts[i - 1])) set("street", texts[i - 1]); } }
    return o;
  }
  const PARTS = (zip) => Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)).sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)));
  /** the text of the parts (document first) without the client block, Word's split placeholders joined */
  async function partTexts(zip) {
    const texts = [];
    for (const n of PARTS(zip)) {
      const runs = runsOf(await zip.file(n).async("string")); mergeSplit(runs);
      const [a, b] = clientWindow(runs);
      runs.forEach((r, i) => { const t = r.text.trim(); if (t && !(i >= a && i < b)) texts.push(t); });
    }
    return texts;
  }
  /** first wide picture of the body (the logo), as PNG bytes, or null */
  async function findLogo(zip) {
    try {
      const xml = await zip.file("word/document.xml").async("string"), rels = (await zip.file("word/_rels/document.xml.rels").async("string"));
      for (const d of xml.split(/<w:drawing>/).slice(1)) {
        const ext = d.match(/<wp:extent cx="(\d+)" cy="(\d+)"/), emb = d.match(/r:embed="([^"]+)"/);
        if (!ext || !emb) continue;
        const cx = +ext[1], cy = +ext[2]; if (!(cy > 0 && cx >= 1200000 && cx / cy >= 2.5 && cx / cy <= 14)) continue;
        const rel = rels.match(new RegExp('Id="' + emb[1] + '"[^>]*Target="([^"]+)"')) || rels.match(new RegExp('Target="([^"]+)"[^>]*Id="' + emb[1] + '"'));
        const f = rel && zip.file("word/" + rel[1].replace(/^\.?\//, ""));
        if (!f) continue;
        const b = await f.async("uint8array");
        if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return b;
        return null;
      }
    } catch (e) {}
    return null;
  }
  /** what a design's Word file tells about itself: the sender's details written in it, and its logo */
  async function inspectDocx(JSZip, bytes) {
    const zip = await JSZip.loadAsync(bytes);
    return { sender: readSender(await partTexts(zip)), logo: await findLogo(zip) };
  }

  /** fills a design's Word file: [placeholders], the sample client and invoice values, the line rows (the first row is the model), and the
      sender's details written in the file (replaced by the current ones). opts.maxLines: a fixed number of rows (the Extreme design: 6). */
  async function fillTemplateDocx(JSZip, templateBytes, data, core, opts = {}) {
    const zip = await JSZip.loadAsync(templateBytes);
    const S = { ...BLANK, ...(data.sender || {}) }, K = data.client || {};
    if (!S.street && S.address) { S.street = S.address[0] || ""; S.city = S.address[1] || ""; S.phone = S.phone || String(S.address[2] || "").replace(/^Tel:\s*/i, ""); }
    const lines = opts.maxLines ? data.lines.slice(0, opts.maxLines) : data.lines, t = core.totals(lines, data.btw);
    const orig = readSender(await partTexts(zip)); // what the file says about the sender now, replaced below by the current details
    const VAL = {
      naam: S.person, bedrijfsnaam: S.name, bedrijf: S.name, firmanaam: S.name, straathuisnummer: S.street, straat: S.street, adres: S.street,
      postcodeplaats: S.city, plaats: S.city, postcode: "", telefoonnummer: S.phone, telefoon: S.phone, emailadres: S.email, email: S.email,
      iban: S.iban, btwnummer: S.btw, btwnr: S.btw, kvknummer: S.kvk, kvknr: S.kvk, kvk: S.kvk,
      nr: data.factuurnr, factuurnr: data.factuurnr, factuurnummer: data.factuurnr, datum: data.datum, betaaltermijn: data.betaaltermijn,
      klant: K.name || "", klantnaam: K.name || "", klantstraat: K.street || "", klantadres: K.street || "", klantplaats: K.city || "", klantpostcodeplaats: K.city || "",
      klantkvk: K.kvk || "", klantbtw: K.btw || "", subtotaal: core.eur(t.sub), btwbedrag: core.eur(t.vat), totaal: core.eur(t.total), btwlabel: t.btwLabel,
    };
    const fillPh = (s) => s.replace(/\[nr\]-(?:\d{4}|\[jaar\])/gi, data.factuurnr).replace(/\[postcode\]\s*\[plaats\]/gi, S.city)
      .replace(/\[([^\[\]]{1,40})\]/g, (m, k) => (Object.prototype.hasOwnProperty.call(VAL, phKey(k)) ? String(VAL[phKey(k)] ?? "") : m));

    for (const part of PARTS(zip)) {
      let xml = withSpace(await zip.file(part).async("string"));
      let runs = runsOf(xml); mergeSplit(runs); xml = joinRuns(xml, runs);

      // the invoice rows: the row with the first row placeholder is the model, it and the rows after it in its table are replaced
      let tblFrom = -1, tblTo = -1;
      const mark = runsOf(xml).find((r) => { const k = rowRole(r.text); return k === "desc" || k === "tarief"; });
      if (mark) {
        let start = -1; const re = /<w:tr[ >]/g; let m; while ((m = re.exec(xml)) && m.index < mark.pos) start = m.index;
        const end = xml.indexOf("</w:tbl>", mark.pos), rowEnd = xml.indexOf("</w:tr>", mark.pos) + "</w:tr>".length;
        if (start >= 0 && end > rowEnd) {
          const model = xml.slice(start, rowEnd), have = (xml.slice(start, end).match(/<w:tr[ >]/g) || []).length;
          const n = opts.maxLines || Math.max(have, lines.length), rows = [];
          for (let r = 0; r < n; r++) {
            const l = lines[r], rr = runsOf(model);
            const v = l ? { desc: l.desc, tarief: core.eur(l.tarief), aantal: core.qty(l.aantal), bedrag: core.eur(core.round2(l.tarief * l.aantal)) } : { desc: "", tarief: "", aantal: "", bedrag: "" };
            rr.forEach((x) => { const k = rowRole(x.text); if (k) setRun(x, v[k]); });
            rows.push(joinRuns(model, rr));
          }
          const body = rows.join("");
          xml = xml.slice(0, start) + body + xml.slice(end); tblFrom = start; tblTo = start + body.length;
        }
      }

      runs = runsOf(xml);
      const done = new Set();
      const before = (r) => tblFrom < 0 || r.pos < tblFrom, after = (r) => tblTo < 0 || r.pos >= tblTo;
      // the client: the sample client of the file (or placeholders) under "Factuur aan", in order: name, street, town, KVK, BTW
      const [a, b] = clientWindow(runs);
      if (a >= 0) {
        const map = new Map(); let pos = 0, want = "";
        for (let i = a; i < b; i++) {
          const r = runs[i], s = r.text.trim(); if (!s) continue; done.add(i);
          if (map.has(r.text)) { setRun(r, map.get(r.text)); continue; }
          let v;
          if (/^kvk:?$/i.test(s)) { v = K.kvk ? r.text : ""; want = "kvk"; }
          else if (/^btw:?$/i.test(s)) { v = K.btw ? r.text : ""; want = "btw"; }
          else if (want) { v = K[want] || ""; want = ""; }
          else { v = [K.name, K.street, K.city][pos++] || ""; }
          map.set(r.text, v); setRun(r, v);
        }
      }
      // date and term: placeholders, or the sample values of the file above the rows
      if (!runs.some((r) => /\[datum\]/i.test(r.text))) { const r = runs.find((r, i) => !done.has(i) && before(r) && /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(r.text.trim())); if (r) { setRun(r, data.datum); done.add(runs.indexOf(r)); } }
      if (!runs.some((r) => /\[betaaltermijn\]/i.test(r.text))) { const r = runs.find((r, i) => !done.has(i) && before(r) && /^\d+\s+dagen$/i.test(r.text.trim())); if (r) { setRun(r, data.betaaltermijn); done.add(runs.indexOf(r)); } }
      // totals below the rows: "[bedrag]" in order (subtotal, VAT, total), the VAT line's label and its sample amount
      if (tblTo >= 0) {
        const am = runs.filter((r) => after(r) && rowRole(r.text) === "bedrag");
        const vals = am.length >= 3 ? [t.sub, t.vat, t.total] : am.length === 2 ? [t.sub, t.total] : [t.total];
        am.forEach((r, i) => { setRun(r, core.eur(vals[Math.min(i, vals.length - 1)])); done.add(runs.indexOf(r)); });
        const lab = runs.find((r) => after(r) && /^btw\s*(verlegd|\d+([.,]\d+)?\s*%)$/i.test(r.text.trim())); if (lab) { setRun(lab, t.btwLabel); done.add(runs.indexOf(lab)); }
        if (am.length < 3) { const z = runs.find((r, i) => !done.has(i) && after(r) && /^€\s*0,00$/.test(r.text.trim())); if (z) { setRun(z, core.eur(t.vat)); done.add(runs.indexOf(z)); } }
      }
      // the sender's details written in the file, and the placeholders
      runs.forEach((r, i) => {
        if (done.has(i)) return;
        const s = r.text.trim(); let m;
        if (s) {
          const k = FIELDS.find((f) => orig[f] && s === orig[f]);
          if (k) { setRun(r, S[k]); return; }
          if (orig.name && (m = s.match(/^(t\.?\s*n\.?\s*v\.?\s+)(.+)$/i)) && m[2] === orig.name) { setRun(r, m[1] + S.name); return; }
          if (orig.phone && (m = s.match(PHONE_RE)) && m[1] === orig.phone) { setRun(r, S.phone ? s.slice(0, s.length - m[1].length) + S.phone : ""); return; }
          if (orig.email && s.includes(orig.email)) { setRun(r, S.email ? r.text.replace(orig.email, S.email) : ""); return; }
          if (orig.kvk && (m = s.match(/^(kvk(?:[ -]?(?:nr|nummer))?\.?\s*:?\s*)(\d{8})$/i)) && m[2] === orig.kvk) { setRun(r, S.kvk ? m[1] + S.kvk : ""); return; }
        }
        if (!r.text.includes("[")) return;
        const v = fillPh(r.text);
        if (v === r.text) return;
        setRun(r, /^\s*(tel(efoon)?\.?|t\.?)\s*:?\s*$/i.test(v) ? "" : v); // "Tel: " without a number goes
      });
      xml = joinRuns(xml, runs);
      zip.file(part, xml);
    }
    const core1 = zip.file("docProps/core.xml");
    if (core1) {
      let c = await core1.async("string");
      c = c.replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${xmlEsc("Factuur " + data.factuurnr)}</dc:title>`).replace(/<dc:creator>[^<]*<\/dc:creator>/, `<dc:creator>${xmlEsc(S.name)}</dc:creator>`);
      zip.file("docProps/core.xml", c);
    }
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
  const fillExtremeDocx = (JSZip, templateBytes, data, core) => fillTemplateDocx(JSZip, templateBytes, data, core, { maxLines: MAX_LINES });

  // ---------------------------------------------------------------- the person's own designs (Word files they imported)
  // Settings keep the list ({id, name, file}); the desktop app keeps the files in <data folder>/templates. They are listed here like the other
  // designs, with the details written in the file as their defaults. Word is filled from the file itself; the PDF cannot follow an unknown
  // layout, so it is drawn in the Valkyrys layout with the logo of the file (the first wide picture) and the details.
  const CUSTOM_PREVIEW = "img/tpl-custom.png";
  const NO_LOGO = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=="; // 1x1, transparent
  const b64bytes = (s) => (typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(s, "base64")) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  const custom = (id) => TEMPLATES.find((t) => t.custom && t.id === id) || null;
  /** the list from the settings: entries appear at once (so a chosen design is known before its file is read), gone ones are taken out */
  function setCustomList(list) {
    const want = (Array.isArray(list) ? list : []).filter((c) => c && typeof c.id === "string" && c.id);
    for (let i = TEMPLATES.length - 1; i >= 0; i--) if (TEMPLATES[i].custom && !want.some((c) => c.id === TEMPLATES[i].id)) TEMPLATES.splice(i, 1);
    for (const c of want) {
      const t = custom(c.id);
      if (t) t.name = c.name || t.name;
      else TEMPLATES.push({ id: c.id, name: c.name || "Ontwerp", preview: CUSTOM_PREVIEW, custom: true, file: c.file || "", bytes: null, logo: null, found: [], sender: { ...BLANK }, settings: {} });
    }
    return TEMPLATES.filter((t) => t.custom);
  }
  /** gives a listed design its Word file: reads the details and the logo out of it */
  async function loadCustom(JSZip, id, bytes) {
    const t = custom(id); if (!t) return null;
    const info = await inspectDocx(JSZip, bytes);
    t.bytes = bytes; t.logo = info.logo; t.sender = { ...BLANK, ...info.sender }; t.found = Object.keys(info.sender);
    return t;
  }

  // ---------------------------------------------------------------- one entry point per output
  /** PDF of an invoice in the design named by data.template (the first design when it is missing) */
  function renderPdf(PDFLib, assets, data, core) {
    if (data.template === "extreme") return renderExtreme(PDFLib, assets, data, core);
    const c = custom(data.template);
    if (c) return core.renderInvoice(PDFLib, { ...assets, images: { ...assets.images, logo: c.logo || b64bytes(NO_LOGO) } }, data);
    return core.renderInvoice(PDFLib, assets, data);
  }
  /** Word file of an invoice in the design named by data.template */
  async function buildWord(deps, assets, data, core) { // deps: { docx, InvoiceDocx, JSZip }
    if (data.template === "extreme") return fillExtremeDocx(deps.JSZip, assets.extremeDocx, data, core);
    const c = custom(data.template);
    if (c) { if (!c.bytes) throw new Error("template file missing"); return fillTemplateDocx(deps.JSZip, c.bytes, data, core); }
    return deps.InvoiceDocx.buildDocx(deps.docx, assets.docx, data, core);
  }

  return { TEMPLATES, FIELDS, REQUIRED, get, senderFor, missing, forRender, owners, renderPdf, buildWord, renderExtreme, fillExtremeDocx,
    fillTemplateDocx, inspectDocx, readSender, setCustomList, loadCustom, CUSTOM_PREVIEW };
});
