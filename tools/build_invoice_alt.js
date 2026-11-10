// Sidebar design: black left sidebar (logo + company details) in the page header, white main column.
// usage: node build_invoice_alt.js BG.png WHITE_LOGO.png OUT.docx
// env PREVIEW_IMG / PREVIEW_H: put the table picture in place of the Excel placeholder (check renders)
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header,
  AlignmentType, BorderStyle, WidthType, VerticalAlign, TableLayoutType, LineRuleType,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType,
  TableAnchorType, OverlapType,
} = require("docx");

const [bgPath, logoPath, outPath] = process.argv.slice(2);

const FONT = "Calibri";
const INK = "121212";
const BODY = "333333";
const MUTED = "6B6B6B";
const ICE = "8FC9EE";
const GREY = "B8B8B8";
const WHITE = "FFFFFF";

const MM = 56.6929;         // twips per mm
const EMU_MM = 36000;       // EMU per mm
const PAGE_W = 11906;
const LEFT = Math.round(78 * MM);
const RIGHT = Math.round(14 * MM);
const MAIN_W = PAGE_W - LEFT - RIGHT;
const SIDE_X = Math.round(10 * MM);
const SIDE_W = Math.round(48 * MM);

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const TABLE_NO_BORDERS = { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE };

const t = (text, o = {}) =>
  new TextRun({
    text,
    font: FONT,
    size: o.size ?? 20,
    bold: o.bold,
    italics: o.italics,
    color: o.color ?? BODY,
    allCaps: o.caps,
    characterSpacing: o.spacing,
  });

const p = (runs, o = {}) =>
  new Paragraph({
    alignment: o.align,
    spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.line ?? 276, lineRule: LineRuleType.AUTO },
    border: o.border,
    children: Array.isArray(runs) ? runs : [runs],
  });

const gap = (twips) =>
  new Paragraph({ spacing: { before: 0, after: 0, line: twips, lineRule: LineRuleType.EXACT }, children: [] });

const tiny = () =>
  new Paragraph({
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text: "", size: 2, font: FONT })],
  });

const cell = (children, width, o = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: NO_BORDERS,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    verticalAlign: o.valign,
    children,
  });

const label = (s, color = MUTED, before = 0) =>
  p(t(s, { size: 15, bold: true, color, caps: true, spacing: 30 }), { before });

// ---- Sidebar: background, white logo, company details (all in the header, so they repeat per page) ----
const floatAt = (xMm, yMm, behind) => ({
  horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: Math.round(xMm * EMU_MM) },
  verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: Math.round(yMm * EMU_MM) },
  behindDocument: behind,
  allowOverlap: true,
  wrap: { type: TextWrappingType.NONE },
});

const logoW = 181; // 48 mm at 96 dpi
const logoH = Math.round((logoW * 318) / 1365);

const side = (s, o = {}) => p(t(s, { size: o.size ?? 19, bold: o.bold, color: o.color ?? GREY, italics: o.italics }), { before: o.before ?? 0 });

const sidebarInfo = new Table({
  width: { size: SIDE_W, type: WidthType.DXA },
  columnWidths: [SIDE_W],
  layout: TableLayoutType.FIXED,
  borders: TABLE_NO_BORDERS,
  float: {
    horizontalAnchor: TableAnchorType.PAGE,
    verticalAnchor: TableAnchorType.PAGE,
    absoluteHorizontalPosition: SIDE_X,
    absoluteVerticalPosition: Math.round(196 * MM),
    overlap: OverlapType.OVERLAP,
  },
  rows: [
    new TableRow({
      children: [
        cell(
          [
            label("Van", ICE),
            side("Valkyrys", { bold: true, color: WHITE, size: 21, before: 80 }),
            side("Harderwijkstraat 115", { before: 20 }),
            side("2573 ZC ’s-Gravenhage"),
            side("Tel: 0685029456"),

            label("Betaalgegevens", ICE, 300),
            side("NL42 INGB 0103 2069 73", { bold: true, color: WHITE, size: 20, before: 80 }),
            side("t.n.v. Valkyrys", { before: 20 }),

            label("BTW nr", ICE, 300),
            side("NL003608498B64", { color: WHITE, before: 60 }),
            label("KVK", ICE, 160),
            side("81828233", { color: WHITE, before: 60 }),

            side("Vermeld bij betaling het factuurnummer.", { size: 17, italics: true, before: 300 }),
          ],
          SIDE_W
        ),
      ],
    }),
  ],
});

const pageHeader = new Header({
  children: [
    new Paragraph({
      spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
      children: [
        new ImageRun({
          type: "png",
          data: fs.readFileSync(bgPath),
          transformation: { width: 794, height: 1123 },
          floating: floatAt(0, 0, true),
          altText: { title: "Achtergrond", description: "Zwarte zijbalk met Valkyrys-embleem", name: "background" },
        }),
        new ImageRun({
          type: "png",
          data: fs.readFileSync(logoPath),
          transformation: { width: logoW, height: logoH },
          floating: floatAt(10, 20, false),
          altText: { title: "Valkyrys logo", description: "Valkyrys logo", name: "logo" },
        }),
      ],
    }),
    sidebarInfo,
    tiny(),
  ],
});

// ---- Main column ---------------------------------------------------------------------------------
const metaCol = (l, v, w) => cell([label(l), p(t(v, { size: 21, bold: true, color: INK }), { before: 50 })], w);

const meta = new Table({
  width: { size: MAIN_W, type: WidthType.DXA },
  columnWidths: [2600, MAIN_W - 2600],
  layout: TableLayoutType.FIXED,
  borders: TABLE_NO_BORDERS,
  rows: [new TableRow({ children: [metaCol("Datum", "29/10/2026", 2600), metaCol("Betaaltermijn", "7 tot 14 dagen", MAIN_W - 2600)] })],
});

const tablePara = process.env.PREVIEW_IMG
  ? new Paragraph({
      spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
      children: [
        new ImageRun({
          type: "png",
          data: fs.readFileSync(process.env.PREVIEW_IMG),
          transformation: { width: Math.round((MAIN_W / 20) * (96 / 72)), height: Number(process.env.PREVIEW_H) },
        }),
      ],
    })
  : p(t("@@XLOBJ@@"));

const doc = new Document({
  creator: "Valkyrys",
  title: "Factuur 61-2026",
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 20, color: BODY, language: { value: "nl-NL" } },
        paragraph: { spacing: { after: 0, line: 276, lineRule: LineRuleType.AUTO } },
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: 16838 },
          margin: { top: Math.round(20 * MM), right: RIGHT, bottom: Math.round(15 * MM), left: LEFT, header: 0, footer: 0 },
        },
      },
      headers: { default: pageHeader },
      children: [
        label("Factuur"),
        p(t("61-2026", { size: 76, bold: true, color: INK }), { line: 240, before: 40 }),
        gap(260),
        meta,
        p(t(""), { line: 240, before: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: INK, space: 12 } } }),
        gap(460),
        label("Factuur aan"),
        p(t("Piguillet BV", { size: 28, bold: true, color: INK }), { before: 80, line: 240 }),
        p(t("Edisonstraat 8"), { before: 100 }),
        p(t("2652 XS Berkel en Rodenrijs")),
        p([t("KVK ", { color: MUTED }), t("52742938")]),
        p([t("BTW ", { color: MUTED }), t("NL850577950B01")]),
        gap(600),
        tablePara,
        gap(640),
        p(t("Met vriendelijke groet,")),
        p(t("P. Wodecki", { size: 22, bold: true, color: INK }), { before: 260 }),
        p(t("Valkyrys", { size: 18, color: MUTED }), { before: 20 }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("wrote", outPath, buf.length, "bytes | main column", (MAIN_W / 20).toFixed(1), "pt");
});
