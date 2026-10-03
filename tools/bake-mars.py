#!/usr/bin/env python3
"""Bake Mars' ground for the painters from two maps in tools/data:

  mars-mola.jpg    The MOLA topography (NASA/GSFC, Mars Orbiter Laser Altimeter): a
                   Mercator map to ±70° with polar stereographic insets to 60°,
                   coloured by elevation over a hillshade.
  mars-colour.png  A true-colour mosaic, simple cylindrical, 0° E at the left.

The elevation is read back from the colour scale (matching each pixel's colour,
whatever its shading, to the bar's), cleaned of the hillshade's highlights,
the grid and the lettering, and the volcano summits above the bar's 12 km top
are rebuilt as shields to their measured heights. The poles come from the
insets, turned to line up with the main map. Both maps are reprojected to
equirectangular, 180° W at the left and north at the top, like the Earth's,
and written to src/pixel/data:

  mars-height.png  1024 x 512 grey, elevation above the areoid: value * 0.12 - 8.5 km
  mars-colour.jpg  1024 x 512, colour

Run: python3 tools/bake-mars.py   (needs numpy, scipy, pillow)
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'pixel', 'data')
W, H = 1024, 512

mola = np.asarray(Image.open(os.path.join(HERE, 'data', 'mars-mola.jpg')).convert('RGB')).astype(float)

# ---------------------------------------------------------------- the colour scale
# the bar at the top right runs -8 km (x=795) to 12 km (x=946): 7.5 px a km, 0 at x=855
bx = np.arange(790, 962)
bkm = (bx - 855) / 7.5
bar = np.array([np.median(mola[8:15, x], 0) for x in bx])
bv = bar.max(1) + 1
bn = bar / bv[:, None]


def decode(px):
    """elevation (km) for each pixel: the bar colour nearest in hue and saturation, brightness barely counting"""
    p = px.reshape(-1, 3)
    out = np.empty(len(p))
    for s in range(0, len(p), 20000):
        q = p[s:s + 20000]
        vq = q.max(1) + 1
        e = ((q[:, None, :] / vq[:, None, None] - bn[None]) ** 2).sum(2) + 0.02 * np.log(vq[:, None] / bv[None]) ** 2
        out[s:s + 20000] = bkm[e.argmin(1)]
    return out.reshape(px.shape[:2])


def grey(px):
    """the white and grey of the background, grid gaps and lettering"""
    return (px.max(2) - px.min(2)) < 22


# ---------------------------------------------------------------- the main map: Mercator, ±70°
MX0, MX1, MY0, MY1 = 26, 983, 32, 564
K = (MX1 - MX0) / (2 * np.pi)          # px per radian
Y0 = 297 - MY0                         # the equator
main = mola[MY0:MY1, MX0:MX1]
hm = decode(main)
hm = nd.median_filter(hm, 3)
# the hillshade's sunlit slopes read as too high: nothing small stands far above its surroundings
big = nd.median_filter(hm, 25)


def merc(lat, lon):
    return (lon + 180) / 360 * (MX1 - MX0) - 0.5, Y0 - K * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


yy, xx = np.mgrid[0:hm.shape[0], 0:hm.shape[1]]
# the great volcanoes: lat, lon, radius km, summit km (MOLA)
VOLC = [(18.65, -133.8, 330, 21.9), (-8.3, -120.1, 220, 17.8), (1.5, -113.0, 200, 14.0),
        (11.8, -104.5, 200, 18.2), (25.0, 147.0, 120, 14.1)]
volc = np.zeros(hm.shape, bool)
for la, lo, rkm, _ in VOLC:
    x, y = merc(la, lo)
    s = K / 3389.5 / np.cos(np.radians(la))
    volc |= (xx - x) ** 2 + (yy - y) ** 2 < (rkm * s) ** 2
hm = np.where(volc, hm, np.minimum(hm, big + 1.2))
# above the bar's top (white, 12 km and over) the shields rise on to their summits
for la, lo, rkm, top in VOLC:
    x, y = merc(la, lo)
    s = K / 3389.5 / np.cos(np.radians(la))
    near = (xx - x) ** 2 + (yy - y) ** 2 < (rkm * 0.6 * s) ** 2
    sat = near & (hm >= 11.5)
    if not sat.any():
        continue
    lab, _ = nd.label(sat)
    keep = lab == lab[int(round(y)), int(round(x))] if lab[int(round(y)), int(round(x))] else sat
    d = nd.distance_transform_edt(keep)
    if d.max() > 0:
        hm = np.where(keep, 11.5 + (top - 11.5) * (d / d.max()) ** 0.8, hm)
hm = nd.gaussian_filter(hm, 0.7)

# ---------------------------------------------------------------- the polar insets: stereographic, to 60°
RC = 136                                # the 60° circle, px
POLES = {1: (1136, 143, 270, 1), -1: (1135.5, 432, 90, -1)}   # centre, angle of 0° E, sense of east
pol = {}
for sg, (cx, cy, t0, sense) in POLES.items():
    x0, y0 = int(cx) - 140, int(cy) - 140
    sub = mola[y0:y0 + 281, x0:x0 + 281]
    hp = decode(sub)
    bad = grey(sub) | (sub.max(2) < 40)
    # the gaps, grid and names: filled from the nearest good pixel
    idx = nd.distance_transform_edt(bad, return_distances=False, return_indices=True)
    hp = hp[idx[0], idx[1]]
    hp = nd.median_filter(hp, 5)
    hp = np.minimum(hp, nd.median_filter(hp, 25) + 1.2)
    pol[sg] = (hp, cx - x0, cy - y0, t0, sense)


def polar(lat, lon):
    sg = 1 if lat.mean() > 0 else -1
    hp, cx, cy, t0, sense = pol[sg]
    r = RC * np.tan(np.radians(90 - np.abs(lat)) / 2) / np.tan(np.radians(15))
    th = np.radians(t0 + sense * lon)
    return nd.map_coordinates(hp, [cy - r * np.sin(th), cx + r * np.cos(th)], order=1, mode='nearest')


# ---------------------------------------------------------------- equirectangular, 180° W at the left, north at the top
lon = -180 + (np.arange(W) + 0.5) / W * 360
lat = 90 - (np.arange(H) + 0.5) / H * 180
LA, LO = np.meshgrid(lat, lon, indexing='ij')
mx, my = merc(np.clip(LA, -69.5, 69.5), LO)
E = nd.map_coordinates(hm, [my, mx], order=1, mode='nearest')
for sg in (1, -1):
    rows = (LA * sg) > 60
    P = polar(LA[rows], LO[rows])
    t = np.clip((np.abs(LA[rows]) - 62) / 6, 0, 1)
    E[rows] = E[rows] * (1 - t) + P * t
E = nd.gaussian_filter(E, (0.6, 0.6), mode='wrap')
code = np.clip(np.round((E + 8.5) / 0.12), 0, 255).astype(np.uint8)
Image.fromarray(code, 'L').save(os.path.join(OUT, 'mars-height.png'), optimize=True)

# ---------------------------------------------------------------- the colour mosaic
col = np.asarray(Image.open(os.path.join(HERE, 'data', 'mars-colour.png')).convert('RGB')).astype(float)
# fitted against the MOLA relief (crater rims and scarps line up): 0° E at x=12.5, 708 px round,
# 90° N at y=73.9 and 90° S at y=402.3; the picture itself runs from y=79 to 398
CX0, CSPAN, CTOP, CBOT = 12.5, 708.0, 73.9, 402.25
lonE = LO % 360
cx = CX0 + lonE / 360 * CSPAN
cy = np.clip(CTOP + (90 - LA) / 180 * (CBOT - CTOP), 79.5, 397.5)
samp = lambda x: np.stack([nd.map_coordinates(col[..., c], [cy, x], order=3, mode='nearest') for c in range(3)], -1)
rgb = samp(np.clip(cx, 16, 713))
# the mosaic's edges are frayed: from 356° E round to 2° E it is filled across the gap
gap = (cx > 713) | (cx < 16)
cw = np.where(cx < 16, cx + CSPAN, cx)
t = ((cw - 713) / (16 + CSPAN - 713))[..., None]
rgb = np.where(gap[..., None], samp(np.full_like(cx, 713.0)) * (1 - t) + samp(np.full_like(cx, 16.0)) * t, rgb)
# past the mosaic's top and bottom rows the caps fade to their mean colour, rather than streaking to the pole
for sg in (1, -1):
    edge = rgb[(LA * sg > 85.5) & (LA * sg < 86.5)].mean(0)
    f = np.clip((LA * sg - 84) / 4, 0, 1)[..., None]
    rgb = np.where((LA * sg > 84)[..., None], rgb * (1 - f) + edge * f, rgb)
Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'mars-colour.jpg'), quality=90, optimize=True)

print('height %.1f .. %.1f km, median %.1f' % (E.min(), E.max(), np.median(E)))
for name, la, lo in [('Olympus Mons', 18.65, -133.8), ('Hellas floor', -42.4, 70.5), ('Argyre', -49.7, -43),
                     ('Arsia Mons', -8.3, -120.1), ('Elysium Mons', 25, 147), ('north pole', 89, 0), ('Valles', -9, -70)]:
    i = int((lo + 180) / 360 * W) % W
    j = int((90 - la) / 180 * H)
    print('  %-13s %6.1f km' % (name, E[j, i]))
