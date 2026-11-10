#!/bin/bash
# usage: build_v9.sh LOF SIDE_GAP OUTDIR -> narrow-sidebar invoice; prints measurements
set -e
SK=/root/.claude/skills/synced/fb692370-274a-4074-ab75-c363cbc666c0_f92efa22-81c7-4c6d-b85d-a8f5642139b1/docx
SP=/tmp/claude-0/-home-claude/2c77b883-cf62-5076-a78d-01993ea1522f/scratchpad
T=$SP/tools
export NODE_PATH=/home/claude/.npm-global/lib/node_modules
LOF=$1; GAPV=$2; D=$3
rm -rf $D && mkdir -p $D

# layout: sidebar 200 px (53 mm); main column inner width = 11906 - 2999 - 2*790 = 7327 twips = 366.35 pt = 488 px
export SIDE_TW=2999 SIDE_PAD_L=420 SIDE_PAD_R=240 LOGO_FILE=logo-white.png LOGO_W=150 NUM_SIZE=52 SIDE_GAP=$GAPV
export COLS="${COLS:-220,100,64,104}" AMOUNT=FFFFFF
TABLE_PT=366

EMBLEM_H=330 python3 -I $T/make_assets_v5.py $SP/final/logo-hires.png $D 200 >/dev/null
LOGO_H=$(python3 -I -c "from PIL import Image; w,h=Image.open('$D/logo-white.png').size; print(round(150*h/w))"); export LOGO_H
cp $D/accent.png $D/accent.png 2>/dev/null || true
NAT=$(LOF=$LOF python3 -I $T/build_xlsx_v5.py $D/calc.xlsx | sed -E 's/.*size ([0-9.]+) x ([0-9.]+) pt/\1 \2/')
bash $T/render_preview.sh $D/calc.xlsx $D/xl-preview.png > $D/preview.txt
PW=$(python3 -I -c "print(round($TABLE_PT*96/72))")
PH=$(python3 -I -c "from PIL import Image; w,h=Image.open('$D/xl-preview.png').size; print(round($PW*h/w))")
PREVIEW_IMG=$D/xl-preview.png PREVIEW_W=$PW PREVIEW_H=$PH node $T/build_invoice_v5.js $D $D/wordview.docx >/dev/null
node $T/build_invoice_v5.js $D $D/base.docx >/dev/null
python3 -I $T/inject_ole.py $D/base.docx $D/calc.xlsx $D/xl-preview.png "$D/Factuur-Valkyrys-zijbalk.docx" $TABLE_PT $NAT >/dev/null
python3 $SK/scripts/office/validate.py "$D/Factuur-Valkyrys-zijbalk.docx" 2>&1 | tail -1
python3 $SK/scripts/office/soffice.py --headless --convert-to pdf --outdir $D $D/wordview.docx "$D/Factuur-Valkyrys-zijbalk.docx" >/dev/null 2>&1
echo "pages: word view $(pdfinfo $D/wordview.pdf | awk '/Pages/{print $2}'), live $(pdfinfo $D/Factuur-Valkyrys-zijbalk.pdf | awk '/Pages/{print $2}') | Excel natural $NAT | $(cat $D/preview.txt)"
pdftoppm -jpeg -r 100 $D/wordview.pdf $D/word
pdftoppm -jpeg -r 100 $D/Factuur-Valkyrys-zijbalk.pdf $D/live
pdftoppm -png -r 200 $D/Factuur-Valkyrys-zijbalk.pdf $D/live200
python3 -I - $D <<'EOF'
import sys
from PIL import Image
D = sys.argv[1]
def last_row(im, x0, x1, dark):
    px = im.load(); W, H = im.size
    for y in range(H - 1, 0, -1):
        if any((dark and px[x, y] > 120) or (not dark and px[x, y] < 140) for x in range(x0, x1)):
            return y
w = Image.open(f'{D}/word-1.jpg').convert('L')
print('word view: sidebar last text row', last_row(w, 25, 185, True), '| main last text row', last_row(w, 260, 785, False))
im = Image.open(f'{D}/live200-1.png').convert('RGB'); px = im.load(); W, H = im.size
right_edge = round((11906 - 790) / 11906 * W)
bar = [y for y in range(H // 2, H) if px[right_edge - 30, y][0] < 40 and px[right_edge - 300, y][0] < 40]
y0, y1 = bar[0], bar[-1]
bright = [x for y in range(y0, y1) for x in range(right_edge - 400, W) if min(px[x, y][:3]) > 200 and x < W - 5]
bar_r = max(x for x in range(right_edge - 400, W) if px[x, (y0 + y1) // 2][0] < 40)
print('live: column right edge', right_edge, '| bar right', bar_r, '| amount right', max(bright), '| padding', bar_r - max(bright))
a = Image.open(f'{D}/live-1.jpg'); b = Image.open(f'{D}/word-1.jpg')
box = (240, 440, 794, 880)
c = Image.new('RGB', (1128, 440), (230, 0, 0)); c.paste(a.crop(box), (0, 0)); c.paste(b.crop(box), (574, 0)); c.save(f'{D}/compare.png')
EOF
