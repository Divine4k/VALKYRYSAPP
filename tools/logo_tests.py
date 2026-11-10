import sys
from PIL import Image
from docx import Document
from docx.shared import Inches

logo_path, outdir = sys.argv[1:3]

im = Image.open(logo_path)
print("logo", im.size, im.mode)

# variant 1: original RGBA logo via python-docx
# variant 2: logo flattened onto white (opaque RGB)
flat = Image.new("RGBA", im.size, (255, 255, 255, 255))
flat.alpha_composite(im)
flat.convert("RGB").save(outdir + "/logo_flat.png")

# variant 3: same alpha, but real black pixels (0,0,0) under the alpha
black = Image.new("RGBA", im.size, (0, 0, 0, 0))
black.putalpha(im.getchannel("A"))
black.save(outdir + "/logo_black_alpha.png")

for name, path in [("v1_rgba", logo_path), ("v2_flat", outdir + "/logo_flat.png"), ("v3_blackalpha", outdir + "/logo_black_alpha.png")]:
    d = Document()
    d.add_paragraph("test " + name)
    d.add_picture(path, width=Inches(2.3))
    d.save(outdir + "/" + name + ".docx")
    print("wrote", name)
