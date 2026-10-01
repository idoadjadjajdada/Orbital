import * as THREE from 'three';
import { World } from './physics/world';
import type { Body } from './physics/body';
import { assignHosts, hostOfPoint } from './physics/analysis';
import { buildPreset, PRESETS } from './physics/presets';
import { makeBody, refreshRoche } from './physics/catalog';
import { G, M_EARTH, fmtDuration, schwarzschild, radiusFromDensity } from './physics/units';
import { predict } from './physics/predict';
import { newStar, structure, teffOf, timeToNextStage } from './physics/stellar';
import { View } from './render/view';
import { BodyLayer } from './render/bodies';
import { ParticleLayer } from './render/particles';
import { Overlays } from './render/overlays';
import { buildSky } from './render/sky';
import { IconRenderer } from './render/icons';
import { Body as BodyClass, type Style } from './physics/body';

export type Flag = 'trails' | 'orbits' | 'zones' | 'labels' | 'auto';

export interface CustomSpec { style: Style; massLog: number; rho: number; c1: number; c2: number; seed: number; }

export class App {
  world = new World();
  view: View;
  bodies: BodyLayer;
  particles: ParticleLayer;
  overlays: Overlays;
  icons = new IconRenderer(96);

  hosts = new Map<Body, { host: Body | null; hill: number }>();
  selected: Body | null = null;
  focus: Body | null = null;
  /** world offset of the view centre from the followed body (or from the origin of coordinates) */
  pan = { x: 0, y: 0, z: 0 };

  flags: Record<Flag, boolean> = { trails: true, orbits: true, zones: false, labels: true, auto: true };
  warpLog = -0.6;
  paused = false;
  armed: string | null = null;
  custom: CustomSpec = { style: 'terran', massLog: 0, rho: 5.5, c1: 0x1d4f8c, c2: 0x4f8a3c, seed: 1 };

  /** measured sim-years per real second */
  rate = 0;
  lastStep = 0;
  presetKey = 'solar';
  onSelect: (b: Body | null) => void = () => {};
  onToast: (msg: string) => void = () => {};
  onFrame: () => void = () => {};

  // a body being carried by the pointer
  held: { b: Body; target: THREE.Vector3; vel: THREE.Vector3; last: THREE.Vector3; t: number; host: Body | null } | null = null;

  private lastFrame = performance.now();
  private labelEls = new Map<Body, HTMLElement>();

  constructor(canvas: HTMLCanvasElement, private labelRoot: HTMLElement) {
    this.view = new View(canvas);
    buildSky(this.view.sky);
    this.bodies = new BodyLayer(this.view);
    this.particles = new ParticleLayer(this.view);
    this.overlays = new Overlays(this.view);
    this.world.onRemove = b => this.removed(b);
  }

  get warp() { return Math.pow(10, this.warpLog); }

  hostOf = (b: Body): Body | null => {
    const h = this.hosts.get(b);
    if (h) return h.host;
    if (!b.source) return hostOfPoint([b.x, b.y, b.z], [b.vx, b.vy, b.vz], this.world.sources, this.hosts);
    return null;
  };
  hillOf = (b: Body) => this.hosts.get(b)?.hill ?? Infinity;

  /** world position of the view centre */
  centre() {
    const f = this.focus;
    return { x: (f ? f.x : 0) + this.pan.x, y: (f ? f.y : 0) + this.pan.y, z: (f ? f.z : 0) + this.pan.z };
  }

  loadPreset(key: string) {
    const info = PRESETS.find(p => p.key === key);
    if (!info) return;
    this.presetKey = key;
    this.select(null);
    this.focus = null;
    buildPreset(key, this.world);
    this.hosts = assignHosts(this.world.sources);
    this.overlays.clearTrails();
    const f = this.world.sources.find(b => b.name === info.focus) ?? null;
    this.focus = f;
    this.pan = { x: 0, y: 0, z: 0 };
    this.view.glide = { x: 0, y: 0, z: 0 };
    this.view.distGoal = this.view.dist = info.view * 2.2;
    this.view.el = 0.75;
    this.warpLog = Math.log10(info.warp);
    this.paused = false;
  }

  clear() {
    this.select(null);
    const c = this.centre();
    this.focus = null;
    this.pan = c;
    this.world.clear();
    this.hosts.clear();
  }

  select(b: Body | null) {
    this.selected = b;
    this.onSelect(b);
  }

  /** Follow a body with the camera, gliding from wherever the view is now. */
  follow(b: Body | null) {
    const before = this.centre();
    this.focus = b;
    if (b) {
      this.pan = { x: 0, y: 0, z: 0 };
      const hill = this.hillOf(b);
      const want = isFinite(hill) ? Math.max(hill * 2.5, b.r * 6) : Math.max(this.view.distGoal, b.r * 6);
      if (this.view.distGoal > want * 4 || this.view.distGoal < b.r * 3) this.view.distGoal = want;
    } else this.pan = before;
    const after = this.centre();
    this.view.glide.x += before.x - after.x;
    this.view.glide.y += before.y - after.y;
    this.view.glide.z += before.z - after.z;
  }

  private removed(b: Body) {
    this.overlays.forget(b);
    const el = this.labelEls.get(b);
    if (el) { el.remove(); this.labelEls.delete(b); }
    if (this.selected === b) this.select(null);
    if (this.focus === b) {
      // keep looking at the same place
      this.pan = { x: b.x, y: b.y, z: b.z };
      this.focus = null;
    }
    if (this.held?.b === b) this.held = null;
  }

  deleteSelected() {
    const b = this.selected;
    if (!b) return;
    this.world.kill(b);
    this.world.structural();
  }

  ageSelected() {
    const b = this.selected;
    if (!b?.star) return;
    const dt = timeToNextStage(b.star);
    if (!isFinite(dt)) return;
    // stop just short, so the transition itself is something you watch
    b.star.age += Math.max(0, dt * 0.9995 - 50);
    this.onToast(`${b.name} aged ${fmtDuration(dt)} — a skip in its clock, not a physical process`);
  }

  /** A new body from the armed catalogue entry or the forge. */
  spawnArmed(): Body | null {
    if (!this.armed) return null;
    if (this.armed !== 'custom') return makeBody(this.armed);
    const c = this.custom;
    if (c.style === 'star') {
      const m = this.customStarMass();
      const b = makeBody('sun', c.seed, 'Custom star');
      b.star = newStar(m, 0.1);
      const st = structure(b.star);
      b.m = st.m; b.r = st.r; b.star.L = st.L; b.star.teff = teffOf(st.L, st.r);
      refreshRoche(b);
      return b;
    }
    const m = Math.pow(10, c.massLog) * M_EARTH;
    const cls = c.style === 'gas' || c.style === 'icegiant' ? 'gas' : c.style === 'ice' || c.style === 'ocean' ? 'ice' : 'rock';
    const b = new BodyClass({
      name: 'Custom world', kind: 'custom', cls, m, r: radiusFromDensity(m, c.rho),
      look: { style: c.style, seed: c.seed, c1: c.c1, c2: c.c2, atmo: c.style === 'terran' || c.style === 'ocean' ? 0x7ab0ff : c.style === 'gas' || c.style === 'icegiant' ? c.c2 : undefined },
      spin: (2 * Math.PI * 365.25) / 1.2,
    });
    if (c.style === 'lava') b.heat = 0.8;
    refreshRoche(b);
    return b;
  }
  customStarMass() { return Math.pow(10, -1.1 + ((this.custom.massLog + 4) / 7.6) * 2.9); }

  /** velocity a thrown body gets for a drag of `drag` (world AU) starting at `p` near `host` */
  throwVelocity(p: THREE.Vector3, drag: THREE.Vector3, host: Body | null) {
    if (!host) return drag.clone().multiplyScalar(2 * Math.PI);
    const r = Math.max(1e-12, Math.hypot(p.x - host.x, p.y - host.y, p.z - host.z));
    const vc = Math.sqrt((G * host.m) / r);
    return new THREE.Vector3(host.vx, host.vy, host.vz).addScaledVector(drag, vc / r);
  }

  circularVelocity(p: THREE.Vector3, host: Body | null) {
    if (!host) return new THREE.Vector3();
    const rx = p.x - host.x, ry = p.y - host.y;
    const r = Math.hypot(rx, ry, p.z - host.z) || 1e-12;
    const vc = Math.sqrt((G * host.m) / r);
    const t = new THREE.Vector3(-ry, rx, 0).normalize();
    return new THREE.Vector3(host.vx, host.vy, host.vz).addScaledVector(t, vc);
  }

  hostAt(p: THREE.Vector3) {
    return this.world.sources.length ? hostOfPoint([p.x, p.y, p.z], null, this.world.sources, this.hosts) : null;
  }

  aim(p: THREE.Vector3 | null, v: THREE.Vector3 | null, host: Body | null) {
    if (!p || !v) { this.overlays.setAim(null, null); return; }
    const probe = this.spawnArmed();
    if (!probe) return;
    probe.setPos(p.x, p.y, p.z);
    probe.setVel(v.x, v.y, v.z);
    const pr = predict(this.world.sources, probe, host, 8);
    this.overlays.setAim(pr.points, pr.impact);
  }

  place(p: THREE.Vector3, v: THREE.Vector3) {
    const b = this.spawnArmed();
    if (!b) return null;
    b.setPos(p.x, p.y, p.z);
    b.setVel(v.x, v.y, v.z);
    this.world.add(b);
    this.hosts = assignHosts(this.world.sources);
    return b;
  }

  frame() {
    const now = performance.now();
    const dtReal = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.held) {
      const h = this.held;
      const b = h.b;
      // the body goes where the hand is, carried along with whatever it was near
      const hx = h.host ? h.host.x : 0, hy = h.host ? h.host.y : 0, hz = h.host ? h.host.z : 0;
      b.setPos(h.target.x + hx, h.target.y + hy, h.target.z + hz);
      const hv = h.host ? [h.host.vx, h.host.vy, h.host.vz] : [0, 0, 0];
      b.setVel(hv[0] + h.vel.x, hv[1] + h.vel.y, hv[2] + h.vel.z);
      this.world.moved(b);
    }

    let got = 0;
    if (!this.paused) {
      const req = this.warp * dtReal;
      got = this.world.step(req, now + 11);
      const inst = dtReal > 0 ? got / dtReal : 0;
      this.rate = this.rate ? this.rate + (inst - this.rate) * Math.min(1, dtReal * 3) : inst;
    }
    this.lastStep = got;

    for (const e of this.world.events) {
      this.overlays.addFlash(e, now / 1000);
      const name = e.name ?? e.body?.name;
      const msg = {
        supernova: `${name ?? 'A star'} went supernova`,
        ia: `${name ?? 'A white dwarf'} passed the Chandrasekhar limit and detonated`,
        kilonova: 'Two neutron stars merged — a kilonova',
        collapse: `${name ?? 'A core'} collapsed into a black hole`,
        nebula: `${name ?? 'A giant'} shed its envelope as a planetary nebula`,
        disrupt: name ?? 'Torn apart by tides',
        impact: 'Catastrophic impact', merge: name ?? 'Merger', graze: 'Hit-and-run', swallow: 'Swallowed',
      }[e.kind];
      if (msg && (e.energy > 0.3 || e.kind !== 'merge')) this.onToast(msg);
    }
    this.world.events.length = 0;

    this.hosts = assignHosts(this.world.sources);
    this.bodies.sync(this.world.sources);

    const c = this.centre();
    this.view.origin = c;
    this.view.updateCamera(dtReal);
    this.bodies.updateLights(this.world.sources);
    this.bodies.update(got, now / 1000, this.hostOf);
    const holes = this.world.sources.filter(b => b.cls === 'bh');
    this.particles.update(this.world.bodies, holes);
    this.overlays.update(this.world.sources, this.hostOf, this.hillOf, this.flags, this.selected,
      b => this.bodies.map.get(b)?.hidden ?? false);
    this.overlays.updateFlashes(now / 1000);
    this.updateLens(holes);
    this.updateLabels();
    this.onFrame();
    this.view.render();
  }

  private updateLens(holes: Body[]) {
    const u = this.view.lens.uniforms;
    const cam = this.view.camera;
    const k = 1 / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const list: { uv: [number, number]; e2: number; sh: number }[] = [];
    const v = new THREE.Vector3();
    for (const h of holes) {
      this.view.toScene(h, v);
      const D = v.distanceTo(cam.position);
      const p = this.view.project(v);
      if (p.behind) continue;
      const rs = schwarzschild(h.m);
      const thetaE = Math.sqrt((2 * rs) / D) * k;
      const shadow = ((2.6 * rs) / D) * k;
      list.push({ uv: [p.x / this.view.width, 1 - p.y / this.view.height], e2: thetaE * thetaE, sh: shadow });
    }
    list.sort((a, b) => b.e2 - a.e2);
    const n = Math.min(4, list.length);
    for (let i = 0; i < n; i++) u.uHoles.value[i].set(list[i].uv[0], list[i].uv[1], list[i].e2, list[i].sh);
    u.uN.value = n;
    this.view.lens.enabled = n > 0;
  }

  private updateLabels() {
    const seen = new Set<Body>();
    if (this.flags.labels) {
      const placed: [number, number][] = [];
      const vis = [...this.bodies.map.values()].filter(v => v.onScreen && !v.hidden && v.body.cls !== 'debris' && v.sx > -50 && v.sx < this.view.width + 50 && v.sy > -20 && v.sy < this.view.height + 20);
      vis.sort((a, b) => (b.body === this.selected ? 1 : 0) - (a.body === this.selected ? 1 : 0) || b.body.m - a.body.m);
      for (const v of vis) {
        const x = v.sx + Math.max(4, v.spx) + 5, y = v.sy;
        if (placed.some(([px, py]) => Math.abs(px - x) < 60 && Math.abs(py - y) < 13)) continue;
        placed.push([x, y]);
        seen.add(v.body);
        let el = this.labelEls.get(v.body);
        if (!el) {
          el = document.createElement('div');
          el.className = 'lbl';
          const b = v.body;
          el.addEventListener('click', () => this.select(b));
          el.addEventListener('dblclick', () => this.follow(b));
          this.labelRoot.appendChild(el);
          this.labelEls.set(v.body, el);
        }
        if (el.textContent !== v.body.name) el.textContent = v.body.name;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.classList.toggle('sel', v.body === this.selected);
        el.style.display = '';
      }
    }
    for (const [b, el] of this.labelEls) if (!seen.has(b)) el.style.display = 'none';
  }

  loop = () => {
    this.frame();
    requestAnimationFrame(this.loop);
  };
}

