"""Sample the Claude desktop screenshot to recover the palette it actually uses.

Prints the dominant colors with a representative pixel for each, then probes a
few named regions (fractional coordinates, so the reading does not depend on the
image's pixel dimensions).
"""
from collections import Counter
from PIL import Image
import sys

path = sys.argv[1]
im = Image.open(path).convert("RGB")
w, h = im.size
print(f"size = {w}x{h}")
px = im.load()


def median_at(fx, fy, radius=6):
    cx, cy = int(fx * w), int(fy * h)
    samples = []
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            x, y = min(max(cx + dx, 0), w - 1), min(max(cy + dy, 0), h - 1)
            samples.append(px[x, y])
    samples.sort(key=lambda c: sum(c))
    return samples[len(samples) // 2]


print("\n== top 18 exact colors ==")
counts = Counter(im.getdata())
first_seen = {}
for y in range(0, h, 3):
    for x in range(0, w, 3):
        c = px[x, y]
        first_seen.setdefault(c, (x, y))
for color, n in counts.most_common(18):
    x, y = first_seen[color]
    print(f"  #{color[0]:02x}{color[1]:02x}{color[2]:02x}  n={n:>9}  at ({x},{y})")

print("\n== probes (5x5 median at fractional coords) ==")
probes = [
    ("sidebar top", 0.06, 0.05),
    ("sidebar empty", 0.08, 0.72),
    ("sidebar bottom", 0.08, 0.95),
    ("titlebar strip", 0.5, 0.02),
    ("canvas right", 0.88, 0.80),
    ("canvas below card", 0.55, 0.62),
    ("card body", 0.60, 0.26),
    ("card header row", 0.45, 0.185),
    ("tile (Sessions)", 0.40, 0.25),
    ("tile (Peak hour)", 0.52, 0.325),
    ("heatmap empty cell", 0.42, 0.42),
    ("heatmap lit cell", 0.645, 0.44),
    ("card footer text row", 0.40, 0.505),
    ("composer input row", 0.55, 0.93),
    ("chip row above composer", 0.42, 0.885),
    ("user name row bottom-left", 0.06, 0.975),
]
for label, fx, fy in probes:
    r, g, b = median_at(fx, fy)
    print(f"  {label:<26} #{r:02x}{g:02x}{b:02x}  ({r},{g},{b})")

print("\n== blue accents (max-saturation blue pixels) ==")
best = {}
for y in range(0, h, 2):
    for x in range(0, w, 2):
        r, g, b = px[x, y]
        if b > 140 and b - r > 40 and b - g > 20:
            key = (r // 8, g // 8, b // 8)
            best.setdefault(key, []).append((r, g, b))
ranked = sorted(best.items(), key=lambda kv: -len(kv[1]))[:6]
for key, vals in ranked:
    r = sum(v[0] for v in vals) // len(vals)
    g = sum(v[1] for v in vals) // len(vals)
    b = sum(v[2] for v in vals) // len(vals)
    print(f"  #{r:02x}{g:02x}{b:02x}  n={len(vals)}")
