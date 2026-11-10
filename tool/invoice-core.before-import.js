/* Valkyrys invoice core: reads purchase orders (PO PDFs) and draws invoices in the sidebar design.
   Works in the browser (window.InvoiceCore) and in Node (module.exports) so it can be tested. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.InvoiceCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------- numbers
  const NL2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const NLQ = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 });
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const eur = (n) => "€ " + NL2.format(round2(n));
  const qty = (n) => NLQ.format(n);
  /** "1.350,00" / "450,00" / "450" -> number */
  function parseAmount(s) {
    if (typeof s === "number") return s;
    const t = String(s).replace(/[€\s]/g, "");
    if (/,\d{1,2}$/.test(t)) return parseFloat(t.replace(/\./g, "").replace(",", "."));
    return parseFloat(t.replace(/,/g, ""));
  }

  // ---------------------------------------------------------------- reading a PO
  /** pdf.js text items of one page -> text lines, top to bottom */
  function linesFromTextItems(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) =>
      r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim()
    );
  }

  const ITEM_RE = /^(\d+(?:[.,]\d+)?)\s+(.*?)\s*€\s*(-?[\d.]+,\d{2})\s*€\s*(-?[\d.]+,\d{2})\s*$/;
  const DATE_RE = /\b(\d{2})-(\d{2})-(\d{4})\b/g;

  /** text lines of a PO -> structured data */
  function parsePO(lines) {
    const text = lines.join("\n");
    const pick = (re) => { const m = text.match(re); return m ? m[1] : null; };
    const po = pick(/Ordernummer\s*:?\s*([A-Z]{1,5}-?\d{3,})/i) || pick(/\b(PO-\d{3,})\b/);
    const items = [];
    for (const line of lines) {
      const m = line.match(ITEM_RE);
      if (!m) continue;
      const desc = m[2].trim();
      const dates = [...desc.matchAll(DATE_RE)].map((d) => `${d[1]}-${d[2]}-${d[3]}`);
      items.push({
        qty: parseAmount(m[1]),
        unit: (desc.split(/\s+/)[0] || "").replace(/[^A-Za-zÀ-ÿ]/g, ""),
        desc,
        price: parseAmount(m[3]),
        total: parseAmount(m[4]),
        dates,
      });
    }
    const poTotal = pick(/Totaalbedrag(?:\s+inkooporder)?\s*€\s*([\d.]+,\d{2})/i);
    return {
      po,
      orderDate: pick(/Besteldatum\s*:?\s*(\d{2}-\d{2}-\d{4})/i),
      orderedBy: pick(/Besteld door\s*:?\s*([^\n]+)/i),
      items,
      poTotal: poTotal != null ? parseAmount(poTotal) : null,
      kvk: pick(/KvK\s*(?:nr\.?)?\s*:?\s*(\d{8})/i),
      btw: pick(/BTW\s*(?:nr\.?)?\s*:?\s*(NL[0-9A-Z]{9,12})/i),
    };
  }

  /** PO items -> invoice lines: one line per price (normally one: PO number, day rate, number of days) */
  function invoiceLinesFromPO(parsed) {
    const groups = new Map();
    for (const it of parsed.items) {
      const key = it.price.toFixed(2) + "|" + it.unit;
      if (!groups.has(key)) groups.set(key, { unit: it.unit, tarief: it.price, aantal: 0 });
      groups.get(key).aantal += it.qty;
    }
    const list = [...groups.values()];
    return list.map((g) => ({
      desc: list.length > 1 && g.unit ? `${parsed.po} – ${g.unit}` : parsed.po || "",
      tarief: g.tarief,
      aantal: round2(g.aantal),
    }));
  }

  /** sorted unique dates (dd-mm-yyyy) of all PO items */
  function poDates(parsed) {
    const key = (d) => d.split("-").reverse().join("");
    return [...new Set(parsed.items.flatMap((i) => i.dates))].sort((a, b) => key(a).localeCompare(key(b)));
  }

  /** checks shown to the user */
  function checkPO(parsed) {
    const notes = [];
    if (!parsed.po) notes.push({ level: "error", code: "n.noPo", args: [], text: "Geen ordernummer gevonden in deze PDF." });
    if (!parsed.items.length) notes.push({ level: "error", code: "n.noLines", args: [], text: "Geen regels met prijzen gevonden in deze PDF." });
    const sumItems = round2(parsed.items.reduce((a, i) => a + i.total, 0));
    const sumCalc = round2(parsed.items.reduce((a, i) => a + i.qty * i.price, 0));
    if (parsed.items.length && Math.abs(sumItems - sumCalc) > 0.01)
      notes.push({ level: "warn", code: "n.sumMismatch", args: [eur(sumCalc), eur(sumItems)], text: `Regels tellen niet op: ${eur(sumCalc)} berekend, ${eur(sumItems)} in de PO.` });
    if (parsed.poTotal != null && parsed.items.length) {
      if (Math.abs(parsed.poTotal - sumItems) <= 0.01)
        notes.push({ level: "ok", code: "n.totalOk", args: [eur(parsed.poTotal)], text: `Klopt met het PO-totaal van ${eur(parsed.poTotal)}.` });
      else notes.push({ level: "warn", code: "n.totalBad", args: [eur(parsed.poTotal), eur(sumItems)], text: `PO-totaal is ${eur(parsed.poTotal)}, de regels samen ${eur(sumItems)}.` });
    }
    return notes;
  }

  // ---------------------------------------------------------------- totals
  const BTW = {
    verlegd: { label: "BTW verlegd", rate: 0 },
    "21": { label: "BTW 21%", rate: 0.21 },
    "9": { label: "BTW 9%", rate: 0.09 },
  };
  function totals(lines, btw) {
    const sub = round2(lines.reduce((a, l) => a + round2((+l.tarief || 0) * (+l.aantal || 0)), 0));
    const b = BTW[btw] || BTW.verlegd;
    const vat = round2(sub * b.rate);
    return { sub, vat, total: round2(sub + vat), btwLabel: b.label };
  }


  // ---------------------------------------------------------------- TrueType embedding without fontkit
  /** embeds a whole .ttf (glyf outlines) as a Type0/Identity-H font; works with plain pdf-lib, no extra library needed */
  async function embedTtf(PDFLib, doc, bytes, fontName) {
    const { PDFFont, PDFHexString, PDFString, StandardFonts } = PDFLib;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tables = {};
    for (let i = 0, n = dv.getUint16(4); i < n; i++) {
      const o = 12 + i * 16, tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
      tables[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
    }
    for (const t of ["head", "hhea", "hmtx", "maxp", "cmap"]) if (!tables[t]) throw new Error("font table missing: " + t);
    const head = tables.head.off, hhea = tables.hhea.off;
    const upem = dv.getUint16(head + 18);
    const bbox = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
    const ascent = dv.getInt16(hhea + 4), descent = dv.getInt16(hhea + 6), nHM = dv.getUint16(hhea + 34);
    const numGlyphs = dv.getUint16(tables.maxp.off + 4);
    const advance = (gid) => dv.getUint16(tables.hmtx.off + 4 * Math.min(gid, nHM - 1));
    let capHeight = Math.round(upem * 0.65);
    if (tables["OS/2"] && tables["OS/2"].len >= 90 && dv.getUint16(tables["OS/2"].off) >= 2) capHeight = dv.getInt16(tables["OS/2"].off + 88) || capHeight;
    const italicAngle = tables.post ? dv.getInt32(tables.post.off + 4) / 65536 : 0;

    // cmap: format 12 (all of Unicode) or format 4 (BMP)
    let sub = null;
    const cm = tables.cmap.off;
    for (let i = 0, n = dv.getUint16(cm + 2); i < n; i++) {
      const plat = dv.getUint16(cm + 4 + i * 8), enc = dv.getUint16(cm + 6 + i * 8), off = cm + dv.getUint32(cm + 8 + i * 8), fmt = dv.getUint16(off);
      const rank = fmt === 12 && plat === 3 && enc === 10 ? 3 : fmt === 4 && plat === 3 && enc === 1 ? 2 : (fmt === 4 || fmt === 12) && plat === 0 ? 1 : 0;
      if (rank && (!sub || rank > sub.rank)) sub = { rank, off, fmt };
    }
    if (!sub) throw new Error("font has no usable cmap");
    const gidCache = new Map();
    function gidOf(cp) {
      if (gidCache.has(cp)) return gidCache.get(cp);
      let g = 0;
      const o = sub.off;
      if (sub.fmt === 12) {
        for (let i = 0, n = dv.getUint32(o + 12), p = o + 16; i < n; i++, p += 12) {
          const a = dv.getUint32(p), b = dv.getUint32(p + 4);
          if (cp >= a && cp <= b) { g = dv.getUint32(p + 8) + (cp - a); break; }
        }
      } else if (cp <= 0xffff) {
        const segX2 = dv.getUint16(o + 6), endO = o + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
        for (let i = 0; i < segX2 / 2; i++) {
          if (cp <= dv.getUint16(endO + 2 * i)) {
            const st = dv.getUint16(startO + 2 * i);
            if (cp >= st) {
              const ro = dv.getUint16(rangeO + 2 * i), delta = dv.getInt16(deltaO + 2 * i);
              if (ro === 0) g = (cp + delta) & 0xffff;
              else { const gp = rangeO + 2 * i + ro + 2 * (cp - st); g = gp + 2 <= dv.byteLength ? dv.getUint16(gp) : 0; if (g) g = (g + delta) & 0xffff; }
            }
            break;
          }
        }
      }
      if (g >= numGlyphs) g = 0;
      gidCache.set(cp, g); return g;
    }
    const used = new Map(); // gid -> code point
    const scale = 1000 / upem;
    const flags = 32 | (italicAngle ? 64 : 0);
    // pdf-lib only accepts its own embedder classes; borrow the prototype of the standard-font one and override everything we use
    const probe = await doc.embedFont(StandardFonts.Helvetica);
    doc.fonts.splice(doc.fonts.indexOf(probe), 1);
    const embedder = Object.assign(Object.create(Object.getPrototypeOf(probe.embedder)), {
      fontName,
      encodeText(text) {
        let hex = "";
        for (const ch of String(text)) { const cp = ch.codePointAt(0), g = gidOf(cp); used.set(g, g ? cp : 0x20); hex += g.toString(16).padStart(4, "0"); }
        return PDFHexString.of(hex);
      },
      widthOfTextAtSize(text, size) { let w = 0; for (const ch of String(text)) w += advance(gidOf(ch.codePointAt(0))); return (w * size) / upem; },
      heightOfFontAtSize(size, o = {}) { return ((ascent - (o.descender === false ? 0 : descent)) * size) / upem; },
      sizeOfFontAtHeight(h) { return (h * upem) / (ascent - descent); },
      embedIntoContext(context, ref) {
        const fileRef = context.register(context.flateStream(bytes, { Length1: bytes.length }));
        const gids = [...used.keys()].sort((a, b) => a - b);
        const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, "0");
        const uni = (cp) => (cp > 0xffff ? hex4(0xd800 + ((cp - 0x10000) >> 10)) + hex4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : hex4(cp));
        let cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n";
        for (let i = 0; i < gids.length; i += 100) {
          const part = gids.slice(i, i + 100);
          cmap += part.length + " beginbfchar\n" + part.map((g) => `<${hex4(g)}> <${uni(used.get(g))}>`).join("\n") + "\nendbfchar\n";
        }
        cmap += "endcmap CMapName currentdict /CMap defineresource pop end end";
        const toUni = context.register(context.flateStream(new TextEncoder().encode(cmap)));
        const desc = context.register(context.obj({ Type: "FontDescriptor", FontName: fontName, Flags: flags, FontBBox: bbox.map((v) => Math.round(v * scale)),
          ItalicAngle: italicAngle, Ascent: Math.round(ascent * scale), Descent: Math.round(descent * scale), CapHeight: Math.round(capHeight * scale), StemV: 80, FontFile2: fileRef }));
        const w = [];
        for (const g of gids) w.push(g, [Math.round(advance(g) * scale)]);
        const cid = context.register(context.obj({ Type: "Font", Subtype: "CIDFontType2", BaseFont: fontName,
          CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 }, FontDescriptor: desc, DW: 1000, W: w, CIDToGIDMap: "Identity" }));
        context.assign(ref, context.obj({ Type: "Font", Subtype: "Type0", BaseFont: fontName, Encoding: "Identity-H", DescendantFonts: [cid], ToUnicode: toUni }));
        return Promise.resolve(ref);
      },
    });
    const ref = doc.context.nextRef();
    const font = PDFFont.of(ref, doc, embedder);
    doc.fonts.push(font);
    return font;
  }

  // ---------------------------------------------------------------- drawing the invoice
  // Positions in pt from the top of an A4 page, measured from the Word invoice.
  const PAGE_W = 595.28, PAGE_H = 841.89, SIDE_W = 149.95;
  const MX = 189.55, MR = 555.55;                       // main column left / right
  const COL = [189.55, 354.55, 429.55, 477.55, 555.55]; // table column edges A|B|C|D
  const C = {
    INK: "111111", BODY: "333333", MUTED: "6B6B6B", YELLOW: "FEBD17",
    WHITE: "FFFFFF", SOFT: "B5B5B5", HAIR: "E2E2E2", FOOT: "DCDCDC",
  };
  const MAX_LINES = 6;

  async function renderInvoice(PDFLib, assets, data) {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const color = (h) => { const n = parseInt(h, 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
    const doc = await PDFDocument.create();
    doc.setTitle(`Factuur ${data.factuurnr}`);
    doc.setAuthor("Valkyrys");
    doc.setSubject(data.lines.map((l) => l.desc).join(", "));
    doc.setCreator("Valkyrys facturen");
    doc.setLanguage("nl-NL");

    let R, B, I, winAnsiOnly = false;
    if (assets.fontkit && assets.fonts) {
      doc.registerFontkit(assets.fontkit);
      R = await doc.embedFont(assets.fonts.regular, { subset: false });
      B = await doc.embedFont(assets.fonts.bold, { subset: false });
      I = await doc.embedFont(assets.fonts.italic, { subset: false });
    } else if (assets.fonts && PDFLib.PDFFont && PDFLib.PDFFont.of) {
      try {
        R = await embedTtf(PDFLib, doc, assets.fonts.regular, "Carlito");
        B = await embedTtf(PDFLib, doc, assets.fonts.bold, "Carlito-Bold");
        I = await embedTtf(PDFLib, doc, assets.fonts.italic, "Carlito-Italic");
      } catch (e) { if (typeof console !== "undefined") console.warn("font embed failed:", e && e.message); R = B = I = null; }
    }
    if (!R) {
      R = await doc.embedFont(StandardFonts.Helvetica);
      B = await doc.embedFont(StandardFonts.HelveticaBold);
      I = await doc.embedFont(StandardFonts.HelveticaOblique);
      winAnsiOnly = true;
    }
    const ASCII_FALLBACK = (ch) => { if (ch === "ł") return "l"; if (ch === "Ł") return "L"; const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); return /^[\x20-\x7E]$/.test(base) ? base : "?"; };
    const safe = (s) => (winAnsiOnly ? String(s).normalize("NFC").replace(/[^\x20-\x7E -ÿ€‘’“”–—]/g, ASCII_FALLBACK) : String(s));

    const page = doc.addPage([PAGE_W, PAGE_H]);
    const rect = (x, top, w, h, hex) => page.drawRectangle({ x, y: PAGE_H - top - h, width: w, height: h, color: color(hex) });
    const width = (s, font, size, tracking = 0) => {
      s = safe(s);
      return tracking ? [...s].reduce((a, ch) => a + font.widthOfTextAtSize(ch, size), 0) + tracking * (s.length - 1) : font.widthOfTextAtSize(s, size);
    };
    /** baseline = distance from the top of the page */
    function text(s, x, baseline, size, font, hex, opt = {}) {
      s = safe(s);
      if (!s) return;
      const w = width(s, font, size, opt.tracking || 0);
      if (opt.align === "right") x -= w;
      else if (opt.align === "center") x -= w / 2;
      const y = PAGE_H - baseline;
      if (opt.tracking) {
        for (const ch of s) {
          page.drawText(ch, { x, y, size, font, color: color(hex) });
          x += font.widthOfTextAtSize(ch, size) + opt.tracking;
        }
      } else page.drawText(s, { x, y, size, font, color: color(hex) });
    }
    const label = (s, x, baseline, hex) => text(s.toUpperCase(), x, baseline, 7.5, B, hex, { tracking: 1.3 });
    // vertically centred in a row, like Excel does
    const mid = (top, h, size) => top + h / 2 + 0.3415 * size;

    // --- sidebar
    const side = await doc.embedPng(assets.images.sidebar);
    page.drawImage(side, { x: 0, y: 0, width: SIDE_W, height: PAGE_H });
    const logo = await doc.embedPng(assets.images.logo);
    const lw = 112.5, lh = lw * logo.height / logo.width;
    page.drawImage(logo, { x: 21.1, y: PAGE_H - 44.9 - lh, width: lw, height: lh });
    const SY = 134; // the sidebar text block sits lower on the page
    const S = data.sender;
    const LH = 12.65;
    // VAN (company, street, city) and CONTACT (phone, e-mail); the blocks below keep their place
    label("Van", 21.1, SY + 387.24, C.YELLOW);
    text(S.name, 21.1, SY + 404.64, 10, B, C.WHITE);
    [S.address[0], S.address[1]].forEach((l, i) => text(l, 21.1, SY + 419.14 + i * LH, 9, R, C.SOFT));
    label("Contact", 21.1, SY + 458.04, C.YELLOW);
    [S.address[2], S.email].filter(Boolean).forEach((l, i) => text(l, 21.1, SY + 475.04 + i * LH, 9, R, C.SOFT));
    label("Betaalgegevens", 21.1, SY + 513.94, C.YELLOW);
    text(S.iban, 21.1, SY + 531.34, 10, B, C.WHITE);
    text("t.n.v. " + S.name, 21.1, SY + 545.84, 9, R, C.SOFT);
    label("BTW nr", 21.1, SY + 572.09, C.YELLOW);
    text(S.btw, 21.1, SY + 589.0, 9.5, B, C.WHITE);
    label("KVK", 21.1, SY + 615.39, C.YELLOW);
    text(S.kvk, 21.1, SY + 632.3, 9.5, B, C.WHITE);
    text("Vermeld bij betaling het", 21.1, SY + 661.14, 8, I, C.SOFT);
    text("factuurnummer.", 21.1, SY + 672.34, 8, I, C.SOFT);

    // --- heading and meta row
    rect(MX, 44.9, 22.5, 3.0, C.YELLOW);
    text("FACTUUR", MX, 87.98, 22, B, C.INK, { tracking: 4 });
    [["Factuurnr.", data.factuurnr, MX], ["Datum", data.datum, 304.5], ["Betaaltermijn", data.betaaltermijn, 419.5]].forEach(([l, v, x]) => {
      label(l, x, 120.04, C.MUTED);
      text(v, x, 137.39, 11, B, C.INK);
    });
    rect(MX, 158.16, MR + 0.35 - MX, 1.5, C.INK);

    // --- client
    const K = data.client;
    label("Factuur aan", MX, 192.69, C.MUTED);
    text(K.name, MX, 213.89, 14, B, C.INK);
    const clientLines = [[null, K.street], [null, K.city], ["KVK ", K.kvk], ["BTW ", K.btw]].filter(([, v]) => v);
    clientLines.forEach(([lab, v], i) => {
      const y = 232.24 + i * 14;
      if (lab) {
        text(lab, MX, y, 10, R, C.MUTED);
        text(v, MX + width(lab, R, 10), y, 10, R, C.BODY);
      } else text(v, MX, y, 10, R, C.BODY);
    });

    // --- table
    let top = 308.6;
    const HEAD_H = 22, ROW_H = 25.6;
    const hdr = (s, x, align) => text(s, x, mid(top, HEAD_H, 8), 8, B, C.MUTED, { align });
    hdr("OMSCHRIJVING", COL[0] + 1.5);
    hdr("TARIEF", COL[2] - 1.5, "right");
    hdr("AANTAL", (COL[2] + COL[3]) / 2, "center");
    hdr("BEDRAG", COL[4] - 7, "right");
    top += HEAD_H;
    rect(MX, top - 0.75, MR - MX, 1.5, C.INK);
    const lines = data.lines.slice(0, MAX_LINES);
    for (let r = 0; r < MAX_LINES; r++) {
      const l = lines[r];
      if (l) {
        const y = mid(top, ROW_H, 10);
        text(l.desc, COL[0] + 1.5, y, 10, B, C.INK);
        text(eur(l.tarief), COL[2] - 1.5, y, 10, R, C.BODY, { align: "right" });
        text(qty(l.aantal), (COL[2] + COL[3]) / 2, y, 10, R, C.BODY, { align: "center" });
        text(eur(round2(l.tarief * l.aantal)), COL[4] - 7, y, 10, B, C.INK, { align: "right" });
      }
      top += ROW_H;
      rect(MX, top - 0.375, MR - MX, 0.75, C.HAIR);
    }
    const t = totals(lines, data.btw);
    top += 12;
    text("Subtotaal", COL[1] + 8, mid(top, 20, 10), 10, R, C.MUTED);
    text(eur(t.sub), COL[4] - 7, mid(top, 20, 10), 10, R, C.BODY, { align: "right" });
    top += 20;
    text(t.btwLabel, COL[1] + 8, mid(top, 20, 10), 10, R, C.MUTED);
    text(eur(t.vat), COL[4] - 7, mid(top, 20, 10), 10, R, C.BODY, { align: "right" });
    top += 20;
    rect(COL[1], top, MR - COL[1], 0.75, C.HAIR);
    top += 0.75 + 11.6;
    rect(MX, top, MR - MX, 36, C.INK);
    text("TOTAAL TE BETALEN", COL[0] + 8, mid(top, 36, 9), 9, B, C.YELLOW);
    text(eur(t.total), COL[4] - 7, mid(top, 36, 16), 16, B, C.WHITE, { align: "right" });

    // --- sign-off and closing line
    text("Met vriendelijke groet,", MX, 629.24, 10, R, C.BODY);
    text(S.person, MX, 656.19, 11, B, C.INK);
    text(S.name, MX, 670.69, 9, R, C.MUTED);
    rect(MX, 780.72, MR + 0.35 - MX, 0.5, C.FOOT);
    text("Bedankt voor de samenwerking.", MX, 798.75, 8.5, R, C.MUTED);

    return doc.save();
  }

  const SENDER = {
    name: "Valkyrys",
    person: "P. Wodecki",
    fullName: "Przemysław Wodecki",
    email: "Valkyrys.bv@gmail.com",
    address: ["Harderwijkstraat 115", "2573 ZC ’s-Gravenhage", "Tel: 0685029456"],
    iban: "NL42 INGB 0103 2069 73",
    btw: "NL003608498B64",
    kvk: "81828233",
  };

  return { parseAmount, eur, qty, round2, linesFromTextItems, parsePO, invoiceLinesFromPO, poDates, checkPO, totals, BTW, renderInvoice, SENDER, MAX_LINES };
});
