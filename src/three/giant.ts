import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M } from '../physics/units';
import type { V3 } from '../pixel/sprites';
import { atmosphere, cloudDecks, giantPressure, giantTemp, giantWind, gravity, type Atmosphere } from './science';
import { bodyQuat } from './ground';
import { tangent } from './terrain';

/**
 * Inside a giant planet. There is no ground: below the cloud tops the air
 * thickens and heats on its adiabat, and the ship goes down through the decks
 * that real descents found — on Jupiter ammonia ice at 0.7 bar, ammonium
 * hydrosulphide at 2, water at 5, where the lightning is — until the hull
 * can take no more (1,000 bar here; Galileo's probe gave out at 23).
 *
 * Each cloud deck is a sheet over the whole planet, drawn as a disc round
 * the point under you that reaches to the horizon, coloured from the
 * planet's own map so the belts and zones and the Great Red Spot are where
 * they are seen from outside, drifting on the zonal winds and wound round
 * the storms. Between the decks you are in fog that darkens with depth, lit
 * from inside by lightning.
 */

const DECK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float u;
attribute float phi;
uniform vec3 c;
uniform vec3 e;
uniform vec3 nn;
uniform float R;
uniform float dz;
uniform float s0;
uniform float sMax;
uniform mat3 toBody;
varying vec3 vN;
varying vec3 vP;
void main() {
  float s = u <= 0.0 ? 0.0 : s0 * pow(sMax / s0, u);
  float th = s / R;
  float sh = sin(th * 0.5);
  vec3 t = cos(phi) * e + sin(phi) * nn;
  // from the viewer, without losing precision: (R cos th − r) c + R sin th t, with R − r = dz
  vec3 p = (dz - 2.0 * R * sh * sh) * c + R * sin(th) * t;
  vP = p;
  vN = toBody * normalize(cos(th) * c + sin(th) * t);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}`;

const DECK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform float R;
uniform float time;
uniform float scale;
uniform float opacity;
uniform vec3 tint;
uniform vec3 fogCol;
uniform float fogK;
uniform float light;
uniform vec3 storm;
uniform float stormR;
uniform float peak;
uniform float icy;
varying vec3 vN;
varying vec3 vP;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * n3(p); p = p * 2.03 + 1.7; a *= 0.5; } return s / 0.97; }
vec2 mapUV(vec3 n) {
  float lon = atan(n.y, n.x) / 6.2831853;
  return vec2(fract(lon), asin(clamp(n.z, -1.0, 1.0)) / 3.14159265 + 0.5);
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  float lat = asin(clamp(n.z, -1.0, 1.0));
  // the zonal winds carry the clouds east or west by latitude
  float wind = icy > 0.5 ? peak * (1.5 * sin(lat) * sin(lat) - 0.5) * 1.2 : peak * (0.5 * cos(lat * 12.0) + 0.6 * exp(-pow(lat * 57.3 / 12.0, 2.0)));
  float sh = time * wind / R;
  vec3 q = vec3(n.x * cos(sh) - n.y * sin(sh), n.x * sin(sh) + n.y * cos(sh), n.z);
  // and the great storm winds them round itself
  float ds = acos(clamp(dot(q, storm), -1.0, 1.0)) / stormR;
  if (ds < 1.6) {
    float a = (1.6 - ds) * (1.6 - ds) * 0.9 + time * 0.002 * exp(-ds);
    vec3 ax = storm;
    q = q * cos(a) + cross(ax, q) * sin(a) + ax * dot(ax, q) * (1.0 - cos(a));
  }
  vec3 big = texture2D(map, mapUV(q)).rgb;
  float f = fbm(q * R / scale) * 0.7 + fbm(q * R / (scale * 0.18)) * 0.3;
  float a = smoothstep(0.42, 0.7, f) * opacity;
  vec3 col = mix(big, tint, 0.35) * light * (0.75 + 0.5 * f);
  float d = length(vP);
  float fg = 1.0 - exp(-d * fogK);
  col = mix(col, fogCol, fg);
  a *= 1.0 - fg * 0.6;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

const isGiant = (b: Body) => !b.look.craft && (b.cls === 'gas' || ['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(b.look.style)) && b.cls !== 'star';

/** where the great storm is on a giant, body frame */
export function stormOf(b: Body): { dir: V3; r: number } {
  if (b.look.real === 'Jupiter') { const la = -22 * Math.PI / 180, lo = 60 * Math.PI / 180; return { dir: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], r: 0.12 }; }
  if (b.look.real === 'Neptune') { const la = -22 * Math.PI / 180, lo = 30 * Math.PI / 180; return { dir: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], r: 0.1 }; }
  if (b.look.real === 'Saturn') return { dir: [0, 0, 1], r: 0.2 };
  const sd = (b.look.seed % 1000) * 0.137;
  const v: V3 = [Math.cos(sd), Math.sin(sd), -0.35], l = Math.hypot(...v);
  return { dir: [v[0] / l, v[1] / l, v[2] / l], r: 0.13 };
}

/** how much pressure the ship's hull stands, bar */
export const HULL_BAR = 1000;

export class Giant {
  readonly root = new THREE.Group();
  body: Body | null = null;
  atmo: Atmosphere | null = null;
  /** below the 1-bar level, m (negative above it) */
  depth = -Infinity;
  bar = 0; T = 0; wind = 0;
  /** how far into the fog (0 clear – 1 inside the decks) and its colour */
  inside = 0;
  readonly fog = new THREE.Color();
  /** the deepest the ship can go here, m below 1 bar */
  crush = Infinity;
  /** the nearest deck: what it is, and a flash of lightning (0–1) */
  deck = '';
  flash = 0;
  /** the eastward wind here, world frame, m/s */
  readonly windVec = new THREE.Vector3();
  private decks: { mesh: THREE.Mesh; depth: number; what: string; color: number }[] = [];
  private geo: THREE.BufferGeometry;
  private t = 0;
  private bolt: THREE.Sprite;
  private nextBolt = 2;

  constructor(scene: THREE.Scene, glow: THREE.Texture) {
    this.root.name = 'giant';
    scene.add(this.root);
    // a polar grid: rings at geometric spacing (u 0–1), and the angle round
    const N = 70, S = 96, u: number[] = [], phi: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j < S; j++) { u.push(i === 0 ? 0 : (i - 1) / (N - 1)); phi.push((j / S) * Math.PI * 2 + (i % 2) * Math.PI / S); }
    for (let i = 0; i < N; i++) for (let j = 0; j < S; j++) {
      const a = i * S + j, b = i * S + ((j + 1) % S), c = (i + 1) * S + j, d = (i + 1) * S + ((j + 1) % S);
      idx.push(a, c, b, b, c, d);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(u.length * 3), 3));
    this.geo.setAttribute('u', new THREE.BufferAttribute(new Float32Array(u), 1));
    this.geo.setAttribute('phi', new THREE.BufferAttribute(new Float32Array(phi), 1));
    this.geo.setIndex(idx);
    this.bolt = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xd8e0ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    this.root.add(this.bolt);
  }

  static is(b: Body) { return isGiant(b); }

  private setBody(b: Body | null, stars: Body[]) {
    if (b === this.body) return;
    this.body = b;
    for (const d of this.decks) { this.root.remove(d.mesh); (d.mesh.material as THREE.Material).dispose(); }
    this.decks = [];
    this.atmo = null;
    if (!b) return;
    this.atmo = atmosphere(b, stars);
    for (const d of cloudDecks(b, this.atmo)) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: DECK_VERT, fragmentShader: DECK_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: {
          c: { value: new THREE.Vector3() }, e: { value: new THREE.Vector3() }, nn: { value: new THREE.Vector3() }, R: { value: 1 }, dz: { value: 0 }, s0: { value: 50 }, sMax: { value: 1e6 },
          toBody: { value: new THREE.Matrix3() }, map: { value: null }, time: { value: 0 }, scale: { value: 9000 }, opacity: { value: 1 }, tint: { value: new THREE.Color(d.color) },
          fogCol: { value: new THREE.Color() }, fogK: { value: 0 }, light: { value: 1 }, storm: { value: new THREE.Vector3() }, stormR: { value: 0.12 }, peak: { value: 150 }, icy: { value: 0 },
        },
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.root.add(mesh);
      this.decks.push({ mesh, depth: d.depth * 1000, what: d.what, color: d.color });
    }
    // the deepest the hull goes
    let lo = 0, hi = 3000;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (giantPressure(this.atmo, m) > HULL_BAR) hi = m; else lo = m; }
    this.crush = lo * 1000;
  }

  /**
   * Each frame: `b` the giant nearest the viewer (or null), `rel` its centre
   * from the viewer (m, world), `sun` the direction to its star, `map` its
   * surface texture.
   */
  frame(dt: number, b: Body | null, rel: THREE.Vector3, stars: Body[], sun: THREE.Vector3 | null, map: THREE.Texture | null) {
    this.t += dt;
    const R0 = b ? b.r * AU_M : 0;
    const near = b && isGiant(b) && rel.length() - R0 < Math.max(4e5, R0 * 0.02) ? b : null;
    this.setBody(near, stars);
    const body = this.body, a = this.atmo;
    if (!body || !a) { this.root.visible = false; this.inside = 0; this.depth = -Infinity; this.flash = 0; return; }
    this.root.visible = true;
    const R = body.r * AU_M, r = rel.length();
    this.depth = R - r;
    const zKm = this.depth / 1000;
    this.bar = giantPressure(a, zKm);
    this.T = giantTemp(a, zKm);
    const qb = bodyQuat(body), inv = qb.clone().invert();
    const up = rel.clone().negate().normalize();
    const nb = up.clone().applyQuaternion(inv);
    const lat = Math.asin(Math.max(-1, Math.min(1, nb.z)));
    this.wind = giantWind(body, lat);
    const [eb] = tangent([nb.x, nb.y, nb.z]);
    this.windVec.set(...eb).applyQuaternion(qb).multiplyScalar(this.wind);
    // the light that gets down here: sunlight thinning with depth, and the colour of the band you are in
    const sunUp = sun ? Math.max(0, sun.dot(up)) : 0;
    const light = Math.max(0.04, (0.1 + 0.9 * Math.sqrt(sunUp)) * Math.exp(-Math.max(0, this.depth) / (a.H * 1000 * 3)));
    const band = sampleTex(map, nb);
    // into the fog from a little above the cloud tops
    this.inside = smooth(-a.H * 1000 * 4, a.H * 1000 * 0.4, this.depth) * (this.depth < 0 ? 0.9 : 1);
    // lightning in the water clouds: a flash every few seconds, somewhere round you
    this.flash = Math.max(0, this.flash - dt * 3);
    const waterDeck = this.decks[this.decks.length - 1]?.depth ?? Infinity;
    if (this.depth > waterDeck * 0.6 && (this.nextBolt -= dt) < 0) {
      this.nextBolt = 0.8 + Math.random() * 4;
      this.flash = 1;
      const d = 5e3 + Math.random() * 3e4, ang = Math.random() * Math.PI * 2;
      const [e, n] = tangent([up.x, up.y, up.z]);
      this.bolt.position.copy(up).multiplyScalar((waterDeck - this.depth) * 0.8).addScaledVector(new THREE.Vector3(...e), Math.cos(ang) * d).addScaledVector(new THREE.Vector3(...n), Math.sin(ang) * d);
      this.bolt.scale.setScalar(d * 0.5);
    }
    this.bolt.visible = this.flash > 0.05;
    (this.bolt.material as THREE.SpriteMaterial).opacity = this.flash;
    this.fog.setRGB(band[0], band[1], band[2]).multiplyScalar(light).lerp(new THREE.Color(0.75, 0.8, 1), this.flash * 0.5);
    // nearest deck, for the readout
    let best = Infinity;
    this.deck = '';
    for (const d of this.decks) if (Math.abs(d.depth - this.depth) < best) { best = Math.abs(d.depth - this.depth); if (best < 15e3) this.deck = d.what; }
    // the decks
    const st = stormOf(body);
    const [e, n] = tangent([up.x, up.y, up.z]);
    const peak = body.look.real === 'Neptune' ? 400 : body.look.real === 'Saturn' ? 450 : body.look.real === 'Uranus' ? 250 : 150;
    const fogK = this.inside > 0 ? (0.2 + 2.5 * Math.min(1, Math.max(0, this.depth) / (a.H * 1000 * 3))) / 25e3 : 1 / 2e6;
    for (const d of this.decks) {
      const u = (d.mesh.material as THREE.ShaderMaterial).uniforms;
      const Rd = R - d.depth, dz = Rd - r;
      (u.c.value as THREE.Vector3).copy(up);
      (u.e.value as THREE.Vector3).set(...e);
      (u.nn.value as THREE.Vector3).set(...n);
      u.R.value = Rd;
      u.dz.value = dz;
      u.s0.value = Math.max(30, Math.abs(dz) * 0.05);
      u.sMax.value = Math.min(Rd * 0.6, Math.sqrt(2 * Rd * (Math.abs(dz) + 30e3)) * 1.5);
      (u.toBody.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(inv));
      u.map.value = map;
      u.time.value = this.t;
      u.scale.value = Math.max(3000, a.H * 1000 * 0.4);
      u.light.value = Math.max(0.06, (0.1 + 0.9 * Math.sqrt(sunUp)) * Math.exp(-Math.max(0, d.depth) / (a.H * 1000 * 3))) + this.flash * 0.6;
      (u.fogCol.value as THREE.Color).copy(this.fog);
      u.fogK.value = fogK;
      (u.storm.value as THREE.Vector3).set(...st.dir);
      u.stormR.value = st.r;
      u.peak.value = peak;
      u.icy.value = body.look.style === 'icegiant' || body.look.real === 'Uranus' || body.look.real === 'Neptune' ? 1 : 0;
      d.mesh.visible = this.depth > -a.H * 1000 * 6;
    }
    void gravity;
  }

  /** the readout: where you are in it */
  status(): string {
    const b = this.body;
    if (!b || this.depth < -(this.atmo?.H ?? 30) * 3000) return '';
    const z = this.depth / 1000;
    const where = z > 0 ? `Inside ${b.name} · ${z.toFixed(z < 10 ? 1 : 0)} km below the cloud tops` : `Over ${b.name} · ${(-z).toFixed(0)} km above the cloud tops`;
    return `${where} · ${this.bar < 10 ? this.bar.toPrecision(2) : Math.round(this.bar)} bar · ${Math.round(this.T)} K · wind ${Math.abs(this.wind).toFixed(0)} m/s ${this.wind >= 0 ? 'east' : 'west'}${this.deck ? ` · ${this.deck} clouds` : ''}`;
  }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the colour of a map texture in a direction (body frame), read off its data on the CPU */
function sampleTex(t: THREE.Texture | null, n: THREE.Vector3): V3 {
  const img = (t as THREE.DataTexture | null)?.image as { data: Uint8Array; width: number; height: number } | undefined;
  if (!img?.data) return [0.7, 0.6, 0.45];
  const lon = ((Math.atan2(n.y, n.x) / (2 * Math.PI)) % 1 + 1) % 1, lat = Math.asin(Math.max(-1, Math.min(1, n.z))) / Math.PI + 0.5;
  const i = Math.min(img.width - 1, Math.floor(lon * img.width)), j = Math.min(img.height - 1, Math.floor(lat * img.height));
  const k = (j * img.width + i) * 4;
  return [img.data[k] / 255, img.data[k + 1] / 255, img.data[k + 2] / 255];
}
