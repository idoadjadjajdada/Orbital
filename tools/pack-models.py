#!/usr/bin/env python3
"""Pack the low-poly models (tools/data/models/*.glb) for the game: src/three/models/.

The bases (dome-habitat, modular-outpost, vault-hangar), the trees (oak,
birch, maple, palm, pine), the ruins (ruin-*) and the rockets (rocket-*)
come as GLB files with 1024-pixel textures. The ship (orbital-ship) is
trimmed first: see ship(). Seen at
the sizes they are in the game, 512 is plenty: each texture over that is
scaled down and re-encoded (JPEG, quality 85; the rockets' atlases, with
their markings, stay at 1024 and only become JPEGs), and anything nothing
refers to is dropped, so the browser fetches a third as much.

Run: python3 tools/pack-models.py
"""
import glob, io, json, os, struct
from PIL import Image

MAX = 512
# the rockets' atlases carry their labels and markings, and the ship is seen from close up: kept sharper
MAX_FOR = {'rocket-': 1024, 'orbital-ship': 1024}

# the ship's plating, as the game names its materials: colour (sRGB) and metalness
PLATING = {
    'hull': (0xd2d5dc, 0), 'dark': (0x5a6274, 0), 'wall': (0xa8b0c0, 0), 'floor': (0x59606e, 0),
    'ceil': (0x7c8494, 0), 'xhull': (0xdfe2e8, 0.35), 'xdark': (0x4e5668, 0.55),
}

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


def linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def ship(j):
    """
    The ship's model is the game's own ship (tools/export-ship.mjs) reworked
    outside it: a new hull (the group 'hull_v2'), the rooms dressed
    ('interior_v2'), new pictures on the plating, and the old hull cut away
    where the new one covers it (its pieces kept, but only some of their
    triangles drawn). The game still builds its ship, for the rooms, the
    stations, the screens and the moving parts, so the rest of the model
    (its copy of those) is dropped. What is kept: the two groups; for each
    plating material given a picture of its own, a stand-in node
    'skin:<the game's name for it>' carrying it; and for each piece cut
    away, a node 'trim' with the triangles left, and the piece's size (its
    number of points and its bounds) to know it by.
    """
    root = j['nodes'][j['scenes'][j.get('scene', 0)]['nodes'][0]]
    keep = [c for c in root['children'] if j['nodes'][c].get('name') in ('hull_v2', 'interior_v2')]
    # the plating materials with a named picture, matched to the game's by colour and metalness
    skins = {}
    for i, m in enumerate(j['materials']):
        pb = m.get('pbrMetallicRoughness', {})
        t = pb.get('baseColorTexture')
        if m.get('name') or not t or not j['images'][j['textures'][t['index']]['source']].get('name'):
            continue
        col = pb.get('baseColorFactor', [1, 1, 1, 1])
        def far(k):
            hexc, metal = PLATING[k]
            rgb = [linear((hexc >> s_) & 255) for s_ in (16, 8, 0)]
            return sum((a - b) ** 2 for a, b in zip(rgb, col)) + (metal - pb.get('metallicFactor', 1)) ** 2
        skins[min(PLATING, key=far)] = i
    # a stand-in's shape: the smallest mesh there is, its positions only
    small = min((p['attributes']['POSITION'] for m in j['meshes'] for p in m['primitives']), key=lambda a: j['accessors'][a]['count'])
    nodes, meshes = [], []
    def copy(i):
        n = dict(j['nodes'][i])
        if 'mesh' in n:
            meshes.append(j['meshes'][n['mesh']])
            n['mesh'] = len(meshes) - 1
        n['children'] = [copy(c) for c in n.get('children', [])]
        if not n['children']: del n['children']
        nodes.append(n)
        return len(nodes) - 1
    kids = [copy(c) for c in keep]
    for c in root['children']:
        n = j['nodes'][c]
        if 'mesh' not in n or c in keep: continue
        for p in j['meshes'][n['mesh']]['primitives']:
            a = j['accessors'][p['attributes']['POSITION']]
            if 'indices' not in p or j['accessors'][p['indices']]['count'] >= a['count']: continue
            meshes.append({'primitives': [{'attributes': {'POSITION': p['attributes']['POSITION']}, 'indices': p['indices']}]})
            nodes.append({'name': 'trim', 'mesh': len(meshes) - 1, 'extras': {'count': a['count'], 'min': a['min'], 'max': a['max']}})
            kids.append(len(nodes) - 1)
    for name, mi in sorted(skins.items()):
        meshes.append({'primitives': [{'attributes': {'POSITION': small}, 'material': mi}]})
        nodes.append({'name': f'skin:{name}', 'mesh': len(meshes) - 1})
        kids.append(len(nodes) - 1)
    nodes.append({'name': root.get('name', 'Orbital ship'), 'children': kids})
    j['scenes'] = [{'nodes': [len(nodes) - 1]}]
    j['scene'] = 0
    j['nodes'] = nodes
    # only the accessors and materials still used, renumbered
    acc, mat = {}, {}
    for m in meshes:
        for p in m['primitives']:
            for k, a in p['attributes'].items():
                p['attributes'][k] = acc.setdefault(a, len(acc))
            if 'indices' in p: p['indices'] = acc.setdefault(p['indices'], len(acc))
            if 'material' in p: p['material'] = mat.setdefault(p['material'], len(mat))
    j['accessors'] = [j['accessors'][o] for o in sorted(acc, key=acc.get)]
    j['materials'] = [j['materials'][o] for o in sorted(mat, key=mat.get)]
    j['meshes'] = meshes
    print('  ship: plating skins', ', '.join(f'{k} (material {v})' for k, v in sorted(skins.items())))
    print('  ship: pieces trimmed', ', '.join(str(n['extras']['count']) for n in nodes if n.get('name') == 'trim'))


def pack(path):
    j, bin_ = read(path)
    if os.path.basename(path).startswith('orbital-ship'):
        ship(j)
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
