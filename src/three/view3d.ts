import * as THREE from 'three';
import type { App } from '../app';
import type { Body } from '../physics/body';
import { AU_M, schwarzschild, fmtLength, sig } from '../physics/units';
import { paintCrater, ringTau, cloneMap, lookKey, type SurfaceMap } from '../pixel/surface';
import { maps, MapService } from '../pixel/maps';
import { bodyFrame, starRGB, type V3 } from '../pixel/sprites';
import { bodyAxis, tintOf } from '../pixel/renderer';
import { Controls3D } from './controls';
import { Ship, POWER, CRUISE, OD_MAX, C_MS, JUMP_CHARGE, MOUTH_R, MOUTH_AHEAD, EXIT_T, type Mover, type Worm } from './ship';
import { HELM_EYE, CHASE_EYE, SCOPE_EYE, HATCH_OUT, HATCH_IN, COUCH_EYE, DECK_Y, LADDER, type StationId } from './hull';
import { Panels, sleepWarp, SLEEP_HOURS } from './panels';
import { survey } from './survey';
import { mouthMesh, tickMouth } from './wormhole';
import { Radar, fmtTime } from './radar';
import { NavMap } from './navmap';

/**
 * The sandbox seen from inside it, at true scale. The scene is laid out in
 * metres relative to the viewer, who always sits at the origin — a floating
 * origin, so a camera a metre from a moon and a star a light-year off are
 * both drawn without losing precision — with a logarithmic depth buffer for
 * the 10²⁰ range of distances. Worlds wear the same surface maps as the
 * map view, sharpening as they grow on screen.
 *
 * The ship is a free-flying body: it rides along with whatever pulls on it
 * hardest, so worlds do not race away at tens of km/s, and flies at a speed
 * that scales with its height above the nearest surface. The viewer is
 * separate from it: at the helm, on foot inside it (wherever it is going,
 * wormholes included), at its telescope, or outside it in a suit, which
 * rides along the same way.
 */

interface Obj {
  group: THREE.Group; kind: 'world' | 'star' | 'hole' | 'white' | 'worm' | 'craft';
  /** the map drawn (its own copy once cratered), the shared one it came from, and its textures: colour and glow; height, cloud and shine */
  map?: SurfaceMap; base?: SurfaceMap; owned?: boolean; tex?: THREE.DataTexture; aux?: THREE.DataTexture;
  seen: Set<object>; mat?: THREE.ShaderMaterial; clouds?: THREE.Mesh; jet?: THREE.Group; style?: string;
}

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

/** a world's surface: its map, lit smoothly, with relief from its height map and a glint off its seas */
const WORLD_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
varying vec3 vEast;
varying vec3 vNorth;
void main() {
  vObj = position;
  vec3 n = normalize(position);
  vec3 e = normalize(vec3(-n.y, n.x, 0.0) + vec3(1e-6, 0.0, 0.0));
  vWorldN = normalize(mat3(modelMatrix) * n);
  vEast = normalize(mat3(modelMatrix) * e);
  vNorth = normalize(mat3(modelMatrix) * cross(n, e));
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

/** where on the map: longitude without a seam (the nearer of two wrappings), latitude */
const MAP_UV = /* glsl */ `
vec2 mapUV(vec3 n) {
  float lon = atan(n.y, n.x) / 6.2831853;
  float u1 = fract(lon), u2 = fract(lon + 0.5) - 0.5;
  float u = fwidth(u1) <= fwidth(u2) + 1e-5 ? u1 : u2;
  return vec2(u, asin(clamp(n.z, -1.0, 1.0)) / 3.14159265 + 0.5);
}
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform sampler2D aux;
uniform vec2 texel;
uniform vec3 lightDir;
uniform vec3 lightCol;
uniform float lit;
uniform float heat;
uniform vec3 atmo;
uniform float hasAtmo;
uniform float bump;
uniform float detail;
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
varying vec3 vEast;
varying vec3 vNorth;
${MAP_UV}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vObj);
  vec2 uv = mapUV(n);
  vec4 tex = texture2D(map, uv);
  vec4 ax = texture2D(aux, uv);
  // relief: the slope of the height map tilts the surface
  float h = ax.r;
  float hE = texture2D(aux, uv + vec2(texel.x, 0.0)).r, hN = texture2D(aux, uv + vec2(0.0, texel.y)).r;
  float cl = max(0.05, sqrt(1.0 - n.z * n.z));
  vec2 g = vec2((hE - h) / (texel.x * 6.2831853) / cl, (hN - h) / (texel.y * 3.14159265));
  // and close up, finer grain than the map holds
  float fine = detail > 0.0 ? vnoise3(n * 900.0) * 0.6 + vnoise3(n * 2600.0) * 0.4 : 0.5;
  vec3 N0 = normalize(vWorldN);
  vec3 N = normalize(N0 - bump * (normalize(vEast) * g.x + normalize(vNorth) * g.y));
  vec3 col = tex.rgb * (1.0 + detail * (fine - 0.5) * 0.25);
  vec3 V = normalize(-vWorldP);
  if (lit > 0.5) {
    float dl = dot(N, lightDir), dl0 = dot(N0, lightDir);
    // a soft terminator, and no relief lit past it
    float term = clamp((dl0 + 0.03) / 0.1, 0.0, 1.0);
    vec3 c = col * (0.025 + max(dl, 0.0) * term * lightCol);
    // a glint off the sea
    vec3 H = normalize(lightDir + V);
    c += ax.b * pow(max(dot(N0, H), 0.0), 90.0) * 0.55 * term * lightCol;
    col = c;
  } else col *= 0.45;
  col += tex.a * vec3(1.0, 0.45, 0.12);
  col = max(col, heat * vec3(1.0, 0.35, 0.08) * 0.8);
  // the sky seen edge-on, brightest on the day side and reddening at the terminator
  float rim = pow(1.0 - max(dot(N0, V), 0.0), 2.5);
  float day = lit > 0.5 ? dot(N0, lightDir) : 0.3;
  vec3 sky = mix(vec3(1.0, 0.55, 0.3) * atmo, atmo, smoothstep(-0.1, 0.4, day));
  col += hasAtmo * sky * rim * clamp(day + 0.35, 0.0, 1.0) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;

/** a world's clouds: a shell just above the ground, drifting */
const CLOUD_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D aux;
uniform vec3 lightDir;
uniform vec3 lightCol;
uniform float drift;
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
${MAP_UV}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vObj);
  vec2 uv = mapUV(n);
  float c = texture2D(aux, uv + vec2(drift, 0.0)).g;
  if (c < 0.01) discard;
  vec3 N = normalize(vWorldN);
  float dl = dot(N, lightDir);
  float lit = clamp((dl + 0.05) / 0.15, 0.0, 1.0) * max(dl, 0.0) * 0.9 + 0.03;
  gl_FragColor = vec4(lightCol * lit, c * 0.95);
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


export type Mode = 'pilot' | 'walk' | 'eva' | 'scope';

const UP = new THREE.Vector3(0, 1, 0);
const YR = 365.25 * 86400;
/** the closest the ship comes to a surface, m: it is 55 m long */
const SHIP_CLEAR = 60;

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
  private labelEls = new Map<Body | string, HTMLElement>();
  controls: Controls3D;
  ship: Ship;
  radar: Radar;
  nav: NavMap;
  active = false;
  /** overdrive switched on by the autopilot, to switch off on arrival */
  private autoOd = false;

  /**
   * where you are: at the helm flying the ship, on foot inside it, outside
   * it in a suit, or at the telescope
   */
  mode: Mode = 'pilot';
  /** on foot: where you stand on the deck (ship coordinates, m), which way you face, how high you have jumped, and the seat you are in */
  foot = { p: new THREE.Vector3(1, 0, -20), deck: 0, yaw: 0, pitch: 0, y: 0, vy: 0, seat: null as null | { eye: THREE.Vector3; yaw: number } };
  /** the consoles' panels */
  panels: Panels;
  /** the captain's log: what this voyage has done */
  logbook = { start: performance.now(), metres: 0, top: 0, jumps: 0, walks: 0, sleeps: 0, coffees: 0, firsts: [] as { name: string; note: string }[] };
  /** asleep in the quarters: seconds so far, how long, the clock to go back to, and when it began (sim years) */
  private sleep: { t: number; dur: number; warp: number; from: number } | null = null;
  /** the lab's globe: whose surface it wears */
  private globeKey = '';
  private globeTex: THREE.Texture[] = [];
  /** the eye in ship coordinates, when it is inside the hull */
  private localEye: THREE.Vector3 | null = null;
  /** the render scale, lowered while frames are slow and raised again when they are quick: the frame time (ms, smoothed) and when it was last judged */
  private res = { scale: 1, ms: 16, last: 0, t: 0 };
  /** outside: the suit, which moves on its own, and which way it faces */
  suit = { nav: { anchor: null, off: [0, 0, 0], vel: [0, 0, 0] } as Mover, quat: new THREE.Quaternion() };
  /** the telescope: where it points (world) and its field of view, degrees */
  scope = { quat: new THREE.Quaternion(), fov: 8, track: false };
  /** what you can do right now where you are looking, if anything */
  prompt: { label: string; act: () => void } | null = null;
  /** the ship flying itself somewhere: to a body, or to a point (the suit), and how close to stop */
  travel: { b: Body | null; at?: () => V3; stop: number; name: string } | null = null;
  /** worlds the ship has been to, for the shelf in the commons */
  private visited: Body[] = [];
  private trophyKey = '';
  /** what the viewer's position is measured from, and the offset from it (m, world axes) */
  private base!: Mover;
  private eye = new THREE.Vector3();
  private screenT = 0;
  private shake = 0;

  constructor(readonly app: App) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'c3';
    this.canvas.hidden = true;
    document.body.insertBefore(this.canvas, document.body.firstChild?.nextSibling ?? null);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    // full resolution (up to twice the CSS pixels on a sharp screen)
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
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
    this.ship = new Ship(this.scene, this.glowTex);
    this.scene.add(this.camera);
    this.base = this.ship.nav;
    this.controls = new Controls3D(this);
    this.radar = new Radar({
      camera: this.camera,
      where: () => this.where(),
      bodies: () => this.app.visual,
      selected: () => this.app.selected,
      open: () => this.openMap(),
    });
    this.controls.root.appendChild(this.radar.el);
    this.nav = new NavMap({
      bodies: () => this.app.visual,
      hostOf: b => this.app.hostOf(b),
      selected: () => this.app.selected,
      select: b => this.app.select(b),
      ship: () => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quat); return { p: posOf(this.ship.nav), fwd: [f.x, f.y, f.z] }; },
      suit: () => (this.mode === 'eva' ? posOf(this.suit.nav) : null),
      go: b => this.goTo(b),
      jump: b => this.jumpTo(b),
      jumpBlock: () => this.jumpBlock(),
      goBlock: () => this.goBlock(),
      eta: d => this.eta(d),
      pad: this.app.pad,
      onClose: () => this.controls.mapClosed(),
    });
    this.controls.root.appendChild(this.nav.el);
    this.panels = new Panels(this);
    this.controls.root.appendChild(this.panels.el);
    this.controls.root.appendChild(this.panels.fadeEl);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** keep the frame rate up on a slow GPU: render fewer pixels while frames take too long */
  private adapt(dt: number) {
    const r = this.res, now = performance.now();
    if (r.last) r.ms += (Math.min(now - r.last, 300) - r.ms) * 0.1;
    r.last = now;
    r.t += dt;
    if (r.t < 1.5 || this.nav.open) return;
    r.t = 0;
    const was = r.scale;
    if (r.ms > 45 && r.scale > 0.4) r.scale = Math.max(0.4, r.scale * 0.75);
    else if (r.ms < 22 && r.scale < 1) r.scale = Math.min(1, r.scale / 0.75);
    if (r.scale !== was) {
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * r.scale);
      this.resize();
    }
  }

  /** Step into the sandbox at the helm, beside the selected body (or the followed one, or the heaviest). */
  enter() {
    this.active = true;
    this.canvas.hidden = false;
    this.labels.hidden = false;
    this.controls.show(true);
    const a = this.app;
    const b = a.selected ?? a.focus ?? [...a.world.sources].sort((p, q) => q.m - p.m)[0] ?? null;
    const sh = this.ship;
    sh.nav.anchor = b;
    sh.nav.vel = [0, 0, 0];
    this.travel = null;
    sh.worm = null;
    sh.od = false;
    sh.odLevel = 0;
    sh.view = 'chase';
    this.mode = 'pilot';
    this.foot.seat = null;
    this.res.last = 0;
    if (b) {
      const d = Math.max(b.r * 4, 2e-7);
      sh.nav.off = [d * 0.8, -d * 0.55, d * 0.25];
      lookAlong(sh.quat, [-sh.nav.off[0], -sh.nav.off[1], -sh.nav.off[2]]);
    } else sh.nav.off = [0, 0, 0];
    this.resize();
    this.warm();
  }

  /**
   * draw the wormhole once, into a single pixel, so its shaders are compiled
   * and ready (some drivers only finish the job at the first draw) and the
   * first transit does not stall on them
   */
  private warmed = false;
  private warm() {
    if (this.warmed) return;
    this.warmed = true;
    const sh = this.ship, r = this.renderer;
    for (const m of [sh.mouthIn, sh.mouthOut]) { m.visible = true; m.position.set(0, 0, -1000); m.scale.setScalar(100); }
    sh.tunnel.visible = true;
    const cam = this.camera, g = sh.hull.group;
    // the ship behind the camera, with the tunnel (which is part of it) still round it
    const was = g.position.clone();
    g.position.set(0, 0, 1000);
    cam.position.set(0, 0, 0);
    r.setScissorTest(true);
    // the middle pixel: looking ahead it is the mouth, looking aside the tunnel's wall
    r.setScissor(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2), 1, 1);
    for (const yaw of [0, Math.PI / 2]) {
      cam.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      cam.updateMatrixWorld();
      r.render(this.scene, cam);
    }
    r.setScissorTest(false);
    g.position.copy(was);
    sh.mouthIn.visible = sh.mouthOut.visible = sh.tunnel.visible = false;
  }

  exit() {
    this.active = false;
    this.canvas.hidden = true;
    this.labels.hidden = true;
    this.nav.show(false);
    this.panels.close();
    this.wake();
    this.controls.show(false);
    for (const el of this.labelEls.values()) el.remove();
    this.labelEls.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** the viewer's position in the simulation, AU */
  where(): V3 {
    const p = posOf(this.base);
    return [p[0] + this.eye.x / AU_M, p[1] + this.eye.y / AU_M, p[2] + this.eye.z / AU_M];
  }

  /** the body nearest a point (the viewer, by default), and the height above its surface (m) */
  nearest(p: V3 = this.where()): { b: Body | null; alt: number } {
    let best: Body | null = null, alt = Infinity;
    for (const b of this.app.visual) {
      const d = (Math.hypot(b.x - p[0], b.y - p[1], b.z - p[2]) - this.visR(b)) * AU_M;
      if (d < alt) { alt = d; best = b; }
    }
    return { b: best, alt };
  }

  /** ride with whatever pulls hardest where a mover is */
  private pickAnchor(m: Mover) {
    if (m.anchor && !m.anchor.alive) m.anchor = null;
    const p = posOf(m);
    let best: Body | null = null, g = 0;
    for (const s of this.app.world.sources) {
      const d2 = (s.x - p[0]) ** 2 + (s.y - p[1]) ** 2 + (s.z - p[2]) ** 2;
      const a = s.m / Math.max(d2, s.r * s.r);
      if (a > g) { g = a; best = s; }
    }
    if (best && best !== m.anchor) rebase(m, best);
  }

  private visR(b: Body) { return b.cls === 'bh' && !b.look.wormhole && !b.look.white ? 2.6 * schwarzschild(b.m) : b.r; }
  private stopFor(b: Body) { return Math.max(this.visR(b) * 3, b.look.craft ? 2e-9 : 2e-8); }

  // ---------------------------------------------------------------- commands
  /** why the ship cannot fly somewhere now, or '' */
  goBlock() {
    if (this.mode === 'eva') return 'Board the ship first: it holds station while you are outside';
    if (this.ship.worm) return 'Not during a wormhole transit';
    return '';
  }

  /** why the wormhole drive cannot open a way now, or '' */
  jumpBlock() {
    const sh = this.ship;
    if (this.mode === 'eva') return 'Board the ship first: it holds station while you are outside';
    if (sh.worm) return 'A transit is under way';
    if (sh.charge < 1) return `The wormhole drive is recharging: ${Math.ceil((1 - sh.charge) * sh.refill())} s`;
    return '';
  }

  /** fly to a body and stop a few radii out; a wormhole's mouth, fly on in */
  goTo(b: Body) {
    const why = this.goBlock();
    if (why) { this.app.onToast(why); return; }
    this.travel = { b, stop: b.look.wormhole ? 0 : this.stopFor(b), name: b.name };
  }

  /** open a wormhole to a body; the same again while it charges calls it off */
  jumpTo(b: Body) {
    const sh = this.ship;
    if (sh.worm?.phase === 'charge' && !sh.worm.natural) { sh.worm = null; this.app.onToast('Wormhole called off'); return; }
    const why = this.jumpBlock();
    if (why) { this.app.onToast(why); return; }
    if (!b.alive) return;
    const f = new THREE.Vector3(0, 0, -MOUTH_AHEAD / AU_M).applyQuaternion(sh.quat);
    const n = sh.nav;
    sh.worm = { phase: 'charge', t: 0, to: b, dur: 6, natural: false, mouth: { anchor: n.anchor, off: [n.off[0] + f.x, n.off[1] + f.y, n.off[2] + f.z], vel: [0, 0, 0] } };
    sh.od = false;
    this.autoOd = false;
    this.travel = null;
    this.app.onToast(`Opening a wormhole to ${b.name}`);
  }

  /** the ship comes to you, outside */
  callShip() {
    if (this.mode !== 'eva') return;
    if (relM(this.suit.nav, this.ship.nav).length() < 45) { this.app.onToast('The ship is right here: the airlock is marked'); return; }
    this.travel = { b: null, at: () => posOf(this.suit.nav), stop: 30 / AU_M, name: 'you' };
    this.app.onToast('The ship is on its way to you');
  }

  openMap() {
    this.panels.close();
    this.nav.show(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** get up from the helm, beside the chair */
  leaveHelm() {
    this.mode = 'walk';
    this.foot.p.set(1, 0, -20);
    this.foot.deck = 0;
    this.foot.yaw = 0; this.foot.pitch = -0.1;
    this.foot.seat = null;
  }

  /** use a station on board */
  use(id: StationId) {
    const sh = this.ship, toast = (m: string) => this.app.onToast(m);
    switch (id) {
      case 'helm': this.mode = 'pilot'; sh.view = 'cockpit'; break;
      case 'nav': this.openMap(); break;
      case 'scope': {
        this.mode = 'scope';
        const sel = this.app.selected;
        this.scope.fov = 8;
        this.scope.track = !!sel;
        if (sel && sel.alive) this.aimScope(sel);
        else this.scope.quat.copy(sh.quat).multiply(new THREE.Quaternion().setFromAxisAngle(UP, -Math.PI / 2));
        break;
      }
      case 'airlock': this.stepOut(); break;
      case 'couch': this.foot.seat = { eye: COUCH_EYE.clone(), yaw: Math.PI / 2 }; this.foot.yaw = Math.PI / 2; this.foot.pitch = 0; break;
      case 'coffee': this.logbook.coffees++; toast(['Coffee. It tastes of recycled air.', 'Coffee, black. The machine hums approvingly.', 'You make a coffee and watch it swirl in the artificial gravity.'][Math.floor(Math.random() * 3)]); break;
      case 'galley': toast(['You heat up a tray of hydroponic curry. Not bad.', 'Noodles again. The galley is consistent, at least.', 'You bake bread. The whole ship smells of it.', 'A protein bar, eaten standing up. Very spacefaring.'][Math.floor(Math.random() * 4)]); break;
      case 'shelf': toast(this.visited.length ? `Souvenirs: ${this.visited.map(b => b.name).join(', ')}` : 'An empty shelf. Fly close to a world to bring back a globe of it.'); break;
      case 'reactor': {
        const w = sh.worm;
        toast(`Reactor nominal · overdrive ${sh.od ? `on, ${(sh.odLevel * 100).toFixed(0)}%` : 'off'} · wormhole drive ${w ? `in transit to ${w.to.name}` : sh.charge >= 1 ? 'charged' : `recharging, ${Math.ceil((1 - sh.charge) * sh.refill())} s`}`);
        break;
      }
      case 'comms': case 'sensors': case 'survey': case 'power': case 'bay': this.panels.show(id); break;
      case 'log': this.panels.show('log'); break;
      case 'globe': this.panels.show('survey'); break;
      case 'bunk': this.goToSleep(); break;
      case 'samples': {
        const n = this.logbook.firsts.length;
        toast(n ? `${Math.min(12, n)} vial${n > 1 ? 's' : ''} of orbital scans, one per world. Real samples will need the lander.` : 'Twelve empty vials. Each world you fly close to fills one with scans; real samples will need the lander.');
        break;
      }
      case 'down': this.climb(1); break;
      case 'up': this.climb(0); break;
      case 'lander': toast('Lander 1: tanks full, hull sound, but no descent software, and the bay doors and legs are still being fitted. Not yet.'); break;
    }
  }

  /** up or down the ladder between engineering and the hangar */
  private climb(deck: number) {
    const f = this.foot;
    f.deck = deck;
    f.p.set(LADDER.x, 0, LADDER.z);
    f.yaw = -Math.PI / 2; f.pitch = 0; f.y = 0; f.vy = 0;
    this.app.onToast(deck ? 'Down the ladder to the hangar' : 'Up the ladder to engineering');
  }

  /** eight hours in the bunk: the clock runs fast for a few seconds behind closed eyes, the ship holding station */
  private goToSleep() {
    const sh = this.ship;
    if (this.travel || sh.worm || sh.od) { this.app.onToast('Not while the ship is under way: stop first, then sleep'); return; }
    if (this.sleep) return;
    const dur = 4;
    this.sleep = { t: 0, dur, warp: this.app.warpLog, from: this.app.world.time };
    this.app.warpLog = Math.log10(sleepWarp(dur));
  }

  /** the sleep, second by second: the eyes close, the clock races, the eyes open */
  private sleepStep(dt: number) {
    const z = this.sleep;
    if (!z) return;
    z.t += dt;
    const edge = 0.7;
    this.panels.setFade(Math.min(1, z.t / edge, (z.dur + edge - z.t) / edge));
    if (z.t >= z.dur && this.app.warpLog !== z.warp) {
      this.app.warpLog = z.warp;
      const h = (this.app.world.time - z.from) * 365.25 * 24;
      this.logbook.sleeps++;
      this.app.onToast(h > SLEEP_HOURS * 0.9 ? 'Good morning. Eight hours have passed.' : `You wake after ${h.toFixed(1)} hours: the simulation could not keep up with a full night`);
    }
    if (z.t >= z.dur + edge) this.wake();
  }

  /** awake again, whatever was going on */
  private wake() {
    if (!this.sleep) return;
    if (this.sleep.t < this.sleep.dur) this.app.warpLog = this.sleep.warp;
    this.sleep = null;
    this.panels.setFade(0);
  }

  /** asleep: nothing moves */
  get asleep() { return !!this.sleep; }

  /** the ship's position (AU) and velocity (m/s) in the sandbox */
  shipPos(): V3 { return posOf(this.ship.nav); }
  shipVel(): V3 {
    const n = this.ship.nav, a = n.anchor, k = AU_M / (365.25 * 86400);
    return [n.vel[0] + (a?.vx ?? 0) * k, n.vel[1] + (a?.vy ?? 0) * k, n.vel[2] + (a?.vz ?? 0) * k];
  }
  /** the stars that are shining */
  stars() { return this.app.world.sources.filter(s => (s.cls === 'star' || s.cls === 'wd') && (s.star?.L ?? 0) > 0); }
  /** what the lab surveys: the selection, or the nearest world */
  surveyTarget(): Body | null {
    const sel = this.app.selected;
    if (sel && sel.alive) return sel;
    return this.nearest(this.shipPos()).b;
  }

  /** out of the airlock, in a suit; the ship stops and holds station */
  stepOut() {
    const sh = this.ship;
    if (sh.worm) { this.app.onToast('Not in the middle of a wormhole transit'); return; }
    this.travel = null;
    sh.od = false;
    this.autoOd = false;
    sh.nav.vel = [0, 0, 0];
    const o = HATCH_OUT.clone().applyQuaternion(sh.quat);
    this.suit.nav = { anchor: sh.nav.anchor, off: [sh.nav.off[0] + o.x / AU_M, sh.nav.off[1] + o.y / AU_M, sh.nav.off[2] + o.z / AU_M], vel: [0, 0, 0] };
    this.suit.quat.copy(sh.quat).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2));
    this.mode = 'eva';
    this.logbook.walks++;
    this.app.onToast('Outside. The ship holds station; G (or X) calls it to you');
  }

  /** back in through the airlock */
  board() {
    this.mode = 'walk';
    this.foot.deck = 0;
    this.foot.p.copy(HATCH_IN);
    this.foot.yaw = -Math.PI / 2; this.foot.pitch = 0;
    this.foot.seat = null;
    this.ship.boardable = false;
  }

  /** leave the telescope, standing beside it */
  leaveScope() {
    this.mode = 'walk';
    this.foot.deck = 0;
    this.foot.p.set(4.1, 0, 1.75);
    this.foot.yaw = -Math.PI / 2; this.foot.pitch = 0;
  }

  aimScope(b: Body) {
    const P = this.where();
    lookAlong(this.scope.quat, [b.x - P[0], b.y - P[1], b.z - P[2]]);
  }

  /** turn the view, about its own axes (radians): the ship at the helm, your head on foot, the suit outside */
  turn(yaw: number, pitch: number, roll: number) {
    const rot = (q: THREE.Quaternion) => {
      const t = new THREE.Quaternion();
      t.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); q.multiply(t);
      t.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch); q.multiply(t);
      t.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll); q.multiply(t);
      q.normalize();
    };
    if (this.mode === 'pilot') { if (!this.ship.worm || this.ship.worm.phase === 'charge') rot(this.ship.quat); }
    else if (this.mode === 'eva') rot(this.suit.quat);
    else if (this.mode === 'scope') { const k = this.scope.fov / 70; yaw *= k; pitch *= k; roll = 0; rot(this.scope.quat); this.scope.track = false; }
    else {
      this.foot.yaw += yaw;
      this.foot.pitch = Math.max(-1.45, Math.min(1.45, this.foot.pitch + pitch));
    }
  }

  // ---------------------------------------------------------------- frame
  frame(dtReal: number) {
    if (!this.active) return;
    this.adapt(dtReal);
    const app = this.app, sh = this.ship;
    if (!sh.worm || sh.worm.phase !== 'tunnel') this.pickAnchor(sh.nav);
    if (this.mode === 'eva') this.pickAnchor(this.suit.nav);
    this.controls.update(dtReal);
    this.panels.tick(dtReal);
    this.sleepStep(dtReal);
    sh.update(dtReal);
    if (sh.worm) this.wormStep(dtReal); else this.fly(dtReal);
    if (this.mode === 'walk') this.walk(dtReal);
    if (this.mode === 'eva') this.spacewalk(dtReal);
    this.place();
    const P = this.where();
    const cam = this.camera;
    cam.updateMatrixWorld();
    const tunnel = sh.worm?.phase === 'tunnel';

    // light: the star that lights each body best
    const stars = app.world.sources.filter(s => (s.cls === 'star' || s.cls === 'wd') && (s.star?.L ?? 0) > 0);
    const seen = new Set<Body>();
    const tanPx = Math.tan((cam.fov * Math.PI) / 360) / (window.innerHeight / 4);
    const mk: number[] = [], mc: number[] = [];
    if (!tunnel) for (const b of app.visual) {
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
      const glowy = b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns' || b.look.white || b.look.wormhole;
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
    this.sky.visible = !tunnel;

    // particles: gas and debris
    const pp: number[] = [], pc: number[] = [];
    if (!tunnel) for (const p of app.world.bodies) {
      if (!p.alive || p.source || !p.isParticle) continue;
      pp.push((p.x - P[0]) * AU_M, (p.y - P[1]) * AU_M, (p.z - P[2]) * AU_M);
      const c = p.look.c1, h = p.heat;
      const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, bl = (c & 255) / 255;
      pc.push(Math.min(1, r + h), Math.min(1, g + h * 0.5), Math.min(1, bl + h * 0.2));
    }
    setPoints(this.parts, pp, pc);

    // the light on the hull: the star that shines brightest here
    let sun: THREE.Vector3 | null = null, best = 0;
    if (!tunnel) for (const s of stars) {
      const d2 = (s.x - P[0]) ** 2 + (s.y - P[1]) ** 2 + (s.z - P[2]) ** 2;
      if ((s.star?.L ?? 0) / d2 > best) { best = (s.star?.L ?? 0) / d2; sun = new THREE.Vector3(P[0] - s.x, P[1] - s.y, P[2] - s.z).normalize(); }
    }
    this.mouths();
    this.cabin(dtReal);
    sh.draw(dtReal, cam, sh.nav.vel, sun, sh.hull.group.position, this.mode === 'pilot', tunnel);
    if (this.mode === 'scope') { cam.fov = this.scope.fov; cam.updateProjectionMatrix(); }
    else if (this.mode !== 'pilot' && cam.fov !== 75) { cam.fov = 75; cam.updateProjectionMatrix(); }
    // the map covers the view: leave the last frame up rather than draw what nobody can see
    if (!this.nav.open) this.renderer.render(this.scene, cam);
    this.drawLabels(P, tunnel || this.nav.open);
    this.radar.draw();
    this.nav.draw(dtReal);
    this.controls.hud(this.readout());
  }

  /** where the viewer is and which way it looks, and where the ship is drawn from there */
  private place() {
    const sh = this.ship, sq = sh.quat, cam = this.camera, f = this.foot;
    let local: THREE.Vector3 | null = null;
    if (this.mode === 'eva') {
      this.base = this.suit.nav;
      this.eye.set(0, 0, 0);
      cam.quaternion.copy(this.suit.quat);
    } else {
      this.base = sh.nav;
      if (this.mode === 'pilot') {
        local = sh.view === 'cockpit' ? HELM_EYE : CHASE_EYE;
        cam.quaternion.copy(sq);
        if (sh.view === 'chase') cam.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.13));
      } else if (this.mode === 'scope') {
        local = SCOPE_EYE;
        if (this.scope.track && this.app.selected?.alive) this.aimScope(this.app.selected);
        cam.quaternion.copy(this.scope.quat);
      } else {
        local = f.seat ? f.seat.eye : new THREE.Vector3(f.p.x, DECK_Y[f.deck] + 1.65 + f.y, f.p.z);
        cam.quaternion.copy(sq).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ')));
      }
      this.eye.copy(local).applyQuaternion(sq);
    }
    this.localEye = local && local !== CHASE_EYE && this.mode !== 'scope' ? local.clone() : null;
    // a shudder going into the throat
    const w = sh.worm;
    this.shake = w && (w.phase === 'enter' || w.phase === 'tunnel' && w.t < 0.6) ? 0.006 : w?.phase === 'tunnel' ? 0.0015 : 0;
    if (this.shake && this.mode !== 'scope') cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0)));
    cam.position.set(0, 0, 0);
    const g = sh.hull.group;
    g.position.copy(relM(sh.nav, this.base)).sub(this.eye);
    g.quaternion.copy(sq);
    g.visible = this.mode !== 'scope';
  }

  /** the wormhole mouths, where they are */
  private mouths() {
    const w = this.ship.worm, sh = this.ship;
    const inOn = !!w && !w.natural && (w.phase === 'charge' || w.phase === 'enter');
    const outOn = !!w && !w.natural && w.phase === 'exit';
    sh.mouthIn.visible = inOn;
    sh.mouthOut.visible = outOn;
    if (!w || (!inOn && !outOn)) return;
    const m = inOn ? sh.mouthIn : sh.mouthOut;
    m.position.copy(relM(w.mouth, this.base)).sub(this.eye);
    const open = w.phase === 'charge' ? Math.min(1, w.t / JUMP_CHARGE) : w.phase === 'exit' ? 1 - w.t / EXIT_T : 1;
    m.scale.setScalar(Math.max(0.01, MOUTH_R * Math.sqrt(open)));
    m.rotation.z += 0.01;
  }

  /** the inside of the ship: the bridge screen, the hologram, the souvenirs, what you can use */
  private cabin(dt: number) {
    const sh = this.ship, h = sh.hull;
    // what is in reach
    this.prompt = null;
    sh.boardable = false;
    if (this.mode === 'walk') {
      const f = this.foot;
      if (f.seat) this.prompt = { label: 'Stand up', act: () => { f.seat = null; } };
      else {
        const eye = new THREE.Vector3(f.p.x, DECK_Y[f.deck] + 1.65 + f.y, f.p.z);
        const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ'));
        const s = h.facing(eye, dir, f.deck);
        if (s) this.prompt = { label: s.label, act: () => this.use(s.id) };
      }
    } else if (this.mode === 'eva') {
      const loc = relM(this.suit.nav, sh.nav).applyQuaternion(sh.quat.clone().invert());
      if (loc.distanceTo(HATCH_OUT) < 7) { this.prompt = { label: 'Board the ship', act: () => this.board() }; sh.boardable = true; }
    }

    // the console, a few times a second
    this.screenT -= dt;
    if (this.screenT <= 0) {
      this.screenT = 0.25;
      const r = this.readout();
      const wrm = `WRM ${'█'.repeat(Math.floor(sh.charge * 12)).padEnd(12, '·')}`;
      h.drawScreen('helm', ['HELM', `SPD ${r.speed}`, r.drive.toUpperCase(), r.target ? `TGT ${r.target}` : 'TGT none', wrm]);
      this.screens(r, wrm);
    }

    // the hologram: what is round the ship, on a log scale, in the ship's frame
    const S = posOf(sh.nav), inv = sh.quat.clone().invert();
    const near = this.app.visual.filter(b => b.source || b === this.app.selected)
      .map(b => ({ b, v: new THREE.Vector3((b.x - S[0]) * AU_M, (b.y - S[1]) * AU_M, (b.z - S[2]) * AU_M) }))
      .map(x => ({ ...x, d: x.v.length() })).filter(x => x.d > 0).sort((a, c) => a.d - c.d).slice(0, 40);
    if (near.length) {
      const lo = Math.log10(Math.max(1e3, near[0].d / 3)), hi = Math.max(lo + 1, Math.log10(near[near.length - 1].d * 1.2));
      const pos: number[] = [0, 0, 0], col: number[] = [0.5, 0.9, 1];
      for (const { b, v, d } of near) {
        const r = (0.85 * (Math.log10(d) - lo)) / (hi - lo);
        v.applyQuaternion(inv).multiplyScalar(r / d);
        pos.push(v.x, v.y, v.z);
        const t = b === this.app.selected ? [1, 0.88, 0.45] : tintOf(b);
        col.push(t[0], t[1], t[2]);
      }
      h.setHolo(pos, col);
    }

    // souvenirs: a world gets onto the shelf once the ship has been within a few radii of it
    const { b, alt } = this.nearest(S);
    const world = b && b.source && !['star', 'wd', 'ns', 'bh'].includes(b.cls) && !b.look.craft;
    if (b && world && alt < 3 * b.r * AU_M && !this.visited.includes(b)) {
      this.visited.push(b);
      if (this.visited.length > 8) this.visited.shift();
      if (!this.logbook.firsts.some(x => x.name === b.name)) {
        const host = this.app.hostOf(b);
        this.logbook.firsts.push({ name: b.name, note: `${fmtTime((performance.now() - this.logbook.start) / 1000)} into the voyage${host ? ` · round ${host.name}` : ''}` });
        h.setSamples(this.logbook.firsts.slice(-12).map(x => { const w = this.app.world.bodies.find(q => q.name === x.name); const t = w ? tintOf(w) : [0.5, 0.8, 1]; return (Math.round(t[0] * 255) << 16) | (Math.round(t[1] * 255) << 8) | Math.round(t[2] * 255); }));
      }
      this.app.onToast(`${b.name} is on the shelf in the commons now`);
    }
    // (the key has the maps' widths in it, so a globe sharpens once its map is painted)
    const ms = this.visited.map(v => maps.want(v.look, 128));
    const key = this.visited.map((v, k) => `${v.id}:${ms[k].w}`).join();
    if (key !== this.trophyKey) {
      this.trophyKey = key;
      h.setTrophies(ms.map(m => { const [t, aux] = mapTextures(m, this.renderer); aux.dispose(); return t; }));
    }
  }

  /** the other screens round the ship, and the lab's globe */
  private screens(r: ReturnType<View3D['readout']>, wrm: string) {
    const sh = this.ship, h = sh.hull, L = this.logbook;
    const S = posOf(sh.nav), { b, alt } = this.nearest(S);
    const t = this.surveyTarget();
    const sv = t ? survey(t, this.stars(), null) : null;
    const clock = new Date(this.app.world.time * 365.25 * 86400e3);
    const hh = String(clock.getUTCHours()).padStart(2, '0'), mm = String(clock.getUTCMinutes()).padStart(2, '0');
    h.drawScreen('wall', ['WHERE WE ARE', b ? `Near ${b.name}` : 'Deep space', b ? `${fmtLength(Math.max(0, alt) / AU_M)} up` : '', `Ship time ${hh}:${mm}`, r.drive]);
    h.drawScreen('log', ["CAPTAIN'S LOG", `${fmtLength(L.metres / AU_M)} flown`, `${L.firsts.length} worlds`, `${L.jumps} transits`]);
    h.drawScreen('survey', sv && t ? [`SURVEY · ${t.name.toUpperCase()}`, sv.kind, ...sv.rows.filter(([k]) => /gravity|emperature/.test(k)).map(([k, x]) => `${k.replace(' (est.)', '').replace('Mean t', 'T').replace('Surface g', 'G')}: ${x}`), sv.land.ok ? 'LANDABLE' : 'NO LANDING'] : ['SURVEY', 'no target']);
    h.drawScreen('power', ['POWER', POWER[sh.power].name.toUpperCase(), wrm]);
    h.drawScreen('bay', ['LANDING SURVEY', t ? t.name : '—', sv ? (sv.land.ok ? 'LANDABLE' : 'NO LANDING') : '', 'LANDER 1', 'NOT FLIGHT-READY']);
    // the globe wears the target's surface
    const want = t && !['star', 'wd', 'ns', 'bh'].includes(t.cls) && !t.look.craft && !t.look.wormhole ? t : null;
    const m = want ? maps.want(want.look, 256) : null;
    const key = want && m ? `${want.id}:${m.w}` : '';
    if (key !== this.globeKey) {
      this.globeKey = key;
      for (const x of this.globeTex) x.dispose();
      this.globeTex = m ? mapTextures(m, this.renderer) : [];
      h.setGlobe(this.globeTex[0] ?? null);
    }
  }

  /** the ship under its own power: the autopilot, the pilot, or holding station when nobody is at the helm */
  private fly(dt: number) {
    const sh = this.ship, n = sh.nav, v = n.vel;
    const t = this.travel;
    const tb = t?.b;
    if (t && (!tb || tb.alive)) {
      if (tb && tb !== n.anchor && tb.source) rebase(n, tb);
      const p = posOf(n), q: V3 = tb ? [tb.x, tb.y, tb.z] : t.at!();
      const d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const dist = Math.hypot(d[0], d[1], d[2]) || 1e-30;
      const gap = dist - t.stop;
      // overdrive for anything more than a few seconds away on the ordinary drive
      if (gap * AU_M > 5 * CRUISE && !sh.od) { sh.od = true; this.autoOd = true; }
      if (this.autoOd && gap * AU_M < CRUISE) { sh.od = false; this.autoOd = false; }
      // close the gap exponentially, no faster than the drive allows
      const want = gap > 0 ? Math.min((gap * AU_M) / 1.2, sh.cap(this.nearest(p).alt)) : 0;
      sh.thrust = gap > 0 ? 1 : 0;
      for (let k = 0; k < 3; k++) v[k] += ((d[k] / dist) * want - v[k]) * Math.min(1, dt * 3);
      turnTo(sh.quat, d, dt * 3);
      if (gap < t.stop * 0.05 + 5 / AU_M || (this.mode === 'pilot' && this.controls.moving())) {
        this.travel = null;
        if (gap < t.stop * 0.05 + 5 / AU_M) v.fill(0);
        if (this.autoOd) { sh.od = false; this.autoOd = false; }
      }
    } else {
      this.travel = null;
      if (this.autoOd) { sh.od = false; this.autoOd = false; }
      const sp = this.speed();
      const want = this.mode === 'pilot' ? this.controls.thrust(sp, sh.quat) : [0, 0, 0];
      sh.thrust = Math.min(1, Math.hypot(want[0], want[1], want[2]) / sp);
      for (let k = 0; k < 3; k++) v[k] += (want[k] - v[k]) * Math.min(1, dt * 4);
    }
    for (let k = 0; k < 3; k++) n.off[k] += (v[k] * dt) / AU_M;
    const spd = Math.hypot(v[0], v[1], v[2]);
    this.logbook.metres += spd * dt;
    this.logbook.top = Math.max(this.logbook.top, spd);
    // into a wormhole's mouth in the sandbox, and out of the other
    const near = this.nearest(posOf(n));
    if (near.b && near.b.look.wormhole && near.alt < 0.5 * this.visR(near.b) * AU_M) {
      const out = this.app.world.bodies.find(q => q.id === near.b!.partnerId && q.alive);
      if (out) { this.throughNatural(near.b, out); return; }
    }
    this.clear(n, SHIP_CLEAR);
  }

  /** never inside anything: keep a mover `gap` m above the nearest surface */
  private clear(m: Mover, gap: number) {
    const p = posOf(m);
    const { b, alt } = this.nearest(p);
    if (!b || alt >= gap) return;
    const d: V3 = [p[0] - b.x, p[1] - b.y, p[2] - b.z];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const R = this.visR(b) + gap / AU_M;
    const a = m.anchor;
    m.off = [b.x + (d[0] / dl) * R - (a?.x ?? 0), b.y + (d[1] / dl) * R - (a?.y ?? 0), b.z + (d[2] / dl) * R - (a?.z ?? 0)];
    const v = m.vel, vin = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dl;
    if (vin < 0) for (let k = 0; k < 3; k++) v[k] -= (vin * d[k]) / dl;
  }

  /** a wormhole transit, stage by stage */
  private wormStep(dt: number) {
    const sh = this.ship, w = sh.worm!, n = sh.nav, v = n.vel;
    w.t += dt;
    sh.thrust = 0.3;
    if (!w.to.alive && (w.phase === 'charge' || w.phase === 'enter')) { sh.worm = null; this.app.onToast('The far end of the wormhole is gone'); return; }
    if (w.phase === 'charge') {
      // brake, with the mouth opening just ahead wherever the ship is
      for (let k = 0; k < 3; k++) v[k] -= v[k] * Math.min(1, dt * 3);
      const f = new THREE.Vector3(0, 0, -MOUTH_AHEAD / AU_M).applyQuaternion(sh.quat);
      w.mouth = { anchor: n.anchor, off: [n.off[0] + f.x + (v[0] * dt) / AU_M, n.off[1] + f.y + (v[1] * dt) / AU_M, n.off[2] + f.z + (v[2] * dt) / AU_M], vel: [0, 0, 0] };
      if (w.t >= JUMP_CHARGE) { w.phase = 'enter'; w.t = 0; v.fill(0); }
    } else if (w.phase === 'enter') {
      const rel = relM(w.mouth, n), d = rel.length();
      const sp = 40 + 500 * w.t;
      sh.thrust = 1;
      v[0] = (rel.x / d) * sp; v[1] = (rel.y / d) * sp; v[2] = (rel.z / d) * sp;
      turnTo(sh.quat, [rel.x, rel.y, rel.z], dt * 4);
      if (d < MOUTH_R * 0.4 || w.t > 6) this.intoThroat(w);
    } else if (w.phase === 'tunnel') {
      v.fill(0);
      if (w.t >= w.dur) {
        w.phase = 'exit'; w.t = 0;
        sh.flash = 0.9;
        if (w.natural) { if (w.keep) n.vel = [...w.keep]; sh.worm = null; this.app.onToast(`Out of the wormhole by ${w.to.name}`); }
      }
    } else {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(sh.quat);
      const sp = ((2 * MOUTH_AHEAD) / EXIT_T) * Math.max(0, 1 - w.t / EXIT_T);
      v[0] = f.x * sp; v[1] = f.y * sp; v[2] = f.z * sp;
      if (w.t >= EXIT_T) { sh.worm = null; v.fill(0); this.app.onToast(`Arrived at ${w.to.name}`); }
    }
    for (let k = 0; k < 3; k++) n.off[k] += (v[k] * dt) / AU_M;
  }

  /** through the mouth: the ship is carried to the far mouth, a little way out from the destination, facing it */
  private intoThroat(w: Worm) {
    this.logbook.jumps++;
    const sh = this.ship, b = w.to;
    const S = posOf(sh.nav);
    let dir: V3 = [S[0] - b.x, S[1] - b.y, S[2] - b.z];
    const dl = Math.hypot(dir[0], dir[1], dir[2]);
    dir = dl > 0 ? [dir[0] / dl, dir[1] / dl, dir[2] / dl] : [1, 0, 0];
    const far = (this.stopFor(b) + MOUTH_AHEAD / AU_M);
    const n = sh.nav;
    const old = n.anchor;
    n.anchor = b.source ? b : old;
    const a = n.anchor;
    n.off = [b.x + dir[0] * far - (a?.x ?? 0), b.y + dir[1] * far - (a?.y ?? 0), b.z + dir[2] * far - (a?.z ?? 0)];
    n.vel = [0, 0, 0];
    lookAlong(sh.quat, [-dir[0], -dir[1], -dir[2]]);
    w.mouth = { anchor: n.anchor, off: [...n.off], vel: [0, 0, 0] };
    w.phase = 'tunnel';
    w.t = 0;
    w.dur = Math.max(4, Math.min(12, 2 + 1.4 * Math.log10(Math.max(1, dl * AU_M) / 1e6)));
    sh.charge = 0;
    this.travel = null;
  }

  /** into a wormhole that is already there: out of its partner, on the far side, still moving */
  private throughNatural(mouth: Body, out: Body) {
    this.logbook.jumps++;
    const sh = this.ship, n = sh.nav;
    const p = posOf(n);
    const d: V3 = [p[0] - mouth.x, p[1] - mouth.y, p[2] - mouth.z];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const keep: V3 = [...n.vel];
    const k = out.r * 1.8 + SHIP_CLEAR / AU_M;
    n.anchor = out.source ? out : n.anchor;
    const a = n.anchor;
    n.off = [out.x - (d[0] / dl) * k - (a?.x ?? 0), out.y - (d[1] / dl) * k - (a?.y ?? 0), out.z - (d[2] / dl) * k - (a?.z ?? 0)];
    sh.worm = { phase: 'tunnel', t: 0, to: out, dur: 3, natural: true, mouth: { anchor: n.anchor, off: [...n.off], vel: [0, 0, 0] }, keep };
    this.travel = null;
  }

  /** on foot: walking the decks, which keep their own gravity whatever the ship does */
  private walk(dt: number) {
    const f = this.foot, h = this.ship.hull;
    const inp = this.controls.walkInput();
    if (this.sleep) return;
    if (f.seat) {
      if (inp.f || inp.s || inp.jump) f.seat = null;
      else return;
    }
    const sp = inp.run ? 6 : 3;
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
    const dx = (fx * inp.f + rx * inp.s) * sp * dt, dz = (fz * inp.f + rz * inp.s) * sp * dt;
    if (h.canStand(f.p.x + dx, f.p.z, 0.3, f.deck)) f.p.x += dx;
    if (h.canStand(f.p.x, f.p.z + dz, 0.3, f.deck)) f.p.z += dz;
    if (inp.jump && f.y <= 0) f.vy = 3.4;
    f.vy -= 9.8 * dt;
    f.y = Math.max(0, f.y + f.vy * dt);
    if (f.y <= 0) f.vy = 0;
  }

  /** outside: a suit with thrusters, gentle and slow unless you open the throttle */
  private spacewalk(dt: number) {
    const s = this.suit.nav, v = s.vel, sh = this.ship;
    const want = this.controls.thrust(4 * this.controls.throttle, this.suit.quat);
    for (let k = 0; k < 3; k++) v[k] += (want[k] - v[k]) * Math.min(1, dt * 1.5);
    for (let k = 0; k < 3; k++) s.off[k] += (v[k] * dt) / AU_M;
    this.clear(s, 2);
    // and not through the hull
    const inv = sh.quat.clone().invert();
    const loc = relM(s, sh.nav).applyQuaternion(inv);
    if (sh.hull.pushOut(loc)) {
      const w = loc.applyQuaternion(sh.quat);
      const a = s.anchor, S = posOf(sh.nav);
      s.off = [S[0] + w.x / AU_M - (a?.x ?? 0), S[1] + w.y / AU_M - (a?.y ?? 0), S[2] + w.z / AU_M - (a?.z ?? 0)];
      for (let k = 0; k < 3; k++) v[k] *= 0.2;
    }
  }

  /**
   * cruising speed, m/s: half the height above the nearest surface per second,
   * scaled by the throttle, up to what the drive allows; in overdrive, the
   * most the overdrive allows here
   */
  speed() {
    const { alt } = this.nearest(posOf(this.ship.nav));
    const cap = this.ship.cap(alt);
    if (this.ship.odLevel > 0) return cap * Math.min(1, this.controls.throttle);
    return Math.min(cap, Math.max(1, Math.min(isFinite(alt) ? alt : 1e9, 1e16)) * 0.5 * this.controls.throttle);
  }

  /** seconds to cover a distance (m), using overdrive when it is worth it */
  eta(d: number) {
    if (d < 5 * CRUISE) return d / CRUISE + 1;
    // spool, then the climb out of one well and the fall into the next, then the cruise between
    return 3 + 1.4 * Math.log(d / 3e7) + d / OD_MAX;
  }

  /** which room you are in, on foot */
  private room() {
    return this.ship.hull.roomName(this.foot.p.x, this.foot.p.z, this.foot.deck);
  }

  readout() {
    const sh = this.ship;
    const v = Math.hypot(...sh.nav.vel);
    const S = posOf(sh.nav);
    const { b, alt } = this.nearest(S);
    const sel = this.app.selected;
    const fmtV = (x: number) => x < 1000 ? `${x.toFixed(x < 10 ? 1 : 0)} m/s` : x < 0.01 * C_MS ? `${sig(x / 1000, 3)} km/s` : `${sig(x / C_MS, 3)} c`;
    let tgt = '';
    if (sel && sel.alive) {
      const d = Math.max(0, (Math.hypot(sel.x - S[0], sel.y - S[1], sel.z - S[2]) - this.visR(sel)) * AU_M);
      tgt = `${sel.name} · ${fmtLength(d / AU_M)}`;
      if (!sh.worm) tgt += ` · ~${fmtTime(this.eta(d))}`;
    }
    const w = sh.worm;
    const drive = w ? (w.phase === 'charge' ? `wormhole opening · ${Math.max(0, JUMP_CHARGE - w.t).toFixed(1)} s`
      : w.phase === 'enter' ? `into the wormhole` : w.phase === 'tunnel' ? `in the throat · ${w.to.name} in ${Math.max(0, w.dur - w.t).toFixed(0)} s` : `out of the wormhole`)
      : this.travel ? `autopilot → ${this.travel.name}${sh.odLevel > 0 ? ` · overdrive ${(sh.odLevel * 100).toFixed(0)}%` : ''}`
      : sh.odLevel > 0 ? `overdrive ${(sh.odLevel * 100).toFixed(0)}%` : 'cruise drive';
    let where = '', speed = fmtV(v);
    if (this.mode === 'pilot') where = `At the helm · ${sh.view === 'chase' ? 'chase view' : 'cockpit'}`;
    else if (this.mode === 'walk') where = this.sleep ? 'Asleep in the quarters' : this.foot.seat ? 'On the couch' : `On foot · ${this.room()}`;
    else if (this.mode === 'scope') where = `Telescope · ×${(70 / this.scope.fov).toFixed(this.scope.fov > 7 ? 1 : 0)}${this.scope.track ? ' · tracking' : ''}`;
    else {
      const d = relM(this.suit.nav, sh.nav).length();
      where = `Spacewalk · ${d < 1000 ? `${d.toFixed(0)} m` : fmtLength(d / AU_M)} from the ship`;
      const rv = Math.hypot(this.suit.nav.vel[0] - sh.nav.vel[0], this.suit.nav.vel[1] - sh.nav.vel[1], this.suit.nav.vel[2] - sh.nav.vel[2]);
      speed = `${fmtV(rv)} suit`;
    }
    return {
      mode: this.mode, where, speed, drive, target: tgt,
      near: b ? `${b.name} · ${fmtLength(Math.max(0, alt) / AU_M)} up` : '',
      riding: sh.nav.anchor?.name ?? '', throttle: this.controls.throttle, charge: sh.charge, flash: sh.flash,
      prompt: this.prompt?.label ?? '', tunnel: w?.phase === 'tunnel', od: sh.od, view: sh.view,
    };
  }

  /** the body nearest the centre of view (or a screen point), within a few degrees or its own disc */
  pick(cssX?: number, cssY?: number): Body | null {
    const cam = this.camera;
    const dir = cssX === undefined
      ? new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
      : new THREE.Vector3((cssX / window.innerWidth) * 2 - 1, -(cssY! / window.innerHeight) * 2 + 1, 0.5).unproject(cam).normalize();
    const P = this.where();
    let best: Body | null = null, score = Infinity;
    const tight = this.mode === 'scope' ? this.scope.fov / 70 : 1;
    for (const b of this.app.visual) {
      const rel = new THREE.Vector3((b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M);
      const dist = rel.length();
      if (!(dist > 0)) continue;
      const ang = rel.normalize().angleTo(dir);
      const allow = Math.max(Math.atan(this.visR(b) * AU_M / dist) * 1.2, (cssX === undefined ? 0.03 : 0.05) * tight);
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
      const m = mouthMesh(this.glowTex);
      m.name = 'mouth';
      group.add(m);
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
      o.map = o.base = maps.want(b.look, 128);
      o.owned = false;
      o.style = lookKey(b.look);
      [o.tex, o.aux] = mapTextures(o.map, this.renderer);
      o.mat = new THREE.ShaderMaterial({
        vertexShader: WORLD_VERT, fragmentShader: FRAG,
        uniforms: {
          map: { value: o.tex }, aux: { value: o.aux }, texel: { value: new THREE.Vector2(1 / o.map.w, 1 / o.map.h) },
          lightDir: { value: new THREE.Vector3(1, 0, 0) }, lightCol: { value: new THREE.Vector3(1, 1, 1) }, lit: { value: 0 }, heat: { value: 0 },
          atmo: { value: new THREE.Vector3() }, hasAtmo: { value: 0 }, bump: { value: o.map.gas ? 0.01 : 0.05 }, detail: { value: o.map.gas ? 0 : 1 },
        },
      });
      group.add(new THREE.Mesh(this.sphere, o.mat));
      if (o.map.cloud) {
        const cm = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
          uniforms: { aux: { value: o.aux }, lightDir: o.mat.uniforms.lightDir, lightCol: o.mat.uniforms.lightCol, drift: { value: 0 } },
        });
        o.clouds = new THREE.Mesh(this.sphere, cm);
        o.clouds.scale.setScalar(1.008);
        group.add(o.clouds);
      }
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
    if (o.kind === 'worm') tickMouth(g.getObjectByName('mouth') as THREE.Group, performance.now() / 1000, 1);
    if (o.kind !== 'world') {
      g.scale.setScalar(Rm);
      if (o.kind === 'hole') this.jets(b, o, Rm);
      return;
    }
    // a world: the best map for how big it looks (they arrive from the painter as they are ready), its turning frame, its light, its craters
    const px = (Rm / Math.max(1, g.position.length())) / (Math.tan((this.camera.fov * Math.PI) / 360) / (window.innerHeight / 2));
    const want = MapService.widthFor(px * 2, 1024);
    if (o.style !== lookKey(b.look) || o.base!.w < want) {
      const m = maps.want(b.look, want);
      if (o.style !== lookKey(b.look) || m !== o.base) {
        o.map = o.base = m; o.owned = false; o.style = lookKey(b.look); o.seen.clear();
        o.tex!.dispose(); o.aux!.dispose();
        [o.tex, o.aux] = mapTextures(m, this.renderer);
        const u = o.mat!.uniforms;
        u.map.value = o.tex; u.aux.value = o.aux; (u.texel.value as THREE.Vector2).set(1 / m.w, 1 / m.h);
        if (o.clouds) (o.clouds.material as THREE.ShaderMaterial).uniforms.aux.value = o.aux;
      }
    }
    if (o.clouds) (o.clouds.material as THREE.ShaderMaterial).uniforms.drift.value = (performance.now() / 1000 / 3600) % 1;
    const spin = (b.spinAngle ?? 0);
    const [fx, fy, fz] = bodyFrame(bodyAxis(b), spin);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...fx), new THREE.Vector3(...fy), new THREE.Vector3(...fz));
    g.quaternion.setFromRotationMatrix(m);
    g.scale.setScalar(Rm);
    let fresh = false;
    for (const c of b.craters) {
      if (o.seen.has(c) || o.map!.gas) continue;
      o.seen.add(c);
      if (!o.owned) { o.map = cloneMap(o.base!); o.owned = true; }
      paintCrater(o.map!, c.x, c.y, c.z, c.a);
      fresh = true;
    }
    if (fresh) writeMaps(o.tex!, o.aux!, o.map!);
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
    // a surface glows only once it is molten; a warm one (tidally heated Io) shows it at its volcanoes
    u.heat.value = Math.max(0, (b.heat - 0.55) / 0.45);
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

  private drawLabels(P: V3, hide: boolean) {
    const cam = this.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const want = new Set<Body | string>();
    if (hide) { for (const el of this.labelEls.values()) el.remove(); this.labelEls.clear(); return; }
    const cands = this.app.visual
      .map(b => ({ b, d: Math.hypot(b.x - P[0], b.y - P[1], b.z - P[2]) }))
      .filter(x => x.b === this.app.selected || x.b.source)
      .sort((a, c) => (c.b === this.app.selected ? 1 : 0) - (a.b === this.app.selected ? 1 : 0) || a.d - c.d)
      .slice(0, 14);
    const v = new THREE.Vector3(), dir = new THREE.Vector3();
    const inv = this.ship.quat.clone().invert(), eye = this.localEye, hull = this.ship.hull;
    for (const { b } of cands) {
      v.set((b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M);
      // inside, only what can be seen through a window
      if (eye && !hull.seesOut(eye, dir.copy(v).normalize().applyQuaternion(inv))) continue;
      v.project(cam);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      want.add(b);
      let el = this.labelEls.get(b);
      if (!el) { el = document.createElement('div'); el.className = 'lbl'; this.labels.appendChild(el); this.labelEls.set(b, el); }
      if (el.textContent !== b.name) el.textContent = b.name;
      el.style.left = `${((v.x + 1) / 2) * W + 8}px`;
      el.style.top = `${((1 - v.y) / 2) * H}px`;
      el.classList.toggle('sel', b === this.app.selected);
    }
    // outside, where to get back in
    if (this.mode === 'eva') {
      const h = HATCH_OUT.clone().applyQuaternion(this.ship.quat).add(this.ship.hull.group.position);
      const d = h.length();
      v.copy(h).project(cam);
      if (v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05) {
        want.add('hatch');
        let el = this.labelEls.get('hatch');
        if (!el) { el = document.createElement('div'); el.className = 'lbl hatch'; this.labels.appendChild(el); this.labelEls.set('hatch', el); }
        const t = `◉ Airlock · ${d < 1000 ? `${d.toFixed(0)} m` : fmtLength(d / AU_M)}`;
        if (el.textContent !== t) el.textContent = t;
        el.style.left = `${((v.x + 1) / 2) * W + 8}px`;
        el.style.top = `${((1 - v.y) / 2) * H}px`;
      }
    }
    for (const [b, el] of this.labelEls) if (!want.has(b)) { el.remove(); this.labelEls.delete(b); }
  }
}

/** a map as two textures: colour with glow in alpha; height, cloud and shine. Filtered smoothly, mipmapped */
function mapTextures(m: SurfaceMap, r: THREE.WebGLRenderer): [THREE.DataTexture, THREE.DataTexture] {
  const mk = () => {
    const t = new THREE.DataTexture(new Uint8Array(m.w * m.h * 4), m.w, m.h, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
    return t;
  };
  const a = mk(), b = mk();
  writeMaps(a, b, m);
  return [a, b];
}

function writeMaps(t: THREE.DataTexture, aux: THREE.DataTexture, m: SurfaceMap) {
  const d = t.image.data as Uint8Array, x = aux.image.data as Uint8Array;
  for (let k = 0; k < m.w * m.h; k++) {
    d[k * 4] = m.rgb[k * 3] * 255; d[k * 4 + 1] = m.rgb[k * 3 + 1] * 255; d[k * 4 + 2] = m.rgb[k * 3 + 2] * 255;
    d[k * 4 + 3] = Math.min(1, m.emit[k]) * 255;
    x[k * 4] = Math.max(0, Math.min(1, m.height[k])) * 255; x[k * 4 + 1] = m.cloud ? m.cloud[k] * 255 : 0; x[k * 4 + 2] = m.spec[k] * 255; x[k * 4 + 3] = 255;
  }
  t.needsUpdate = true;
  aux.needsUpdate = true;
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
    // a ring's profile lives in a uniform, which disposing the material leaves alone
    if (mat instanceof THREE.ShaderMaterial) (mat.uniforms.prof?.value as THREE.Texture | undefined)?.dispose();
  });
  o.tex?.dispose();
  o.aux?.dispose();
}


/** where a mover is, AU */
function posOf(m: Mover): V3 {
  const a = m.anchor;
  return [(a?.x ?? 0) + m.off[0], (a?.y ?? 0) + m.off[1], (a?.z ?? 0) + m.off[2]];
}

/** from one mover to another, m, as exactly as the numbers allow */
function relM(m: Mover, from: Mover) {
  if (m.anchor === from.anchor) return new THREE.Vector3((m.off[0] - from.off[0]) * AU_M, (m.off[1] - from.off[1]) * AU_M, (m.off[2] - from.off[2]) * AU_M);
  const p = posOf(m), q = posOf(from);
  return new THREE.Vector3((p[0] - q[0]) * AU_M, (p[1] - q[1]) * AU_M, (p[2] - q[2]) * AU_M);
}

/** ride with another body from now on, without moving or changing speed through space */
function rebase(m: Mover, b: Body) {
  const p = posOf(m), old = m.anchor;
  if (old && old.alive) for (let k = 0; k < 3; k++) m.vel[k] += (([old.vx, old.vy, old.vz][k] - [b.vx, b.vy, b.vz][k]) * AU_M) / YR;
  m.off = [p[0] - b.x, p[1] - b.y, p[2] - b.z];
  m.anchor = b;
}

/** face along a direction (world), keeping the sandbox's up (+z) up where it can */
function lookAlong(q: THREE.Quaternion, d: V3) {
  const dir = new THREE.Vector3(d[0], d[1], d[2]);
  if (dir.lengthSq() === 0) return;
  dir.normalize();
  const up = Math.abs(dir.z) > 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, up));
}

/** turn part of the way towards a direction (world) */
function turnTo(q: THREE.Quaternion, d: V3, k: number) {
  const target = new THREE.Vector3(d[0], d[1], d[2]);
  if (target.lengthSq() === 0) return;
  target.normalize();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const r = new THREE.Quaternion().setFromUnitVectors(fwd, target);
  q.premultiply(new THREE.Quaternion().slerp(r, Math.min(1, k)));
}
