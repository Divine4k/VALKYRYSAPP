import sys
from PIL import Image, ImageDraw, ImageFont

out_png = sys.argv[1]

W, H = 1240, 1754          # A4 at 150 dpi
S = 2400                   # square work canvas, big enough to cover the page after rotating
SCALE = W / 794            # the web design is 794 px wide

size = round(26 * SCALE)
spacing = 0.14 * size
pitch = round(46 * SCALE)

candidates = [
    "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf",
    "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
font = None
for path in candidates:
    try:
        font = ImageFont.truetype(path, size)
        print("font:", path)
        break
    except OSError:
        continue
if font is None:
    raise SystemExit("no usable bold font found")

word = "VALKYRYS"
word_w = sum(font.getlength(c) + spacing for c in word)
unit = word_w + 2 * (size + spacing)

mask = Image.new("L", (S, S), 0)
draw = ImageDraw.Draw(mask)

row = 0
y = 0
while y < S:
    x = -unit - (unit / 2 if row % 2 else 0)
    while x < S:
        cx = x
        for c in word:
            draw.text((cx, y), c, font=font, fill=255)
            cx += font.getlength(c) + spacing
        x += unit
    y += pitch
    row += 1

mask = mask.rotate(30, resample=Image.BICUBIC)
left = (S - W) // 2
top = (S - H) // 2
mask = mask.crop((left, top, left + W, top + H))

ALPHA = 15
alpha = mask.point(lambda v: round(v * ALPHA / 255))
img = Image.new("RGBA", (W, H), (18, 21, 28, 0))
img.putalpha(alpha)

bar = Image.new("RGBA", (W, round(10 * SCALE)), (31, 45, 70, 255))
img.paste(bar, (0, 0))

img.save(out_png, optimize=True)
print("saved", out_png, img.size)
