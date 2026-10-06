import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M } from '../physics/units';
import { bodyFrame, type V3 } from '../pixel/sprites';
import { bodyAxis } from '../pixel/renderer';
import { groundSpec, groundAt, tangent, groundPainter, type GroundSpec, type GroundSample } from './terrain';
import { TileSet } from './tiles';
import { FormSet, type Form } from './landforms';
import { earthAnimal, alienAnimal, type Beast } from './fauna';
import { Flora, type PlantKind } from './flora';
import { Grass } from './grass';
import { Ruins } from './ruins';
import { detailFor } from '../pixel/surface';
import { LIGHT_GLSL } from './lightglsl';
import { atmosphere, life, gravity, rng, type Atmosphere, type Life } from './science';
import { sitesOn, earthBiome, speciesIn, type Site, type Biome } from './sites';
import { apolloMesh, flagMesh, lrvMesh, landerMesh, roverMesh, veneraMesh, huygensMesh, probeMesh, alienMesh } from './craftmesh';

/**
 * The ground of the world you are near, and the sky over it.
 *
 * Within a few hundred kilometres of a solid world the sphere it is drawn as
 * gives way to terrain (terrain.ts): fixed tiles built in workers (tiles.ts),
 * fine underfoot and coarse at the horizon, the same ground wherever you
 * stand. It is
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

/** how many cave ramps the ground's shader cuts out at once */
const CAVE_RAMPS = 24;
const ramps = () => Array.from({ length: CAVE_RAMPS }, () => new THREE.Vector3());

const FRAG_NOISE = /* glsl */ `
// (a hash without the streaks the simpler ones leave at high frequencies: Dave Hoskins' hash13)
float h3(vec3 p) { p = mod(p, 289.0); vec3 q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

const GROUND_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float sea;
attribute float rock;
attribute vec3 grain;
attribute vec3 far;
#ifdef CAVE
attribute float sky;
varying float vSky;
#endif
varying vec3 vN;
varying vec3 vP;
varying vec3 vCol;
varying float vSea;
varying vec3 vLocal;
varying vec3 vFar;
varying float vRock;
// the ground's tangent directions: in its own frame (where the texture lies) and in the view's (where the light falls)
varying vec3 vT1;
varying vec3 vT2;
varying vec3 vW1;
varying vec3 vW2;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vCol = color;
  vSea = sea;
  vLocal = position + grain;
  vFar = position + far;
  vRock = rock;
  vT1 = normalize(cross(normal, abs(normal.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vT2 = cross(normal, vT1);
  vW1 = normalize(mat3(modelMatrix) * vT1);
  vW2 = normalize(mat3(modelMatrix) * vT2);
  #ifdef CAVE
  vSky = sky;
  #endif
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
uniform float lush;
uniform vec3 leaf;
uniform float alien;
// what the ground is made of, close up (KIND, set per world: one shader each, so none carries the others' code)
#ifndef KIND
#define KIND 0
#endif
// how cratered the ground is, seen from the air (CRATERS where it is at all)
uniform float craterK;
// the ramps down into the caves near: each a segment of floor (A to B) under the cave's up U, with its
// half width, the height of its roof's arch and of the arch's centre over the floor (in S); the land
// inside their air is cut away
#define CAVE_RAMPS 24
uniform int caveN;
uniform vec3 caveA[CAVE_RAMPS];
uniform vec3 caveB[CAVE_RAMPS];
uniform vec3 caveU[CAVE_RAMPS];
uniform vec3 caveS[CAVE_RAMPS];
${LIGHT_GLSL}
varying vec3 vN;
varying vec3 vP;
varying vec3 vCol;
varying float vSea;
varying vec3 vLocal;
varying vec3 vFar;
varying float vRock;
varying vec3 vT1;
varying vec3 vT2;
varying vec3 vW1;
varying vec3 vW2;
#ifdef CAVE
varying float vSky;
#endif
${FRAG_NOISE}
void main() {
  #include <logdepthbuf_fragment>
  #ifndef CAVE
  // the land over a cave's ramp is not there: the ramp's air is (caves.ts, inRamp)
  for (int i = 0; i < CAVE_RAMPS; i++) {
    if (i >= caveN) break;
    vec3 U = caveU[i], AB = caveB[i] - caveA[i], v = vP - caveA[i];
    vec3 abh = AB - U * dot(AB, U), vh = v - U * dot(v, U);
    float t = clamp(dot(vh, abh) / max(dot(abh, abh), 1e-6), 0.0, 1.0);
    vec3 r = v - AB * t;
    float dy = dot(r, U), dh = length(r - U * dy);
    vec3 S = caveS[i];
    float ex = dh / S.x, ey = (dy - S.z) / S.y;
    if (dy > 0.0 && ex * ex + ey * ey < 1.0) discard;
  }
  #endif
  vec3 N = normalize(vN);
  // how much of the sky (and the sun) reaches here: all of it on open ground, little deep in a cave
  float sky = 1.0;
  #ifdef CAVE
  sky = vSky;
  if (!gl_FrontFacing) N = -N;
  #endif
  float d = length(vP);
  vec3 V = -vP / max(d, 1e-3);
  #ifdef HIGH
  // ---- from the air (HIGH: a couple of km up and more, where nothing near shows): the ground below the tiles'
  // grain, hills and hollows from kilometres down to tens of metres, and on old airless ground craters, each
  // octave coming in once it spans a few pixels; its slope tilts the light and it mottles the colour
  float fwm = max(length(fwidth(vFar)), 1e-3), br = 0.0, Hh = 0.0, amp = 1.0;
  // (frequencies a whole number of times round the far lattice's period, 2^20 m, so the tiles meet)
  float fq = floor(1048576.0 / 4000.0) / 1048576.0;
  for (int k = 0; k < 4; k++) {
    float vis = 1.0 - smoothstep(0.12, 0.35, fq * fwm);
    float v = n3(vFar * fq + float(k) * 7.0) - 0.5;
    Hh += v * amp * vis * 0.1 / fq;
    br += v * amp * vis;
    fq = floor(fq * 3.1 * 1048576.0) / 1048576.0;
    amp *= 0.75;
  }
  #ifdef CRATERS
  fq = floor(1048576.0 / 40000.0) / 1048576.0;
  for (int k = 0; k < 4; k++) {
    float vis = 1.0 - smoothstep(0.06, 0.2, fq * fwm);
    vec3 q = vFar * fq, i = floor(q);
    float there = step(h3(i + float(k) * 17.0), 0.5);
    vec3 c = i + 0.35 + 0.3 * vec3(h3(i + 1.3), h3(i + 2.7), h3(i + 5.1));
    float r = 0.1 + 0.2 * h3(i + 9.2) * h3(i + 9.2), dd = length(q - c) / r;
    float bowl = dd < 1.0 ? -(1.0 - dd * dd) * 0.55 : 0.0, rim = exp(-(dd - 1.0) * (dd - 1.0) / 0.05) * 0.22;
    Hh += vis * there * (bowl + rim) * r / fq * craterK;
    br += vis * there * (rim * 2.0 + bowl * 0.4) * craterK;
    fq = floor(fq * 2.6 * 1048576.0) / 1048576.0;
  }
  #endif
  vec3 col = vCol * (1.0 + clamp(br, -1.0, 1.0) * 0.14 * (1.0 - vSea));
  #else
  // close up, the grain of the ground: pebbles, dust, scuffs
  float near = 1.0 - smoothstep(20.0, 600.0, d);
  float g1 = n3(vLocal * 1.0), g2 = n3(vLocal * 0.125), g3 = n3(vLocal * 7.0);
  vec3 col = vCol * (1.0 + ((g1 - 0.5) * 0.3 + (g3 - 0.5) * 0.25 * (1.0 - smoothstep(2.0, 30.0, d))) * near + (g2 - 0.5) * 0.18);
  #endif
  #ifndef CAVE
  // grass, where the ground is grassy (grass.ts makes the same test for its tufts): on the Earth ground with more
  // green than red or blue, elsewhere ground the colour of the plants; never on a cliff
  #ifdef GRASS
  if (lush > 0.0 && vSea < 0.5) {
    float gw;
    if (alien < 0.5) gw = smoothstep(0.012, 0.055, vCol.g - max(vCol.r, vCol.b));
    else gw = 1.0 - smoothstep(0.06, 0.2, length(vCol / (vCol.r + vCol.g + vCol.b + 1e-4) - leaf / (leaf.r + leaf.g + leaf.b + 1e-4)));
    gw *= lush * smoothstep(0.7, 0.88, dot(N, seaUp)) * (1.0 - smoothstep(150.0, 2500.0, d));
    if (gw > 0.0) {
      // drier and lusher patches a few metres across
      float pa = n3(vLocal * 0.23), pb = n3(vLocal * 0.71 + 17.0);
      vec3 gc = col * mix(vec3(1.12, 1.04, 0.78), vec3(0.86, 1.1, 0.92), pa);
      // the blades: a fine speckle of lit tips and dark gaps, finer still close by
      float bl = n3(vLocal * 9.0) * 0.6 + n3(vLocal * 27.0 + 3.0) * 0.4 * (1.0 - smoothstep(3.0, 25.0, d));
      gc *= mix(1.0, 0.7 + 0.6 * bl, 1.0 - smoothstep(6.0, 80.0, d));
      // here and there the soil shows through
      gc = mix(gc, col * vec3(0.95, 0.8, 0.62), smoothstep(0.78, 0.88, pb) * 0.55);
      // seen at a glance grass looks denser and lighter
      gc = mix(gc, gc * 1.22 + vec3(0.015, 0.025, 0.0), pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.5);
      col = mix(col, gc, gw);
    }
  }
  #endif
  #endif
  // ---- the ground close up: what it is made of, in relief, lit pixel by pixel
  vec3 Nd = N;
  float glint = 0.0;
  #ifdef HIGH
  if (vSea < 0.5) {
    vec3 px = dFdx(vFar), py = dFdy(vFar);
    vec2 ta = vec2(dot(px, vT1), dot(px, vT2)), tb = vec2(dot(py, vT1), dot(py, vT2));
    float det = ta.x * tb.y - ta.y * tb.x, hx = dFdx(Hh), hy = dFdy(Hh);
    vec2 g = abs(det) > 1e-9 ? vec2(hx * tb.y - hy * ta.y, ta.x * hy - tb.x * hx) / det : vec2(0.0);
    g *= min(1.0, 1.5 / max(length(g), 1e-6));
    Nd = normalize(N - vW1 * g.x - vW2 * g.y);
  }
  #else
  float closeK = 1.0 - smoothstep(40.0, 160.0, d);
  if (closeK > 0.0 && vSea < 0.5) {
    // bare rock where it is steep or rough; else the world's own ground: regolith, sand, ice, soil or lava rock
    float steep = 1.0 - smoothstep(0.62, 0.86, dot(N, seaUp));
    float rk = clamp(max(steep, smoothstep(0.45, 0.85, vRock) * 0.8), 0.0, 1.0);
    vec3 up = normalize(cross(vT1, vT2));
    // the relief: a height field (m) from grit to stones, its slope tilting the light. It is sampled once a
    // pixel and its slope found from how it changes to the next pixel (finite differences took three samples,
    // too many for a software renderer); the finer bumps only where they can be seen
    #if KIND != 2
    float sn = n3(vLocal * 2.3 + 11.0);
    #else
    float sn = 0.0;
    #endif
    float stones = smoothstep(0.7, 0.76, sn);
    // (pebbles where the mottling's finest noise peaks, so they are among its bumps)
    float pebbles = smoothstep(0.66, 0.7, g3);
    float loose = 1.0 - rk;
    #if KIND == 2
    float amp = 0.05;
    #elif KIND == 1
    float amp = 0.06;
    #else
    float amp = 0.11;
    #endif
    // (clods and hummocks — the same noise as the ground's mottling, so its darker patches are its rises —
    // stones' worth of bumps, then grit that only shows at your feet)
    float H = (g1 * 0.3 + g3 * 0.22) * amp;
    if (d < 100.0) H += n3(vLocal * 11.0) * 0.14 * amp * (1.0 - smoothstep(50.0, 100.0, d));
    if (d < 12.0) H += n3(vLocal * 29.0) * 0.06 * amp * (1.0 - smoothstep(3.0, 12.0, d));
    // stones stand up out of loose ground; lava rock is pitted with gas bubbles
    // (raised from where the stone begins, so its edge is not a step)
    #if KIND != 2
    H += (sn - 0.66) * 0.18 * smoothstep(0.66, 0.74, sn) * loose;
    #endif
    #if KIND == 4
    float pn = n3(vLocal * 9.0 + 3.0), pits = smoothstep(0.74, 0.8, pn);
    H -= (pn - 0.74) * 0.04 * pits;
    #endif
    // its slope along the ground's two tangents, from its change across the pixel and the ground's
    vec3 px = dFdx(vLocal), py = dFdy(vLocal);
    vec2 ta = vec2(dot(px, vT1), dot(px, vT2)), tb = vec2(dot(py, vT1), dot(py, vT2));
    float det = ta.x * tb.y - ta.y * tb.x, hx = dFdx(H), hy = dFdy(H);
    vec2 g = abs(det) > 1e-14 ? vec2(hx * tb.y - hy * ta.y, ta.x * hy - tb.x * hx) / det : vec2(0.0);
    g *= min(1.0, 2.0 / max(length(g), 1e-6));
    #if KIND == 1
    {
      // sand: ripples across the wind, a few centimetres high, wandering
      vec3 wind = normalize(vec3(0.8, 0.35, 0.49));
      float w1 = dot(vLocal, wind) * 2.4 + n3(vLocal * 0.35) * 5.0;
      // (gone by eighty metres: further off they would line up into stripes)
      float rip = (1.0 - rk) * (1.0 - smoothstep(25.0, 80.0, d));
      g += vec2(dot(vT1, wind), dot(vT2, wind)) * cos(w1) * 0.3 * rip;
      col *= 1.0 + 0.04 * sin(w1) * rip;
    }
    #endif
    #if KIND == 2
    {
      // ice: smooth, cracked in long lines, glittering where the sun catches a facet
      float cr = 1.0 - smoothstep(0.0, 0.025, abs(n3(vLocal * vec3(0.45, 0.5, 0.4)) - 0.5));
      col *= 1.0 - 0.28 * cr * (1.0 - smoothstep(20.0, 120.0, d));
      glint = step(0.985, h3(floor(vLocal * 9.0))) * (1.0 - smoothstep(5.0, 40.0, d));
    }
    #endif
    #if KIND == 4
    col *= 0.92 - 0.3 * pits;
    #endif
    // stones and pebbles strewn on loose ground: a little darker or paler than it, standing up out of it
    #if KIND != 2
    {
      float tone = h3(floor(vLocal * 2.3) + 40.0);
      col = mix(col, col * mix(0.62, 1.22, tone), stones * 0.75 * loose);
      col = mix(col, col * mix(0.7, 1.15, h3(floor(vLocal * 7.1))), pebbles * 0.5 * loose * (1.0 - smoothstep(10.0, 60.0, d)));
    }
    #endif
    // rock: in layers, the strata of its laying-down, and cracked
    if (rk > 0.0) {
      float lay = dot(vLocal, up) * 1.1 + g2 * 7.0;
      float strata = sin(lay) * 0.5 + 0.5, fine = sin(lay * 4.7 + g1 * 3.0);
      float crack = 1.0 - smoothstep(0.0, 0.03, abs(n3(vLocal * vec3(0.7, 0.35, 0.7)) - 0.5));
      vec3 rcol = col * (0.84 + 0.22 * strata + 0.05 * fine) * (1.0 - 0.4 * crack);
      col = mix(col, rcol, rk);
      g += vec2(dot(vT1, up), dot(vT2, up)) * cos(lay) * 0.25 * rk;
      g *= 1.0 + rk * 0.8;
    }
    // (the relief fades with distance, before it can shimmer)
    g *= closeK;
    Nd = normalize(N - vW1 * g.x - vW2 * g.y);
  }
  #endif
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
    float dl = max(dot(Nd, sunDir), 0.0);
    // and the sunlit ground round about lights what faces away from the sky: walls, overhangs, the shady side of a rock
    vec3 bounce = sunCol * 0.2 * max(dot(sunDir, seaUp), 0.0) * (0.5 - 0.5 * dot(N, seaUp));
    c = col * ((ambient + dl * sunCol + bounce) * sky + ambientX * (0.3 + 0.7 * sky) + lampLight(vP, Nd));
    // a glint off ice, where a facet turns the sun to you
    if (glint > 0.0) c += sunCol * glint * pow(max(dot(reflect(-sunDir, Nd), V), 0.0), 8.0) * 1.5 * dl;
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
interface Critter { obj: THREE.Object3D; n: V3; head: number; speed: number; fly: number; name: string; t: number; beast: Beast }

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
  /** how much the daylit sky drowns out faint things in it (0 at night or with no air, near 1 under a bright blue sky) */
  glare = 0;
  /** the light on the ground: colour of the sun through the air, and the ambient from the sky */
  readonly sunCol = new THREE.Color(1, 1, 1);
  readonly skyCol = new THREE.Color(0, 0, 0);
  /** the tiles are in and the sphere can sink under them */
  get ready() { return this.tiles.ready; }
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
  private caveMat: THREE.ShaderMaterial;
  /** the ground's tiles */
  readonly tiles: TileSet;
  /** the people of this world, who built its ruins, if one lives here */
  ruinPeople: string | null = null;
  /** the arches, spires, overhangs and caves round you */
  readonly forms: FormSet;
  private paint: ReturnType<typeof groundPainter> | null = null;
  private det = detailFor(1024);
  private sample: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
  private placed = new Map<string, Placed>();
  private sites: Site[] = [];
  private towns: { name: string; lat: number; lon: number; pop: number; alien: boolean }[] = [];
  /** the trees and plants round you */
  readonly flora = new Flora();
  readonly grass = new Grass();
  readonly ruins = new Ruins();
  private plants: { kinds: PlantKind[]; density: number; tint: THREE.Color | null; grass: { lush: number; leaf: THREE.Color | null } } = { kinds: [], density: 0, tint: null, grass: { lush: 0, leaf: null } };
  private floraAt: V3 | null = null;
  private critters: Critter[] = [];
  private found = new Set<string>();
  private q = new THREE.Quaternion();
  private t = 0;

  constructor(scene: THREE.Scene, lightUniforms: Record<string, THREE.IUniform> = {}) {
    this.root.name = 'ground';
    scene.add(this.root);
    this.root.add(this.flora.group, this.grass.group, this.ruins.group);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, vertexColors: true, defines: { KIND: 0 },
      uniforms: {
        sunDir: { value: new THREE.Vector3(0, 0, 1) }, sunCol: { value: new THREE.Vector3(1, 1, 1) }, ambient: { value: new THREE.Vector3(0.03, 0.03, 0.03) },
        fogCol: { value: new THREE.Vector3() }, fogK: { value: 0 }, time: { value: 0 }, seaUp: { value: new THREE.Vector3() },
        lush: { value: 0 }, leaf: { value: new THREE.Vector3(0.3, 0.45, 0.15) }, alien: { value: 0 }, craterK: { value: 0 },
        caveN: { value: 0 }, caveA: { value: ramps() }, caveB: { value: ramps() }, caveU: { value: ramps() }, caveS: { value: ramps() },
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
    this.tiles = new TileSet(this.mat);
    this.root.add(this.tiles.group);
    // the rock you can walk under and into: the ground's own shading, with the sky shut out where it does not reach
    this.caveMat = new THREE.ShaderMaterial({ vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, vertexColors: true, side: THREE.DoubleSide, defines: { CAVE: '', KIND: 0 }, uniforms: this.mat.uniforms });
    this.forms = new FormSet(this.caveMat);
    this.root.add(this.forms.group);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.sky.visible = false;
    scene.add(this.sky);
  }

  /** is this a world you can stand on? */
  static solid(b: Body) { return solid(b); }

  /** the height of the ground (m above the datum) in a direction in the body's frame, as fine as `fine` m */
  heightAt(n: V3, fine = 0.5) {
    if (!this.spec) return 0;
    this.paint ??= groundPainter(this.spec.look);
    const h = groundAt(this.spec, n, fine, this.sample, this.paint, this.det);
    // what is built on it: a pad's apron, a base's terrace
    const p = this.platformAt(n);
    if (p > (this.sample.sea ? 0 : h)) { this.sample.sea = false; return p; }
    return h;
  }
  /** a base's building at n: its floor (m over the datum) or a wall (the fleet fills this in) */
  structureAt: (n: V3) => { floor: number | null; solid: boolean } | null = () => null;
  /** the top of whatever is built at n (the fleet fills this in), or −∞ */
  platformAt: (n: V3) => number = () => -Infinity;
  /** the ground sample there (after heightAt) */
  get last_sample() { return this.sample; }

  private formSmp: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
  private formSample = (n: V3, fine: number) => {
    this.paint ??= groundPainter(this.spec!.look);
    groundAt(this.spec!, n, fine, this.formSmp, this.paint, this.det);
    return this.formSmp;
  };

  /**
   * What is underfoot for someone at `n` with their feet at `foot` m: the
   * height they stand at (a cave's floor, or the ground), the roof over them
   * if there is one, whether rock blocks the way there, and the form they are
   * inside (a cave) with how far in (0 at the mouth, 1 at the end).
   */
  standAt(n: V3, foot: number) {
    const h = this.heightAt(n, 0.3), sea = this.sample.sea;
    if (!this.spec) return { h, sea, roof: Infinity, solid: false, inside: null as Form | null, dark: 0 };
    const g = this.forms.ground(this.spec, n, foot, sea ? 0 : h);
    // a ruin: its steps and plinths to stand on, its stone in the way
    const rs = this.ruins.near.length && g.floor === null ? this.ruins.structureAt(n, this.spec.R) : null;
    if (rs) {
      const fl = rs.floor !== null && rs.floor > h ? rs.floor : null;
      if (fl !== null || rs.solid) return { h: fl ?? h, sea, roof: Infinity, solid: rs.solid || (fl !== null && fl > foot), inside: null, dark: 0 };
    }
    // a base's buildings: their floors, their walls and furniture
    const st = this.structureAt(n);
    // (a floor more than a step over your feet is a wall to you: you climb to it by its stairs)
    if (st && st.floor !== null && g.floor === null) return { h: st.floor, sea: false, roof: Infinity, solid: st.solid || st.floor > foot, inside: null, dark: 0 };
    return { h: g.floor ?? (sea ? 0 : h), sea: g.floor === null && sea, roof: g.roof, solid: g.solid || !!st?.solid, inside: g.inside, dark: g.dark };
  }

  /** is the land at n cut away, down into a cave? */
  cutAt(n: V3) { return !!this.spec && this.forms.cutAt(this.spec, n, () => this.heightAt(n, 0.5)); }

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
    if (!b) { this.tiles.reset(null); return; }
    this.atmo = atmosphere(b, stars);
    this.lifeInfo = life(b, stars);
    const st = b.look.style;
    // what its ground is made of, close up: 0 regolith, 1 sand, 2 ice, 3 soil, 4 lava rock
    const kind = b.look.real === 'Venus' || st === 'lava' ? 4 : st === 'ice' ? 2 : st === 'desert' ? 1 : st === 'terran' || st === 'ocean' ? 3 : 0;
    // and whether grass can grow on it (the shader for a bare world leaves the grass out)
    const grass = b.look.real === 'Earth' || this.lifeInfo.forms.some(f => f.kind === 'plant');
    // and how cratered, seen from the air: old airless ground all the way down; under air, weathered away (Mars' thin
    // air leaves some; the Earth's, Venus' and Titan's none); Io's lava covers them as they form
    const bar = this.atmo.bar, craters = b.look.real === 'Io' || kind === 4 ? 0 : bar > 0.05 ? 0 : bar > 1e-3 ? 0.5 : 1;
    this.mat.uniforms.craterK.value = craters;
    if (('CRATERS' in this.mat.defines) !== craters > 0) { if (craters > 0) this.mat.defines.CRATERS = ''; else delete this.mat.defines.CRATERS; this.mat.needsUpdate = true; }
    for (const m of [this.mat, this.caveMat]) {
      if (m.defines.KIND !== kind) { m.defines.KIND = kind; m.needsUpdate = true; }
      if (('GRASS' in m.defines) !== grass) { if (grass) m.defines.GRASS = ''; else delete m.defines.GRASS; m.needsUpdate = true; }
    }
    this.spec = groundSpec(b.look, b.r * AU_M, gravity(b), this.atmo.bar);
    this.tiles.reset(this.spec);
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
    for (const p of this.placed.values()) { this.root.remove(p.obj); disposeTree(p.obj); }
    this.placed.clear();
    this.forms.clear();
    this.ruins.clear();
    this.flora.clear();
    this.floraAt = null;
    for (const c of this.critters) { this.root.remove(c.obj); disposeTree(c.obj); }
    this.critters = [];
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
    alt = r - spec.R - (this.sample.sea ? 0 : hHere);
    // the tiles round the viewer
    this.tiles.frame(vb);
    // a couple of km up, the ground's shader for the air: its detail from kilometres down to tens of metres, and none of
    // the close-up (one more shader, compiled the first time; going up and down, the two are kept)
    const high = alt > (this.mat.defines.HIGH !== undefined ? 1500 : 2500);
    if ((this.mat.defines.HIGH !== undefined) !== high) { if (high) this.mat.defines.HIGH = ''; else delete this.mat.defines.HIGH; this.mat.needsUpdate = true; }
    // the light on the ground
    const u = this.mat.uniforms;
    u.time.value = this.t;
    if (sun) (u.sunDir.value as THREE.Vector3).copy(sun);
    (u.sunCol.value as THREE.Vector3).set(this.sunCol.r, this.sunCol.g, this.sunCol.b);
    (u.seaUp.value as THREE.Vector3).copy(rel).negate().normalize();
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
    // things on the ground, near enough to matter
    if (alt < 60e3) this.placeSites(n, alt);
    if (alt < 20e3) this.ruinsFrame(n);
    else if (this.ruins.near.length) this.ruins.clear();
    if (alt < 4000) {
      this.forms.frame(spec, n, alt, this.formSample);
      for (const f of this.forms.near(spec, n, 80)) if (!this.found.has(f.key)) { this.found.add(f.key); this.onFind(f.name, f.about); }
    } else this.forms.clear();
    // the caves' ramps, where the land is cut away: from the body's frame to the view's
    // (the nearest first, as many as the shader takes)
    const rs = this.forms.ramps().map(q => ({ q, d: q.a.clone().add(q.b).multiplyScalar(0.5).applyQuaternion(this.q).add(rel).length() })).sort((a, b) => a.d - b.d).slice(0, CAVE_RAMPS).map(o => o.q), A = u.caveA.value as THREE.Vector3[], B = u.caveB.value as THREE.Vector3[], U = u.caveU.value as THREE.Vector3[], S = u.caveS.value as THREE.Vector3[];
    rs.forEach((q, k) => {
      A[k].copy(q.a).applyQuaternion(this.q).add(rel);
      B[k].copy(q.b).applyQuaternion(this.q).add(rel);
      U[k].copy(q.up).applyQuaternion(this.q);
      S[k].set(q.hw, q.hgt, q.fl);
    });
    u.caveN.value = rs.length;
    if (alt < 3000) this.life(dt, n, alt);
    else if (this.floraAt || this.critters.length) this.clearLife();
  }

  /** the ruins round you: drawn near, labelled further, logged when you reach one */
  private ruinsFrame(n: V3) {
    const b = this.body!, spec = this.spec!, L = this.lifeInfo;
    if (b.cls === 'gas' || ['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(b.look.style) || spec.R < 2e5) return;
    // rare everywhere; a little less rare on worlds with a past, and where a people lives now
    const rate = L?.tier === 'intelligent' ? 0.04 : b.look.real === 'Earth' ? 0.003 : 0.006;
    const people = L?.tier === 'intelligent' ? L.forms.find(f => f.kind === 'people')?.name ?? null : null;
    this.ruinPeople = people;
    this.ruins.spin(this.t);
    this.ruins.frame({ R: spec.R, seed: Math.floor(b.look.seed % 9973) + 17, rate, people, built: m => this.platformAt(m) > -Infinity, sampleAt: m => { const h = groundAt(spec, m, 1, this.sample, this.paint ?? undefined, this.det), q = this.sample; return { h: q.sea ? 0 : h, sea: q.sea, r: q.r, g: q.g, b: q.b }; } }, n);
    const first = this.ruins.near[0];
    if (first && first.d < 80 && !this.found.has(first.r.key)) {
      this.found.add(first.r.key);
      this.onFind(`Ruins: ${first.r.name}`, people ? `Built by ${people}, long ago: they remember who, if not why.` : 'Who built it, and when, nobody knows. Its stone is the stone of the ground round it.');
    }
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
      this.glare = 0;
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
    this.glare = this.daylight * thick;
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
        this.stand(obj, sn, 0, 3);
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

  /**
   * put an object on the ground in a direction, standing up; with `foot` (m)
   * it settles to the lowest ground under its footprint, so on a slope its
   * downhill side touches rather than hangs in the air (its uphill side goes in
   * a little, as a heavy thing does)
   */
  stand(obj: THREE.Object3D, n: V3, lift = 0, foot = 0) {
    let h = this.heightAt(n, 0.5);
    if (this.sample.sea) h = 0;
    if (foot > 0) {
      const [e, nn] = tangent(n), k = foot / this.spec!.R;
      for (let a = 0; a < 6; a++) {
        const c = Math.cos(a * 1.047) * k, d = Math.sin(a * 1.047) * k;
        const m: V3 = [n[0] + e[0] * c + nn[0] * d, n[1] + e[1] * c + nn[1] * d, n[2] + e[2] * c + nn[2] * d], l = Math.hypot(...m);
        const hh = this.heightAt([m[0] / l, m[1] / l, m[2] / l], 0.5);
        if (!this.sample.sea) h = Math.min(h, hh + (h - hh) * 0.35);
      }
    }
    const R = this.spec!.R + h + lift;
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
      let h = this.heightAt(dir, 2);
      if (this.sample.sea) continue;
      // standing on the lowest corner of its block, its footing carried down into the ground
      for (const [ox, oy] of [[20, 20], [-20, 20], [20, -20], [-20, -20]]) {
        const m2: V3 = [dir[0] + (e[0] * ox + nn[0] * oy) / R, dir[1] + (e[1] * ox + nn[1] * oy) / R, dir[2] + (e[2] * ox + nn[2] * oy) / R], l2 = Math.hypot(...m2);
        h = Math.min(h, this.heightAt([m2[0] / l2, m2[1] / l2, m2[2] / l2], 2));
      }
      h -= 3;
      const core = Math.exp(-Math.hypot(gx, gy) / (radius * 0.25));
      const tall = 11 + (core * 220 + 20) * Math.pow(r(), 2.5);
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
      const h = this.heightAt(dir, 0.5) - 0.6;
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
    this.flora.clear();
    this.grass.clear();
    this.mat.uniforms.lush.value = 0;
    this.floraAt = null;
    for (const c of this.critters) { this.root.remove(c.obj); disposeTree(c.obj); }
    this.critters = [];
  }

  /** what grows and walks round you: scattered when you arrive, again when you have moved on */
  private life(dt: number, n: V3, alt: number) {
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
    // the trees: fixed to the world, modelled near you
    this.flora.frame({ R, seed: Math.floor(b.look.seed % 9973), built: m => this.platformAt(m) > -Infinity || this.cutAt(m), heightAt: m => { const h = this.heightAt(m, 0.5); return { h, sea: this.sample.sea }; } }, n, this.plants.kinds, this.plants.density, this.plants.tint);
    // the grass: in the ground's colour (its texture, in the shader) and, round you on foot, in tufts
    const u = this.mat.uniforms, g = this.plants.grass;
    u.lush.value = g.lush;
    u.alien.value = g.leaf ? 1 : 0;
    if (g.leaf) (u.leaf.value as THREE.Vector3).set(g.leaf.r, g.leaf.g, g.leaf.b);
    if (alt < 150) this.grass.frame({ R, seed: Math.floor(b.look.seed % 9973), built: m => this.platformAt(m) > -Infinity || this.cutAt(m), sampleAt: m => { const h = this.heightAt(m, 0.5), q = this.sample; return { h, sea: q.sea, r: q.r, g: q.g, b: q.b, rock: q.rock }; } }, n, g.lush, g.leaf, this.t);
    else if (this.grass.mesh.count) this.grass.clear();
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
      // legs, head, tail, wings
      c.beast.animate(this.t + c.n[0] * 100, c.fly ? 3 : c.speed);
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
    // the trees are the flora's (flora.ts): what grows here, how thickly, and on a made-up world its leaves' colour
    // how much grass: on the Earth by its biome (the ground's own green decides where); elsewhere where the plants are
    const lush = earth ? { tropical: 0.9, temperate: 1, boreal: 0.7, grassland: 1, desert: 0.2, mountain: 0.7, city: 0.6, tundra: 0.45, ice: 0, ocean: 0 }[this.biome!] : kinds.length ? 0.8 : 0;
    const tint = earth || !kinds.length ? null : new THREE.Color(kinds[0].col);
    for (const k of kinds) if (!this.found.has(k.name)) { this.found.add(k.name); this.onFind(k.name, 'Plant life.'); }
    // (grasses, reeds and mosses are the grass's to draw, not trees)
    const trees = kinds.filter(k => !/grass|bluestem|reed|moss|lichen|kelp|sedge/i.test(k.name));
    this.plants = { kinds: trees, density: trees.length ? density : 0, tint, grass: { lush, leaf: tint } };
    // animals
    let fauna: { name: string; size: number; color: number; fly: boolean }[] = [];
    if (earth) fauna = speciesIn(this.biome!).filter(s => s.kind === 'animal' && s.size > 0.1 && s.name !== 'Human').map(s => ({ name: `${s.name} (${s.latin})`, size: s.size, color: s.color, fly: /macaw|condor|robin|pigeon|bee/i.test(s.name) }));
    else if (L.tier === 'animals' || L.tier === 'intelligent') fauna = L.forms.filter(f => f.kind === 'animal').map(f => ({ name: `${f.name}, a ${f.about}`, size: f.size, color: f.color, fly: /gliding|floating/.test(f.about) }));
    if (this.biome === 'ocean') fauna = [];
    const nF = fauna.length ? Math.min(14, 4 + Math.floor(r() * 10)) : 0;
    for (let k = 0; k < nF; k++) {
      const f = fauna[Math.floor(r() * fauna.length)];
      // its own body plan, scaled so its length or height (whichever is greater) is the animal's size
      const beast = earth ? earthAnimal(f.name, f.color, f.fly) : alienAnimal(Math.floor(r() * 1e6) + f.name.length * 977, f.color, f.fly);
      const obj = beast.obj, bb = new THREE.Box3().setFromObject(obj), sz = bb.getSize(new THREE.Vector3());
      obj.scale.setScalar(Math.max(0.3, f.size) / Math.max(0.3, sz.y, sz.z));
      const rad = 20 + 160 * r(), ang = r() * Math.PI * 2, th = rad / R;
      const cn: V3 = [Math.cos(th) * n[0] + Math.sin(th) * (Math.cos(ang) * e[0] + Math.sin(ang) * nn[0]), Math.cos(th) * n[1] + Math.sin(th) * (Math.cos(ang) * e[1] + Math.sin(ang) * nn[1]), Math.cos(th) * n[2] + Math.sin(th) * (Math.cos(ang) * e[2] + Math.sin(ang) * nn[2])];
      this.root.add(obj);
      this.critters.push({ obj, n: cn, head: r() * 6.28, speed: 0.5 + r(), fly: f.fly ? 8 + 20 * r() : 0, name: f.name, t: r() * 3, beast });
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
    // the nearest ruins, once you are close enough to have seen them
    for (const { r, d } of this.ruins.near.slice(0, 2)) {
      if (d < 25) continue;
      const rr = R + r.h + 8 * r.s;
      const p = new THREE.Vector3(r.n[0] * rr, r.n[1] * rr, r.n[2] * rr).applyQuaternion(this.q).add(this.root.position);
      out.push({ key: `ruin:${r.key}`, text: `Ruins · ${d < 1000 ? `${d.toFixed(0)} m` : `${(d / 1000).toFixed(1)} km`}`, at: p });
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
/** a star's light as it falls on the ground: its colour, but far less saturated than the map's glyph for it */
function light(rgb: V3) {
  const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-3);
  return new THREE.Color(0.8 + 0.2 * rgb[0] / m, 0.8 + 0.2 * rgb[1] / m, 0.8 + 0.2 * rgb[2] / m);
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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
  else if (s.kind === 'peak') { if (s.body === 'Earth') g.add(summitCairn()); }
  else if (s.body === 'Venus') g.add(veneraMesh());
  else if (s.body === 'Earth') { const p = probeMesh(); p.scale.setScalar(4); g.add(p); }
  else g.add(landerMesh());
  return g;
}

/** what climbers leave on a summit: a cairn of stones, a pole, a string of prayer flags in the wind */
function summitCairn() {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0x77736c, flatShading: true });
  for (let k = 0; k < 9; k++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 - k * 0.02, 0), stone);
    m.position.set(Math.cos(k * 2.4) * (0.35 - k * 0.03), 0.15 + k * 0.17, Math.sin(k * 2.4) * (0.35 - k * 0.03));
    m.rotation.set(k, k * 2, 0);
    g.add(m);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4), new THREE.MeshLambertMaterial({ color: 0x8a7a60 }));
  pole.position.y = 1.4;
  g.add(pole);
  const cols = [0x2a62d8, 0xf2f2f2, 0xd23a2a, 0x2a9a4a, 0xe8c020];
  for (let k = 0; k < 10; k++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), new THREE.MeshLambertMaterial({ color: cols[k % 5], side: THREE.DoubleSide }));
    f.position.set(0.25 + k * 0.42, 2.45 - k * 0.2, 0);
    f.rotation.y = 0.2 * Math.sin(k);
    g.add(f);
  }
  return g;
}

