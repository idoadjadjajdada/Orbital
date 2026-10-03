import * as THREE from 'three';

/**
 * A black hole as it would look: traced, not painted. Round the hole a sphere
 * whose every pixel follows a ray of light back from the eye, bent by the
 * hole's gravity on its way (the photon's orbit equation in Schwarzschild
 * space, x″ = −3/2 h² x / r⁵ in units of the horizon's radius). A ray that
 * falls through the horizon is black: the shadow, 2.6 times the horizon
 * across. One that skims the photon sphere at 1.5 picks up the thin bright
 * ring. One that crosses the accretion disc picks up its light — and the disc
 * is seen not just where it is but bent up over the top of the hole and under
 * the bottom, its far side lensed into view, as Interstellar showed it.
 *
 * The disc runs from the innermost stable orbit (3 horizon radii) outward,
 * hottest just outside it (the thin-disc law T ∝ r^−¾ (1 − √(r_in/r))^¼),
 * white-blue inside fading through gold to a dull red rim. Its gas goes round
 * at the orbital speed of each radius, so the inner streaks lap the outer
 * ones; the side coming toward you is brighter and bluer than the side going
 * away (Doppler beaming at up to half the speed of light), and everything near
 * the hole is reddened by the climb out of its well.
 *
 * The jets leave along the spin axis: glowing cones, brightest down their
 * spine, with knots of brighter plasma streaming out along them.
 */

const DISC_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float RB;
varying vec3 vL;
void main() {
  vL = position * RB;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const DISC_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
float sq(float x) { return x * x; }
uniform vec3 camL;
uniform mat4 invProj;
uniform mat3 viewToLocal;
uniform vec2 res;
uniform float RB;
uniform float rIn;
uniform float rOut;
uniform float glow;
uniform float time;
uniform float hue;
uniform float glare;
varying vec3 vL;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec2 turn(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
/** the gas at radius r, carried round k seconds' worth at its orbital speed */
float gas(vec2 q, float r, float k) {
  vec2 u = turn(q, -0.9 * pow(r, -1.5) * k) / r;
  float lr = log(r);
  return vnoise3(vec3(u * 7.0, lr * 9.0)) * 0.55 + vnoise3(vec3(u * 19.0, lr * 26.0)) * 0.3 + vnoise3(vec3(u * 47.0, lr * 60.0)) * 0.15;
}
/** blackbody-ish colour for a temperature, 0 (dull red) to 2 (blue-white) */
vec3 heat(float t) {
  vec3 c = mix(vec3(0.6, 0.12, 0.02), vec3(1.0, 0.55, 0.18), smoothstep(0.0, 0.5, t));
  c = mix(c, vec3(1.0, 0.86, 0.62), smoothstep(0.45, 0.95, t));
  c = mix(c, vec3(0.92, 0.95, 1.0), smoothstep(0.9, 1.5, t));
  return mix(c, vec3(0.7, 0.8, 1.0), smoothstep(1.4, 2.2, t));
}
/** the sky behind, in a direction: stars on a fine grid of cells, one in some of them, round and soft */
vec3 stars(vec3 d) {
  vec3 c = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float N = k == 0 ? 90.0 : 230.0;
    vec3 g = d * N, cell = floor(g);
    float h = hash3(cell + float(k) * 17.0);
    if (h > (k == 0 ? 0.93 : 0.965)) {
      vec3 ctr = cell + 0.5 + (vec3(hash3(cell + 3.1), hash3(cell + 7.7), hash3(cell + 1.3)) - 0.5) * 0.6;
      float dd = length(g - ctr);
      float m = hash3(cell + 9.9);
      vec3 tint = mix(vec3(1.0, 0.8, 0.6), vec3(0.75, 0.85, 1.0), m);
      c += tint * exp(-dd * dd * 18.0) * (0.35 + 0.9 * pow(hash3(cell + 5.5), 4.0));
    }
  }
  return c;
}
vec4 discAt(vec3 q, vec3 d) {
  float r = length(q.xy);
  // the thin-disc temperature, 1 at its peak just outside the inner edge — over a radius squeezed so that
  // however far the gas reaches (an X-ray binary's disc is a hundred thousand horizons across) it runs
  // from white-hot to a red rim, rather than being all too cold to see past the middle
  float k = min(1.0, log(60.0) / log(max(rOut / rIn, 1.01)));
  float x = rIn / (rIn * pow(r / rIn, k));
  float T = pow(x, 0.75) * pow(max(0.0, 1.0 - sqrt(x)), 0.25) / 0.488;
  // its gas, flowing: two looks faded into each other so the shear never builds
  float P = 14.0, p1 = fract(time / P), p2 = fract(time / P + 0.5);
  float g0 = mix(gas(q.xy, r, (p1 - 0.5) * P), gas(q.xy, r, (p2 - 0.5) * P), abs(2.0 * p1 - 1.0));
  // Doppler: the gas comes toward the eye on one side (beta up to 0.5 at the inner edge), and climbs out of the well
  vec3 v = normalize(vec3(-q.y, q.x, 0.0));
  float beta = sqrt(0.5 / max(r - 1.0, 1.05));
  float gam = 1.0 / sqrt(1.0 - beta * beta);
  float g = sqrt(max(0.0, 1.0 - 1.0 / r)) / (gam * (1.0 - beta * dot(v, -d)));
  // (T² near the hole, but the outer disc kept faintly glowing red rather than gone: the eye adapts)
  float I = pow(g, 3.0) * (T * T + 0.75 * pow(T, 0.4) * (1.0 - T)) * (0.35 + 1.3 * g0 * g0) * glow;
  // (its colour as the eye sees it: the outer gas a warm orange, the inner white-hot, shifted by the Doppler factor)
  vec3 c = heat(pow(T, 0.45) * g * (0.85 + 0.35 * hue) + 0.2 * (g0 - 0.5)) * I * 1.25;
  float edge = smoothstep(rIn * 0.95, rIn * 1.12, r) * (1.0 - smoothstep(rOut * 0.6, rOut, r));
  float a = clamp(edge * (0.55 + 0.6 * g0) * (0.35 + 0.65 * glow), 0.0, 1.0);
  return vec4(c, a);
}
void main() {
  #include <logdepthbuf_fragment>
  // the ray through this pixel, exactly, from the screen position (not interpolated across the sphere's triangles)
  vec4 v = invProj * vec4(gl_FragCoord.xy / res * 2.0 - 1.0, -1.0, 1.0);
  vec3 d = normalize(viewToLocal * normalize(v.xyz / v.w));
  vec3 p = camL;
  // into the sphere the bending is worth tracing in
  float b = dot(p, d), c = dot(p, p) - RB * RB, disc = b * b - c;
  if (disc < 0.0) discard;
  p += d * max(0.0, -b - sqrt(disc));
  vec3 d0 = d;
  vec3 h = cross(p, d);
  float h2 = dot(h, h);
  vec3 col = vec3(0.0);
  float alpha = 0.0, rMin = 1e9;
  bool fell = false;
  // velocity Verlet: the path is a chain of parabolas meeting smoothly, so a ray grazing the disc
  // crosses it where its neighbours do, with no seams where the steps fall differently
  vec3 acc = -1.5 * h2 * p / pow(length(p), 5.0);
  for (int i = 0; i < 240; i++) {
    float r = length(p);
    rMin = min(rMin, r);
    if (r < 1.0) { fell = true; break; }
    float dt = max(0.012, 0.05 * r * r / (r + 2.0));
    vec3 pn = p + d * dt + 0.5 * acc * dt * dt;
    float rn = length(pn);
    vec3 an = -1.5 * h2 * pn / pow(max(rn, 0.5), 5.0);
    if (glow > 0.0 && p.z * pn.z <= 0.0) {
      // where on this parabola it meets the disc's plane
      float A = 0.5 * acc.z, B = d.z, C = p.z, t;
      if (abs(A) * dt < 1e-6 * abs(B)) t = -C / B;
      else {
        float D = sqrt(max(0.0, B * B - 4.0 * A * C));
        float t1 = (-B - D) / (2.0 * A), t2 = (-B + D) / (2.0 * A);
        t = (t1 >= 0.0 && t1 <= dt) ? t1 : t2;
      }
      t = clamp(t, 0.0, dt);
      vec3 q = p + d * t + 0.5 * acc * t * t;
      float rq = length(q.xy);
      if (rq > rIn * 0.95 && rq < rOut) {
        vec4 e = discAt(q, normalize(d + acc * t));
        col += (1.0 - alpha) * e.rgb * e.a;
        alpha += (1.0 - alpha) * e.a;
        if (alpha > 0.985) break;
      }
    }
    d += 0.5 * (acc + an) * dt;
    acc = an;
    p = pn;
    if (r > RB * 1.001 && dot(p, d) > 0.0) break;
  }
  // what is behind, bent: the stars seen past the hole along the bent ray, where the bending is enough to
  // show (further out the real sky shows through unbent)
  if (!fell && alpha < 0.99) {
    float defl = acos(clamp(dot(normalize(d), d0), -1.0, 1.0));
    float a = smoothstep(0.004, 0.05, defl);
    col += (1.0 - alpha) * stars(normalize(d)) * a;
    alpha += (1.0 - alpha) * a;
  }
  // the photon ring: light that wound round the hole on its way
  float ring = exp(-sq((rMin - 1.52) / 0.05)) * (0.25 + 1.2 * glow);
  col += (1.0 - alpha) * vec3(1.0, 0.85, 0.65) * ring;
  alpha = max(alpha, min(1.0, ring));
  if (fell) alpha = 1.0;
  // the glare of the inner disc, round the hole's direction: a few degrees across however far off, so a fed
  // hole is a brilliant point from afar, as quasars are (and kept inside the traced sphere)
  if (glare > 0.0) {
    float D = length(camL);
    float ang = acos(clamp(dot(d0, -camL / D), -1.0, 1.0));
    float sig = max(atan(40.0 / D), 0.012);
    float edge = D > RB ? asin(RB / D) : 3.2;
    float gl = glare * (exp(-sq(ang / sig)) * 1.4 + 0.35 * exp(-ang / (2.5 * sig))) * (1.0 - smoothstep(0.6 * edge, edge, ang));
    col += vec3(1.0, 0.93, 0.85) * gl;
  }
  // tone: bright, but never clipped flat
  col = 1.0 - exp(-col * 1.4);
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = max(vec3(0.0), mix(vec3(lum), col, 1.3));
  gl_FragColor = vec4(col, alpha);
}`;

export const JET_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

/**
 * a jet, as glowing gas rather than a cone's walls: for the ray through each pixel, the nearest it
 * passes to the jet's axis, and how far out along it; bright where it passes close, the glow
 * widening with distance as a jet does, fading toward the tip, with knots streaming out
 */
export const JET_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
float sq(float x) { return x * x; }
uniform float power;
uniform float time;
uniform vec3 col;
uniform vec3 base;
uniform vec3 axis;
uniform float len;
/** how wide (1 a jet's) and how knotted (0 smooth, 1 a jet's knots) */
uniform float wid;
uniform float knotK;
uniform vec3 eye;
uniform mat4 invProj;
uniform mat3 viewToWorld;
uniform vec2 res;
varying vec3 vP;
void main() {
  #include <logdepthbuf_fragment>
  vec4 v = invProj * vec4(gl_FragCoord.xy / res * 2.0 - 1.0, -1.0, 1.0);
  vec3 r = normalize(viewToWorld * normalize(v.xyz / v.w));
  // the closest approach of the eye's ray (from the origin) to the axis line (from base)
  float b = dot(r, axis), w0d = dot(base, r), w0a = dot(base, axis);
  float den = max(1.0 - b * b, 1e-6);
  float tr = (w0d - b * w0a) / den;
  float s = (b * w0d - w0a) / den;
  if (tr < 0.0) { s = -w0a; tr = 0.0; }
  float t = s / len;
  if (t > 1.0) discard;
  // behind the root, the glow is rounded off round it rather than cut flat
  if (t < 0.0) { t = 0.0; s = 0.0; tr = max(dot(base, r), 0.0); }
  float d = length(r * tr - (base + axis * s)) / len;
  // its width: narrow at the root, opening out
  float wdt = (0.003 + 0.028 * t) * wid;
  float core = exp(-sq(d / wdt) * 2.5);
  float sheath = exp(-sq(d / (wdt * 2.2))) * 0.07;
  float along = exp(-t * 2.4) * (1.0 - smoothstep(0.6, 1.0, t));
  float k = fract(t * 7.0 - time * 0.25);
  float knots = mix(1.0, 0.6 + 0.9 * exp(-sq((k - 0.5) / 0.09)), knotK);
  float I = (core * knots + sheath) * along * power;
  vec3 c = mix(col, vec3(1.0), core * 0.55) * I * 1.8;
  gl_FragColor = vec4(1.0 - exp(-c), 1.0);
}`;

export class HoleLook {
  readonly group = new THREE.Group();
  private disc: THREE.Mesh;
  private jets: THREE.Group;
  private mat: THREE.ShaderMaterial;
  private jetMats: THREE.ShaderMaterial[] = [];
  private q = new THREE.Quaternion();
  /** the glare of the inner disc, seen from afar when the disc itself is a few pixels */


  /** jetLen: the jets' length in horizon radii */
  constructor(glow: THREE.Texture, private jetLen = 3000) {
    const rOut = 16, RB = 250;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        camL: { value: new THREE.Vector3() }, RB: { value: RB },
        invProj: { value: new THREE.Matrix4() }, viewToLocal: { value: new THREE.Matrix3() }, res: { value: new THREE.Vector2(1, 1) }, rIn: { value: 3 }, rOut: { value: rOut },
        glow: { value: 0 }, time: { value: 0 }, hue: { value: 0.5 }, glare: { value: 0 },
      },
    });
    this.disc = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.mat);
    this.disc.scale.setScalar(RB);
    this.disc.frustumCulled = false;
    this.group.add(this.disc);
    // two cones, apex at the hole, opening along +z and −z
    this.jets = new THREE.Group();
    for (const s of [1, -1]) {
      const m = new THREE.ShaderMaterial({
        vertexShader: JET_VERT, fragmentShader: JET_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
        uniforms: {
          power: { value: 0 }, time: { value: 0 }, col: { value: new THREE.Color(0.55, 0.7, 1.0) },
          base: { value: new THREE.Vector3() }, axis: { value: new THREE.Vector3(0, 0, s) }, len: { value: 1 }, eye: { value: new THREE.Vector3() }, wid: { value: 1 }, knotK: { value: 1 },
          invProj: { value: new THREE.Matrix4() }, viewToWorld: { value: new THREE.Matrix3() }, res: { value: new THREE.Vector2(1, 1) },
        },
      });
      m.userData.sign = s;
      this.jetMats.push(m);
      // a bounding cone round the glow: unit length along y (0 at the hole, 1 at the tip)
      const g = new THREE.CylinderGeometry(0.15, 0.03, 1, 32, 1, false).translate(0, 0.5, 0);
      const cone = new THREE.Mesh(g, m);
      cone.frustumCulled = false;
      cone.rotation.x = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.jets.add(cone);
    }
    this.jets.scale.setScalar(jetLen);
    this.group.add(this.jets);
    void glow;
  }

  /**
   * Each frame: the spin axis (the disc's normal, the jets' line), how brightly it feeds (0–1),
   * how strong the jets are (0–1), the eye in the hole's own units, and the clock
   */
  /** the disc's outer edge, in horizon radii (the bright inner disc, or out to the torus round a quasar) */
  /** the disc's outer edge, horizon radii */
  get outer() { return this.mat.uniforms.rOut.value as number; }

  setOuter(rOut: number) {
    const u = this.mat.uniforms;
    if (Math.abs(u.rOut.value - rOut) < rOut * 0.05) return;
    u.rOut.value = rOut;
    // far enough out that the light's bending has faded to almost nothing
    const RB = Math.max(rOut * 1.25, 250);
    u.RB.value = RB;
    this.disc.scale.setScalar(RB);
    // the jets reach well past the disc, however big it is
    this.jets.scale.setScalar(Math.max(this.jetLen, rOut * 2.5));
  }

  update(axis: THREE.Vector3, glow: number, jet: number, cam: THREE.Camera, res: THREE.Vector2, time: number, hue = 0.5) {
    const eyeWorld = cam.getWorldPosition(new THREE.Vector3());
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
    this.disc.quaternion.copy(this.q);
    this.jets.quaternion.copy(this.q);
    this.group.updateMatrixWorld(true);
    const u = this.mat.uniforms;
    (u.camL.value as THREE.Vector3).copy(this.disc.worldToLocal(eyeWorld.clone())).multiplyScalar(u.RB.value);
    (u.invProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    const ql = this.disc.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(cam.getWorldQuaternion(new THREE.Quaternion()));
    (u.viewToLocal.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(ql));
    (u.res.value as THREE.Vector2).copy(res);
    u.glow.value = glow;
    u.time.value = time;
    u.hue.value = hue;
    this.jets.visible = jet > 0.02;
    // the glare: as bright as it is fed, and less when the eye is close enough to see the disc itself
    const dist = (u.camL.value as THREE.Vector3).length();
    const near = Math.min(1, dist / 150);
    u.glare.value = glow * 0.9 * near;
    // the jets' line in the eye's frame (the eye at the origin), for the glow
    const origin = this.group.getWorldPosition(new THREE.Vector3()).sub(eyeWorld);
    const len = this.jets.scale.x * this.group.getWorldScale(new THREE.Vector3()).x;
    for (const m of this.jetMats) {
      m.uniforms.power.value = jet; m.uniforms.time.value = time;
      (m.uniforms.base.value as THREE.Vector3).copy(origin);
      (m.uniforms.axis.value as THREE.Vector3).set(0, 0, m.userData.sign).applyQuaternion(this.q).normalize();
      m.uniforms.len.value = len;
      (m.uniforms.eye.value as THREE.Vector3).copy(eyeWorld);
      (m.uniforms.invProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
      (m.uniforms.viewToWorld.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())));
      (m.uniforms.res.value as THREE.Vector2).copy(res);
    }
  }

  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
  }
}
