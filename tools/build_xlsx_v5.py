"""Calculator table for the sidebar design (main column ~329 pt wide).

usage: build_xlsx_v5.py OUT.xlsx [--set CELL=VALUE ...]
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
INK, BODY, MUTED, HAIR, WHITE, YELLOW = "111111", "333333", "6B6B6B", "E2E2E2", "FFFFFF", "FEBD17"
EDGE = "FEFEFE"
EUR = '[$-413]"€ "#,##0.00'
QTY = "[$-413]General"

import os as _os
N_ITEMS = int(_os.environ.get("ITEMS", "6"))
ITEM_ROWS = range(2, 2 + N_ITEMS)
_r = 2 + N_ITEMS + 1   # first totals row, after one spacer row
R_SUB, R_BTW, R_LINE, R_TOT, R_END = _r, _r + 1, _r + 2, _r + 4, _r + 5   # R_LINE: 1-px filled strip under BTW
LAST = f"D{R_END}"

import os
LO_FACTOR = float(os.environ.get("LOF", "0.9462"))
COLS = [float(x) for x in os.environ.get("COLS", "180,92,60,106").split(",")]   # design px (96 dpi)
COLS_PX = {c: px * LO_FACTOR for c, px in zip("ABCD", COLS)}
AMOUNT = os.environ.get("AMOUNT", "FEBD17")   # colour of the total amount

wb = Workbook()
ws = wb.active
ws.title = "Factuur"
ws.sheet_view.showGridLines = False

excel_px = 0
for col, px in COLS_PX.items():
    w = px / 7
    ws.column_dimensions[col].width = w
    excel_px += math.floor(7 * (math.floor(w * 256) / 256) + 0.4921875)

heights = {1: 22, R_SUB - 1: 12, R_SUB: 20, R_BTW: 20, R_LINE: 0.75, R_TOT - 1: 11.25, R_TOT: 36, R_END: 2}
for r in ITEM_ROWS:
    heights[r] = 26
for r, h in heights.items():
    ws.row_dimensions[r].height = h

edge = Side(style="thin", color=EDGE)
hair = Side(style="thin", color=HAIR)
rule = Side(style="medium", color=INK)

for r in range(1, R_END + 1):
    for c in "ABCD":
        cell = ws[f"{c}{r}"]
        cell.fill = PatternFill("solid", fgColor=WHITE)
        cell.font = Font(name=FONT, size=10, color=BODY)
        # only top/bottom invisible edges: the full-width black bar marks left and right,
        # and side edges would make the thin lines poke out past the bar
        cell.border = Border(
            top=edge if r == 1 else None,
            bottom=edge if r == R_END else None,
        )


def style(ref, size=10, bold=False, color=BODY, fill=None, h="left", indent=0, fmt=None, bottom=None, v="center"):
    cell = ws[ref]
    cell.font = Font(name=FONT, size=size, bold=bold, color=color)
    cell.alignment = Alignment(horizontal=h, vertical=v, indent=0 if h == "center" else indent)
    if fill:
        cell.fill = PatternFill("solid", fgColor=fill)
    if bottom:
        b = cell.border
        cell.border = Border(left=b.left, right=b.right, top=b.top, bottom=bottom)
    if fmt:
        cell.number_format = fmt
    return cell


# every amount in column D gets the same right padding, so all amounts share one right edge
for c, label, h, ind in (("A", "OMSCHRIJVING", "left", 0), ("B", "TARIEF", "right", 0), ("C", "AANTAL", "center", 0), ("D", "BEDRAG", "right", 1)):
    style(f"{c}1", size=8, bold=True, color=MUTED, h=h, indent=ind, bottom=rule, v="center").value = label

inputs = {"A2": "PO-008074", "B2": 450, "C2": 5}
inputs.update({k: v for k, v in overrides.items() if k != "B10"})
for r in ITEM_ROWS:
    style(f"A{r}", size=10, bold=True, color=INK, bottom=hair)
    style(f"B{r}", size=10, h="right", fmt=EUR, bottom=hair)
    style(f"C{r}", size=10, h="center", fmt=QTY, bottom=hair)
    style(f"D{r}", size=10, bold=True, color=INK, h="right", indent=1, fmt=EUR, bottom=hair)
    ws[f"A{r}"].value = inputs.get(f"A{r}")
    ws[f"B{r}"].value = inputs.get(f"B{r}")
    ws[f"C{r}"].value = inputs.get(f"C{r}")
    ws[f"D{r}"].value = f'=IF(COUNT(B{r}:C{r})=2,B{r}*C{r},"")'

for r in (R_SUB, R_BTW):
    ws.merge_cells(f"B{r}:C{r}")
ws.merge_cells(f"B{R_TOT}:D{R_TOT}")

style(f"B{R_SUB}", color=MUTED, indent=1).value = "Subtotaal"
style(f"D{R_SUB}", h="right", indent=1, fmt=EUR)
style(f"B{R_BTW}", color=MUTED, indent=1).value = overrides.get("B10", "BTW verlegd")
style(f"D{R_BTW}", h="right", indent=1, fmt=EUR)
# the line under BTW is a filled 1-px row, not a border: fills end exactly where the black bar ends
for c in "BCD":
    ws[f"{c}{R_LINE}"].fill = PatternFill("solid", fgColor=HAIR)

style(f"A{R_TOT}", size=9, bold=True, color=YELLOW, fill=INK, indent=1).value = "TOTAAL TE BETALEN"
for c in "BCD":
    style(f"{c}{R_TOT}", size=16, bold=True, color=AMOUNT, fill=INK, h="right", indent=1, fmt=EUR)
# no near-white edge line on the black bar: it must end exactly where the lines above end
for c in "ABCD":
    ws[f"{c}{R_TOT}"].border = Border()

first, last = ITEM_ROWS[0], ITEM_ROWS[-1]
ws[f"D{R_SUB}"].value = f"=SUM(D{first}:D{last})"
ws[f"D{R_BTW}"].value = (
    f'=IF(B{R_BTW}="BTW 21%",ROUND(D{R_SUB}*0.21,2),IF(B{R_BTW}="BTW 9%",ROUND(D{R_SUB}*0.09,2),0))'
)
ws[f"B{R_TOT}"].value = f"=D{R_SUB}+D{R_BTW}"

dv = DataValidation(type="list", formula1='"BTW verlegd,BTW 21%,BTW 9%"', allow_blank=False,
                    promptTitle="BTW", prompt="Kies: BTW verlegd, BTW 21% of BTW 9%")
dv.showInputMessage = True
ws.add_data_validation(dv)
dv.add(f"B{R_BTW}")
wb.calculation.fullCalcOnLoad = True

ws.print_area = f"A1:{LAST}"
ws.page_setup.paperSize = ws.PAPERSIZE_A4
ws.page_setup.scale = 100
ws.page_margins.left = ws.page_margins.right = ws.page_margins.top = ws.page_margins.bottom = 0
ws.page_margins.header = ws.page_margins.footer = 0
ws.sheet_view.selection[0].activeCell = "B2"
ws.sheet_view.selection[0].sqref = "B2"
wb.save(out)

tmp = tempfile.mktemp(suffix=".xlsx")
shutil.move(out, tmp)
with zipfile.ZipFile(tmp) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "xl/workbook.xml":
            xml = data.decode("utf8")
            m = re.search(r"<calcPr[^>]*/>", xml)
            xml = xml[: m.end()] + f'<oleSize ref="A1:{LAST}"/>' + xml[m.end():]
            data = xml.encode("utf8")
        zout.writestr(item, data)

print(f"wrote {out} | Excel natural size {excel_px * 0.75:.2f} x {sum(heights.values()):.2f} pt")
