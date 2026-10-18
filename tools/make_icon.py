# Draws the app icon, flat: an LR2 groove gauge, blue up to the 80% border and red
# past it, on a plain dark rounded tile. Writes a multi-size .ico and a 256 px .png.
#
#   python tools/make_icon.py app/lr2hp-for-osu/Assets [--preview]
import os
import sys
from PIL import Image, ImageDraw

out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(out_dir, exist_ok=True)

S = 1024  # drawn large, scaled down for each icon size

TILE = (26, 29, 38, 255)
BLUE = (19, 212, 221, 255)
RED = (255, 77, 94, 255)


def draw_icon(n=10, border=8, gap=18):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([32, 32, S - 32, S - 32], radius=200, fill=TILE)
    x0, x1, y0, y1 = 176, 848, 320, 704
    seg_w = (x1 - x0 - gap * (n - 1)) / n
    for i in range(n):
        sx0 = round(x0 + i * (seg_w + gap))
        sx1 = round(sx0 + seg_w)
        d.rounded_rectangle([sx0, y0, sx1, y1], radius=10, fill=RED if i >= border else BLUE)
    return img


# Big sizes: the full 10-segment gauge. Small sizes: 5 chunkier segments that stay readable.
big = draw_icon()
small = draw_icon(n=5, border=4, gap=36)
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [(small if s <= 32 else big).resize((s, s), Image.LANCZOS) for s in sizes]
frames[-1].save(os.path.join(out_dir, 'icon.png'))
frames[-1].save(os.path.join(out_dir, 'lr2hp-for-osu.ico'), sizes=[(s, s) for s in sizes], append_images=frames[:-1])

if '--preview' in sys.argv:
    preview = Image.new('RGBA', (256 + 128 + 64 + 32 + 16 + 4 * 16, 256), (40, 40, 40, 255))
    x = 0
    for s in [256, 128, 64, 32, 16]:
        f = (small if s <= 32 else big).resize((s, s), Image.LANCZOS)
        preview.alpha_composite(f, (x, (256 - s) // 2))
        x += s + 16
    preview.save(os.path.join(os.environ.get('TEMP', '.'), 'lr2hp-icon-preview.png'))
print('saved', out_dir)
