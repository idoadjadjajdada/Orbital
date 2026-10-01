import { World } from './physics/world';
import type { Body, Look, Cls, StarState } from './physics/body';
import { assignHosts, hostOfPoint } from './physics/analysis';
import { buildPreset, PRESETS } from './physics/presets';
import { makeBody, refreshRoche } from './physics/catalog';
import { G, M_EARTH, radiusFromDensity } from './physics/units';
import { predict } from './physics/predict';
import { newStar, structure, teffOf } from './physics/stellar';
import { Body as BodyClass, type Style } from './physics/body';
import { Renderer, PIX } from './pixel/renderer';
import { bakeSprite } from './pixel/sprites';
import { buildMap } from './pixel/surface';

export type Flag = 'trails' | 'orbits' | 'zones' | 'labels' | 'auto';
export interface CustomSpec { style: Style; massLog: number; rho: number; c1: number; c2: number; seed: number; }
export interface P3 { x: number; y: number; z: number }

/** A small pixel-art picture of a body, for the shelf and the inspector. */
export function iconOf(b: { look: Look; heat: number; cls: Cls; star?: StarState; tilt: number }, d = 22): string {
  const isWorld = b.cls !== 'star' && b.cls !== 'wd' && b.cls !== 'ns' && b.cls !== 'bh';
  const sp = bakeSprite({
    look: b.look, cls: b.cls, heat: b.heat, teff: b.star?.teff ?? 5772, giant: b.star?.phase === 'giant',
    d, axis: [0, Math.sin(b.tilt * 0.5 + 0.5), Math.cos(b.tilt * 0.5 + 0.5)], spin: 0.6, light: [-1, 0.5, 0.6], lightCol: [1.15, 1.12, 1.08],
    scars: [], time: 0, map: isWorld ? buildMap(b.look) : null,
  });
  const cv = document.createElement('canvas');
  cv.width = cv.height = sp.size;
  cv.getContext('2d')!.putImageData(new ImageData(sp.data, sp.size, sp.size), 0, 0);
  return cv.toDataURL();
}

export class App {
  world = new World();
  view: Renderer;

  hosts = new Map<Body, { host: Body | null; hill: number }>();
  selected: Body | null = null;
  focus: Body | null = null;
  /** world offset of the view centre from the followed body (or from the origin) */
  pan = { x: 0, y: 0, z: 0 };

  flags: Record<Flag, boolean> = { trails: true, orbits: true, zones: false, labels: true, auto: true };
  warpLog = -0.6;
  paused = false;
  armed: string | null = null;
  custom: CustomSpec = { style: 'terran', massLog: 0, rho: 5.5, c1: 0x1d4f8c, c2: 0x4f8a3c, seed: 1 };

  /** measured sim-years per real second */
  rate = 0;
  presetKey = 'solar';
  onSelect: (b: Body | null) => void = () => {};
  onToast: (msg: string) => void = () => {};
  onFrame: () => void = () => {};

  /** a body being carried by the pointer: where the hand is, relative to what it was near */
  held: { b: Body; target: P3; vel: P3; host: Body | null } | null = null;

  /** bodies drawn as bodies: everything that pulls, and the small moons and machines that do not */
  visual: Body[] = [];
  private testHosts = new Map<Body, Body | null>();
  private frameNo = 0;
  private lastFrame = performance.now();
  private labelEls = new Map<Body, HTMLElement>();

  constructor(canvas: HTMLCanvasElement, private labelRoot: HTMLElement) {
    this.view = new Renderer(canvas);
    this.world.onRemove = b => this.removed(b);
  }

  get warp() { return Math.pow(10, this.warpLog); }

  hostOf = (b: Body): Body | null => {
    const h = this.hosts.get(b);
    if (h) return h.host;
    if (!b.source) {
      let t = this.testHosts.get(b);
      if (t === undefined || (b.id + this.frameNo) % 16 === 0) {
        t = hostOfPoint([b.x, b.y, b.z], [b.vx, b.vy, b.vz], this.world.sources, this.hosts);
        this.testHosts.set(b, t);
      }
      return t;
    }
    return null;
  };
  hillOf = (b: Body) => this.hosts.get(b)?.hill ?? Infinity;
  accRate = (b: Body) => this.view.accRate(b);

  /** world position of the view centre */
  centre(): P3 {
    const f = this.focus;
    return { x: (f ? f.x : 0) + this.pan.x, y: (f ? f.y : 0) + this.pan.y, z: (f ? f.z : 0) + this.pan.z };
  }

  /** zoom so that a radius `r` (AU) fills most of the shorter side of the screen */
  fitRadius(r: number) {
    this.view.scaleGoal = (Math.min(this.view.W, this.view.H) * 0.45) / r;
  }

  loadPreset(key: string) {
    const info = PRESETS.find(p => p.key === key);
    if (!info) return;
    this.presetKey = key;
    this.select(null);
    this.focus = null;
    buildPreset(key, this.world);
    this.hosts = assignHosts(this.world.sources);
    this.view.clearTrails();
    this.focus = this.world.sources.find(b => b.name === info.focus) ?? null;
    this.pan = { x: 0, y: 0, z: 0 };
    this.view.glide = { x: 0, y: 0 };
    this.fitRadius(info.view);
    this.view.scale = this.view.scaleGoal;
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

  /** Follow a body, gliding from wherever the view is now. */
  follow(b: Body | null) {
    const before = this.centre();
    this.focus = b;
    if (b) {
      this.pan = { x: 0, y: 0, z: 0 };
      const hill = this.hillOf(b);
      // close enough to see its moons, or the body itself if it has none
      const want = isFinite(hill) ? Math.max(hill * 1.2, b.r * 4) : null;
      if (want) this.fitRadius(want);
    } else this.pan = before;
    const after = this.centre();
    this.view.glide.x += before.x - after.x;
    this.view.glide.y += before.y - after.y;
  }

  private removed(b: Body) {
    this.view.forget(b);
    const el = this.labelEls.get(b);
    if (el) { el.remove(); this.labelEls.delete(b); }
    if (this.selected === b) this.select(null);
    if (this.focus === b) { this.pan = { x: b.x, y: b.y, z: b.z }; this.focus = null; }
    if (this.held?.b === b) this.held = null;
  }

  deleteSelected() {
    const b = this.selected;
    if (!b) return;
    this.world.kill(b);
    this.world.structural();
  }

  /** A new body from the armed catalogue entry or the forge. */
  spawnArmed(): Body | null {
    if (!this.armed) return null;
    if (this.armed !== 'custom') return makeBody(this.armed);
    const c = this.custom;
    if (c.style === 'star') {
      const b = makeBody('sun', c.seed, 'Custom star');
      b.star = newStar(this.customStarMass(), 0.1);
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
  throwVelocity(p: P3, drag: P3, host: Body | null): P3 {
    if (!host) return { x: drag.x * 2 * Math.PI, y: drag.y * 2 * Math.PI, z: 0 };
    const r = Math.max(1e-12, Math.hypot(p.x - host.x, p.y - host.y, p.z - host.z));
    const k = Math.sqrt((G * host.m) / r) / r;
    return { x: host.vx + drag.x * k, y: host.vy + drag.y * k, z: host.vz + drag.z * k };
  }

  circularVelocity(p: P3, host: Body | null): P3 {
    if (!host) return { x: 0, y: 0, z: 0 };
    const rx = p.x - host.x, ry = p.y - host.y;
    const r = Math.hypot(rx, ry, p.z - host.z) || 1e-12;
    const vc = Math.sqrt((G * host.m) / r), t = Math.hypot(rx, ry) || 1;
    return { x: host.vx - (ry / t) * vc, y: host.vy + (rx / t) * vc, z: host.vz };
  }

  hostAt(p: P3) {
    return this.world.sources.length ? hostOfPoint([p.x, p.y, p.z], null, this.world.sources, this.hosts) : null;
  }

  aim(p: P3 | null, v: P3 | null, host: Body | null) {
    if (!p || !v) { this.view.setAim(null, null); return; }
    const probe = this.spawnArmed();
    if (!probe) return;
    probe.setPos(p.x, p.y, p.z);
    probe.setVel(v.x, v.y, v.z);
    const pr = predict(this.world.sources, probe, host, 8);
    this.view.setAim(pr.points, pr.impact);
  }

  place(p: P3, v: P3) {
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
      const { b, target, vel, host } = this.held;
      b.setPos(target.x + (host?.x ?? 0), target.y + (host?.y ?? 0), target.z + (host?.z ?? 0));
      b.setVel(vel.x + (host?.vx ?? 0), vel.y + (host?.vy ?? 0), vel.z + (host?.vz ?? 0));
      this.world.moved(b);
    }

    let got = 0;
    if (!this.paused) {
      got = this.world.step(this.warp * dtReal, now + 11);
      const inst = dtReal > 0 ? got / dtReal : 0;
      this.rate = this.rate ? this.rate + (inst - this.rate) * Math.min(1, dtReal * 3) : inst;
    }

    for (const e of this.world.events) {
      this.view.flash(e, now / 1000);
      const name = e.name ?? e.body?.name;
      const msg = {
        supernova: `${name ?? 'A star'} went supernova`,
        ia: `${name ?? 'A white dwarf'} passed the Chandrasekhar limit and detonated`,
        kilonova: 'Two neutron stars merged — a kilonova',
        collapse: `${name ?? 'A core'} collapsed into a black hole`,
        nebula: `${name ?? 'A giant'} shed its envelope as a planetary nebula`,
        disrupt: name ?? 'Torn apart by tides',
        impact: 'Catastrophic impact', merge: name ?? 'Merger', crater: '', graze: 'Hit-and-run', swallow: 'Swallowed',
      }[e.kind];
      if (msg && (e.energy > 0.3 || e.kind !== 'merge')) this.onToast(msg);
    }
    this.world.events.length = 0;

    this.frameNo++;
    this.hosts = assignHosts(this.world.sources);
    this.visual = this.world.bodies.filter(b => b.alive && (b.source || !b.isParticle));
    if (this.frameNo % 120 === 0) for (const b of this.testHosts.keys()) if (!b.alive) this.testHosts.delete(b);

    this.view.setCentre(this.centre(), dtReal);
    this.view.render({
      bodies: this.world.bodies, visual: this.visual, sources: this.world.sources,
      hostOf: this.hostOf, hillOf: this.hillOf, flags: this.flags, selected: this.selected, focus: this.focus,
      dtSim: got, dtReal, timeReal: now / 1000, simTime: this.world.time,
    });
    this.updateLabels();
    this.onFrame();
  }

  private updateLabels() {
    const seen = new Set<Body>();
    if (this.flags.labels) {
      const placed: [number, number][] = [];
      const Wc = this.view.W * PIX, Hc = this.view.H * PIX;
      const vis = this.view.drawn.filter(d => !d.hidden && d.b.cls !== 'debris' && d.sx * PIX > -50 && d.sx * PIX < Wc + 50 && d.sy * PIX > -20 && d.sy * PIX < Hc + 20);
      vis.sort((a, b) => (b.b === this.selected ? 1 : 0) - (a.b === this.selected ? 1 : 0) || b.b.m - a.b.m);
      for (const d of vis) {
        const x = (d.sx + d.r + 3) * PIX, y = d.sy * PIX;
        if (placed.some(([px, py]) => Math.abs(px - x) < 60 && Math.abs(py - y) < 13)) continue;
        placed.push([x, y]);
        seen.add(d.b);
        let el = this.labelEls.get(d.b);
        if (!el) {
          el = document.createElement('div');
          el.className = 'lbl';
          const b = d.b;
          el.addEventListener('click', () => this.select(b));
          el.addEventListener('dblclick', () => this.follow(b));
          this.labelRoot.appendChild(el);
          this.labelEls.set(d.b, el);
        }
        if (el.textContent !== d.b.name) el.textContent = d.b.name;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.classList.toggle('sel', d.b === this.selected);
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
