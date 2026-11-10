// Sidebar design: full-page two-column table (sidebar | main) over a background with the black sidebar.
// usage: node build_invoice_v5.js ASSET_DIR OUT.docx
// env PREVIEW_IMG/PREVIEW_W/PREVIEW_H: table picture instead of the Excel object (check render)
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header,
  AlignmentType, BorderStyle, WidthType, VerticalAlign, TableLayoutType, LineRuleType, HeightRule,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType,
} = require("docx");

const [assetDir, outPath] = process.argv.slice(2);
const G = (k, d) => Number(process.env[k] ?? d);
const asset = (f) => fs.readFileSync(`${assetDir}/${f}`);

const FONT = "Calibri";
const INK = "111111", BODY = "333333", MUTED = "6B6B6B", YELLOW = "FEBD17", WHITE = "FFFFFF", SOFT = "B5B5B5";
const PAGE_W = 11906, PAGE_H = 16838;
const SIDE_W = G("SIDE_TW", 3749), MAIN_W = PAGE_W - SIDE_W;
const SIDE_PAD = { left: G("SIDE_PAD_L", 540), right: G("SIDE_PAD_R", 420) };
const MAIN_PAD = { left: 790, right: 790 };
const MAIN_INNER = MAIN_W - MAIN_PAD.left - MAIN_PAD.right;

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const TABLE_NO_BORDERS = { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE };

const t = (text, o = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 20, bold: o.bold, italics: o.italic, color: o.color ?? BODY, allCaps: o.caps, characterSpacing: o.spacing });
const p = (runs, o = {}) =>
  new Paragraph({
    alignment: o.align,
    spacing: { before: o.before ?? 0, after: 0, line: o.line ?? 276, lineRule: LineRuleType.AUTO },
    border: o.border,
    children: Array.isArray(runs) ? runs : [runs],
  });
const gap = (twips) => new Paragraph({ spacing: { before: 0, after: 0, line: twips, lineRule: LineRuleType.EXACT }, children: [] });
const tiny = () =>
  new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: "", size: 2, font: FONT })] });
const cell = (children, width, o = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: NO_BORDERS,
    margins: o.margins ?? { top: 0, bottom: 0, left: 0, right: 0 },
    verticalAlign: o.valign ?? VerticalAlign.TOP,
    children,
  });
const table = (cols, rows, o = {}) =>
  new Table({
    width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: cols,
    layout: TableLayoutType.FIXED,
    borders: TABLE_NO_BORDERS,
    rows: rows.map((children) => new TableRow({ children, height: o.height })),
  });
const label = (s, color = MUTED, before = 0) => p(t(s, { size: 15, bold: true, color, caps: true, spacing: 26 }), { before });
const img = (data, w, h, name) =>
  new Paragraph({
    spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
    children: [new ImageRun({ type: "png", data, transformation: { width: w, height: h }, altText: { title: name, description: name, name } })],
  });

// ---- sidebar --------------------------------------------------------------------------------------
const side = (s, o = {}) => p(t(s, { size: o.size ?? 18, color: o.color ?? SOFT, bold: o.bold, italic: o.italic }), { before: o.before ?? 0 });
const sidebar = [
  img(asset(process.env.LOGO_FILE ?? "logo-on-dark.png"), G("LOGO_W", 178), G("LOGO_H", 41), "Valkyrys logo"),
  gap(G("SIDE_GAP", 8600)),
  label("Van", YELLOW),
  side("Valkyrys", { size: 20, bold: true, color: WHITE, before: 90 }),
  side("Harderwijkstraat 115", { before: 30 }),
  side("2573 ZC ’s-Gravenhage"),
  side("Tel: 0685029456"),
  label("Betaalgegevens", YELLOW, 300),
  side("NL42 INGB 0103 2069 73", { size: 20, bold: true, color: WHITE, before: 90 }),
  side("t.n.v. Valkyrys", { before: 30 }),
  label("BTW nr", YELLOW, 300),
  side("NL003608498B64", { size: 19, bold: true, color: WHITE, before: 90 }),
  label("KVK", YELLOW, 300),
  side("81828233", { size: 19, bold: true, color: WHITE, before: 90 }),
  side("Vermeld bij betaling het factuurnummer.", { size: 16, italic: true, before: 340 }),
  // optional signature at the bottom of the sidebar
  ...(process.env.SIG_FILE
    ? [gap(G("SIG_GAP", 1750)), img(fs.readFileSync(process.env.SIG_FILE), G("SIG_W", 150), G("SIG_H", 48), "Handtekening P. Wodecki")]
    : []),
];

// ---- main column ----------------------------------------------------------------------------------
const metaCols = [2300, 2300, MAIN_INNER - 4600];
const metaItem = (l, v, w) => cell([label(l), p(t(v, { size: 22, bold: true, color: INK }), { before: 70 })], w);
const meta = table(metaCols, [
  [
    metaItem("Factuurnr.", "61-2026", metaCols[0]),
    metaItem("Datum", "29/10/2026", metaCols[1]),
    metaItem("Betaaltermijn", "14 dagen", metaCols[2]),
  ],
]);

const calc = process.env.PREVIEW_IMG
  ? img(fs.readFileSync(process.env.PREVIEW_IMG), Number(process.env.PREVIEW_W), Number(process.env.PREVIEW_H), "tabel")
  : p(t("@@XLOBJ@@"));

const main = [
  img(asset("accent.png"), 30, 4, "accent"),
  gap(G("GAP_ACCENT", 200)),
  // heading in spaced capitals (echoes the logo); the number sits in the meta row with its label
  p(t("FACTUUR", { size: G("TITLE_SIZE", 44), bold: true, color: INK, spacing: 80 }), { line: 240 }),
  gap(G("GAP_NUMBER", 380)),
  meta,
  gap(G("GAP_META", 300)),
  new Paragraph({
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 0 } },
    children: [],
  }),
  gap(G("GAP_RULE", 520)),
  label("Factuur aan"),
  p(t("Piguillet BV", { size: 28, bold: true, color: INK }), { before: 90 }),
  p(t("Edisonstraat 8"), { before: 50 }),
  p(t("2652 XS Berkel en Rodenrijs")),
  p([t("KVK ", { color: MUTED }), t("52742938")]),
  p([t("BTW ", { color: MUTED }), t("NL850577950B01")]),
  gap(G("GAP_CLIENT", 600)),
  calc,
  gap(G("GAP_CALC", 700)),
  p(t("Met vriendelijke groet,")),
  // optional signature in the sign-off, above the typed name
  ...(process.env.SIG_MAIN
    ? [
        gap(G("SIG_MAIN_BEFORE", 140)),
        img(fs.readFileSync(process.env.SIG_MAIN), G("SIG_MAIN_W", 170), G("SIG_MAIN_H", 54), "Handtekening P. Wodecki"),
        gap(G("SIG_MAIN_AFTER", 60)),
      ]
    : []),
  p(t("P. Wodecki", { size: 22, bold: true, color: INK }), { before: process.env.SIG_MAIN ? 0 : 240 }),
  p(t("Valkyrys", { size: 18, color: MUTED }), { before: 20 }),
  // optional closing line at the bottom of the white area
  ...(process.env.FOOT_GAP
    ? [
        gap(G("FOOT_GAP", 2100)),
        new Paragraph({
          spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: "DCDCDC", space: 0 } },
          children: [],
        }),
        gap(170),
        p(t("Bedankt voor de samenwerking.", { size: 17, color: MUTED })),
      ]
    : []),
];

const page = new Table({
  width: { size: PAGE_W, type: WidthType.DXA },
  columnWidths: [SIDE_W, MAIN_W],
  layout: TableLayoutType.FIXED,
  borders: TABLE_NO_BORDERS,
  rows: [
    new TableRow({
      height: { value: G("ROW_H", 16700), rule: HeightRule.EXACT },
      cantSplit: true,
      children: [
        cell(sidebar, SIDE_W, { margins: { top: G("TOP", 840), bottom: 0, ...SIDE_PAD } }),
        cell(main, MAIN_W, { margins: { top: G("TOP", 840), bottom: 0, ...MAIN_PAD } }),
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
          data: asset("background-v5.png"),
          transformation: { width: 794, height: 1123 },
          floating: {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
            behindDocument: true,
            allowOverlap: true,
            wrap: { type: TextWrappingType.NONE },
          },
          altText: { title: "Achtergrond", description: "Zwarte zijbalk", name: "background" },
        }),
      ],
    }),
  ],
});

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
        page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } },
      },
      headers: { default: pageHeader },
      children: [page, tiny()],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("wrote", outPath, buf.length, "bytes | main column inner width", MAIN_INNER, "twips =", MAIN_INNER / 20, "pt");
});
