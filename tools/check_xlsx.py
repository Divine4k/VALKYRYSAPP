import sys
import openpyxl

for path in sys.argv[1:]:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = []
    for r in list(range(2, 8)) + [9, 10, 12]:
        vals = [ws[f"{c}{r}"].value for c in "ABCD"]
        if any(v not in (None, "") for v in vals):
            rows.append(f"  r{r}: {vals}")
    print(path.split("/")[-1])
    print("\n".join(rows))
