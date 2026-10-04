import * as THREE from 'three';
import { JET_VERT, JET_FRAG } from './hole';

/**
 * The other strange things, as they would look up close.
 *
 * A nebula — a planetary nebula, a supernova remnant — is a shell of glowing
 * gas, brightest where the line of sight runs along it (so a ring round its
 * edge, as the Ring and Helix nebulae look), traced pixel by pixel through
 * the shell: a planetary nebula's ionised oxygen blue-green inside its rim of
 * red hydrogen and nitrogen, a remnant's blue-white filaments shot with red,
 * both torn into knots and threads.
 *
 * A pulsar's two beams leave along its magnetic axis, tilted from its spin,
 * and sweep round with it like a lighthouse's.
 *
 * A protoplanetary disc is dust lit by its young star: bright rings and dark
 * gaps where planets are clearing their paths (as ALMA sees HL Tauri),
 * dimming outward, its clumps going round at their orbital speeds.
 */

// ------------------------------------------------------------------ nebula
const NEB_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const NEB_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
float sq(float x) { return x * x; }
uniform vec3 camL;
uniform mat4 invProj;
uniform mat3 viewToLocal;
uniform vec2 res;
uniform float thick;
uniform float bright;
uniform vec3 inner;
uniform vec3 rim;
uniform float fill;
uniform float time;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float threads(vec3 p) {
  float a = 1.0 - abs(2.0 * vnoise3(p * 3.0) - 1.0);
  float b = 1.0 - abs(2.0 * vnoise3(p * 7.0 + 4.1) - 1.0);
  return pow(a, 3.0) * 0.65 + pow(b, 4.0) * 0.35;
}
void main() {
  #include <logdepthbuf_fragment>
  vec4 v = invProj * vec4(gl_FragCoord.xy / res * 2.0 - 1.0, -1.0, 1.0);
  vec3 d = normalize(viewToLocal * normalize(v.xyz / v.w));
  // the stretch of the ray inside the outer sphere (radius 1.3; the shell sits at 1)
  float B = dot(camL, d), C = dot(camL, camL) - 1.69, D = B * B - C;
  if (D < 0.0) discard;
  float t0 = max(0.0, -B - sqrt(D)), t1 = -B + sqrt(D);
  if (t1 <= 0.0) discard;
  vec3 acc = vec3(0.0);
  const int N = 48;
  float dt = (t1 - t0) / float(N);
  for (int i = 0; i < N; i++) {
    vec3 p = camL + d * (t0 + (float(i) + 0.5) * dt);
    float r = length(p);
    // the shell, rippled, and the faint gas filling it
    float wob = (vnoise3(p * 2.2 + 3.0) - 0.5) * 0.25;
    float shell = exp(-sq((r - 1.0 - wob) / thick));
    float th = threads(p + vec3(0.0, 0.0, time * 0.002));
    float dens = shell * (0.35 + 1.6 * th) + fill * smoothstep(1.05, 0.2, r) * (0.5 + 0.7 * vnoise3(p * 4.0));
    // colour: the inner gas's, turning to the rim's at the shell's outer edge
    vec3 c = mix(inner, rim, smoothstep(0.85, 1.12, r + wob * 0.5));
    acc += c * dens * dt;
  }
  vec3 col = 1.0 - exp(-acc * bright);
  gl_FragColor = vec4(col, 1.0);
}`;

export class NebulaLook {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(kind: 'pne' | 'snr') {
    const pne = kind === 'pne';
    this.mat = new THREE.ShaderMaterial({
      vertexShader: NEB_VERT, fragmentShader: NEB_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        camL: { value: new THREE.Vector3() }, invProj: { value: new THREE.Matrix4() }, viewToLocal: { value: new THREE.Matrix3() }, res: { value: new THREE.Vector2(1, 1) },
        thick: { value: pne ? 0.13 : 0.08 }, bright: { value: pne ? 1.3 : 1.5 }, fill: { value: pne ? 0.35 : 0.05 },
        inner: { value: pne ? new THREE.Color(0.25, 0.85, 0.8) : new THREE.Color(0.55, 0.7, 1.0) },
        rim: { value: pne ? new THREE.Color(1.0, 0.32, 0.28) : new THREE.Color(1.0, 0.45, 0.35) },
        time: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1.3, 48, 24), this.mat);
    this.mesh.frustumCulled = false;
  }
  /** where the eye is, the shell's radius in the parent's units, the camera and the screen */
  update(R: number, cam: THREE.Camera, res: THREE.Vector2, time: number) {
    this.mesh.scale.setScalar(R);
    this.mesh.updateMatrixWorld(true);
    const u = this.mat.uniforms;
    const eye = cam.getWorldPosition(new THREE.Vector3());
    (u.camL.value as THREE.Vector3).copy(this.mesh.worldToLocal(eye));
    (u.invProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    const ql = this.mesh.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(cam.getWorldQuaternion(new THREE.Quaternion()));
    (u.viewToLocal.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(ql));
    (u.res.value as THREE.Vector2).copy(res);
    u.time.value = time;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------ pulsars and magnetars
/**
 * What is round a pulsar, as Chandra sees the Crab's: a bright inner ring and a
 * wider torus of plasma round its equator, flowing round it; matter lifted out
 * of the torus along the magnetic field's lines (the dipole's r = L sin²θ),
 * funnelled up to the poles; and the jets that leave the poles, brightest down
 * their spines, with knots of plasma streaming out. A magnetar's field is a
 * thousand times stronger, its loops twisted and brighter, flaring now and then.
 * Traced through a sphere round the star, in units of its radius, its spin up z.
 */
const PSR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
float sq(float x) { return x * x; }
uniform vec3 camL;
uniform mat4 invProj;
uniform mat3 viewToLocal;
uniform vec2 res;
uniform float RB;
uniform float time;
uniform float mag;
uniform float flare;
uniform vec3 hot;
uniform vec3 cool;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
/** the light from gas at a point: colour times density */
vec3 glowAt(vec3 p) {
  float r = length(p), rho = length(p.xy);
  if (r < 1.0) return vec3(0.0);
  float phi = atan(p.y, p.x);
  vec3 c = vec3(0.0);
  // the torus and the inner ring: plasma going round, faster inside (two looks faded so the shear never builds)
  float P = 20.0, p1 = fract(time / P), p2 = fract(time / P + 0.5);
  float w1 = phi - 3.0 * pow(rho / 6.0, -1.5) * (p1 - 0.5) * P * 0.05;
  float w2 = phi - 3.0 * pow(rho / 6.0, -1.5) * (p2 - 0.5) * P * 0.05;
  // wisps: fine arcs round the star, drawn out by the flow, wandering in radius
  float n1 = vnoise3(vec3(cos(w1) * 2.0, sin(w1) * 2.0, rho * 1.6)) * 0.6 + vnoise3(vec3(cos(w1) * 5.0, sin(w1) * 5.0, rho * 4.5)) * 0.4;
  float n2 = vnoise3(vec3(cos(w2) * 2.0, sin(w2) * 2.0, rho * 1.6)) * 0.6 + vnoise3(vec3(cos(w2) * 5.0, sin(w2) * 5.0, rho * 4.5)) * 0.4;
  float swirl = mix(n1, n2, abs(2.0 * p1 - 1.0));
  float wisp = smoothstep(0.45, 0.8, swirl);
  float th = 0.25 + 0.05 * rho;
  float torus = exp(-sq((rho - 15.0) / 4.5)) * exp(-sq(p.z / th)) * (0.1 + 0.9 * wisp) * 0.6;
  float ring = exp(-sq((rho - 7.0) / 0.45)) * exp(-sq(p.z / 0.25)) * (0.15 + 1.4 * wisp) * 0.7;
  // the inner disc it feeds from, close in, spiralling down toward the star
  float inner = exp(-sq(p.z / (0.12 + 0.03 * rho))) * smoothstep(1.4, 2.5, rho) * (1.0 - smoothstep(5.0, 8.0, rho)) * (0.3 + 1.2 * wisp) * 0.7;
  c += cool * torus + mix(cool, hot, 0.6) * ring + hot * inner;
  // matter lifted along the field's lines: on the dipole's shells r = L sin²θ, streaming poleward in strands
  float s2 = max(1.0 - sq(p.z / r), 1e-3);
  float L = r / s2;
  float twist = mag * 1.2 * (p.z / r);
  float strands = smoothstep(0.55, 0.85, vnoise3(vec3(cos(phi + twist) * 2.2, sin(phi + twist) * 2.2, L * 0.6)));
  float along = abs(p.z) / r;
  float flow = 0.45 + 0.55 * sin((along * 9.0 - time * (1.3 + mag)) * 3.14159);
  float shell = exp(-sq((L - (5.0 + 2.0 * mag)) / (0.9 + 0.8 * mag)));
  float field = shell * strands * flow * smoothstep(0.05, 0.25, along) * (1.8 + 1.5 * mag);
  c += mix(cool, hot, 0.5) * field * (1.0 + flare * 2.5);
  // the jets: out of the poles, narrow at the surface and opening slowly, knots streaming out
  float az = abs(p.z);
  float wj = 0.18 + 0.05 * az;
  float core = exp(-sq(rho / wj)) * smoothstep(0.9, 1.6, az) * (1.0 - smoothstep(18.0, 38.0, az));
  // knots, irregular, streaming outward; and the jet's edge wavering (kinked, as the Crab's is)
  float kn = vnoise3(vec3(az * 0.35 - time * 1.4, sign(p.z) * 5.0, 0.0));
  float knot = 0.5 + 0.9 * smoothstep(0.5, 0.85, kn);
  c += mix(hot, vec3(1.0), 0.25) * core * knot * 1.3;
  c += cool * exp(-sq(rho / (wj * 2.8))) * smoothstep(1.0, 2.5, az) * (1.0 - smoothstep(18.0, 38.0, az)) * 0.12;
  return c;
}
void main() {
  #include <logdepthbuf_fragment>
  vec4 v = invProj * vec4(gl_FragCoord.xy / res * 2.0 - 1.0, -1.0, 1.0);
  vec3 d = normalize(viewToLocal * normalize(v.xyz / v.w));
  float B = dot(camL, d), C = dot(camL, camL) - RB * RB, D = B * B - C;
  if (D < 0.0) discard;
  float t0 = max(0.0, -B - sqrt(D)), t1 = -B + sqrt(D);
  if (t1 <= 0.0) discard;
  // stop at the star itself
  float Bs = B, Cs = dot(camL, camL) - 1.0, Ds = Bs * Bs - Cs;
  if (Ds > 0.0) { float ts = -Bs - sqrt(Ds); if (ts > t0) t1 = min(t1, ts); }
  vec3 acc = vec3(0.0);
  const int N = 72;
  float dt = (t1 - t0) / float(N);
  // (dithered start, so the steps do not show as bands)
  float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < N; i++) acc += glowAt(camL + d * (t0 + (float(i) + j) * dt)) * dt;
  vec3 col = 1.0 - exp(-acc * 0.9);
  gl_FragColor = vec4(col, 1.0);
}`;

export class PulsarLook {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private beams: PulsarBeams;
  private jets: PulsarBeams;
  private RB = 40;
  constructor(private magnetar: boolean) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: NEB_VERT, fragmentShader: PSR_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        camL: { value: new THREE.Vector3() }, invProj: { value: new THREE.Matrix4() }, viewToLocal: { value: new THREE.Matrix3() }, res: { value: new THREE.Vector2(1, 1) },
        RB: { value: this.RB }, time: { value: 0 }, mag: { value: magnetar ? 1 : 0 }, flare: { value: 0 },
        hot: { value: magnetar ? new THREE.Color(0.95, 0.7, 1.0) : new THREE.Color(0.75, 0.88, 1.0) },
        cool: { value: magnetar ? new THREE.Color(0.55, 0.3, 0.95) : new THREE.Color(0.35, 0.55, 1.0) },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(this.RB, 48, 24), this.mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    // the jets carry on far past the traced sphere, along the spin; the lighthouse beams sweep from the magnetic poles
    this.jets = new PulsarBeams(magnetar, 'jet');
    this.beams = new PulsarBeams(magnetar, 'beam');
    this.group.add(this.jets.group, this.beams.group);
  }
  /**
   * each frame: the spin axis (world), the angle it has turned, the star's world radius scale,
   * the camera and screen, the clock
   */
  update(spin: THREE.Vector3, angle: number, cam: THREE.Camera, res: THREE.Vector2, time: number) {
    // the parent turns with the star (thirty times a second for a pulsar): undo that, and stand up the spin
    const parent = this.group.parent!;
    const pq = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.group.quaternion.copy(pq.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), spin.clone().normalize())));
    this.group.updateMatrixWorld(true);
    const u = this.mat.uniforms;
    const eye = cam.getWorldPosition(new THREE.Vector3());
    (u.camL.value as THREE.Vector3).copy(this.mesh.worldToLocal(eye.clone()));
    (u.invProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    const ql = this.mesh.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(cam.getWorldQuaternion(new THREE.Quaternion()));
    (u.viewToLocal.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(ql));
    (u.res.value as THREE.Vector2).copy(res);
    u.time.value = time;
    // a magnetar's crust gives way now and then: a flare, bright for a moment, fading over a few seconds
    if (this.magnetar) { const ph = (time % 13) / 13; u.flare.value = ph < 0.35 ? Math.exp(-ph * 14) : 0; }
    const z = new THREE.Vector3(0, 0, 1);
    this.jets.update(z, 0, 3000, cam, res, time, 0.5 + (this.magnetar ? 0.6 * u.flare.value : 0));
    this.beams.update(z, angle, 1500, cam, res, time, this.magnetar ? 0.28 : 0.2);
  }
  dispose() {
    this.mesh.geometry.dispose(); this.mat.dispose();
    this.jets.dispose(); this.beams.dispose();
  }
}

export class PulsarBeams {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private q = new THREE.Quaternion();
  /** 'jet': along the spin, steady; 'beam': a lighthouse beam, from the magnetic poles 35° off it */
  constructor(private strong: boolean, private kind: 'jet' | 'beam' = 'beam') {
    for (const s of [1, -1]) {
      const m = new THREE.ShaderMaterial({
        vertexShader: JET_VERT, fragmentShader: JET_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
        uniforms: {
          power: { value: 1 }, time: { value: 0 },
          col: { value: kind === 'jet' ? (strong ? new THREE.Color(0.75, 0.55, 1.0) : new THREE.Color(0.55, 0.72, 1.0)) : new THREE.Color(0.8, 0.88, 1.0) },
          base: { value: new THREE.Vector3() }, axis: { value: new THREE.Vector3() }, len: { value: 1 }, eye: { value: new THREE.Vector3() },
          invProj: { value: new THREE.Matrix4() }, viewToWorld: { value: new THREE.Matrix3() }, res: { value: new THREE.Vector2(1, 1) },
          wid: { value: kind === 'jet' ? 0.7 : 0.45 }, knotK: { value: kind === 'jet' ? 1 : 0 }, rise: { value: 0 },
          unit: { value: 1 }, funnel: { value: kind === 'jet' ? 1.2 : 0 }, funnelL: { value: 3 }, shadow: { value: 0 }, start: { value: 1 }, discR: { value: 0 }, pxAng: { value: 0.002 },
        },
      });
      m.userData.sign = s;
      this.mats.push(m);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.03, 1, 24, 1, false).translate(0, 0.5, 0), m);
      cone.frustumCulled = false;
      cone.rotation.x = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(cone);
    }
  }
  /** the axis (in the parent's frame), the angle turned, the length (in the parent's units), the camera, the clock, the strength */
  update(spin: THREE.Vector3, angle: number, len: number, cam: THREE.Camera, res: THREE.Vector2, time: number, power = 0.9) {
    const z = spin.clone().normalize();
    let m = z;
    if (this.kind === 'beam') {
      const ref = Math.abs(z.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const x = new THREE.Vector3().crossVectors(ref, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
      const tilt = 35 * Math.PI / 180;
      m = z.clone().multiplyScalar(Math.cos(tilt)).add(x.multiplyScalar(Math.sin(tilt) * Math.cos(angle))).add(y.multiplyScalar(Math.sin(tilt) * Math.sin(angle)));
    }
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), m);
    this.group.quaternion.copy(this.q);
    this.group.scale.setScalar(len);
    this.group.updateMatrixWorld(true);
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const origin = this.group.getWorldPosition(new THREE.Vector3());
    const wlen = len * this.group.parent!.getWorldScale(new THREE.Vector3()).x;
    const wq = this.group.getWorldQuaternion(new THREE.Quaternion());
    for (const mt of this.mats) {
      const u = mt.uniforms;
      u.power.value = this.kind === 'beam' && this.strong ? power * (0.85 + 0.15 * Math.sin(time * 9) * Math.sin(time * 3.7)) : power;
      u.time.value = time;
      (u.base.value as THREE.Vector3).copy(origin);
      (u.axis.value as THREE.Vector3).set(0, 0, mt.userData.sign).applyQuaternion(wq).normalize();
      u.len.value = wlen;
      (u.eye.value as THREE.Vector3).copy(eye);
      (u.invProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
      (u.viewToWorld.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())));
      (u.res.value as THREE.Vector2).copy(res);
      u.unit.value = this.group.parent!.parent!.getWorldScale(new THREE.Vector3()).x;
      u.pxAng.value = 2 * Math.tan(((cam as THREE.PerspectiveCamera).fov ?? 70) * Math.PI / 360) / Math.max(1, res.y);
    }
  }
  dispose() { this.group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); }); }
}

// ------------------------------------------------------------------ protoplanetary disc
const DUST_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vXY;
void main() {
  vXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const DUST_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
float sq(float x) { return x * x; }
uniform float rIn;
uniform float rOut;
uniform vec3 tint;
uniform float time;
varying vec2 vXY;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec2 turn(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float clumps(vec2 p, float r, float k) {
  vec2 q = turn(p, -0.25 * pow(r / rIn, -1.5) * k) / r;
  return vnoise3(vec3(q * 6.0, log(r) * 14.0)) * 0.6 + vnoise3(vec3(q * 17.0, log(r) * 40.0)) * 0.4;
}
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vXY);
  if (r < rIn || r > rOut) discard;
  float x = log(r / rIn) / log(rOut / rIn);
  // gaps where planets clear their paths (at HL Tauri's: about a quarter, two fifths, three fifths and four fifths of the way out, in log radius)
  float gaps = 1.0;
  gaps *= 1.0 - 0.85 * exp(-sq((x - 0.27) / 0.025));
  gaps *= 1.0 - 0.7 * exp(-sq((x - 0.43) / 0.02));
  gaps *= 1.0 - 0.8 * exp(-sq((x - 0.6) / 0.03));
  gaps *= 1.0 - 0.6 * exp(-sq((x - 0.78) / 0.025));
  float P = 30.0, p1 = fract(time / P), p2 = fract(time / P + 0.5);
  float cl = mix(clumps(vXY, r, (p1 - 0.5) * P), clumps(vXY, r, (p2 - 0.5) * P), abs(2.0 * p1 - 1.0));
  // lit by the star: brighter inward, the outer edge fading out
  float lit = pow(rIn / r, 0.3) * smoothstep(rIn, rIn * 1.6, r) * (1.0 - smoothstep(0.75, 1.0, x));
  float a = clamp(gaps * lit * (0.6 + 0.6 * cl) * 1.2, 0.0, 1.0);
  vec3 c = mix(vec3(0.55, 0.32, 0.18), vec3(1.0, 0.8, 0.55), pow(lit, 0.7)) * tint;
  gl_FragColor = vec4(c * a, a * 0.85);
}`;

export class DustDisc {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  /** inner and outer radius in the parent's units */
  constructor(rIn: number, rOut: number) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { rIn: { value: rIn }, rOut: { value: rOut }, tint: { value: new THREE.Color(1, 1, 1) }, time: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 256, 4), this.mat);
    this.mesh.frustumCulled = false;
  }
  update(axis: THREE.Vector3, tint: [number, number, number], time: number) {
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
    (this.mat.uniforms.tint.value as THREE.Color).setRGB(tint[0], tint[1], tint[2]);
    this.mat.uniforms.time.value = time;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
