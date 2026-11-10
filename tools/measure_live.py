import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); px = im.load(); W, H = im.size
right_edge = round((11906 - 790) / 11906 * W)
bar = [y for y in range(H // 2, H) if px[right_edge - 30, y][0] < 40 and px[right_edge - 300, y][0] < 40]
y0, y1 = bar[0], bar[-1]; mid = (y0 + y1) // 2
bar_r = max(x for x in range(right_edge - 400, W) if px[x, mid][0] < 40 and px[x, y0 + 2][0] < 40)
white = [x for y in range(y0 + 3, y1 - 3) for x in range(right_edge - 400, bar_r - 1) if min(px[x, y][:3]) > 200]
rule = [y for y in range(H // 3, H) if px[right_edge - 30, y][0] < 60 and px[right_edge - 200, y][0] < 60][0]
hdr = [x for y in range(rule - 40, rule - 4) for x in range(right_edge - 400, right_edge + 4) if px[x, y][0] < 150]
ok = white and hdr and max(hdr) > right_edge - 12 and bar_r - max(white) > 10
print(f"  live: bar right {bar_r} | amount right {max(white) if white else 'NONE'} | BEDRAG header right {max(hdr) if hdr else 'NONE'} | edge {right_edge} -> {'OK' if ok else 'CLIPPED'}")
