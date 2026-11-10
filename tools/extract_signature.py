"""Cut a light signature out of a dark background into a transparent PNG (keeps its colour).

usage: extract_signature.py SRC.png OUT.png PREVIEW_ON_BLACK.png
"""
import sys
from PIL import Image

src, out, preview = sys.argv[1:4]
im = Image.open(src).convert("RGB")
W, H = im.size
px = im.load()

corners = [px[x, y] for x in (2, W - 3) for y in (2, H - 3)]
bg = tuple(sorted(c[i] for c in corners)[len(corners) // 2] for i in range(3))

def dist(c):
    return sum((c[i] - bg[i]) ** 2 for i in range(3)) ** 0.5

# ink colour: median of the strongest pixels
strong = sorted((dist(px[x, y]), px[x, y]) for x in range(0, W, 2) for y in range(0, H, 2))
top = [c for d, c in strong[-max(50, len(strong) // 200):]]
ink = tuple(sorted(c[i] for c in top)[len(top) // 2] for i in range(3))
full = dist(ink)
print("background", bg, "ink", ink)

alpha = Image.new("L", (W, H))
ap = alpha.load()
for y in range(H):
    for x in range(W):
        ap[x, y] = max(0, min(255, round(dist(px[x, y]) / full * 255)))
# drop faint background noise
alpha = alpha.point(lambda v: 0 if v < 18 else v)

sig = Image.new("RGBA", (W, H), ink + (0,))
sig.putalpha(alpha)
bbox = alpha.point(lambda v: 255 if v > 40 else 0).getbbox()
pad = 6
bbox = (max(bbox[0] - pad, 0), max(bbox[1] - pad, 0), min(bbox[2] + pad, W), min(bbox[3] + pad, H))
sig = sig.crop(bbox)
sig.save(out, optimize=True)
print("signature", sig.size, "ratio %.3f" % (sig.width / sig.height))

check = Image.new("RGBA", sig.size, (17, 17, 17, 255))
check.alpha_composite(sig)
check.convert("RGB").save(preview)
