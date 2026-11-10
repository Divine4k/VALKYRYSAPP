"""Build the invoice calculator workbook that gets embedded in the Word invoice.

usage: build_xlsx.py OUT.xlsx [--set CELL=VALUE ...]

Prints the range's natural size in Excel (points), needed for the Word object's original size.
"""
import math
import re
import shutil
import sys
import tempfile
import zipfile

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

args = sys.argv[1:]
out = args[0]
overrides = {}
if "--set" in args:
    for a in args[args.index("--set") + 1:]:
        k, v = a.split("=", 1)
        try:
            v = float(v) if "." in v else int(v)
        except ValueError:
            pass
        overrides[k] = v

FONT = "Calibri"
INK, BODY, MUTED, HAIR, WHITE = "111111", "333333", "5C5C5C", "DDDDDD", "FFFFFF"
YELLOW = "FEBD17"
# [$-413] = Dutch: LibreOffice-based viewers then also show 2.250,00; Excel uses the system separators
EUR = '[$-413]"€ "#,##0.00'
QTY = "[$-413]General"

ITEM_ROWS = range(2, 8)   # 6 invoice lines
R_SUB, R_BTW, R_TOT, R_END = 9, 10, 12, 13
LAST = f"D{R_END}"

# Column widths in Excel pixels. LibreOffice draws columns ~5.7% wider than Excel, so the
# widths are sized for LibreOffice to fill 510 pt exactly; Word scales Excel's (narrower)
# drawing up to the same 510 pt through the object's original size.
LO_FACTOR = 0.9462
COLS_PX = {c: px * LO_FACTOR for c, px in zip("ABCD", (326, 120, 88, 146))}

wb = Workbook()
ws = wb.active
ws.title = "Factuur"
ws.sheet_view.showGridLines = False

excel_px = 0
for col, px in COLS_PX.items():
    w = px / 7
    ws.column_dimensions[col].width = w
    excel_px += math.floor(7 * (math.floor(w * 256) / 256) + 0.4921875)

heights = {1: 24, R_SUB - 1: 14, R_SUB: 22, R_BTW: 22, R_TOT - 1: 8, R_TOT: 34, R_END: 10}
for r in ITEM_ROWS:
    heights[r] = 30
for r, h in heights.items():
    ws.row_dimensions[r].height = h

white = PatternFill("solid", fgColor=WHITE)
hair = Side(style="thin", color=HAIR)

# white card everywhere, hairline outline
for r in range(1, R_END + 1):
    for c in "ABCD":
        cell = ws[f"{c}{r}"]
        cell.fill = white
        cell.font = Font(name=FONT, size=10, color=BODY)
        cell.border = Border(
            left=hair if c == "A" else None,
            right=hair if c == "D" else None,
            bottom=hair if r == R_END else None,
        )


def style(ref, size=10, bold=False, color=BODY, fill=None, h="left", indent=1, fmt=None, bottom=None):
    cell = ws[ref]
    cell.font = Font(name=FONT, size=size, bold=bold, color=color)
    cell.alignment = Alignment(horizontal=h, vertical="center", indent=0 if h == "center" else indent)
    if fill:
        cell.fill = PatternFill("solid", fgColor=fill)
    if bottom:
        b = cell.border
        cell.border = Border(left=b.left, right=b.right, bottom=bottom)
    if fmt:
        cell.number_format = fmt
    return cell


# header row
for c, label, h in (("A", "OMSCHRIJVING", "left"), ("B", "TARIEF", "right"), ("C", "AANTAL", "center"), ("D", "BEDRAG", "right")):
    style(f"{c}1", size=8.5, bold=True, color=YELLOW, fill=INK, h=h).value = label

# invoice lines
inputs = {"A2": "PO-008074", "B2": 450, "C2": 5}
inputs.update({k: v for k, v in overrides.items() if k != "B10"})
for r in ITEM_ROWS:
    style(f"A{r}", size=10.5, bold=True, color=INK, bottom=hair)
    style(f"B{r}", size=10.5, h="right", fmt=EUR, bottom=hair)
    style(f"C{r}", size=10.5, h="center", fmt=QTY, bottom=hair)
    style(f"D{r}", size=10.5, bold=True, color=INK, h="right", fmt=EUR, bottom=hair)
    ws[f"A{r}"].value = inputs.get(f"A{r}")
    ws[f"B{r}"].value = inputs.get(f"B{r}")
    ws[f"C{r}"].value = inputs.get(f"C{r}")
    ws[f"D{r}"].value = f'=IF(COUNT(B{r}:C{r})=2,B{r}*C{r},"")'

# totals block (B:C label, D value)
for r in (R_SUB, R_BTW, R_TOT):
    ws.merge_cells(f"B{r}:C{r}")

style(f"B{R_SUB}").value = "Subtotaal"
style(f"D{R_SUB}", h="right", fmt=EUR)
style(f"B{R_BTW}", bottom=hair).value = overrides.get("B10", "BTW verlegd")
style(f"C{R_BTW}", bottom=hair)
style(f"D{R_BTW}", h="right", fmt=EUR, bottom=hair)
for c in "BC":
    style(f"{c}{R_TOT}", size=8.5, bold=True, color=INK, fill=YELLOW)
ws[f"B{R_TOT}"].value = "TOTAAL INCL. BTW"
style(f"D{R_TOT}", size=15, bold=True, color=INK, fill=YELLOW, h="right", fmt=EUR)

if "--payment-note" in args:
    # payment terms in the empty space left of the totals
    style(f"A{R_SUB}", size=8, bold=True, color=MUTED).value = "BETALING"
    ws.merge_cells(f"A{R_BTW}:A{R_TOT}")
    note = style(f"A{R_BTW}", size=10, color=BODY)
    note.alignment = Alignment(horizontal="left", vertical="top", indent=1, wrap_text=True)
    note.value = "Gelieve te betalen binnen 7 tot 14 dagen o.v.v. het factuurnummer."

first, last = ITEM_ROWS[0], ITEM_ROWS[-1]
ws[f"D{R_SUB}"].value = f"=SUM(D{first}:D{last})"
ws[f"D{R_BTW}"].value = (
    f'=IF(B{R_BTW}="BTW 21%",ROUND(D{R_SUB}*0.21,2),IF(B{R_BTW}="BTW 9%",ROUND(D{R_SUB}*0.09,2),0))'
)
ws[f"D{R_TOT}"].value = f"=D{R_SUB}+D{R_BTW}"

dv = DataValidation(
    type="list",
    formula1='"BTW verlegd,BTW 21%,BTW 9%"',
    allow_blank=False,
    showDropDown=False,
    promptTitle="BTW",
    prompt="Kies: BTW verlegd, BTW 21% of BTW 9%",
)
dv.showInputMessage = True
ws.add_data_validation(dv)
dv.add(f"B{R_BTW}")
wb.calculation.fullCalcOnLoad = True

# print setup (only used to render the picture Word shows before the first edit)
ws.print_area = f"A1:{LAST}"
ws.page_setup.paperSize = ws.PAPERSIZE_A4
ws.page_setup.orientation = "portrait"
ws.page_setup.scale = 100
ws.page_margins.left = ws.page_margins.right = 0
ws.page_margins.top = ws.page_margins.bottom = 0
ws.page_margins.header = ws.page_margins.footer = 0

ws.sheet_view.selection[0].activeCell = "B2"
ws.sheet_view.selection[0].sqref = "B2"
wb.save(out)

# Tell Excel which range the embedded object shows inside Word.
tmp = tempfile.mktemp(suffix=".xlsx")
shutil.move(out, tmp)
with zipfile.ZipFile(tmp) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "xl/workbook.xml":
            xml = data.decode("utf8")
            tag = f'<oleSize ref="A1:{LAST}"/>'
            m = re.search(r"<calcPr[^>]*/>", xml)
            assert m
            xml = xml[: m.end()] + tag + xml[m.end():]
            data = xml.encode("utf8")
        zout.writestr(item, data)

print(f"wrote {out} | Excel natural size {excel_px * 0.75:.2f} x {sum(heights.values()):.2f} pt")
