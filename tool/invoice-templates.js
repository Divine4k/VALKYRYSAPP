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
  /** replaces the text of the n-th run that has exactly this text (1 = first) */
  function setText(xml, from, to, nth = 1) {
    const re = new RegExp("(<w:t(?: [^>]*)?>)" + from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(</w:t>)", "g");
    let i = 0, hit = false;
    const out = xml.replace(re, (m, a, b) => { i++; if (i !== nth) return m; hit = true; return a + xmlEsc(to) + b; });
    if (!hit) throw new Error("template text not found: " + from);
    return out;
  }
  /** replaces the text of every run that has exactly this text */
  function setTextAll(xml, from, to) {
    const re = new RegExp("(<w:t(?: [^>]*)?>)" + from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(</w:t>)", "g");
    let n = 0; const out = xml.replace(re, (m, a, b) => { n++; return a + xmlEsc(to) + b; });
    if (!n) throw new Error("template text not found: " + from);
    return out;
  }
  const withSpace = (xml) => xml.replace(/<w:t>/g, '<w:t xml:space="preserve">'); // keeps leading and trailing spaces such as "KVK  "

  async function fillExtremeDocx(JSZip, templateBytes, data, core) {
    const zip = await JSZip.loadAsync(templateBytes);
    let xml = withSpace(await zip.file("word/document.xml").async("string"));
    const S = { ...BLANK, ...(data.sender || {}) }, K = data.client || {};
    if (!S.street && S.address) { S.street = S.address[0] || ""; S.city = S.address[1] || ""; S.phone = S.phone || String(S.address[2] || "").replace(/^Tel:\s*/i, ""); }
    const lines = data.lines.slice(0, MAX_LINES), t = core.totals(lines, data.btw);

    // the six invoice rows: the first row of the file is the model, the empty ones after it are replaced
    const start = xml.indexOf("<w:tr>", xml.lastIndexOf("<w:tr>", xml.indexOf("PO-[nummer]")));
    const end = xml.indexOf("</w:tbl>", start);
    const rowEnd = xml.indexOf("</w:tr>", start) + "</w:tr>".length;
    const model = xml.slice(start, rowEnd);
    const rows = [];
    for (let r = 0; r < MAX_LINES; r++) {
      const l = lines[r]; let row = model;
      const vals = l ? [l.desc, core.eur(l.tarief), core.qty(l.aantal), core.eur(core.round2(l.tarief * l.aantal))] : ["", "", "", ""];
      row = setText(row, "PO-[nummer]", vals[0]);
      row = setText(row, "€ [tarief]", vals[1]); row = setText(row, "[aantal]", vals[2]); row = setText(row, "€ [bedrag]", vals[3]);
      rows.push(row);
    }
    xml = xml.slice(0, start) + rows.join("") + xml.slice(end);

    xml = setText(xml, "[nr]-2026", data.factuurnr);
    xml = setText(xml, "09/11/2026", data.datum);
    xml = setText(xml, "14 dagen", data.betaaltermijn);
    xml = setText(xml, "Piguillet BV", K.name || "");
    xml = setText(xml, "Edisonstraat 8", K.street || "");
    xml = setText(xml, "2652 XS Berkel en Rodenrijs", K.city || "");
    xml = setText(xml, "KVK  ", K.kvk ? "KVK  " : ""); xml = setText(xml, "52742938", K.kvk || "");
    xml = setText(xml, "BTW  ", K.btw ? "BTW  " : ""); xml = setText(xml, "NL850577950B01", K.btw || "");
    xml = setText(xml, "€ [bedrag]", core.eur(t.sub), 1); // subtotal (the rows above are already filled in)
    xml = setText(xml, "BTW verlegd", t.btwLabel);
    xml = setText(xml, "€ 0,00", core.eur(t.vat));
    xml = setText(xml, "€ [bedrag]", core.eur(t.total), 1); // total
    xml = setText(xml, "[Naam]", S.person);
    xml = setTextAll(xml, "Extreme Building", S.name); // under the signature and in the footer
    xml = setText(xml, "[Straat + huisnummer]", S.street);
    xml = setText(xml, "[Postcode]  [Plaats]", S.city);
    xml = setText(xml, "Tel: [telefoonnummer]", S.phone ? "Tel: " + S.phone : "");
    xml = setText(xml, "[e-mailadres]", S.email);
    xml = setText(xml, "[IBAN]", S.iban);
    xml = setText(xml, "t.n.v. Extreme Building", "t.n.v. " + S.name);
    xml = setText(xml, "[BTW-nummer]", S.btw);
    xml = setText(xml, "[KVK-nummer]", S.kvk);
    zip.file("word/document.xml", xml);
    const core1 = zip.file("docProps/core.xml");
    if (core1) {
      let c = await core1.async("string");
      c = c.replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${xmlEsc("Factuur " + data.factuurnr)}</dc:title>`).replace(/<dc:creator>[^<]*<\/dc:creator>/, `<dc:creator>${xmlEsc(S.name)}</dc:creator>`);
      zip.file("docProps/core.xml", c);
    }
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  // ---------------------------------------------------------------- one entry point per output
  /** PDF of an invoice in the design named by data.template (the first design when it is missing) */
  function renderPdf(PDFLib, assets, data, core) {
    if (data.template === "extreme") return renderExtreme(PDFLib, assets, data, core);
    return core.renderInvoice(PDFLib, assets, data);
  }
  /** Word file of an invoice in the design named by data.template */
  async function buildWord(deps, assets, data, core) { // deps: { docx, InvoiceDocx, JSZip }
    if (data.template === "extreme") return fillExtremeDocx(deps.JSZip, assets.extremeDocx, data, core);
    return deps.InvoiceDocx.buildDocx(deps.docx, assets.docx, data, core);
  }

  return { TEMPLATES, FIELDS, REQUIRED, get, senderFor, missing, forRender, owners, renderPdf, buildWord, renderExtreme, fillExtremeDocx };
});
