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
/** the eye's frame close to the hole: <0 holding still against its pull (a static observer); ≥0 falling freely
 *  from far off, at this speed (in c) relative to the still frame: √(r_s/r) */
uniform float fallB;
/** the sky at infinity, and the turn from the disc's frame to the world's, to look it up in */
uniform samplerCube sky;
uniform mat3 localToWorld;
varying vec3 vL;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec2 turn(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
/** the angle a pixel spans, and the distance from the eye to where the ray met the disc: a pixel's width there */
uniform float pxAng;
float fw = 0.0;
/** the gas at radius r, carried round k seconds' worth at its orbital speed */
float gas(vec2 q, float r, float k) {
  // drawn out round the hole into fine streaks, as shear does: slow to change round it, fast across radius
  // (and wound into spirals, as the shear winds every clump that forms: not rings, like a tree's)
  float lr = log(r);
  vec2 u = turn(q, -0.9 * pow(r, -1.5) * k + 2.2 * lr) / r;
  // (the radius wobbled a little round the hole, so the streaks wander rather than ring like a tree's)
  float w = (vnoise3(vec3(u * 2.2 + 11.0, lr * 3.0)) - 0.5) * 0.35;
  // (each scale of streak only where a pixel is fine enough to show it, else its average: no moiré from afar)
  float k1 = clamp((0.45 - fw * 30.0) / 0.3, 0.0, 1.0), k2 = clamp((0.45 - fw * 85.0) / 0.3, 0.0, 1.0), k3 = clamp((0.45 - fw * 150.0) / 0.3, 0.0, 1.0);
  float s1 = 0.5 + k1 * (vnoise3(vec3(u * 2.4, (lr + w) * 30.0)) - 0.5);
  float s2 = 0.5 + k2 * (vnoise3(vec3(u * 4.5 + 7.0, (lr + w * 0.6) * 85.0)) - 0.5);
  float s3 = 0.5 + k3 * (vnoise3(vec3(u * 9.0 + 3.0, lr * 150.0)) - 0.5);
  return s1 * 0.5 + s2 * 0.35 + s3 * 0.15;
}
/** the colour of the disc's light, by how bright it is: deep red, orange, gold, to near white at the brightest */
vec3 fire(float v) {
  vec3 c = mix(vec3(0.0), vec3(0.55, 0.06, 0.0), smoothstep(0.0, 0.25, v));
  c = mix(c, vec3(1.0, 0.33, 0.04), smoothstep(0.2, 0.55, v));
  c = mix(c, vec3(1.0, 0.68, 0.3), smoothstep(0.5, 0.85, v));
  return mix(c, vec3(1.0, 0.94, 0.8), smoothstep(0.82, 1.0, v));
}
vec4 discAt(vec3 q, vec3 d) {
  float r = length(q.xy);
  // the thin-disc temperature, 1 at its peak just outside the innermost stable orbit, falling as r^-3/4
  float x = rIn / r;
  float T = pow(x, 0.75) * pow(max(0.0, 1.0 - sqrt(x)), 0.25) / 0.488;
  // its gas, flowing: two looks faded into each other so the shear never builds
  float P = 14.0, p1 = fract(time / P), p2 = fract(time / P + 0.5);
  float g0 = mix(gas(q.xy, r, (p1 - 0.5) * P), gas(q.xy, r, (p2 - 0.5) * P), abs(2.0 * p1 - 1.0));
  // Doppler: the gas comes toward the eye on one side (beta up to 0.5 at the inner edge), and climbs out of the well
  vec3 v = normalize(vec3(-q.y, q.x, 0.0));
  float beta = sqrt(0.5 / max(r - 1.0, 1.05));
  float gam = 1.0 / sqrt(1.0 - beta * beta);
  float g = sqrt(max(0.0, 1.0 - 1.0 / r)) / (gam * (1.0 - beta * dot(v, -d)));
  // the bright disc within a few tens of horizons, and the dim gas past it out to wherever it reaches
  float streak = 0.25 + 1.5 * g0 * g0;
  // (bright out to a few tens of horizons as the eye sees it — T to a gentle power — then fading to the dim gas)
  float I = (pow(g, 3.0) * pow(T, 0.8) * (1.0 - 0.85 * smoothstep(18.0, 45.0, r)) + 0.02 * (1.0 - smoothstep(0.4 * rOut, rOut, r))) * streak * glow;
  float vb = 1.0 - exp(-I * (1.6 + 0.6 * hue));
  float edge = smoothstep(rIn * 0.97, rIn * 1.08, r) * (1.0 - smoothstep(rOut * 0.6, rOut, r));
  float a = clamp(vb * 1.6, 0.0, 1.0) * edge;
  return vec4(fire(vb), a);
}
/** light shifted by g (its frequency seen ÷ sent): brighter and bluer above 1, dimmer and redder below */
vec3 shifted(vec3 c, float g) {
  // (the brightness by g² rather than the g⁴ a meter would read, so a dimmed sky still shows; the colour by the shift)
  g = clamp(g, 0.0, 6.0);
  return c * vec3(pow(g, 1.4), pow(g, 2.0), pow(g, 2.6));
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
  // close in, the eye's own frame matters: a direction it looks along is a different ray of light for an eye held
  // still than for one falling in (aberration), and the light it sees shifted. From the ray's impact parameter
  // (L/E) and which way it goes, the direction to set off in the tracer's coordinates (whose flat start would
  // otherwise be the light's direction far off): 1/b² = 1/h² − 1/r³. Inside the horizon nothing holds still, so
  // the eye falls; and light that came up to it from below with negative energy came from where the hole formed:
  // dark.
  float r0 = length(p), gobs = 1.0;
  bool inside = r0 < RB * 0.999, dark = false;
  if (inside) {
    vec3 rh = p / r0;
    float k1 = dot(d, rh);
    vec3 kp = d - k1 * rh;
    float kpl = length(kp);
    vec3 th = kpl > 1e-6 ? kp / kpl : normalize(cross(rh, abs(rh.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    float bb, sgn;
    float fb = fallB >= 0.0 ? fallB : (r0 <= 1.0 ? 1.0 / sqrt(r0) : -1.0);
    if (fb >= 0.0) {
      float den = 1.0 + fb * k1;
      dark = den <= 0.0;
      bb = r0 * kpl / max(den, 1e-6);
      sgn = k1 + fb >= 0.0 ? 1.0 : -1.0;
      gobs = 1.0 / max(den, 1e-6);
    } else {
      float s = sqrt(max(1e-6, 1.0 - 1.0 / r0));
      bb = r0 * kpl / s;
      sgn = k1 >= 0.0 ? 1.0 : -1.0;
      gobs = 1.0 / s;
    }
    float u = 1.0 / r0;
    float hh = bb > 1e-9 ? 1.0 / sqrt(1.0 / (bb * bb) + u * u * u) : 0.0;
    float sa = clamp(hh / r0, 0.0, 1.0);
    d = normalize(sgn * sqrt(1.0 - sa * sa) * rh + sa * th);
  }
  if (dark) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 d0 = d;
  vec3 h = cross(p, d);
  float h2 = dot(h, h);
  vec3 col = vec3(0.0);
  float alpha = 0.0, rMin = 1e9;
  bool wasIn = dot(p, d) < 0.0;
  bool fell = false;
  // velocity Verlet: the path is a chain of parabolas meeting smoothly, so a ray grazing the disc
  // crosses it where its neighbours do, with no seams where the steps fall differently
  vec3 acc = -1.5 * h2 * p / pow(length(p), 5.0);
  for (int i = 0; i < 320; i++) {
    float r = length(p);
    // (closest approach: where the ray turns from coming in to going out; an eye close in is not itself one)
    float pd = dot(p, d);
    if (pd >= 0.0 && i > 0 && wasIn) rMin = min(rMin, r);
    wasIn = pd < 0.0;
    // (a ray from an eye inside the horizon starts below it, on its way out)
    if (r < 1.0 && dot(p, d) < 0.0) { fell = true; break; }
    float dt = r > 1.2 ? max(0.012, 0.035 * r * r / (r + 2.0)) : max(0.0008, 0.05 * r);
    vec3 pn = p + d * dt + 0.5 * acc * dt * dt;
    float rn = length(pn);
    vec3 an = -1.5 * h2 * pn / pow(max(rn, 1e-3), 5.0);
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
        // (the footprint in log radius: the pixel's width there, over the radius)
        fw = pxAng * (length(q - camL) + 1.0) / rq;
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
  // what is behind, bent: the real sky looked up along the ray as it leaves, so the stars behind the hole are
  // lensed into arcs and its shadow is a hole in them (the sky outside this sphere is the same sky, unbent)
  // (only where the bending shows: further out the real sky, and what is in front of it, shows through)
  if (!fell && alpha < 0.999) {
    float defl = acos(clamp(dot(normalize(d), d0), -1.0, 1.0));
    float a = inside ? 1.0 : smoothstep(0.01, 0.06, defl);
    col += (1.0 - alpha) * textureCube(sky, normalize(localToWorld * normalize(d))).rgb * a;
    alpha += (1.0 - alpha) * a;
  }
  // the photon ring: light that wound round the hole on its way
  // (round a hole with nothing to light it, only starlight wound round it: faint)
  float ring = exp(-sq((rMin - 1.52) / 0.05)) * (0.05 + 1.2 * glow);
  col += (1.0 - alpha) * vec3(1.0, 0.62, 0.3) * ring;
  alpha = max(alpha, min(1.0, ring));
  if (fell) alpha = 1.0;
  // seen from close in, all of it shifted by the eye's own motion and depth in the well
  if (inside) col = shifted(col, gobs);
  // the glare of the inner disc, round the hole's direction: a few degrees across however far off, so a fed
  // hole is a brilliant point from afar, as quasars are (and kept inside the traced sphere)
  if (glare > 0.0 && !fell) {
    float D = length(camL);
    float ang = acos(clamp(dot(d0, -camL / D), -1.0, 1.0));
    float sig = max(atan(40.0 / D), 0.012);
    float edge = D > RB ? asin(RB / D) : 3.2;
    float gl = glare * (exp(-sq(ang / sig)) * 1.4 + 0.35 * exp(-ang / (2.5 * sig))) * (1.0 - smoothstep(0.6 * edge, edge, ang));
    col += vec3(1.0, 0.93, 0.85) * gl;
  }
  // (the disc is already toned; only the glare and the ring can run over)
  col = min(col, vec3(1.0));
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
/**
 * a jet, as a dense beam of plasma: for the ray through each pixel, the nearest it passes to the jet's
 * axis and how far out along it. Right at the hole it flares into a wide funnel, the gas swept up off
 * the inner disc and channelled into it (in units of the body's radius: horizon radii for a hole, the
 * star's for a pulsar); a few tens of radii out it has narrowed into a tight, solid, white-hot beam
 * that stays bright a long way, opening only slowly, with knots streaming outward and a coloured
 * sheath round it. Never drawn thinner than a pixel or two, so it stays a solid line from far off.
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
uniform float rise;
/** the body's radius in world units; the funnel's width and length at the root, in those radii */
uniform float unit;
uniform float funnel;
uniform float funnelL;
/** the angle a pixel spans */
uniform float pxAng;
/** the shadow's radius in the body's radii (0: a star, nothing hidden) */
uniform float shadow;
/** where the beam lights up, in the body's radii from the centre */
uniform float start;
/** the bright disc's radius, in the body's radii (0: none): a jet seen through it is mostly hidden */
uniform float discR;
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
  if (t > 1.0 || t < 0.0) discard;
  float sr = s / unit;
  float dr = length(r * tr - (base + axis * s)) / unit;
  // behind a black hole, hidden by its shadow (2.6 horizon radii across, for the jet's own hole)
  float bc = dot(base, r);
  if (shadow > 0.0 && tr > bc && length(base - r * bc) / unit < shadow) discard;
  // behind the disc: where the line of sight crosses its plane before reaching the jet, within its bright part
  float hide = 1.0;
  float rn = dot(r, axis);
  if (discR > 0.0 && abs(rn) > 1e-4) {
    float tp = dot(base, axis) / rn;
    if (tp > 0.0 && tp < tr) hide = 1.0 - 0.85 * (1.0 - smoothstep(0.6 * discR, discR, length(r * tp - base) / unit));
  }
  // the beam: tight, opening slowly; never thinner on screen than about two pixels (its light spread to match)
  // (and flaring into a trumpet near its root: the beam itself widens as it comes down onto the hole)
  float wc = (0.55 + 0.0035 * sr + funnel * exp(-(sr - start) / funnelL)) * wid;
  float wpx = 1.2 * tr * pxAng / unit;
  float we = max(wc, wpx);
  float spread = clamp(wc / we, 0.35, 1.0);
  // the funnel at the root, flaring toward the hole
  float wf = wc * 2.2;
  float core = exp(-sq(dr / we) * 1.6) * spread;
  float fun = exp(-sq(dr / max(wf, we))) * exp(-sr / (funnelL * 2.0)) * step(0.001, funnel);
  float sheath = exp(-sq(dr / (we * 3.5))) * 0.1;
  // up to full brightness over its first couple of radii, then holding bright a long way before it fades
  float along = smoothstep(start, start + 1.5, sr) * exp(-t * 1.3) * (1.0 - smoothstep(0.75, 1.0, t));
  float k = fract(t * 7.0 - time * 0.25);
  float knots = mix(1.0, 0.75 + 0.6 * exp(-sq((k - 0.5) / 0.09)), knotK);
  vec3 c = vec3(1.0) * core * 2.6 * knots + mix(col, vec3(1.0), 0.35) * fun * 0.6 + col * sheath;
  c *= along * power * hide;
  gl_FragColor = vec4(1.0 - exp(-c * 1.4), 1.0);
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
  constructor(glow: THREE.Texture, sky: THREE.CubeTexture, private jetLen = 3000) {
    const rOut = 16, RB = 250;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        camL: { value: new THREE.Vector3() }, RB: { value: RB },
        invProj: { value: new THREE.Matrix4() }, viewToLocal: { value: new THREE.Matrix3() }, res: { value: new THREE.Vector2(1, 1) }, rIn: { value: 3 }, rOut: { value: rOut },
        glow: { value: 0 }, time: { value: 0 }, hue: { value: 0.5 }, glare: { value: 0 }, fallB: { value: -1 }, pxAng: { value: 0.002 },
        sky: { value: sky }, localToWorld: { value: new THREE.Matrix3() },
      },
    });
    this.disc = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.mat);
    this.disc.scale.setScalar(RB);
    this.disc.frustumCulled = false;
    this.disc.renderOrder = 1;
    this.group.add(this.disc);
    // two cones, apex at the hole, opening along +z and −z
    this.jets = new THREE.Group();
    for (const s of [1, -1]) {
      const m = new THREE.ShaderMaterial({
        vertexShader: JET_VERT, fragmentShader: JET_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
        uniforms: {
          power: { value: 0 }, time: { value: 0 }, col: { value: new THREE.Color(0.55, 0.7, 1.0) },
          base: { value: new THREE.Vector3() }, axis: { value: new THREE.Vector3(0, 0, s) }, len: { value: 1 }, eye: { value: new THREE.Vector3() }, wid: { value: 1 }, knotK: { value: 1 }, rise: { value: 0 },
          unit: { value: 1 }, funnel: { value: 2.2 }, funnelL: { value: 5 }, pxAng: { value: 0.002 }, shadow: { value: 2.6 }, start: { value: 2.8 }, discR: { value: 0 },
          invProj: { value: new THREE.Matrix4() }, viewToWorld: { value: new THREE.Matrix3() }, res: { value: new THREE.Vector2(1, 1) },
        },
      });
      m.userData.sign = s;
      this.jetMats.push(m);
      // a bounding cone round the glow: unit length along y (0 at the hole, 1 at the tip)
      const g = new THREE.CylinderGeometry(0.15, 0.15, 1, 32, 1, false).translate(0, 0.5, 0);
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

  /**
   * fall: <0 the eye is held still against the hole's pull; ≥0 it is falling in freely from far off (its speed
   * through the still frame, √(r_s/r), in c)
   */
  update(axis: THREE.Vector3, glow: number, jet: number, cam: THREE.Camera, res: THREE.Vector2, time: number, hue = 0.5, fall = -1) {
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
    (u.localToWorld.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.disc.getWorldQuaternion(new THREE.Quaternion())));
    u.glow.value = glow;
    u.fallB.value = fall;
    u.pxAng.value = 2 * Math.tan(((cam as THREE.PerspectiveCamera).fov ?? 70) * Math.PI / 360) / Math.max(1, res.y);
    u.time.value = time;
    u.hue.value = hue;
    this.jets.visible = jet > 0.02;
    // the glare: as bright as it is fed, and less when the eye is close enough to see the disc itself
    const dist = (u.camL.value as THREE.Vector3).length();
    // (only from far off, where the disc is too small to see: close up it is the disc itself that shines)
    const near = Math.min(1, Math.max(0, (dist - 300) / 3000));
    u.glare.value = glow * 0.9 * near;
    // the jets' line in the eye's frame (the eye at the origin), for the glow
    const origin = this.group.getWorldPosition(new THREE.Vector3()).sub(eyeWorld);
    const len = this.jets.scale.x * this.group.getWorldScale(new THREE.Vector3()).x;
    for (const m of this.jetMats) {
      m.uniforms.power.value = jet; m.uniforms.time.value = time;
      (m.uniforms.base.value as THREE.Vector3).copy(origin);
      (m.uniforms.axis.value as THREE.Vector3).set(0, 0, m.userData.sign).applyQuaternion(this.q).normalize();
      // drawn over the hole's traced sphere (which paints the bent sky behind it), hiding themselves where
      // the shadow or the bright disc is in front of them
      (this.jets.children[this.jetMats.indexOf(m)] as THREE.Mesh).renderOrder = 2;
      m.uniforms.discR.value = glow > 0.02 ? Math.min(u.rOut.value, 40) : 0;
      m.uniforms.len.value = len;
      (m.uniforms.eye.value as THREE.Vector3).copy(eyeWorld);
      (m.uniforms.invProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
      (m.uniforms.viewToWorld.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())));
      (m.uniforms.res.value as THREE.Vector2).copy(res);
      m.uniforms.unit.value = this.group.getWorldScale(new THREE.Vector3()).x;
      m.uniforms.pxAng.value = 2 * Math.tan(((cam as THREE.PerspectiveCamera).fov ?? 70) * Math.PI / 360) / Math.max(1, res.y);
    }
  }

  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
  }
}
