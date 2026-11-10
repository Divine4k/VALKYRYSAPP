/* Word (.docx) version of the invoice, same sidebar design as the PDF. Browser: window.InvoiceDocx; Node: module.exports. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.InvoiceDocx = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const FONT = "Calibri";
  const INK = "111111", BODY = "333333", MUTED = "6B6B6B", YELLOW = "FEBD17", WHITE = "FFFFFF", SOFT = "B5B5B5", HAIR = "E2E2E2";
  const PAGE_W = 11906, PAGE_H = 16838, SIDE_W = 2999, MAIN_W = PAGE_W - SIDE_W;
  const SIDE_PAD = { left: 420, right: 240 }, MAIN_PAD = { left: 790, right: 790 };
  const MAIN_INNER = MAIN_W - MAIN_PAD.left - MAIN_PAD.right; // 7326
  const COLS = [3300, 1500, 960, MAIN_INNER - 3300 - 1500 - 960];
  const ROWS = 6;

  async function buildDocx(D, assets, data, core) {
    const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, AlignmentType, BorderStyle, WidthType,
      VerticalAlign, TableLayoutType, LineRuleType, HeightRule, ShadingType, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType } = D;
    const S = data.sender, K = data.client;
    const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const NOB = { top: NONE, bottom: NONE, left: NONE, right: NONE };
    const TNOB = { ...NOB, insideHorizontal: NONE, insideVertical: NONE };
    const t = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size ?? 20, bold: o.bold, italics: o.italic, color: o.color ?? BODY, characterSpacing: o.spacing });
    const p = (runs, o = {}) => new Paragraph({ alignment: o.align, spacing: { before: o.before ?? 0, after: 0, line: o.line ?? 276, lineRule: LineRuleType.AUTO }, border: o.border, children: Array.isArray(runs) ? runs : [runs] });
    const gap = (tw) => new Paragraph({ spacing: { before: 0, after: 0, line: tw, lineRule: LineRuleType.EXACT }, children: [] });
    const tiny = () => new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: "", size: 2, font: FONT })] });
    const cell = (children, width, o = {}) => new TableCell({ width: { size: width, type: WidthType.DXA }, borders: o.borders ?? NOB,
      margins: o.margins ?? { top: 0, bottom: 0, left: 0, right: 0 }, verticalAlign: o.valign ?? VerticalAlign.TOP, shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined, children });
    const table = (cols, rows, o = {}) => new Table({ width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: cols, layout: TableLayoutType.FIXED, borders: TNOB,
      rows: rows.map((children) => new TableRow({ children, cantSplit: true, height: o.height })) });
    const label = (s, color = MUTED, before = 0) => p(t(s.toUpperCase(), { size: 15, bold: true, color, spacing: 26 }), { before });
    const img = (data, w, h, name, type = "png") => new Paragraph({ spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
      children: [new ImageRun({ type, data, transformation: { width: w, height: h }, altText: { title: name, description: name, name } })] });
    const side = (s, o = {}) => p(t(s, { size: o.size ?? 18, color: o.color ?? SOFT, bold: o.bold, italic: o.italic }), { before: o.before ?? 0 });

    const logoH = Math.round(150 * assets.logoH / assets.logoW);
    const sidebar = [
      img(assets.logo, 150, logoH, "Valkyrys logo"), gap(7045 + 2680 - 600 - 480 + 252),
      label("Van", YELLOW), side(S.name, { size: 20, bold: true, color: WHITE, before: 90 }),
      ...[S.address[0], S.address[1]].map((l, i) => side(l, { before: i === 0 ? 30 : 0 })),
      label("Contact", YELLOW, 300), side(S.address[2], { before: 90 }), ...(S.email ? [side(S.email)] : []),
      label("Betaalgegevens", YELLOW, 300), side(S.iban, { size: 20, bold: true, color: WHITE, before: 90 }), side("t.n.v. " + S.name, { before: 30 }),
      label("BTW nr", YELLOW, 300), side(S.btw, { size: 19, bold: true, color: WHITE, before: 90 }),
      label("KVK", YELLOW, 300), side(S.kvk, { size: 19, bold: true, color: WHITE, before: 90 }),
      side("Vermeld bij betaling het factuurnummer.", { size: 16, italic: true, before: 340 }),
    ];

    const mc = [2300, 2300, MAIN_INNER - 4600];
    const metaItem = (l, v, w) => cell([label(l), p(t(v, { size: 22, bold: true, color: INK }), { before: 70 })], w);
    const meta = table(mc, [[metaItem("Factuurnr.", data.factuurnr, mc[0]), metaItem("Datum", data.datum, mc[1]), metaItem("Betaaltermijn", data.betaaltermijn, mc[2])]]);

    // invoice lines: a real Word table, so rows can be edited by hand
    const lines = data.lines.slice(0, ROWS);
    const hdrCell = (s, w, align) => cell([p(t(s, { size: 16, bold: true, color: MUTED, spacing: 20 }), { align })], w,
      { valign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 30, right: 140 }, borders: { ...NOB, bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 0 } } });
    const rowCell = (s, w, o = {}) => cell([p(t(s, { size: 20, bold: o.bold, color: o.bold ? INK : BODY }), { align: o.align })], w,
      { valign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 30, right: o.right ?? 30 }, borders: { ...NOB, bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIR, space: 0 } } });
    const R = AlignmentType.RIGHT, C = AlignmentType.CENTER;
    const head = new TableRow({ height: { value: 440, rule: HeightRule.EXACT }, cantSplit: true, children: [hdrCell("OMSCHRIJVING", COLS[0]), hdrCell("TARIEF", COLS[1], R), hdrCell("AANTAL", COLS[2], C), hdrCell("BEDRAG", COLS[3], R)] });
    const body = [];
    for (let i = 0; i < ROWS; i++) {
      const l = lines[i];
      body.push(new TableRow({ height: { value: 512, rule: HeightRule.EXACT }, cantSplit: true, children: [
        rowCell(l ? l.desc : "", COLS[0], { bold: true }), rowCell(l ? core.eur(l.tarief) : "", COLS[1], { align: R }),
        rowCell(l ? core.qty(l.aantal) : "", COLS[2], { align: C }), rowCell(l ? core.eur(core.round2(l.tarief * l.aantal)) : "", COLS[3], { align: R, bold: true, right: 140 })] }));
    }
    const lineTable = new Table({ width: { size: MAIN_INNER, type: WidthType.DXA }, columnWidths: COLS, layout: TableLayoutType.FIXED, borders: TNOB, rows: [head, ...body] });

    const tot = core.totals(lines, data.btw);
    const tw = [COLS[0], COLS[1] + COLS[2], COLS[3]];
    const totRow = (l, v) => [cell([p(t("", {}))], tw[0]), cell([p(t(l, { color: MUTED }))], tw[1], { valign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 160, right: 0 } }),
      cell([p(t(v), { align: R })], tw[2], { valign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 0, right: 140 } })];
    const totals = table(tw, [totRow("Subtotaal", core.eur(tot.sub)), totRow(tot.btwLabel, core.eur(tot.vat))], { height: { value: 400, rule: HeightRule.EXACT } });
    const bar = new Table({ width: { size: MAIN_INNER, type: WidthType.DXA }, columnWidths: [COLS[0] + COLS[1], COLS[2] + COLS[3]], layout: TableLayoutType.FIXED, borders: TNOB, rows: [
      new TableRow({ height: { value: 720, rule: HeightRule.EXACT }, cantSplit: true, children: [
        cell([p(t("TOTAAL TE BETALEN", { size: 18, bold: true, color: YELLOW, spacing: 20 }))], COLS[0] + COLS[1], { fill: INK, valign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 160, right: 0 } }),
        cell([p(t(core.eur(tot.total), { size: 32, bold: true, color: WHITE }), { align: R })], COLS[2] + COLS[3], { fill: INK, valign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 0, right: 140 } })] })] });

    const main = [
      img(assets.accent, 30, 4, "accent"), gap(200),
      p(t("FACTUUR", { size: 44, bold: true, color: INK, spacing: 80 }), { line: 240 }), gap(380), meta, gap(300),
      new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 0 } }, children: [] }),
      gap(520), label("Factuur aan"), p(t(K.name, { size: 28, bold: true, color: INK }), { before: 90 }),
      ...(K.street ? [p(t(K.street), { before: 50 })] : []), ...(K.city ? [p(t(K.city))] : []),
      ...(K.kvk ? [p([t("KVK ", { color: MUTED }), t(K.kvk)])] : []), ...(K.btw ? [p([t("BTW ", { color: MUTED }), t(K.btw)])] : []),
      gap(520), lineTable, gap(240), totals, gap(160), bar, gap(560),
      p(t("Met vriendelijke groet,")), p(t(S.person, { size: 22, bold: true, color: INK }), { before: 240 }), p(t(S.name, { size: 18, color: MUTED }), { before: 20 }),
      gap(assets.footGap ?? 2400),
      new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: "DCDCDC", space: 0 } }, children: [] }),
      gap(170), p(t("Bedankt voor de samenwerking.", { size: 17, color: MUTED })),
    ];

    const page = new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: [SIDE_W, MAIN_W], layout: TableLayoutType.FIXED, borders: TNOB, rows: [
      new TableRow({ height: { value: 16700, rule: HeightRule.EXACT }, cantSplit: true, children: [
        cell(sidebar, SIDE_W, { margins: { top: 840, bottom: 0, ...SIDE_PAD } }), cell(main, MAIN_W, { margins: { top: 840, bottom: 0, ...MAIN_PAD } })] })] });

    const header = new Header({ children: [new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [
      new ImageRun({ type: "png", data: assets.background, transformation: { width: 794, height: 1123 }, floating: {
        horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
        behindDocument: true, allowOverlap: true, wrap: { type: TextWrappingType.NONE } }, altText: { title: "Achtergrond", description: "Zwarte zijbalk", name: "background" } })] })] });

    const doc = new Document({ creator: "Valkyrys", title: `Factuur ${data.factuurnr}`,
      styles: { default: { document: { run: { font: FONT, size: 20, color: BODY, language: { value: "nl-NL" } }, paragraph: { spacing: { after: 0, line: 276, lineRule: LineRuleType.AUTO } } } } },
      sections: [{ properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } } }, headers: { default: header }, children: [page, tiny()] }] });
    return typeof Buffer !== "undefined" ? Packer.toBuffer(doc) : Packer.toBlob(doc);
  }
  return { buildDocx };
});
