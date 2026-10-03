#!/usr/bin/env python3
"""Bake the Sun's surface for the 3D view from a photograph of its disc (tools/data/sun.jpg,
an extreme-ultraviolet image in the style of SDO's AIA 171/193 Å: coronal loops, active
regions, the dark coronal holes).

The photo shows one hemisphere, cropped top and bottom. The sphere is seen from the six
faces of a cube round it, each face showing the photo face-on (turned and mirrored
differently, so no pattern repeats in an obvious way), and each point takes the faces in
proportion to how squarely it faces them: no seam, and the foreshortened limb barely used.
Equirectangular, 1024 x 512, 180° W at the left, north at the top, as brightness only,
written to src/pixel/data/sun-map.jpg. The shader (star.ts) colours it and sets it flowing.

Run: python3 tools/bake-sun.py   (needs numpy, scipy, pillow)
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = os.path.dirname(os.path.abspath(__file__))
img = np.asarray(Image.open(os.path.join(HERE, 'data', 'sun.jpg')).convert('RGB')).astype(float)
CX, CY, R = 937.5, 540.0, 607.0       # the disc, measured from its limb
REACH = 0.86 * R                       # how far out on the disc the faces reach: short of the limb, inside the crop
W, H = 1024, 512

lon = -np.pi + (np.arange(W) + 0.5) / W * 2 * np.pi
lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
LA, LO = np.meshgrid(lat, lon, indexing='ij')
n = np.stack([np.cos(LA) * np.cos(LO), np.cos(LA) * np.sin(LO), np.sin(LA)])


def look(u, v, turn, flip):
    """the photo seen face-on, turned and perhaps mirrored, at disc coordinates u, v (−1..1)"""
    if flip:
        u = -u
    c, s_ = np.cos(turn), np.sin(turn)
    a, b = u * c - v * s_, u * s_ + v * c
    px, py = CX + REACH * a, CY - REACH * b
    return np.stack([nd.map_coordinates(img[..., k], [py, px], order=1, mode='mirror') for k in range(3)], -1)


# each of the six faces of a cube round the sphere sees the photo, turned differently;
# each point takes them in proportion to how squarely it faces them
out = np.zeros((H, W, 3))
wsum = np.zeros((H, W, 1))
for ax, (i, j) in enumerate([(1, 2), (2, 0), (0, 1)]):
    for side in (1, -1):
        w = np.clip(n[ax] * side, 0, 1) ** 6
        out += look(n[i], n[j], np.radians(ax * 120 + (side < 0) * 200), side < 0) * w[..., None]
        wsum += w[..., None]
out /= wsum
# the picture is one colour scale (black, brown, gold, white) over brightness: kept as brightness alone,
# which the shader colours, gold for the Sun and each star's own colour for the rest
lum = out @ np.array([0.3, 0.59, 0.11])
Image.fromarray(np.clip(lum, 0, 255).astype(np.uint8), 'L').save(os.path.join(HERE, '..', 'src', 'pixel', 'data', 'sun-map.jpg'), quality=90, optimize=True)
print('brightness mean %.1f, 5%% %.1f, 95%% %.1f' % (lum.mean(), *np.percentile(lum, [5, 95])))
