import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M } from '../physics/units';
import { bodyFrame, type V3 } from '../pixel/sprites';
import { bodyAxis } from '../pixel/renderer';
import { hash } from '../pixel/noise';
import { groundSpec, groundAt, buildPatch, patchSize, tangent, groundPainter, type GroundSpec, type Patch, type PatchJob, type GroundSample } from './terrain';
import { detailFor } from '../pixel/surface';
import { LIGHT_GLSL } from './lightglsl';
import { atmosphere, life, gravity, rng, type Atmosphere, type Life } from './science';
import { sitesOn, earthBiome, speciesIn, type Site, type Biome } from './sites';
import { apolloMesh, flagMesh, lrvMesh, landerMesh, roverMesh, veneraMesh, huygensMesh, probeMesh, alienMesh } from './craftmesh';

/**
 * The ground of the world you are near, and the sky over it.
 *
 * Within a few hundred kilometres of a solid world the sphere it is drawn as
 * gives way to terrain (terrain.ts) built in a worker round the point under
 * you, fine underfoot and coarse at the horizon, rebuilt as you move. It is
 * lit by its star, hazed by its air (or not, if it has none), and its seas
 * are flat and shine. The sky over it is the colour its air makes it — blue
 * here, butterscotch on Mars, orange on Titan, black on the Moon — fading
 * to stars at night, with sunsets in the colour that air gives them.
 *
 * On it: boulders on rough ground, what real missions left where they left it
 * (sites.ts), the Earth's cities, its plants and animals by biome, and on a
 * made-up world that has life, plants coloured for its star, animals that
 * wander, and — on the few with a civilisation — towns.
 */

const FRAG_NOISE = /* glsl */ `
float h3(vec3 p) { p = mod(p, 256.0); p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

const GROUND_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float sea;
uniform vec3 offset;
varying vec3 vN;
varying vec3 vP;
varying vec3 vCol;
varying float vSea;
varying vec3 vLocal;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vCol = color;
  vSea = sea;
  vLocal = position + offset;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const GROUND_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDir;
uniform vec3 sunCol;
uniform vec3 ambient;
uniform vec3 fogCol;
uniform float fogK;
uniform float time;
uniform vec3 seaUp;
${LIGHT_GLSL}
varying vec3 vN;
varying vec3 vP;
varying vec3 vCol;
varying float vSea;
varying vec3 vLocal;
${FRAG_NOISE}
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vN);
  float d = length(vP);
  vec3 V = -vP / max(d, 1e-3);
  // close up, the grain of the ground: pebbles, dust, scuffs
  float near = 1.0 - smoothstep(20.0, 600.0, d);
  float g1 = n3(vLocal * 1.0), g2 = n3(vLocal * 0.125), g3 = n3(vLocal * 7.0);
  vec3 col = vCol * (1.0 + ((g1 - 0.5) * 0.3 + (g3 - 0.5) * 0.25 * (1.0 - smoothstep(2.0, 30.0, d))) * near + (g2 - 0.5) * 0.18);
  vec3 c;
  if (vSea > 0.5) {
    // the sea: small waves, the sky reflected at a glancing angle, a glint of the sun
    float t = time * 0.6;
    vec3 w = vec3(n3(vLocal * 0.35 + vec3(t, 0.0, t * 0.7)) - 0.5, n3(vLocal * 0.35 + vec3(3.1, t, 1.7)) - 0.5, 0.0);
    vec3 Ns = normalize(N + 0.25 * (1.0 - smoothstep(50.0, 3000.0, d)) * (w.x * cross(N, vec3(0.0, 0.0, 1.0)) + w.y * vec3(0.0, 0.0, 1.0)));
    float dl = max(dot(Ns, sunDir), 0.0);
    float fres = pow(1.0 - max(dot(Ns, V), 0.0), 4.0);
    vec3 lamp = lampLight(vP, Ns);
    c = vCol * (ambient + ambientX + dl * sunCol * 0.6 + lamp * 0.8);
    c = mix(c, fogCol, fres * 0.7);
    c += sunCol * pow(max(dot(reflect(-sunDir, Ns), V), 0.0), 220.0) * 2.0;
  } else {
    float dl = max(dot(N, sunDir), 0.0);
    c = col * (ambient + ambientX + dl * sunCol + lampLight(vP, N));
  }
  // the air between: haze toward the sky's colour
  float f = 1.0 - exp(-d * fogK);
  c = mix(c, fogCol, f);
  gl_FragColor = vec4(c, 1.0);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** how much paler than the sky overhead it is at the horizon (the long path through the air), clear air to hazy */
const HORIZON_WHITE = '(0.45 + 0.4 * haze)';

const SKY_FRAG = /* glsl */ `
uniform vec3 up;
uniform vec3 sunDir;
uniform vec3 skyCol;
uniform vec3 duskCol;
uniform float thick;
uniform float haze;
uniform float inside;
uniform vec3 fogCol;
varying vec3 vDir;
void main() {
  vec3 v = normalize(vDir);
  float e = dot(v, up), s = dot(sunDir, up);
  float day = smoothstep(-0.2, 0.1, s);
  float mu = max(dot(v, sunDir), 0.0);
  float hz = pow(1.0 - clamp(e, 0.0, 1.0), 3.0);
  vec3 c = mix(skyCol, mix(skyCol, vec3(1.0), ${HORIZON_WHITE}), hz);
  // the sun low: its own colour round it, and along the horizon
  float low = 1.0 - smoothstep(0.0, 0.35, abs(s + 0.05));
  c = mix(c, duskCol, low * clamp(pow(mu, 2.5) * 1.2 + hz * 0.35, 0.0, 1.0));
  c *= 0.2 + 0.8 * day;
  c += vec3(1.0, 0.94, 0.85) * (pow(mu, 600.0) * 4.0 + pow(mu, 14.0) * (0.15 + 0.5 * haze)) * day;
  float a = thick * clamp(day + 0.6 * low * (1.0 - day), 0.0, 1.0);
  // inside a giant: the fog all round
  c = mix(c, fogCol, inside);
  a = max(a, inside);
  gl_FragColor = vec4(c, a);
}`;

/** the turning frame of a body, as a rotation from its own frame to the sandbox's */
export function bodyQuat(b: Body, q = new THREE.Quaternion()) {
  const [fx, fy, fz] = bodyFrame(bodyAxis(b), b.spinAngle ?? 0);
  return q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...fx), new THREE.Vector3(...fy), new THREE.Vector3(...fz)));
}

const solid = (b: Body) => !b.look.craft && !b.look.wormhole && !b.look.white && !['star', 'wd', 'ns', 'bh', 'gas', 'gasp', 'debris'].includes(b.cls)
  && !['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(b.look.style) && b.r * AU_M > 2000;

interface Placed { obj: THREE.Object3D; key: string }
interface Critter { obj: THREE.Object3D; n: V3; head: number; speed: number; fly: number; name: string; t: number }

export class Ground {
  /** at the body's centre, in its turning frame: everything on the ground hangs off it */
  readonly root = new THREE.Group();
  readonly sky: THREE.Mesh;
  body: Body | null = null;
  spec: GroundSpec | null = null;
  atmo: Atmosphere | null = null;
  lifeInfo: Life | null = null;
  /** how bright the day is where you are (0 night – 1 day), and the sky's colour */
  daylight = 0;
  /** the light on the ground: colour of the sun through the air, and the ambient from the sky */
  readonly sunCol = new THREE.Color(1, 1, 1);
  readonly skyCol = new THREE.Color(0, 0, 0);
  /** the patch is in and the sphere can sink under it */
  ready = false;
  /** the haze where you are: how fast it thickens with distance (per m) and its colour, for everything else on the ground too */
  fogK = 0;
  readonly fogCol = new THREE.Color();
  /** the sky's colour at the horizon */
  private readonly horizon = new THREE.Color();
  /** called when you come across a living thing or a site for the first time */
  onFind: (what: string, note: string) => void = () => {};
  /** biome under you, on the Earth */
  biome: Biome | null = null;

  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh | null = null;
  private patch: Patch | null = null;
  private rocks: THREE.InstancedMesh | null = null;
  private rockGeo = new THREE.IcosahedronGeometry(1, 0);
  private rockMat = new THREE.MeshLambertMaterial({ flatShading: true });
  private worker: Worker | null = null;
  private busy = false;
  private jobId = 0;
  private want: PatchJob | null = null;
  private last = { c: [0, 0, 1] as V3, r0: 0 };
  private paint: ReturnType<typeof groundPainter> | null = null;
  private det = detailFor(1024);
  private sample: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
  private placed = new Map<string, Placed>();
  private sites: Site[] = [];
  private towns: { name: string; lat: number; lon: number; pop: number; alien: boolean }[] = [];
  private flora: THREE.InstancedMesh[] = [];
  private floraAt: V3 | null = null;
  private critters: Critter[] = [];
  private found = new Set<string>();
  private q = new THREE.Quaternion();
  private t = 0;

  constructor(scene: THREE.Scene, lightUniforms: Record<string, THREE.IUniform> = {}) {
    this.root.name = 'ground';
    scene.add(this.root);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, vertexColors: true,
      uniforms: {
        sunDir: { value: new THREE.Vector3(0, 0, 1) }, sunCol: { value: new THREE.Vector3(1, 1, 1) }, ambient: { value: new THREE.Vector3(0.03, 0.03, 0.03) },
        fogCol: { value: new THREE.Vector3() }, fogK: { value: 0 }, time: { value: 0 }, offset: { value: new THREE.Vector3() }, seaUp: { value: new THREE.Vector3() },
        ...lightUniforms,
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        up: { value: new THREE.Vector3(0, 0, 1) }, sunDir: { value: new THREE.Vector3(0, 0, 1) }, skyCol: { value: new THREE.Vector3() }, duskCol: { value: new THREE.Vector3() },
        thick: { value: 0 }, haze: { value: 0 }, inside: { value: 0 }, fogCol: { value: new THREE.Vector3() },
      },
    }));
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.sky.visible = false;
    scene.add(this.sky);
    try {
      if (typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('./terrainworker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<Patch>) => { this.busy = false; this.take(e.data); this.next(); };
        this.worker.onerror = () => { this.worker = null; this.busy = false; this.next(); };
      }
    } catch { this.worker = null; }
  }

  /** is this a world you can stand on? */
  static solid(b: Body) { return solid(b); }

  /** the height of the ground (m above the datum) in a direction in the body's frame, as fine as `fine` m */
  heightAt(n: V3, fine = 0.5) {
    if (!this.spec) return 0;
    this.paint ??= groundPainter(this.spec.look);
    return groundAt(this.spec, n, fine, this.sample, this.paint, this.det);
  }
  /** the ground sample there (after heightAt) */
  get last_sample() { return this.sample; }

  /** the up direction (unit, body frame) of the ground at n: from the heights around it */
  normalAt(n: V3, span = 1.5): V3 {
    if (!this.spec) return n;
    const [e, nn] = tangent(n), R = this.spec.R, k = span / R;
    const at = (a: number, b: number): V3 => { const m: V3 = [n[0] + e[0] * a + nn[0] * b, n[1] + e[1] * a + nn[1] * b, n[2] + e[2] * a + nn[2] * b]; const l = Math.hypot(...m); return [m[0] / l, m[1] / l, m[2] / l]; };
    const hE = this.heightAt(at(k, 0)), hW = this.heightAt(at(-k, 0)), hN = this.heightAt(at(0, k)), hS = this.heightAt(at(0, -k));
    const gx = (hE - hW) / (2 * span), gy = (hN - hS) / (2 * span);
    const u: V3 = [n[0] - gx * e[0] - gy * nn[0], n[1] - gx * e[1] - gy * nn[1], n[2] - gx * e[2] - gy * nn[2]];
    const l = Math.hypot(...u);
    return [u[0] / l, u[1] / l, u[2] / l];
  }

  /** switch to a body (or none) */
  private setBody(b: Body | null, stars: Body[]) {
    if (b === this.body) return;
    this.body = b;
    this.clearAll();
    this.spec = null; this.atmo = null; this.lifeInfo = null; this.paint = null;
    if (!b) return;
    this.atmo = atmosphere(b, stars);
    this.lifeInfo = life(b, stars);
    this.spec = groundSpec(b.look, b.r * AU_M, gravity(b), this.atmo.bar);
    this.sites = sitesOn(b.look.real);
    // a civilisation's towns, seeded
    this.towns = this.sites.filter(s => s.kind === 'city').map(s => ({ name: s.name, lat: s.lat, lon: s.lon, pop: s.pop ?? 1, alien: false }));
    if (this.lifeInfo.tier === 'intelligent') {
      const r = rng(b.look.seed, 77), people = this.lifeInfo.forms.find(f => f.kind === 'people')?.name ?? 'the locals';
      for (let k = 0; k < 14; k++) {
        const lat = Math.asin(2 * r() - 1) / (Math.PI / 180), lon = r() * 360 - 180;
        const n = dirOf(lat, lon);
        this.heightAt(n, 1000);
        if (this.sample.sea) continue;
        this.towns.push({ name: `A town of ${people}`, lat, lon, pop: 0.5 + 6 * r(), alien: true });
      }
    }
  }

  private clearAll() {
    if (this.mesh) { this.root.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (this.rocks) { this.rocks.dispose(); this.rocks = null; }
    for (const p of this.placed.values()) { this.root.remove(p.obj); disposeTree(p.obj); }
    this.placed.clear();
    for (const f of this.flora) { this.root.remove(f); f.dispose(); }
    this.flora = [];
    this.floraAt = null;
    for (const c of this.critters) { this.root.remove(c.obj); disposeTree(c.obj); }
    this.critters = [];
    this.patch = null;
    this.ready = false;
    this.want = null;
    this.jobId++;
  }

  /** a patch from the worker: make it the mesh */
  private take(p: Patch) {
    if (p.id !== this.jobId || !this.spec) return;
    this.patch = p;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(p.col, 3));
    g.setAttribute('sea', new THREE.BufferAttribute(p.sea, 1));
    g.setIndex(new THREE.BufferAttribute(p.index, 1));
    const R = this.spec.R;
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.geometry = g; }
    else { this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.root.add(this.mesh); }
    this.mesh.position.set(p.c[0] * R, p.c[1] * R, p.c[2] * R);
    // the grain's lattice, kept still as the patch moves: the middle's position, modulo its period
    const L = 2048;
    (this.mat.uniforms.offset.value as THREE.Vector3).set(mod(p.c[0] * R, L), mod(p.c[1] * R, L), mod(p.c[2] * R, L));
    // boulders
    if (this.rocks) { this.mesh.remove(this.rocks); this.rocks.dispose(); this.rocks = null; }
    const n = p.rocks.length / 4;
    if (n) {
      const rk = new THREE.InstancedMesh(this.rockGeo, this.rockMat, n);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), at = new THREE.Vector3(), c = new THREE.Color();
      for (let k = 0; k < n; k++) {
        const sz = p.rocks[k * 4 + 3];
        e.set(hash(k, 1, 2) * 6, hash(k, 3, 4) * 6, hash(k, 5, 6) * 6);
        q.setFromEuler(e);
        s.set(sz * (0.8 + 0.6 * hash(k, 7, 1)), sz * (0.5 + 0.4 * hash(k, 8, 1)), sz * (0.8 + 0.6 * hash(k, 9, 1)));
        at.set(p.rocks[k * 4], p.rocks[k * 4 + 1], p.rocks[k * 4 + 2]);
        m.compose(at, q, s);
        rk.setMatrixAt(k, m);
        // the colour of the ground it sits on, darker
        const vi = nearestVertex(p, at);
        c.setRGB(p.col[vi * 3] * 0.7, p.col[vi * 3 + 1] * 0.7, p.col[vi * 3 + 2] * 0.7);
        rk.setColorAt(k, c);
      }
      rk.frustumCulled = false;
      this.rocks = rk;
      this.mesh.add(rk);
    }
    this.ready = true;
  }

  private next() {
    if (this.busy || !this.want) return;
    const job = this.want;
    this.want = null;
    this.busy = true;
    if (this.worker) this.worker.postMessage(job);
    else setTimeout(() => { this.busy = false; this.take(buildPatch(job)); this.next(); }, 0);
  }

  /**
   * Each frame: `b` the solid world nearest the viewer (or null), `rel` its
   * centre from the viewer (m, world), `sun` the direction to the star that
   * lights it (world) and its colour, `cam` the camera.
   */
  frame(dt: number, b: Body | null, rel: THREE.Vector3, stars: Body[], sun: THREE.Vector3 | null, sunRGB: V3, giant: { inside: number; fog: THREE.Color } | null) {
    this.t += dt;
    // a world near enough to stand on
    const near = b && solid(b) ? b : null;
    let alt = Infinity;
    if (near) {
      const d = rel.length();
      alt = d - near.r * AU_M;
      if (alt > Math.min(0.15 * near.r * AU_M, 300e3) * (this.body === near ? 1.2 : 1)) { this.setBody(null, stars); }
      else this.setBody(near, stars);
    } else this.setBody(null, stars);
    this.skyFrame(rel, sun, sunRGB, giant);
    const body = this.body, spec = this.spec;
    if (!body || !spec) { this.root.visible = false; this.fogK = 0; return; }
    this.root.visible = true;
    bodyQuat(body, this.q);
    this.root.position.copy(rel);
    this.root.quaternion.copy(this.q);
    // where the viewer is over the ground
    const vb = rel.clone().negate().applyQuaternion(this.q.clone().invert());
    const r = vb.length();
    const n: V3 = [vb.x / r, vb.y / r, vb.z / r];
    const hHere = this.heightAt(n, 50);
    alt = r - spec.R - Math.max(0, hHere);
    // a new patch when the viewer has moved far enough, or come much closer or gone further off
    const { r0, rMax } = patchSize(alt, spec.R, spec.relief);
    const moved = Math.acos(Math.min(1, n[0] * this.last.c[0] + n[1] * this.last.c[1] + n[2] * this.last.c[2])) * spec.R;
    if (!this.patch && !this.busy && !this.want || moved > Math.max(8, alt * 0.4) || r0 > this.last.r0 * 2.2 || r0 < this.last.r0 / 2.2) {
      if (!this.busy || moved > Math.max(8, alt * 0.4) * 3) {
        this.last = { c: n, r0 };
        this.want = { id: ++this.jobId, spec, c: n, r0, rMax, rings: 112, segs: 168 };
        this.next();
      }
    }
    // the light on the ground
    const u = this.mat.uniforms;
    u.time.value = this.t;
    if (sun) (u.sunDir.value as THREE.Vector3).copy(sun);
    (u.sunCol.value as THREE.Vector3).set(this.sunCol.r, this.sunCol.g, this.sunCol.b);
    const a = this.atmo!, amb = 0.015 + 0.25 * this.daylight * Math.min(1, a.bar);
    (u.ambient.value as THREE.Vector3).set(amb * (0.6 + 0.4 * this.skyCol.r), amb * (0.6 + 0.4 * this.skyCol.g), amb * (0.6 + 0.4 * this.skyCol.b));
    // the haze: how far you can see, from the density of the air here and what is in it
    // (the Earth's air at sea level fades things to a third every 20 km or so, so a mountain 60 km off is a
    // pale shape and one past 100 km is gone; Mars' dust about the same; Venus and Titan close in to a few km)
    const dens = a.bar > 1e-4 ? a.bar * Math.exp(-Math.max(0, alt) / Math.max(1, a.H * 1000)) : 0;
    this.fogK = dens > 0 ? Math.min(1 / 1500, dens * (0.3 + 4 * a.haze) / 18e3 + a.haze * 6 * Math.min(1, dens / 0.003) / 45e3) : 0;
    u.fogK.value = this.fogK;
    // the haze is the colour of the sky at the horizon, so the far ground melts into it without a seam
    const fog = this.horizon;
    this.fogCol.copy(fog);
    (u.fogCol.value as THREE.Vector3).set(fog.r, fog.g, fog.b);
    this.rockMat.color.setScalar(1);
    // things on the ground, near enough to matter
    if (alt < 60e3) this.placeSites(n, alt);
    if (alt < 3000) this.life(dt, n);
    else if (this.flora.length || this.critters.length) this.clearLife();
  }

  /** the sky: its colour from the air, how much of it there is above you, and the sun's height */
  private skyFrame(rel: THREE.Vector3, sun: THREE.Vector3 | null, sunRGB: V3, giant: { inside: number; fog: THREE.Color } | null) {
    const b = this.body, a = this.atmo;
    const su = (this.sky.material as THREE.ShaderMaterial).uniforms;
    const up = rel.clone().negate().normalize();
    (su.up.value as THREE.Vector3).copy(up);
    if (sun) (su.sunDir.value as THREE.Vector3).copy(sun);
    su.inside.value = giant?.inside ?? 0;
    if (giant) (su.fogCol.value as THREE.Vector3).set(giant.fog.r, giant.fog.g, giant.fog.b);
    if (!b || !a || a.bar < 1e-4) {
      this.daylight = sun ? smooth(-0.05, 0.05, sun.dot(up)) : 0;
      this.sunCol.copy(light(sunRGB)).multiplyScalar(sun ? 1.15 : 0);
      this.skyCol.setRGB(0, 0, 0);
      su.thick.value = 0;
      this.sky.visible = !!giant && giant.inside > 0;
      return;
    }
    const alt = rel.length() - b.r * AU_M;
    // the air above you: how much of the column is left
    const col = a.bar * Math.exp(-Math.max(0, alt) / (a.H * 1000));
    // the sky's brightness: scattering by the gas, and by dust or haze, which can light a thin sky (Mars's) all by itself
    const thick = 1 - Math.exp(-(col * 4 + a.haze * 3 * Math.min(1, col / 0.003)));
    const s = sun ? sun.dot(up) : -1;
    this.daylight = smooth(-0.12, 0.12, s) * (sun ? 1 : 0);
    const sky = new THREE.Color(a.sky), dusk = new THREE.Color(a.dusk);
    (su.skyCol.value as THREE.Vector3).set(sky.r, sky.g, sky.b);
    (su.duskCol.value as THREE.Vector3).set(dusk.r, dusk.g, dusk.b);
    su.thick.value = thick;
    su.haze.value = a.haze;
    this.sky.visible = thick > 0.01 || !!giant;
    this.skyCol.copy(sky).multiplyScalar(this.daylight * thick);
    // the sky's colour at the horizon, as its shader draws it over the dark
    const dayS = smooth(-0.2, 0.1, s), low = 1 - smooth(0, 0.35, Math.abs(s + 0.05));
    this.horizon.copy(sky).lerp(new THREE.Color(1, 1, 1), 0.45 + 0.4 * a.haze)
      .multiplyScalar((0.2 + 0.8 * dayS) * thick * Math.min(1, dayS + 0.6 * low * (1 - dayS)));
    // sunlight through the air: reddened toward the horizon, dimmed under thick cloud
    const path = Math.min(40, 1 / Math.max(0.03, s + 0.05)) * Math.min(1, col);
    const red = light(sunRGB);
    red.r *= Math.exp(-path * 0.02); red.g *= Math.exp(-path * 0.06); red.b *= Math.exp(-path * 0.12);
    const veil = Math.exp(-a.haze * Math.min(col, 100) * (a.bar > 10 ? 0.05 : 0.6));
    this.sunCol.copy(red).multiplyScalar(1.15 * Math.max(0.05, veil) * smooth(-0.08, 0.04, s));
    // under a thick cloud deck the light comes from the whole sky
    if (a.bar > 10 || a.haze > 0.7) this.sunCol.lerp(sky.clone().multiplyScalar(0.5 * this.daylight), 0.6);
  }

  // ---------------------------------------------------------------- sites, cities and towns
  private placeSites(n: V3, alt: number) {
    const spec = this.spec!, R = spec.R;
    const wantKeys = new Set<string>();
    for (const s of this.sites) {
      if (s.kind === 'city') continue;
      const sn = dirOf(s.lat, s.lon);
      const d = arc(n, sn) * R;
      if (d > 40e3 + alt * 2) continue;
      wantKeys.add(s.name);
      if (!this.placed.has(s.name)) {
        const obj = siteModel(s);
        this.stand(obj, sn);
        this.root.add(obj);
        this.placed.set(s.name, { obj, key: s.name });
      }
      if (d < 500 && alt < 1500 && !this.found.has(s.name)) { this.found.add(s.name); this.onFind(s.name, s.about); }
    }
    for (const t of this.towns) {
      const tn = dirOf(t.lat, t.lon);
      const d = arc(n, tn) * R;
      const key = `town:${t.name}:${t.lat}`;
      const radius = 2500 * Math.sqrt(t.pop) + 2000;
      if (d > radius + 60e3) continue;
      wantKeys.add(key);
      if (!this.placed.has(key)) {
        const obj = t.alien ? this.alienTown(tn, t.pop, Math.floor(t.lat * 1000)) : this.city(tn, t.pop, radius);
        this.root.add(obj);
        this.placed.set(key, { obj, key });
      }
      if (d < radius && !this.found.has(key)) { this.found.add(key); this.onFind(t.alien ? t.name : t.name, t.alien ? 'An alien town: built, lit and lived in.' : `A city of ${t.pop} million.`); }
    }
    for (const [k, p] of this.placed) if (!wantKeys.has(k)) { this.root.remove(p.obj); disposeTree(p.obj); this.placed.delete(k); }
    // city lights come on at night
    const night = 1 - this.daylight;
    for (const p of this.placed.values()) p.obj.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined; if (m && (m as { userData?: { glow?: boolean } }).userData?.glow) m.emissive.setRGB(0.9 * night, 0.7 * night, 0.35 * night); });
  }

  /** put an object on the ground in a direction, standing up */
  stand(obj: THREE.Object3D, n: V3, lift = 0) {
    const h = this.heightAt(n, 0.5);
    const R = this.spec!.R + Math.max(h, this.sample.sea ? 0 : h) + lift;
    obj.position.set(n[0] * R, n[1] * R, n[2] * R);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n[0], n[1], n[2]));
  }

  /** an Earth city: blocks of buildings, tallest in the middle, lit at night */
  private city(c: V3, pop: number, radius: number) {
    const g = new THREE.Group();
    const N = Math.min(1800, Math.round(300 + 60 * pop));
    const mat = new THREE.MeshLambertMaterial({ color: 0x8a909c });
    mat.userData.glow = true;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, N);
    const [e, nn] = tangent(c), R = this.spec!.R;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(), col = new THREE.Color();
    let k = 0;
    const r = rng(Math.floor(c[0] * 1e6), 3);
    // centred on the first building's ground, for float precision
    const base = new THREE.Vector3(c[0] * R, c[1] * R, c[2] * R);
    for (let i = 0; i < N * 3 && k < N; i++) {
      const rad = radius * Math.pow(r(), 0.7), ang = r() * Math.PI * 2;
      // on a street grid
      const gx = Math.round((Math.cos(ang) * rad) / 120) * 120, gy = Math.round((Math.sin(ang) * rad) / 120) * 120;
      const th = Math.hypot(gx, gy) / R;
      const dx = Math.hypot(gx, gy) > 0 ? gx / Math.hypot(gx, gy) : 0, dy = Math.hypot(gx, gy) > 0 ? gy / Math.hypot(gx, gy) : 0;
      const dir: V3 = [Math.cos(th) * c[0] + Math.sin(th) * (dx * e[0] + dy * nn[0]), Math.cos(th) * c[1] + Math.sin(th) * (dx * e[1] + dy * nn[1]), Math.cos(th) * c[2] + Math.sin(th) * (dx * e[2] + dy * nn[2])];
      const h = this.heightAt(dir, 5);
      if (this.sample.sea) continue;
      const core = Math.exp(-Math.hypot(gx, gy) / (radius * 0.25));
      const tall = 8 + (core * 220 + 20) * Math.pow(r(), 2.5);
      up.set(dir[0], dir[1], dir[2]);
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      p.set(dir[0] * (R + h) - base.x, dir[1] * (R + h) - base.y, dir[2] * (R + h) - base.z);
      s.set(25 + 50 * r(), tall, 25 + 50 * r());
      m.compose(p, q, s);
      mesh.setMatrixAt(k, m);
      const gr = 0.45 + 0.4 * r();
      mesh.setColorAt(k, col.setRGB(gr, gr * (0.95 + 0.1 * r()), gr * (1 + 0.1 * r())));
      k++;
    }
    mesh.count = k;
    mesh.frustumCulled = false;
    g.position.copy(base);
    g.add(mesh);
    return g;
  }

  /** an alien town: domes, stepped towers and spires, in a ring round a plaza */
  private alienTown(c: V3, pop: number, seed: number) {
    const g = new THREE.Group();
    const [e, nn] = tangent(c), R = this.spec!.R;
    const base = new THREE.Vector3(c[0] * R, c[1] * R, c[2] * R);
    g.position.copy(base);
    const r = rng(seed, 5);
    const hue = new THREE.Color().setHSL(r(), 0.35, 0.6).getHex();
    const n = Math.min(60, Math.round(15 + 8 * pop));
    for (let k = 0; k < n; k++) {
      const rad = 60 + 900 * Math.sqrt(pop) * Math.pow(r(), 0.8), ang = r() * Math.PI * 2;
      const th = rad / R;
      const dir: V3 = [Math.cos(th) * c[0] + Math.sin(th) * (Math.cos(ang) * e[0] + Math.sin(ang) * nn[0]), Math.cos(th) * c[1] + Math.sin(th) * (Math.cos(ang) * e[1] + Math.sin(ang) * nn[1]), Math.cos(th) * c[2] + Math.sin(th) * (Math.cos(ang) * e[2] + Math.sin(ang) * nn[2])];
      const h = this.heightAt(dir, 5);
      if (this.sample.sea) continue;
      const b = alienMesh(seed + k, hue);
      b.position.set(dir[0] * (R + h) - base.x, dir[1] * (R + h) - base.y, dir[2] * (R + h) - base.z);
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir));
      b.rotateY(r() * 6);
      g.add(b);
    }
    return g;
  }

  // ---------------------------------------------------------------- living things
  private clearLife() {
    for (const f of this.flora) { this.root.remove(f); f.dispose(); }
    this.flora = [];
    this.floraAt = null;
    for (const c of this.critters) { this.root.remove(c.obj); disposeTree(c.obj); }
    this.critters = [];
  }

  /** what grows and walks round you: scattered when you arrive, again when you have moved on */
  private life(dt: number, n: V3) {
    const b = this.body!, spec = this.spec!, L = this.lifeInfo!, R = spec.R;
    const earth = b.look.real === 'Earth';
    const alive = earth || L.tier === 'plants' || L.tier === 'animals' || L.tier === 'intelligent';
    if (!alive) return;
    if (!this.floraAt || arc(n, this.floraAt) * R > 150) {
      this.clearLife();
      this.floraAt = n;
      // the biome here
      this.heightAt(n, 5);
      const smp = this.sample;
      let near = false;
      for (const t of this.towns) if (arc(n, dirOf(t.lat, t.lon)) * R < 2500 * Math.sqrt(t.pop)) near = true;
      this.biome = earth ? earthBiome(Math.asin(n[2]) * 180 / Math.PI, [smp.r, smp.g, smp.b], smp.sea, smp.h, near) : null;
      this.scatter(n);
    }
    // the animals wander
    for (const c of this.critters) {
      c.t -= dt;
      if (c.t < 0) { c.t = 2 + Math.random() * 5; c.head += (Math.random() - 0.5) * 2; c.speed = Math.random() < 0.3 ? 0 : c.speed || 0.5 + Math.random(); }
      const [e, nn] = tangent(c.n);
      const step = (c.speed * dt) / R;
      const m: V3 = [c.n[0] + (Math.cos(c.head) * e[0] + Math.sin(c.head) * nn[0]) * step, c.n[1] + (Math.cos(c.head) * e[1] + Math.sin(c.head) * nn[1]) * step, c.n[2] + (Math.cos(c.head) * e[2] + Math.sin(c.head) * nn[2]) * step];
      const l = Math.hypot(...m);
      c.n = [m[0] / l, m[1] / l, m[2] / l];
      if (arc(c.n, n) * R > 250) c.head += Math.PI;
      this.stand(c.obj, c.n, c.fly);
      c.obj.rotateY(-c.head + Math.PI / 2);
      // a bob as it walks
      c.obj.children[0].position.y = Math.abs(Math.sin(this.t * 6 * c.speed)) * 0.08 * c.obj.scale.y;
      const d = arc(c.n, n) * R;
      if (d < 40 && !this.found.has(c.name)) { this.found.add(c.name); this.onFind(c.name, 'Life form, seen up close.'); }
    }
  }

  private scatter(n: V3) {
    const b = this.body!, spec = this.spec!, L = this.lifeInfo!, R = spec.R;
    const earth = b.look.real === 'Earth';
    const [e, nn] = tangent(n);
    const r = rng(Math.floor((n[0] + 2) * 1e7) ^ Math.floor((n[1] + 2) * 1e5), 9);
    // what grows here, how much of it and what it looks like
    let kinds: { col: number; size: number; cone: boolean; name: string }[] = [];
    let density = 0;
    if (earth) {
      const bi = this.biome!;
      const plants = speciesIn(bi).filter(s => s.kind === 'plant' && s.size > 1);
      kinds = plants.map(p => ({ col: p.color, size: p.size, cone: /spruce|sequoia|pine/i.test(p.name), name: `${p.name} (${p.latin})` }));
      density = { tropical: 1, temperate: 0.6, boreal: 0.7, grassland: 0.08, desert: 0.03, mountain: 0.3, city: 0.15, tundra: 0, ice: 0, ocean: 0 }[bi];
    } else {
      kinds = L.forms.filter(f => f.kind === 'plant').map(f => ({ col: f.color, size: Math.min(40, f.size), cone: /spire|tower|reed/.test(f.about), name: `${f.name}, a ${f.about}` }));
      density = L.tier === 'plants' ? 0.5 : 0.7;
    }
    if (kinds.length && density > 0) {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 1, 5).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x5a4030, flatShading: true }), 1200);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 1200);
      const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(0.4, 1, 6).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 1200);
      let a = 0, bN = 0, cN = 0;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
      const base = new THREE.Vector3(n[0] * R, n[1] * R, n[2] * R);
      for (let k = 0; k < 2400 && a < 1200; k++) {
        const rad = 6 + 300 * Math.sqrt(r()), ang = r() * Math.PI * 2;
        if (r() > density) continue;
        const th = rad / R;
        const dir: V3 = [Math.cos(th) * n[0] + Math.sin(th) * (Math.cos(ang) * e[0] + Math.sin(ang) * nn[0]), Math.cos(th) * n[1] + Math.sin(th) * (Math.cos(ang) * e[1] + Math.sin(ang) * nn[1]), Math.cos(th) * n[2] + Math.sin(th) * (Math.cos(ang) * e[2] + Math.sin(ang) * nn[2])];
        const h = this.heightAt(dir, 2);
        if (this.sample.sea) continue;
        const kind = kinds[Math.floor(r() * kinds.length)];
        const sz = kind.size * (0.5 + 0.7 * r());
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir));
        p.set(dir[0] * (R + h) - base.x, dir[1] * (R + h) - base.y, dir[2] * (R + h) - base.z);
        s.set(Math.max(0.6, sz * 0.12), sz * 0.6, Math.max(0.6, sz * 0.12));
        m.compose(p, q, s);
        trunk.setMatrixAt(a++, m);
        const top = p.clone().add(new THREE.Vector3(...dir).multiplyScalar(sz * (kind.cone ? 0.25 : 0.45)));
        col.setHex(kind.col).offsetHSL(0, 0, (r() - 0.5) * 0.12);
        if (kind.cone) { s.set(sz * 0.45, sz * 0.8, sz * 0.45); m.compose(top, q, s); cone.setMatrixAt(cN, m); cone.setColorAt(cN++, col); }
        else { s.set(sz * 0.6, sz * 0.55, sz * 0.6); m.compose(top, q, s); crown.setMatrixAt(bN, m); crown.setColorAt(bN++, col); }
        if (rad < 60 && !this.found.has(kind.name)) { this.found.add(kind.name); this.onFind(kind.name, 'Plant life.'); }
      }
      trunk.count = a; crown.count = bN; cone.count = cN;
      for (const im of [trunk, crown, cone]) { im.position.copy(base); im.frustumCulled = false; this.root.add(im); this.flora.push(im); }
    }
    // animals
    let fauna: { name: string; size: number; color: number; fly: boolean }[] = [];
    if (earth) fauna = speciesIn(this.biome!).filter(s => s.kind === 'animal' && s.size > 0.1 && s.name !== 'Human').map(s => ({ name: `${s.name} (${s.latin})`, size: s.size, color: s.color, fly: /macaw|condor|robin|pigeon|bee/i.test(s.name) }));
    else if (L.tier === 'animals' || L.tier === 'intelligent') fauna = L.forms.filter(f => f.kind === 'animal').map(f => ({ name: `${f.name}, a ${f.about}`, size: f.size, color: f.color, fly: /gliding|floating/.test(f.about) }));
    if (this.biome === 'ocean') fauna = [];
    const nF = fauna.length ? Math.min(14, 4 + Math.floor(r() * 10)) : 0;
    for (let k = 0; k < nF; k++) {
      const f = fauna[Math.floor(r() * fauna.length)];
      const obj = critterMesh(f.color, f.fly);
      obj.scale.setScalar(Math.max(0.3, f.size));
      const rad = 20 + 160 * r(), ang = r() * Math.PI * 2, th = rad / R;
      const cn: V3 = [Math.cos(th) * n[0] + Math.sin(th) * (Math.cos(ang) * e[0] + Math.sin(ang) * nn[0]), Math.cos(th) * n[1] + Math.sin(th) * (Math.cos(ang) * e[1] + Math.sin(ang) * nn[1]), Math.cos(th) * n[2] + Math.sin(th) * (Math.cos(ang) * e[2] + Math.sin(ang) * nn[2])];
      this.root.add(obj);
      this.critters.push({ obj, n: cn, head: r() * 6.28, speed: 0.5 + r(), fly: f.fly ? 8 + 20 * r() : 0, name: f.name, t: r() * 3 });
    }
  }

  /** labels for what is on the ground near you: name and world position from the viewer */
  labels(): { key: string; text: string; at: THREE.Vector3 }[] {
    const out: { key: string; text: string; at: THREE.Vector3 }[] = [];
    if (!this.body || !this.spec) return out;
    const R = this.spec.R;
    const vb = this.root.position.clone().negate().applyQuaternion(this.q.clone().invert());
    const n: V3 = vb.clone().normalize().toArray() as V3;
    const list = [...this.sites.filter(s => s.kind !== 'city').map(s => ({ name: s.name, lat: s.lat, lon: s.lon })), ...this.towns.map(t => ({ name: t.name, lat: t.lat, lon: t.lon }))];
    // what the air lets you see: past where the haze has taken nineteen parts in twenty, nothing
    const seeing = this.fogK > 0 ? 3 / this.fogK : Infinity;
    const rv = vb.length();
    for (const s of list) {
      const sn = dirOf(s.lat, s.lon);
      const d = arc(n, sn) * R;
      if (d > 1500e3) continue;
      const h = this.heightAt(sn, 200);
      const rs = R + Math.max(0, h) + 30;
      // and nothing over the horizon: the line of sight must clear the world's curve
      const gap = Math.hypot(sn[0] * rs - vb.x, sn[1] * rs - vb.y, sn[2] * rs - vb.z);
      if (gap > seeing || gap > Math.sqrt(Math.max(0, rv * rv - R * R)) + Math.sqrt(Math.max(0, rs * rs - R * R)) + 200) continue;
      const p = new THREE.Vector3(sn[0] * rs, sn[1] * rs, sn[2] * rs).applyQuaternion(this.q).add(this.root.position);
      out.push({ key: `site:${s.name}`, text: `${s.name} · ${d < 1000 ? `${d.toFixed(0)} m` : `${(d / 1000).toFixed(d < 1e4 ? 1 : 0)} km`}`, at: p });
    }
    return out;
  }

  /** the sites on this world (for Mission Control) */
  siteList() { return this.sites.filter(s => s.kind !== 'city'); }
  /** the sites on any world */
  siteListFor(b: Body) { return sitesOn(b.look.real).filter(s => s.kind !== 'city'); }
  townList() { return this.towns; }
  /** everything found so far */
  get discoveries() { return [...this.found]; }
}

// ------------------------------------------------------------------ helpers
export function dirOf(latD: number, lonD: number): V3 {
  const la = (latD * Math.PI) / 180, lo = (lonD * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}
export function latLonOf(n: V3): [number, number] {
  return [(Math.asin(Math.max(-1, Math.min(1, n[2]))) * 180) / Math.PI, (Math.atan2(n[1], n[0]) * 180) / Math.PI];
}
export const arc = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const mod = (x: number, m: number) => ((x % m) + m) % m;
/** a star's light as it falls on the ground: its colour, but far less saturated than the map's glyph for it */
function light(rgb: V3) {
  const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-3);
  return new THREE.Color(0.8 + 0.2 * rgb[0] / m, 0.8 + 0.2 * rgb[1] / m, 0.8 + 0.2 * rgb[2] / m);
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function nearestVertex(p: Patch, at: THREE.Vector3) {
  // the rocks are laid out from vertices, so the nearest on its ring is close enough: search a little
  let best = 0, bd = Infinity;
  const n = p.pos.length / 3, step = Math.max(1, Math.floor(n / 4000));
  for (let k = 0; k < n; k += step) {
    const d = (p.pos[k * 3] - at.x) ** 2 + (p.pos[k * 3 + 1] - at.y) ** 2 + (p.pos[k * 3 + 2] - at.z) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse(x => {
    const m = x as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) (m as unknown as THREE.InstancedMesh).dispose();
  });
}

/** what a real site looks like */
function siteModel(s: Site): THREE.Object3D {
  const g = new THREE.Group();
  if (s.kind === 'apollo') {
    g.add(apolloMesh());
    const f = flagMesh();
    f.position.set(-6, 0, 3);
    g.add(f);
    if (/15|16|17/.test(s.name)) { const l = lrvMesh(); l.position.set(12, 0, -8); l.rotation.y = 0.7; g.add(l); }
  } else if (s.kind === 'rover') {
    const r = roverMesh(/Sojourner/.test(s.name) ? 0.3 : /Yutu|Zhurong|Lunokhod/.test(s.name) ? 0.7 : /Spirit|Opportunity/.test(s.name) ? 0.55 : 1);
    g.add(r);
    if (/Pathfinder|Chang|Perseverance/.test(s.name)) { const l = landerMesh(); l.position.set(-14, 0, 6); g.add(l); }
  } else if (s.kind === 'probe') g.add(huygensMesh());
  else if (s.kind === 'impact') { /* nothing left but its crater */ }
  else if (s.body === 'Venus') g.add(veneraMesh());
  else if (s.body === 'Earth') { const p = probeMesh(); p.scale.setScalar(4); g.add(p); }
  else g.add(landerMesh());
  return g;
}

/** an animal: a body, four legs and a head; or wings for a flyer */
function critterMesh(color: number, fly: boolean) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); inner.add(o); return o; };
  if (fly) {
    add(new THREE.BoxGeometry(0.2, 0.15, 0.5), 0, 0, 0);
    const w1 = add(new THREE.BoxGeometry(0.8, 0.02, 0.25), -0.45, 0.05, 0), w2 = add(new THREE.BoxGeometry(0.8, 0.02, 0.25), 0.45, 0.05, 0);
    w1.rotation.z = 0.3; w2.rotation.z = -0.3;
  } else {
    add(new THREE.BoxGeometry(0.4, 0.35, 0.9), 0, 0.6, 0);
    add(new THREE.BoxGeometry(0.25, 0.25, 0.3), 0, 0.85, -0.55);
    for (const x of [-0.15, 0.15]) for (const z of [-0.32, 0.32]) add(new THREE.BoxGeometry(0.08, 0.45, 0.08), x, 0.22, z);
  }
  return g;
}
