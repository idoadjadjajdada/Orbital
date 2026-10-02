import * as THREE from 'three';
import type { App } from '../app';
import type { Body } from '../physics/body';
import { AU_M, C, schwarzschild, fmtLength, sig } from '../physics/units';
import { buildMap, paintCrater, ringTau, type SurfaceMap } from '../pixel/surface';
import { bodyFrame, starRGB, type V3 } from '../pixel/sprites';
import { bodyAxis, tintOf } from '../pixel/renderer';
import { Controls3D } from './controls';
import { Ship, CRUISE, OD_MAX } from './ship';
import { Radar, fmtTime } from './radar';

/**
 * The sandbox seen from inside it, at true scale. The scene is laid out in
 * metres relative to the viewer, who always sits at the origin — a floating
 * origin, so a camera a metre from a moon and a star a light-year off are
 * both drawn without losing precision — with a logarithmic depth buffer for
 * the 10²⁰ range of distances. It renders at half resolution with nearest
 * filtering and a few lighting steps, to keep the pixel-art look.
 *
 * The viewer is a free-flying body: it rides along with whatever pulls on it
 * hardest, so worlds do not race away at tens of km/s, and flies at a speed
 * that scales with its height above the nearest surface.
 */

interface Obj { group: THREE.Group; kind: 'world' | 'star' | 'hole' | 'white' | 'worm' | 'craft'; map?: SurfaceMap; tex?: THREE.DataTexture; seen: Set<object>; mat?: THREE.ShaderMaterial; jet?: THREE.Group; style?: string }

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
void main() {
  vObj = position;
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform vec3 lightDir;
uniform vec3 lightCol;
uniform float lit;
uniform float heat;
uniform vec3 atmo;
uniform float hasAtmo;
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vObj);
  float lon = atan(n.y, n.x);
  if (lon < 0.0) lon += 6.2831853;
  float lat = asin(clamp(n.z, -1.0, 1.0));
  vec4 tex = texture2D(map, vec2(lon / 6.2831853, lat / 3.14159265 + 0.5));
  vec3 N = normalize(vWorldN);
  // lit in a few steps, like the sprites
  float d = lit > 0.5 ? max(dot(N, lightDir), 0.0) : 0.45;
  d = floor(d * 4.0 + 0.5) / 4.0;
  vec3 col = tex.rgb * (0.04 + d * lightCol);
  col += tex.a * vec3(1.0, 0.45, 0.12);
  col = max(col, heat * vec3(1.0, 0.35, 0.08) * 0.8);
  // a thin sky seen edge-on
  vec3 V = normalize(-vWorldP);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += hasAtmo * atmo * rim * (0.15 + 0.85 * max(dot(N, lightDir) + 0.3, 0.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const RING_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D prof;
uniform float rIn;
uniform float rOut;
uniform vec3 col;
uniform vec3 lightCol;
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vObj.xy);
  float t = (r - rIn) / (rOut - rIn);
  if (t < 0.0 || t > 1.0) discard;
  float a = texture2D(prof, vec2(t, 0.5)).r;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * (0.25 + 0.75 * lightCol), a);
}`;

export class View3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private objs = new Map<Body, Obj>();
  private markers: THREE.Points;
  private parts: THREE.Points;
  private sky: THREE.Points;
  private glowTex: THREE.Texture;
  private sphere = new THREE.SphereGeometry(1, 48, 24);
  private labels: HTMLElement;
  private labelEls = new Map<Body, HTMLElement>();
  controls: Controls3D;
  ship: Ship;
  radar: Radar;
  active = false;
  /** overdrive switched on by the autopilot, to switch off on arrival */
  private autoOd = false;

  /** where the viewer is: an offset (AU) from the body it rides with, a velocity (m/s) relative to it, and which way it faces */
  pilot = { anchor: null as Body | null, off: [0, 0, 0] as V3, vel: [0, 0, 0] as V3 };
  /** flying to a body: it, and how close to stop */
  travel: { b: Body; stop: number } | null = null;

  constructor(readonly app: App) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'c3';
    this.canvas.hidden = true;
    document.body.insertBefore(this.canvas, document.body.firstChild?.nextSibling ?? null);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(0.5);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.5, 1e19);
    this.camera.up.set(0, 0, 1);
    this.glowTex = glowTexture();
    this.sky = starField();
    this.scene.add(this.sky);
    this.markers = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    this.markers.frustumCulled = false;
    this.scene.add(this.markers);
    this.parts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.parts.frustumCulled = false;
    this.scene.add(this.parts);
    this.labels = document.createElement('div');
    this.labels.id = 'labels3';
    this.labels.hidden = true;
    document.body.appendChild(this.labels);
    this.controls = new Controls3D(this);
    this.ship = new Ship(this.camera, this.scene, this.glowTex);
    this.radar = new Radar({
      camera: this.camera,
      where: () => this.where(),
      bodies: () => this.app.visual,
      selected: () => this.app.selected,
      select: b => this.app.select(b),
      go: b => { this.app.select(b); this.goTo(b); },
      jump: b => { this.app.select(b); this.jumpTo(b); },
      canJump: () => this.ship.ready(),
      eta: d => this.eta(d),
    });
    this.controls.root.appendChild(this.radar.el);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Step into the sandbox beside the selected body (or the followed one, or the heaviest). */
  enter() {
    this.active = true;
    this.canvas.hidden = false;
    this.labels.hidden = false;
    this.controls.show(true);
    const a = this.app;
    const b = a.selected ?? a.focus ?? [...a.world.sources].sort((p, q) => q.m - p.m)[0] ?? null;
    this.pilot.anchor = b;
    this.pilot.vel = [0, 0, 0];
    this.travel = null;
    this.ship.jump = null;
    this.ship.od = false;
    this.ship.odLevel = 0;
    if (b) {
      const d = Math.max(b.r * 4, 2e-7);
      this.pilot.off = [d * 0.8, -d * 0.55, d * 0.25];
      this.camera.position.set(0, 0, 0);
      this.camera.lookAt(-this.pilot.off[0], -this.pilot.off[1], -this.pilot.off[2]);
    } else this.pilot.off = [0, 0, 0];
    this.resize();
  }

  exit() {
    this.active = false;
    this.canvas.hidden = true;
    this.labels.hidden = true;
    this.controls.show(false);
    for (const el of this.labelEls.values()) el.remove();
    this.labelEls.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** the viewer's position in the simulation, AU */
  where(): V3 {
    const a = this.pilot.anchor;
    return [(a?.x ?? 0) + this.pilot.off[0], (a?.y ?? 0) + this.pilot.off[1], (a?.z ?? 0) + this.pilot.off[2]];
  }

  /** the body nearest the viewer, and the height above its surface (m) */
  nearest(): { b: Body | null; alt: number } {
    const p = this.where();
    let best: Body | null = null, alt = Infinity;
    for (const b of this.app.visual) {
      const d = (Math.hypot(b.x - p[0], b.y - p[1], b.z - p[2]) - this.visR(b)) * AU_M;
      if (d < alt) { alt = d; best = b; }
    }
    return { b: best, alt };
  }

  /** what the viewer rides with: whatever pulls hardest where it is */
  private pickAnchor() {
    const p = this.where();
    let best: Body | null = null, g = 0;
    for (const s of this.app.world.sources) {
      const d2 = (s.x - p[0]) ** 2 + (s.y - p[1]) ** 2 + (s.z - p[2]) ** 2;
      const a = s.m / Math.max(d2, s.r * s.r);
      if (a > g) { g = a; best = s; }
    }
    const old = this.pilot.anchor;
    if (best && best !== old) {
      // keep the viewer where it is and how it moves through space
      const v = this.pilot.vel;
      if (old && old.alive) for (let k = 0; k < 3; k++) v[k] += ([old.vx, old.vy, old.vz][k] - [best.vx, best.vy, best.vz][k]) * AU_M / (365.25 * 86400);
      this.pilot.off = [p[0] - best.x, p[1] - best.y, p[2] - best.z];
      this.pilot.anchor = best;
    }
  }

  private visR(b: Body) { return b.cls === 'bh' && !b.look.wormhole && !b.look.white ? 2.6 * schwarzschild(b.m) : b.r; }

  /** go to a body: fly there and stop a few radii out */
  goTo(b: Body) {
    const stop = Math.max(this.visR(b) * 3, b.look.craft ? 1e-9 : 2e-8);
    this.travel = { b, stop };
  }

  // ---------------------------------------------------------------- frame
  frame(dtReal: number) {
    if (!this.active) return;
    const app = this.app;
    if (this.pilot.anchor && !this.pilot.anchor.alive) this.pilot.anchor = null;
    this.pickAnchor();
    this.controls.update(dtReal);
    const arrive = this.ship.update(dtReal);
    if (arrive) this.arrive(arrive);
    this.fly(dtReal);
    const P = this.where();
    const cam = this.camera;
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld();

    // light: the star that lights each body best
    const stars = app.world.sources.filter(s => (s.cls === 'star' || s.cls === 'wd') && (s.star?.L ?? 0) > 0);
    const seen = new Set<Body>();
    const tanPx = Math.tan((cam.fov * Math.PI) / 360) / (window.innerHeight / 4);
    const mk: number[] = [], mc: number[] = [];
    for (const b of app.visual) {
      const rel: V3 = [(b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M];
      const dist = Math.hypot(rel[0], rel[1], rel[2]);
      const R = this.visR(b) * AU_M;
      const angPx = R / Math.max(dist, 1) / tanPx;
      // a marker for everything too small to see as a disc
      if (angPx < 2.5) {
        const t = tintOf(b);
        mk.push(rel[0], rel[1], rel[2]);
        mc.push(t[0], t[1], t[2]);
      }
      const glowy = b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns' || b.look.white;
      if (angPx < 0.6 && !glowy && !b.feed) continue;
      seen.add(b);
      let o = this.objs.get(b);
      if (!o) { o = this.build(b); this.objs.set(b, o); this.scene.add(o.group); }
      o.group.visible = true;
      o.group.position.set(rel[0], rel[1], rel[2]);
      this.update(b, o, stars, R);
    }
    for (const [b, o] of this.objs) {
      if (!b.alive) { this.scene.remove(o.group); dispose(o); this.objs.delete(b); continue; }
      if (!seen.has(b)) o.group.visible = false;
    }
    setPoints(this.markers, mk, mc);

    // particles: gas and debris
    const pp: number[] = [], pc: number[] = [];
    for (const p of app.world.bodies) {
      if (!p.alive || p.source || !p.isParticle) continue;
      pp.push((p.x - P[0]) * AU_M, (p.y - P[1]) * AU_M, (p.z - P[2]) * AU_M);
      const c = p.look.c1, h = p.heat;
      const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, bl = (c & 255) / 255;
      pc.push(Math.min(1, r + h), Math.min(1, g + h * 0.5), Math.min(1, bl + h * 0.2));
    }
    setPoints(this.parts, pp, pc);

    // the light on the hull: the star that shines brightest here
    let sun: THREE.Vector3 | null = null, best = 0;
    for (const s of stars) {
      const d2 = (s.x - P[0]) ** 2 + (s.y - P[1]) ** 2 + (s.z - P[2]) ** 2;
      if ((s.star?.L ?? 0) / d2 > best) { best = (s.star?.L ?? 0) / d2; sun = new THREE.Vector3(P[0] - s.x, P[1] - s.y, P[2] - s.z).normalize(); }
    }
    this.ship.draw(dtReal, cam, this.pilot.vel, sun);
    this.renderer.render(this.scene, cam);
    this.drawLabels(P);
    this.radar.draw();
    this.controls.hud(this.readout());
  }

  /** move the viewer: input from the controls, or the autopilot */
  private fly(dt: number) {
    const v = this.pilot.vel;
    const t = this.travel;
    if (t && t.b.alive) {
      if (t.b !== this.pilot.anchor && t.b.source) {
        // ride with the target from now on
        const p = this.where(), old = this.pilot.anchor;
        if (old) for (let k = 0; k < 3; k++) v[k] += ([old.vx, old.vy, old.vz][k] - [t.b.vx, t.b.vy, t.b.vz][k]) * AU_M / (365.25 * 86400);
        this.pilot.anchor = t.b;
        this.pilot.off = [p[0] - t.b.x, p[1] - t.b.y, p[2] - t.b.z];
      }
      const p = this.where();
      const d: V3 = [t.b.x - p[0], t.b.y - p[1], t.b.z - p[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      const gap = dist - t.stop;
      // overdrive for anything more than a few seconds away on the ordinary drive
      if (gap * AU_M > 5 * CRUISE && !this.ship.od) { this.ship.od = true; this.autoOd = true; }
      if (this.autoOd && gap * AU_M < CRUISE) { this.ship.od = false; this.autoOd = false; }
      // close the gap exponentially, no faster than the drive allows
      const want = gap > 0 ? Math.min((gap * AU_M) / 1.2, this.ship.cap(this.nearest().alt)) : 0;
      this.ship.thrust = gap > 0 ? 1 : 0;
      for (let k = 0; k < 3; k++) v[k] += ((d[k] / dist) * want - v[k]) * Math.min(1, dt * 3);
      // turn to face it
      const target = new THREE.Vector3(d[0], d[1], d[2]).normalize();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const q = new THREE.Quaternion().setFromUnitVectors(fwd, target);
      this.camera.quaternion.premultiply(new THREE.Quaternion().slerp(q, Math.min(1, dt * 3)));
      if (gap < t.stop * 0.05 || this.controls.moving()) {
        this.travel = null;
        if (gap < t.stop * 0.05) v.fill(0);
        if (this.autoOd) { this.ship.od = false; this.autoOd = false; }
      }
    } else {
      this.travel = null;
      if (this.autoOd) { this.ship.od = false; this.autoOd = false; }
      const sp = this.speed();
      const want = this.controls.thrust(sp);
      this.ship.thrust = Math.min(1, Math.hypot(want[0], want[1], want[2]) / sp);
      for (let k = 0; k < 3; k++) v[k] += (want[k] - v[k]) * Math.min(1, dt * 4);
    }
    for (let k = 0; k < 3; k++) this.pilot.off[k] += (v[k] * dt) / AU_M;
    // into a wormhole's throat, and out of the other mouth
    let n = this.nearest();
    if (n.b && n.b.look.wormhole && n.alt < 0.5 * this.visR(n.b) * AU_M) {
      const out = this.app.world.bodies.find(q => q.id === n.b!.partnerId && q.alive);
      if (out) {
        const p = this.where(), b = n.b;
        const d: V3 = [p[0] - b.x, p[1] - b.y, p[2] - b.z];
        const dl = Math.hypot(d[0], d[1], d[2]) || 1;
        this.place(out, [(d[0] / dl) * out.r * 1.8, (d[1] / dl) * out.r * 1.8, (d[2] / dl) * out.r * 1.8], false);
        this.ship.flash = 1;
        n = this.nearest();
      }
    }
    // never inside anything
    if (n.b && n.alt < 2) {
      const p = this.where(), b = n.b;
      const d: V3 = [p[0] - b.x, p[1] - b.y, p[2] - b.z];
      const dl = Math.hypot(d[0], d[1], d[2]) || 1;
      const R = this.visR(b) + 2 / AU_M;
      this.pilot.off = [b.x + (d[0] / dl) * R - (this.pilot.anchor?.x ?? 0), b.y + (d[1] / dl) * R - (this.pilot.anchor?.y ?? 0), b.z + (d[2] / dl) * R - (this.pilot.anchor?.z ?? 0)];
      const vin = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dl;
      if (vin < 0) for (let k = 0; k < 3; k++) v[k] -= (vin * d[k]) / dl;
    }
  }

  /**
   * cruising speed, m/s: half the height above the nearest surface per second,
   * scaled by the throttle, up to what the drive allows; in overdrive, the
   * most the overdrive allows here
   */
  speed() {
    const { alt } = this.nearest();
    const cap = this.ship.cap(alt);
    if (this.ship.odLevel > 0) return cap * Math.min(1, this.controls.throttle);
    return Math.min(cap, Math.max(1, Math.min(isFinite(alt) ? alt : 1e9, 1e16)) * 0.5 * this.controls.throttle);
  }

  /** start charging a jump to a body */
  jumpTo(b: Body) {
    if (this.ship.startJump(b)) { this.travel = null; this.autoOd = false; }
  }

  /** a jump completes: come out of it a few radii from the body, facing it */
  private arrive(b: Body) {
    const p = this.where();
    const d: V3 = [p[0] - b.x, p[1] - b.y, p[2] - b.z];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const stop = Math.max(this.visR(b) * 3, b.look.craft ? 1e-9 : 2e-8);
    this.place(b, [(d[0] / dl) * stop, (d[1] / dl) * stop, (d[2] / dl) * stop], true);
  }

  /** put the viewer at an offset (AU) from a body, riding with it (or what pulls hardest there); `stop` also halts and turns to face it */
  private place(b: Body, off: V3, stop: boolean) {
    const p: V3 = [b.x + off[0], b.y + off[1], b.z + off[2]];
    const old = this.pilot.anchor, v = this.pilot.vel;
    this.pilot.anchor = b.source ? b : old;
    const a = this.pilot.anchor;
    if (stop) v.fill(0);
    else if (old && a && old !== a) for (let k = 0; k < 3; k++) v[k] += ([old.vx, old.vy, old.vz][k] - [a.vx, a.vy, a.vz][k]) * AU_M / (365.25 * 86400);
    this.pilot.off = [p[0] - (a?.x ?? 0), p[1] - (a?.y ?? 0), p[2] - (a?.z ?? 0)];
    this.travel = null;
    if (stop) {
      this.camera.position.set(0, 0, 0);
      this.camera.lookAt(-off[0], -off[1], -off[2]);
    }
  }

  /** seconds to cover a distance (m), using overdrive when it is worth it */
  eta(d: number) {
    if (d < 5 * CRUISE) return d / CRUISE + 1;
    // spool, then the climb out of one well and the fall into the next, then the cruise between
    return 3 + 1.4 * Math.log(d / 3e7) + d / OD_MAX;
  }

  private readout() {
    const v = Math.hypot(...this.pilot.vel);
    const { b, alt } = this.nearest();
    const sel = this.app.selected;
    const p = this.where();
    const spd = v < 1000 ? `${v.toFixed(0)} m/s` : v < 0.01 * C * AU_M / (365.25 * 86400) ? `${sig(v / 1000, 3)} km/s` : `${sig(v / (C * AU_M / (365.25 * 86400)), 3)} c`;
    let tgt = '';
    if (sel && sel.alive) {
      const d = Math.hypot(sel.x - p[0], sel.y - p[1], sel.z - p[2]) - this.visR(sel);
      tgt = `${sel.name} · ${fmtLength(Math.max(0, d))}`;
    }
    const sh = this.ship;
    const drive = sh.jump ? `JUMP to ${sh.jump.b.name} · ${Math.max(0, 2.5 - sh.jump.t).toFixed(1)} s`
      : sh.odLevel > 0 ? `OVERDRIVE ${(sh.odLevel * 100).toFixed(0)}%${this.autoOd ? ' · auto' : ''}` : 'cruise drive';
    if (tgt && sel && !sh.jump) {
      const d = (Math.hypot(sel.x - p[0], sel.y - p[1], sel.z - p[2]) - this.visR(sel)) * AU_M;
      tgt += ` · ~${fmtTime(this.eta(Math.max(0, d)))}`;
    }
    return { speed: spd, near: b ? `${b.name} · ${fmtLength(Math.max(0, alt) / AU_M)} up` : '', target: tgt, riding: this.pilot.anchor?.name ?? '', throttle: this.controls.throttle, drive, charge: sh.charge, flash: sh.flash };
  }

  /** the body nearest the centre of view (or a screen point), within a few degrees or its own disc */
  pick(cssX?: number, cssY?: number): Body | null {
    const cam = this.camera;
    const dir = cssX === undefined
      ? new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
      : new THREE.Vector3((cssX / window.innerWidth) * 2 - 1, -(cssY! / window.innerHeight) * 2 + 1, 0.5).unproject(cam).normalize();
    const P = this.where();
    let best: Body | null = null, score = Infinity;
    for (const b of this.app.visual) {
      const rel = new THREE.Vector3((b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M);
      const dist = rel.length();
      if (!(dist > 0)) continue;
      const ang = rel.normalize().angleTo(dir);
      const allow = Math.max(Math.atan(this.visR(b) * AU_M / dist) * 1.2, cssX === undefined ? 0.03 : 0.05);
      if (ang < allow && ang / allow < score) { score = ang / allow; best = b; }
    }
    return best;
  }

  // ---------------------------------------------------------------- meshes
  private build(b: Body): Obj {
    const group = new THREE.Group();
    const o: Obj = { group, kind: 'world', seen: new Set() };
    if (b.look.craft) {
      o.kind = 'craft';
      const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: b.look.c2 }));
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.05), new THREE.MeshBasicMaterial({ color: 0x3a5a9a }));
      group.add(body, panel);
    } else if (b.look.white) {
      o.kind = 'white';
      group.add(new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: 0xffffff })));
      group.add(this.glow(0xdde8ff, 6));
    } else if (b.look.wormhole) {
      o.kind = 'worm';
      group.add(new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: 0x140830 })));
      group.add(this.glow(0x9a70ff, 3.5));
    } else if (b.cls === 'bh') {
      o.kind = 'hole';
      group.add(new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: 0x000000 })));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 96), new THREE.MeshBasicMaterial({ color: 0xffb070 }));
      group.add(ring);
    } else if (b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns') {
      o.kind = 'star';
      group.add(new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: 0xffffff })));
      group.add(this.glow(0xffffff, 5));
    } else {
      o.map = buildMap(b.look);
      o.style = `${b.look.style}|${b.look.c1}|${b.look.c2}`;
      o.tex = mapTexture(o.map);
      o.mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { map: { value: o.tex }, lightDir: { value: new THREE.Vector3(1, 0, 0) }, lightCol: { value: new THREE.Vector3(1, 1, 1) }, lit: { value: 0 }, heat: { value: 0 }, atmo: { value: new THREE.Vector3() }, hasAtmo: { value: 0 } },
      });
      group.add(new THREE.Mesh(this.sphere, o.mat));
      const rg = b.look.rings;
      if (rg) {
        const prof = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) {
          const r = rg.inner + ((rg.outer - rg.inner) * (i + 0.5)) / 256;
          const a = 1 - Math.exp(-ringTau(rg.kind, r) * (rg.kind ? 1 : rg.opacity) * 1.5);
          prof[i * 4] = prof[i * 4 + 1] = prof[i * 4 + 2] = prof[i * 4 + 3] = Math.round(a * 255);
        }
        const pt = new THREE.DataTexture(prof, 256, 1, THREE.RGBAFormat);
        pt.needsUpdate = true;
        const c = rg.color;
        const rm = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: RING_FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false,
          uniforms: { prof: { value: pt }, rIn: { value: rg.inner }, rOut: { value: rg.outer }, col: { value: new THREE.Vector3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255) }, lightCol: { value: new THREE.Vector3(1, 1, 1) } },
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(rg.inner, rg.outer, 160, 1), rm);
        ring.name = 'rings';
        group.add(ring);
      }
    }
    return o;
  }

  private glow(color: number, k: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(k * 2);
    s.name = 'glow';
    return s;
  }

  private update(b: Body, o: Obj, stars: Body[], Rm: number) {
    const g = o.group;
    if (o.kind === 'craft') {
      g.scale.setScalar(Math.max(Rm, 1));
      return;
    }
    if (o.kind === 'star') {
      const c = b.cls === 'ns' ? [0.6, 0.75, 1] : starRGB(b.star?.teff ?? 5772);
      const mesh = g.children[0] as THREE.Mesh;
      (mesh.material as THREE.MeshBasicMaterial).color.setRGB(c[0], c[1], c[2]);
      const glow = g.children[1] as THREE.Sprite;
      glow.material.color.setRGB(c[0], c[1], c[2]);
      g.scale.setScalar(Rm);
      return;
    }
    if (o.kind !== 'world') {
      g.scale.setScalar(Rm);
      if (o.kind === 'hole') this.jets(b, o, Rm);
      return;
    }
    // a world: its turning frame, its light, its craters
    if (o.style !== `${b.look.style}|${b.look.c1}|${b.look.c2}`) {
      o.map = buildMap(b.look); o.style = `${b.look.style}|${b.look.c1}|${b.look.c2}`; o.seen.clear();
      writeMap(o.tex!, o.map);
    }
    const spin = (b.spinAngle ?? 0);
    const [fx, fy, fz] = bodyFrame(bodyAxis(b), spin);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...fx), new THREE.Vector3(...fy), new THREE.Vector3(...fz));
    g.quaternion.setFromRotationMatrix(m);
    g.scale.setScalar(Rm);
    let fresh = false;
    for (const c of b.craters) {
      if (o.seen.has(c) || o.map!.gas) continue;
      o.seen.add(c);
      paintCrater(o.map!, c.x * fx[0] + c.y * fx[1] + c.z * fx[2], c.x * fy[0] + c.y * fy[1] + c.z * fy[2], c.x * fz[0] + c.y * fz[1] + c.z * fz[2], c.a);
      fresh = true;
    }
    if (fresh) writeMap(o.tex!, o.map!);
    const u = o.mat!.uniforms;
    let best: Body | null = null, bf = 0;
    for (const s of stars) {
      if (s === b) continue;
      const f = s.star!.L / ((s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2);
      if (f > bf) { bf = f; best = s; }
    }
    if (best) {
      (u.lightDir.value as THREE.Vector3).set(best.x - b.x, best.y - b.y, best.z - b.z).normalize();
      const c = starRGB(best.star!.teff);
      (u.lightCol.value as THREE.Vector3).set(0.55 + 0.6 * c[0], 0.55 + 0.6 * c[1], 0.55 + 0.6 * c[2]);
      u.lit.value = 1;
    } else u.lit.value = 0;
    u.heat.value = b.heat;
    if (b.look.atmo !== undefined) {
      const a = b.look.atmo;
      (u.atmo.value as THREE.Vector3).set(((a >> 16) & 255) / 255, ((a >> 8) & 255) / 255, (a & 255) / 255);
      u.hasAtmo.value = 1;
    } else u.hasAtmo.value = 0;
  }

  /** jets from a feeding hole, along its spin, as long as it is big */
  private jets(b: Body, o: Obj, Rm: number) {
    const on = b.feed > 0 && b.feedLeft > 0;
    if (!on) { if (o.jet) o.jet.visible = false; return; }
    if (!o.jet) {
      o.jet = new THREE.Group();
      for (const s of [1, -1]) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.04, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x9ab8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        cone.position.y = s * 0.5;
        cone.rotation.x = s > 0 ? Math.PI : 0;
        o.jet.add(cone);
      }
      o.group.add(o.jet);
    }
    o.jet.visible = true;
    const L = 3000;
    o.jet.scale.set(L, L, L);
    const ax = new THREE.Vector3(b.lx, b.ly, b.lz).normalize();
    o.jet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax);
    void Rm;
  }

  private drawLabels(P: V3) {
    const cam = this.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const want = new Set<Body>();
    const cands = this.app.visual
      .map(b => ({ b, d: Math.hypot(b.x - P[0], b.y - P[1], b.z - P[2]) }))
      .filter(x => x.b === this.app.selected || x.b.source)
      .sort((a, c) => (c.b === this.app.selected ? 1 : 0) - (a.b === this.app.selected ? 1 : 0) || a.d - c.d)
      .slice(0, 14);
    const v = new THREE.Vector3();
    for (const { b } of cands) {
      v.set((b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M).project(cam);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      want.add(b);
      let el = this.labelEls.get(b);
      if (!el) { el = document.createElement('div'); el.className = 'lbl'; this.labels.appendChild(el); this.labelEls.set(b, el); }
      if (el.textContent !== b.name) el.textContent = b.name;
      el.style.left = `${((v.x + 1) / 2) * W + 8}px`;
      el.style.top = `${((1 - v.y) / 2) * H}px`;
      el.classList.toggle('sel', b === this.app.selected);
    }
    for (const [b, el] of this.labelEls) if (!want.has(b)) { el.remove(); this.labelEls.delete(b); }
  }
}

function mapTexture(m: SurfaceMap) {
  const t = new THREE.DataTexture(new Uint8Array(m.w * m.h * 4), m.w, m.h, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  writeMap(t, m);
  return t;
}

function writeMap(t: THREE.DataTexture, m: SurfaceMap) {
  const d = t.image.data as Uint8Array;
  for (let k = 0; k < m.w * m.h; k++) {
    d[k * 4] = m.rgb[k * 3] * 255; d[k * 4 + 1] = m.rgb[k * 3 + 1] * 255; d[k * 4 + 2] = m.rgb[k * 3 + 2] * 255;
    d[k * 4 + 3] = Math.min(1, m.emit[k]) * 255;
  }
  t.needsUpdate = true;
}

function setPoints(p: THREE.Points, pos: number[], col: number[]) {
  const g = p.geometry;
  const n = pos.length / 3;
  let a = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!a || a.count < n) {
    const cap = Math.max(64, Math.ceil(n * 1.5));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    a = g.getAttribute('position') as THREE.BufferAttribute;
  }
  (a.array as Float32Array).set(pos);
  ((g.getAttribute('color') as THREE.BufferAttribute).array as Float32Array).set(col);
  a.needsUpdate = true;
  (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  g.setDrawRange(0, n);
}

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** the sky at infinity: stars in their real spread of colour and brightness */
function starField() {
  const n = 5000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < n; k++) {
    const z = 2 * rnd() - 1, p = 2 * Math.PI * rnd(), q = Math.sqrt(1 - z * z);
    const R = 1e18;
    pos[k * 3] = R * q * Math.cos(p); pos[k * 3 + 1] = R * q * Math.sin(p); pos[k * 3 + 2] = R * z;
    const t = starRGB(2500 + 30000 * rnd() ** 3), b = 0.25 + 0.75 * rnd() ** 4;
    col[k * 3] = t[0] * b; col[k * 3 + 1] = t[1] * b; col[k * 3 + 2] = t[2] * b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}

function dispose(o: Obj) {
  o.group.traverse(x => {
    const m = x as THREE.Mesh;
    if (m.geometry && m.geometry.type !== 'SphereGeometry') m.geometry.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat) mat.dispose();
  });
  o.tex?.dispose();
}

