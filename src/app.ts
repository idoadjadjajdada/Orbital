import { World } from './physics/world';
import type { Body, Look, Cls, StarState } from './physics/body';
import { assignHosts, hostOfPoint } from './physics/analysis';
import { buildPreset, PRESETS } from './physics/presets';
import { makeBody, ENTRY } from './physics/catalog';
import { placeExtras } from './physics/extras';
import { SHAPES } from './physics/materials';
import { buildCustom } from './physics/custom';
import { G, KMS, GCC, fmtLength, sig } from './physics/units';
import { takeSnapshot, restoreSnapshot, type Snapshot } from './physics/snapshot';
import { shatterBody } from './physics/events';
import { Body as BodyClass } from './physics/body';
import { predict } from './physics/predict';
import { Renderer, PIX } from './pixel/renderer';
import { bakeSprite } from './pixel/sprites';
import { buildMap } from './pixel/surface';

export type Flag = 'trails' | 'orbits' | 'zones' | 'labels' | 'auto';
export type Tool = 'hand' | 'ruler' | 'push' | 'bombard' | 'erase';
/** an end of the ruler: a fixed point, or a body it follows */
export type End = P3 | Body;
export type { CustomSpec } from './physics/custom';
import type { CustomSpec } from './physics/custom';
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

const densityMass = (r: number, rho: number) => (4 / 3) * Math.PI * r ** 3 * rho * GCC;
function fmtSeconds(s: number) {
  return s < 1 ? `${sig(s * 1000, 2)} ms` : s < 120 ? `${sig(s, 3)} s` : s < 7200 ? `${sig(s / 60, 3)} min` : s < 2 * 86400 ? `${sig(s / 3600, 3)} h` : s < 2 * 31557600 ? `${sig(s / 86400, 3)} d` : `${sig(s / 31557600, 3)} yr`;
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
  custom: CustomSpec = { mode: 'world', cells: SHAPES[1].make(), sizeLog: Math.log10(400), name: 'My world', dayH: 7, starMass: 1, starAge: 0.3, seed: 1 };

  /** measured sim-years per real second */
  rate = 0;
  presetKey = 'solar';
  onSelect: (b: Body | null) => void = () => {};
  onToast: (msg: string) => void = () => {};
  onFrame: () => void = () => {};

  tool: Tool = 'hand';
  ruler: { a: End; b: End } | null = null;
  /** a push being drawn: the body and the change of velocity so far */
  push: { b: Body; dv: P3 } | null = null;
  /** impactors raining on a body while the pointer is held */
  bombard: { target: Body; acc: number } | null = null;
  brush: { x: number; y: number } | null = null;
  private undoStack: Snapshot[] = [];
  onUndo: (label: string | null) => void = () => {};
  /** the view from inside: loaded the first time it is asked for */
  mode3d = false;
  v3: import('./three/view3d').View3D | null = null;
  private warp2d = -0.6;
  onMode: () => void = () => {};

  /** Switch between the map and the 3D view. In 3D the clock runs at one second a second unless the cheat says otherwise. */
  async toggle3D() {
    if (!this.mode3d) {
      if (!this.v3) {
        const { View3D } = await import('./three/view3d');
        this.v3 = new View3D(this);
      }
      this.mode3d = true;
      this.warp2d = this.warpLog;
      this.warpLog = Math.log10(1 / (365.25 * 86400));
      this.armed = null;
      this.view.setAim(null, null);
      this.v3.enter();
    } else {
      this.mode3d = false;
      this.v3?.exit();
      this.warpLog = this.warp2d;
    }
    document.body.classList.toggle('mode3d', this.mode3d);
    this.onMode();
  }
  openBuilder: () => void = () => {};

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

  // ---------------------------------------------------------------- undo
  /** Remember the world as it is, before a change the user makes. */
  remember(label: string) {
    if (!this.world.bodies.length) return;
    this.undoStack.push(takeSnapshot(this.world, label));
    if (this.undoStack.length > 10) this.undoStack.shift();
    this.onUndo(label);
  }
  get canUndo() { return this.undoStack.length > 0; }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    const selId = this.selected?.id, focId = this.focus?.id, c = this.centre();
    this.held = null;
    restoreSnapshot(this.world, s);
    this.hosts = assignHosts(this.world.sources);
    this.view.clearTrails();
    const byId = (id?: number) => (id ? this.world.bodies.find(b => b.id === id) ?? null : null);
    this.focus = byId(focId);
    this.pan = this.focus ? { x: 0, y: 0, z: 0 } : c;
    this.select(byId(selId));
    this.onToast(`Undid: ${s.label}`);
    this.onUndo(this.undoStack.at(-1)?.label ?? null);
  }

  loadPreset(key: string) {
    const info = PRESETS.find(p => p.key === key);
    if (!info) return;
    this.remember('loading a system');
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
    this.remember('clearing');
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
    this.remember(`deleting ${b.name}`);
    this.world.kill(b);
    this.world.structural();
  }

  // ---------------------------------------------------------------- tools
  /** relative to what it goes round */
  private rel(b: Body) {
    const h = this.hostOf(b);
    return { h, vx: b.vx - (h?.vx ?? 0), vy: b.vy - (h?.vy ?? 0), vz: b.vz - (h?.vz ?? 0) };
  }

  /** Put a body on a circular orbit about its host, in the plane and direction it already goes round. */
  circularize(b: Body) {
    const { h } = this.rel(b);
    if (!h) { this.onToast(`${b.name} is not going round anything`); return; }
    this.remember(`circularizing ${b.name}`);
    const rx = b.x - h.x, ry = b.y - h.y, rz = b.z - h.z;
    const r = Math.hypot(rx, ry, rz);
    let lx = ry * (b.vz - h.vz) - rz * (b.vy - h.vy), ly = rz * (b.vx - h.vx) - rx * (b.vz - h.vz), lz = rx * (b.vy - h.vy) - ry * (b.vx - h.vx);
    let ln = Math.hypot(lx, ly, lz);
    if (!(ln > 0)) { lx = 0; ly = 0; lz = 1; ln = 1; }
    lx /= ln; ly /= ln; lz /= ln;
    // the direction of travel: L × r̂
    const tx = (ly * rz - lz * ry) / r, ty = (lz * rx - lx * rz) / r, tz = (lx * ry - ly * rx) / r;
    const vc = Math.sqrt((G * (h.m + b.m)) / r);
    b.setVel(h.vx + tx * vc, h.vy + ty * vc, h.vz + tz * vc);
    this.world.moved(b);
  }

  /** Turn a body round: same speed, the other way. */
  reverse(b: Body) {
    const { h, vx, vy, vz } = this.rel(b);
    this.remember(`reversing ${b.name}`);
    b.setVel((h?.vx ?? 0) - vx, (h?.vy ?? 0) - vy, (h?.vz ?? 0) - vz);
    this.world.moved(b);
  }

  /**
   * Break a body up as if struck by something big enough to shatter it: the
   * pieces fly apart at a little over its escape speed, so they disperse
   * rather than fall straight back together, and carry its momentum exactly.
   */
  shatter(b: Body) {
    if (b.compact || b.cls === 'star' || b.isParticle && !b.source) { this.onToast(`${b.name} cannot be shattered`); return; }
    this.remember(`shattering ${b.name}`);
    shatterBody(this.world, b);
  }

  applyPush() {
    const p = this.push;
    this.push = null;
    this.view.setAim(null, null);
    if (!p || !p.b.alive) return;
    this.remember(`pushing ${p.b.name}`);
    p.b.vx += p.dv.x; p.b.vy += p.dv.y; p.b.vz += p.dv.z;
    this.world.moved(p.b);
  }

  /** the predicted path of a body if it were pushed by dv */
  previewPush(b: Body, dv: P3) {
    const probe = Object.assign(Object.create(Object.getPrototypeOf(b)), b) as Body;
    probe.vx = b.vx + dv.x; probe.vy = b.vy + dv.y; probe.vz = b.vz + dv.z;
    const others = this.world.sources.filter(s => s !== b);
    const pr = predict(others, probe, this.hostOf(b), 8);
    this.view.setAim(pr.points, pr.impact);
  }

  /** Small rocks from every side, a few each frame, to watch them crater. */
  private rain(dtReal: number) {
    const s = this.bombard;
    if (!s || !s.target.alive) { this.bombard = null; return; }
    const T = s.target;
    s.acc += dtReal * 40;
    const n = Math.floor(s.acc);
    s.acc -= n;
    for (let k = 0; k < n; k++) {
      const z = 2 * Math.random() - 1, ph = 2 * Math.PI * Math.random(), q = Math.sqrt(1 - z * z);
      const dir = [q * Math.cos(ph), q * Math.sin(ph), z * 0.3];
      const dn = Math.hypot(dir[0], dir[1], dir[2]);
      const d = [dir[0] / dn, dir[1] / dn, dir[2] / dn];
      const R0 = T.r * 1.6;
      // come in at escape speed plus a few km/s, a little off-centre
      const vesc = Math.sqrt((2 * G * T.m) / R0);
      const v = Math.sqrt(vesc * vesc + (6 * KMS) ** 2);
      const off = (Math.random() - 0.5) * 0.8;
      const ix = -d[0] - d[1] * off, iy = -d[1] + d[0] * off, iz = -d[2];
      const inn = Math.hypot(ix, iy, iz);
      // a rock a few hundredths the target's size: big enough to see the crater
      const rr = T.r * (0.004 + 0.02 * Math.random() ** 2);
      const m = densityMass(rr, 2.6);
      const p = new BodyClass({ name: 'impactor', kind: 'fragment', cls: 'debris', m, r: rr, source: false, spin: 0,
        look: { style: 'rocky', seed: 0, c1: 0xb0a090, c2: 0xb0a090 } });
      p.setPos(T.x + d[0] * R0, T.y + d[1] * R0, T.z + d[2] * R0);
      p.setVel(T.vx + (ix / inn) * v, T.vy + (iy / inn) * v, T.vz + (iz / inn) * v);
      p.dens = 2.6;
      this.world.add(p);
    }
  }

  /** delete everything under a brush, a CSS-pixel position */
  eraseAt(cssX: number, cssY: number, radiusCss: number) {
    const v = this.view;
    const x = cssX / PIX, y = cssY / PIX, rr = radiusCss / PIX;
    let n = 0;
    for (const b of this.world.bodies) {
      if (!b.alive) continue;
      const dx = v.sx(b.x) - x, dy = v.sy(b.y) - y;
      if (dx * dx + dy * dy < rr * rr) { this.world.kill(b); n++; }
    }
    if (n) this.world.structural();
  }

  /** A new body from the armed catalogue entry or the builder. */
  spawnArmed(): Body | null {
    if (!this.armed) return null;
    if (this.armed !== 'custom') return makeBody(this.armed);
    return buildCustom(this.custom);
  }

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
    this.remember(`placing ${b.name}`);
    b.setPos(p.x, p.y, p.z);
    b.setVel(v.x, v.y, v.z);
    this.world.add(b);
    const extra = this.armed ? ENTRY.get(this.armed)?.extra : undefined;
    if (extra) placeExtras(this.world, b, extra, (this.view.W / this.view.scale) * 0.25);
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

    if (this.bombard && !this.paused) this.rain(dtReal);
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
        impact: name ?? 'Catastrophic impact', merge: name ?? 'Merger', crater: '', graze: 'Hit-and-run', swallow: 'Swallowed', strip: name ?? 'Tidally stripped', evaporate: name ?? 'A black hole evaporated', airburst: '', gw: name ?? 'Gravitational waves from a merger', flare: name ?? 'Magnetar flare', wormhole: name ?? '',
      }[e.kind];
      if (msg && (e.energy > 0.3 || e.kind !== 'merge')) this.onToast(msg);
    }
    this.world.events.length = 0;

    this.frameNo++;
    this.hosts = assignHosts(this.world.sources);
    this.visual = this.world.bodies.filter(b => b.alive && (b.source || !b.isParticle));
    if (this.frameNo % 120 === 0) for (const b of this.testHosts.keys()) if (!b.alive) this.testHosts.delete(b);

    if (this.mode3d && this.v3) {
      this.v3.frame(dtReal);
      this.onFrame();
      return;
    }
    this.view.setCentre(this.centre(), dtReal);
    this.view.overlay = this.overlay;
    this.view.render({
      bodies: this.world.bodies, visual: this.visual, sources: this.world.sources,
      hostOf: this.hostOf, hillOf: this.hillOf, flags: this.flags, selected: this.selected, focus: this.focus,
      dtSim: got, dtReal, timeReal: now / 1000, simTime: this.world.time,
    });
    this.updateLabels();
    this.onFrame();
  }

  /** what the tools draw on top: the ruler, the push arrow, the eraser */
  private overlay = (ctx: CanvasRenderingContext2D) => {
    const v = this.view;
    const pos = (e: End) => ('alive' in e ? { x: e.x, y: e.y, z: e.z } : e);
    if (this.ruler) {
      const a = pos(this.ruler.a), b = pos(this.ruler.b);
      const ax = v.sx(a.x), ay = v.sy(a.y), bx = v.sx(b.x), by = v.sy(b.y);
      ctx.strokeStyle = 'rgba(143,180,255,0.95)';
      ctx.setLineDash([4, 2]);
      ctx.beginPath(); ctx.moveTo(Math.round(ax) + 0.5, Math.round(ay) + 0.5); ctx.lineTo(Math.round(bx) + 0.5, Math.round(by) + 0.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#8fb4ff';
      for (const [x, y] of [[ax, ay], [bx, by]]) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    }
    if (this.push && this.push.b.alive) {
      const b = this.push.b, dv = this.push.dv;
      const k = this.pushScale(b);
      const x0 = v.sx(b.x), y0 = v.sy(b.y), x1 = x0 + (dv.x / k) * 60 / PIX, y1 = y0 - (dv.y / k) * 60 / PIX;
      ctx.strokeStyle = '#ffd27a';
      ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5); ctx.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5); ctx.stroke();
      const a = Math.atan2(y1 - y0, x1 - x0);
      ctx.fillStyle = '#ffd27a';
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) ctx.fillRect(Math.round(x1 - Math.cos(a + s * 0.5) * i), Math.round(y1 - Math.sin(a + s * 0.5) * i), 1, 1);
    }
    if (this.brush && this.tool === 'erase') {
      ctx.strokeStyle = 'rgba(255,122,106,0.8)';
      ctx.beginPath(); ctx.arc(this.brush.x / PIX, this.brush.y / PIX, 14 / PIX * 2, 0, 2 * Math.PI); ctx.stroke();
    }
  };

  /** speed (AU/yr) that one unit of push-arrow stands for: the body's own orbital speed, so a push is always in proportion */
  pushScale(b: Body) {
    const h = this.hostOf(b);
    if (!h) return Math.max(KMS, Math.hypot(b.vx, b.vy, b.vz) * 0.3);
    const r = Math.hypot(b.x - h.x, b.y - h.y, b.z - h.z);
    return Math.sqrt((G * h.m) / r);
  }

  /** what the ruler says */
  rulerText(): string | null {
    if (!this.ruler) return null;
    const pos = (e: End) => ('alive' in e ? e : null);
    const ea = pos(this.ruler.a), eb = pos(this.ruler.b);
    const a = ea ?? (this.ruler.a as P3), b = eb ?? (this.ruler.b as P3);
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    // body to body: surface to surface as well as centre to centre
    const gap = ea && eb ? d - ea.r - eb.r : null;
    const light = d * 499.004784; // light takes 499 s to cross an AU
    let t = `${fmtLength(d)} · light ${fmtSeconds(light)}`;
    if (gap !== null && gap > 0 && gap < d * 0.999) t += ` · gap ${fmtLength(gap)}`;
    if (ea && eb) {
      const dv = Math.hypot(ea.vx - eb.vx, ea.vy - eb.vy, ea.vz - eb.vz);
      t += ` · relative speed ${sig(dv / KMS, 3)} km/s`;
    }
    return t;
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
