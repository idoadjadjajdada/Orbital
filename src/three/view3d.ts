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
import { Ground, bodyQuat, latLonOf, arc } from './ground';
import { tangent } from './terrain';
import { gravity, atmosphere } from './science';
import { Fleet, isModule, type CraftKind, type Craft } from './fleet';
import { ROCKETS, type RocketModel } from './rocketry';
import { Visit } from './visit';
import { Placer } from './placer';
import { Suit } from './suit';
import { Feeds } from './feeds';
import { GrowLab } from './growlab';
import { Shuttle } from './shuttle';
import { Giant, HULL_BAR } from './giant';
import { starMaterial, tickStar, dropStar } from './star';
import { Lights, LIGHT_GLSL } from './lights';
import { HoleLook } from './hole';
import { NebulaLook, PulsarLook, DustDisc } from './exotic';

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
  /** a world's sphere, and its shader for when it is near: the map's detail and finer (see FRAG's CLOSE) */
  surf?: THREE.Mesh; near?: THREE.ShaderMaterial;
  /** how cratered its ground is below the map's grain (none under real air, all without) */
  craterK?: number;
  /** a black hole's traced look, and when its disc's extent was last measured */
  hole?: HoleLook; holeT?: number;
  /** a nebula's shell round its star, a pulsar's beams, a young star's dusty disc; the shell's radius (AU) and when it was measured */
  neb?: NebulaLook; beams?: PulsarLook; dust?: DustDisc; shellR?: number; shellT?: number;
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
/** the light's direction in the body's own frame, and its rings (to shadow the planet): profile, edges in its radii */
uniform vec3 lightL;
uniform sampler2D ringProf;
uniform float ringIn;
uniform float ringOut;
uniform float heat;
uniform vec3 atmo;
uniform float hasAtmo;
uniform float bump;
uniform float detail;
uniform float time;
uniform float gas;
uniform vec4 vortex;
/** close up: how cratered the ground is below the map's grain (airless worlds 1), and the world's radius (m) */
uniform float craterK;
uniform float rad;
/** on a world with seas, the height of their surface on the map (−1 without): the relief is never shaded below it */
uniform float seaLevel;
${LIGHT_GLSL}
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
varying vec3 vEast;
varying vec3 vNorth;
${MAP_UV}
#ifdef CLOSE
/**
 * the ground below the map's grain, in the world's radii: hills and hollows, octave on octave, and on an
 * old airless world craters, one to a cell, smaller and smaller. Each octave comes in once it spans a few
 * pixels (\`fw\`, the size of a pixel in radii), so nothing finer than the screen can show flickers
 */
float relief(vec3 n, float fw, out float bright) {
  float h = 0.0, f = 380.0, a = 1.0;
  bright = 0.0;
  for (int k = 0; k < 4; k++) {
    float vis = 1.0 - smoothstep(0.12, 0.35, f * fw);
    float v = vnoise3(n * f + float(k) * 7.13) - 0.5;
    h += v * a * vis * 0.07 / f;
    bright += v * a * vis;
    f *= 2.7; a *= 0.78;
  }
  #ifdef CRATERS
  f = 150.0;
  for (int k = 0; k < 5; k++) {
    float vis = (1.0 - smoothstep(0.06, 0.2, f * fw)) * craterK;
    vec3 q = n * f, i = floor(q);
    float there = step(hash3(i + float(k) * 17.0), 0.55);
    vec3 c = i + 0.35 + 0.3 * vec3(hash3(i + 1.3), hash3(i + 2.7), hash3(i + 5.1));
    float r = 0.1 + 0.2 * pow(hash3(i + 9.2), 2.0), d = length(q - c) / r;
    float bowl = d < 1.0 ? -(1.0 - d * d) * 0.55 : 0.0, rim = exp(-pow((d - 1.0) / 0.22, 2.0)) * 0.22;
    h += vis * there * (bowl + rim) * r / f;
    bright += vis * there * (rim * 2.0 + bowl * 0.4 + (hash3(i + 4.4) < 0.15 ? 0.5 * (1.0 - smoothstep(0.8, 1.6, d)) : 0.0));
    f *= 2.6;
  }
  #endif
  return h;
}
#endif
/**
 * a giant's weather, moved on by k seconds: the belts and zones slide past each other on their
 * alternating jets, and a great oval storm (vortex: centre lon, lat, half-sizes, degrees) turns
 * on itself, fastest near its rim
 */
vec2 weather(vec2 uv, float k) {
  float lat = (uv.y - 0.5) * 3.14159265;
  float jet = 0.65 * sin(lat * 7.3 + 0.4) + 0.35 * sin(lat * 15.0 + 1.3);
  uv.x += jet * k * 0.00022 * gas;
  if (vortex.z > 0.0) {
    vec2 c = vortex.xy;
    vec2 d = vec2(mod(uv.x * 360.0 - c.x + 180.0, 360.0) - 180.0, (uv.y - 0.5) * 180.0 - c.y);
    vec2 e = vec2(d.x * cos(radians(c.y)) / vortex.z, d.y / vortex.w);
    float r = length(e);
    // an anticyclone: anticlockwise in the south, clockwise in the north, still at its heart and outside it
    float w = 0.045 * sign(-c.y) * smoothstep(0.0, 0.45, r) * (1.0 - smoothstep(0.8, 1.25, r));
    float a = -w * k, ca = cos(a), sa = sin(a);
    e = vec2(ca * e.x - sa * e.y, sa * e.x + ca * e.y);
    uv = vec2((c.x + e.x * vortex.z / cos(radians(c.y))) / 360.0, (c.y + e.y * vortex.w) / 180.0 + 0.5);
  }
  return uv;
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vObj);
  vec2 uv = mapUV(n);
  vec4 tex;
  if (gas > 0.0) {
    // eddies wandering along the belts
    vec3 q = n * vec3(5.0, 5.0, 22.0);
    vec2 wob = vec2(vnoise3(q + vec3(time * 0.03, 0.0, 0.0)), vnoise3(q + vec3(7.3, time * 0.025, 0.0))) - 0.5;
    vec2 uw = uv + wob * vec2(0.0035, 0.0012) * gas;
    // two looks, each carried a little way along the flow and faded into the other before the shear shows
    float P = 48.0, p1 = fract(time / P), p2 = fract(time / P + 0.5);
    vec4 t1 = texture2D(map, weather(uw, (p1 - 0.5) * P)), t2 = texture2D(map, weather(uw, (p2 - 0.5) * P));
    tex = mix(t1, t2, abs(2.0 * p1 - 1.0));
  } else tex = texture2D(map, uv);
  vec4 ax = texture2D(aux, uv);
  // how much is sea: the map keeps the Earth's shore as a value through its texels, 0.5 on the shore itself
  float wetM = smoothstep(0.45, 0.55, ax.b);
  // relief: the slope of the height map tilts the surface
  // (the sea's floor is no part of the relief seen from above: its surface is flat, so no cliff along every coast)
  float h = max(ax.r + ax.a / 255.0, seaLevel);
  vec4 aE = texture2D(aux, uv + vec2(texel.x, 0.0)), aN = texture2D(aux, uv + vec2(0.0, texel.y));
  float hE = max(aE.r + aE.a / 255.0, seaLevel), hN = max(aN.r + aN.a / 255.0, seaLevel);
  float cl = max(0.05, sqrt(1.0 - n.z * n.z));
  vec2 g = vec2((hE - h) / (texel.x * 6.2831853) / cl, (hN - h) / (texel.y * 3.14159265));
  #ifdef CLOSE
  // the coast below the map's grain: where the map's texels are part sea, part land (blended), a sharp shore
  // wandering through them, the land's colour from a texel inland and the sea's from one out to sea, and the
  // map's step in height there, which would outline its texels, flattened
  float s0 = ax.b - 0.5;
  if (gas < 0.5 && (s0 * (aE.b - 0.5) < 0.0 || s0 * (aN.b - 0.5) < 0.0 || abs(s0) < 0.06)) {
    vec2 gs = vec2(aE.b - ax.b, aN.b - ax.b), dir = dot(gs, gs) > 1e-10 ? normalize(gs) : vec2(1.0, 0.0);
    float fwc = max(length(fwidth(vObj)), 1e-7);
    float wob = (vnoise3(n * 6000.0) - 0.5) * 0.05 + (vnoise3(n * 16000.0 + 3.1) - 0.5) * 0.03 * (1.0 - smoothstep(0.1, 0.3, 16000.0 * fwc));
    float q = ax.b + wob, aa = max(fwidth(q), 0.004);
    wetM = smoothstep(0.5 - aa, 0.5 + aa, q);
    vec4 cSea = texture2D(map, uv + dir * texel * 1.5), cLand = texture2D(map, uv - dir * texel * 1.5);
    tex = mix(cLand, cSea, wetM);
  }
  #endif
  // and close up, finer grain than the map holds
  float fine = detail > 0.0 ? vnoise3(n * 900.0) * 0.6 + vnoise3(n * 2600.0) * 0.4 : 0.5;
  vec3 N0 = normalize(vWorldN);
  vec3 N = normalize(N0 - bump * (normalize(vEast) * g.x + normalize(vNorth) * g.y));
  vec3 col = tex.rgb * (1.0 + detail * (fine - 0.5) * 0.25);
  #ifdef CLOSE
  // below the map's grain: its slope, from its change across the pixel, tilts the light (not on the sea)
  if (gas < 0.5) {
    float fw = max(length(fwidth(vObj)), 1e-7), br;
    float land = 1.0 - wetM;
    float Hd = relief(n, fw, br) * rad * land;
    vec3 dpx = dFdx(vWorldP), dpy = dFdy(vWorldP);
    vec3 r1 = cross(dpy, N0), r2 = cross(N0, dpx);
    float det = dot(dpx, r1);
    vec3 gr = sign(det) * (dFdx(Hd) * r1 + dFdy(Hd) * r2);
    N = normalize(abs(det) * N - gr);
    col *= 1.0 + clamp(br, -1.0, 1.0) * 0.16 * land;
  }
  #endif
  // a giant's cloud tops close up: fine streaks drawn out along the latitudes, drifting
  if (gas > 0.0) col *= 1.0 + (vnoise3(n * vec3(260.0, 260.0, 1400.0) + vec3(time * 0.04, 0.0, 0.0)) - 0.5) * 0.14 + (vnoise3(n * vec3(900.0, 900.0, 4000.0)) - 0.5) * 0.06;
  vec3 V = normalize(-vWorldP);
  if (lit > 0.5) {
    float dl = dot(N, lightDir), dl0 = dot(N0, lightDir);
    // a soft terminator, and no relief lit past it
    float term = clamp((dl0 + 0.03) / 0.1, 0.0, 1.0);
    // the rings' shadow: where the line to the star crosses them, as much light as gets through
    if (ringOut > 0.0 && abs(lightL.z) > 1e-4) {
      float tr = -n.z / lightL.z;
      if (tr > 0.0) {
        float rr = length((n + lightL * tr).xy);
        if (rr > ringIn && rr < ringOut) term *= 1.0 - 0.92 * texture2D(ringProf, vec2((rr - ringIn) / (ringOut - ringIn), 0.5)).r;
      }
    }
    vec3 c = col * (0.025 + ambientX + max(dl, 0.0) * term * lightCol + lampLight(vWorldP, N));
    // a glint off the sea
    vec3 H = normalize(lightDir + V);
    c += wetM * pow(max(dot(N0, H), 0.0), 90.0) * 0.55 * term * lightCol;
    col = c;
  } else col *= 0.45 + ambientX + lampLight(vWorldP, normalize(vWorldN));
  // lightning in a giant's belts, seen on its night side
  if (gas > 0.0 && lit > 0.5) {
    vec3 cell = floor(n * vec3(30.0, 30.0, 60.0));
    float f = hash3(cell + floor(time * 2.5) * 13.7);
    float night = smoothstep(0.0, -0.15, dot(N0, lightDir));
    col += night * step(0.9975, f) * (1.0 - fract(time * 2.5)) * vec3(0.75, 0.85, 1.0) * 0.9 * gas;
  }
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
uniform float fade;
${LIGHT_GLSL}
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
  gl_FragColor = vec4(lightCol * lit + ambientX + lampLight(vWorldP, N) * 0.9, c * 0.95 * fade);
}`;

/**
 * a ring: its profile of optical depth, and in it the ring's weather — clumps and wakes carried round
 * at the orbital speed of their radius (the inner edge lapping the outer, Kepler's law; two looks
 * faded into each other so the shear never builds), and on Saturn the spokes: dark wedges across the
 * B ring that turn with the planet's magnetic field and come and go in hours
 */
const RING_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D prof;
uniform float rIn;
uniform float rOut;
uniform vec3 col;
uniform vec3 lightCol;
uniform float time;
uniform float spokes;
/** the light's direction in the planet's own frame (the planet is radius 1 there), to find its shadow */
uniform vec3 lightL;
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec2 turn(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float clumps(vec2 p, float r, float k) {
  vec2 q = turn(p, -0.03 * pow(r, -1.5) * k);
  return vnoise3(vec3(q * 34.0, r * 420.0)) * 0.6 + vnoise3(vec3(q * 110.0, r * 1500.0)) * 0.4;
}
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vObj.xy);
  float t = (r - rIn) / (rOut - rIn);
  if (t < 0.0 || t > 1.0) discard;
  float a = texture2D(prof, vec2(t, 0.5)).r;
  if (a < 0.01) discard;
  float P = 40.0, p1 = fract(time / P), p2 = fract(time / P + 0.5);
  float cl = mix(clumps(vObj.xy, r, (p1 - 0.5) * P), clumps(vObj.xy, r, (p2 - 0.5) * P), abs(2.0 * p1 - 1.0));
  a = clamp(a * (0.78 + 0.45 * cl), 0.0, 1.0);
  vec3 c = col * (0.25 + 0.75 * lightCol) * (0.9 + 0.2 * cl);
  // in the planet's shadow: behind it from the star, within its radius of the line through it
  float ts = -dot(vObj, lightL);
  if (ts > 0.0) c *= 0.12 + 0.88 * smoothstep(0.97, 1.03, length(vObj + lightL * ts));
  if (spokes > 0.0 && r > 1.53 && r < 1.95) {
    vec2 d = normalize(turn(vObj.xy, -time * 0.012));
    float s = vnoise3(vec3(d * 13.0, time * 0.004)) * 0.6 + vnoise3(vec3(turn(d, 0.7) * 29.0, r * 4.0 + time * 0.006)) * 0.4;
    float inB = smoothstep(1.53, 1.65, r) * (1.0 - smoothstep(1.8, 1.95, r));
    c *= 1.0 - 0.28 * spokes * inB * smoothstep(0.64, 0.86, s);
  }
  gl_FragColor = vec4(c, a);
}`;

/** the great storms that turn on themselves (lon E, lat, half-sizes °, as the painters place them): Jupiter's Great Red Spot, Neptune's Great Dark Spot */
const VORTEX: Record<string, [number, number, number, number]> = { Jupiter: [60, -22, 8.5, 6], Neptune: [30, -22, 9, 5.8] };

const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float K;
varying vec3 vL;
void main() {
  vL = position * K;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const GLOW_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 col;
uniform vec3 camL;
uniform float K;
uniform float strength;
varying vec3 vL;
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vL - camL);
  // how near the line of sight passes the centre, in the body's radii
  float tc = -dot(camL, d);
  float x = tc > 0.0 ? length(camL + d * tc) : length(camL);
  // (just inside the limb too, to cover the gap between the round body and its many-sided mesh)
  if (x < 0.95) discard;
  float y = max(0.0, x - 1.0);
  float I = (exp(-y / 0.22) * 0.5 + exp(-y / 1.1) * 0.08 + exp(-y / 4.0) * 0.012) * (1.0 - smoothstep(0.7 * K, K, x)) * strength;
  // dithered, so the faint wide glare does not show 8-bit steps
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(max(vec3(0.0), col * I + (n - 0.5) / 255.0), 1.0);
}`;

const PART_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float px;
varying vec3 vC;
void main() {
  vC = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = 3.5 * px;
  #include <logdepthbuf_vertex>
}`;
const PART_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vC;
uniform float dim;
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 3.0);
  gl_FragColor = vec4(vC * a * 0.4 * dim, 1.0);
}`;

export type Mode = 'pilot' | 'walk' | 'eva' | 'scope' | 'surface' | 'craft' | 'shuttle' | 'inside';
/** where you watch a craft from: round it, or (riding a rocket) its cockpit or its cabin */
export type Seat = 'out' | 'cockpit' | 'cabin';
/** the seats of a rocket to look from, in turn: the Wayfarer carries passengers in a cabin */
const seatsOf = (k: RocketModel): Seat[] => (k === 'wayfarer' ? ['cockpit', 'cabin', 'out'] : ['cockpit', 'out']);

const UP = new THREE.Vector3(0, 1, 0);
const YR = 365.25 * 86400;
/** the closest the ship comes to a surface, m: it is 55 m long */
const SHIP_CLEAR = 60;
/** landed, the ship's origin (its main deck) stands this high over the ground, m */
const LAND_H = 7.2;
/** the hips of the six legs and the airlock's sill, ship coordinates, for finding the ground under each */
const LEG_HIPS = [[5.95, -1.5, 6.2], [5.95, -1.5, 16.4], [-5.95, -1.5, 6.2], [-5.95, -1.5, 16.4], [3.2, -0.35, -19], [-3.2, -0.35, -19]];
const LADDER_TOP = new THREE.Vector3(-9.45, 0.6, 0);
/** a world's landing range, m above the ground: below this the ship can set down */
const LAND_RANGE = 8000;

export class View3D {
  readonly canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private objs = new Map<Body, Obj>();
  private markers: THREE.Points;
  private parts: THREE.Points;
  private sky: THREE.Points;
  private glowTex: THREE.Texture;
  /** the floodlight, the helmet lamp, the night-side light and the lamps hung in the sky */
  readonly lights: Lights;
  /** the air's haze, for the meshes on the ground (the ground's own shader has its own) */
  private haze = new THREE.FogExp2(0x000000, 0);
  private sphere = new THREE.SphereGeometry(1, 128, 64);
  private labels: HTMLElement;
  private labelEls = new Map<Body | string, HTMLElement>();
  controls: Controls3D;
  ship: Ship;
  radar: Radar;
  nav: NavMap;
  /** the ground and sky of the world you are near */
  ground: Ground;
  /** the craft the ship has sent out */
  fleet: Fleet;
  /** Lander 1, the crewed lander in the hangar, flown by hand */
  shuttle: Shuttle;
  /** inside a giant planet's clouds */
  giant: Giant;
  private crushToast = 0;
  /** watching (or driving) one of them: which, the mode to go back to, and the camera round it */
  /** watching a craft: from round it at a distance, or (riding a rocket) from a seat in it */
  craftView: { id: number; back: Mode; yaw: number; pitch: number; dist: number; seat: Seat } | null = null;
  /** the bay doors, open for a launch: seconds left */
  private bayT = 0;
  active = false;
  /**
   * the ship on (or coming down to, or lifting off) a world's ground: where
   * it is over the ground (unit direction and height above the ground, m, in
   * the body's turning frame), its attitude in that frame, how far each leg
   * reaches and how far the ladder drops
   */
  landing: { b: Body; n: V3; alt: number; q: THREE.Quaternion; phase: 'down' | 'landed' | 'up'; legs: number; reach: number[]; ladder: number } | null = null;
  /** on foot on a world: where (unit, body frame), which way you face, your jump */
  surf = { nav: { anchor: null, off: [0, 0, 0], vel: [0, 0, 0] } as Mover, b: null as Body | null, n: [0, 0, 1] as V3, yaw: 0, pitch: 0, y: 0, vy: 0, speed: 0, foot: -Infinity, roof: Infinity, inside: null as string | null };
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
  logbook = { start: performance.now(), metres: 0, top: 0, jumps: 0, walks: 0, sleeps: 0, coffees: 0, landings: 0, firsts: [] as { name: string; note: string }[], landed: [] as string[], walkedOn: [] as string[], finds: [] as { what: string; note: string; where: string }[] };
  /** asleep in the quarters: seconds so far, how long, the clock to go back to, and when it began (sim years) */
  private sleep: { t: number; dur: number; warp: number; from: number } | null = null;
  /** the lab's globe: whose surface it wears */
  private globeKey = '';
  private globeTex: THREE.Texture[] = [];
  /** the eye in ship coordinates, when it is inside the hull */
  private localEye: THREE.Vector3 | null = null;
  /** the render scale, lowered while frames are slow and raised again when they are quick: the frame time (ms, smoothed) and when it was last judged */
  res = { scale: 1, ms: 16, last: 0, t: 0 };
  /** outside: the suit, which moves on its own, and which way it faces */
  suit = { nav: { anchor: null, off: [0, 0, 0], vel: [0, 0, 0] } as Mover, quat: new THREE.Quaternion() };
  /** the telescope: where it points (world) and its field of view, degrees */
  scope = { quat: new THREE.Quaternion(), fov: 8, track: false };
  /** what you can do right now where you are looking, if anything */
  prompt: { label: string; act: () => void } | null = null;
  /** the ship flying itself somewhere: to a body, or to a point (the suit), and how close to stop */
  travel: { b: Body | null; at?: () => V3; stop: number; name: string; land?: boolean; dock?: Craft; was?: V3 } | null = null;
  /** inside a station or a base, docking, the base's pad */
  visit!: Visit;
  /** choosing where a base or launch pad goes */
  placer!: Placer;
  /** your suit's air, power and kit, and what you ride on the ground */
  kit!: Suit;
  /** monitors carrying craft cameras */
  feeds!: Feeds;
  /** the bases' growth labs, and the soils from the samples you have analysed */
  readonly growlab = new GrowLab();
  /** the suit's top-up and the lab's analyser (the suit's own module fills these in) */
  suitRefill?: () => void;
  analyseSamples?: () => void;
  /** worlds the ship has been to, for the shelf in the commons */
  private visited: Body[] = [];
  private trophyKey = '';
  /** what the viewer's position is measured from, and the offset from it (m, world axes) */
  base!: Mover;
  eye = new THREE.Vector3();
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
    this.sky.renderOrder = -2;
    this.scene.add(this.sky);
    this.galaxy = milkyWay();
    this.scene.add(this.galaxy);
    this.lights = new Lights(this.scene, this.glowTex);
    this.ground = new Ground(this.scene, this.lights.uniforms);
    this.ground.onFind = (what, note) => this.found(what, note);
    this.fleet = new Fleet(this.scene, () => this.stars());
    this.giant = new Giant(this.scene, this.glowTex);
    this.fleet.onNews = m => this.app.onToast(m);
    this.ground.platformAt = n => (this.ground.body ? this.fleet.platformAt(this.ground.body, n) : -Infinity);
    this.markers = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false }));
    this.markers.frustumCulled = false;
    this.scene.add(this.markers);
    // gas and debris: soft glowing motes rather than hard dots, so many together read as a cloud
    this.parts = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      vertexShader: PART_VERT, fragmentShader: PART_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true,
      uniforms: { px: { value: Math.min(2, window.devicePixelRatio || 1) }, dim: { value: 1 } },
    }));
    this.parts.frustumCulled = false;
    this.scene.add(this.parts);
    this.labels = document.createElement('div');
    this.labels.id = 'labels3';
    this.labels.hidden = true;
    document.body.appendChild(this.labels);
    this.ship = new Ship(this.scene, this.glowTex);
    this.ship.hull.setEnv(this.renderer);
    this.shuttle = new Shuttle(this);
    this.visit = new Visit(this);
    this.placer = new Placer(this);
    this.kit = new Suit(this);
    this.feeds = new Feeds(this);
    this.fleet.onRocket = (c, at) => this.rocketIn(c, at);
    this.fleet.onInterior = c => { for (const m of c.inside?.monitors ?? []) this.feeds.register(`${c.id}:${m.id}`, m.mesh, `${c.name}: ${m.label}`); };
    this.ground.structureAt = n => (this.ground.body ? this.fleet.structureAt(this.ground.body, n) : null);
    this.fleet.onBuilt = c => { if (c.b === this.ground.body) this.ground.rebuilt(); };
    this.suitRefill = () => this.kit.refill();
    this.analyseSamples = () => this.kit.analyse();
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
    // for the browser tests: three and the bodies' turning frames
    Object.assign(window, { __THREE: THREE, __bodyQuat: bodyQuat });
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
    this.landing = null;
    sh.hull.setLegs(0);
    sh.hull.setLadder(null);
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
    // over a world's ground, the height above the ground itself, not its sphere
    if (best && best === this.ground.body && alt < 50 * (this.ground.spec?.relief ?? 0)) alt -= this.groundUnder(best, p);
    return { b: best, alt };
  }

  /** the height of the ground (m above the datum, never below sea level) under a point, cached for the frame */
  private gCache = { f: -1, p: [0, 0, 0] as V3, h: 0 };
  private groundUnder(b: Body, p: V3) {
    const c = this.gCache;
    if (c.f === this.frameNo && Math.abs(c.p[0] - p[0]) + Math.abs(c.p[1] - p[1]) + Math.abs(c.p[2] - p[2]) < 20 / AU_M) return c.h;
    const v = new THREE.Vector3((p[0] - b.x) * AU_M, (p[1] - b.y) * AU_M, (p[2] - b.z) * AU_M).applyQuaternion(bodyQuat(b).invert()).normalize();
    const h = this.ground.heightAt([v.x, v.y, v.z], 5);
    c.f = this.frameNo; c.p = [...p]; c.h = this.ground.last_sample.sea ? 0 : h;
    return c.h;
  }

  /** the sandbox's time when the movers were last turned with their worlds */
  private spinT = -1;
  /**
   * near a world, what flies over it is held by it and turns with it: the
   * ship, Lander 1 and you on a spacewalk keep your place over the ground,
   * rather than the world turning away under you (at the Earth's equator,
   * 465 m/s). Fully within a radius of the surface, less and less out to
   * three radii up, where you are left to the stars.
   */
  private corotate() {
    const t = this.app.world.time, dt = t - this.spinT;
    this.spinT = t;
    if (!(dt > 0)) return;
    const movers: { m: Mover; q: THREE.Quaternion; k?: number }[] = [];
    // (the autopilot, chasing something that moves on its own, keeps up with it by itself)
    const free = !this.landing && !this.ship.worm && !this.travel?.at, ride = this.rideStation(free);
    if (free) movers.push({ m: this.ship.nav, q: this.ship.quat, k: 1 - ride });
    if (this.mode === 'eva') movers.push({ m: this.suit.nav, q: this.suit.quat });
    if (this.shuttle.state === 'flying') movers.push({ m: this.shuttle.nav, q: this.shuttle.quat });
    for (const { m, q } of movers) {
      const b = m.anchor;
      if (!b || !b.alive || !b.spin) continue;
      const x = Math.hypot(m.off[0], m.off[1], m.off[2]) / b.r, k = (x <= 2 ? 1 : x >= 4 ? 0 : (4 - x) / 2) * (movers.find(o => o.m === m)?.k ?? 1);
      const turn = b.spin * dt * k;
      // (a jump in time — a preset loaded, the clock wound on — moves nothing)
      if (k === 0 || Math.abs(turn) > 1) continue;
      const s = b.spinAngle;
      b.spinAngle = s - turn;
      const q0 = bodyQuat(b);
      b.spinAngle = s;
      const dq = bodyQuat(b).multiply(q0.invert());
      const o = new THREE.Vector3(...m.off).applyQuaternion(dq), v = new THREE.Vector3(...m.vel).applyQuaternion(dq);
      m.off = [o.x, o.y, o.z]; m.vel = [v.x, v.y, v.z];
      q.premultiply(dq);
    }
  }

  /** where each station was (m from its world) last frame */
  private stationWas = new Map<Craft, THREE.Vector3>();
  /**
   * near a station in orbit, the ship goes round with it: within 10 km it keeps its place by the station (so
   * you can fly up to its port), less and less out to 20 km. How much it rode along, 0–1 (none unless `apply`;
   * the stations' places are kept every frame either way)
   */
  private rideStation(apply: boolean): number {
    const sh = this.ship, A = sh.nav.anchor;
    let best: Craft | null = null, bd = 20e3;
    const now = new Map<Craft, THREE.Vector3>();
    for (const c of this.fleet.crafts) {
      if (c.kind !== 'station' || c.state !== 'orbit' || !c.b.alive) continue;
      const at = this.fleet.local(c);
      now.set(c, at);
      if (c.b !== A) continue;
      const d = Math.hypot(at.x - sh.nav.off[0] * AU_M, at.y - sh.nav.off[1] * AU_M, at.z - sh.nav.off[2] * AU_M);
      if (d < bd) { bd = d; best = c; }
    }
    const was = best ? this.stationWas.get(best) : undefined;
    this.stationWas = now;
    if (!apply || !best || !was || this.visit.docked) return 0;
    const k = bd < 10e3 ? 1 : (20e3 - bd) / 10e3, m = now.get(best)!.clone().sub(was);
    // (a jump — a preset loaded, the clock wound on — is not a ride)
    if (m.length() > 5e3) return 0;
    for (let j = 0; j < 3; j++) sh.nav.off[j] += (m.getComponent(j) * k) / AU_M;
    return k;
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
    if (this.mode === 'shuttle') return 'You are flying Lander 1: dock with the ship first (fly within 100 m, F)';
    if (this.mode === 'eva' || this.mode === 'surface') return 'Board the ship first: it holds station while you are outside';
    if (this.landing) return this.landing.phase === 'landed' ? 'Lift off first (L)' : 'Not while landing';
    if (this.ship.worm) return 'Not during a wormhole transit';
    return '';
  }

  /** why the wormhole drive cannot open a way now, or '' */
  jumpBlock() {
    const sh = this.ship;
    if (this.mode === 'shuttle') return 'You are flying Lander 1: dock with the ship first (fly within 100 m, F)';
    if (this.mode === 'eva' || this.mode === 'surface') return 'Board the ship first: it holds station while you are outside';
    if (this.landing) return 'Lift off first';
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
    if (this.mode === 'surface') {
      const L = this.landing;
      if (L?.phase === 'landed') { const d = relM(this.surf.nav, this.ship.nav).length(); this.app.onToast(`The ship is landed ${d < 1000 ? `${d.toFixed(0)} m` : `${(d / 1000).toFixed(1)} km`} away: walk back to its ladder`); return; }
      if (L) { this.app.onToast('The ship is busy landing'); return; }
      // a base near you: the ship lands on its pad
      const nb = this.surf.b ? this.fleet.nearestBase(this.surf.b, this.surf.n) : null;
      if (nb && nb.d < 30e3) { this.visit.callToPad(nb.c); return; }
      // it comes down beside you
      this.travel = {
        b: null, stop: 5 / AU_M, name: 'you', land: true,
        at: () => {
          const S = this.surf, [e] = tangent(S.n), qb = bodyQuat(S.b!), up = new THREE.Vector3(...S.n).applyQuaternion(qb), east = new THREE.Vector3(...e).applyQuaternion(qb);
          const p = posOf(S.nav);
          return [p[0] + (up.x * 250 + east.x * 45) / AU_M, p[1] + (up.y * 250 + east.y * 45) / AU_M, p[2] + (up.z * 250 + east.z * 45) / AU_M];
        },
      };
      this.app.onToast('The ship is on its way to land beside you');
      return;
    }
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
      case 'airlock': if (this.visit.docked) this.visit.enter(this.visit.docked, 'dock'); else this.stepOut(); break;
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
        if (this.kit.samples.length) { this.kit.analyse(); break; }
        const n = this.logbook.firsts.length;
        toast(n ? `${Math.min(12, n)} vial${n > 1 ? 's' : ''} of orbital scans, one per world. Real samples will need the lander.` : 'Twelve empty vials. Each world you fly close to fills one with scans; real samples will need the lander.');
        break;
      }
      case 'down': this.climb(1); break;
      case 'up': this.climb(0); break;
      case 'lander': if (this.shuttle.out) toast(`Lander 1 is out: ${this.shuttle.status()}`); else this.shuttle.launch(); break;
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
  goToSleep() {
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
  /** the map a world is drawn with, if it has been painted */
  texOf(b: Body): THREE.Texture | null { return this.objs.get(b)?.tex ?? null; }
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
    if (this.landing) {
      if (this.landing.phase !== 'landed') { this.app.onToast('Wait until the ship has landed'); return; }
      const foot = this.ladderFoot()!;
      // facing away from the ship, out from the airlock
      const [e, nn] = tangent(foot), out = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.landing.q);
      this.logbook.walks++;
      this.toSurface(foot, Math.atan2(-out.dot(new THREE.Vector3(...e)), out.dot(new THREE.Vector3(...nn))));
      return;
    }
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
    this.kit.refill();
    this.kit.ride = null;
    this.kit.jet = false;
    this.surf.b = null;
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
    else if (this.mode === 'surface') { this.surf.yaw += yaw; this.surf.pitch = Math.max(-1.5, Math.min(1.5, this.surf.pitch + pitch)); }
    else if (this.mode === 'shuttle') this.shuttle.turn(yaw, pitch);
    else if (this.mode === 'inside') this.visit.turn(yaw, pitch);
    else if (this.mode === 'craft' && this.craftView) { this.craftView.yaw -= yaw; this.craftView.pitch = Math.max(-1.2, Math.min(1.45, this.craftView.pitch - pitch)); }
    else {
      this.foot.yaw += yaw;
      this.foot.pitch = Math.max(-1.45, Math.min(1.45, this.foot.pitch + pitch));
    }
  }



  // ---------------------------------------------------------------- the fleet
  /** what Mission Control aims at: the selection, if it is a world, or the nearest world */
  missionTarget(): Body | null {
    const ok = (b: Body) => b.alive && !b.look.craft && !b.look.wormhole && !['star', 'wd', 'ns', 'bh', 'debris', 'gasp'].includes(b.cls);
    const sel = this.app.selected;
    if (sel && ok(sel)) return sel;
    const P = this.shipPos();
    let best: Body | null = null, d = Infinity;
    for (const b of this.app.visual) {
      if (!ok(b) || !b.source) continue;
      const x = Math.hypot(b.x - P[0], b.y - P[1], b.z - P[2]) - b.r;
      if (x < d) { d = x; best = b; }
    }
    return best;
  }

  /** why a craft cannot be launched now, or '' */
  launchBlock(kind: CraftKind) {
    if (this.ship.worm) return 'Not during a wormhole transit';
    const b = this.missionTarget();
    if (!b) return 'No target';
    const P = this.shipPos();
    const alt = (Math.hypot(b.x - P[0], b.y - P[1], b.z - P[2]) - b.r) * AU_M;
    const why = this.fleet.why(kind, b, alt, (this.landing?.phase === 'landed' && this.landing.b === b) || this.grounded() === b);
    if (why) return why;
    // from the ground, anything going up into space goes from a launch pad
    const gw = this.grounded();
    if (gw && this.needsPad(kind, b, gw) && !this.fleet.pads(gw).length) return `Build a launch pad first: from the ground of ${gw.name}, craft go up from a pad`;
    // a module goes beside a base: you have to be there
    if (isModule(kind)) {
      const me = this.mode === 'surface' ? this.surf.n : this.mode === 'inside' && this.visit.at ? this.visit.at.c.n : null, near = gw && me ? this.fleet.nearestBase(gw, me) : null;
      if (!near || near.d > 1500) return 'Beside a base: stand near one to build it';
    }
    return '';
  }

  /** the world you are standing on (on foot, in a base, or with the ship landed), if any */
  grounded(): Body | null {
    if (this.mode === 'surface' && this.surf.b) return this.surf.b;
    if (this.mode === 'inside' && this.visit.at?.c.kind === 'base') return this.visit.at.c.b;
    if (this.landing?.phase === 'landed') return this.landing.b;
    return null;
  }

  /** does sending this craft from the ground of gw mean launching it into space? */
  private needsPad(kind: CraftKind, target: Body, gw: Body) {
    if (kind === 'base' || kind === 'pad' || isModule(kind)) return false;
    return kind === 'probe' || kind === 'orbiter' || kind === 'station' || target !== gw;
  }

  /** send a craft to the target, at a named site or below the ship */
  launch(kind: CraftKind, site?: string) {
    const why = this.launchBlock(kind);
    if (why) { this.app.onToast(why); return; }
    if (kind === 'base' || kind === 'pad' || isModule(kind)) { this.panels.close(); this.placer.start(kind); return; }
    const b = this.missionTarget()!;
    let P = this.shipPos(), from = '';
    // from the ground: up off the nearest launch pad, on its rocket
    const gw = this.grounded();
    if (gw && this.needsPad(kind, b, gw)) {
      const me = this.mode === 'surface' ? this.surf.n : this.fleet.local(this.fleet.pads(gw)[0]).applyQuaternion(bodyQuat(gw).invert()).normalize().toArray() as V3;
      const pad = this.fleet.pads(gw).map(c => ({ c, d: arc(c.n, me) })).sort((x, y) => x.d - y.d)[0].c;
      P = this.visit.worldOf(pad, new THREE.Vector3(-8, 60, 0));
      pad.odo = pad.age + 45;
      from = ` from ${pad.name}`;
    }
    const at = new THREE.Vector3((P[0] - b.x) * AU_M, (P[1] - b.y) * AU_M, (P[2] - b.z) * AU_M);
    const c = this.fleet.launch(kind, b, at, site ? this.fleet.siteFor(b, site) : null);
    if (from) { this.app.onToast(`${c.name} lifts off${from}, toward ${b.name}${site ? `, for ${site}` : ''}`); return; }
    this.bayT = 4;
    this.app.onToast(`${c.name} launched toward ${b.name}${site ? `, for ${site}` : ''}`);
  }

  /** the floodlight (and the helmet lamp on foot or outside): on or off */
  toggleLights() {
    this.lights.flood = !this.lights.flood;
    const out = this.mode === 'surface' || this.mode === 'eva';
    this.app.onToast(this.lights.flood ? (out ? 'Helmet lamp and the ship’s floodlight on' : 'Floodlight on: it reaches the ground from orbit') : 'Lights off');
  }

  /** the point under you on a world, degrees in its own frame: under your feet on the ground, under the ship otherwise */
  pointUnder(b: Body): [number, number] {
    if (this.mode === 'surface' && this.surf.b === b) return latLonOf(this.surf.n);
    const P = this.shipPos();
    const v = new THREE.Vector3(P[0] - b.x, P[1] - b.y, P[2] - b.z).applyQuaternion(bodyQuat(b).invert()).normalize();
    return latLonOf([v.x, v.y, v.z]);
  }

  /** hang a lamp in the sky over the point under you on the mission's world */
  hangLamp() {
    const b = this.missionTarget();
    if (!b) { this.app.onToast('Pick a world to hang a lamp over'); return; }
    const [la, lo] = this.pointUnder(b);
    const L = this.lights.hang(b, la, lo, atmosphere(b, this.stars()).bar > 0.01);
    if (typeof L === 'string') { this.app.onToast(L); return; }
    this.app.onToast(`Lamp ${L.id} hung ${fmtLength(L.alt / AU_M)} over ${b.name}, lighting ${fmtLength(L.spread / AU_M)} round the point under you`);
  }

  /** fly to a few kilometres over a named site on a world, ready to land */
  goToSite(b: Body, name: string) {
    const why = this.goBlock();
    if (why) { this.app.onToast(why); return; }
    const n = this.fleet.siteFor(b, name);
    if (!n) return;
    const over = () => {
      const h = Math.max(0, this.fleet.heightAt(b, n, 50)), r = b.r * AU_M + h + 3000;
      const p = new THREE.Vector3(n[0] * r, n[1] * r, n[2] * r).applyQuaternion(bodyQuat(b));
      return [b.x + p.x / AU_M, b.y + p.y / AU_M, b.z + p.z / AU_M] as V3;
    };
    this.travel = { b: null, at: over, stop: 20 / AU_M, name };
    this.app.onToast(`Flying to ${name}: L lands when you are there`);
  }

  /** a rover off a landed lander */
  roverFrom(id: number) {
    const L = this.fleet.byId(id);
    if (!L || L.state !== 'surface') return;
    const c = this.fleet.launch('rover', L.b, new THREE.Vector3(), null, L);
    this.app.onToast(`${c.name} rolls off ${L.name}`);
  }

  // ---------------------------------------------------------------- the rockets
  /** a rocket standing within a few metres of you on foot */
  /** an artefact in a ruin, within reach of you on foot */
  artefactNear() {
    const S = this.surf, G = this.ground;
    if (this.mode !== 'surface' || !G.spec || !G.ruins.near.length) return null;
    return G.ruins.artefactAt(S.n, G.spec.R, S.foot);
  }

  rocketNear() {
    const S = this.surf, inside = this.mode === 'inside' ? this.visit.at?.c : null;
    if (inside?.rocket) return !inside.rocket.trip && !inside.rocket.docked ? inside : null;
    if (this.mode !== 'surface' || !S.b) return null;
    const R = S.b.r * AU_M;
    return this.fleet.crafts.find(c => c.rocket && !c.rocket.trip && !c.rocket.docked && c.b === S.b && c.build >= 1 && arc(c.n, S.n) * R < 9) ?? null;
  }

  /** stack a rocket on the nearest free pad or base of the mission's world (nearest you) */
  stackRocket(kind: RocketModel) {
    const b = this.missionTarget();
    if (!b) { this.app.onToast('Pick a world'); return; }
    const me = this.mode === 'surface' && this.surf.b === b ? this.surf.n : null;
    const sites = this.fleet.sites().filter(c => c.b === b && c.kind !== 'station' && !this.fleet.rocketAt(c));
    if (!sites.length) { this.app.onToast(`No free launch pad or base on ${b.name}: build one first`); return; }
    const site = me ? sites.sort((x, y) => arc(x.n, me) - arc(y.n, me))[0] : sites[0];
    const c = this.fleet.stack(kind, site);
    this.app.onToast(typeof c === 'string' ? c : `${c.name}: stacking on ${site.name}, about fifteen seconds`);
  }

  /** send a rocket off; with you aboard, if you are going too */
  flyRocket(c: Craft, dest: Craft, ride: boolean) {
    const why = this.fleet.fly(c, dest);
    if (why) { this.app.onToast(why); return; }
    this.panels.close();
    if (ride) {
      if (this.visit.at) { this.visit.drop(); this.mode = 'surface'; }
      c.rocket!.aboard = true;
      this.viewCraft(c.id);
      this.craftView!.seat = 'cockpit'; this.craftView!.yaw = 0; this.craftView!.pitch = 0;
      this.app.onToast(`Strapped in. ${c.name} for ${dest.name}: lift-off · Z for the ${seatsOf(c.rocket!.kind).includes('cabin') ? 'cabin, ' : ''}view outside`);
    }
    else this.app.onToast(`${c.name} is on its way to ${dest.name}`);
  }

  /** put a rocket on a supply route: its load to `dest`, back empty, and again */
  routeRocket(c: Craft, dest: Craft) {
    const why = this.fleet.runRoute(c, dest);
    if (why) { this.app.onToast(why); return; }
    this.panels.close();
    this.app.onToast(`${c.name} is on a supply route to ${dest.name} and back: Mission control to stop it`);
  }

  /** a rocket has come in: if you were aboard, you climb out (onto the pad, or into the station) */
  private rocketIn(c: Craft, at: Craft) {
    const r = c.rocket!;
    if (!r.aboard) return;
    r.aboard = false;
    if (at.kind === 'station') { this.craftView = null; this.visit.enter(at, 'dock'); return; }
    this.climbOut = { id: c.id, at: at.id };
  }
  /** waiting to climb out of a rocket that has landed, until the ground there is ready */
  private climbOut: { id: number; at: number } | null = null;
  private tryClimbOut() {
    const w = this.climbOut, c = w ? this.fleet.byId(w.id) : null, at = w ? this.fleet.byId(w.at) : null;
    if (!w || !c || !at) { this.climbOut = null; return; }
    if (this.ground.body !== at.b || !this.ground.spec || !this.ground.ready) return;
    this.climbOut = null;
    this.craftView = null;
    // down the ladder, a few metres from its legs, facing away from it
    const out = this.fleet.offset(c.n, 7, c.head + Math.PI / 2, at.b.r * AU_M);
    this.toSurface(out, c.head + Math.PI / 2);
    this.app.onToast(`${c.name} is down on ${at.name}. Out you climb`);
  }

  /** watch a craft (drive it, if it is a rover on the ground) */
  viewCraft(id: number) {
    const c = this.fleet.byId(id);
    if (!c) return;
    const back = this.mode === 'craft' ? this.craftView?.back ?? 'pilot' : this.mode;
    const dist = c.kind === 'station' ? 160 : c.kind === 'base' ? 110 : c.kind === 'rocket' ? 42 : c.kind === 'orbiter' ? 30 : c.kind === 'lander' ? 16 : c.kind === 'rover' ? 10 : 14;
    // from orbit, looking down past it to the world
    this.craftView = { id, back, yaw: 0, pitch: c.state === 'orbit' || c.state === 'cruise' ? 0.75 : 0.35, dist, seat: 'out' };
    this.mode = 'craft';
    this.panels.close();
    this.app.onToast(`${c.name}${c.kind === 'rover' && c.state === 'surface' ? ': WASD (or the stick) drives it' : ''} · F or Esc to come back`);
  }

  leaveCraft() {
    const v = this.craftView;
    // strapped into a rocket in flight: you stay with it
    const rc = v ? this.fleet.byId(v.id) : null;
    if (rc?.rocket?.aboard && rc.rocket.trip) { this.app.onToast(`Strapped in until ${rc.name} is down`); return; }
    if (v) { const c = this.fleet.byId(v.id); if (c) c.drive = { f: 0, s: 0 }; }
    this.mode = v?.back ?? 'pilot';
    this.craftView = null;
  }

  /** riding a rocket: the next seat to look from (the cockpit, the cabin if it has one, outside) */
  craftSeat() {
    const v = this.craftView, c = v ? this.fleet.byId(v.id) : null;
    if (!v || !c?.rocket?.aboard) return;
    const seats = seatsOf(c.rocket.kind);
    v.seat = seats[(seats.indexOf(v.seat) + 1) % seats.length];
    v.yaw = 0; v.pitch = v.seat === 'out' ? 0.35 : 0;
    this.app.onToast(v.seat === 'cockpit' ? 'The cockpit' : v.seat === 'cabin' ? 'The cabin, with the passengers' : 'Outside');
  }

  /** the next (or previous) craft to watch */
  cycleCraft(dir: number) {
    const list = this.fleet.crafts.filter(c => c.state !== 'lost');
    if (!list.length) return;
    const k = list.findIndex(c => c.id === this.craftView?.id);
    this.viewCraft(list[(k + dir + list.length) % list.length].id);
  }

  /** the camera on a craft: round it at a distance, its local up up */
  private placeCraft() {
    const v = this.craftView!, c = this.fleet.byId(v.id);
    if (!c) { this.leaveCraft(); return false; }
    if (v.seat !== 'out' && c.rocket && this.placeSeat(c, v)) return true;
    if (c.kind === 'rover') { const inp = this.controls.walkInput(); c.drive = { f: inp.f, s: -inp.s }; }
    const loc = this.fleet.local(c), U = loc.clone().normalize();
    // (a rocket is watched round its middle, not its feet)
    if (c.rocket) loc.addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(c.mesh.quaternion), ROCKETS[c.rocket.kind].height * 0.45);
    // a horizontal reference: the craft's heading on the ground, or its way along the orbit
    let fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.mesh.quaternion);
    fwd.addScaledVector(U, -fwd.dot(U));
    if (fwd.lengthSq() < 1e-8) fwd = new THREE.Vector3(...tangent([U.x, U.y, U.z])[1]);
    fwd.normalize();
    const off = fwd.clone().negate().applyAxisAngle(U, v.yaw);
    const side = new THREE.Vector3().crossVectors(off, U).normalize();
    off.applyAxisAngle(side, -v.pitch).multiplyScalar(v.dist);
    const at = loc.clone().add(off);
    // never under the ground
    if (c.state === 'surface' || c.state === 'descent') {
      const n = at.clone().normalize(), qb = bodyQuat(c.b).invert(), nb = n.clone().applyQuaternion(qb);
      const gr = c.b.r * AU_M + this.fleet.heightAt(c.b, [nb.x, nb.y, nb.z], 1) + 1.5;
      if (at.length() < gr) at.setLength(gr);
    }
    const m: Mover = { anchor: c.b, off: [at.x / AU_M, at.y / AU_M, at.z / AU_M], vel: [0, 0, 0] };
    this.base = m;
    this.eye.set(0, 0, 0);
    this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(at, loc, U));
    return true;
  }

  /** the camera in a rocket's seat: at its model's socket, facing its way, turned by your head */
  private placeSeat(c: Craft, v: NonNullable<View3D['craftView']>) {
    const sock = c.mesh.getObjectByName(v.seat === 'cockpit' ? 'SOCKET_CockpitCamera' : 'SOCKET_Occupant_Passenger_01');
    if (!sock) return false;
    c.mesh.updateMatrixWorld(true);
    const rel = c.mesh.matrixWorld.clone().invert().multiply(sock.matrixWorld), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    rel.decompose(p, q, sc);
    // (in the cabin, a seated head over the seat)
    if (v.seat === 'cabin') p.y += 0.8;
    const at = this.fleet.local(c).add(p.applyQuaternion(c.mesh.quaternion));
    this.base = { anchor: c.b, off: [at.x / AU_M, at.y / AU_M, at.z / AU_M], vel: [0, 0, 0] };
    this.eye.set(0, 0, 0);
    this.camera.quaternion.copy(c.mesh.quaternion).multiply(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(v.pitch, v.yaw, 0, 'YXZ')));
    return true;
  }

  // ---------------------------------------------------------------- landing and the ground
  /** a first: something found on a world, into the captain's log */
  found(what: string, note: string) {
    const b = this.ground.body;
    this.logbook.finds.push({ what, note, where: b?.name ?? '' });
    this.app.onToast(`Found: ${what}`);
  }

  /** the ship's position over the ground of the world it is near: unit direction (body frame), height over the ground (m), the world */
  overGround(m: Mover = this.ship.nav): { b: Body; n: V3; alt: number; h: number; q: THREE.Quaternion } | null {
    const b = this.ground.body;
    if (!b || !this.ground.spec) return null;
    const p = posOf(m), q = bodyQuat(b);
    const v = new THREE.Vector3((p[0] - b.x) * AU_M, (p[1] - b.y) * AU_M, (p[2] - b.z) * AU_M).applyQuaternion(q.clone().invert());
    const r = v.length();
    const n: V3 = [v.x / r, v.y / r, v.z / r];
    const h = this.ground.heightAt(n, 2);
    return { b, n, alt: r - this.ground.spec.R - Math.max(h, this.ground.last_sample.sea ? 0 : h), h, q };
  }

  /** why the ship cannot land here now, or '' */
  landBlock() {
    if (this.landing) return this.landing.phase === 'landed' ? '' : 'Already under way';
    if (this.mode === 'eva') return 'Board the ship first';
    if (this.ship.worm) return 'Not during a wormhole transit';
    const g = this.ground, o = this.overGround();
    if (!o || !g.ready) {
      const { b } = this.nearest(this.shipPos());
      if (b && ['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(b.look.style)) return `${b.name} has no surface to land on: fly down into its clouds instead`;
      return 'Nothing to land on here: fly down close to a world';
    }
    if (o.alt > LAND_RANGE) return `Too high to land: come within ${LAND_RANGE / 1000} km of the ground (now ${(o.alt / 1000).toFixed(1)} km)`;
    this.ground.heightAt(o.n, 2);
    if (this.ground.last_sample.sea) return 'Over the sea: find dry land';
    const T = g.atmo?.T ?? 0;
    if (T > 1500) return `The ground is molten: ${Math.round(T)} K`;
    if (gravity(o.b) > 40) return `Gravity too strong: ${(gravity(o.b) / 9.81).toFixed(1)} g`;
    return '';
  }

  /** set down on the ground below, or lift off if landed */
  landOrLift() {
    if (this.landing?.phase === 'landed') { this.liftOff(); return; }
    const why = this.landBlock();
    if (why) { this.app.onToast(why); return; }
    const o = this.overGround()!, sh = this.ship;
    this.travel = null;
    sh.od = false; this.autoOd = false;
    sh.nav.vel = [0, 0, 0];
    const q = o.q.clone().invert().multiply(sh.quat);
    this.landing = { b: o.b, n: o.n, alt: o.alt, q, phase: 'down', legs: 0, reach: [], ladder: 0 };
    sh.nav.anchor = o.b;
    this.app.onToast(`Landing on ${o.b.name}`);
  }

  liftOff() {
    const L = this.landing;
    if (!L) return;
    if (this.mode === 'surface') { this.app.onToast('Board the ship first'); return; }
    L.phase = 'up';
    this.app.onToast('Lifting off');
  }

  /** the ship coming down, standing, or going up: kept in the world's turning frame so the ground turns with it */
  private landStep(dt: number) {
    const L = this.landing!, sh = this.ship, b = L.b;
    if (!b.alive || this.ground.body !== b) { this.landing = null; sh.hull.setLegs(0); sh.hull.setLadder(null); return; }
    const spec = this.ground.spec!, qb = bodyQuat(b);
    // level the ship on the ground's slope, keeping its heading
    const up = this.ground.normalAt(L.n, L.phase === 'up' ? 1 : 12);
    const U = new THREE.Vector3(...up);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.q);
    fwd.addScaledVector(U, -fwd.dot(U));
    if (fwd.lengthSq() < 1e-6) fwd.copy(new THREE.Vector3(...tangent(L.n)[1]));
    fwd.normalize();
    // the basis: right = forward × up, up, back
    const level = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(fwd, U).normalize(), U, fwd.clone().negate()));
    if (L.phase !== 'up') L.q.slerp(level, Math.min(1, dt * 1.5));
    const hG = this.ground.heightAt(L.n, 0.5), sea = this.ground.last_sample.sea;
    const ground = sea ? 0 : hG;
    sh.thrust = L.phase === 'landed' ? 0 : 0.5;
    if (L.phase === 'down') {
      // a fast drop, slowing to a walking pace for the last stretch
      const v = Math.max(1.2, Math.min(400, (L.alt - LAND_H) * 0.6));
      L.alt = Math.max(LAND_H, L.alt - v * dt);
      L.legs = Math.min(1, L.legs + (L.alt < 600 ? dt / 2.5 : 0));
      if (L.alt <= LAND_H + 0.01 && L.legs >= 1) {
        L.phase = 'landed';
        this.logbook.landings++;
        this.app.onToast(`Landed on ${b.name}. The airlock's ladder is down: step outside from the commons`);
        if (!this.logbook.landed.includes(b.name)) this.logbook.landed.push(b.name);
      }
    } else if (L.phase === 'up') {
      L.ladder = Math.max(0, L.ladder - dt);
      L.legs = Math.max(0, L.legs - dt / 2);
      L.alt += Math.max(3, L.alt * 0.8) * dt;
      if (L.alt > 400) {
        this.landing = null;
        sh.hull.setLegs(0);
        sh.hull.setLadder(null);
        this.app.onToast('Clear of the ground');
        return;
      }
    } else L.ladder = Math.min(1, L.ladder + dt / 2);
    // where the ship is, from the world's frame
    const r = spec.R + ground + L.alt;
    const p = new THREE.Vector3(L.n[0] * r, L.n[1] * r, L.n[2] * r).applyQuaternion(qb);
    sh.nav.anchor = b;
    sh.nav.off = [p.x / AU_M, p.y / AU_M, p.z / AU_M];
    sh.nav.vel = [0, 0, 0];
    sh.quat.copy(qb).multiply(L.q);
    // each leg telescopes down to the ground under it; the ladder to the ground under the hatch
    if (L.legs > 0 && L.alt < 60) {
      const R0 = spec.R + ground + L.alt;
      const centre = new THREE.Vector3(L.n[0] * R0, L.n[1] * R0, L.n[2] * R0);
      const under = (hip: THREE.Vector3) => {
        const w = hip.clone().applyQuaternion(L.q).add(centre);
        const len = w.length(), nn: V3 = [w.x / len, w.y / len, w.z / len];
        const hg = this.ground.heightAt(nn, 0.5);
        // straight down in the ship's frame, near enough: the drop along the local vertical
        return len - (spec.R + (this.ground.last_sample.sea ? 0 : hg));
      };
      L.reach = LEG_HIPS.map(h => Math.max(0.5, under(new THREE.Vector3(h[0], h[1], h[2])) - 0.15));
      sh.hull.setLegs(L.legs, L.reach.map(x => x * L.legs + (1 - L.legs) * 2));
      if (L.phase !== 'down' || L.ladder > 0) sh.hull.setLadder(L.ladder > 0 ? under(LADDER_TOP) * L.ladder : null);
    } else {
      sh.hull.setLegs(L.legs);
      sh.hull.setLadder(null);
    }
  }

  /** out onto the ground: on foot at `n` (body frame), facing `yaw` */
  toSurface(n: V3, yaw: number) {
    const b = this.ground.body;
    if (!b) return;
    const S = this.surf;
    S.b = b; S.n = n; S.yaw = yaw; S.pitch = 0; S.y = 0; S.vy = 0; S.foot = -Infinity; S.inside = null;
    S.nav = { anchor: b, off: [0, 0, 0], vel: [0, 0, 0] };
    this.mode = 'surface';
    this.foot.seat = null;
    this.placeSurf();
    if (!this.logbook.walkedOn.includes(b.name)) {
      this.logbook.walkedOn.push(b.name);
      const g = gravity(b);
      this.app.onToast(`On the surface of ${b.name}: ${(g / 9.81).toFixed(g < 1 ? 3 : 2)} g${this.ground.atmo && this.ground.atmo.bar > 0.01 ? `, ${this.ground.atmo.bar.toPrecision(3)} bar of ${this.ground.atmo.gases[0]?.name ?? 'air'}` : ', no air: suit sealed'}`);
    }
  }

  /** the walker's mover, from where they stand */
  private placeSurf() {
    const S = this.surf, b = S.b!, spec = this.ground.spec;
    if (!spec) return;
    // what you stand on: the ground, or a cave's floor if you are in one
    const st = this.ground.standAt(S.n, S.foot === -Infinity ? this.ground.heightAt(S.n, 0.3) : S.foot + 0.6), g0 = st.h;
    S.foot = g0; S.roof = st.roof;
    if ((st.inside?.name ?? null) !== S.inside) { S.inside = st.inside?.name ?? null; if (st.inside) this.app.onToast(`In ${st.inside.name.replace(/^An? /, 'the ').toLowerCase()}: N for your helmet lamp`); }
    const r = spec.R + g0 + S.y + 1.7;
    const p = new THREE.Vector3(S.n[0] * r, S.n[1] * r, S.n[2] * r).applyQuaternion(bodyQuat(b));
    S.nav.anchor = b;
    S.nav.off = [p.x / AU_M, p.y / AU_M, p.z / AU_M];
  }

  /** walking on a world: its own gravity, its ground underfoot */
  private surfaceStep(dt: number) {
    const S = this.surf, b = S.b;
    if (!b || !b.alive || this.ground.body !== b || !this.ground.spec) { this.mode = 'eva'; this.suit.nav = { ...S.nav, vel: [0, 0, 0] }; return; }
    const R = this.ground.spec.R, g = gravity(b);
    const inp = this.controls.walkInput();
    if (this.kit.ride) {
      S.y = this.kit.rideStep(dt, inp, R);
      S.vy = 0;
      this.placeSurf();
      return;
    }
    // a bounding lope in low gravity, a walk otherwise
    const sp = (inp.run ? 6 : 2.5) * (g < 3 ? 1.3 : 1);
    const [e, nn] = tangent(S.n);
    const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
    const fwd: V3 = [-sy * e[0] + cy * nn[0], -sy * e[1] + cy * nn[1], -sy * e[2] + cy * nn[2]];
    const right: V3 = [cy * e[0] + sy * nn[0], cy * e[1] + sy * nn[1], cy * e[2] + sy * nn[2]];
    const air = S.y > 0.05;
    const k = (sp * dt) / R * (air ? 0.6 : 1);
    if (inp.f || inp.s) {
      const m: V3 = [S.n[0] + (fwd[0] * inp.f + right[0] * inp.s) * k, S.n[1] + (fwd[1] * inp.f + right[1] * inp.s) * k, S.n[2] + (fwd[2] * inp.f + right[2] * inp.s) * k];
      const l = Math.hypot(...m);
      const next: V3 = [m[0] / l, m[1] / l, m[2] / l];
      const st = this.ground.standAt(next, S.foot + S.y + 0.6);
      if (st.sea) { if (performance.now() - this.seaToast > 4000) { this.seaToast = performance.now(); this.app.onToast('The water’s edge: you would need a boat'); } }
      else if (st.solid) { if (performance.now() - this.seaToast > 4000) { this.seaToast = performance.now(); this.app.onToast('Solid rock: find a way round'); } }
      else S.n = next;
    }
    S.speed = Math.hypot(inp.f, inp.s) * sp;
    if (inp.jump && !air) S.vy = 3.4;
    // the jetpack: thrust up while Space is held, a little more than the world's weight
    if (this.kit.jet && inp.jump && this.kit.power > 0) S.vy += (g + 4) * dt;
    S.vy -= g * dt;
    if (this.kit.jet && S.y > 250) { S.y = 250; S.vy = Math.min(0, S.vy); }
    S.y = Math.max(0, S.y + S.vy * dt);
    if (S.y <= 0) S.vy = 0;
    // under a roof, your head stops you
    if (S.foot + S.y + 1.9 > S.roof) { S.y = Math.max(0, S.roof - 1.9 - S.foot); S.vy = Math.min(0, S.vy); }
    this.placeSurf();
  }
  private seaToast = 0;

  /** the camera on the ground: level with the local horizon, turned by your head */
  private surfQuat(q: THREE.Quaternion) {
    const S = this.surf, [e, nn] = tangent(S.n);
    const up = new THREE.Vector3(...S.n), east = new THREE.Vector3(...e), north = new THREE.Vector3(...nn);
    const basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.negate()));
    return q.copy(bodyQuat(S.b!)).multiply(basis).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(S.pitch, S.yaw, 0, 'YXZ')));
  }

  /** the foot of the ladder, where you step off it and get back on: body frame */
  private ladderFoot(): V3 | null {
    const L = this.landing;
    if (!L || L.phase !== 'landed' || !this.ground.spec) return null;
    const qb = bodyQuat(L.b), w = LADDER_TOP.clone().add(new THREE.Vector3(-1.2, 0, 0)).applyQuaternion(this.ship.quat);
    const p = new THREE.Vector3(...posOf(this.ship.nav).map((x, k) => (x - [L.b.x, L.b.y, L.b.z][k]) * AU_M) as V3).add(w).applyQuaternion(qb.invert());
    const l = p.length();
    return [p.x / l, p.y / l, p.z / l];
  }

  // ---------------------------------------------------------------- frame
  frame(dtReal: number) {
    if (!this.active) return;
    this.adapt(dtReal);
    const app = this.app, sh = this.ship;
    this.frameNo++;
    if (!this.landing && (!sh.worm || sh.worm.phase !== 'tunnel')) this.pickAnchor(sh.nav);
    if (this.mode === 'eva') this.pickAnchor(this.suit.nav);
    this.corotate();
    this.controls.update(dtReal);
    this.panels.tick(dtReal);
    this.sleepStep(dtReal);
    sh.update(dtReal);
    if (this.landing) this.landStep(dtReal);
    else if (sh.worm) this.wormStep(dtReal); else this.fly(dtReal);
    if (this.mode === 'walk') this.walk(dtReal);
    if (this.mode === 'eva') this.spacewalk(dtReal);
    if (this.mode === 'surface') this.surfaceStep(dtReal);
    this.kit.frame(dtReal);
    this.shuttle.step(dtReal, this.mode === 'shuttle');
    // the craft move on before the viewer is placed: inside one, you go where it goes
    this.fleet.step(dtReal);
    // the bases' and stations' crews live a day a minute of your time, whatever the clock's rate (so winding it on,
    // or a night in the bunk, does not starve them), and not while it is stopped
    if (!this.app.paused) this.fleet.live(dtReal / 60);
    this.visit.holdDocked();
    if (this.mode === 'inside') this.visit.step(dtReal);
    if (this.frameNo % 60 === 1) this.fleet.fixtures(app.world.sources);
    this.place();
    const P = this.where();
    const cam = this.camera;
    cam.updateMatrixWorld();
    const tunnel = sh.worm?.phase === 'tunnel';

    // light: the star that lights each body best
    const stars = app.world.sources.filter(s => (s.cls === 'star' || s.cls === 'wd') && (s.star?.L ?? 0) > 0);
    // the ground and sky of the world under you, and the craft out there
    this.groundFrame(dtReal, P, stars, tunnel);
    this.fleet.frame(dtReal, P, cam.fov);
    this.shuttle.draw(P);
    // the lights you bring: the floodlight from the ship's nose, the helmet lamp where you look, the lamps in the sky
    {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(sh.quat);
      const nose = sh.hull.group.position.clone().addScaledVector(fwd, 30);
      const inside = this.mode === 'walk' || (this.mode === 'pilot' && sh.view === 'cockpit');
      const out = this.mode === 'eva' || this.mode === 'surface' || this.mode === 'shuttle' || this.mode === 'craft';
      const eye = out ? { pos: cam.getWorldPosition(new THREE.Vector3()), fwd: cam.getWorldDirection(new THREE.Vector3()) } : null;
      this.lights.ambient = app.nightLight;
      this.lights.frame(dtReal, P, { pos: nose, fwd, inside }, eye);
    }
    this.bayT = Math.max(0, this.bayT - dtReal);
    sh.hull.setBay(Math.min(1, this.bayT, 4 - this.bayT));
    const seen = new Set<Body>();
    const tanPx = Math.tan((cam.fov * Math.PI) / 360) / (window.innerHeight / 4);
    const mk: number[] = [], mc: number[] = [];
    // under a daylit sky only what is bright enough shows: the Sun, the Moon's disc; not the faint dots, nor dust and rubble
    const glare = this.ground.body ? this.ground.glare : 0, faint = Math.max(0, 1 - glare * 4);
    // deep in a giant's clouds nothing outside can be seen
    const blind = tunnel || this.giant.inside > 0.97;
    if (!blind) for (const b of app.visual) {
      const rel: V3 = [(b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M];
      const dist = Math.hypot(rel[0], rel[1], rel[2]);
      const R = this.visR(b) * AU_M;
      const angPx = R / Math.max(dist, 1) / tanPx;
      // a marker for everything too small to see as a disc
      if (angPx < 2.5 && (faint > 0 || b.cls === 'star')) {
        const t = tintOf(b), k = b.cls === 'star' ? 1 : faint;
        mk.push(rel[0], rel[1], rel[2]);
        mc.push(t[0] * k, t[1] * k, t[2] * k);
      }
      const glowy = b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns' || b.look.white || b.look.wormhole || (b.cls === 'bh' && this.app.feeding.level(b) > 0.02);
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
    this.galaxy.visible = !tunnel;

    // particles: gas and debris
    const pp: number[] = [], pc: number[] = [];
    // gas a traced look already draws (a hole's disc, a nebula's shell) is not drawn again as dots over it
    const drawn: { b: Body; r: number }[] = [], tori: { b: Body; r: number }[] = [];
    for (const [b, o] of this.objs) {
      if (!o.group.visible) continue;
      // (only within the disc's bright part: the dim gas beyond shows as itself, a torus round the hole)
      if (o.hole && o.hole.outer > 20) { drawn.push({ b, r: Math.min(o.hole.outer, 60) * schwarzschild(b.m) }); tori.push({ b, r: 3e6 * schwarzschild(b.m) }); }
      if (o.neb && o.neb.mesh.visible && o.shellR) drawn.push({ b, r: o.shellR * 2 });
    }
    if (!blind) for (const p of app.world.bodies) {
      if (!p.alive || p.source || !p.isParticle) continue;
      if (p.cls === 'gasp' && drawn.some(q => Math.hypot(p.x - q.b.x, p.y - q.b.y, p.z - q.b.z) < q.r)) continue;
      // a hole's torus glows in its disc's colours, deep orange
      if (p.cls === 'gasp' && tori.some(q => Math.hypot(p.x - q.b.x, p.y - q.b.y, p.z - q.b.z) < q.r)) {
        pp.push((p.x - P[0]) * AU_M, (p.y - P[1]) * AU_M, (p.z - P[2]) * AU_M);
        pc.push(1, 0.36, 0.08);
        continue;
      }
      pp.push((p.x - P[0]) * AU_M, (p.y - P[1]) * AU_M, (p.z - P[2]) * AU_M);
      const c = p.look.c1, h = p.heat;
      const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, bl = (c & 255) / 255;
      pc.push(Math.min(1, r + h), Math.min(1, g + h * 0.5), Math.min(1, bl + h * 0.2));
    }
    setPoints(this.parts, pp, pc);
    (this.parts.material as THREE.ShaderMaterial).uniforms.dim.value = faint;
    this.parts.visible = faint > 0;

    // the light on the hull: the star that shines brightest here
    let sun: THREE.Vector3 | null = null, best = 0;
    if (!tunnel) for (const s of stars) {
      const d2 = (s.x - P[0]) ** 2 + (s.y - P[1]) ** 2 + (s.z - P[2]) ** 2;
      if ((s.star?.L ?? 0) / d2 > best) { best = (s.star?.L ?? 0) / d2; sun = new THREE.Vector3(P[0] - s.x, P[1] - s.y, P[2] - s.z).normalize(); }
    }
    this.mouths();
    this.placer.frame();
    this.cabin(dtReal);
    sh.draw(dtReal, cam, sh.nav.vel, sun, sh.hull.group.position, this.mode === 'pilot', tunnel);
    // on a world, the sunlight on the ship and what stands on the ground is the sunlight through its air, and none at night
    if (this.ground.body) { sh.sun.color.copy(this.ground.sunCol); sh.sun.intensity = 2.2 * Math.min(1, Math.max(this.ground.sunCol.r, this.ground.sunCol.g, this.ground.sunCol.b)); }
    else sh.sun.color.setRGB(1, 1, 1);
    if (this.mode === 'scope') { cam.fov = this.scope.fov; cam.updateProjectionMatrix(); }
    else if (this.mode !== 'pilot' && cam.fov !== 75) { cam.fov = 75; cam.updateProjectionMatrix(); }
    // the map covers the view: leave the last frame up rather than draw what nobody can see
    if (!this.nav.open) { this.feeds.frame(performance.now() / 1000); this.renderer.render(this.scene, cam); }
    this.drawLabels(P, blind || this.nav.open || (this.mode === 'inside' && !this.visit.at?.cupola));
    this.radar.draw();
    this.nav.draw(dtReal);
    this.controls.hud(this.readout());
  }

  private frameNo = 0;
  /** the world near enough to stand on, its ground and its sky */
  private groundFrame(dt: number, P: V3, stars: Body[], tunnel: boolean) {
    let b: Body | null = null, best = Infinity, gb: Body | null = null, gbest = Infinity;
    if (!tunnel) for (const x of this.app.visual) {
      const d = (Math.hypot(x.x - P[0], x.y - P[1], x.z - P[2]) - x.r) * AU_M;
      if (Giant.is(x)) { if (d < gbest) { gbest = d; gb = x; } continue; }
      if (!Ground.solid(x)) continue;
      if (d < best) { best = d; b = x; }
    }
    // a giant's clouds, if you are in or near them
    {
      const rel = gb ? new THREE.Vector3((gb.x - P[0]) * AU_M, (gb.y - P[1]) * AU_M, (gb.z - P[2]) * AU_M) : new THREE.Vector3();
      let sun: THREE.Vector3 | null = null, f = 0;
      if (gb) for (const s of stars) { const q = s.star!.L / ((s.x - gb.x) ** 2 + (s.y - gb.y) ** 2 + (s.z - gb.z) ** 2); if (q > f) { f = q; sun = new THREE.Vector3(s.x - P[0], s.y - P[1], s.z - P[2]).normalize(); } }
      this.giant.frame(dt, gb, rel, stars, sun, gb ? this.objs.get(gb)?.tex ?? null : null);
    }
    const rel = b ? new THREE.Vector3((b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M) : new THREE.Vector3();
    let sun: THREE.Vector3 | null = null, rgb: V3 = [1, 1, 1];
    if (b) {
      let f = 0;
      for (const s of stars) {
        const q = s.star!.L / ((s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2);
        if (q > f) { f = q; sun = new THREE.Vector3(s.x - P[0], s.y - P[1], s.z - P[2]).normalize(); rgb = starRGB(s.star!.teff); }
      }
    }
    this.ground.frame(dt, b, rel, stars, sun, rgb, this.giantFog());
    // the same haze over everything else down there (buildings, craft, the lander), so nothing stands out
    // crisp against a horizon the air has already taken
    const k = this.ground.fogK;
    if (k > 0) {
      if (!this.scene.fog) this.scene.fog = this.haze;
      this.haze.density = k * 0.8;
      this.haze.color.setRGB(this.ground.fogCol.r, this.ground.fogCol.g, this.ground.fogCol.b, THREE.SRGBColorSpace);
    } else if (this.scene.fog) this.scene.fog = null;
  }

  /** inside a giant's clouds: how deep into the fog (0–1) and its colour; null outside */
  giantFog(): { inside: number; fog: THREE.Color } | null { return this.giant.body && this.giant.inside > 0 ? { inside: this.giant.inside, fog: this.giant.fog } : null; }

  /** where the viewer is and which way it looks, and where the ship is drawn from there */
  private place() {
    const sh = this.ship, sq = sh.quat, cam = this.camera, f = this.foot;
    let local: THREE.Vector3 | null = null;
    if (this.mode === 'eva') {
      this.base = this.suit.nav;
      this.eye.set(0, 0, 0);
      cam.quaternion.copy(this.suit.quat);
    } else if (this.mode === 'surface') {
      this.base = this.surf.nav;
      this.eye.set(0, 0, 0);
      this.surfQuat(cam.quaternion);
    } else if (this.mode === 'inside' && this.visit.at) {
      this.visit.place(cam);
    } else if (this.mode === 'shuttle' && this.shuttle.out) {
      this.base = this.shuttle.view(cam);
      this.eye.set(0, 0, 0);
    } else if (this.mode === 'craft' && this.craftView && this.placeCraft()) {
      if (this.climbOut) this.tryClimbOut();
      // placed
    } else {
      if (this.mode === 'craft') this.mode = 'pilot';
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
    sh.hull.viewFrom(!!this.localEye || this.mode === 'scope');
    // a shudder going into the throat
    const w = sh.worm;
    this.shake = w && (w.phase === 'enter' || w.phase === 'tunnel' && w.t < 0.6) ? 0.006 : w?.phase === 'tunnel' ? 0.0015 : 0;
    // buffeted in a giant's winds
    if (!w && this.giant.inside > 0.2) this.shake = Math.max(this.shake, Math.min(0.004, Math.abs(this.giant.wind) / 60000) * this.giant.inside + this.giant.flash * 0.002);
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
    this.visit.baseLights();
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
      else this.prompt = this.visit.wayIn();
    } else if (this.mode === 'surface') {
      const foot = this.ladderFoot();
      const way = this.kit.ride ? { label: `Get off the ${this.kit.ride === 'hover' ? 'hover bike' : 'buggy'}`, act: () => { this.kit.ride = null; } } : this.visit.baseSpot() ?? this.visit.wayIn();
      this.visit.screens(dt);
      if (foot && this.ground.spec && arc(foot, this.surf.n) * this.ground.spec.R < 4.5) { this.prompt = { label: 'Climb the ladder and board', act: () => this.board() }; sh.boardable = true; }
      else if (way) this.prompt = way;
      else if (this.shuttle.near(this.surf.b, this.surf.n)) this.prompt = { label: 'Board Lander 1', act: () => this.shuttle.board() };
      else if (this.rocketNear()) { const r = this.rocketNear()!; this.prompt = { label: `The ${r.name}: load it, fly it, ride it`, act: () => this.panels.show('rocket', r.id) }; }
      else if (this.artefactNear()) { const r = this.artefactNear()!; this.prompt = { label: `Pick up ${r.art!.name}`, act: () => { this.ground.ruins.take(r); this.found(`Artefact: ${r.art!.name}`, `From ${r.name}: ${r.art!.about}`); } }; }
      else this.prompt = { label: 'Scan here', act: () => this.panels.show('scan') };
    } else if (this.mode === 'shuttle') this.prompt = this.shuttle.prompt();
    else if (this.mode === 'inside') { this.prompt = this.visit.prompt(); this.visit.screens(dt); }
    else if (this.mode === 'pilot') {
      const L = this.landing, st = !L && !this.visit.docked ? this.visit.stationNear() : null;
      if (this.visit.docked) this.prompt = { label: `Undock from ${this.visit.docked.name}`, act: () => this.visit.undock() };
      else if (st) this.prompt = { label: `Dock with ${st.name}`, act: () => this.visit.dock(st) };
      else if (L?.phase === 'landed') this.prompt = { label: 'Lift off', act: () => this.landOrLift() };
      else if (!L && !this.landBlock()) this.prompt = { label: `Land on ${this.ground.body?.name ?? 'the ground'}`, act: () => this.landOrLift() };
    }

    if (this.placer.kind) this.prompt = this.placer.prompt();
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
    h.drawScreen('bay', ['LANDING SURVEY', t ? t.name : '—', sv ? (sv.land.ok ? 'LANDABLE' : 'NO LANDING') : '', 'MISSION CONTROL', `${this.fleet.crafts.length} CRAFT OUT`]);
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
      // and keep up with a target that moves on its own (a station in its orbit, 7.7 km/s round the Earth): its
      // velocity, relative to what the ship rides with, added to the chase
      const tv: V3 = [0, 0, 0], A = n.anchor;
      if (t.at) {
        const rel: V3 = [q[0] - (A?.x ?? 0), q[1] - (A?.y ?? 0), q[2] - (A?.z ?? 0)];
        if (t.was && dt > 0) for (let k = 0; k < 3; k++) tv[k] = ((rel[k] - t.was[k]) * AU_M) / dt;
        t.was = rel;
      }
      for (let k = 0; k < 3; k++) v[k] += ((d[k] / dist) * want + tv[k] - v[k]) * Math.min(1, dt * 3);
      turnTo(sh.quat, d, dt * 3);
      if (gap < t.stop * 0.05 + 5 / AU_M || (this.mode === 'pilot' && this.controls.moving())) {
        this.travel = null;
        if (gap < t.stop * 0.05 + 5 / AU_M) v.fill(0);
        t.was = undefined;
        if (this.autoOd) { sh.od = false; this.autoOd = false; }
        if (t.land && gap < t.stop * 0.05 + 5 / AU_M) this.landOrLift();
        if (t.dock && gap < t.stop * 0.05 + 5 / AU_M) this.visit.dock(t.dock);
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
    // a giant's winds carry the ship along
    if (this.giant.body && this.giant.inside > 0) {
      const w = this.giant.windVec, k = Math.min(1, this.giant.inside) * dt / AU_M;
      n.off[0] += w.x * k; n.off[1] += w.y * k; n.off[2] += w.z * k;
    }
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
    let R = this.visR(b) + gap / AU_M + (b === this.ground.body ? this.groundUnder(b, p) / AU_M : 0);
    // into a giant, down to what the hull can take
    if (Giant.is(b)) {
      if (b !== this.giant.body || alt > -this.giant.crush + gap) return;
      R = this.visR(b) - (this.giant.crush - gap) / AU_M;
      if (performance.now() - this.crushToast > 5000) { this.crushToast = performance.now(); this.app.onToast(`The hull is at ${HULL_BAR.toLocaleString('en-US')} bar: it will go no deeper`); }
    }
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
    // low over a world with ground, its gravity pulls you down to it (the thrusters, holding you still, slow the
    // fall to a few metres a second: about six and a half on the Earth, one on the Moon)
    const near = this.nearest(posOf(s));
    if (near.b && near.b === this.ground.body && near.alt < 1e5) {
      const p = posOf(s), d = new THREE.Vector3(p[0] - near.b.x, p[1] - near.b.y, p[2] - near.b.z).normalize(), g = gravity(near.b) * dt;
      v[0] -= d.x * g; v[1] -= d.y * g; v[2] -= d.z * g;
    }
    for (let k = 0; k < 3; k++) s.off[k] += (v[k] * dt) / AU_M;
    this.clear(s, 2);
    // down onto the ground: on your feet
    const o = this.overGround(s);
    if (o && o.alt < 2.6 && !this.ground.last_sample.sea) {
      const [e, nn] = tangent(o.n), f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.suit.quat).applyQuaternion(o.q.clone().invert());
      this.toSurface(o.n, Math.atan2(-f.dot(new THREE.Vector3(...e)), f.dot(new THREE.Vector3(...nn))));
      return;
    }
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
    const cap = this.ship.cap(Math.abs(alt));
    // in a giant's clouds: a pace to match the depth, so a few minutes takes you down through the decks
    if (this.giant.body && this.giant.depth > -20e3 && this.ship.odLevel <= 0) return Math.min(cap, Math.max(300, Math.abs(this.giant.depth) * 0.25 + 300) * this.controls.throttle);
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
      : this.landing ? (this.landing.phase === 'down' ? `landing · ${this.landing.alt < 1000 ? `${Math.max(0, this.landing.alt - LAND_H).toFixed(0)} m` : `${(this.landing.alt / 1000).toFixed(1)} km`} to go` : this.landing.phase === 'up' ? 'lifting off' : `landed on ${this.landing.b.name}`)
      : this.travel ? `autopilot → ${this.travel.name}${sh.odLevel > 0 ? ` · overdrive ${(sh.odLevel * 100).toFixed(0)}%` : ''}`
      : sh.odLevel > 0 ? `overdrive ${(sh.odLevel * 100).toFixed(0)}%` : 'cruise drive';
    let where = '', speed = fmtV(v);
    if (this.mode === 'pilot') where = `At the helm · ${sh.view === 'chase' ? 'chase view' : 'cockpit'}`;
    else if (this.mode === 'inside' && this.visit.at) where = `${this.visit.at.c.name} · ${this.visit.room()}`;
    else if (this.mode === 'walk') where = this.sleep ? 'Asleep in the quarters' : this.foot.seat ? 'On the couch' : `On foot · ${this.room()}`;
    else if (this.mode === 'scope') where = `Telescope · ×${(70 / this.scope.fov).toFixed(this.scope.fov > 7 ? 1 : 0)}${this.scope.track ? ' · tracking' : ''}`;
    else if (this.mode === 'shuttle') {
      where = `🚀 Lander 1 · ${this.shuttle.status()}`;
      speed = `${Math.hypot(...this.shuttle.nav.vel).toFixed(1)} m/s`;
    }
    else if (this.mode === 'craft') {
      const c = this.craftView ? this.fleet.byId(this.craftView.id) : null;
      where = c ? `${c.name} · ${c.b.name} · ${c.status}` : 'Craft';
      if (c?.kind === 'rover') speed = `${(Math.abs(c.drive.f) * 3).toFixed(1)} m/s · ${(c.odo / 1000).toFixed(2)} km driven`;
      else if (c?.state === 'descent') speed = `${(c.alt / 1000).toFixed(1)} km up · falling ${c.vz.toFixed(0)} m/s`;
      else if (c?.orbit) speed = `${((c.orbit.r - c.b.r * AU_M) / 1000).toFixed(0)} km orbit`;
    }
    else if (this.mode === 'surface') {
      const S = this.surf, [la, lo] = latLonOf(S.n);
      where = `On ${S.b?.name ?? 'the ground'} · ${Math.abs(la).toFixed(3)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(3)}°${lo >= 0 ? 'E' : 'W'}`;
      speed = `${S.speed.toFixed(1)} m/s ${this.kit.ride === 'buggy' ? 'in the buggy' : this.kit.ride === 'hover' ? 'on the hover bike' : this.kit.jet && S.y > 0.5 ? `on the jetpack, ${S.y.toFixed(0)} m up` : 'on foot'}`;
    }
    else {
      const d = relM(this.suit.nav, sh.nav).length();
      where = `Spacewalk · ${d < 1000 ? `${d.toFixed(0)} m` : fmtLength(d / AU_M)} from the ship`;
      const rv = Math.hypot(this.suit.nav.vel[0] - sh.nav.vel[0], this.suit.nav.vel[1] - sh.nav.vel[1], this.suit.nav.vel[2] - sh.nav.vel[2]);
      speed = `${fmtV(rv)} suit`;
    }
    let near = b ? `${b.name} · ${fmtLength(Math.max(0, alt) / AU_M)} up` : '';
    // on or over a world's ground: the conditions there
    const G = this.ground;
    if (G.body && G.atmo && (this.mode === 'surface' || (b === G.body && alt < 50e3))) {
      const g = gravity(G.body) / 9.81, a = G.atmo;
      const z = this.mode === 'surface' ? G.heightAt(this.surf.n, 1) : Math.max(0, alt);
      const bar = a.bar > 0 && a.H > 0 ? a.bar * Math.exp(-Math.max(0, z) / (a.H * 1000)) : a.bar;
      near = `${this.mode === 'surface' ? `${z.toFixed(0)} m elevation` : `${G.body.name} · ${fmtLength(Math.max(0, alt) / AU_M)} up`} · ${g.toFixed(g < 0.1 ? 3 : 2)} g · ${bar > 1e-4 ? `${bar.toPrecision(3)} bar` : 'vacuum'} · ${Math.round(a.T - 273.15)} °C${G.daylight < 0.2 ? ' · night' : ''}`;
    }
    const gs = this.giant.status();
    if (gs) near = gs;
    return {
      mode: this.mode, where, speed, drive, target: tgt,
      near, suit: this.kit.line(),
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
      // a white hole pours out light and matter: a blinding surface, blue-white, in a wide glare
      o.mat = starMaterial(false, 60000, ((b.look.seed % 997) + 0.5) / 997);
      group.add(new THREE.Mesh(this.sphere, o.mat));
      group.add(this.glow(0xdde8ff, 14));
    } else if (b.look.wormhole) {
      o.kind = 'worm';
      const m = mouthMesh(this.glowTex);
      m.name = 'mouth';
      group.add(m);
    } else if (b.cls === 'bh') {
      o.kind = 'hole';
      o.hole = new HoleLook(this.glowTex, this.skyCube());
      group.add(o.hole.group);
    } else if (b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns') {
      o.kind = 'star';
      // a true star's surface boils (star.ts); a white dwarf's or a neutron star's is a plain glare
      const live = starMaterial(b.name === 'Sun' || b.look.real === 'Sun', this.teffOf(b), ((b.look.seed % 997) + 0.5) / 997);
      if (live) o.mat = live;
      group.add(new THREE.Mesh(this.sphere, live ?? new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })));
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
          lightL: { value: new THREE.Vector3(1, 0, 0) }, ringProf: { value: null }, ringIn: { value: 0 }, ringOut: { value: 0 },
          time: { value: 0 }, gas: { value: o.map.gas ? 1 : 0 }, vortex: { value: new THREE.Vector4(...(VORTEX[b.look.real ?? ''] ?? [0, 0, 0, 0])) },
          craterK: { value: 0 }, rad: { value: 1 },
          seaLevel: { value: b.look.real === 'Earth' || (!b.look.real && (b.look.style === 'terran' || b.look.style === 'ocean')) ? 0.5 : -1 },
          ...this.lights.uniforms,
        },
      });
      o.surf = new THREE.Mesh(this.sphere, o.mat);
      group.add(o.surf);
      // the same, with the ground below the map's grain: for when the world is near (one more shader, compiled the first
      // time), with craters (CRATERS) on a world that keeps them: old airless ground all the way down; under air,
      // weathered away (Mars' thin air leaves some; the Earth's, Venus' and Titan's none); Io's lava covers them
      if (!o.map.gas) {
        const bar = atmosphere(b, this.stars()).bar;
        o.craterK = b.look.real === 'Io' || b.look.style === 'lava' ? 0 : bar > 0.05 ? 0 : bar > 1e-3 ? 0.5 : 1;
        o.near = new THREE.ShaderMaterial({ vertexShader: WORLD_VERT, fragmentShader: FRAG, defines: o.craterK ? { CLOSE: '', CRATERS: '' } : { CLOSE: '' }, uniforms: o.mat.uniforms });
        o.mat.uniforms.craterK.value = o.craterK;
      }
      if (o.map.cloud) {
        const cm = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          uniforms: { aux: { value: o.aux }, lightDir: o.mat.uniforms.lightDir, lightCol: o.mat.uniforms.lightCol, drift: { value: 0 }, fade: { value: 1 }, ...this.lights.uniforms },
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
          uniforms: {
            prof: { value: pt }, rIn: { value: rg.inner }, rOut: { value: rg.outer }, col: { value: new THREE.Vector3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255) },
            lightCol: { value: new THREE.Vector3(1, 1, 1) }, time: o.mat.uniforms.time, spokes: { value: b.look.real === 'Saturn' ? 1 : 0 },
            lightL: o.mat.uniforms.lightL,
          },
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(rg.inner, rg.outer, 160, 1), rm);
        ring.name = 'rings';
        group.add(ring);
        o.mat.uniforms.ringProf.value = pt;
        o.mat.uniforms.ringIn.value = rg.inner;
        o.mat.uniforms.ringOut.value = rg.outer;
      }
    }
    return o;
  }

  /**
   * the glare round a bright body, `k` of its radii out: a shell round it whose every pixel works out how
   * near its line of sight passes the body, so it is right from any distance, inside it or out
   * (a sprite that size misdraws close up)
   */
  private glow(color: number, k: number) {
    const m = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { col: { value: new THREE.Color(color) }, camL: { value: new THREE.Vector3() }, K: { value: k }, strength: { value: 1 } },
    });
    const s = new THREE.Mesh(this.sphere, m);
    s.scale.setScalar(k);
    s.frustumCulled = false;
    s.name = 'glow';
    return s;
  }

  /** point a body's glare at the eye: the eye in the body's own units */
  private aimGlow(g: THREE.Group, glow: THREE.Mesh, r: number, gg: number, b: number) {
    const u = (glow.material as THREE.ShaderMaterial).uniforms;
    (u.col.value as THREE.Color).setRGB(r, gg, b);
    g.updateMatrixWorld(true);
    (u.camL.value as THREE.Vector3).copy(g.worldToLocal(this.camera.getWorldPosition(new THREE.Vector3())));
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
      if (o.mat) tickStar(o.mat, b.name === 'Sun' || b.look.real === 'Sun', this.teffOf(b), performance.now() / 1000);
      else (mesh.material as THREE.MeshBasicMaterial).color.setRGB(c[0], c[1], c[2]);
      const glow = g.children[1] as THREE.Mesh;
      g.scale.setScalar(Rm);
      if (b.name === 'Sun' || b.look.real === 'Sun') this.aimGlow(g, glow, 1, 0.78, 0.42);
      else this.aimGlow(g, glow, c[0], c[1], c[2]);
      this.surrounds(b, o, Rm);
      return;
    }
    if (o.kind === 'white' && o.mat) { tickStar(o.mat, false, 60000, performance.now() / 1000); g.scale.setScalar(Rm); this.aimGlow(g, g.children[1] as THREE.Mesh, 0.86, 0.91, 1); }
    if (o.kind === 'worm') tickMouth(g.getObjectByName('mouth') as THREE.Group, performance.now() / 1000, 1);
    if (o.kind !== 'world') {
      g.scale.setScalar(Rm);
      if (o.kind === 'hole') this.hole(b, o);
      return;
    }
    // a world: the best map for how big it looks (they arrive from the painter as they are ready), its turning frame, its light, its craters
    const px = (Rm / Math.max(1, g.position.length())) / (Math.tan((this.camera.fov * Math.PI) / 360) / (window.innerHeight / 2));
    // up to 2048 across when a world fills the view
    const want = MapService.widthFor(px * 2, 2048);
    // near enough that the map's finest grain is bigger than a pixel (straight below you it is, within a
    // couple of radii up, before the world looks big): the shader with the ground below the grain
    if (o.near && o.surf) {
      // (not once the ground is built round you: it covers the world to the horizon, and the sphere under it, hidden,
      // would still be shaded pixel by pixel)
      const near = (px > 650 || g.position.length() < 3 * Rm) && !(this.ground.body === b && this.ground.ready);
      o.surf.material = near ? o.near : o.mat!;
      if (near) o.mat!.uniforms.rad.value = Rm;
    }
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
    // with its ground built round you, the sphere sinks out of the way under it; the clouds come down to weather height
    const under = this.ground.body === b && this.ground.ready && this.ground.spec ? this.ground.spec.relief * 0.8 + 50 : 0;
    g.scale.setScalar(Rm - under);
    if (o.clouds) {
      o.clouds.scale.setScalar(under ? (Rm + 7000) / (Rm - under) : 1.008);
      // up a mountain, level with the cloud deck: it thins round you rather than standing edge-on like a wall
      const off = Math.abs(g.position.length() - Rm - 7000), t = Math.max(0, Math.min(1, (off - 600) / 2400));
      (o.clouds.material as THREE.ShaderMaterial).uniforms.fade.value = under ? t * t * (3 - 2 * t) : 1;
    }
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
      (u.lightL.value as THREE.Vector3).copy(u.lightDir.value as THREE.Vector3).applyQuaternion(g.quaternion.clone().invert());
    } else u.lit.value = 0;
    // a surface glows only once it is molten; a warm one (tidally heated Io) shows it at its volcanoes
    u.heat.value = Math.max(0, (b.heat - 0.55) / 0.45);
    // the weather's clock: wrapped at a whole number of its cycles, so the shader's floats stay fine
    u.time.value = (performance.now() / 1000) % 4800;
    u.gas.value = o.map!.gas ? 1 : 0;
    if (b.look.atmo !== undefined) {
      const a = b.look.atmo;
      (u.atmo.value as THREE.Vector3).set(((a >> 16) & 255) / 255, ((a >> 8) & 255) / 255, (a & 255) / 255);
      u.hasAtmo.value = 1;
    } else u.hasAtmo.value = 0;
  }

  /**
   * the sky at infinity as a cube map, made once: what a black hole's traced rays look up along their bent
   * paths, so the stars behind it are lensed and its shadow is a hole in them
   */
  private skyCubeTex: THREE.CubeTexture | null = null;
  /** the Milky Way: the faint glow behind the stars */
  private galaxy: THREE.Mesh;
  private skyCube() {
    if (!this.skyCubeTex) {
      const rt = new THREE.WebGLCubeRenderTarget(1024, { generateMipmaps: false });
      const cc = new THREE.CubeCamera(1e16, 1e19, rt);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      const pts = new THREE.Points(this.sky.geometry, this.sky.material);
      pts.frustumCulled = false;
      const gal = new THREE.Mesh(this.galaxy.geometry, this.galaxy.material);
      gal.frustumCulled = false;
      gal.renderOrder = -3;
      scene.add(gal, pts);
      cc.update(this.renderer, scene);
      this.skyCubeTex = rt.texture;
    }
    return this.skyCubeTex;
  }

  /** a star's temperature for its look: a neutron star's surface is a million degrees, an X-ray glare */
  private teffOf(b: Body) { return b.cls === 'ns' ? 6e5 : b.star?.teff ?? (b.cls === 'wd' ? 25000 : 5772); }

  /** what is round a star: a nebula's shell, a pulsar's beams, a young star's dusty disc (`Rm`: its radius, m, the group's scale) */
  private surrounds(b: Body, o: Obj, Rm: number) {
    const now = performance.now() / 1000;
    const res = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (b.look.pulsar) {
      if (!o.beams) { o.beams = new PulsarLook(!!b.look.magnetar); o.group.add(o.beams.group); }
      const axis = new THREE.Vector3(...bodyAxis(b));
      // its beams turned at the speed it spins, slowed to something the eye can follow (a pulsar's thirty turns a second would strobe)
      const period = Math.max(b.look.magnetar ? 5 : 1.6, 2 * Math.PI / Math.max(1e-9, Math.abs(b.spin)));
      o.beams.update(axis, (now / period) * 2 * Math.PI, this.camera, res, now % 4200);
    }
    if (b.kind === 'pne' || b.kind === 'snr') {
      if (!o.shellT || now - o.shellT > 4) {
        o.shellT = now;
        const ds: number[] = [];
        for (const p of this.app.world.bodies) if (p.alive && p.isParticle) ds.push(Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z));
        ds.sort((u, v) => u - v);
        o.shellR = ds.length > 30 ? ds[Math.floor(ds.length * 0.6)] : 0;
      }
      if (o.shellR) {
        if (!o.neb) { o.neb = new NebulaLook(b.kind); o.group.add(o.neb.mesh); }
        o.neb.mesh.visible = true;
        o.neb.update((o.shellR * AU_M) / Rm, this.camera, res, now);
      } else if (o.neb) o.neb.mesh.visible = false;
    }
    if (b.kind === 'ppdisc') {
      if (!o.dust) { o.dust = new DustDisc((0.3 * AU_M) / Rm, (30 * AU_M) / Rm); o.group.add(o.dust.mesh); }
      const c = starRGB(this.teffOf(b));
      o.dust.update(new THREE.Vector3(0, 0, 1), [0.75 + 0.25 * c[0], 0.75 + 0.25 * c[1], 0.75 + 0.25 * c[2]], now);
    }
  }

  /**
   * a black hole: its traced shadow, ring and disc (hole.ts), drawn at its own scale (the horizon
   * radius), the disc reaching out to whatever gas is round it, bright as it is fed
   */
  private hole(b: Body, o: Obj) {
    const look = o.hole!, rs = schwarzschild(b.m);
    o.group.scale.setScalar(rs * AU_M);
    // (its place this frame, so the eye is found in its frame as it is drawn)
    o.group.updateMatrixWorld(true);
    // the disc's extent: out to most of the gas round it (measured now and then), at least the bright inner disc
    const now = performance.now();
    if (!o.holeT || now - o.holeT > 4000) {
      o.holeT = now;
      const ds: number[] = [];
      // (only gas bound to the hole: going round it, not flying past)
      const GM = 4 * Math.PI * Math.PI * b.m;
      for (const p of this.app.world.bodies) {
        if (!p.alive || !p.isParticle) continue;
        const r = Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z), d = r / rs;
        const v2 = (p.vx - b.vx) ** 2 + (p.vy - b.vy) ** 2 + (p.vz - b.vz) ** 2;
        if (d < 3e6 && v2 < 2 * GM / r) ds.push(d);
      }
      ds.sort((x, y) => x - y);
      // (traced out to 120 horizons at most: the gas further out is drawn as itself, a glowing torus)
      look.setOuter(ds.length > 30 ? Math.max(16, Math.min(120, ds[Math.floor(ds.length * 0.85)])) : 16);
    }
    // its disc as it has built up from what it has actually swallowed (physics/feeding.ts): none round a hole
    // that has eaten nothing, growing over a meal, fading after; a fed nucleus starts with it in place
    const st = this.app.feeding.get(b);
    const glow = st?.level ?? 0, jet = st?.jet ?? 0;
    const axis = new THREE.Vector3(...(st?.axis ?? [0, 0, 1]));
    // stellar holes' discs are hotter (X-ray bright); a quasar's runs cooler at the same brightness
    const hue = b.m < 1e3 ? 1 : 0.4;
    look.update(axis, glow, jet, this.camera, this.renderer.getDrawingBufferSize(new THREE.Vector2()), (now / 1000) % 4200, hue);
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
    // near a world's ground, what is below its horizon is hidden by it
    const gb = this.ground.body, up = new THREE.Vector3();
    let dip = -2;
    if (gb) {
      up.set(P[0] - gb.x, P[1] - gb.y, P[2] - gb.z);
      const r = up.length();
      up.normalize();
      dip = -Math.sqrt(Math.max(0, 1 - (gb.r / r) ** 2)) - 0.01;
    }
    // a bright sky hides the names of what it hides: only what shows as a disc (or the selection) keeps its label
    const glare = gb ? this.ground.glare : 0, tanPx = Math.tan((cam.fov * Math.PI) / 360) / (H / 2);
    for (const { b } of cands) {
      v.set((b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M);
      if (gb && b !== gb && dir.copy(v).normalize().dot(up) < dip) continue;
      if (glare > 0.25 && b !== this.app.selected && b.cls !== 'star' && this.visR(b) * AU_M / Math.max(1, v.length()) / tanPx < 2.5) continue;
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
    // on the ground: the sites and towns near you; the craft
    for (const l of [...this.ground.labels(), ...this.fleet.labels(P)]) {
      if (eye && !hull.seesOut(eye, dir.copy(l.at).normalize().applyQuaternion(inv))) continue;
      v.copy(l.at).project(cam);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      want.add(l.key);
      let el = this.labelEls.get(l.key);
      if (!el) { el = document.createElement('div'); el.className = l.key.startsWith('craft') ? 'lbl craft' : 'lbl site'; this.labels.appendChild(el); this.labelEls.set(l.key, el); }
      if (el.textContent !== l.text) el.textContent = l.text;
      el.style.left = `${((v.x + 1) / 2) * W + 8}px`;
      el.style.top = `${((1 - v.y) / 2) * H}px`;
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
    // the height in two bytes (red the high, alpha the low), so the relief shades smoothly close up rather than in terraces
    const h = Math.round(Math.max(0, Math.min(1, m.height[k])) * 65535);
    x[k * 4] = h >> 8; x[k * 4 + 1] = m.cloud ? m.cloud[k] * 255 : 0; x[k * 4 + 2] = m.spec[k] * 255; x[k * 4 + 3] = h & 255;
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
  // smooth and falling off fast, as light scattered round a bright thing does: no blocks, no grey wash
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [t, a] of [[0, 1], [0.1, 0.62], [0.2, 0.3], [0.32, 0.13], [0.5, 0.045], [0.75, 0.012], [1, 0]]) gr.addColorStop(t, `rgba(255,255,255,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** the sky at infinity: stars in their real spread of colour and brightness */
/**
 * The Milky Way across the sky: the faint band of the galaxy's disc seen from inside it, brightest toward
 * its centre (in Sagittarius, ecliptic longitude 266°, latitude −5.5°; its pole at 180°, +30°), crossed by
 * dark lanes of dust. Faint, as it is: it is what a black hole's shadow shows up against.
 */
function milkyWay() {
  const D = Math.PI / 180;
  const dir = (lon: number, lat: number) => new THREE.Vector3(Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D));
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { pole: { value: dir(180, 30) }, centre: { value: dir(266, -5.5) } },
    vertexShader: /* glsl */ `
      varying vec3 vD;
      void main() { vD = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 pole;
      uniform vec3 centre;
      varying vec3 vD;
      float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vnoise3(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      void main() {
        vec3 d = normalize(vD);
        float b = asin(clamp(dot(d, pole), -1.0, 1.0));
        float toC = dot(d, centre);
        float n = vnoise3(d * 6.0) * 0.5 + vnoise3(d * 14.0) * 0.3 + vnoise3(d * 35.0) * 0.2;
        float band = exp(-pow(b / 0.16, 2.0)) * (0.55 + 0.8 * n) + exp(-pow(b / 0.45, 2.0)) * 0.18;
        float bulge = exp(-pow(acos(clamp(toC, -1.0, 1.0)) / 0.35, 2.0)) * 0.9;
        // dust lanes: dark filaments running along the band, not blobs
        vec3 e1 = normalize(cross(pole, centre)), e2 = cross(e1, pole);
        float l = atan(dot(d, e1), dot(d, e2));
        float fil = vnoise3(vec3(cos(l) * 5.0, sin(l) * 5.0, b * 60.0)) * 0.7 + vnoise3(vec3(cos(l) * 13.0, sin(l) * 13.0, b * 140.0)) * 0.3;
        float lanes = 1.0 - 0.55 * smoothstep(0.5, 0.72, fil) * exp(-pow(b / 0.07, 2.0));
        float I = (band * (0.6 + 0.6 * max(toC, 0.0)) + bulge) * lanes * 0.045;
        gl_FragColor = vec4(vec3(0.95, 0.88, 0.78) * I, 1.0);
      }`,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), m);
  s.frustumCulled = false;
  s.renderOrder = -3;
  return s;
}

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
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false }));
  p.frustumCulled = false;
  return p;
}

function dispose(o: Obj) {
  o.group.traverse(x => {
    const m = x as THREE.Mesh;
    if (m.geometry && m.geometry.type !== 'SphereGeometry') m.geometry.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat && o.kind === 'star' && mat === o.mat) dropStar(o.mat);
    else if (mat) mat.dispose();
    // a ring's profile lives in a uniform, which disposing the material leaves alone
    if (mat instanceof THREE.ShaderMaterial) (mat.uniforms.prof?.value as THREE.Texture | undefined)?.dispose();
  });
  o.tex?.dispose();
  o.aux?.dispose();
  o.hole?.dispose();
  o.neb?.dispose(); o.beams?.dispose(); o.dust?.dispose();
}


/** where a mover is, AU */
export function posOf(m: Mover): V3 {
  const a = m.anchor;
  return [(a?.x ?? 0) + m.off[0], (a?.y ?? 0) + m.off[1], (a?.z ?? 0) + m.off[2]];
}

/** from one mover to another, m, as exactly as the numbers allow */
export function relM(m: Mover, from: Mover) {
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
