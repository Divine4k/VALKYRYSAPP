"""Sidebar design assets.

usage: make_assets_v5.py LOGO.png OUTDIR [SIDEBAR_PX]
- background-v5.png: A4 @200 dpi, black sidebar with a tone-on-tone V emblem and a yellow edge line
- accent.png: small yellow bar used above the FACTUUR label
"""
import sys
from PIL import Image, ImageChops, ImageDraw

logo_path, outdir = sys.argv[1:3]
SIDEBAR = float(sys.argv[3]) if len(sys.argv) > 3 else 250   # design px of a 794-wide page

BLACK = (17, 17, 17, 255)
TONE = (30, 30, 30, 255)
YELLOW = (254, 189, 23, 255)

logo = Image.open(logo_path).convert("RGBA")
alpha = logo.getchannel("A")
lw, lh = logo.size
cols = [alpha.crop((x, 0, x + 1, lh)).getextrema()[1] > 8 for x in range(lw)]
split = next(x for x in range(1, lw) if cols[x - 1] and not cols[x])
emblem = alpha.crop((0, 0, split, lh))
emblem = emblem.crop(emblem.point(lambda v: 255 if v > 8 else 0).getbbox())

DPI = 200
W, H = round(8.2677 * DPI), round(11.6929 * DPI)
SS = 2
K = W * SS / 794
cw, ch = W * SS, H * SS
canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)

sx = round(SIDEBAR * K)
draw.rectangle([0, 0, sx, ch], fill=BLACK)

# big V centred in the sidebar, wings running off both edges, tip above the info block
eh = round(float(__import__("os").environ.get("EMBLEM_H", 400)) * K)
ew = round(emblem.width * eh / emblem.height)
big = emblem.resize((ew, eh), Image.LANCZOS)
layer = Image.new("L", (cw, ch), 0)
layer.paste(big, (round(SIDEBAR / 2 * K - ew / 2), round(float(__import__("os").environ.get("EMBLEM_Y", 170)) * K)))
clip = Image.new("L", (cw, ch), 0)
ImageDraw.Draw(clip).rectangle([0, 0, sx, ch], fill=255)
layer = ImageChops.multiply(layer, clip)
tone = Image.new("RGBA", (cw, ch), TONE)
tone.putalpha(layer)
canvas.alpha_composite(tone)

import os
if os.environ.get("YLINE"):
    # thin yellow line along the sidebar's edge
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([sx - round(3 * K), 0, sx, ch], fill=YELLOW)

# all-white logo for the sidebar
white_logo = Image.new("RGBA", logo.size, (255, 255, 255, 255))
white_logo.putalpha(alpha)
white_logo.save(f"{outdir}/logo-white.png", optimize=True)

bg = canvas.resize((W, H), Image.LANCZOS)
bg.save(f"{outdir}/background-v5.png", optimize=True)
print("background", bg.size, "sidebar %.1f mm" % (SIDEBAR / 794 * 210))

Image.new("RGBA", (120, 16), YELLOW).save(f"{outdir}/accent.png")
