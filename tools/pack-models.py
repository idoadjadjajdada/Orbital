#!/usr/bin/env python3
"""Pack the low-poly models (tools/data/models/*.glb) for the game: src/three/models/.

The bases (dome-habitat, modular-outpost, vault-hangar), the trees (oak,
birch, maple, palm, pine), the ruins (ruin-*) and the rockets (rocket-*)
come as GLB files with 1024-pixel textures. Seen at
the sizes they are in the game, 512 is plenty: each texture over that is
scaled down and re-encoded (JPEG, quality 85; the rockets' atlases, with
their markings, stay at 1024 and only become JPEGs), and anything nothing
refers to is dropped, so the browser fetches a third as much.

Run: python3 tools/pack-models.py
"""
import glob, io, json, os, struct
from PIL import Image

MAX = 512
# the rockets' atlases carry their labels and markings: kept sharper
MAX_FOR = {'rocket-': 1024}

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'data', 'models')
OUT = os.path.join(HERE, '..', 'src', 'three', 'models')


def read(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    bl = struct.unpack('<I', b[off:off + 4])[0]
    return j, b[off + 8:off + 8 + bl]


def refs(j, key):
    """every index into j[key] that something uses"""
    used = set()
    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if k == 'index' and key == 'textures':
                    used.add(v)
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    if key == 'textures':
        walk(j.get('materials', []))
    return used


def pack(path):
    j, bin_ = read(path)
    top = next((m for k, m in MAX_FOR.items() if os.path.basename(path).startswith(k)), MAX)
    recoded = set()
    tex_used = sorted(refs(j, 'textures'))
    img_used = sorted({j['textures'][t]['source'] for t in tex_used})
    # renumber textures and images
    tmap = {o: n for n, o in enumerate(tex_used)}
    imap = {o: n for n, o in enumerate(img_used)}
    def fix(x):
        if isinstance(x, dict):
            for k, v in list(x.items()):
                if k == 'index' and isinstance(v, int) and v in tmap and isinstance(x.get('texCoord', 0), int):
                    x[k] = tmap[v]
                else:
                    fix(v)
        elif isinstance(x, list):
            for v in x:
                fix(v)
    fix(j.get('materials', []))
    j['textures'] = [dict(j['textures'][o], source=imap[j['textures'][o]['source']]) for o in tex_used]
    j['images'] = [j['images'][o] for o in img_used]
    # buffer views still in use: accessors' and images'
    bv_used = sorted({a['bufferView'] for a in j['accessors'] if 'bufferView' in a} | {im['bufferView'] for im in j['images']})
    vmap, out = {}, bytearray()
    imgview = {im['bufferView'] for im in j['images']}
    for o in bv_used:
        v = j['bufferViews'][o]
        while len(out) % 4: out.append(0)
        s = v.get('byteOffset', 0)
        data = bin_[s:s + v['byteLength']]
        if o in imgview:
            im = Image.open(io.BytesIO(data))
            # too big, or a large PNG photo-like atlas: scaled down and/or made a JPEG
            if max(im.size) > top or (im.format == 'PNG' and len(data) > 200_000):
                if max(im.size) > top:
                    im = im.resize((top, top * im.size[1] // im.size[0]), Image.LANCZOS)
                buf = io.BytesIO()
                im.convert('RGB').save(buf, 'JPEG', quality=85, optimize=True)
                data = buf.getvalue()
                recoded.add(o)
        vmap[o] = dict(v, byteOffset=len(out), byteLength=len(data))
        out += data
    while len(out) % 4: out.append(0)
    j['bufferViews'] = [vmap[o] for o in bv_used]
    vnum = {o: n for n, o in enumerate(bv_used)}
    for a in j['accessors']:
        if 'bufferView' in a: a['bufferView'] = vnum[a['bufferView']]
    for im in j['images']:
        if im['bufferView'] in recoded: im['mimeType'] = 'image/jpeg'
        im['bufferView'] = vnum[im['bufferView']]
    j['buffers'] = [{'byteLength': len(out)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    dst = os.path.join(OUT, os.path.basename(path))
    open(dst, 'wb').write(glb)
    print(f'{os.path.basename(path)}: {os.path.getsize(path) // 1024} KB -> {len(glb) // 1024} KB, {len(j["images"])} images')


os.makedirs(OUT, exist_ok=True)
for p in sorted(glob.glob(os.path.join(SRC, '*.glb'))):
    pack(p)
