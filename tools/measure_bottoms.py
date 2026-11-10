"""Measure bottoms in a 100-dpi page render: sidebar text/signature, main sign-off, footer line."""
import sys
from PIL import Image

im = Image.open(sys.argv[1]).convert("RGB")
px = im.load()
W, H = im.size


def is_light(c):  # white or grey text / white signature on the black sidebar
    return min(c) > 120


def is_dark(c):
    return c[0] < 140


side = [y for y in range(H // 2, H) if any(is_light(px[x, y]) for x in range(20, 200))]
main = [y for y in range(H // 2, H - 80) if any(is_dark(px[x, y]) for x in range(262, 500))]
foot = [y for y in range(H - 80, H) if any(is_dark(px[x, y]) for x in range(262, 500))]
print(f"sidebar last {max(side)} | main sign-off last {max(main) if main else None} | footer text last {max(foot) if foot else None}")
