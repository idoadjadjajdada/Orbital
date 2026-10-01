import * as THREE from 'three';
import type { Body } from '../physics/body';
import { osculating, relative, ellipsePoints, norm } from '../physics/orbit';
import { lagrangePoints, habitableZone, barycentre } from '../physics/analysis';
import type { SimEvent } from '../physics/events';
import type { View } from './view';
import { glowTexture, ringTexture, starColor } from './bodies';

const TRAIL_N = 1500;

function lineMaterial() {
  return new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}

export function tintOf(b: Body): THREE.Color {
  if (b.star && b.cls === 'star') return starColor(b.star.teff);
  if (b.cls === 'bh') return new THREE.Color(0.9, 0.6, 0.3);
  if (b.cls === 'ns' || b.cls === 'wd') return new THREE.Color(0.6, 0.75, 1);
  const c = new THREE.Color(b.look.atmo ?? b.look.c2);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.15), 0.62);
}

/** Where a body has been, kept relative to what it goes round, so a moon's trail is its orbit and not a smear. */
class Trail {
  rel = new Float64Array(TRAIL_N * 3);
  n = 0;
  head = 0;
  hostId = -1;
  line: THREE.Line;
  geom = new THREE.BufferGeometry();
  pos = new Float32Array(TRAIL_N * 3);
  col = new Float32Array(TRAIL_N * 4);
  constructor(public color: THREE.Color) {
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.line = new THREE.Line(this.geom, lineMaterial());
    this.line.frustumCulled = false;
  }
  push(x: number, y: number, z: number) {
    this.rel[this.head * 3] = x; this.rel[this.head * 3 + 1] = y; this.rel[this.head * 3 + 2] = z;
    this.head = (this.head + 1) % TRAIL_N;
    this.n = Math.min(TRAIL_N, this.n + 1);
  }
  last(): [number, number, number] | null {
    if (!this.n) return null;
    const i = (this.head - 1 + TRAIL_N) % TRAIL_N;
    return [this.rel[i * 3], this.rel[i * 3 + 1], this.rel[i * 3 + 2]];
  }
}

export interface OverlayFlags { trails: boolean; orbits: boolean; zones: boolean; }

export class Overlays {
  root = new THREE.Group();
  private trails = new Map<Body, Trail>();
  private orbits = new Map<Body, THREE.Line>();
  private hz = new Map<Body, THREE.Mesh>();
  private hill: THREE.Line;
  private lpoints: THREE.Sprite[] = [];
  private bary: THREE.Sprite;
  private aim: THREE.Line;
  private aimPos = new Float32Array(3000 * 3);
  private impact: THREE.Sprite;
  private flashes: { s: THREE.Sprite; ring?: THREE.Sprite; e: SimEvent; t0: number; dur: number }[] = [];
  private v = new THREE.Vector3();

  constructor(private view: View) {
    view.scene.add(this.root);
    const circle = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2), Math.sin((i / 128) * Math.PI * 2), 0)));
    this.hill = new THREE.Line(circle, new THREE.LineDashedMaterial({ color: 0x8fb4ff, dashSize: 0.04, gapSize: 0.03, transparent: true, opacity: 0.5 }));
    this.hill.computeLineDistances();
    this.root.add(this.hill);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(`L${i + 1}`, i >= 3 ? '#9fe0a8' : '#c8b8ff'), depthTest: false, transparent: true }));
      this.lpoints.push(s); this.root.add(s);
    }
    this.bary = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('✕', '#ffd080'), depthTest: false, transparent: true }));
    this.root.add(this.bary);
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(this.aimPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.aim = new THREE.Line(ag, new THREE.LineDashedMaterial({ color: 0xffe2a0, dashSize: 1, gapSize: 1, transparent: true, opacity: 0.9 }));
    this.aim.frustumCulled = false;
    this.aim.visible = false;
    this.root.add(this.aim);
    this.impact = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('✸', '#ff8060'), depthTest: false, transparent: true }));
    this.impact.visible = false;
    this.root.add(this.impact);
  }

  forget(b: Body) {
    const t = this.trails.get(b);
    if (t) { t.line.removeFromParent(); t.geom.dispose(); this.trails.delete(b); }
    const o = this.orbits.get(b);
    if (o) { o.removeFromParent(); o.geometry.dispose(); this.orbits.delete(b); }
    const h = this.hz.get(b);
    if (h) { h.removeFromParent(); h.geometry.dispose(); this.hz.delete(b); }
  }

  clearTrails() { for (const t of this.trails.values()) { t.n = 0; t.head = 0; } }

  update(sources: Body[], hostOf: (b: Body) => Body | null, hill: (b: Body) => number, flags: OverlayFlags, selected: Body | null, hidden: (b: Body) => boolean) {
    const o = this.view.origin;
    const cam = this.view.camera.position;
    const live = new Set(sources);
    for (const b of [...this.trails.keys(), ...this.orbits.keys(), ...this.hz.keys()]) if (!live.has(b)) this.forget(b);

    for (const b of sources) {
      if (b.cls === 'debris') continue;
      const host = hostOf(b);
      // ---- trail ----
      let t = this.trails.get(b);
      if (!t) { t = new Trail(tintOf(b)); this.trails.set(b, t); this.root.add(t.line); }
      const hid = host ? host.id : 0;
      if (hid !== t.hostId) { t.n = 0; t.head = 0; t.hostId = hid; }
      const hx = host ? host.x : 0, hy = host ? host.y : 0, hz = host ? host.z : 0;
      const rx = b.x - hx, ry = b.y - hy, rz = b.z - hz;
      const last = t.last();
      const span = host ? Math.hypot(rx, ry, rz) : this.view.dist;
      if (!last || Math.hypot(rx - last[0], ry - last[1], rz - last[2]) > 0.006 * span) t.push(rx, ry, rz);
      t.line.visible = flags.trails && t.n > 1;
      if (t.line.visible) {
        const ox = hx - o.x, oy = hy - o.y, oz = hz - o.z;
        const start = (t.head - t.n + TRAIL_N) % TRAIL_N;
        for (let k = 0; k < t.n; k++) {
          const i = (start + k) % TRAIL_N;
          t.pos[k * 3] = t.rel[i * 3] + ox; t.pos[k * 3 + 1] = t.rel[i * 3 + 1] + oy; t.pos[k * 3 + 2] = t.rel[i * 3 + 2] + oz;
          const a = (k / t.n) ** 1.5 * 0.55;
          t.col[k * 4] = t.color.r; t.col[k * 4 + 1] = t.color.g; t.col[k * 4 + 2] = t.color.b; t.col[k * 4 + 3] = a;
        }
        // the newest point is the body itself
        t.pos[(t.n - 1) * 3] = b.x - o.x; t.pos[(t.n - 1) * 3 + 1] = b.y - o.y; t.pos[(t.n - 1) * 3 + 2] = b.z - o.z;
        t.geom.setDrawRange(0, t.n);
        t.geom.attributes.position.needsUpdate = true;
        t.geom.attributes.color.needsUpdate = true;
      }

      // ---- osculating orbit ----
      let ol = this.orbits.get(b);
      let show = false;
      if (flags.orbits && host && !hidden(b)) {
        const { r, v, mu } = relative(b, host);
        const oc = osculating(mu, r, v);
        // only where an ellipse is a fair claim: bound, not plunging into the host, not too lopsided
        if (oc.a > 0 && oc.e < 0.995 && oc.rp > host.r && b.m < host.m) {
          if (!ol) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(257 * 3), 3).setUsage(THREE.DynamicDrawUsage));
            ol = new THREE.Line(g, new THREE.LineBasicMaterial({ color: tintOf(b), transparent: true, opacity: 0.32, depthWrite: false }));
            ol.frustumCulled = false;
            this.orbits.set(b, ol);
            this.root.add(ol);
          }
          const pts = ellipsePoints(oc, r, 256);
          const arr = (ol.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
          const ox = host.x - o.x, oy = host.y - o.y, oz = host.z - o.z;
          pts.forEach((p, k) => { arr[k * 3] = p[0] + ox; arr[k * 3 + 1] = p[1] + oy; arr[k * 3 + 2] = p[2] + oz; });
          ol.geometry.attributes.position.needsUpdate = true;
          (ol.material as THREE.LineBasicMaterial).opacity = b === selected ? 0.75 : 0.3;
          show = true;
        }
      }
      if (ol) ol.visible = show;

      // ---- habitable zone ----
      let h = this.hz.get(b);
      const lum = b.cls === 'star' && b.star ? b.star.L : 0;
      if (flags.zones && lum > 0) {
        const [inner, outer] = habitableZone(lum);
        if (!h || h.userData.inner !== inner) {
          if (h) { h.removeFromParent(); h.geometry.dispose(); }
          h = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 160, 1), new THREE.MeshBasicMaterial({
            color: 0x40d070, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
          }));
          h.userData.inner = inner;
          this.hz.set(b, h);
          this.root.add(h);
        }
        this.view.toScene(b, h.position);
        h.visible = true;
      } else if (h) h.visible = false;
    }

    // ---- selection: Hill sphere, Lagrange points, barycentre ----
    const host = selected ? hostOf(selected) : null;
    const showSel = flags.zones && !!selected && !!host && selected.source;
    this.hill.visible = this.bary.visible = showSel;
    for (const s of this.lpoints) s.visible = showSel;
    if (showSel && selected && host) {
      const { r, v } = relative(selected, host);
      const hr = hill(selected);
      this.view.toScene(selected, this.hill.position);
      const n = new THREE.Vector3(r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]).normalize();
      this.hill.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      this.hill.scale.setScalar(isFinite(hr) ? hr : 0);
      const pw = this.view.pixelWorld(this.hill.position.distanceTo(cam));
      (this.hill.material as THREE.LineDashedMaterial).dashSize = 6 * pw / Math.max(hr, 1e-30);
      (this.hill.material as THREE.LineDashedMaterial).gapSize = 5 * pw / Math.max(hr, 1e-30);
      lagrangePoints(selected, host).forEach((p, i) => {
        const s = this.lpoints[i];
        s.position.set(p[0] - o.x, p[1] - o.y, p[2] - o.z);
        s.scale.setScalar(this.view.pixelWorld(s.position.distanceTo(cam)) * 22);
      });
      const bc = barycentre(selected, host);
      this.bary.position.set(bc[0] - o.x, bc[1] - o.y, bc[2] - o.z);
      this.bary.scale.setScalar(this.view.pixelWorld(this.bary.position.distanceTo(cam)) * 16);
      this.hill.visible = isFinite(hr) && norm(r) > 0;
    }
  }

  /** The dotted path a body about to be thrown will follow (world points), and where it hits, if it does. */
  setAim(points: [number, number, number][] | null, impact: [number, number, number] | null) {
    if (!points || points.length < 2) { this.aim.visible = false; this.impact.visible = false; return; }
    const o = this.view.origin;
    const n = Math.min(points.length, 3000);
    for (let k = 0; k < n; k++) {
      this.aimPos[k * 3] = points[k][0] - o.x; this.aimPos[k * 3 + 1] = points[k][1] - o.y; this.aimPos[k * 3 + 2] = points[k][2] - o.z;
    }
    const g = this.aim.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    this.aim.computeLineDistances();
    const pw = this.view.pixelWorld(this.view.dist);
    const m = this.aim.material as THREE.LineDashedMaterial;
    m.dashSize = 5 * pw; m.gapSize = 4 * pw;
    this.aim.visible = true;
    if (impact) {
      this.impact.position.set(impact[0] - o.x, impact[1] - o.y, impact[2] - o.z);
      this.impact.scale.setScalar(this.view.pixelWorld(this.impact.position.distanceTo(this.view.camera.position)) * 26);
      this.impact.visible = true;
    } else this.impact.visible = false;
  }

  /** Light and shock from events; they run in real time so they read at any clock speed. */
  addFlash(e: SimEvent, now: number) {
    const color = {
      supernova: 0xbfd8ff, ia: 0xfff2d0, kilonova: 0xff9a60, impact: 0xffa050, merge: 0xffc080, graze: 0xffb070,
      disrupt: 0xffd0a0, collapse: 0xc090ff, nebula: 0x70e0e0, swallow: 0xffb080,
    }[e.kind];
    const big = e.kind === 'supernova' || e.kind === 'ia' || e.kind === 'kilonova';
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.root.add(s);
    let ring: THREE.Sprite | undefined;
    if (big || e.kind === 'impact' || e.kind === 'collapse') {
      ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      this.root.add(ring);
    }
    this.flashes.push({ s, ring, e, t0: now, dur: big ? 6 : 2.5 });
  }

  updateFlashes(now: number) {
    const o = this.view.origin;
    const cam = this.view.camera.position;
    this.flashes = this.flashes.filter(f => {
      const u = (now - f.t0) / f.dur;
      if (u >= 1) {
        f.s.removeFromParent(); f.s.material.dispose();
        if (f.ring) { f.ring.removeFromParent(); f.ring.material.dispose(); }
        return false;
      }
      this.v.set(f.e.x - o.x, f.e.y - o.y, f.e.z - o.z);
      const pw = this.view.pixelWorld(this.v.distanceTo(cam));
      const big = f.dur > 3;
      const px = (big ? 220 : 60) * Math.sqrt(f.e.energy + 0.1);
      const fade = (1 - u) ** 2;
      f.s.position.copy(this.v);
      f.s.scale.setScalar(Math.max(f.e.size * (1 + 3 * u), px * pw * (0.4 + u)));
      f.s.material.opacity = fade * (big ? 3 : 1.5);
      if (f.ring) {
        f.ring.position.copy(this.v);
        f.ring.scale.setScalar(Math.max(f.e.size * (1 + 12 * u), px * pw * 2.2 * Math.sqrt(u)));
        f.ring.material.opacity = (1 - u) * 0.9;
      }
      return true;
    });
  }
}

const labelCache = new Map<string, THREE.Texture>();
function labelTexture(text: string, color: string) {
  const key = text + color;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 30px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 6;
  g.fillStyle = color;
  g.fillText(text, 32, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(key, t);
  return t;
}
