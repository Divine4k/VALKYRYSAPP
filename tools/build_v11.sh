#!/bin/bash
# usage: build_v11.sh SIDE_GAP OUTDIR -> sidebar invoice (final layout); prints checks
set -e
SK=/root/.claude/skills/synced/fb692370-274a-4074-ab75-c363cbc666c0_f92efa22-81c7-4c6d-b85d-a8f5642139b1/docx
SP=/tmp/claude-0/-home-claude/2c77b883-cf62-5076-a78d-01993ea1522f/scratchpad
T=$SP/tools
export NODE_PATH=/home/claude/.npm-global/lib/node_modules
GAPV=$1; D=$2
rm -rf $D && mkdir -p $D
export SIDE_TW=2999 SIDE_PAD_L=420 SIDE_PAD_R=240 LOGO_FILE=logo-white.png LOGO_W=150 SIDE_GAP=$GAPV
export COLS="220,100,64,104" AMOUNT=FFFFFF

EMBLEM_H=330 python3 -I $T/make_assets_v5.py $SP/final/logo-hires.png $D 200 >/dev/null
export LOGO_H=$(python3 -I -c "from PIL import Image; w,h=Image.open('$D/logo-white.png').size; print(round(150*h/w))")

# real workbook: columns sized so Excel draws ~365 pt and LibreOffice ~366 pt in the 366 pt frame
NAT_H=$(LOF=0.9991 python3 -I $T/build_xlsx_v5.py $D/calc.xlsx | sed -E 's/.* x ([0-9.]+) pt/\1/')
echo "Excel natural height $NAT_H pt"
# picture Word shows before the first edit: rendered at Excel's proportions
LOF=0.9435 python3 -I $T/build_xlsx_v5.py $D/preview-variant.xlsx >/dev/null
bash $T/render_preview.sh $D/preview-variant.xlsx $D/xl-preview.png >/dev/null
PH=$(python3 -I -c "from PIL import Image; w,h=Image.open('$D/xl-preview.png').size; print(round(488*h/w))")

PREVIEW_IMG=$D/xl-preview.png PREVIEW_W=488 PREVIEW_H=$PH node $T/build_invoice_v5.js $D $D/wordview.docx >/dev/null
node $T/build_invoice_v5.js $D $D/base.docx >/dev/null
python3 -I $T/inject_ole.py $D/base.docx $D/calc.xlsx $D/xl-preview.png "$D/Factuur-Valkyrys-zijbalk.docx" 366 366 $NAT_H >/dev/null
python3 $SK/scripts/office/validate.py "$D/Factuur-Valkyrys-zijbalk.docx" 2>&1 | tail -1
python3 $SK/scripts/office/soffice.py --headless --convert-to pdf --outdir $D $D/wordview.docx "$D/Factuur-Valkyrys-zijbalk.docx" >/dev/null 2>&1
echo "pages: live $(pdfinfo "$D/Factuur-Valkyrys-zijbalk.pdf" | awk '/Pages/{print $2}'), word view $(pdfinfo $D/wordview.pdf | awk '/Pages/{print $2}')"
pdftoppm -jpeg -r 100 $D/wordview.pdf $D/word
pdftoppm -jpeg -r 100 "$D/Factuur-Valkyrys-zijbalk.pdf" $D/live
pdftoppm -png -r 300 $D/wordview.pdf $D/word300
pdftoppm -png -r 300 "$D/Factuur-Valkyrys-zijbalk.pdf" $D/live300
python3 -I - $D <<'EOF'
import sys
from PIL import Image
D = sys.argv[1]
def rows(im, x0, x1, dark):
    px = im.load(); W, H = im.size
    return [y for y in range(H // 2, H) if any((dark and px[x, y] > 120) or (not dark and px[x, y] < 110) for x in range(x0, x1))]
for name in ('word-1.jpg', 'live-1.jpg'):
    im = Image.open(f'{D}/{name}').convert('L')
    print(name, '| sidebar last text', max(rows(im, 25, 185, True)), '| main last text', max(rows(im, 262, 500, False)))

# right edges at 300 dpi: BTW hairline end, black bar end, and right edge of each amount
for name in ('word300-1.png', 'live300-1.png'):
    im = Image.open(f'{D}/{name}').convert('RGB'); px = im.load(); W, H = im.size
    x_hi = W - 10
    bar = [y for y in range(H // 2, H) if px[2200, y][0] < 40 and px[1400, y][0] < 40]
    y0, y1 = bar[0], bar[-1]
    bar_r = max(x for x in range(1800, x_hi) if px[x, (y0 + y1) // 2][0] < 40)
    hair_y = [y for y in range(y0 - 60, y0) if 200 < px[2000, y][0] < 245]
    hair_r = max(x for x in range(1800, x_hi) if 200 < px[x, hair_y[-1]][0] < 245) if hair_y else None
    total_r = max(x for y in range(y0 + 5, y1 - 5) for x in range(1800, bar_r - 2) if min(px[x, y]) > 200)
    def text_right(ya, yb):
        xs = [x for y in range(ya, yb) for x in range(1800, x_hi) if px[x, y][0] < 120]
        return max(xs) if xs else None
    sub_r = text_right(hair_y[-1] - 140, hair_y[-1] - 75) if hair_y else None
    btw_r = text_right(hair_y[-1] - 60, hair_y[-1] - 4) if hair_y else None
    print(f"{name}: hairline end {hair_r} | bar end {bar_r} | amounts right: subtotaal {sub_r}, BTW {btw_r}, totaal {total_r}")
EOF
