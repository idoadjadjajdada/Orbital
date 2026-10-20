import * as THREE from 'three';

/**
 * The Earth's great ancient monuments, where they are and as big as they are (sites.ts has their places):
 * the pyramids of Giza and the Sphinx, Stonehenge as it stands now, El Castillo at Chichén Itzá, and the
 * fifteen moai of Ahu Tongariki. Each is built in its own frame, metres: x east, y up, z south, its
 * middle at the origin, so whatever stands it on the ground lines it up with the compass.
 */

const mats = new Map<number, THREE.MeshLambertMaterial>();
const mat = (c: number) => { let m = mats.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c, flatShading: true }); mats.set(c, m); } return m; };
/** a box, w east–west, h tall, d north–south, its foot at (x, y, z) */
function box(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, c: number, turn = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, y + h / 2, z);
  m.rotation.y = turn;
  g.add(m);
  return m;
}
/** a square pyramid, its sides facing the four points of the compass */
function pyramid(g: THREE.Group, base: number, h: number, x: number, z: number, c: number) {
  const geo = new THREE.ConeGeometry(base / Math.SQRT2, h, 4, 1).rotateY(Math.PI / 4).translate(0, h / 2, 0);
  const m = new THREE.Mesh(geo, mat(c));
  m.position.set(x, 0, z);
  g.add(m);
}
/** metres east and south of a point, from a latitude and longitude difference (degrees) */
const offset = (lat0: number, dLat: number, dLon: number): [number, number] => [dLon * 111320 * Math.cos(lat0 * Math.PI / 180), -dLat * 110574];

const LIMESTONE = 0xc8b48a, CASING = 0xdccaa2, SARSEN = 0x8f897c, BLUESTONE = 0x6f7478, TUFF = 0x5e5650, SCORIA = 0x8a4a34;

/** Khufu's pyramid at the origin, Khafre's and Menkaure's to the south-west, the Sphinx below them facing the sunrise */
function giza() {
  const g = new THREE.Group(), lat = 29.9792;
  pyramid(g, 230.3, 138.5, 0, 0, LIMESTONE);
  const [kx, kz] = offset(lat, 29.9761 - lat, 31.1308 - 31.1342);
  pyramid(g, 215.3, 136.4, kx, kz, LIMESTONE);
  // (Khafre's still has a cap of its smooth white casing)
  const cap = new THREE.Mesh(new THREE.ConeGeometry(215.3 / Math.SQRT2 * 0.16, 136.4 * 0.16, 4, 1).rotateY(Math.PI / 4).translate(0, 136.4 * 0.92, 0), mat(CASING));
  cap.position.set(kx, 0.2, kz);
  g.add(cap);
  const [mx, mz] = offset(lat, 29.9725 - lat, 31.1281 - 31.1342);
  pyramid(g, 103.4, 61, mx, mz, LIMESTONE);
  // the three queens' pyramids south of Menkaure's
  for (let k = 0; k < 3; k++) pyramid(g, 32 + (k === 0 ? 12 : 0), 21 + (k === 0 ? 7 : 0), mx - 50 + k * 48, mz + 120, LIMESTONE);
  const [sx, sz] = offset(lat, 29.9753 - lat, 31.1376 - 31.1342);
  // the Sphinx: a lion's body 73 m long, its head 20 m up, looking due east
  box(g, 50, 10, 13, sx - 6, 0, sz, LIMESTONE);
  box(g, 14, 7, 6, sx + 23, 0, sz - 4, LIMESTONE);
  box(g, 14, 7, 6, sx + 23, 0, sz + 4, LIMESTONE);
  box(g, 10, 20, 9, sx + 14, 0, sz, LIMESTONE);
  box(g, 6, 7, 10, sx + 15, 13, sz, LIMESTONE);
  return g;
}

/** Stonehenge as it stands: the sarsen circle with its gaps and fallen stones, the trilithons, the bluestones, the earthwork, the Heel Stone */
function stonehenge() {
  const g = new THREE.Group();
  // (its axis points at the midsummer sunrise, 50° east of north)
  const axis = 50 * Math.PI / 180;
  const standing = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1];
  const R = 15.3;
  for (let k = 0; k < 30; k++) {
    const a = axis + (k / 30) * Math.PI * 2;
    const x = Math.sin(a) * R, z = -Math.cos(a) * R;
    if (standing[k]) box(g, 2.1, 4.1, 1.1, x, 0, z, SARSEN, -a);
    else if (k % 3 === 0) { const m = box(g, 2.1, 1.1, 4.1, x * 1.08, -0.3, z * 1.08, SARSEN, -a); m.rotation.x = 0.1; }
    // the lintels, where both uprights under one still stand
    if (standing[k] && standing[(k + 1) % 30]) {
      const a2 = axis + ((k + 0.5) / 30) * Math.PI * 2;
      box(g, 3.4, 0.8, 1.0, Math.sin(a2) * R, 4.1, -Math.cos(a2) * R, SARSEN, -a2);
    }
  }
  // the five trilithons in a horseshoe opening to the north-east, tallest at its closed end
  const tri: [number, number, boolean][] = [[-0.9, 6, true], [-0.45, 6.5, true], [Math.PI, 7.3, false], [0.45, 6.5, false], [0.9, 6, true]];
  for (const [o, h, lintel] of tri) {
    const a = axis + Math.PI + o * 1.25, r = o === Math.PI ? 0 : 9;
    const cx = Math.sin(a) * r + (o === Math.PI ? -Math.sin(axis) * 9.5 : 0), cz = -Math.cos(a) * r + (o === Math.PI ? Math.cos(axis) * 9.5 : 0);
    const t = Math.atan2(-cz, cx) + Math.PI / 2;
    for (const s of [-1, 1]) box(g, 2.2, h, 1.2, cx + Math.cos(-t) * s * 1.6, 0, cz + Math.sin(-t) * s * 1.6, SARSEN, t);
    if (lintel) box(g, 5.2, 1, 1.1, cx, h, cz, SARSEN, t);
  }
  // the bluestones, smaller, in a ring inside the sarsens
  for (let k = 0; k < 22; k++) {
    if (k % 4 === 3) continue;
    const a = axis + (k / 22) * Math.PI * 2;
    box(g, 0.9, 1.8 + (k % 3) * 0.3, 0.6, Math.sin(a) * 11.8, 0, -Math.cos(a) * 11.8, BLUESTONE, -a);
  }
  // the bank and ditch round it, 110 m across, worn down to a low ring; the Heel Stone out on the avenue
  const bank = new THREE.Mesh(new THREE.TorusGeometry(54, 2.4, 4, 72).rotateX(Math.PI / 2).scale(1, 0.15, 1), mat(0x4a5a30));
  g.add(bank);
  const heel = box(g, 2.4, 4.7, 2.0, Math.sin(axis) * 77, 0, -Math.cos(axis) * 77, SARSEN);
  heel.rotation.z = 0.12;
  return g;
}

/** El Castillo: nine stepped terraces 55 m across, a stair up each side, the temple of Kukulcán on top */
function castillo() {
  const g = new THREE.Group(), base = 55.3, top = 19.5, tiers = 9, H = 24;
  for (let k = 0; k < tiers; k++) {
    const w = base - (base - top) * (k / tiers), h = H / tiers;
    box(g, w, h * 0.92, w, 0, k * h, 0, 0xb5a78c);
    box(g, w - 1.2, h * 0.08, w - 1.2, 0, k * h + h * 0.92, 0, 0x9e9078);
  }
  box(g, 13, 6, 13, 0, H, 0, 0xa69a80);
  box(g, 15, 0.8, 15, 0, H + 6, 0, 0x9e9078);
  // the four stairs, 91 steps each, straight up the middle of each face
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2, len = Math.hypot((base - top) / 2, H);
    const stair = new THREE.Mesh(new THREE.BoxGeometry(8.8, 1.2, len), mat(0xc4b79c));
    const mid = (base + top) / 4;
    stair.position.set(Math.sin(a) * mid, H / 2, -Math.cos(a) * mid);
    stair.rotation.order = 'YXZ';
    stair.rotation.y = -a;
    stair.rotation.x = Math.atan2(H, (base - top) / 2);
    g.add(stair);
  }
  return g;
}

/** Ahu Tongariki: fifteen moai on a 100 m platform by the sea, their backs to it, looking inland (north-west) */
function tongariki() {
  const g = new THREE.Group();
  const face = -0.75; // (the platform runs south-west to north-east; the figures face the island, away from the sea)
  const along = new THREE.Vector2(Math.cos(face + Math.PI / 2), Math.sin(face + Math.PI / 2));
  box(g, 100, 1.6, 7, 0, 0, 0, 0x6a625a, face);
  const heights = [5.6, 6.2, 7.1, 5.9, 8.7, 6.5, 6.8, 7.4, 6.1, 5.8, 7.0, 6.3, 6.9, 5.5, 6.0];
  heights.forEach((H, k) => {
    const t = (k - 7) * 6.4, x = along.x * t, z = -along.y * t;
    const m = new THREE.Group();
    // the torso, the long head with its heavy brow and nose, the hands along the belly
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, H * 0.52, 1.5), mat(TUFF));
    body.position.y = H * 0.26;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.8, H * 0.48, 1.7), mat(TUFF));
    head.position.set(0, H * 0.76, 0.1);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(1.9, H * 0.08, 0.4), mat(TUFF));
    brow.position.set(0, H * 0.86, -0.85);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.45, H * 0.2, 0.5), mat(TUFF));
    nose.position.set(0, H * 0.73, -0.95);
    m.add(body, head, brow, nose);
    // one of them wears its red scoria topknot
    if (k === 6) { const p = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 1.6, 10), mat(SCORIA)); p.position.y = H + 0.8; m.add(p); }
    m.position.set(x, 1.6, z);
    m.rotation.y = face;
    g.add(m);
  });
  return g;
}

const BUILD: Record<string, () => THREE.Group> = {
  'The pyramids of Giza': giza, Stonehenge: stonehenge, 'Chichén Itzá · El Castillo': castillo, 'Ahu Tongariki': tongariki,
};

/** a monument's model by its site's name, or null */
export const landmarkModel = (name: string) => BUILD[name]?.() ?? null;

/** how far round a monument its ground is kept open (no trees), m */
export const landmarkReach = (name: string) => (name === 'The pyramids of Giza' ? 900 : 150);
