import sys
from PIL import Image

src, out_png, out_preview = sys.argv[1:4]

im = Image.open(src).convert("RGB")
print("source size:", im.size)

# Top band of the old invoice screenshot, where the logo sits (above the date line)
box = (30, 20, 520, 138)
reg = im.crop(box).convert("L")

hist = reg.histogram()
bg = max(range(256), key=lambda v: hist[v])
dark = min(v for v in range(256) if hist[v] > 0)
print("background gray:", bg, "darkest gray:", dark)

span = max(bg - dark, 1)
alpha = reg.point(lambda v: max(0, min(255, round((bg - v) * 255 / span))))

mask = alpha.point(lambda v: 255 if v > 24 else 0)
bbox = mask.getbbox()
print("logo bbox in region:", bbox)

pad = 3
l, t, r, b = bbox
l = max(l - pad, 0)
t = max(t - pad, 0)
r = min(r + pad, alpha.size[0])
b = min(b + pad, alpha.size[1])
alpha = alpha.crop((l, t, r, b))

logo = Image.new("RGBA", alpha.size, (17, 19, 24, 0))
logo.putalpha(alpha)
logo.save(out_png)

white = Image.new("RGBA", logo.size, (255, 255, 255, 255))
white.alpha_composite(logo)
white.convert("RGB").save(out_preview)
print("logo size:", logo.size)
