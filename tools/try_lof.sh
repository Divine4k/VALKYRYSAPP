#!/bin/bash
# usage: try_lof.sh FACTOR -> builds the sidebar invoice with that column factor and measures the live (LibreOffice) render
set -e
SK=/root/.claude/skills/synced/fb692370-274a-4074-ab75-c363cbc666c0_f92efa22-81c7-4c6d-b85d-a8f5642139b1/docx
SP=/tmp/claude-0/-home-claude/2c77b883-cf62-5076-a78d-01993ea1522f/scratchpad
T=$SP/tools
export NODE_PATH=/home/claude/.npm-global/lib/node_modules
D=$SP/lof-$1
rm -rf $D && mkdir -p $D
NAT=$(LOF=$1 python3 -I $T/build_xlsx_v5.py $D/calc.xlsx | sed -E 's/.*size ([0-9.]+) x ([0-9.]+) pt/\1 \2/')
bash $T/render_preview.sh $D/calc.xlsx $D/xl-preview.png > $D/preview.txt
SIDE_GAP=7700 node $T/build_invoice_v5.js $SP/v8 $D/base.docx >/dev/null
python3 -I $T/inject_ole.py $D/base.docx $D/calc.xlsx $D/xl-preview.png $D/out.docx 328.5 $NAT >/dev/null
python3 $SK/scripts/office/soffice.py --headless --convert-to pdf --outdir $D $D/out.docx >/dev/null 2>&1
pdftoppm -png -r 200 $D/out.pdf $D/live
python3 -I - $D/live-1.png "$1" "$(cat $D/preview.txt)" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); px = im.load(); W, H = im.size
# total bar: find black rows in the main column, then its right edge and the rightmost yellow pixel inside
bar_rows = [y for y in range(H // 2, H) if px[W - 120, y][0] < 40 and px[700, y][0] < 40]
y0, y1 = bar_rows[0], bar_rows[-1]
mid = (y0 + y1) // 2
bar_right = max(x for x in range(600, W) if px[x, mid][0] < 40)
yellow = [x for y in range(y0, y1) for x in range(600, W) if px[x, y][0] > 200 and px[x, y][2] < 90]
print('LOF', sys.argv[2], '|', sys.argv[3].strip(), '| live: bar right edge', bar_right, 'rightmost yellow', max(yellow), 'padding px@200dpi', bar_right - max(yellow))
EOF
