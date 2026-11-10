#!/bin/bash
# usage: sweep_alt.sh FACTOR...  -> for each factor: build table, picture, docx; measure the app-preview (LibreOffice) render
SK=/root/.claude/skills/synced/fb692370-274a-4074-ab75-c363cbc666c0_f92efa22-81c7-4c6d-b85d-a8f5642139b1/docx
SP=/tmp/claude-0/-home-claude/2c77b883-cf62-5076-a78d-01993ea1522f/scratchpad
T=$SP/tools
export NODE_PATH=/home/claude/.npm-global/lib/node_modules
for F in "$@"; do
  D=$SP/sweep/$F; rm -rf $D; mkdir -p $D; cd $D
  NAT=$(python3 -I $T/build_xlsx_alt.py $D/t.xlsx --lofactor=$F | sed -E 's/.*natural size ([0-9.]+) x ([0-9.]+).*/\1 \2/')
  bash $T/render_table_origin.sh $D/t.xlsx $D/p.png > $D/pic.txt
  node $T/build_invoice_alt.js $SP/alt/bg.png $SP/alt/logo-white.png $D/base.docx > /dev/null
  python3 -I $T/inject_ole.py $D/base.docx $D/t.xlsx $D/p.png $D/f.docx 334.5 $NAT > /dev/null
  python3 $SK/scripts/office/soffice.py --headless --convert-to pdf --outdir $D $D/f.docx > /dev/null 2>&1
  pdftoppm -png -r 200 $D/f.pdf $D/live
  python3 -I - $D/live-1.png "$F" "$NAT" "$(tail -1 $D/pic.txt)" <<'EOF'
import sys
from PIL import Image
path, f, nat, pic = sys.argv[1:5]
im = Image.open(path).convert('L'); W, H = im.size; px = im.load()
mm = 200 / 25.4
x0, x1 = round(78 * mm), round(78 * mm + 334.5 / 72 * 200)
# total bar = the lowest long run of near-black pixels in the main column
best = None
for y in range(H - 1, 0, -1):
    xs = [x for x in range(x0 - 5, min(W, x1 + 40)) if px[x, y] < 40]
    if len(xs) > (x1 - x0) * 0.6:
        best = (y, xs[0], xs[-1]); break
y, l, r = best
print(f"factor {f}: Excel natural {nat} pt | {pic} | live bar x {l}-{r}, frame {x0}-{x1} -> right gap {x1 - r} px ({(x1 - r) * 72 / 200:.1f} pt)")
EOF
done
