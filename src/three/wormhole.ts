import * as THREE from 'three';

/**
 * What a wormhole looks like from outside and from inside.
 *
 * The mouth is a sphere, as the throat of a traversable wormhole would appear
 * (James et al. 2015): through it the sky on the far side, wound round and
 * squeezed towards the edge, where it piles up into a bright Einstein ring.
 * The tunnel is the throat itself, seen from inside: rings and spiral bands
 * rushing past, brightening towards the far mouth. Both are drawn in the same
 * stepped, pixel-art style as everything else.
 */

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
varying vec2 vUv;
void main() {
  vObj = position;
  vUv = uv;
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const MOUTH_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float time;
uniform float open;
uniform vec3 tint;
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vWorldN);
  vec3 V = normalize(-vWorldP);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  // 0 in the middle of the disc, 1 at the limb
  float e = sqrt(1.0 - mu * mu);
  // the angle round the line of sight, from the object frame
  vec3 n = normalize(vObj);
  float phi = atan(n.y, n.x) + atan(n.z, length(n.xy)) * 0.5;
  // the far sky is wound round more and more towards the edge
  float twist = phi * 3.0 + 7.0 / (1.05 - e) * 0.25 - time * 0.9;
  float bands = 0.5 + 0.5 * sin(twist * 2.0);
  bands = floor(bands * 4.0) / 4.0;
  // stars of the far side, squeezed into rings
  vec2 cell = floor(vec2(phi * 18.0, 1.0 / (1.08 - e) * 6.0 - time * 1.4));
  float star = step(0.93, hash(cell));
  vec3 deep = vec3(0.03, 0.02, 0.10);
  vec3 col = mix(deep, tint * 0.55, bands * (0.25 + 0.6 * e));
  col += star * vec3(0.85, 0.9, 1.0) * (0.4 + 0.6 * e);
  // the Einstein ring at the limb
  float ring = smoothstep(0.78, 0.93, e) * (1.0 - smoothstep(0.97, 1.0, e));
  col += floor(ring * 3.0 + 0.5) / 3.0 * vec3(0.95, 0.85, 1.0);
  gl_FragColor = vec4(col * (0.4 + 0.6 * open), 1.0);
}`;

const TUNNEL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float time;
uniform float speed;
uniform float glow;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  #include <logdepthbuf_fragment>
  // u round the throat, v along it (0 behind, 1 far ahead)
  float u = vUv.x, v = vUv.y;
  float along = v * 90.0 + time * speed;
  float rings = step(0.82, fract(along * 0.25));
  float spiral = 0.5 + 0.5 * sin(u * 6.2831853 * 6.0 + along * 0.7);
  spiral = floor(spiral * 4.0) / 4.0;
  float spark = step(0.985, hash(floor(vec2(u * 64.0, along * 2.0))));
  vec3 a = vec3(0.35, 0.12, 0.75), b = vec3(0.15, 0.75, 1.0);
  vec3 col = mix(a, b, spiral) * (0.35 + 0.5 * spiral);
  col += rings * vec3(0.8, 0.6, 1.0) * 0.6;
  col += spark * vec3(1.0);
  // brighter towards the mouth ahead, darker behind
  float ahead = smoothstep(0.55, 1.0, v);
  col = mix(col * smoothstep(0.0, 0.45, v), vec3(1.0, 0.97, 1.0), ahead * glow);
  gl_FragColor = vec4(col, 1.0);
}`;

/** a wormhole mouth: a sphere of radius 1 (scale it), with a glow round it */
export function mouthMesh(glowTex: THREE.Texture, tint = new THREE.Vector3(0.6, 0.45, 1.0)) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: MOUTH_FRAG,
    uniforms: { time: { value: 0 }, open: { value: 1 }, tint: { value: tint } },
  });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xa080ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  glow.scale.setScalar(4.2);
  glow.name = 'glow';
  g.add(glow);
  g.userData.mat = mat;
  return g;
}

/** animate a mouth: `open` 0–1 fades it in and out */
export function tickMouth(g: THREE.Group, t: number, open: number) {
  const mat = g.userData.mat as THREE.ShaderMaterial;
  mat.uniforms.time.value = t;
  mat.uniforms.open.value = open;
  const glow = g.getObjectByName('glow') as THREE.Sprite;
  glow.material.opacity = open;
}

/** the throat from inside: a long tube round the ship, along −z, in ship coordinates */
export function tunnelMesh() {
  const geo = new THREE.CylinderGeometry(70, 70, 6000, 48, 1, true);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: TUNNEL_FRAG, side: THREE.BackSide, depthWrite: true,
    uniforms: { time: { value: 0 }, speed: { value: 40 }, glow: { value: 0 } },
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

/** animate the tunnel: `p` is how far through it the ship is (0–1) */
export function tickTunnel(m: THREE.Mesh, t: number, p: number) {
  const u = (m.material as THREE.ShaderMaterial).uniforms;
  u.time.value = t;
  // fast in the middle, slowing as the far mouth comes up
  u.speed.value = 25 + 70 * Math.sin(Math.PI * Math.min(1, p));
  u.glow.value = Math.max(0, (p - 0.6) / 0.4) ** 2;
}
