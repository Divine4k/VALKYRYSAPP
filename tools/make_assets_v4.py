"""Assets for the new design: white/yellow logo for the dark band, and the full-page background.

usage: make_assets_v4.py LOGO.png OUTDIR
Background (A4, 200 dpi): angled black header band with a giant tone-on-tone emblem, a parallel
yellow stripe under the band's edge, and a slim angled black strip at the bottom. Rest transparent.
"""
import sys
from PIL import Image, ImageChops, ImageDraw

logo_path, outdir = sys.argv[1:3]

BLACK = (17, 17, 17, 255)
YELLOW = (254, 189, 23, 255)
TONE = (32, 32, 32, 255)

# ---- logo variants -------------------------------------------------------------------------------
logo = Image.open(logo_path).convert("RGBA")
alpha = logo.getchannel("A")
lw, lh = logo.size
cols = [alpha.crop((x, 0, x + 1, lh)).getextrema()[1] > 8 for x in range(lw)]
split = next(x for x in range(1, lw) if cols[x - 1] and not cols[x])

dark_logo = Image.new("RGBA", logo.size, (0, 0, 0, 0))
emblem_part = Image.new("RGBA", (split, lh), YELLOW)
emblem_part.putalpha(alpha.crop((0, 0, split, lh)))
text_part = Image.new("RGBA", (lw - split, lh), (255, 255, 255, 255))
text_part.putalpha(alpha.crop((split, 0, lw, lh)))
dark_logo.paste(emblem_part, (0, 0))
dark_logo.paste(text_part, (split, 0))
dark_logo.save(f"{outdir}/logo-on-dark.png", optimize=True)
print("logo-on-dark", dark_logo.size)

emblem_alpha = alpha.crop((0, 0, split, lh))
emblem_alpha = emblem_alpha.crop(emblem_alpha.point(lambda v: 255 if v > 8 else 0).getbbox())

# ---- background ----------------------------------------------------------------------------------
DPI = 200
W, H = round(8.2677 * DPI), round(11.6929 * DPI)
SS = 2                          # supersampling for smooth angled edges
K = W * SS / 794                # design px (794-wide page) -> canvas px


def P(pts):
    return [(round(x * K), round(y * K)) for x, y in pts]


cw, ch = W * SS, H * SS
canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)

BAND_L, BAND_R = 285, 245       # band depth at left / right edge (design px)
band = P([(0, 0), (794, 0), (794, BAND_R), (0, BAND_L)])
draw.polygon(band, fill=BLACK)

# giant emblem inside the band, clipped to it
band_mask = Image.new("L", (cw, ch), 0)
ImageDraw.Draw(band_mask).polygon(band, fill=255)
eh = round(310 * K)
ew = round(emblem_alpha.width * eh / emblem_alpha.height)
big = emblem_alpha.resize((ew, eh), Image.LANCZOS)
layer_alpha = Image.new("L", (cw, ch), 0)
layer_alpha.paste(big, (round(470 * K), round(-28 * K)))
layer_alpha = ImageChops.multiply(layer_alpha, band_mask)
tone = Image.new("RGBA", (cw, ch), TONE)
tone.putalpha(layer_alpha)
canvas.alpha_composite(tone)

# yellow stripe parallel to the band edge
draw = ImageDraw.Draw(canvas)
draw.polygon(P([(0, BAND_L + 10), (794, BAND_R + 10), (794, BAND_R + 16), (0, BAND_L + 16)]), fill=YELLOW)

# slim angled strip at the bottom, same slope
draw.polygon(P([(0, 1123 - 16), (794, 1123 - 30), (794, 1123), (0, 1123)]), fill=BLACK)
draw.polygon(P([(0, 1123 - 22), (794, 1123 - 36), (794, 1123 - 33), (0, 1123 - 19)]), fill=YELLOW)

bg = canvas.resize((W, H), Image.LANCZOS)
bg.save(f"{outdir}/background-v4.png", optimize=True)
print("background", bg.size)
