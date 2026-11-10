import sys
import openpyxl

for path in sys.argv[1:]:
    ws = openpyxl.load_workbook(path, data_only=True).active
    print(path.split("/")[-1])
    for r in range(2, ws.max_row + 1):
        vals = [ws[f"{c}{r}"].value for c in "ABCD"]
        if any(v not in (None, "") for v in vals):
            print(f"  r{r}: {vals}")
