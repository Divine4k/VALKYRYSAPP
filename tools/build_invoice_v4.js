// New design: angled black header band, client block, embedded Excel calculator, payment + signature.
// usage: node build_invoice_v4.js LOGO_ON_DARK.png BACKGROUND.png OUT.docx LOGO_W LOGO_H
// env PREVIEW_IMG/PREVIEW_H: put the table picture in place of the Excel object (check render of Word's view)
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, BorderStyle, WidthType, VerticalAlign, TableLayoutType, LineRuleType,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType,
} = require("docx");

const [logoPath, bgPath, outPath, logoW, logoH] = process.argv.slice(2);
const G = (k, d) => Number(process.env[k] ?? d); // tunable gaps (twips)

const FONT = "Calibri";
const INK = "111111", BODY = "333333", MUTED = "6B6B6B", YELLOW = "FEBD17", WHITE = "FFFFFF", SOFT = "B8B8B8";
const RIGHT = AlignmentType.RIGHT;
const W_TOTAL = 10206;
const COL_A = 4890; // width of the table's description column inside the 510 pt object

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const TABLE_NO_BORDERS = { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE };

const t = (text, o = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 20, bold: o.bold, color: o.color ?? BODY, allCaps: o.caps, characterSpacing: o.spacing });
const p = (runs, o = {}) =>
  new Paragraph({
    alignment: o.align,
    spacing: { before: o.before ?? 0, after: 0, line: o.line ?? 276, lineRule: LineRuleType.AUTO },
    children: Array.isArray(runs) ? runs : [runs],
  });
const gap = (twips) => new Paragraph({ spacing: { before: 0, after: 0, line: twips, lineRule: LineRuleType.EXACT }, children: [] });
const tiny = () =>
  new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: "", size: 2, font: FONT })] });
const cell = (children, width, o = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: NO_BORDERS,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    verticalAlign: o.valign,
    children,
  });
const label = (s, color = MUTED) => p(t(s, { size: 15, bold: true, color, caps: true, spacing: 24 }));
const table = (cols, rows, o = {}) =>
  new Table({
    width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: cols,
    alignment: o.align,
    layout: TableLayoutType.FIXED,
    borders: TABLE_NO_BORDERS,
    rows: rows.map((children) => new TableRow({ children })),
  });

// ---- inside the black band ------------------------------------------------------------------------
const logoPara = new Paragraph({
  spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
  children: [
    new ImageRun({
      type: "png",
      data: fs.readFileSync(logoPath),
      transformation: { width: Number(logoW), height: Number(logoH) },
      altText: { title: "Valkyrys logo", description: "Valkyrys logo", name: "logo" },
    }),
  ],
});

const meta = table(
  [1450, 1650],
  [
    ["Factuurnr.", "61-2026"],
    ["Datum", "29/10/2026"],
  ].map(([l, v], i) => [
    cell([p(t(l, { size: 15, bold: true, color: YELLOW, caps: true, spacing: 24 }), { before: i ? 90 : 0 })], 1450, { valign: VerticalAlign.BOTTOM }),
    cell([p(t(v, { size: 22, bold: true, color: WHITE }), { align: RIGHT, before: i ? 90 : 0 })], 1650, { valign: VerticalAlign.BOTTOM }),
  ]),
  { align: RIGHT }
);

const band = table(
  [5103, 5103],
  [
    [
      cell(
        [
          logoPara,
          gap(G("GAP_LOGO", 330)),
          p(t("Harderwijkstraat 115", { size: 18, color: SOFT })),
          p(t("2573 ZC ’s-Gravenhage", { size: 18, color: SOFT })),
          p(t("Tel: 0685029456", { size: 18, color: SOFT })),
        ],
        5103
      ),
      cell(
        [
          p(t("FACTUUR", { size: 50, bold: true, color: WHITE, spacing: 90 }), { align: RIGHT, line: 240 }),
          gap(G("GAP_TITLE", 300)),
          meta,
          tiny(),
        ],
        5103
      ),
    ],
  ]
);

// ---- client ---------------------------------------------------------------------------------------
const client = [
  label("Factuur aan"),
  p(t("Piguillet BV", { size: 26, bold: true, color: INK }), { before: 110 }),
  p(t("Edisonstraat 8"), { before: 50 }),
  p(t("2652 XS Berkel en Rodenrijs")),
  p([t("KVK ", { color: MUTED }), t("52742938")]),
  p([t("BTW ", { color: MUTED }), t("NL850577950B01")]),
];

// ---- the calculator (Excel object, or its picture for a check render) ------------------------------
const calc = process.env.PREVIEW_IMG
  ? new Paragraph({
      spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
      children: [new ImageRun({ type: "png", data: fs.readFileSync(process.env.PREVIEW_IMG), transformation: { width: 680, height: Number(process.env.PREVIEW_H) } })],
    })
  : p(t("@@XLOBJ@@"));

// ---- payment + signature, right column aligned with the totals ------------------------------------
const closing = table(
  [COL_A, W_TOTAL - COL_A],
  [
    [
      cell(
        [
          label("Betaalgegevens"),
          p(t("NL42 INGB 0103 2069 73", { size: 22, bold: true, color: INK }), { before: 110 }),
          p([t("t.n.v. ", { color: MUTED }), t("Valkyrys")], { before: 30 }),
          p(t("Graag binnen 7 tot 14 dagen, o.v.v. het factuurnummer.", { color: MUTED }), { before: 30 }),
        ],
        COL_A
      ),
      cell(
        [
          new Paragraph({
            indent: { left: 140 },
            spacing: { before: 0, after: 0, line: 276, lineRule: LineRuleType.AUTO },
            children: [t("Met vriendelijke groet", { size: 15, bold: true, color: MUTED, caps: true, spacing: 24 })],
          }),
          new Paragraph({
            indent: { left: 140 },
            spacing: { before: 110, after: 0, line: 276, lineRule: LineRuleType.AUTO },
            children: [t("P. Wodecki", { size: 22, bold: true, color: INK })],
          }),
          new Paragraph({
            indent: { left: 140 },
            spacing: { before: 30, after: 0, line: 276, lineRule: LineRuleType.AUTO },
            children: [t("Valkyrys", { color: MUTED })],
          }),
        ],
        W_TOTAL - COL_A
      ),
    ],
  ]
);

// ---- background (behind the text) -----------------------------------------------------------------
const pageHeader = new Header({
  children: [
    new Paragraph({
      spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
      children: [
        new ImageRun({
          type: "png",
          data: fs.readFileSync(bgPath),
          transformation: { width: 794, height: 1123 },
          floating: {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
            behindDocument: true,
            allowOverlap: true,
            wrap: { type: TextWrappingType.NONE },
          },
          altText: { title: "Achtergrond", description: "Decoratieve achtergrond", name: "background" },
        }),
      ],
    }),
  ],
});

const pageFooter = new Footer({
  children: [
    table(
      [5103, 5103],
      [
        [
          cell([p([t("KVK ", { size: 16, color: MUTED }), t("81828233", { size: 16, color: BODY }), t("     BTW ", { size: 16, color: MUTED }), t("NL003608498B64", { size: 16, color: BODY })])], 5103),
          cell([p(t("Bedankt voor de samenwerking.", { size: 16, bold: true, color: INK }), { align: RIGHT })], 5103),
        ],
      ]
    ),
    tiny(),
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
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: G("TOP", 840), right: 850, bottom: 1500, left: 850, header: 0, footer: G("FOOT", 760) },
        },
      },
      headers: { default: pageHeader },
      footers: { default: pageFooter },
      children: [
        band,
        gap(G("GAP_BAND", 2000)),
        ...client,
        gap(G("GAP_CLIENT", 640)),
        calc,
        gap(G("GAP_CALC", 640)),
        closing,
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("wrote", outPath, buf.length, "bytes");
});
