import * as THREE from 'three';
import { starRGB } from '../pixel/sprites';

/**
 * A star's surface, alive. The map is the Sun photographed in extreme
 * ultraviolet (tools/bake-sun.py): coronal loops over the active regions, the
 * dark coronal holes. The shader keeps it moving — the equator turning faster
 * than the poles, as the Sun's does, the plasma drawn along a slowly changing
 * flow (two looks at the map, each pulled a little way along it and faded
 * into the other before the stretching shows), a boil of granules under it
 * and the bright knots flaring. The Sun keeps the photo's gold; every other
 * star wears the same weather in its own colour, turned to a face of its own
 * so no two look alike.
 */

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

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform sampler2D lut;
uniform float ready;
uniform float time;
uniform float seed;
uniform vec3 tint;
/** how much of the photo's contrast a star shows: all of it on the Sun and cooler stars, less the hotter it is (its spots and loops washed out in the glare) */
uniform float contrast;
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 turnZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
float look(vec3 n) {
  float lon = atan(n.y, n.x) / 6.2831853;
  // the nearer of two wrappings, so the seam does not show
  float u1 = fract(lon + 0.5), u2 = fract(lon) + 0.5;
  float u = fwidth(u1) <= fwidth(u2) + 1e-5 ? u1 : u2;
  return texture2D(map, vec2(u, 0.5 - asin(clamp(n.z, -1.0, 1.0)) / 3.14159265)).r;
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vObj);
  // a face of its own: turned about two axes by the star's seed
  n = turnZ(n, seed * 6.2831853);
  n = vec3(n.x, n.y * cos(seed * 9.0) - n.z * sin(seed * 9.0), n.y * sin(seed * 9.0) + n.z * cos(seed * 9.0));
  // differential rotation: the equator laps the poles
  n = turnZ(n, time * 0.006 * (1.0 - 0.4 * n.z * n.z));
  // the flow: a slowly changing field along the surface
  vec3 q = n * 2.6 + vec3(0.0, 0.0, time * 0.01);
  vec3 fl = vec3(vnoise3(q + 1.7), vnoise3(q + 9.2), vnoise3(q + 4.4)) - 0.5;
  fl -= n * dot(fl, n);
  float ph = time * 0.04, p1 = fract(ph), p2 = fract(ph + 0.5);
  float l1 = look(normalize(n + fl * 0.09 * (p1 - 0.5))), l2 = look(normalize(n + fl * 0.09 * (p2 - 0.5)));
  float l = ready > 0.5 ? mix(l1, l2, abs(2.0 * p1 - 1.0)) : 0.55 + 0.25 * vnoise3(n * 6.0);
  l = 0.6 + (l - 0.6) * contrast;
  // granules boiling under it, and the bright knots flaring
  float gr = vnoise3(n * 90.0 + vec3(time * 0.2)) * 0.6 + vnoise3(n * 230.0 - vec3(time * 0.3)) * 0.4;
  l *= 0.9 + 0.2 * gr;
  float fk = vnoise3(n * 7.0 + vec3(time * 0.05, 0.0, -time * 0.03));
  l += smoothstep(0.62, 0.85, l) * smoothstep(0.45, 0.9, fk) * 0.22;
  // the limb: darker into the disc's edge, and the corona's glow beyond it
  vec3 V = normalize(-vWorldP);
  float mu = clamp(dot(normalize(vWorldN), V), 0.0, 1.0);
  l *= mix(0.7, 1.0, sqrt(mu));
  vec3 c = texture2D(lut, vec2(clamp(l, 0.0, 1.0), 0.5)).rgb;
  c += tint * pow(1.0 - mu, 4.0) * 0.5;
  gl_FragColor = vec4(c, 1.0);
}`;

/** the photo's own colour scale, brightness to colour: black through brown and gold to white */
const GOLD: [number, number, number, number][] = [
  [0, 0.04, 0.0, 0.0], [0.06, 0.18, 0.03, 0.01], [0.19, 0.44, 0.11, 0.0], [0.31, 0.64, 0.24, 0.0], [0.44, 0.75, 0.38, 0.0],
  [0.56, 0.83, 0.53, 0.0], [0.69, 0.89, 0.68, 0.13], [0.81, 0.94, 0.8, 0.39], [0.94, 0.98, 0.92, 0.76], [1, 1, 0.97, 0.9],
];

function lutTexture(f: (l: number) => [number, number, number]) {
  const d = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = f(i / 255);
    d[i * 4] = Math.round(Math.min(1, c[0]) * 255); d[i * 4 + 1] = Math.round(Math.min(1, c[1]) * 255); d[i * 4 + 2] = Math.round(Math.min(1, c[2]) * 255); d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, 256, 1, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function gold(l: number): [number, number, number] {
  let k = 1;
  while (k < GOLD.length - 1 && GOLD[k][0] < l) k++;
  const a = GOLD[k - 1], b = GOLD[k], t = Math.max(0, Math.min(1, (l - a[0]) / (b[0] - a[0] || 1)));
  return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

let mapTex: THREE.Texture | null = null;
const luts = new Map<string, THREE.DataTexture>();
const mats: THREE.ShaderMaterial[] = [];

/** the colour scale for a star: the Sun's gold, or the same brightnesses in the star's own colour, white-hot at the top */
function lutFor(sun: boolean, teff: number) {
  const key = sun ? 'sun' : String(Math.round(teff / 100));
  let t = luts.get(key);
  if (!t) {
    const c = starRGB(teff);
    t = lutTexture(sun ? gold : l => {
      // hotter stars are brighter all over, their coolest patches still glowing
      const hot = Math.max(0, Math.min(1, (teff - 4500) / 6000));
      const y = (0.12 + 0.3 * hot) + (1.1 + 0.2 * hot) * Math.pow(l, 1.2);
      // and the hottest (white dwarfs, neutron stars) white-hot all over, only their limbs showing colour
      const blaze = Math.max(0, Math.min(1, (teff - 12000) / 40000));
      const w = Math.max(Math.min(1, Math.max(0, (l - 0.62 + 0.15 * hot) / 0.38) ** 2) * 0.8, blaze * (0.55 + 0.3 * l));
      return [c[0] * y * (1 - w) + w, c[1] * y * (1 - w) + w, c[2] * y * (1 - w) + w];
    });
    luts.set(key, t);
  }
  return t;
}

const contrastFor = (sun: boolean, teff: number) => sun ? 1 : Math.max(0.3, Math.min(1, 1 - (teff - 6500) / 20000));

/** a star's surface material; `seed` (0–1) turns it to a face of its own */
export function starMaterial(sun: boolean, teff: number, seed: number) {
  if (!mapTex) {
    mapTex = new THREE.TextureLoader().load(new URL('../pixel/data/sun-map.jpg', import.meta.url).href, () => { for (const m of mats) m.uniforms.ready.value = 1; });
    mapTex.wrapS = THREE.RepeatWrapping;
    mapTex.colorSpace = THREE.NoColorSpace;
    mapTex.anisotropy = 4;
  }
  const c = starRGB(teff);
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      map: { value: mapTex }, lut: { value: lutFor(sun, teff) }, ready: { value: mapTex.image ? 1 : 0 },
      time: { value: 0 }, seed: { value: sun ? 0 : seed }, tint: { value: new THREE.Vector3(c[0], c[1], c[2]) }, contrast: { value: contrastFor(sun, teff) },
    },
  });
  mats.push(m);
  return m;
}

/** keep a star's material up to date: its clock, and its colour if its temperature changed */
export function tickStar(m: THREE.ShaderMaterial, sun: boolean, teff: number, t: number) {
  m.uniforms.time.value = t;
  const lut = lutFor(sun, teff);
  if (m.uniforms.lut.value !== lut) {
    m.uniforms.lut.value = lut;
    const c = starRGB(teff);
    (m.uniforms.tint.value as THREE.Vector3).set(c[0], c[1], c[2]);
    m.uniforms.contrast.value = contrastFor(sun, teff);
  }
}

/** a material is done with */
export function dropStar(m: THREE.ShaderMaterial) {
  const i = mats.indexOf(m);
  if (i >= 0) mats.splice(i, 1);
  m.dispose();
}
