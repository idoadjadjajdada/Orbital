import * as THREE from 'three';
import type { Body } from '../physics/body';
import { tintOf } from '../pixel/renderer';

/**
 * Inside the ship, in the ship's own frame (metres; forward is −z, up +y, the
 * floor at y = FLOOR). From the nose back:
 *
 *  - the bridge, with a wide window ahead and to the sides, the pilot's seat
 *    and a console whose screens show the drives and the target;
 *  - the commons: a round table with a live hologram of everything near the
 *    ship, viewports along one side, bunks and a galley along the other, a
 *    plant, and a telescope at the starboard window;
 *  - the engine room, round the warp core, which brightens and spins up with
 *    overdrive and turns violet while the wormhole drive charges;
 *  - the airlock, out to a spacewalk.
 *
 * Where there is no wall there is space: the windows are just gaps, so what
 * is outside is drawn through them.
 */

export const FLOOR = -1.4, CEIL = 1.6, EYE = FLOOR + 1.65;
const HW = 2.6, FRONT = -9, BACK = 15;
/** the two bulkheads, with doorways |x| < DOOR */
const BULK = [-3, 6.5], DOOR = 0.75;

export type StationId = 'helm' | 'map' | 'core' | 'lock' | 'scope' | 'galley';
export interface Station { id: StationId; x: number; z: number; r: number }

export const STATIONS: Station[] = [
  { id: 'helm', x: 0, z: -6.3, r: 1.7 },
  { id: 'map', x: 0, z: 1.2, r: 2.3 },
  { id: 'scope', x: 1.9, z: -1.6, r: 1.1 },
  { id: 'galley', x: 1.8, z: 4.4, r: 1.1 },
  { id: 'core', x: 0, z: 9.6, r: 2.1 },
  { id: 'lock', x: -1.8, z: 13.6, r: 1.5 },
];

/** where you can stand: inside the hull, through the doorways, round the furniture */
export function walk(p: THREE.Vector3, from: THREE.Vector3) {
  p.x = Math.max(-HW + 0.35, Math.min(HW - 0.35, p.x));
  p.z = Math.max(FRONT + 1.3, Math.min(BACK - 0.4, p.z));
  // the bulkheads stop you except at the doors
  for (const z of BULK) {
    if ((from.z - z) * (p.z - z) <= 0 && Math.abs(p.x) > DOOR - 0.3) p.z = from.z < z ? z - 0.3 : z + 0.3;
    if (Math.abs(p.z - z) < 0.3 && Math.abs(p.x) > DOOR - 0.3) p.z = from.z < z ? z - 0.3 : z + 0.3;
  }
  // round things: the console, seat, table, core
  for (const [x, z, r] of [[0, -8.2, 1.4], [0, -6.3, 0.55], [0, 1.2, 1.35], [0, 9.6, 0.95]] as const) {
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
    if (d < r) { const k = r / (d || 1); p.x = x + dx * k; p.z = z + dz * k; }
  }
  // the bunks along the port wall
  if (p.z > 2 && p.z < 5.6 && p.x < -1.3) p.x = -1.3;
  // the galley counter along starboard
  if (p.z > 3.6 && p.z < 5.6 && p.x > 1.5) p.x = 1.5;
}

export class Interior {
  readonly group = new THREE.Group();
  private holo: THREE.Points;
  private holoSel: THREE.Mesh;
  private holoRing: THREE.Mesh;
  private core: THREE.Mesh;
  private coreRings: THREE.Mesh[] = [];
  private coreLight: THREE.PointLight;
  private screen: { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; last: number };
  private steam: THREE.Points;

  constructor() {
    const g = this.group;
    g.visible = false;
    const M = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const wall = M(0x3a4152), trim = M(0x262b38), floorM = new THREE.MeshLambertMaterial({ map: floorTexture() }), metal = M(0x8a93a6);
    const glowB = new THREE.MeshBasicMaterial({ color: 0x9fd8ff }), glowW = new THREE.MeshBasicMaterial({ color: 0xfff2d6 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      g.add(b);
      return b;
    };
    const H = CEIL - FLOOR, ym = (FLOOR + CEIL) / 2;

    // floor, ceiling and its light strips
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, BACK - FRONT), floorM);
    fl.rotation.x = -Math.PI / 2;
    fl.position.set(0, FLOOR, (FRONT + BACK) / 2);
    g.add(fl);
    box(2 * HW, 0.1, BACK - FRONT - 3, 0, CEIL, (FRONT + 3 + BACK) / 2, trim);
    for (const z of [-1, 3, 8.5, 12]) box(0.25, 0.04, 2.6, 0, CEIL - 0.06, z, glowW);
    // the bridge ceiling is a skylight: only ribs
    for (const z of [FRONT + 0.2, FRONT + 1.5, FRONT + 2.8]) box(2 * HW, 0.12, 0.18, 0, CEIL, z, trim);

    // walls: solid aft of the bridge, with viewports to starboard in the commons
    const sideWall = (x: number, z0: number, z1: number) => box(0.12, H, z1 - z0, x, ym, (z0 + z1) / 2, wall);
    // bridge: a low sill and ribs, open above it (the side windows)
    for (const s of [-1, 1]) {
      box(0.12, 0.8, -3 - FRONT, s * HW, FLOOR + 0.4, (FRONT - 3) / 2, wall);
      for (const z of [FRONT + 0.1, -6, -3.1]) box(0.14, H, 0.2, s * HW, ym, z, trim);
    }
    // the front window: a sill and two pillars
    box(2 * HW, 0.9, 0.12, 0, FLOOR + 0.45, FRONT, wall);
    for (const x of [-HW + 0.1, -0.9, 0.9, HW - 0.1]) box(0.14, H, 0.14, x, ym, FRONT, trim);
    // port side, commons to stern: solid
    sideWall(-HW, -3, BACK);
    // starboard: viewports between z −2.5 and 3.2, then solid
    box(0.12, 0.9, 5.7, HW, FLOOR + 0.45, 0.35, wall);
    box(0.12, 0.5, 5.7, HW, CEIL - 0.25, 0.35, wall);
    for (const z of [-2.6, -0.7, 1.2, 3.1]) box(0.14, H, 0.2, HW, ym, z, trim);
    sideWall(HW, 3.2, BACK);
    sideWall(HW, -3, -2.5);
    // stern wall
    box(2 * HW, H, 0.12, 0, ym, BACK, wall);
    // bulkheads with doorways
    for (const z of BULK) {
      for (const s of [-1, 1]) box(HW - DOOR, H, 0.15, s * (HW + DOOR) / 2, ym, z, wall);
      box(2 * DOOR, H - 2.2, 0.15, 0, CEIL - (H - 2.2) / 2, z, wall);
      for (const s of [-1, 1]) box(0.08, 2.2, 0.2, s * DOOR, FLOOR + 1.1, z, glowB);
    }

    // ---- bridge: console, screens, the seat
    const con = box(3.6, 0.9, 1.1, 0, FLOOR + 0.45, -8.2, trim);
    con.rotation.x = -0.25;
    this.screen = { cv: document.createElement('canvas'), tex: null!, last: 0 };
    this.screen.cv.width = 192; this.screen.cv.height = 64;
    this.screen.tex = new THREE.CanvasTexture(this.screen.cv);
    this.screen.tex.magFilter = THREE.NearestFilter;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.8), new THREE.MeshBasicMaterial({ map: this.screen.tex }));
    scr.position.set(0, FLOOR + 1.05, -8.45);
    scr.rotation.x = -0.35;
    g.add(scr);
    for (const s of [-1, 1]) {
      const side = box(0.9, 1.0, 1.6, s * 1.9, FLOOR + 0.5, -6.8, trim);
      side.rotation.y = s * 0.3;
      box(0.6, 0.05, 0.9, s * 1.9, FLOOR + 1.03, -6.8, new THREE.MeshBasicMaterial({ color: s > 0 ? 0x6fff9a : 0xffb05a }));
    }
    const seatM = M(0xb3462e);
    box(0.8, 0.15, 0.8, 0, FLOOR + 0.55, -6.3, seatM);
    box(0.8, 1.0, 0.15, 0, FLOOR + 1.05, -5.9, seatM);
    box(0.15, 0.55, 0.15, 0, FLOOR + 0.27, -6.3, metal);

    // ---- commons: the holo table
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.9, 12), trim);
    table.position.set(0, FLOOR + 0.45, 1.2);
    g.add(table);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.04, 24), new THREE.MeshBasicMaterial({ color: 0x1d6a8a }));
    top.position.set(0, FLOOR + 0.92, 1.2);
    g.add(top);
    this.holo = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.holo.position.set(0, FLOOR + 1.5, 1.2);
    this.holo.frustumCulled = false;
    g.add(this.holo);
    this.holoRing = new THREE.Mesh(new THREE.RingGeometry(0.88, 0.92, 32), new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    this.holoRing.rotation.x = -Math.PI / 2;
    this.holoRing.position.set(0, FLOOR + 1.5, 1.2);
    g.add(this.holoRing);
    this.holoSel = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.07, 12), new THREE.MeshBasicMaterial({ color: 0xffe070, side: THREE.DoubleSide }));
    this.holoSel.visible = false;
    g.add(this.holoSel);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.95, 1.1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x3fb0ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.set(0, FLOOR + 1.5, 1.2);
    g.add(beam);

    // the telescope at the starboard viewport
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.3, 8), metal);
    scope.position.set(2.0, FLOOR + 1.35, -1.6);
    scope.rotation.z = Math.PI / 2 - 0.3;
    g.add(scope);
    box(0.12, 1.0, 0.12, 1.95, FLOOR + 0.5, -1.6, trim);

    // bunks (port) and galley (starboard)
    for (const y of [FLOOR + 0.45, FLOOR + 1.45]) {
      box(1.2, 0.25, 3.4, -HW + 0.7, y, 3.8, trim);
      box(1.1, 0.12, 3.2, -HW + 0.7, y + 0.18, 3.8, M(0x5b6f9a));
      box(0.5, 0.12, 0.5, -HW + 0.7, y + 0.28, 2.5, M(0xe8e4d8));
    }
    box(1.0, 1.0, 2.0, HW - 0.5, FLOOR + 0.5, 4.6, trim);
    box(0.25, 0.3, 0.25, HW - 0.5, FLOOR + 1.15, 4.1, M(0xd0d4dc));
    const mugM = M(0xd8643a);
    box(0.12, 0.15, 0.12, HW - 0.6, FLOOR + 1.08, 4.9, mugM);
    // a plant by the bulkhead
    box(0.4, 0.45, 0.4, -HW + 0.4, FLOOR + 0.22, -2.4, M(0x7a5236));
    for (let k = 0; k < 6; k++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.7, 4), M(k % 2 ? 0x4c9a4a : 0x6fbf5a));
      leaf.position.set(-HW + 0.4 + Math.cos(k) * 0.1, FLOOR + 0.75, -2.4 + Math.sin(k) * 0.1);
      leaf.rotation.set(Math.cos(k * 2) * 0.5, 0, Math.sin(k * 2) * 0.5);
      g.add(leaf);
    }

    // ---- engine room: the warp core
    this.core = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, CEIL - FLOOR, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.85 }));
    this.core.position.set(0, ym, 9.6);
    g.add(this.core);
    for (let k = 0; k < 4; k++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.06, 6, 20), metal);
      r.rotation.x = Math.PI / 2;
      r.position.set(0, FLOOR + 0.5 + k * 0.7, 9.6);
      g.add(r);
      this.coreRings.push(r);
    }
    box(1.6, 0.3, 1.6, 0, FLOOR + 0.15, 9.6, trim);
    box(1.6, 0.3, 1.6, 0, CEIL - 0.15, 9.6, trim);
    // pipes along the ceiling to the engines
    for (const x of [-1.6, 1.6]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), M(0x9a6a3a));
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x, CEIL - 0.35, 10.5);
      g.add(pipe);
    }
    this.coreLight = new THREE.PointLight(0x7fc8ff, 6, 9, 1.5);
    this.coreLight.position.set(0, ym, 9.6);
    g.add(this.coreLight);
    // a little vapour round the core
    const n = 60, sp = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { const a = Math.random() * 6.28, r = 0.5 + Math.random() * 0.4; sp[k * 3] = Math.cos(a) * r; sp[k * 3 + 1] = FLOOR + Math.random() * (CEIL - FLOOR); sp[k * 3 + 2] = 9.6 + Math.sin(a) * r; }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.steam = new THREE.Points(sg, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, color: 0xbfe6ff, transparent: true, opacity: 0.5, depthWrite: false }));
    g.add(this.steam);

    // ---- airlock: a door in the port wall, framed in green
    box(0.1, 2.2, 1.4, -HW + 0.08, FLOOR + 1.1, 13.6, M(0x59606e));
    for (const z of [12.85, 14.35]) box(0.12, 2.3, 0.08, -HW + 0.1, FLOOR + 1.15, z, new THREE.MeshBasicMaterial({ color: 0x5fffa0 }));
    box(0.12, 0.08, 1.58, -HW + 0.1, FLOOR + 2.3, 13.6, new THREE.MeshBasicMaterial({ color: 0x5fffa0 }));
    // suits on the stern wall
    for (const x of [0.6, 1.5]) {
      box(0.55, 1.2, 0.3, x, FLOOR + 1.2, BACK - 0.3, M(0xe8e4d8));
      box(0.4, 0.4, 0.35, x, FLOOR + 2.0, BACK - 0.3, new THREE.MeshBasicMaterial({ color: 0xd8a040 }));
    }

    // lights
    const amb = new THREE.PointLight(0xfff2d6, 5, 14, 1.2);
    amb.position.set(0, CEIL - 0.3, 1);
    g.add(amb);
    const bridge = new THREE.PointLight(0x9fd8ff, 3, 8, 1.4);
    bridge.position.set(0, CEIL - 0.4, -6.5);
    g.add(bridge);
  }

  /**
   * animate: the core with the drives (`warp` 0–1, `jumping` while the
   * wormhole drive works), the hologram (bodies round the ship, `q` its
   * orientation so the hologram turns with it, `P` where it is), and the
   * console screens (`lines` of text)
   */
  update(dt: number, warp: number, jumping: boolean, bodies: Body[], P: [number, number, number], q: THREE.Quaternion, sel: Body | null, lines: string[]) {
    const t = performance.now() / 1000;
    const col = jumping ? 0xc890ff : warp > 0.05 ? 0xeaf2ff : 0x7fc8ff;
    (this.core.material as THREE.MeshBasicMaterial).color.setHex(col);
    (this.core.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * (3 + 20 * warp)));
    this.coreLight.color.setHex(col);
    this.coreLight.intensity = 4 + 10 * warp;
    for (let k = 0; k < this.coreRings.length; k++) {
      this.coreRings[k].rotation.z += dt * (0.5 + 8 * warp) * (k % 2 ? 1 : -1);
      this.coreRings[k].position.y = FLOOR + 0.5 + k * 0.7 + Math.sin(t * (1 + 6 * warp) + k) * 0.06 * (1 + 3 * warp);
    }
    const sp = this.steam.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = sp.array as Float32Array;
    for (let k = 0; k < a.length; k += 3) { a[k + 1] += dt * (0.3 + 2 * warp); if (a[k + 1] > CEIL) a[k + 1] = FLOOR; }
    sp.needsUpdate = true;

    this.holoRing.rotation.z += dt * 0.3;
    this.drawHolo(bodies, P, q, sel);
    if (t - this.screen.last > 0.25) { this.screen.last = t; this.drawScreen(lines); }
  }

  /** the hologram: things round the ship, flattened onto a log scale so near moons and far stars both fit the table */
  private drawHolo(bodies: Body[], P: [number, number, number], q: THREE.Quaternion, sel: Body | null) {
    const inv = q.clone().invert();
    const items: { b: Body; v: THREE.Vector3; d: number }[] = [];
    for (const b of bodies) {
      if (!b.source && !b.look.craft) continue;
      const v = new THREE.Vector3(b.x - P[0], b.y - P[1], b.z - P[2]).applyQuaternion(inv);
      const d = v.length();
      if (d > 0) items.push({ b, v, d });
    }
    items.sort((x, y) => x.d - y.d);
    const near = items.slice(0, 60);
    const dmin = Math.max(1e-9, (near[0]?.d ?? 1) / 3), dmax = Math.max(dmin * 10, near[near.length - 1]?.d ?? 1);
    const R = 0.85, L = Math.log(dmax / dmin);
    const pos: number[] = [0, 0, 0], col: number[] = [1, 0.9, 0.4];
    this.holoSel.visible = false;
    for (const it of near) {
      const r = (R * Math.max(0, Math.log(it.d / dmin))) / L;
      const x = (it.v.x / it.d) * r, y = (it.v.y / it.d) * r * 0.6, z = (it.v.z / it.d) * r;
      pos.push(x, y, z);
      const c = tintOf(it.b);
      col.push(c[0], c[1], c[2]);
      if (it.b === sel) {
        this.holoSel.visible = true;
        this.holoSel.position.set(x, this.holo.position.y + y, this.holo.position.z + z);
        this.holoSel.lookAt(this.holoSel.position.clone().add(new THREE.Vector3(0, 1, 0)));
      }
    }
    const g = this.holo.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }

  private drawScreen(lines: string[]) {
    const { cv, tex } = this.screen;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#071820';
    c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#5fd0ff';
    c.font = '10px monospace';
    lines.slice(0, 5).forEach((l, i) => c.fillText(l, 6, 13 + i * 12));
    tex.needsUpdate = true;
  }
}

function floorTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#4a5060'; c.fillRect(0, 0, 32, 32);
  c.fillStyle = '#3c4150'; c.fillRect(0, 0, 32, 2); c.fillRect(0, 0, 2, 32);
  c.fillStyle = '#565d6e'; c.fillRect(6, 6, 2, 2); c.fillRect(22, 22, 2, 2);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 24);
  return t;
}
