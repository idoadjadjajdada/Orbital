import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M } from '../physics/units';
import { hash } from '../pixel/noise';
import type { View3D } from './view3d';
import { frameOf, toWorld, quatOf } from './ground';
import { tangent, dirOf, latLon, type V3 } from './terrain';
import { speciesAt, type Species, type Form } from './life';
import { sitesOn, type Site } from './sites';
import { siteMesh } from './craftmesh';

/**
 * What stands on the ground round you: the plants of a living world, its
 * animals wandering about, a city's buildings, and the craft people have
 * left on the Moon and Mars, each where it really is. Plants and buildings
 * are laid out on cells fixed to the world, so the same tree is always in
 * the same place; only those within a few hundred metres are drawn.
 */

const CELL = 9;           // m: one plant (at most) per cell, per draw
const REACH = 230;        // m: plants this far round you
const CITY_CELL = 45, CITY_REACH = 1600;

type PlantShape = 'tree' | 'conifer' | 'palm' | 'shrub' | 'grass' | 'fungus' | 'frond' | 'crystalline' | 'mat' | 'mound';
const PLANTS: PlantShape[] = ['tree', 'conifer', 'palm', 'shrub', 'grass', 'fungus', 'frond', 'crystalline', 'mat', 'mound'];

/** a plant shape as two parts — a stem and a crown — each a unit shape scaled by the plant's height */
function plantParts(s: PlantShape): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const stem = (r: number, h: number) => new THREE.CylinderGeometry(r * 0.7, r, h, 6).translate(0, h / 2, 0);
  switch (s) {
    case 'tree': return [stem(0.04, 0.5), new THREE.IcosahedronGeometry(0.32, 1).scale(1, 0.85, 1).translate(0, 0.68, 0)];
    case 'conifer': return [stem(0.035, 0.3), new THREE.ConeGeometry(0.22, 0.85, 8).translate(0, 0.58, 0)];
    case 'palm': return [stem(0.03, 0.85), new THREE.ConeGeometry(0.4, 0.12, 7).rotateX(Math.PI).translate(0, 0.9, 0)];
    case 'shrub': return [stem(0.03, 0.15), new THREE.IcosahedronGeometry(0.45, 1).scale(1, 0.7, 1).translate(0, 0.42, 0)];
    case 'grass': return [new THREE.ConeGeometry(0.12, 1, 4).translate(0.1, 0.5, 0), new THREE.ConeGeometry(0.12, 0.9, 4).translate(-0.1, 0.45, 0.06)];
    case 'fungus': return [stem(0.09, 0.7), new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.66, 0)];
    case 'frond': return [new THREE.ConeGeometry(0.08, 1, 5).translate(0, 0.5, 0), new THREE.ConeGeometry(0.2, 0.5, 5).rotateX(Math.PI).translate(0, 0.95, 0)];
    case 'crystalline': return [new THREE.OctahedronGeometry(0.25).scale(0.6, 2, 0.6).translate(0, 0.5, 0), new THREE.OctahedronGeometry(0.15).scale(0.5, 1.6, 0.5).translate(0.22, 0.3, 0.1)];
    case 'mat': return [new THREE.CylinderGeometry(1.4, 1.5, 0.04, 9).translate(0, 0.02, 0), new THREE.CylinderGeometry(0.7, 0.8, 0.06, 7).translate(0.4, 0.05, 0.3)];
    case 'mound': return [new THREE.ConeGeometry(0.45, 1, 7).translate(0, 0.5, 0), new THREE.ConeGeometry(0.25, 0.6, 6).translate(0.3, 0.3, 0.1)];
  }
}

/** an animal of a given form, about a metre tall, facing −z */
function animal(f: Form): THREE.Group {
  const g = new THREE.Group();
  const m1 = new THREE.MeshLambertMaterial({ color: f.color, flatShading: true }), m2 = new THREE.MeshLambertMaterial({ color: f.color2, flatShading: true });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  switch (f.shape) {
    case 'walker':
      add(new THREE.BoxGeometry(0.35, 0.5, 0.25), m1, 0, 0.75, 0);
      add(new THREE.SphereGeometry(0.13, 8, 6), m2, 0, 1.12, -0.03);
      for (const s of [-1, 1]) { const l = add(new THREE.BoxGeometry(0.1, 0.5, 0.1), m1, s * 0.1, 0.25, 0); l.name = 'leg'; }
      break;
    case 'flyer':
      add(new THREE.SphereGeometry(0.15, 8, 6).scale(1, 0.8, 1.8), m1, 0, 0, 0);
      for (const s of [-1, 1]) { const w = add(new THREE.BoxGeometry(0.6, 0.02, 0.25), m2, s * 0.35, 0.02, 0); w.name = s > 0 ? 'wingR' : 'wingL'; }
      break;
    case 'crawler':
      for (let k = 0; k < 4; k++) add(new THREE.SphereGeometry(0.16 - k * 0.02, 8, 6), k % 2 ? m2 : m1, 0, 0.12, k * 0.22 - 0.3);
      break;
    default: // a grazer: a body on four legs, a head down at the grass
      add(new THREE.BoxGeometry(0.45, 0.4, 0.95), m1, 0, 0.75, 0);
      add(new THREE.BoxGeometry(0.22, 0.25, 0.35), m2, 0, 0.75, -0.6).rotation.x = 0.5;
      for (const [x, z] of [[-0.15, -0.35], [0.15, -0.35], [-0.15, 0.35], [0.15, 0.35]]) { const l = add(new THREE.BoxGeometry(0.09, 0.55, 0.09), m2, x, 0.28, z); l.name = 'leg'; }
  }
  g.traverse(o => { o.frustumCulled = false; });
  return g;
}

interface Beast { sp: Species; n: V3; heading: number; mesh: THREE.Group; t: number; flyH: number }

export class Life3D {
  readonly group = new THREE.Group();
  private plants = new Map<PlantShape, [THREE.InstancedMesh, THREE.InstancedMesh]>();
  private buildings: THREE.InstancedMesh;
  private windows: THREE.InstancedMesh;
  private beasts: Beast[] = [];
  private sites = new Map<string, THREE.Group>();
  /** the point everything is laid out round (body frame) and the world */
  private anchor: V3 = [0, 0, 1];
  private body: Body | null = null;
  private builtAt: V3 | null = null;

  constructor(private v: View3D) {
    v.scene.add(this.group);
    this.group.frustumCulled = false;
    const cap = 2600;
    for (const s of PLANTS) {
      const [a, b] = plantParts(s);
      const ma = new THREE.MeshLambertMaterial({ flatShading: true }), mb = new THREE.MeshLambertMaterial({ flatShading: true });
      const ia = new THREE.InstancedMesh(a, ma, cap), ib = new THREE.InstancedMesh(b, mb, cap);
      for (const i of [ia, ib]) { i.count = 0; i.frustumCulled = false; i.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); this.group.add(i); }
      this.plants.set(s, [ia, ib]);
    }
    this.buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 2500);
    this.buildings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2500 * 3), 3);
    this.windows = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 1, 1.02).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0, depthWrite: false }), 2500);
    for (const i of [this.buildings, this.windows]) { i.count = 0; i.frustumCulled = false; this.group.add(i); }
  }

  /** each frame: lay things out round the viewer if they have moved, then place them all */
  update(P: V3, dt: number, night: number) {
    const L = this.v.landing, b = L.ground.ready ? L.ground.body : null;
    const near = b && L.agl < 3000;
    this.group.visible = !!near;
    if (!b || !near) { this.body = null; this.builtAt = null; return; }
    const n = L.n;
    if (b !== this.body || !this.builtAt || Math.acos(Math.min(1, n[0] * this.builtAt[0] + n[1] * this.builtAt[1] + n[2] * this.builtAt[2])) * b.r * AU_M > 40) {
      this.body = b;
      this.builtAt = [...n] as V3;
      this.anchor = [...n] as V3;
      this.layout(b);
    }
    // the layout is fixed to the world: the group sits at its anchor and turns with it
    const R = b.r * AU_M, f = frameOf(b);
    const gh = L.groundH(b, this.anchor);
    const w = toWorld(f, [this.anchor[0] * (R + gh), this.anchor[1] * (R + gh), this.anchor[2] * (R + gh)]);
    this.group.position.set((b.x - P[0]) * AU_M + w[0], (b.y - P[1]) * AU_M + w[1], (b.z - P[2]) * AU_M + w[2]);
    this.group.quaternion.copy(quatOf(f));
    (this.windows.material as THREE.MeshBasicMaterial).opacity = night * 0.85;
    this.animate(b, dt);
  }

  /** a point (body frame) as an offset from the anchor, in metres, standing on the ground */
  private local(b: Body, n: V3, up = 0): THREE.Vector3 {
    const R = b.r * AU_M, L = this.v.landing;
    const gh = L.groundH(b, n), ga = L.groundH(b, this.anchor);
    const r = R + gh + up, ra = R + ga;
    return new THREE.Vector3(n[0] * r - this.anchor[0] * ra, n[1] * r - this.anchor[1] * ra, n[2] * r - this.anchor[2] * ra);
  }

  /** an upright orientation at `n` (body frame), turned by `yaw` */
  private upright(n: V3, yaw: number) {
    const [e, nn] = tangent(n);
    const fwd = new THREE.Vector3(nn[0] * Math.cos(yaw) + e[0] * Math.sin(yaw), nn[1] * Math.cos(yaw) + e[1] * Math.sin(yaw), nn[2] * Math.cos(yaw) + e[2] * Math.sin(yaw));
    const up = new THREE.Vector3(...n), z = fwd.clone().negate(), x = new THREE.Vector3().crossVectors(up, z);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
  }

  private layout(b: Body) {
    const v = this.v, sc = v.science, R = b.r * AU_M;
    const bio = sc.biosphere(b);
    const flora = bio.species.filter(s => s.kind !== 'microbe' && !s.form.moves && PLANTS.includes(s.form.shape as PlantShape));
    const counts = new Map<PlantShape, number>(PLANTS.map(s => [s, 0]));
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const [e, nn] = tangent(this.anchor);
    const step = CELL / R;
    const half = Math.ceil(REACH / CELL);
    // cells on a grid fixed to the world: rounded latitude and longitude
    const [la0, lo0] = latLon(this.anchor);
    const dLat = CELL / R * 180 / Math.PI, dLon = dLat / Math.max(0.05, Math.cos(la0 * Math.PI / 180));
    const i0 = Math.round(la0 / dLat), j0 = Math.round(lo0 / dLon);
    void e; void nn; void step;
    if (flora.length) for (let i = -half; i <= half; i++) for (let j = -half; j <= half; j++) {
      const la = (i0 + i) * dLat, lo = (j0 + j) * dLon;
      const r0 = hash(i0 + i, j0 + j, 911);
      // a scatter within the cell
      const n = dirOf(la + (hash(i0 + i, j0 + j, 3) - 0.5) * dLat, lo + (hash(i0 + i, j0 + j, 4) - 0.5) * dLon);
      const d = Math.acos(Math.min(1, n[0] * this.anchor[0] + n[1] * this.anchor[1] + n[2] * this.anchor[2])) * R;
      if (d > REACH) continue;
      const gh = v.landing.groundH(b, n);
      if (v.landing.ground.src?.seas && gh <= 0.01) continue;
      const biome = sc.biome(b, n, gh);
      const sp = speciesAt(bio, biome, hash(i0 + i, j0 + j, 77));
      if (!sp || sp.kind === 'microbe' || sp.form.moves) continue;
      // how likely a plant is in a cell, from how many grow to the hectare
      if (r0 > Math.min(0.9, sp.form.density * CELL * CELL / 10000)) continue;
      const shape = (PLANTS.includes(sp.form.shape as PlantShape) ? sp.form.shape : 'shrub') as PlantShape;
      const k = counts.get(shape)!;
      const [ia, ib] = this.plants.get(shape)!;
      if (k >= ia.instanceMatrix.count) continue;
      const h = Math.max(0.15, sp.form.height * (0.6 + 0.8 * hash(i0 + i, j0 + j, 5)));
      const p = this.local(b, n, -0.05);
      const q = this.upright(n, hash(i0 + i, j0 + j, 6) * 6.28);
      m.compose(p, q, new THREE.Vector3(h, h, h));
      ia.setMatrixAt(k, m); ib.setMatrixAt(k, m);
      const shade = 0.85 + 0.3 * hash(i0 + i, j0 + j, 8);
      ia.setColorAt(k, c.setHex(sp.form.color2).multiplyScalar(shade));
      ib.setColorAt(k, c.setHex(sp.form.color).multiplyScalar(shade));
      counts.set(shape, k + 1);
    }
    for (const [s, [ia, ib]] of this.plants) {
      ia.count = ib.count = counts.get(s)!;
      ia.instanceMatrix.needsUpdate = ib.instanceMatrix.needsUpdate = true;
      if (ia.instanceColor) ia.instanceColor.needsUpdate = true;
      if (ib.instanceColor) ib.instanceColor.needsUpdate = true;
    }
    this.layCity(b);
    this.layBeasts(b, bio.species.filter(s => s.kind === 'fauna' && s.form.moves && s.form.shape !== 'swimmer' && !/sapiens/.test(s.name)));
    this.laySites(b);
  }

  /** a city's buildings, if one is near: taller towards its middle */
  private layCity(b: Body) {
    let k = 0;
    const real = b.look.real, R = b.r * AU_M;
    const city = real ? sitesOn(real).filter(s => s.kind === 'city').map(s => ({ s, d: Math.acos(Math.min(1, dot(dirOf(s.lat, s.lon), this.anchor))) * R })).sort((a, c) => a.d - c.d)[0] : null;
    if (city && city.d < (city.s.size ?? 10) * 1000 + CITY_REACH) {
      const m = new THREE.Matrix4(), c = new THREE.Color();
      const centre = dirOf(city.s.lat, city.s.lon), size = (city.s.size ?? 10) * 1000;
      const [la0, lo0] = latLon(this.anchor);
      const dLat = CITY_CELL / R * 180 / Math.PI, dLon = dLat / Math.max(0.05, Math.cos(la0 * Math.PI / 180));
      const i0 = Math.round(la0 / dLat), j0 = Math.round(lo0 / dLon), half = Math.ceil(CITY_REACH / CITY_CELL);
      for (let i = -half; i <= half && k < 2500; i++) for (let j = -half; j <= half && k < 2500; j++) {
        // streets: every fourth row and column of cells is left open
        if ((i0 + i) % 4 === 0 || (j0 + j) % 4 === 0) continue;
        const n = dirOf((i0 + i) * dLat, (j0 + j) * dLon);
        const dc = Math.acos(Math.min(1, dot(n, centre))) * R, da = Math.acos(Math.min(1, dot(n, this.anchor))) * R;
        if (da > CITY_REACH || dc > size) continue;
        const gh = this.v.landing.groundH(b, n);
        if (this.v.landing.ground.src?.seas && gh <= 0.01) continue;
        const core = Math.max(0, 1 - dc / size);
        const r = hash(i0 + i, j0 + j, 21);
        if (r > 0.35 + 0.6 * core) continue;
        const h = 6 + Math.pow(hash(i0 + i, j0 + j, 22), 3) * (20 + 260 * core * core);
        const wdt = CITY_CELL * (0.45 + 0.4 * hash(i0 + i, j0 + j, 23));
        m.compose(this.local(b, n, -1), this.upright(n, 0), new THREE.Vector3(wdt, h, wdt * (0.6 + 0.6 * hash(i0 + i, j0 + j, 24))));
        this.buildings.setMatrixAt(k, m);
        this.windows.setMatrixAt(k, m);
        const g = 0.45 + 0.4 * hash(i0 + i, j0 + j, 25);
        this.buildings.setColorAt(k, c.setRGB(g, g * 0.98, g * 0.95 + (hash(i0 + i, j0 + j, 26) > 0.8 ? 0.15 : 0)));
        k++;
      }
    }
    this.buildings.count = this.windows.count = k;
    this.buildings.instanceMatrix.needsUpdate = this.windows.instanceMatrix.needsUpdate = true;
    if (this.buildings.instanceColor) this.buildings.instanceColor.needsUpdate = true;
  }

  /** a few animals of the place, wandering */
  private layBeasts(b: Body, fauna: Species[]) {
    for (const x of this.beasts) this.group.remove(x.mesh);
    this.beasts = [];
    if (!fauna.length) return;
    const R = b.r * AU_M, sc = this.v.science;
    const [la0, lo0] = latLon(this.anchor);
    for (let k = 0; k < 16 && this.beasts.length < 9; k++) {
      const a = hash(Math.round(la0 * 300), Math.round(lo0 * 300), k * 13) * Math.PI * 2, r = 20 + 140 * hash(Math.round(la0 * 300), Math.round(lo0 * 300), k * 17);
      const [e, nn] = tangent(this.anchor);
      let n: V3 = [this.anchor[0] + (e[0] * Math.cos(a) + nn[0] * Math.sin(a)) * r / R, this.anchor[1] + (e[1] * Math.cos(a) + nn[1] * Math.sin(a)) * r / R, this.anchor[2] + (e[2] * Math.cos(a) + nn[2] * Math.sin(a)) * r / R];
      const l = Math.hypot(...n);
      n = [n[0] / l, n[1] / l, n[2] / l];
      const gh = this.v.landing.groundH(b, n);
      if (this.v.landing.ground.src?.seas && gh <= 0.01) continue;
      const biome = sc.biome(b, n, gh);
      const here = fauna.filter(s => s.biome.includes(biome));
      if (!here.length) continue;
      const sp = here[Math.floor(hash(k, Math.round(la0 * 100), 5) * here.length)];
      const mesh = animal(sp.form);
      const s = Math.max(0.15, sp.form.height);
      mesh.scale.setScalar(s);
      this.group.add(mesh);
      this.beasts.push({ sp, n, heading: a, mesh, t: hash(k, 1, 1) * 10, flyH: sp.form.shape === 'flyer' ? 4 + 18 * hash(k, 2, 2) : 0 });
    }
  }

  /** the real craft left here, as models */
  private laySites(b: Body) {
    const real = b.look.real, R = b.r * AU_M;
    const want = new Set<string>();
    if (real) for (const s of sitesOn(real)) {
      if (s.model === 'none' || s.model === 'city') continue;
      const n = dirOf(s.lat, s.lon);
      if (Math.acos(Math.min(1, dot(n, this.anchor))) * R > 6000) continue;
      want.add(s.name);
      let g = this.sites.get(s.name);
      if (!g) {
        const m = siteMesh(s.model);
        if (!m) continue;
        g = m;
        g.traverse(o => { o.frustumCulled = false; });
        g.userData.site = s;
        this.sites.set(s.name, g);
        this.group.add(g);
      }
      this.placeSite(b, g, s);
    }
    for (const [k, g] of this.sites) if (!want.has(k)) { this.group.remove(g); this.sites.delete(k); }
  }

  private placeSite(b: Body, g: THREE.Group, s: Site) {
    const n = dirOf(s.lat, s.lon);
    g.position.copy(this.local(b, n, 0));
    g.quaternion.copy(this.upright(n, (s.lat * 7 + s.lon * 13) % 6.28));
  }

  private animate(b: Body, dt: number) {
    const R = b.r * AU_M;
    for (const x of this.beasts) {
      x.t += dt;
      // graze, then amble on a little, turning now and then
      const moving = Math.sin(x.t * 0.4 + x.heading) > 0.1 || x.flyH > 0;
      if (moving) {
        x.heading += (hash(Math.floor(x.t), 3, 7) - 0.5) * dt * 0.8;
        const sp = x.flyH > 0 ? 6 : 1.2 * Math.max(0.5, x.sp.form.height);
        const [e, nn] = tangent(x.n);
        const f: V3 = [nn[0] * Math.cos(x.heading) + e[0] * Math.sin(x.heading), nn[1] * Math.cos(x.heading) + e[1] * Math.sin(x.heading), nn[2] * Math.cos(x.heading) + e[2] * Math.sin(x.heading)];
        let n: V3 = [x.n[0] + f[0] * sp * dt / R, x.n[1] + f[1] * sp * dt / R, x.n[2] + f[2] * sp * dt / R];
        const l = Math.hypot(...n);
        n = [n[0] / l, n[1] / l, n[2] / l];
        // stay near home
        if (Math.acos(Math.min(1, dot(n, this.anchor))) * R < REACH) x.n = n; else x.heading += Math.PI;
      }
      x.mesh.position.copy(this.local(b, x.n, x.flyH + (x.flyH ? Math.sin(x.t * 2) * 0.5 : 0)));
      x.mesh.quaternion.copy(this.upright(x.n, x.heading));
      for (const c of x.mesh.children) {
        if (c.name === 'leg') c.rotation.x = moving ? Math.sin(x.t * 8 + c.position.z * 10) * 0.5 : 0;
        if (c.name === 'wingL') c.rotation.z = Math.sin(x.t * 12) * 0.6;
        if (c.name === 'wingR') c.rotation.z = -Math.sin(x.t * 12) * 0.6;
      }
    }
  }

  /** the species of the animals in view, for the scanner */
  nearby(): Species[] { return this.beasts.map(b => b.sp); }
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
