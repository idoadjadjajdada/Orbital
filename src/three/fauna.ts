import * as THREE from 'three';

/**
 * Animals with their own shapes, and the way they move.
 *
 * Each of the Earth's animals is built from its body plan — a quadruped's
 * barrel, legs and neck in its own proportions, a bird's wings, a
 * scorpion's tail — with what makes it itself: an elephant's trunk, tusks
 * and ears, a giraffe's neck and patches, a zebra's stripes, a bison's hump,
 * a moose's palmate antlers, a lion's mane, a fennec's huge ears. A made-up
 * world's animals get body plans of their own from their seed: six legs or
 * four, stilts or stumps, a long neck or none, crests, eye-stalks, glowing
 * spots, wings for a glider. They walk with their legs swinging in a gait
 * (paired diagonals, as a quadruped walks), heads nodding; birds flap.
 *
 * Models are built about a metre long and scaled to the animal's size; y
 * up, facing −z, feet at y = 0.
 */

export interface Beast { obj: THREE.Group; animate: (t: number, speed: number) => void }

type Mat = THREE.Material;
const lam = (color: number, map: THREE.Texture | null = null) => new THREE.MeshLambertMaterial({ color, map, flatShading: false });

/** a pattern on a hide: stripes, patches, rosettes */
const patterns = new Map<string, THREE.Texture | null>();
function pattern(kind: 'stripes' | 'patches' | 'spots', base: string, mark: string) {
  const key = `${kind}${base}${mark}`;
  if (patterns.has(key)) return patterns.get(key)!;
  if (typeof document === 'undefined') { patterns.set(key, null); return null; }
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.fillStyle = mark;
  if (kind === 'stripes') for (let x = 0; x < 128; x += 14) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, 40, x - 6, 80, x + 3, 128); g.lineTo(x + 8, 128); g.bezierCurveTo(x + 1, 80, x + 13, 40, x + 7, 0); g.fill(); }
  else if (kind === 'patches') for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { g.beginPath(); g.ellipse(i * 26 + 13 + (j % 2) * 8, j * 26 + 13, 10, 9, 0.4, 0, 7); g.fill(); }
  else for (let k = 0; k < 40; k++) { const x = (k * 37) % 128, y = (k * 61) % 128; g.beginPath(); g.arc(x, y, 4, 0, 7); g.lineWidth = 2.5; g.strokeStyle = mark; g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  patterns.set(key, t);
  return t;
}

class Kit {
  readonly obj = new THREE.Group();
  readonly body = new THREE.Group();
  readonly legs: { g: THREE.Group; phase: number; swing: number }[] = [];
  readonly flaps: { g: THREE.Group; side: number }[] = [];
  head: THREE.Group | null = null;
  tail: THREE.Group | null = null;
  constructor() { this.obj.add(this.body); }
  part(geo: THREE.BufferGeometry, m: Mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = this.body) {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    parent.add(o);
    return o;
  }
  /** a leg hanging from a hip: thigh and shin, a hoof or paw */
  leg(x: number, y: number, z: number, len: number, thick: number, m: Mat, phase: number, foot: Mat = m, swing = 0.5) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    this.body.add(g);
    this.part(new THREE.CylinderGeometry(thick, thick * 0.75, len * 0.52, 8), m, 0, -len * 0.26, 0, 0, 0, 0, g);
    this.part(new THREE.CylinderGeometry(thick * 0.7, thick * 0.55, len * 0.5, 8), m, 0, -len * 0.74, 0.02, 0, 0, 0, g);
    this.part(new THREE.CylinderGeometry(thick * 0.6, thick * 0.75, len * 0.06, 8), foot, 0, -len + len * 0.03, 0.02, 0, 0, 0, g);
    this.legs.push({ g, phase, swing });
    return g;
  }
  /** a neck from the shoulders and a head on it */
  neckHead(at: THREE.Vector3, len: number, tilt: number, thick: number, headLen: number, headW: number, m: Mat) {
    const neck = new THREE.Group();
    neck.position.copy(at);
    neck.rotation.x = -tilt;
    this.body.add(neck);
    this.part(new THREE.CylinderGeometry(thick * 0.75, thick, len, 10), m, 0, len / 2, 0, 0, 0, 0, neck);
    const head = new THREE.Group();
    head.position.set(0, len, 0);
    head.rotation.x = tilt - 0.15;
    neck.add(head);
    this.part(new THREE.CapsuleGeometry(headW * 0.5, headLen * 0.6, 4, 10), m, 0, 0, -headLen * 0.35, Math.PI / 2, 0, 0, head);
    this.head = head;
    return head;
  }
  eyes(head: THREE.Group, x: number, y: number, z: number, r: number, m: Mat = DARK) {
    for (const s of [-1, 1]) this.part(new THREE.SphereGeometry(r, 8, 6), m, s * x, y, z, 0, 0, 0, head);
  }
  tailFrom(at: THREE.Vector3, len: number, thick: number, droop: number, m: Mat, tuft?: Mat) {
    const g = new THREE.Group();
    g.position.copy(at);
    g.rotation.x = droop;
    this.body.add(g);
    this.part(new THREE.CylinderGeometry(thick * 0.4, thick, len, 6), m, 0, 0, len / 2, Math.PI / 2, 0, 0, g);
    if (tuft) this.part(new THREE.SphereGeometry(thick * 1.6, 8, 6), tuft, 0, 0, len, 0, 0, 0, g);
    this.tail = g;
    return g;
  }
  wing(side: number, span: number, chord: number, m: Mat, at: THREE.Vector3) {
    const g = new THREE.Group();
    g.position.copy(at);
    this.body.add(g);
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(span, chord * 0.2); sh.lineTo(span * 0.95, -chord * 0.4); sh.lineTo(span * 0.5, -chord); sh.lineTo(0, -chord * 0.9);
    const geo = new THREE.ShapeGeometry(sh);
    geo.rotateX(Math.PI / 2);
    const w = new THREE.Mesh(geo, m);
    w.scale.x = side;
    (w.material as THREE.Material).side = THREE.DoubleSide;
    g.add(w);
    this.flaps.push({ g, side });
  }
  done(walk = 1.0): Beast {
    const legs = this.legs, flaps = this.flaps, head = this.head, tail = this.tail, body = this.body;
    const restHead = head?.rotation.x ?? 0;
    return {
      obj: this.obj,
      animate: (t, speed) => {
        const k = Math.min(1, speed / 1.2), w = t * (3 + speed * 3) * walk;
        for (const l of legs) l.g.rotation.x = Math.sin(w + l.phase) * l.swing * k;
        for (const f of flaps) f.g.rotation.z = f.side * (0.15 + Math.sin(t * 9) * 0.55);
        if (head) head.rotation.x = restHead + Math.sin(w * 2) * 0.05 * k + Math.sin(t * 0.7) * 0.06;
        if (tail) tail.rotation.y = Math.sin(t * 2.3) * 0.35;
        body.position.y = Math.abs(Math.sin(w)) * 0.02 * k;
      },
    };
  }
}

const DARK = lam(0x111111), IVORY = lam(0xeee8d6), HORN = lam(0x4a3f34), PINK = lam(0xc89080);

/** a four-legged body: barrel, legs, neck and head, in proportions */
function quad(c: number, o: { L?: number; H?: number; W?: number; leg?: number; legT?: number; neck?: number; tilt?: number; headL?: number; tail?: number; map?: THREE.Texture | null; foot?: Mat }) {
  const K = new Kit(), m = lam(c, o.map ?? null);
  const L = o.L ?? 1, H = o.H ?? 0.35, W = o.W ?? 0.32, leg = o.leg ?? 0.55, lt = o.legT ?? 0.06;
  const y = leg + H * 0.35;
  K.part(new THREE.CapsuleGeometry(Math.max(H, W) * 0.5, L * 0.55, 6, 12), m, 0, y, 0, Math.PI / 2, 0, 0).scale.set(W / Math.max(H, W), 1, H / Math.max(H, W));
  for (const [x, z, p] of [[-W * 0.3, -L * 0.32, 0], [W * 0.3, -L * 0.32, Math.PI], [-W * 0.3, L * 0.32, Math.PI], [W * 0.3, L * 0.32, 0]] as const) K.leg(x, y - H * 0.25, z, y - H * 0.25, lt, m, p, o.foot ?? m);
  const head = K.neckHead(new THREE.Vector3(0, y + H * 0.15, -L * 0.42), o.neck ?? L * 0.3, o.tilt ?? 0.9, H * 0.28, o.headL ?? L * 0.3, H * 0.45, m);
  if (o.tail !== 0) K.tailFrom(new THREE.Vector3(0, y + H * 0.2, L * 0.5), o.tail ?? L * 0.35, lt * 0.6, 0.9, m);
  return { K, m, head, y, L, H, W };
}

/** the Earth's animals, by name; anything else gets a body plan from what kind of thing it is */
export function earthAnimal(name: string, color: number, fly: boolean): Beast {
  const n = name.toLowerCase();
  if (fly || /condor|macaw|robin|pigeon/.test(n)) return bird(color, /condor/.test(n) ? 2.4 : /macaw/.test(n) ? 1.2 : 1, /macaw/.test(n));
  if (/elephant/.test(n)) {
    const q = quad(color, { L: 1, H: 0.62, W: 0.55, leg: 0.6, legT: 0.11, neck: 0.12, tilt: 0.3, headL: 0.32, tail: 0.3 });
    const h = q.head;
    // the trunk, hanging in segments; the tusks; the ears
    let parent: THREE.Object3D = h;
    for (let k = 0; k < 5; k++) { const s = new THREE.Group(); s.position.set(0, k ? -0.11 : -0.08, k ? 0 : -0.25); s.rotation.x = 0.12; parent.add(s); q.K.part(new THREE.CylinderGeometry(0.05 - k * 0.006, 0.06 - k * 0.006, 0.12, 8), q.m, 0, -0.06, 0, 0, 0, 0, s); parent = s; }
    for (const s of [-1, 1]) {
      q.K.part(new THREE.ConeGeometry(0.025, 0.26, 6), IVORY, s * 0.09, -0.12, -0.25, -2.2, 0, 0, h);
      const ear = q.K.part(new THREE.CircleGeometry(0.2, 12), q.m, s * 0.17, 0.02, -0.05, 0, s * 1.1, 0, h);
      (ear.material as THREE.Material).side = THREE.DoubleSide;
    }
    q.K.eyes(h, 0.13, 0.05, -0.2, 0.018);
    return q.K.done(0.6);
  }
  if (/giraffe/.test(n)) {
    const q = quad(color, { L: 0.8, H: 0.38, W: 0.3, leg: 1.1, legT: 0.045, neck: 1.1, tilt: 0.35, headL: 0.28, tail: 0.4, map: pattern('patches', '#e8c890', '#7a4020') });
    for (const s of [-1, 1]) q.K.part(new THREE.CylinderGeometry(0.015, 0.02, 0.1, 5), HORN, s * 0.04, 0.09, 0, 0, 0, 0, q.head);
    q.K.eyes(q.head, 0.07, 0.03, -0.12, 0.015);
    return q.K.done(0.6);
  }
  if (/zebra/.test(n)) {
    const q = quad(color, { L: 1, H: 0.42, W: 0.32, leg: 0.6, legT: 0.045, neck: 0.38, tilt: 0.75, headL: 0.36, tail: 0.4, map: pattern('stripes', '#f2f2ee', '#151515'), foot: DARK });
    q.K.part(new THREE.BoxGeometry(0.03, 0.08, 0.36), DARK, 0, 0.03, 0.19, 0, 0, 0, q.head.parent!);
    for (const s of [-1, 1]) q.K.part(new THREE.ConeGeometry(0.035, 0.12, 6), q.m, s * 0.06, 0.1, 0.02, 0, 0, 0, q.head);
    q.K.eyes(q.head, 0.08, 0.04, -0.12, 0.015);
    return q.K.done(0.9);
  }
  if (/bison/.test(n)) {
    const q = quad(color, { L: 1, H: 0.55, W: 0.42, leg: 0.42, legT: 0.07, neck: 0.12, tilt: 1.4, headL: 0.3, tail: 0.3 });
    q.K.part(new THREE.SphereGeometry(0.33, 12, 8), lam(0x3a2814), 0, q.y + 0.18, -0.25);
    for (const s of [-1, 1]) q.K.part(new THREE.ConeGeometry(0.03, 0.14, 6), HORN, s * 0.13, 0.05, -0.05, 0, 0, -s * 1.1, q.head);
    q.K.eyes(q.head, 0.12, 0.04, -0.12, 0.015);
    return q.K.done(0.8);
  }
  if (/dromedary|camel/.test(n)) {
    const q = quad(color, { L: 0.95, H: 0.42, W: 0.32, leg: 0.95, legT: 0.045, neck: 0.65, tilt: 0.5, headL: 0.3, tail: 0.3 });
    q.K.part(new THREE.SphereGeometry(0.24, 12, 8), q.m, 0, q.y + 0.22, 0.02).scale.set(1, 0.9, 1.3);
    q.K.eyes(q.head, 0.07, 0.04, -0.1, 0.015);
    return q.K.done(0.7);
  }
  if (/moose|deer|reindeer/.test(n)) {
    const moose = /moose/.test(n);
    const q = quad(color, { L: 1, H: moose ? 0.45 : 0.36, W: 0.3, leg: moose ? 0.85 : 0.7, legT: 0.04, neck: 0.42, tilt: 0.7, headL: moose ? 0.38 : 0.3, tail: 0.12 });
    // antlers: palmate on a moose, branching tines on a deer
    for (const s of [-1, 1]) {
      const a = new THREE.Group();
      a.position.set(s * 0.06, 0.08, -0.02);
      a.rotation.set(-0.3, 0, -s * (moose ? 1.2 : 0.4));
      q.head.add(a);
      q.K.part(new THREE.CylinderGeometry(0.015, 0.02, 0.3, 5), HORN, 0, 0.15, 0, 0, 0, 0, a);
      if (moose) q.K.part(new THREE.BoxGeometry(0.35, 0.03, 0.22), HORN, s * 0.12, 0.3, 0, 0, 0, s * 0.3, a);
      else for (let k = 0; k < 3; k++) q.K.part(new THREE.CylinderGeometry(0.008, 0.012, 0.16, 4), HORN, 0, 0.12 + k * 0.08, -0.05, -0.8, 0, 0, a);
    }
    q.K.eyes(q.head, 0.08, 0.04, -0.12, 0.015);
    return q.K.done(0.9);
  }
  if (/ibex/.test(n)) {
    const q = quad(color, { L: 0.9, H: 0.38, W: 0.3, leg: 0.55, legT: 0.04, neck: 0.3, tilt: 0.8, headL: 0.26, tail: 0.1 });
    for (const s of [-1, 1]) for (let k = 0; k < 6; k++) q.K.part(new THREE.CylinderGeometry(0.02 - k * 0.002, 0.025 - k * 0.002, 0.08, 5), HORN, s * 0.05, 0.08 + Math.sin(k * 0.45) * 0.18, 0.05 + (1 - Math.cos(k * 0.45)) * 0.25, -0.5 + k * 0.35, 0, 0, q.head);
    q.K.eyes(q.head, 0.07, 0.03, -0.1, 0.014);
    return q.K.done(1);
  }
  if (/lion|leopard|jaguar/.test(n)) {
    const cat = /lion/.test(n) ? null : pattern('spots', /snow/.test(n) ? '#d8d8d0' : '#d0a040', /snow/.test(n) ? '#4a4a4a' : '#2a1a10');
    const q = quad(color, { L: 1, H: 0.34, W: 0.28, leg: 0.42, legT: 0.05, neck: 0.22, tilt: 1.0, headL: 0.24, tail: 0.75, map: cat });
    if (/lion/.test(n)) q.K.part(new THREE.SphereGeometry(0.22, 12, 8), lam(0x7a4a1a), 0, 0.02, 0.04, 0, 0, 0, q.head);
    for (const s of [-1, 1]) q.K.part(new THREE.SphereGeometry(0.04, 8, 6), q.m, s * 0.08, 0.1, 0, 0, 0, 0, q.head);
    q.K.eyes(q.head, 0.07, 0.03, -0.18, 0.016, lam(0xc0a020));
    return q.K.done(1.1);
  }
  if (/fox|wolf/.test(n)) {
    const fennec = /fennec/.test(n);
    const q = quad(color, { L: 1, H: 0.3, W: 0.24, leg: 0.4, legT: 0.035, neck: 0.22, tilt: 0.9, headL: 0.3, tail: 0 });
    // a long pointed muzzle, tall ears (huge on a fennec), a bushy tail
    q.K.part(new THREE.ConeGeometry(0.05, 0.18, 8), q.m, 0, -0.02, -0.3, -Math.PI / 2, 0, 0, q.head);
    for (const s of [-1, 1]) q.K.part(new THREE.ConeGeometry(fennec ? 0.07 : 0.04, fennec ? 0.26 : 0.12, 6), q.m, s * 0.06, 0.12, 0, 0, 0, s * -0.3, q.head);
    const t = q.K.tailFrom(new THREE.Vector3(0, q.y + 0.05, 0.5), 0.45, 0.06, 1.2, q.m);
    q.K.part(new THREE.SphereGeometry(0.08, 8, 6), /arctic/.test(n) ? q.m : lam(0xffffff), 0, 0, 0.42, 0, 0, 0, t).scale.set(1, 1, 2);
    q.K.eyes(q.head, 0.06, 0.03, -0.14, 0.014);
    return q.K.done(1.2);
  }
  if (/bear|gorilla|orangutan/.test(n)) {
    const ape = !/bear/.test(n);
    const q = quad(color, { L: ape ? 0.7 : 1, H: 0.5, W: 0.45, leg: ape ? 0.45 : 0.38, legT: 0.09, neck: 0.1, tilt: 1.2, headL: 0.28, tail: 0 });
    for (const s of [-1, 1]) q.K.part(new THREE.SphereGeometry(0.05, 8, 6), q.m, s * 0.1, 0.1, 0, 0, 0, 0, q.head);
    if (ape) { q.K.body.rotation.x = -0.35; q.K.part(new THREE.SphereGeometry(0.12, 10, 8), lam(0x2a2018), 0, -0.05, -0.12, 0, 0, 0, q.head); }
    q.K.eyes(q.head, 0.07, 0.03, -0.18, 0.016);
    return q.K.done(0.7);
  }
  if (/penguin/.test(n)) {
    const K = new Kit();
    const black = lam(0x15181c), white = lam(0xf0f0ea);
    K.part(new THREE.CapsuleGeometry(0.18, 0.45, 6, 12), black, 0, 0.42, 0);
    K.part(new THREE.CapsuleGeometry(0.15, 0.4, 6, 12), white, 0, 0.4, -0.06).scale.set(1, 1, 0.8);
    const h = new THREE.Group(); h.position.set(0, 0.8, 0); K.body.add(h); K.head = h;
    K.part(new THREE.SphereGeometry(0.13, 10, 8), black, 0, 0, 0, 0, 0, 0, h);
    K.part(new THREE.ConeGeometry(0.03, 0.12, 6), lam(0xe08a20), 0, -0.02, -0.15, -Math.PI / 2, 0, 0, h);
    K.part(new THREE.SphereGeometry(0.05, 8, 6), lam(0xf0b020), 0.1, -0.03, -0.02, 0, 0, 0, h);
    for (const s of [-1, 1]) { const f = K.leg(s * 0.08, 0.14, 0, 0.14, 0.03, lam(0x202020), s > 0 ? 0 : Math.PI, lam(0x202020), 0.3); void f; K.part(new THREE.BoxGeometry(0.03, 0.35, 0.12), black, s * 0.2, 0.5, 0, 0, 0, s * 0.25); }
    return K.done(1.6);
  }
  if (/scorpion/.test(n)) return arthropod(color);
  if (/devil|lizard|turtle|frog/.test(n)) {
    const q = quad(color, { L: 1, H: 0.18, W: 0.3, leg: 0.12, legT: 0.03, neck: 0.08, tilt: 1.4, headL: 0.22, tail: 0.6 });
    if (/devil/.test(n)) for (let k = 0; k < 14; k++) q.K.part(new THREE.ConeGeometry(0.02, 0.08, 4), q.m, ((k * 37) % 7 - 3) * 0.04, q.y + 0.1, ((k * 53) % 9 - 4) * 0.07);
    q.K.eyes(q.head, 0.06, 0.02, -0.1, 0.015);
    return q.K.done(1.5);
  }
  if (/rat/.test(n)) {
    const q = quad(color, { L: 1, H: 0.3, W: 0.28, leg: 0.12, legT: 0.03, neck: 0.1, tilt: 1.2, headL: 0.3, tail: 0.9 });
    for (const s of [-1, 1]) q.K.part(new THREE.CircleGeometry(0.05, 8), PINK, s * 0.07, 0.08, 0, 0, 0, 0, q.head);
    return q.K.done(1.6);
  }
  const q = quad(color, {});
  q.K.eyes(q.head, 0.07, 0.03, -0.12, 0.015);
  return q.K.done();
}

/** a bird: a body, a head with a beak, two flapping wings, a tail */
function bird(color: number, span: number, bright: boolean): Beast {
  const K = new Kit(), m = lam(color);
  K.part(new THREE.CapsuleGeometry(0.12, 0.35, 6, 10), m, 0, 0, 0, Math.PI / 2, 0, 0);
  const h = new THREE.Group(); h.position.set(0, 0.06, -0.3); K.body.add(h); K.head = h;
  K.part(new THREE.SphereGeometry(0.09, 10, 8), m, 0, 0, 0, 0, 0, 0, h);
  K.part(new THREE.ConeGeometry(0.03, 0.12, 6), lam(bright ? 0xe8e0c8 : 0xd0a030), 0, -0.01, -0.12, -Math.PI / 2, 0, 0, h);
  K.eyes(h, 0.05, 0.03, -0.05, 0.012);
  for (const s of [-1, 1]) K.wing(s, span * 0.45, 0.28, bright ? lam(s > 0 ? 0x2050c0 : 0xe0c020) : m, new THREE.Vector3(s * 0.08, 0.04, -0.05));
  K.part(new THREE.BoxGeometry(0.12, 0.02, 0.22), bright ? lam(0x2050c0) : m, 0, 0.02, 0.28);
  return K.done(1);
}

/** a scorpion: eight legs, pincers, and the tail curled over its back */
function arthropod(color: number): Beast {
  const K = new Kit(), m = lam(color);
  K.part(new THREE.CapsuleGeometry(0.12, 0.35, 4, 8), m, 0, 0.14, 0, Math.PI / 2, 0, 0).scale.set(1.3, 1, 0.6);
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
    const g = K.leg(s * 0.12, 0.16, -0.12 + k * 0.09, 0.16, 0.012, m, (k + (s > 0 ? 0 : 1)) * Math.PI / 2, m, 0.4);
    g.rotation.z = s * 0.8;
  }
  for (const s of [-1, 1]) { K.part(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 5), m, s * 0.12, 0.15, -0.3, Math.PI / 2, s * 0.4, 0); K.part(new THREE.SphereGeometry(0.05, 8, 6), m, s * 0.17, 0.15, -0.4).scale.set(1, 0.6, 1.5); }
  const t = new THREE.Group(); t.position.set(0, 0.16, 0.22); K.body.add(t); K.tail = t;
  for (let k = 0; k < 6; k++) { const a = k * 0.5; K.part(new THREE.SphereGeometry(0.045 - k * 0.004, 8, 6), m, 0, Math.sin(a) * 0.22, (1 - Math.cos(a)) * -0.1 + k * 0.03, 0, 0, 0, t); }
  return K.done(2);
}

/**
 * a made-up world's animal: a body plan from its seed — how many legs, how
 * long, its neck, crests and spines, eyes on stalks, glowing spots, or wings
 * to glide on
 */
export function alienAnimal(seed: number, color: number, fly: boolean): Beast {
  let s = seed | 0;
  const r = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 10000) / 10000; };
  if (fly) {
    const b = bird(color, 1.5 + r() * 2, false);
    return b;
  }
  const K = new Kit(), m = lam(color), accent = lam(new THREE.Color(color).offsetHSL(0.5, 0, 0.1).getHex());
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(r(), 0.9, 0.6) });
  const pairs = r() < 0.4 ? 3 : r() < 0.15 ? 1 : 2, leg = 0.2 + r() * 0.9, L = 0.7 + r() * 0.6, H = 0.25 + r() * 0.3;
  const y = leg + H * 0.3;
  K.part(new THREE.CapsuleGeometry(H * 0.5, L * 0.5, 6, 12), m, 0, y, 0, Math.PI / 2, 0, 0).scale.set(0.8 + r() * 0.5, 1, 1);
  for (let k = 0; k < pairs; k++) for (const sd of [-1, 1]) {
    const z = pairs === 1 ? 0 : -L * 0.3 + (k / (pairs - 1)) * L * 0.6;
    const g = K.leg(sd * H * 0.35, y - H * 0.2, z, y - H * 0.2, 0.03 + r() * 0.03, m, (k + (sd > 0 ? 0 : 1)) * Math.PI, accent, 0.6);
    if (pairs === 1) g.position.z = 0.05;
  }
  const head = K.neckHead(new THREE.Vector3(0, y + H * 0.1, -L * 0.4), 0.05 + r() * 0.6, 0.3 + r() * 1.0, H * 0.25, 0.15 + r() * 0.2, H * 0.5, m);
  // eyes: plain, or on stalks; a crest; spines down its back; glowing spots
  if (r() < 0.4) for (const sd of [-1, 1]) { K.part(new THREE.CylinderGeometry(0.01, 0.01, 0.15, 4), m, sd * 0.05, 0.1, -0.05, 0, 0, sd * 0.4, head); K.part(new THREE.SphereGeometry(0.03, 8, 6), glow, sd * 0.08, 0.17, -0.05, 0, 0, 0, head); }
  else K.eyes(head, 0.05, 0.03, -0.12, 0.02, glow);
  if (r() < 0.5) K.part(new THREE.ConeGeometry(0.06, 0.25, 4), accent, 0, 0.12, 0.05, 0.6, 0, 0, head);
  if (r() < 0.5) for (let k = 0; k < 6; k++) K.part(new THREE.ConeGeometry(0.03, 0.12 + r() * 0.1, 4), accent, 0, y + H * 0.5, -L * 0.3 + k * L * 0.12);
  if (r() < 0.5) for (let k = 0; k < 8; k++) K.part(new THREE.SphereGeometry(0.025, 6, 4), glow, (r() - 0.5) * H, y + (r() - 0.2) * H * 0.5, (r() - 0.5) * L * 0.8);
  if (r() < 0.7) K.tailFrom(new THREE.Vector3(0, y, L * 0.45), 0.2 + r() * 0.6, 0.04, 0.6 + r() * 0.8, m, r() < 0.3 ? glow : undefined);
  return K.done(0.7 + r() * 0.8);
}
