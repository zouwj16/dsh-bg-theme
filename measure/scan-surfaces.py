"""Second pass: run-length scanlines plus accent/ink detection on the screenshot.

The first pass showed the surfaces are neutral dark grays; this pass recovers the
actual layering (canvas / card / tile / border) instead of guessing probe points.
"""
from collections import Counter
from PIL import Image
import sys

im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
px = im.load()


def rle(y, min_run=8, max_segments=26):
    segs = []
    start = 0
    cur = px[0, y]
    for x in range(1, w):
        c = px[x, y]
        if c != cur:
            if x - start >= min_run:
                segs.append((start, x - 1, cur))
            cur, start = c, x
    segs.append((start, w - 1, cur))
    segs = [s for s in segs if s[1] - s[0] + 1 >= min_run]
    print(f"  y={y:<5} " + " | ".join(f"x{s0}-{s1} #{c[0]:02x}{c[1]:02x}{c[2]:02x}" for s0, s1, c in segs[:max_segments]))


def vrle(x, min_run=6, max_segments=26):
    segs = []
    start = 0
    cur = px[x, 0]
    for y in range(1, h):
        c = px[x, y]
        if c != cur:
            if y - start >= min_run:
                segs.append((start, y - 1, cur))
            cur, start = c, y
    segs.append((start, h - 1, cur))
    segs = [s for s in segs if s[1] - s[0] + 1 >= min_run]
    print(f"  x={x:<5} " + " | ".join(f"y{s0}-{s1} #{c[0]:02x}{c[1]:02x}{c[2]:02x}" for s0, s1, c in segs[:max_segments]))


print("== horizontal scanlines (fractions of height) ==")
for fy in (0.02, 0.09, 0.25, 0.30, 0.42, 0.50, 0.62, 0.88, 0.93):
    rle(int(fy * h))

print("\n== vertical scanlines (fractions of width) ==")
for fx in (0.05, 0.30, 0.62, 0.95):
    vrle(int(fx * w))

print("\n== chroma census: how warm/neutral are the surfaces ==")
buckets = Counter()
for y in range(0, h, 2):
    for x in range(0, w, 2):
        r, g, b = px[x, y]
        if max(r, g, b) < 90:
            buckets[(r - b, g - b)] += 1
for (dr, dg), n in buckets.most_common(8):
    print(f"  r-b={dr:+d} g-b={dg:+d}  n={n}")

print("\n== warm ink and brand accent ==")
warm = Counter()
orange = Counter()
for y in range(0, h):
    for x in range(0, w, 2):
        r, g, b = px[x, y]
        if r > 150 and b > 120 and r >= g >= b and r - b > 8:
            warm[(r // 4 * 4, g // 4 * 4, b // 4 * 4)] += 1
        if r > 140 and r - b > 60 and g < r - 20:
            orange[(r // 6 * 6, g // 6 * 6, b // 6 * 6)] += 1
for c, n in warm.most_common(6):
    print(f"  warm ink  #{c[0]:02x}{c[1]:02x}{c[2]:02x}  n={n}")
for c, n in orange.most_common(4):
    print(f"  accent    #{c[0]:02x}{c[1]:02x}{c[2]:02x}  n={n}")
