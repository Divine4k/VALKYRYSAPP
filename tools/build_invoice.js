const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign, TableLayoutType,
  HeightRule, LineRuleType,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType,
} = require("docx");

const [logoPath, watermarkPath, outPath, logoW, logoH] = process.argv.slice(2);
const LOGO_W = Number(logoW || 221);
const LOGO_H = Number(logoH || 54);
const logo = fs.readFileSync(logoPath);
const watermark = fs.readFileSync(watermarkPath);

const FONT = "Calibri";
const INK = "111111";
const BODY = "333333";
const MUTED = "5C5C5C";
const HAIR = "DDDDDD";
const ACCENT = "FEBD17";
const RIGHT = AlignmentType.RIGHT;

const W_TOTAL = 10206; // A4 (11906) minus 2 x 850 margin

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const TABLE_NO_BORDERS = { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE };
const BOTTOM_HAIR = { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIR } };
const TOP_RULE = { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 12, color: INK } };
const ACCENT_LINE = { style: BorderStyle.SINGLE, size: 4, color: ACCENT };
const ACCENT_BOX = { top: ACCENT_LINE, bottom: ACCENT_LINE, left: ACCENT_LINE, right: ACCENT_LINE };

const t = (text, o = {}) =>
  new TextRun({
    text,
    font: FONT,
    size: o.size ?? 20,
    bold: o.bold,
    color: o.color ?? BODY,
    allCaps: o.caps,
    characterSpacing: o.spacing,
  });

const p = (runs, o = {}) =>
  new Paragraph({
    alignment: o.align,
    spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.line ?? 276, lineRule: LineRuleType.AUTO },
    children: Array.isArray(runs) ? runs : [runs],
  });

// Empty paragraph of an exact height; also keeps two tables from merging in Word.
const gap = (twips) =>
  new Paragraph({
    spacing: { before: 0, after: 0, line: twips, lineRule: LineRuleType.EXACT },
    children: [],
  });

const tiny = () =>
  new Paragraph({
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text: "", size: 2, font: FONT })],
  });

const cell = (children, width, o = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: o.borders ?? NO_BORDERS,
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    margins: o.margins ?? { top: 0, bottom: 0, left: 0, right: 0 },
    verticalAlign: o.valign,
    children,
  });

const label = (s) => p(t(s, { size: 16, bold: true, color: MUTED, caps: true, spacing: 22 }));

// ---- Header block: logo left, "Factuur" right -----------------------------------------
const logoPara = new Paragraph({
  spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
  children: [
    new ImageRun({
      type: "png",
      data: logo,
      transformation: { width: LOGO_W, height: LOGO_H },
      altText: { title: "Valkyrys logo", description: "Valkyrys logo", name: "logo" },
    }),
  ],
});
const headerTable = new Table({
  width: { size: W_TOTAL, type: WidthType.DXA },
  columnWidths: [5000, 5206],
  layout: TableLayoutType.FIXED,
  borders: TABLE_NO_BORDERS,
  rows: [
    new TableRow({
      children: [
        cell([logoPara], 5000),
        cell(
          process.env.V3
            ? [
                // uppercase, letter-spaced title to echo the logo's wide capitals
                p(t("FACTUUR", { size: 46, bold: true, color: INK, spacing: 70 }), { align: RIGHT, line: 240 }),
                gap(200),
                new Table({
                  width: { size: 2900, type: WidthType.DXA },
                  columnWidths: [1350, 1550],
                  alignment: RIGHT,
                  layout: TableLayoutType.FIXED,
                  borders: TABLE_NO_BORDERS,
                  rows: [
                    ["Factuurnr.", "61-2026"],
                    ["Datum", "29/10/2026"],
                  ].map(
                    ([l, v], i) =>
                      new TableRow({
                        children: [
                          cell([p(t(l, { size: 15, bold: true, color: MUTED, caps: true, spacing: 22 }), { before: i ? 70 : 0 })], 1350, {
                            valign: VerticalAlign.BOTTOM,
                          }),
                          cell([p(t(v, { size: 21, bold: true, color: INK }), { align: RIGHT, before: i ? 70 : 0 })], 1550, {
                            valign: VerticalAlign.BOTTOM,
                          }),
                        ],
                      })
                  ),
                }),
                tiny(),
              ]
            : [
                p(t("Factuur", { size: 52, bold: true, color: INK }), { align: RIGHT, line: 240 }),
                p([t("Nr. ", { color: MUTED }), t("61-2026", { bold: true, color: INK })], { align: RIGHT, before: 160 }),
                p([t("Datum ", { color: MUTED }), t("29/10/2026", { bold: true, color: INK })], { align: RIGHT, before: 40 }),
              ],
          5206
        ),
      ],
    }),
  ],
});

// ---- Van / Factuur aan --------------------------------------------------------------------
const party = (labelText, name, lines, width) =>
  cell(
    [
      label(labelText),
      p(t(name, { size: 22, bold: true, color: INK }), { before: 120 }),
      ...lines.map((l, i) => p(t(l), { before: i === 0 ? 60 : 0 })),
    ],
    width
  );

const partiesTable = new Table({
  width: { size: W_TOTAL, type: WidthType.DXA },
  columnWidths: [5103, 5103],
  layout: TableLayoutType.FIXED,
  borders: TABLE_NO_BORDERS,
  rows: [
    new TableRow({
      children: [
        party("Van", "Valkyrys", ["Harderwijkstraat 115", "2573 ZC ’s-Gravenhage", "Tel: 0685029456"], 5103),
        party(
          "Factuur aan",
          "Piguillet BV",
          ["Edisonstraat 8", "2652 XS Berkel en Rodenrijs", "KVK nr: 52742938", "BTW nr: NL850577950B01"],
          5103
        ),
      ],
    }),
  ],
});

// ---- Line items -------------------------------------------------------------------------------
const COLS = [4906, 1800, 1300, 2200];
const HEAD_PAD = { top: 120, bottom: 120, left: 160, right: 160 };
const ROW_PAD = { top: 150, bottom: 150, left: 160, right: 160 };

const headCell = (text, width, align) =>
  cell([p(t(text, { size: 16, bold: true, color: "FFFFFF", caps: true, spacing: 22 }), { align })], width, {
    fill: INK,
    margins: HEAD_PAD,
    valign: VerticalAlign.CENTER,
  });

const itemRow = (desc, rate, qty, amount) =>
  new TableRow({
    height: { value: 600, rule: HeightRule.ATLEAST },
    children: [
      cell([p(t(desc, { bold: true, color: INK, size: 21 }))], COLS[0], { borders: BOTTOM_HAIR, margins: ROW_PAD, valign: VerticalAlign.CENTER }),
      cell([p(t(rate, { size: 21 }), { align: RIGHT })], COLS[1], { borders: BOTTOM_HAIR, margins: ROW_PAD, valign: VerticalAlign.CENTER }),
      cell([p(t(qty, { size: 21 }), { align: RIGHT })], COLS[2], { borders: BOTTOM_HAIR, margins: ROW_PAD, valign: VerticalAlign.CENTER }),
      cell([p(t(amount, { bold: true, color: INK, size: 21 }), { align: RIGHT })], COLS[3], { borders: BOTTOM_HAIR, margins: ROW_PAD, valign: VerticalAlign.CENTER }),
    ],
  });

const itemsTable = new Table({
  width: { size: W_TOTAL, type: WidthType.DXA },
  columnWidths: COLS,
  layout: TableLayoutType.FIXED,
  borders: TABLE_NO_BORDERS,
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        headCell("Omschrijving", COLS[0], AlignmentType.LEFT),
        headCell("Tarief", COLS[1], RIGHT),
        headCell("Aantal", COLS[2], RIGHT),
        headCell("Bedrag", COLS[3], RIGHT),
      ],
    }),
    itemRow("PO-008074", "€ 450,00", "5", "€ 2.250,00"),
    itemRow("", "", "", ""),
    itemRow("", "", "", ""),
    itemRow("", "", "", ""),
  ],
});

// ---- Totals ---------------------------------------------------------------------------------------
const TCOLS = [2550, 2250];
const SUM_PAD = { top: 100, bottom: 100, left: 200, right: 200 };

const totalsTable = new Table({
  width: { size: 4800, type: WidthType.DXA },
  columnWidths: TCOLS,
  alignment: RIGHT,
  layout: TableLayoutType.FIXED,
  borders: TABLE_NO_BORDERS,
  rows: [
    new TableRow({
      children: [
        cell([p(t("Subtotaal"))], TCOLS[0], { margins: SUM_PAD }),
        cell([p(t("€ 2.250,00"), { align: RIGHT })], TCOLS[1], { margins: SUM_PAD }),
      ],
    }),
    new TableRow({
      children: [
        cell([p(t("BTW"))], TCOLS[0], { borders: BOTTOM_HAIR, margins: SUM_PAD }),
        cell([p(t("Verlegd"), { align: RIGHT })], TCOLS[1], { borders: BOTTOM_HAIR, margins: SUM_PAD }),
      ],
    }),
    new TableRow({
      height: { value: 140, rule: HeightRule.EXACT },
      children: [cell([tiny()], TCOLS[0]), cell([tiny()], TCOLS[1])],
    }),
    new TableRow({
      children: [
        cell([p(t("Totaal incl. BTW", { size: 17, bold: true, color: "FFFFFF", caps: true, spacing: 22 }))], TCOLS[0], {
          fill: ACCENT,
          borders: ACCENT_BOX,
          margins: { top: 200, bottom: 200, left: 200, right: 100 },
          valign: VerticalAlign.CENTER,
        }),
        cell([p(t("€ 2.250,00", { size: 30, bold: true, color: "FFFFFF" }), { align: RIGHT, line: 240 })], TCOLS[1], {
          fill: ACCENT,
          borders: ACCENT_BOX,
          margins: { top: 200, bottom: 200, left: 100, right: 200 },
          valign: VerticalAlign.CENTER,
        }),
      ],
    }),
  ],
});

// ---- Page header: full-page background (watermark + top bar), behind the text -----------------
const pageHeader = new Header({
  children: [
    new Paragraph({
      spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
      children: [
        new ImageRun({
          type: "png",
          data: watermark,
          transformation: { width: 794, height: 1123 },
          floating: {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
            behindDocument: true,
            allowOverlap: true,
            wrap: { type: TextWrappingType.NONE },
          },
          altText: { title: "Watermerk", description: "Decoratief watermerk", name: "watermark" },
        }),
      ],
    }),
  ],
});

// ---- Page footer: bank details ----------------------------------------------------------------------
const V2 = !!process.env.V2; // black footer band, payment note in the table, greeting
const footItem = (labelText, value, width) =>
  cell(
    [
      p(t(labelText, { size: 15, bold: true, color: V2 ? ACCENT : MUTED, caps: true, spacing: 20 })),
      p(t(value, { size: 19, bold: true, color: V2 ? "FFFFFF" : INK }), { before: 60 }),
    ],
    width,
    V2
      ? { borders: NO_BORDERS, margins: { top: 0, bottom: 0, left: 0, right: 0 } }
      : { borders: TOP_RULE, margins: { top: 200, bottom: 0, left: 0, right: 0 } }
  );

const pageFooter = new Footer({
  children: [
    new Table({
      width: { size: W_TOTAL, type: WidthType.DXA },
      columnWidths: [3402, 3402, 3402],
      layout: TableLayoutType.FIXED,
      borders: TABLE_NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            footItem("ING rekeningnummer", "NL42 INGB 0103 2069 73", 3402),
            footItem("BTW nr", "NL003608498B64", 3402),
            footItem("KVK", "81828233", 3402),
          ],
        }),
      ],
    }),
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
          margin: V2
            ? { top: 1100, right: 850, bottom: 1900, left: 850, header: 0, footer: 520 }
            : { top: 1100, right: 850, bottom: 1500, left: 850, header: 0, footer: 500 },
        },
      },
      headers: { default: pageHeader },
      footers: { default: pageFooter },
      children: [
        headerTable,
        gap(780),
        partiesTable,
        gap(720),
        ...(process.env.WORD_TABLES
          ? [itemsTable, gap(420), totalsTable]
          : process.env.PREVIEW_IMG
          ? [
              new Paragraph({
                spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
                children: [
                  new ImageRun({
                    type: "png",
                    data: fs.readFileSync(process.env.PREVIEW_IMG),
                    transformation: { width: 680, height: Number(process.env.PREVIEW_H) },
                  }),
                ],
              }),
            ]
          : [p(t("@@XLOBJ@@"))]),
        gap(560),
        V2 ? p(t("Met vriendelijke groet,")) : p(t("Gelieve te betalen binnen 7 tot 14 dagen.")),
        p(t("P. Wodecki", { size: 22, bold: true, color: INK }), { before: V2 ? 280 : 360 }),
        p(t("Valkyrys", { size: 18, color: MUTED }), { before: 20 }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("wrote", outPath, buf.length, "bytes");
});
