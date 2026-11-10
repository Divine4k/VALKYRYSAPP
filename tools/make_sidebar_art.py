"""Artwork for the sidebar design.

usage: make_sidebar_art.py LOGO.png OUT_BG.png OUT_WHITE_LOGO.png
  OUT_BG: A4 page, white, black left sidebar with a huge tone-on-tone V emblem crop
  OUT_WHITE_LOGO: the logo in white for use on the sidebar
"""
import sys
from PIL import Image

logo_path, out_bg, out_white = sys.argv[1:4]
DPI = 200
MM = DPI / 25.4
W, H = round(210 * MM), round(297 * MM)

SIDEBAR_MM = 68
INK = (18, 18, 18, 255)
TONE = (31, 31, 31)

logo = Image.open(logo_path).convert("RGBA")
alpha = logo.getchannel("A")

# white logo
white = Image.new("RGBA", logo.size, (255, 255, 255, 0))
white.putalpha(alpha)
white.save(out_white, optimize=True)

# emblem = everything left of the first empty column gap
lw, lh = logo.size
cols = [alpha.crop((x, 0, x + 1, lh)).getextrema()[1] > 8 for x in range(lw)]
split = next(x for x in range(1, lw) if cols[x - 1] and not cols[x])
emblem = alpha.crop((0, 0, split, lh))
emblem = emblem.crop(emblem.point(lambda v: 255 if v > 8 else 0).getbbox())

page = Image.new("RGBA", (W, H), (255, 255, 255, 255))
sw = round(SIDEBAR_MM * MM)
side = Image.new("RGBA", (sw, H), INK)

# huge emblem, cropped by the sidebar edges: point of the V near the sidebar centre
EH_MM = 125
eh = round(EH_MM * MM)
ew = round(emblem.width * eh / emblem.height)
big = emblem.resize((ew, eh), Image.LANCZOS)
x = round(sw / 2 - ew / 2)
y = round(58 * MM)
tone = Image.new("RGBA", (ew, eh), TONE + (255,))
side.paste(tone, (x, y), big)

page.paste(side, (0, 0))
page.convert("RGB").save(out_bg, optimize=True)
print("page", page.size, "sidebar %d mm, emblem %.0f x %d mm" % (SIDEBAR_MM, ew / MM, EH_MM))
print("white logo", white.size)
