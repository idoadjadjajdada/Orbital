// GLSL for bodies, particles and the black-hole lens.

export const NOISE = /* glsl */ `
float hash31(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.07 + vec3(4.1, 1.3, 7.7); a *= 0.5; } return s; }
float ridged(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * (1.0 - abs(2.0 * vnoise(p) - 1.0)); p = p * 2.1 + vec3(3.3, 1.1, 5.2); a *= 0.5; } return s; }
`;

export const RING_TAU = /* glsl */ `
// Normal optical depth of planetary rings against radius in planet radii, from
// the Voyager and Cassini occultation profiles (smoothed). kind: 1 Saturn,
// 2 Uranus, 3 Neptune, 4 Jupiter.
float band(float r, float a, float b, float soft){ return smoothstep(a - soft, a + soft, r) * (1.0 - smoothstep(b - soft, b + soft, r)); }
float ringTau(int kind, float r, float seed){
  if (kind == 1) {
    float t = 0.0;
    t += 0.01 * band(r, 1.11, 1.236, 0.004);                                   // D
    t += (0.09 + 0.05 * sin(r * 140.0)) * band(r, 1.239, 1.527, 0.003);         // C, with its plateaus
    t += (1.8 + 0.9 * sin(r * 70.0 + 1.3) + 0.25 * sin(r * 211.0)) * band(r, 1.527, 1.951, 0.003); // B
    t += 0.12 * band(r, 1.951, 2.025, 0.003);                                   // Cassini Division
    t += (0.55 + 0.1 * sin(r * 160.0)) * band(r, 2.025, 2.27, 0.002);           // A
    t *= 1.0 - band(r, 2.211, 2.217, 0.0008);                                   // Encke gap
    t *= 1.0 - band(r, 2.264, 2.266, 0.0005);                                   // Keeler gap
    t += 0.5 * band(r, 2.324, 2.328, 0.0008);                                   // F
    return max(t, 0.0) * (0.9 + 0.2 * vnoise(vec3(r * 260.0, seed, 0.0)));
  }
  if (kind == 2) {
    float t = 0.0;
    t += 0.3 * band(r, 1.637, 1.640, 0.0004) + 0.3 * band(r, 1.652, 1.655, 0.0004) + 0.3 * band(r, 1.665, 1.668, 0.0004);
    t += 0.4 * band(r, 1.745, 1.752, 0.0006) + 0.3 * band(r, 1.785, 1.790, 0.0006);
    t += 0.3 * band(r, 1.845, 1.849, 0.0005) + 0.5 * band(r, 1.860, 1.863, 0.0004) + 0.4 * band(r, 1.895, 1.899, 0.0005);
    t += 1.2 * band(r, 1.990, 2.005, 0.0012);                                   // ε
    return t;
  }
  if (kind == 3) {
    return 0.08 * band(r, 1.67, 1.71, 0.005) + 0.05 * band(r, 2.13, 2.17, 0.004) + 0.01 * band(r, 2.17, 2.4, 0.01)
      + 0.1 * band(r, 2.535, 2.545, 0.002);                                      // Adams
  }
  if (kind == 4) {
    return 0.002 * band(r, 1.29, 1.71, 0.05) + 0.006 * band(r, 1.72, 1.81, 0.01) + 0.0006 * band(r, 1.81, 3.2, 0.1);
  }
  return 0.5 * band(r, 0.0, 1.0, 0.02);
}
`;

export const BODY_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vPos;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vObjN = normal;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

// Styles: 0 terran 1 ocean 2 rocky 3 barren 4 ice 5 lava 6 iron 7 carbon 8 desert
//         9 gas 10 icegiant 11 hotjupiter 12 browndwarf
export const PLANET_FRAG = /* glsl */ `
uniform int uStyle;
uniform vec3 uC1, uC2, uAtmo;
uniform float uSeed, uHeat, uTime, uAtmoK;
uniform vec3 uLightPos[4];
uniform vec3 uLightCol[4];
uniform int uNLights;
uniform float uAmbient;
uniform vec4 uCraters[32];   // xyz: direction in the body's frame, w: angular radius
uniform float uCraterHot[32];
uniform int uNCraters;
uniform int uRingKind;
uniform vec3 uRingN;         // ring-plane normal, world
uniform vec3 uCenter;        // planet centre, scene
uniform float uRadius;       // drawn radius
uniform float uRingIn, uRingOut, uRingScale;
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vPos;
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
${RING_TAU}

/* Craters: a dark floor, a bright raised rim, a faint ejecta blanket. On a gas
   giant the same record is a dark scar in the clouds that the winds smear out. */
vec3 craters(vec3 n, vec3 col, inout float emit, bool gas){
  for (int i = 0; i < 32; i++) {
    if (i >= uNCraters) break;
    vec4 c = uCraters[i];
    float d = acos(clamp(dot(n, c.xyz), -1.0, 1.0)) / max(c.w, 1e-4);
    if (d > 2.5) continue;
    if (gas) {
      float scar = smoothstep(1.6, 0.4, d + 0.3 * vnoise(n * 40.0));
      col = mix(col, col * 0.25, scar * uCraterHot[i]);
      continue;
    }
    float floor_ = smoothstep(0.85, 0.6, d);
    float rim = exp(-pow((d - 0.95) / 0.12, 2.0));
    float blanket = smoothstep(2.4, 1.0, d) * (1.0 - floor_) * (0.5 + 0.5 * vnoise(n * 200.0 + float(i)));
    col *= 1.0 - 0.35 * floor_;
    col *= 1.0 + 0.45 * rim + 0.12 * blanket;
    emit += uCraterHot[i] * (floor_ * 1.5 + rim * 0.5);
  }
  return col;
}

vec3 surface(vec3 n, out float emit, out float spec){
  emit = 0.0; spec = 0.0;
  vec3 s = n * 2.0 + vec3(uSeed);
  float lat = abs(n.z);
  if (uStyle == 0 || uStyle == 1) {
    float h = fbm(s * 1.3);
    float sea = uStyle == 1 ? 0.66 : 0.53;
    vec3 col;
    if (h < sea) { col = mix(uC1 * 0.55, uC1, smoothstep(sea - 0.25, sea, h)); spec = 1.0; }
    else {
      float m = fbm(s * 3.1 + 5.0);
      col = mix(uC2, vec3(0.55, 0.45, 0.30), smoothstep(0.45, 0.65, m));
      col = mix(col, vec3(0.42, 0.40, 0.38), smoothstep(sea + 0.12, sea + 0.22, h));
    }
    float ice = smoothstep(0.80, 0.86, lat + 0.06 * fbm3(s * 4.0));
    col = mix(col, vec3(0.92, 0.95, 1.0), ice);
    spec *= 1.0 - ice;
    float cl = smoothstep(0.52, 0.72, fbm(vec3(n.x * 2.5 + uTime * 0.002, n.y * 2.5, n.z * 5.0) + vec3(uSeed * 3.0)));
    col = mix(col, vec3(1.0), cl * 0.85);
    spec *= 1.0 - cl;
    return col;
  }
  if (uStyle == 2 || uStyle == 3 || uStyle == 8) {
    float h = fbm(s * 1.6);
    vec3 col = mix(uC1, uC2, smoothstep(0.3, 0.7, h));
    // craters: rims and floors from cellular-ish noise
    float c = vnoise(s * 9.0);
    float cr = smoothstep(0.80, 0.86, c) - 0.6 * smoothstep(0.86, 0.95, c);
    col *= 1.0 + (uStyle == 8 ? 0.08 : 0.25) * cr;
    if (uStyle == 8) {
      float dune = 0.5 + 0.5 * sin(n.z * 40.0 + fbm3(s * 3.0) * 8.0);
      col *= 0.92 + 0.08 * dune;
      col = mix(col, vec3(0.95, 0.92, 0.9), smoothstep(0.9, 0.95, lat) * 0.8);
    }
    return col;
  }
  if (uStyle == 4) {
    float h = fbm(s * 1.4);
    vec3 col = mix(uC1, uC2, smoothstep(0.25, 0.65, h));
    float cracks = smoothstep(0.92, 0.98, ridged(s * 2.5));
    col = mix(col, uC1 * 0.6, cracks);
    spec = 0.3;
    return col;
  }
  if (uStyle == 5) {
    float r = ridged(s * 2.2);
    float crack = smoothstep(0.72, 0.9, r);
    vec3 col = mix(uC1, uC1 * 1.6, fbm3(s * 4.0));
    emit = crack * (0.6 + 0.4 * vnoise(s * 6.0 + uTime * 0.01));
    return col;
  }
  if (uStyle == 6) {
    float h = fbm(s * 2.0);
    vec3 col = mix(uC1, uC2, h);
    spec = 0.6;
    return col;
  }
  if (uStyle == 7) {
    float h = fbm(s * 2.4);
    vec3 col = mix(uC1, uC2, smoothstep(0.4, 0.8, h));
    spec = 0.4;
    return col;
  }
  // giants: bands of latitude, warped by turbulence
  float bands = uStyle == 10 ? 3.0 : uStyle == 12 ? 7.0 : 9.0;
  float turb = fbm(vec3(n.x * 3.0, n.y * 3.0, n.z * 14.0) + vec3(uSeed) + vec3(uTime * 0.0005, 0.0, 0.0));
  float b = sin((n.z + turb * (uStyle == 10 ? 0.06 : 0.14)) * bands * 3.14159);
  vec3 col = mix(uC1, uC2, 0.5 + 0.5 * b);
  col *= 0.88 + 0.24 * fbm3(vec3(n.x * 8.0, n.y * 8.0, n.z * 30.0) + vec3(uSeed));
  if (uStyle == 9) {
    // one great storm
    vec3 sp = normalize(vec3(cos(uSeed), sin(uSeed), -0.35));
    float d = length(n - sp);
    col = mix(col, vec3(0.75, 0.38, 0.28), smoothstep(0.16, 0.09, d) * 0.8);
  }
  if (uStyle == 11 || uStyle == 12) emit = uStyle == 12 ? 0.6 + 0.4 * b * b : 0.0;
  return col;
}

void main(){
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vObjN);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vPos);
  float emit, spec;
  vec3 alb = surface(n, emit, spec);
  if (uNCraters > 0) alb = craters(n, alb, emit, uStyle >= 9);
  vec3 lit = vec3(0.0);
  vec3 sp = vec3(0.0);
  float dayside = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uNLights) break;
    vec3 L = normalize(uLightPos[i] - vPos);
    float d = dot(N, L);
    float diff = smoothstep(-0.04, 0.12, d) * max(d, 0.0) + 0.02 * smoothstep(-0.2, 0.05, d);
    // the rings' shadow: follow the light back to the ring plane
    if (uRingKind > 0) {
      float den = dot(L, uRingN);
      if (abs(den) > 1e-4) {
        float t = dot(uCenter - vPos, uRingN) / den;
        if (t > 0.0) {
          float rr = length(vPos + L * t - uCenter) / uRadius;
          float tau = ringTau(uRingKind, rr, 0.0) * uRingScale;
          if (rr > uRingIn && rr < uRingOut) diff *= exp(-tau / max(abs(den), 0.05));
        }
      }
    }
    lit += uLightCol[i] * diff;
    dayside = max(dayside, d);
    vec3 H = normalize(L + V);
    sp += uLightCol[i] * pow(max(dot(N, H), 0.0), 60.0) * step(0.0, d);
  }
  vec3 col = alb * (lit + uAmbient) + sp * spec * 0.5;
  // atmosphere: brightest on the limb, coloured, and only where it is day
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uAtmo * rim * uAtmoK * clamp(dayside + 0.25, 0.0, 1.0) * (0.3 + length(lit));
  // heat: lava cracks, magma oceans after an impact, night glow on hot giants
  vec3 hot = vec3(1.0, 0.35, 0.08);
  float glow = emit * (uStyle == 5 ? 2.5 : 1.0) + uHeat * uHeat * (1.5 + 2.0 * ridged(n * 4.0 + vec3(uSeed)));
  if (uStyle == 11) glow += 0.5 * (1.0 - clamp(dayside * 4.0, 0.0, 1.0));
  if (uStyle == 12) hot = mix(vec3(0.7, 0.12, 0.05), vec3(1.0, 0.4, 0.1), emit);
  col += hot * glow * mix(alb, vec3(1.0), 0.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const STAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uSeed, uGran, uBright;
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vPos;
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
void main(){
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vObjN);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vPos);
  float mu = max(dot(N, V), 0.0);
  float limb = 1.0 - 0.55 * (1.0 - mu) - 0.25 * (1.0 - mu) * (1.0 - mu);
  float g = fbm(n * uGran + vec3(uSeed) + vec3(0.0, 0.0, uTime * 0.02));
  float cells = 0.82 + 0.36 * g;
  float spots = 1.0 - 0.55 * smoothstep(0.62, 0.7, fbm3(n * 2.5 + vec3(uSeed * 2.0, uTime * 0.001, 0.0))) * step(uGran, 12.0);
  vec3 col = uColor * limb * cells * spots * uBright;
  // a little warmer at the limb, as the light comes from higher and cooler gas
  col *= mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.7, mu));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const RING_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vN;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

export const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uSeed, uInner, uOuter;
uniform int uKind;
uniform vec3 uLightPos[4];
uniform vec3 uLightCol[4];
uniform int uNLights;
uniform vec3 uPlanetPos;
uniform float uPlanetR;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vN;
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
${RING_TAU}
void main(){
  #include <logdepthbuf_fragment>
  float r = mix(uInner, uOuter, vUv.x);       // planet radii
  float tau = ringTau(uKind, r, uSeed) * uOpacity;
  if (tau < 1e-4) discard;
  vec3 V = normalize(cameraPosition - vPos);
  float muV = max(abs(dot(vN, V)), 0.02);
  // what fraction of the view through the ring is blocked: grazing views see more ring
  float cover = 1.0 - exp(-tau / muV);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uNLights) break;
    vec3 L = normalize(uLightPos[i] - vPos);
    float mu0 = max(abs(dot(vN, L)), 0.02);
    bool sameSide = dot(vN, L) * dot(vN, V) > 0.0;
    // the planet's shadow across the rings
    vec3 toP = uPlanetPos - vPos;
    float t = dot(toP, L);
    float miss = length(toP - L * t);
    float shadow = t > 0.0 ? smoothstep(uPlanetR * 0.985, uPlanetR * 1.015, miss) : 1.0;
    // the lit face reflects in proportion to how much sunlight the ring stops;
    // the unlit face only glows where light gets through and is scattered on —
    // which is why the thick B ring is dark seen from behind and the thin C ring bright
    float lit = sameSide ? (1.0 - exp(-tau / mu0)) : 2.2 * tau / mu0 * exp(-tau / mu0);
    float phase = sameSide ? 1.0 : 1.0 + 1.5 * pow(max(dot(-L, V), 0.0), 6.0);
    col += uLightCol[i] * lit * phase * shadow;
  }
  // a little colour variation: the C ring and Cassini Division greyer, the B ring warmer
  vec3 tint = uColor * mix(vec3(0.82, 0.84, 0.86), vec3(1.05, 1.0, 0.92), smoothstep(0.1, 1.2, tau / max(uOpacity, 1e-3)));
  gl_FragColor = vec4(tint * col / max(cover, 1e-3) * 0.9, cover);
}
`;

export const ATMO_FRAG = /* glsl */ `
uniform vec3 uAtmo;
uniform float uK;
uniform vec3 uLightPos[4];
uniform int uNLights;
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vPos;
#include <common>
#include <logdepthbuf_pars_fragment>
void main(){
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vPos);
  float mu = dot(N, V);
  float day = 0.0;
  for (int i = 0; i < 4; i++) { if (i >= uNLights) break; day = max(day, dot(N, normalize(uLightPos[i] - vPos))); }
  float a = pow(clamp(1.0 - abs(mu), 0.0, 1.0), 4.0) * smoothstep(-0.25, 0.3, day) * uK;
  gl_FragColor = vec4(uAtmo * a, a);
}
`;

export const POINTS_VERT = /* glsl */ `
attribute float size;   // world-space diameter (0 = just a point)
attribute vec4 tint;
uniform float uScale;   // pixels per world unit at distance 1
uniform float uMinPx;
varying vec4 vTint;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = size * uScale / max(-mv.z, 1e-30);
  float drawn = clamp(px, uMinPx, 96.0);
  // a puff drawn wide spreads the same light over more pixels
  vTint.a *= clamp(uMinPx * 2.5 / drawn, 0.05, 1.0);
  gl_PointSize = drawn;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

export const POINTS_FRAG = /* glsl */ `
varying vec4 vTint;
#include <common>
#include <logdepthbuf_pars_fragment>
void main(){
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  // additive blending multiplies by alpha itself
  gl_FragColor = vec4(vTint.rgb, a * vTint.a);
}
`;

/** Screen-space point-mass lens: a pixel at distance ρ from the hole shows what is at ρ − θE²/ρ. */
export const LENS_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec4 uHoles[4];   // xy: screen uv, z: Einstein radius² (in y-uv units²), w: shadow radius
uniform int uN;
uniform float uAspect;
varying vec2 vUv;
void main(){
  vec2 uv = vUv;
  float dark = 1.0;
  float ring = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uN) break;
    vec2 d = uv - uHoles[i].xy;
    d.x *= uAspect;
    float r = length(d);
    float e2 = uHoles[i].z;
    float sh = uHoles[i].w;
    if (r < sh) { dark = 0.0; }
    else {
      float k = e2 / (r * r);
      vec2 src = d * (1.0 - k);
      src.x /= uAspect;
      uv = uHoles[i].xy + src;
      // light piles up just outside the photon sphere
      ring += 0.25 * smoothstep(sh * 1.25, sh, r) * smoothstep(sh * 0.98, sh, r);
    }
  }
  vec4 c = texture2D(tDiffuse, uv);
  gl_FragColor = vec4(c.rgb * dark + vec3(1.0, 0.85, 0.65) * ring, 1.0);
}
`;

/** A relativistic jet: a bright, narrow, knotted flow along the hole's spin axis. */
export const JET_VERT = /* glsl */ `
varying float vAlong;
varying vec3 vN;
varying vec3 vPos;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vAlong = position.y;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;
export const JET_FRAG = /* glsl */ `
uniform float uTime, uPower;
uniform vec3 uColor;
varying float vAlong;
varying vec3 vN;
varying vec3 vPos;
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
void main(){
  #include <logdepthbuf_fragment>
  vec3 V = normalize(cameraPosition - vPos);
  // brightest down the middle of the cone as seen, fading to its edges
  float core = pow(abs(dot(normalize(vN), V)), 1.5);
  float knots = 0.5 + 0.5 * vnoise(vec3(vAlong * 22.0 - uTime * 3.0, 0.0, 0.0));
  float fade = smoothstep(0.0, 0.03, vAlong) * pow(1.0 - vAlong, 1.4);
  float a = core * knots * fade * uPower;
  gl_FragColor = vec4(uColor * 2.5, a);
}
`;
