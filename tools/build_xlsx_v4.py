"""Calculator table for the new design: borderless, blends into the white page.

usage: build_xlsx_v4.py OUT.xlsx [--set CELL=VALUE ...]
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
EDGE = "FEFEFE"   # invisible outline: lets the picture be cropped to the exact range
EUR = '[$-413]"€ "#,##0.00'
QTY = "[$-413]General"

ITEM_ROWS = range(2, 8)
R_SUB, R_BTW, R_TOT, R_END = 9, 10, 12, 13
LAST = f"D{R_END}"

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

heights = {1: 26, R_SUB - 1: 16, R_SUB: 21, R_BTW: 21, R_TOT - 1: 10, R_TOT: 38, R_END: 3}
for r in ITEM_ROWS:
    heights[r] = 28
for r, h in heights.items():
    ws.row_dimensions[r].height = h

edge = Side(style="thin", color=EDGE)
hair = Side(style="thin", color=HAIR)
rule = Side(style="thick", color=YELLOW)

for r in range(1, R_END + 1):
    for c in "ABCD":
        cell = ws[f"{c}{r}"]
        cell.fill = PatternFill("solid", fgColor=WHITE)
        cell.font = Font(name=FONT, size=10, color=BODY)
        cell.border = Border(
            left=edge if c == "A" else None,
            right=edge if c == "D" else None,
            top=edge if r == 1 else None,
            bottom=edge if r == R_END else None,
        )


def style(ref, size=10, bold=False, color=BODY, fill=None, h="left", indent=1, fmt=None, bottom=None, v="center"):
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


# header: black labels on a thick yellow rule
for c, label, h, ind in (("A", "OMSCHRIJVING", "left", 0), ("B", "TARIEF", "right", 1), ("C", "AANTAL", "center", 0), ("D", "BEDRAG", "right", 1)):
    style(f"{c}1", size=8.5, bold=True, color=INK, h=h, indent=ind, bottom=rule, v="center").value = label

inputs = {"A2": "PO-008074", "B2": 450, "C2": 5}
inputs.update({k: v for k, v in overrides.items() if k != "B10"})
for r in ITEM_ROWS:
    style(f"A{r}", size=10.5, bold=True, color=INK, indent=0, bottom=hair)
    style(f"B{r}", size=10.5, h="right", fmt=EUR, bottom=hair)
    style(f"C{r}", size=10.5, h="center", fmt=QTY, bottom=hair)
    style(f"D{r}", size=10.5, bold=True, color=INK, h="right", fmt=EUR, bottom=hair)
    ws[f"A{r}"].value = inputs.get(f"A{r}")
    ws[f"B{r}"].value = inputs.get(f"B{r}")
    ws[f"C{r}"].value = inputs.get(f"C{r}")
    ws[f"D{r}"].value = f'=IF(COUNT(B{r}:C{r})=2,B{r}*C{r},"")'

for r in (R_SUB, R_BTW, R_TOT):
    ws.merge_cells(f"B{r}:C{r}")

style(f"B{R_SUB}", color=MUTED).value = "Subtotaal"
style(f"D{R_SUB}", h="right", fmt=EUR)
style(f"B{R_BTW}", color=MUTED).value = overrides.get("B10", "BTW verlegd")
style(f"D{R_BTW}", h="right", fmt=EUR)
for c in "BC":
    style(f"{c}{R_TOT}", size=9, bold=True, color=YELLOW, fill=INK)
ws[f"B{R_TOT}"].value = "TOTAAL TE BETALEN"
style(f"D{R_TOT}", size=16, bold=True, color=YELLOW, fill=INK, h="right", fmt=EUR)

first, last = ITEM_ROWS[0], ITEM_ROWS[-1]
ws[f"D{R_SUB}"].value = f"=SUM(D{first}:D{last})"
ws[f"D{R_BTW}"].value = (
    f'=IF(B{R_BTW}="BTW 21%",ROUND(D{R_SUB}*0.21,2),IF(B{R_BTW}="BTW 9%",ROUND(D{R_SUB}*0.09,2),0))'
)
ws[f"D{R_TOT}"].value = f"=D{R_SUB}+D{R_BTW}"

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
