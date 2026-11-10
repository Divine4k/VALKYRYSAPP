#!/bin/bash
# usage: render_table_origin.sh WORKBOOK.xlsx OUT.png
# Renders the print area (zero margins, so it starts at the page corner) and crops from the corner
# to the furthest drawn pixel; works for tables without an outline.
set -e
SK=/root/.claude/skills/synced/fb692370-274a-4074-ab75-c363cbc666c0_f92efa22-81c7-4c6d-b85d-a8f5642139b1/docx
SP=/tmp/claude-0/-home-claude/2c77b883-cf62-5076-a78d-01993ea1522f/scratchpad
W=$SP/prevwork2
rm -rf $W && mkdir -p $W
cp "$1" $W/table.xlsx
python3 $SK/scripts/office/soffice.py --headless --convert-to pdf --outdir $W $W/table.xlsx >/dev/null 2>&1
pdftoppm -png -r 300 -f 1 -l 1 $W/table.pdf $W/prev
python3 -I - "$W/prev-1.png" "$2" <<'EOF'
import sys
from PIL import Image
src, out = sys.argv[1:3]
im = Image.open(src).convert('RGB')
l, t, r, b = im.convert('L').point(lambda v: 255 if v < 250 else 0).getbbox()
print('drawn bbox', (l, t, r, b))
crop = im.crop((0, 0, r, b))
crop.save(out, optimize=True)
w, h = crop.size
print('picture', crop.size, '= %.1f x %.1f pt' % (w * 72 / 300, h * 72 / 300))
EOF
