import sys
from PIL import Image

src, out = sys.argv[1:3]
im = Image.open(src)
print("source", im.size, im.mode, "transparency" in im.info)
im = im.convert("RGBA")
a = im.getchannel("A")
print("alpha extrema", a.getextrema())

if a.getextrema()[0] == 255:
    # opaque logo on white: turn the white into transparency, keep the black
    gray = im.convert("L")
    alpha = gray.point(lambda v: 255 - v)
    im = Image.new("RGBA", im.size, (0, 0, 0, 0))
    im.putalpha(alpha)
    a = alpha

bbox = a.point(lambda v: 255 if v > 8 else 0).getbbox()
im = im.crop(bbox)
im.save(out, optimize=True)
w, h = im.size
print("logo", im.size, "ratio", round(w / h, 4))
