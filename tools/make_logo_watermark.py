"""Full-page A4 background: diagonal repeating Valkyrys logo (emblem at lettering height) + top accent bar.

usage: make_logo_watermark.py LOGO.png OUT.png SAMPLE.png
"""
import sys
from PIL import Image

logo_path, out_png, sample_png = sys.argv[1:4]

DPI = 200
W, H = round(8.2677 * DPI), round(11.6929 * DPI)   # A4
SCALE = W / 794                                     # the web design is 794 px wide
S = 3200                                            # work canvas, covers the page after rotating

logo = Image.open(logo_path).convert("RGBA")
alpha = logo.getchannel("A")
lw, lh = logo.size

# split into the V emblem and the VALKYRYS lettering at the first empty column gap
cols = [alpha.crop((x, 0, x + 1, lh)).getextrema()[1] > 8 for x in range(lw)]
split = next(x for x in range(1, lw) if cols[x - 1] and not cols[x])
emblem = alpha.crop((0, 0, split, lh))
emblem = emblem.crop(emblem.point(lambda v: 255 if v > 8 else 0).getbbox())
text = alpha.crop((split, 0, lw, lh))
text = text.crop(text.point(lambda v: 255 if v > 8 else 0).getbbox())
print("emblem", emblem.size, "lettering", text.size)

TH = round(18 * SCALE)                      # lettering height on the page
tw = round(text.width * TH / text.height)
text = text.resize((tw, TH), Image.LANCZOS)
ew = round(emblem.width * TH / emblem.height)
emblem = emblem.resize((ew, TH), Image.LANCZOS)  # emblem shrunk to the lettering height

gap_inner = round(TH * 0.45)
unit_w = ew + gap_inner + tw
pitch_x = unit_w + round(TH * 2.2)
pitch_y = round(TH * 2.5)
print("on-page lettering height %.1f mm, repeat width %.1f mm" % (TH / DPI * 25.4, unit_w / DPI * 25.4))

mask = Image.new("L", (S, S), 0)
row, y = 0, 0
while y < S:
    x = -pitch_x - (pitch_x // 2 if row % 2 else 0)
    while x < S:
        mask.paste(255, (x, y), emblem)
        mask.paste(255, (x + ew + gap_inner, y), text)
        x += pitch_x
    y += pitch_y
    row += 1

mask = mask.rotate(30, resample=Image.BICUBIC)
left, top = (S - W) // 2, (S - H) // 2
mask = mask.crop((left, top, left + W, top + H))

STRENGTH = 15                                # out of 255, same as before
img = Image.new("RGBA", (W, H), (17, 17, 17, 0))
img.putalpha(mask.point(lambda v: round(v * STRENGTH / 255)))

YELLOW = (254, 189, 23, 255)
img.paste(Image.new("RGBA", (W, round(10 * SCALE)), YELLOW), (0, 0))
if len(sys.argv) > 4:
    # black footer band, measured up from the bottom edge
    bh = round(float(sys.argv[4]) / 25.4 * DPI)
    img.paste(Image.new("RGBA", (W, bh), (17, 17, 17, 255)), (0, H - bh))
    print("footer band %.1f mm" % float(sys.argv[4]))
img.save(out_png, optimize=True)
print("saved", out_png, img.size)

# a zoomed, darker sample so the shapes can be checked by eye
sample = Image.new("RGBA", (W, H), (255, 255, 255, 255))
dark = Image.new("RGBA", (W, H), (17, 17, 17, 0))
dark.putalpha(mask.point(lambda v: round(v * 0.6)))
sample.alpha_composite(dark)
sample.crop((300, 400, 1100, 900)).convert("RGB").save(sample_png)
