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
import { NavMap } from './navmap';
import { Interior, STATIONS, EYE, walk, type Station } from './interior';
import { WormholeFx } from './wormhole';

/** where the pilot sits, ship frame, m */
const HELM = new THREE.Vector3(0, EYE + 0.05, -6.2);

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

export type Mode3 = 'pilot' | 'walk' | 'eva';

const YEAR_S = 365.25 * 86400;
const UP = new THREE.Vector3(0, 0, 1);

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
  nav: NavMap;
  interior: Interior;
  private fx: WormholeFx;
  active = false;
  /** overdrive switched on by the autopilot, to switch off on arrival */
  private autoOd = false;

  /** the ship: an offset (AU) from the body it rides with, a velocity (m/s) relative to it */
  pilot = { anchor: null as Body | null, off: [0, 0, 0] as V3, vel: [0, 0, 0] as V3 };
  /** which way the ship faces (−z forward, +y up) */
  shipQ = new THREE.Quaternion();
  /** flying to a body: it, and how close to stop */
  travel: { b: Body; stop: number } | null = null;

  /** at the helm, on foot inside, or outside in a suit */
  mode: Mode3 = 'pilot';
  /** on foot: where you stand in the ship (m, ship frame) and where you look */
  me = { pos: new THREE.Vector3(0, EYE, -5), yaw: 0, pitch: 0 };
  /** in a suit: where you are relative to the ship (m, world frame), your velocity relative to it, which way you face, flying home */
  eva = { off: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), home: false };
  /** looking through the telescope */
  scope = false;

  constructor(readonly app: App) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'c3';
    this.canvas.hidden = true;
    document.body.insertBefore(this.canvas, document.body.firstChild?.nextSibling ?? null);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(0.5);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1e19);
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
    this.ship = new Ship(this.camera, this.scene, this.glowTex);
    this.interior = new Interior();
    this.scene.add(this.interior.group);
    this.fx = new WormholeFx(this.scene);
    this.controls = new Controls3D(this);
    this.radar = new Radar({
      q: () => this.shipQ,
      where: () => this.where(),
      bodies: () => this.app.visual,
      selected: () => this.app.selected,
      select: b => this.app.select(b),
      open: () => this.nav.toggle(true),
    });
    this.nav = new NavMap({
      where: () => this.where(),
      heading: () => new THREE.Vector3(0, 0, -1).applyQuaternion(this.shipQ),
      bodies: () => this.app.visual,
      selected: () => this.app.selected,
      select: b => this.app.select(b),
      hostOf: b => this.app.hostOf(b),
      go: b => { this.app.select(b); this.goTo(b); },
      jump: b => { this.app.select(b); this.jumpTo(b); },
      canJump: () => this.ship.ready(),
      eta: d => this.eta(d),
      route: () => this.travel?.b ?? this.ship.jump?.b ?? null,
      onClose: () => {},
    });
    this.controls.root.appendChild(this.radar.el);
    this.controls.root.appendChild(this.nav.el);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Step into the sandbox beside the selected body (or the followed one, or the heaviest), at the helm. */
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
    this.mode = 'pilot';
    this.scope = false;
    if (b) {
      const d = Math.max(b.r * 4, 2e-7);
      this.pilot.off = [d * 0.8, -d * 0.55, d * 0.25];
      this.face(new THREE.Vector3(-this.pilot.off[0], -this.pilot.off[1], -this.pilot.off[2]));
    } else this.pilot.off = [0, 0, 0];
    this.resize();
  }

  exit() {
    this.active = false;
    this.canvas.hidden = true;
    this.labels.hidden = true;
    this.controls.show(false);
    this.nav.toggle(false);
    for (const el of this.labelEls.values()) el.remove();
    this.labelEls.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** turn the ship to face a direction (world) */
  private face(dir: THREE.Vector3) {
    this.shipQ.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, UP));
  }

  /** the ship's position in the simulation, AU */
  where(): V3 {
    const a = this.pilot.anchor;
    return [(a?.x ?? 0) + this.pilot.off[0], (a?.y ?? 0) + this.pilot.off[1], (a?.z ?? 0) + this.pilot.off[2]];
  }

  /** where the viewer is relative to the ship's centre, m, world frame */
  viewOff(): THREE.Vector3 {
    if (this.mode === 'eva') return this.eva.off.clone();
    if (this.mode === 'walk') return this.me.pos.clone().applyQuaternion(this.shipQ);
    if (this.ship.view === 'cockpit') return HELM.clone().applyQuaternion(this.shipQ);
    return new THREE.Vector3();
  }

  /** is the viewer inside the ship (on foot, or at the helm in the cockpit view) */
  inside() { return this.mode === 'walk' || (this.mode === 'pilot' && this.ship.view === 'cockpit'); }

  /** the body nearest the ship, and the height above its surface (m) */
  nearest(): { b: Body | null; alt: number } {
    const p = this.where();
    let best: Body | null = null, alt = Infinity;
    for (const b of this.app.visual) {
      const d = (Math.hypot(b.x - p[0], b.y - p[1], b.z - p[2]) - this.visR(b)) * AU_M;
      if (d < alt) { alt = d; best = b; }
    }
    return { b: best, alt };
  }

  /** what the ship rides with: whatever pulls hardest where it is */
  private pickAnchor() {
    const p = this.where();
    let best: Body | null = null, g = 0;
    for (const s of this.app.world.sources) {
      const d2 = (s.x - p[0]) ** 2 + (s.y - p[1]) ** 2 + (s.z - p[2]) ** 2;
      const a = s.m / Math.max(d2, s.r * s.r);
      if (a > g) { g = a; best = s; }
    }
    const old = this.pilot.anchor;
    if (best && best !== old) this.reanchor(best);
  }

  /** ride with another body, keeping where the ship is and how it moves through space */
  private reanchor(b: Body) {
    const p = this.where(), old = this.pilot.anchor, v = this.pilot.vel;
    if (old && old.alive) for (let k = 0; k < 3; k++) v[k] += ([old.vx, old.vy, old.vz][k] - [b.vx, b.vy, b.vz][k]) * AU_M / YEAR_S;
    this.pilot.off = [p[0] - b.x, p[1] - b.y, p[2] - b.z];
    this.pilot.anchor = b;
  }

  private visR(b: Body) { return b.cls === 'bh' && !b.look.wormhole && !b.look.white ? 2.6 * schwarzschild(b.m) : b.r; }

  /** go to a body: fly there and stop a few radii out */
  goTo(b: Body) {
    if (this.ship.jump) return;
    const stop = Math.max(this.visR(b) * 3, b.look.craft ? 1e-9 : 2e-8);
    this.travel = { b, stop };
  }

  // ---------------------------------------------------------------- modes
  /** get up from the helm, onto the bridge */
  standUp() {
    this.mode = 'walk';
    this.me.pos.set(0, EYE, -5.2);
    this.me.yaw = 0; this.me.pitch = 0;
  }

  /** what is within reach on foot */
  station(): Station | null {
    if (this.mode !== 'walk') return null;
    let best: Station | null = null, bd = Infinity;
    for (const s of STATIONS) {
      const d = Math.hypot(this.me.pos.x - s.x, this.me.pos.z - s.z);
      if (d < s.r && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** the room you are in */
  room() {
    const z = this.me.pos.z;
    return z < -3 ? 'Bridge' : z < 6.5 ? 'Commons' : z < 12.5 ? 'Engine room' : 'Airlock';
  }

  /** why the airlock will not open, or null if it will */
  lockBlocked(): string | null {
    if (this.ship.jump) return 'not in a wormhole';
    if (this.travel || this.ship.odLevel > 0) return 'stop the ship first';
    if (Math.hypot(...this.pilot.vel) > 50) return 'the ship is still moving';
    return null;
  }

  /** how far the suit is from the airlock, m */
  lockDist() { return this.mode === 'eva' ? this.eva.off.distanceTo(this.ship.airlock.clone().applyQuaternion(this.shipQ)) : Infinity; }

  /** use what is in front of you (on foot), get up (at the helm), go back in (in a suit) */
  interact() {
    if (this.scope) { this.scope = false; return; }
    if (this.mode === 'pilot') { this.standUp(); return; }
    if (this.mode === 'eva') {
      if (this.lockDist() < 8) {
        this.mode = 'walk';
        this.me.pos.set(-1.4, EYE, 13.6);
        this.me.yaw = -Math.PI / 2; this.me.pitch = 0;
        this.eva.home = false;
      }
      return;
    }
    const s = this.station();
    if (!s) return;
    switch (s.id) {
      case 'helm': this.mode = 'pilot'; this.ship.view = 'cockpit'; break;
      case 'map': this.nav.toggle(true); break;
      case 'scope': this.scope = true; break;
      case 'core': if (this.ship.steerable()) this.ship.od = !this.ship.od; break;
      case 'galley': this.app.onToast(['Coffee. Strong, and floating a little.', 'A ration bar. It tastes of nothing in particular.', 'Tea, while the stars go by.'][Math.floor(Math.random() * 3)]); break;
      case 'lock': {
        const why = this.lockBlocked();
        if (why) { this.app.onToast(`The airlock will not open: ${why}`); break; }
        this.mode = 'eva';
        const lock = this.ship.airlock.clone().applyQuaternion(this.shipQ);
        const out = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.shipQ);
        this.eva.off.copy(lock).addScaledVector(out, 2.5);
        this.eva.vel.copy(out).multiplyScalar(0.8);
        // facing out of the door
        this.eva.q.copy(this.shipQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
        break;
      }
    }
  }

  /** the label for what interact would do now, or null */
  interactLabel(): string | null {
    if (this.scope) return 'Leave the telescope';
    if (this.mode === 'pilot') return 'Get up';
    if (this.mode === 'eva') return this.lockDist() < 8 ? 'Go back in' : null;
    const s = this.station();
    if (!s) return null;
    return {
      helm: 'Take the helm', map: 'Star map', scope: 'Look through the telescope', galley: 'Make a drink',
      core: this.ship.od ? 'Disengage overdrive' : 'Engage overdrive',
      lock: this.lockBlocked() ? `Airlock (${this.lockBlocked()})` : 'Spacewalk',
    }[s.id];
  }

  /** turn the view: the ship at the helm, your head on foot, the suit outside */
  look(yaw: number, pitch: number, roll: number) {
    const t = new THREE.Quaternion();
    const rot = (q: THREE.Quaternion) => {
      t.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); q.multiply(t);
      t.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch); q.multiply(t);
      t.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll); q.multiply(t);
      q.normalize();
    };
    const k = this.scope ? 0.1 : 1;
    if (this.mode === 'pilot') { if (this.ship.steerable()) rot(this.shipQ); }
    else if (this.mode === 'eva') rot(this.eva.q);
    else {
      this.me.yaw += yaw * k;
      this.me.pitch = Math.max(-1.45, Math.min(1.45, this.me.pitch + pitch * k));
    }
  }

  // ---------------------------------------------------------------- frame
  frame(dtReal: number) {
    if (!this.active) return;
    const app = this.app;
    if (this.pilot.anchor && !this.pilot.anchor.alive) this.pilot.anchor = null;
    if (!this.ship.jump) this.pickAnchor();
    this.controls.update(dtReal);
    this.ship.update(dtReal);
    this.fly(dtReal);
    if (this.mode === 'walk') this.walk(dtReal);
    if (this.mode === 'eva') this.suit(dtReal);
    const P = this.where();
    const O = this.viewOff();
    const cam = this.camera;
    cam.position.set(0, 0, 0);
    if (this.mode === 'walk') {
      cam.quaternion.copy(this.shipQ)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.me.yaw))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.me.pitch));
    } else if (this.mode === 'eva') cam.quaternion.copy(this.eva.q);
    else cam.quaternion.copy(this.shipQ);
    cam.updateMatrixWorld();

    // the world outside, relative to the viewer; hidden in the tunnel
    const tunnel = this.ship.tunnel();
    const outside = tunnel === null || tunnel < 0.08 || tunnel > 0.92;
    this.sky.visible = this.markers.visible = this.parts.visible = outside;
    const rel3 = (x: number, y: number, z: number): V3 => [(x - P[0]) * AU_M - O.x, (y - P[1]) * AU_M - O.y, (z - P[2]) * AU_M - O.z];
    const stars = app.world.sources.filter(s => (s.cls === 'star' || s.cls === 'wd') && (s.star?.L ?? 0) > 0);
    const seen = new Set<Body>();
    const tanPx = Math.tan((cam.fov * Math.PI) / 360) / (window.innerHeight / 4);
    const mk: number[] = [], mc: number[] = [];
    if (outside) for (const b of app.visual) {
      const rel = rel3(b.x, b.y, b.z);
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
    if (outside) for (const p of app.world.bodies) {
      if (!p.alive || p.source || !p.isParticle) continue;
      const r = rel3(p.x, p.y, p.z);
      pp.push(r[0], r[1], r[2]);
      const c = p.look.c1, h = p.heat;
      const cr = ((c >> 16) & 255) / 255, cg = ((c >> 8) & 255) / 255, cb = (c & 255) / 255;
      pc.push(Math.min(1, cr + h), Math.min(1, cg + h * 0.5), Math.min(1, cb + h * 0.2));
    }
    setPoints(this.parts, pp, pc);

    // the light on the hull and in the windows: the star that shines brightest here
    let sun: THREE.Vector3 | null = null, best = 0;
    for (const s of stars) {
      const d2 = (s.x - P[0]) ** 2 + (s.y - P[1]) ** 2 + (s.z - P[2]) ** 2;
      if ((s.star?.L ?? 0) / d2 > best) { best = (s.star?.L ?? 0) / d2; sun = new THREE.Vector3(P[0] - s.x, P[1] - s.y, P[2] - s.z).normalize(); }
    }

    // the ship: hull, inside, drive effects
    const shipAt = O.clone().negate();
    const inside = this.inside() && !this.scope;
    this.ship.placeHull(this.mode === 'eva' ? 'world' : this.mode === 'pilot' && this.ship.view === 'chase' ? 'chase' : 'none', this.shipQ, shipAt);
    this.interior.group.visible = inside;
    if (inside) {
      this.interior.group.position.copy(shipAt);
      this.interior.group.quaternion.copy(this.shipQ);
      this.interior.update(dtReal, this.ship.warp(), !!this.ship.jump, app.visual, P, this.shipQ, app.selected, this.screenLines());
    }
    this.fx.draw(this.shipQ, shipAt, this.ship.portal(), tunnel);
    this.ship.draw(dtReal, this.shipQ, this.pilot.vel, sun);
    if (this.scope) { cam.fov = 6; cam.updateProjectionMatrix(); }

    this.renderer.render(this.scene, cam);
    this.labels.hidden = !outside;
    if (outside) this.drawLabels([P[0] + O.x / AU_M, P[1] + O.y / AU_M, P[2] + O.z / AU_M]);
    this.radar.draw();
    if (this.nav.open) this.nav.draw();
    this.controls.hud(this.readout());
  }

  /** what the bridge screens say */
  private screenLines(): string[] {
    const r = this.readout();
    return [`SPD ${r.speed}`, r.drive.toUpperCase(), r.target ? `TGT ${r.target}` : 'TGT —', `JUMP ${'#'.repeat(Math.floor(this.ship.charge * 10)).padEnd(10, '.')}`, r.near ? `NEAR ${r.near}` : ''];
  }

  /** walking about inside: the ship's artificial gravity keeps you on the floor */
  private walk(dt: number) {
    const i = this.controls.axes();
    if (this.scope) return;
    const sp = (i.boost ? 4.5 : 2.2);
    const yaw = this.me.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const from = this.me.pos.clone();
    this.me.pos.x += (fx * i.f + rx * i.s) * sp * dt;
    this.me.pos.z += (fz * i.f + rz * i.s) * sp * dt;
    walk(this.me.pos, from);
    // a little bob as you walk
    const moving = Math.hypot(i.f, i.s) > 0.1;
    this.me.pos.y = EYE + (moving ? Math.sin(performance.now() / (i.boost ? 110 : 160)) * 0.03 : 0);
  }

  /** the suit's thrusters: gentle pushes, a stabiliser that slows you when you let go, or flying home to the airlock */
  private suit(dt: number) {
    const e = this.eva;
    const lock = this.ship.airlock.clone().applyQuaternion(this.shipQ).addScaledVector(new THREE.Vector3(-1, 0, 0).applyQuaternion(this.shipQ), 2);
    if (e.home) {
      const d = lock.clone().sub(e.off), dl = d.length();
      const want = d.normalize().multiplyScalar(Math.min(dl / 1.5, 60));
      e.vel.lerp(want, Math.min(1, dt * 2));
      // turn to face the ship
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), lock.clone().sub(e.off), new THREE.Vector3(0, 1, 0).applyQuaternion(this.shipQ));
      e.q.slerp(new THREE.Quaternion().setFromRotationMatrix(m), Math.min(1, dt * 2));
      if (dl < 3) { e.home = false; e.vel.set(0, 0, 0); }
      if (this.controls.moving()) e.home = false;
    } else {
      const i = this.controls.axes();
      const acc = i.boost ? 40 : 4;
      const dir = new THREE.Vector3(i.s, i.u, -i.f).applyQuaternion(e.q);
      if (dir.lengthSq() > 1e-6) e.vel.addScaledVector(dir, acc * dt);
      else e.vel.multiplyScalar(Math.max(0, 1 - dt * 0.8));
    }
    e.off.addScaledVector(e.vel, dt);
    // the hull is solid: an ellipsoid round the ship's middle
    const local = e.off.clone().applyQuaternion(this.shipQ.clone().invert());
    const ax = [6.5, 4.5, 15], cz = 3.5;
    const nx = local.x / ax[0], ny = local.y / ax[1], nz = (local.z - cz) / ax[2];
    const k = Math.hypot(nx, ny, nz);
    if (k < 1) {
      local.set(local.x / k, local.y / k, cz + (local.z - cz) / k);
      e.off.copy(local.applyQuaternion(this.shipQ));
      e.vel.multiplyScalar(0.3);
    }
  }

  /** move the ship: the pilot's controls, the autopilot, or holding still */
  private fly(dt: number) {
    const v = this.pilot.vel;
    const t = this.travel;
    const sh = this.ship;
    if (!sh.steerable()) {
      // the wormhole drive has hold: the ship coasts to a stop and points at the mouth
      this.travel = null;
      for (let k = 0; k < 3; k++) v[k] *= Math.max(0, 1 - dt * 3);
      sh.thrust = sh.jump?.phase === 'dive' ? 1 : 0;
      if (sh.jump?.b && sh.jump.phase === 'open') this.turnTo(sh.jump.b, dt);
    } else if (t && t.b.alive) {
      if (t.b !== this.pilot.anchor && t.b.source) this.reanchor(t.b);
      const p = this.where();
      const d: V3 = [t.b.x - p[0], t.b.y - p[1], t.b.z - p[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      const gap = dist - t.stop;
      // overdrive for anything more than a few seconds away on the ordinary drive
      if (gap * AU_M > 5 * CRUISE && !sh.od) { sh.od = true; this.autoOd = true; }
      if (this.autoOd && gap * AU_M < CRUISE) { sh.od = false; this.autoOd = false; }
      // close the gap exponentially, no faster than the drive allows
      const want = gap > 0 ? Math.min((gap * AU_M) / 1.2, sh.cap(this.nearest().alt)) : 0;
      sh.thrust = gap > 0 ? 1 : 0;
      for (let k = 0; k < 3; k++) v[k] += ((d[k] / dist) * want - v[k]) * Math.min(1, dt * 3);
      this.turnTo(t.b, dt);
      if (gap < t.stop * 0.05 || (this.mode === 'pilot' && this.controls.moving())) {
        this.travel = null;
        if (gap < t.stop * 0.05) v.fill(0);
        if (this.autoOd) { sh.od = false; this.autoOd = false; }
      }
    } else {
      this.travel = null;
      if (this.autoOd) { sh.od = false; this.autoOd = false; }
      // only the pilot flies it; left alone, it comes to rest
      const sp = this.speed();
      const want = this.mode === 'pilot' ? this.controls.thrust(sp, this.shipQ) : [0, 0, 0];
      sh.thrust = Math.min(1, Math.hypot(want[0], want[1], want[2]) / sp);
      for (let k = 0; k < 3; k++) v[k] += (want[k] - v[k]) * Math.min(1, dt * (this.mode === 'pilot' ? 4 : 1));
    }
    for (let k = 0; k < 3; k++) this.pilot.off[k] += (v[k] * dt) / AU_M;
    // into a wormhole's throat: through its tunnel, and out of the other mouth
    let n = this.nearest();
    if (!sh.jump && n.b && n.b.look.wormhole && n.alt < 0.5 * this.visR(n.b) * AU_M) {
      const mouth = n.b, out = this.app.world.bodies.find(q => q.id === mouth.partnerId && q.alive);
      if (out) {
        const p = this.where();
        const d = new THREE.Vector3(p[0] - mouth.x, p[1] - mouth.y, p[2] - mouth.z).normalize();
        this.travel = null;
        sh.startTransit(() => {
          this.place(out, [d.x * out.r * 1.8, d.y * out.r * 1.8, d.z * out.r * 1.8], false);
          this.app.onToast(`Through the wormhole to ${out.name}`);
        });
      }
    }
    // never inside anything
    n = this.nearest();
    if (n.b && n.alt < 30 && !sh.jump) {
      const p = this.where(), b = n.b;
      const d: V3 = [p[0] - b.x, p[1] - b.y, p[2] - b.z];
      const dl = Math.hypot(d[0], d[1], d[2]) || 1;
      const R = this.visR(b) + 30 / AU_M;
      this.pilot.off = [b.x + (d[0] / dl) * R - (this.pilot.anchor?.x ?? 0), b.y + (d[1] / dl) * R - (this.pilot.anchor?.y ?? 0), b.z + (d[2] / dl) * R - (this.pilot.anchor?.z ?? 0)];
      const vin = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dl;
      if (vin < 0) for (let k = 0; k < 3; k++) v[k] -= (vin * d[k]) / dl;
    }
  }

  /** turn the ship towards a body, smoothly */
  private turnTo(b: Body, dt: number) {
    const p = this.where();
    const target = new THREE.Vector3(b.x - p[0], b.y - p[1], b.z - p[2]).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.shipQ);
    const q = new THREE.Quaternion().setFromUnitVectors(fwd, target);
    this.shipQ.premultiply(new THREE.Quaternion().slerp(q, Math.min(1, dt * 3)));
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

  /** open a wormhole to a body */
  jumpTo(b: Body) {
    if (b.alive && this.ship.startJump(b, () => this.arrive(b))) { this.travel = null; this.autoOd = false; }
    else if (!this.ship.ready() && !this.ship.jump) this.app.onToast('The wormhole drive is still recharging');
  }

  /** out of the tunnel: a few radii from the body, facing it */
  private arrive(b: Body) {
    if (!b.alive) return;
    const p = this.where();
    const d: V3 = [p[0] - b.x, p[1] - b.y, p[2] - b.z];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const stop = Math.max(this.visR(b) * 3, b.look.craft ? 1e-9 : 2e-8);
    this.place(b, [(d[0] / dl) * stop, (d[1] / dl) * stop, (d[2] / dl) * stop], true);
  }

  /** put the ship at an offset (AU) from a body, riding with it (or what pulls hardest there); `stop` also halts and turns to face it */
  private place(b: Body, off: V3, stop: boolean) {
    const p: V3 = [b.x + off[0], b.y + off[1], b.z + off[2]];
    const old = this.pilot.anchor, v = this.pilot.vel;
    this.pilot.anchor = b.source ? b : old;
    const a = this.pilot.anchor;
    if (stop) v.fill(0);
    else if (old && a && old !== a) for (let k = 0; k < 3; k++) v[k] += ([old.vx, old.vy, old.vz][k] - [a.vx, a.vy, a.vz][k]) * AU_M / YEAR_S;
    this.pilot.off = [p[0] - (a?.x ?? 0), p[1] - (a?.y ?? 0), p[2] - (a?.z ?? 0)];
    this.travel = null;
    if (stop) this.face(new THREE.Vector3(-off[0], -off[1], -off[2]));
  }

  /** seconds to cover a distance (m), using overdrive when it is worth it */
  eta(d: number) {
    if (d < 5 * CRUISE) return d / CRUISE + 1;
    // spool, then the climb out of one well and the fall into the next, then the cruise between
    return 3 + 1.4 * Math.log(d / 3e7) + d / OD_MAX;
  }

  readout() {
    const v = Math.hypot(...this.pilot.vel);
    const { b, alt } = this.nearest();
    const sel = this.app.selected;
    const p = this.where();
    const c = C * AU_M / YEAR_S;
    const fmtV = (v: number) => v < 1000 ? `${v.toFixed(v < 10 ? 1 : 0)} m/s` : v < 0.01 * c ? `${sig(v / 1000, 3)} km/s` : `${sig(v / c, 3)} c`;
    let tgt = '';
    if (sel && sel.alive) {
      const d = Math.hypot(sel.x - p[0], sel.y - p[1], sel.z - p[2]) - this.visR(sel);
      tgt = `${sel.name} · ${fmtLength(Math.max(0, d))}`;
    }
    const sh = this.ship, j = sh.jump;
    const drive = j ? (j.phase === 'open' ? `Opening a wormhole${j.b ? ` to ${j.b.name}` : ''}` : j.phase === 'dive' ? 'Into the wormhole' : j.phase === 'tunnel' ? 'In the wormhole' : 'Out of the wormhole')
      : this.travel ? `Autopilot to ${this.travel.b.name}${sh.odLevel > 0 ? ` · overdrive ${(sh.odLevel * 100).toFixed(0)}%` : ''}`
      : sh.odLevel > 0 ? `Overdrive ${(sh.odLevel * 100).toFixed(0)}%` : 'Cruise drive';
    if (tgt && sel && !j) {
      const d = (Math.hypot(sel.x - p[0], sel.y - p[1], sel.z - p[2]) - this.visR(sel)) * AU_M;
      tgt += ` · ~${fmtTime(this.eta(Math.max(0, d)))}`;
    }
    const suit = this.mode === 'eva' ? `${fmtV(this.eva.vel.length())} · ${this.eva.off.length().toFixed(0)} m from the ship` : '';
    return { speed: fmtV(v), near: b ? `${b.name} · ${fmtLength(Math.max(0, alt) / AU_M)} up` : '', target: tgt, riding: this.pilot.anchor?.name ?? '', throttle: this.controls.throttle, drive, charge: sh.charge, flash: sh.flash, suit };
  }

  /** the body nearest the centre of view (or a screen point), within a few degrees or its own disc */
  pick(cssX?: number, cssY?: number): Body | null {
    const cam = this.camera;
    const dir = cssX === undefined
      ? new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
      : new THREE.Vector3((cssX / window.innerWidth) * 2 - 1, -(cssY! / window.innerHeight) * 2 + 1, 0.5).unproject(cam).normalize();
    const P = this.where(), O = this.viewOff();
    let best: Body | null = null, score = Infinity;
    for (const b of this.app.visual) {
      const rel = new THREE.Vector3((b.x - P[0]) * AU_M - O.x, (b.y - P[1]) * AU_M - O.y, (b.z - P[2]) * AU_M - O.z);
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

