#!/usr/bin/env python3
"""Bake the Earth's land elevation for the painters into src/pixel/data/earth-height.png.

The source is NASA's shaded-relief topography (SRTM over land, from NASA's
Visible Earth, public domain) as a 2048 x 1024 grey map, equirectangular from
180 W with north at the top, the sea at 0 and the land rising linearly at
about 25 m a level (Tibet ~200, the summit cell round Everest 242). The copy
three-globe ships with its examples is fetched, checked, and written as is:

  earth-height.png  2048 x 1024 grey: elevation above sea level, value * 25.1 m

Run: python3 tools/bake-earth-height.py   (needs numpy, pillow)
"""
import io, os, urllib.request
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'pixel', 'data', 'earth-height.png')
URL = 'https://raw.githubusercontent.com/vasturiano/three-globe/master/example/img/earth-topology.png'

src = os.path.join(HERE, 'data', 'earth-topology.png')
if os.path.exists(src):
    im = Image.open(src)
else:
    with urllib.request.urlopen(URL, timeout=120) as r:
        im = Image.open(io.BytesIO(r.read()))
a = np.asarray(im.convert('L'))
H, W = a.shape
assert (W, H) == (2048, 1024), (W, H)


def at(lat, lon):
    return int(a[int((90 - lat) / 180 * H), int((lon + 180) / 360 * W)])


# sanity: the sea is 0, the Tibetan plateau about 5 km, the Altiplano about 4
assert at(30, -40) == 0 and 180 < at(33, 88) < 230 and 140 < at(-17, -68) < 190
Image.fromarray(a).save(OUT, optimize=True)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')
