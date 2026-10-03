import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M } from '../physics/units';
import type { SurfaceMap } from '../pixel/surface';
import { bodyFrame } from '../pixel/sprites';
import { bodyAxis } from '../pixel/renderer';
import { terrainSrc, heightAt, patchHeight, buildPatch, type TerrainSrc, type Patch, type V3 } from './terrain';

/**
 * The ground under you, and the sky over it. Close to a solid world a patch
 * of terrain is built round the point below the viewer — fine underfoot,
 * coarse towards the horizon — in a worker, and swapped in when it is ready;
 * the world's own sphere is tucked just under it. In an atmosphere a dome of
 * sky is drawn behind everything, coloured by the air and the height of the
 * sun, and the terrain fades into its haze.
 */

/** a world's turning frame: its x, y and z axes in the sandbox's */
export function frameOf(b: Body): [V3, V3, V3] { return bodyFrame(bodyAxis(b), b.spinAngle) as [V3, V3, V3]; }
export const toWorld = (f: [V3, V3, V3], v: V3): V3 => [f[0][0] * v[0] + f[1][0] * v[1] + f[2][0] * v[2], f[0][1] * v[0] + f[1][1] * v[1] + f[2][1] * v[2], f[0][2] * v[0] + f[1][2] * v[1] + f[2][2] * v[2]];
export const toLocal = (f: [V3, V3, V3], v: V3): V3 => [f[0][0] * v[0] + f[0][1] * v[1] + f[0][2] * v[2], f[1][0] * v[0] + f[1][1] * v[1] + f[1][2] * v[2], f[2][0] * v[0] + f[2][1] * v[1] + f[2][2] * v[2]];
export function quatOf(f: [V3, V3, V3]) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...f[0]), new THREE.Vector3(...f[1]), new THREE.Vector3(...f[2])));
}

const TERRAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float sea;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vP;
varying vec3 vL;
varying float vSea;
void main() {
  vCol = color;
  vSea = sea;
  vN = normalize(mat3(modelMatrix) * normal);
  vL = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const TERRAIN_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 lightDir;
uniform vec3 lightCol;
uniform vec3 ambient;
uniform vec3 fogCol;
uniform float fogDen;
uniform float sunUp;
uniform vec3 origin;
uniform vec3 skyCol;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vP;
varying vec3 vL;
varying float vSea;
float h3(vec3 p) { p = mod(p, 4096.0); p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vN);
  float d = length(vP);
  // grain finer than the mesh, fading out with distance
  vec3 q = vL + origin;
  float g = (n3(q * 1.3) - 0.5) * 0.6 + (n3(q * 6.0) - 0.5) * 0.4;
  float near = 1.0 - smoothstep(20.0, 400.0, d);
  vec3 col = vCol * (1.0 + g * 0.35 * near * (1.0 - vSea));
  float lam = max(dot(N, lightDir), 0.0) * sunUp;
  vec3 c = col * (ambient + lightCol * lam);
  if (vSea > 0.5) {
    // the sea: the sky in it towards the horizon, and the sun's glint
    vec3 V = normalize(-vP);
    float fr = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    c = mix(c, skyCol, fr * 0.8);
    vec3 H = normalize(lightDir + V);
    c += lightCol * pow(max(dot(N, H), 0.0), 220.0) * 1.6 * sunUp;
  }
  float f = 1.0 - exp(-d * fogDen);
  gl_FragColor = vec4(mix(c, fogCol, f), 1.0);
}`;

const SKY_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const SKY_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 up;
uniform vec3 sunDir;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 sunset;
uniform float strength;
uniform float inside;
uniform vec3 deepTop;
uniform vec3 deepLow;
uniform float flash;
uniform float glow;
varying vec3 vDir;
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  float e = dot(d, up), s = dot(sunDir, up);
  float day = smoothstep(-0.2, 0.12, s);
  float t = pow(clamp(e, 0.0, 1.0), 0.45);
  vec3 col = mix(horizon, zenith, t);
  float toSun = max(dot(d, sunDir), 0.0);
  float low = 1.0 - smoothstep(0.0, 0.4, abs(s));
  col = mix(col, sunset, pow(toSun, 3.0) * low * 0.85 * (1.0 - t * 0.5));
  col *= day;
  col += sunset * pow(toSun, 48.0) * 0.5 * day + vec3(1.0, 0.97, 0.9) * pow(toSun, 1200.0) * 3.0 * smoothstep(-0.05, 0.02, s);
  if (e < 0.0) col = mix(col, horizon * day * 0.6, smoothstep(0.0, -0.12, e));
  col += vec3(0.008, 0.01, 0.018) * (1.0 - day);
  col *= strength;
  // inside a giant: lit from above through the decks, darker below, flickering with lightning
  vec3 deep = mix(deepLow, deepTop, smoothstep(-0.8, 0.9, e)) * glow;
  deep += vec3(0.85, 0.9, 1.0) * flash * (0.4 + 0.6 * smoothstep(-0.5, 0.5, e));
  col = mix(col, deep, inside);
  gl_FragColor = vec4(col, 1.0);
}`;

export interface SkyState {
  /** 0 no sky – 1 a full sky, from the air above you */
  strength: number;
  zenith: V3; horizon: V3; sunset: V3;
  /** how much the distance fades, 0–1 */
  haze: number;
  /** inside a giant (0–1), its colours above and below, how light it is, lightning */
  inside: number; deepTop: V3; deepLow: V3; glow: number; flash: number;
}

export class Ground {
  readonly group = new THREE.Group();
  readonly sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh | null = null;
  /** the world being drawn, its recipe, and the patch on show */
  body: Body | null = null;
  src: TerrainSrc | null = null;
  patch: Patch | null = null;
  private worker: Worker | null = null;
  private sentKey = '';
  private jobId = 0;
  private busy = false;
  /** the patch asked for: centre, half-width, middle spacing */
  private want: { c: V3; E: number; fine: number } | null = null;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, vertexColors: true,
      uniforms: {
        lightDir: { value: new THREE.Vector3(0, 0, 1) }, lightCol: { value: new THREE.Vector3(1, 1, 1) }, ambient: { value: new THREE.Vector3(0.03, 0.03, 0.035) },
        fogCol: { value: new THREE.Vector3() }, fogDen: { value: 0 }, sunUp: { value: 1 }, origin: { value: new THREE.Vector3() }, skyCol: { value: new THREE.Vector3(0.3, 0.5, 0.9) },
      },
    });
    this.group.visible = false;
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        up: { value: new THREE.Vector3(0, 0, 1) }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, zenith: { value: new THREE.Vector3() }, horizon: { value: new THREE.Vector3() },
        sunset: { value: new THREE.Vector3() }, strength: { value: 0 }, inside: { value: 0 }, deepTop: { value: new THREE.Vector3() }, deepLow: { value: new THREE.Vector3() },
        flash: { value: 0 }, glow: { value: 1 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1e6, 48, 24), this.skyMat);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.sky.visible = false;
    scene.add(this.sky);
    try {
      this.worker = new Worker(new URL('./terrainworker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; key: string; patch: Patch }>) => {
        this.busy = false;
        if (this.src && e.data.key === this.src.key) this.show(e.data.patch);
        this.next();
      };
    } catch { this.worker = null; }
  }

  /** take up a world (or let it go): `map` is the map it wears */
  setBody(b: Body | null, map: SurfaceMap | null) {
    if (b && map && (b !== this.body || !this.src || this.src.w < map.w)) {
      this.body = b;
      this.src = terrainSrc(b, map);
      this.patch = null;
      if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    } else if (!b) {
      this.body = null; this.src = null; this.patch = null;
      if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    }
  }

  /**
   * Keep a patch round `n` (body frame) right for a viewer `alt` metres up:
   * rebuilt when the viewer has gone far from its middle, or climbed or
   * dropped a long way.
   */
  follow(n: V3, alt: number) {
    const t = this.src;
    if (!t) return;
    const a = Math.max(1, alt);
    const horizon = Math.sqrt(2 * t.R * a + a * a);
    const E = Math.min(0.7 * t.R, Math.max(4000, 1.5 * horizon + t.relief * 0.5));
    const fine = Math.max(0.35, Math.min(E / 40, a * 0.04));
    const p = this.patch ?? null, w = this.want;
    const ref = w ?? (p ? { c: p.c, E: p.E, fine } : null);
    let need = !ref;
    if (ref) {
      const cosA = n[0] * ref.c[0] + n[1] * ref.c[1] + n[2] * ref.c[2];
      const off = Math.acos(Math.min(1, cosA)) * t.R;
      need = off > Math.max(12 * fine, 0.06 * ref.E) || ref.E > E * 1.8 || ref.E < E / 1.5;
    }
    if (need) { this.want = { c: [...n] as V3, E, fine }; this.next(); }
  }

  private next() {
    const w = this.want, t = this.src;
    if (this.busy || !w || !t) return;
    this.want = null;
    const N = 161;
    if (this.worker) {
      if (this.sentKey !== t.key) {
        this.worker.postMessage({ src: t });
        this.sentKey = t.key;
      }
      this.busy = true;
      this.worker.postMessage({ job: { id: ++this.jobId, c: w.c, E: w.E, N, fine: w.fine } });
    } else {
      // no worker (tests): build it here, once
      this.show(buildPatch(t, w.c, w.E, N, w.fine));
    }
  }

  private show(p: Patch) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(p.col, 3));
    // the sea: wherever the ground sits at its level on a world with seas
    const sea = new Float32Array(p.pos.length / 3);
    if (this.src?.seas) for (let k = 0; k < sea.length; k++) sea[k] = Math.abs(p.hgt[k]) < 0.01 ? 1 : 0;
    g.setAttribute('sea', new THREE.BufferAttribute(sea, 1));
    g.setIndex(new THREE.BufferAttribute(p.idx, 1));
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.patch = p;
  }

  /** the ground's height (m) below a direction: as drawn where there is a patch, otherwise from the recipe */
  heightAt(n: V3): number {
    const t = this.src;
    if (!t) return 0;
    const p = this.patch && patchHeight(this.patch, t.R, n);
    return p ?? heightAt(t, n, 0.5);
  }

  /** is a patch on show? */
  get ready() { return !!this.mesh && !!this.body; }

  /**
   * Place the ground for this frame: `centre` is the world's centre from the
   * camera (m), `f` its turning frame; light from `light` (towards the star,
   * world) in `lightCol`; `upDir` the vertical where the viewer is.
   */
  place(centre: THREE.Vector3, f: [V3, V3, V3], light: THREE.Vector3 | null, lightCol: THREE.Vector3, upDir: THREE.Vector3, sky: SkyState) {
    const p = this.patch, t = this.src;
    this.group.visible = !!(p && t && this.mesh);
    if (p && t) {
      // the patch's middle, from the camera, worked out in doubles so the mesh itself stays small numbers
      const cw = toWorld(f, [p.c[0] * t.R, p.c[1] * t.R, p.c[2] * t.R]);
      this.group.position.set(centre.x + cw[0], centre.y + cw[1], centre.z + cw[2]);
      this.group.quaternion.copy(quatOf(f));
      const u = this.mat.uniforms;
      const origin = u.origin.value as THREE.Vector3;
      origin.set(((p.c[0] * t.R) % 4096 + 4096) % 4096, ((p.c[1] * t.R) % 4096 + 4096) % 4096, ((p.c[2] * t.R) % 4096 + 4096) % 4096);
      if (light) (u.lightDir.value as THREE.Vector3).copy(light);
      (u.lightCol.value as THREE.Vector3).copy(lightCol).multiplyScalar(light ? 1 : 0);
      const sunUp = light ? THREE.MathUtils.smoothstep(light.dot(upDir), -0.08, 0.06) : 0;
      u.sunUp.value = sunUp;
      // the sky lights the shadows, and starlight the night
      const day = sunUp * sky.strength;
      (u.ambient.value as THREE.Vector3).set(0.025 + sky.zenith[0] * 0.35 * day, 0.025 + sky.zenith[1] * 0.35 * day, 0.03 + sky.zenith[2] * 0.35 * day);
      (u.skyCol.value as THREE.Vector3).set(sky.horizon[0] * (0.05 + day), sky.horizon[1] * (0.05 + day), sky.horizon[2] * (0.05 + day));
      (u.fogCol.value as THREE.Vector3).set(sky.horizon[0] * (0.02 + day * 0.9), sky.horizon[1] * (0.02 + day * 0.9), sky.horizon[2] * (0.02 + day * 0.9));
      if (sky.inside > 0) (u.fogCol.value as THREE.Vector3).set(sky.deepLow[0] * sky.glow, sky.deepLow[1] * sky.glow, sky.deepLow[2] * sky.glow);
      // the haze: Earth's few tens of kilometres of visibility, Titan's or Venus's few
      u.fogDen.value = sky.strength > 0 ? Math.pow(sky.haze, 2) * 6e-4 + 1.2e-5 * sky.strength : 0;
    }
    // the sky
    const s = this.skyMat.uniforms;
    this.sky.visible = sky.strength > 0.01 || sky.inside > 0.01;
    (s.up.value as THREE.Vector3).copy(upDir);
    if (light) (s.sunDir.value as THREE.Vector3).copy(light);
    (s.zenith.value as THREE.Vector3).set(...sky.zenith);
    (s.horizon.value as THREE.Vector3).set(...sky.horizon);
    (s.sunset.value as THREE.Vector3).set(...sky.sunset);
    s.strength.value = light ? sky.strength : 0;
    s.inside.value = sky.inside;
    (s.deepTop.value as THREE.Vector3).set(...sky.deepTop);
    (s.deepLow.value as THREE.Vector3).set(...sky.deepLow);
    s.glow.value = sky.glow;
    s.flash.value = sky.flash;
  }

  /** the day-side brightness of the sky where the viewer is, 0–1, for fading the stars */
  dayLight(light: THREE.Vector3 | null, upDir: THREE.Vector3, sky: SkyState) {
    const sunUp = light ? THREE.MathUtils.smoothstep(light.dot(upDir), -0.2, 0.1) : 0;
    return Math.max(sky.inside, sunUp * sky.strength);
  }
}

/** the radius of a world, m */
export const radiusM = (b: Body) => b.r * AU_M;
