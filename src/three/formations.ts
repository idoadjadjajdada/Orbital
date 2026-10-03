import * as THREE from 'three';
import type { V3 } from '../pixel/sprites';
import { hash, vnoise } from '../pixel/noise';
import { lattice, tangent, type GroundSpec } from './terrain';

/**
 * Rock formations: what a height map cannot hold, because something hangs
 * over something else. Arches, hoodoos with their cap rocks, wind-cut
 * mushroom rocks, mesas with an overhanging rim, fields of ice blades
 * (penitentes), and caves — lava tubes on the Moon and Mars, ice caves on the
 * icy moons, limestone caves on an Earth-like world — that you can walk into,
 * dark but for your suit lamp and the light from the mouth, with stalactites,
 * stalagmites and, in ice, blue crystals.
 *
 * They are scattered on the same body-fixed lattice as the boulders, by the
 * kind of world, so each stands in the same place every time you come back.
 * Sizes scale with gravity: a hoodoo stands taller on Mars than on the Earth.
 */

export type FormKind = 'arch' | 'hoodoo' | 'mushroom' | 'mesa' | 'blades' | 'cave';
export interface Formation {
  key: string;
  kind: FormKind;
  /** where (unit, body frame), the ground there (m), size (m), turned by (rad), a seed */
  n: V3; h: number; size: number; yaw: number; seed: number;
  /** its colour: the ground's, darker */
  color: THREE.Color;
  /** for walking: solid circles (x, z, r, in its own frame, m), and for a cave its chamber (radius, wall, the mouth's half-angle) and floor */
  solids: [number, number, number][];
  cave?: { R: number; wall: number; mouth: number; floor: number };
  /** the frame: east and north at its middle */
  e: V3; nn: V3;
}

/** which formations a world has, and how often (per lattice cell) */
function palette(s: GroundSpec): [FormKind, number][] {
  const st = s.look.style, real = s.look.real ?? '';
  if (real === 'Moon' || real === 'Mercury') return [['cave', 0.05], ['mesa', 0.04]];
  if (real === 'Mars') return [['cave', 0.05], ['hoodoo', 0.06], ['mushroom', 0.06], ['arch', 0.04], ['mesa', 0.05]];
  if (real === 'Earth') return [['arch', 0.04], ['hoodoo', 0.03], ['cave', 0.05], ['mesa', 0.03]];
  if (real === 'Titan') return [['blades', 0.06], ['cave', 0.04], ['arch', 0.03]];
  if (real === 'Venus' || st === 'lava') return [['mesa', 0.05], ['cave', 0.03]];
  if (st === 'ice' || ['Europa', 'Enceladus', 'Pluto', 'Triton', 'Ganymede', 'Callisto', 'Charon'].includes(real)) return [['blades', 0.1], ['cave', 0.06], ['arch', 0.03]];
  if (st === 'desert') return [['hoodoo', 0.08], ['mushroom', 0.07], ['arch', 0.05], ['mesa', 0.06], ['cave', 0.04]];
  if (st === 'terran' || st === 'ocean') return [['arch', 0.04], ['hoodoo', 0.03], ['cave', 0.05]];
  if (st === 'barren' || st === 'rocky') return [['cave', 0.05], ['mesa', 0.04], ['hoodoo', 0.03], ['arch', 0.02]];
  return [['cave', 0.03]];
}

const CELL = 260;

/** the formations within `radius` m of a direction on a world; `ground(n)` gives the height and whether it is sea */
export function formationsNear(s: GroundSpec, c: V3, radius: number, gSurf: number, ground: (n: V3) => { h: number; sea: boolean; rgb: [number, number, number] }): Formation[] {
  // a few per square kilometre: the palette's odds are per cell, thinned here
  const pal = palette(s).map(([k, p]) => [k, p * 0.22] as [FormKind, number]), out: Formation[] = [];
  const sd = Math.floor(s.look.seed % 9973) + 101;
  // lower gravity, taller rock
  const scale = Math.min(3, Math.max(0.7, Math.sqrt(9.81 / Math.max(gSurf, 0.3))));
  lattice(c, s.R, radius, CELL, (n, i, j, f) => {
    let u = hash(i * 7 + 3, j * 13 + 5, f * 31 + sd), kind: FormKind | null = null;
    for (const [k, p] of pal) { if (u < p) { kind = k; break; } u -= p; }
    if (!kind) return;
    const g = ground(n);
    if (g.sea) return;
    const seed = Math.floor(hash(i, j, f + sd) * 1e6);
    const size = (kind === 'mesa' ? 40 : kind === 'cave' ? 14 : kind === 'arch' ? 16 : kind === 'blades' ? 8 : 10) * (0.7 + 0.6 * hash(i, j, f + sd + 1)) * scale;
    const yaw = hash(i, j, f + sd + 2) * Math.PI * 2;
    const [e, nn] = tangent(n);
    const fm: Formation = { key: `${f}:${i}:${j}`, kind, n, h: g.h, size, yaw, seed, color: new THREE.Color(g.rgb[0], g.rgb[1], g.rgb[2]).multiplyScalar(0.85), solids: [], e, nn };
    // what is solid underfoot, in its own frame
    if (kind === 'arch') fm.solids = [[-size * 0.55, 0, size * 0.16], [size * 0.55, 0, size * 0.16]];
    else if (kind === 'hoodoo') fm.solids = [[0, 0, size * 0.22]];
    else if (kind === 'mushroom') fm.solids = [[0, 0, size * 0.14]];
    else if (kind === 'mesa') fm.solids = [[0, 0, size * 0.75]];
    else if (kind === 'blades') for (let k = 0; k < 14; k++) fm.solids.push([(hash(seed, k, 1) - 0.5) * size * 2, (hash(seed, k, 2) - 0.5) * size * 2, 0.25 * scale]);
    else if (kind === 'cave') {
      // a floor level with the highest ground inside, so no ground pokes through it
      let floor = g.h;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, r = size * 0.7 / s.R;
        const m: V3 = [n[0] + (Math.cos(a) * e[0] + Math.sin(a) * nn[0]) * r, n[1] + (Math.cos(a) * e[1] + Math.sin(a) * nn[1]) * r, n[2] + (Math.cos(a) * e[2] + Math.sin(a) * nn[2]) * r];
        const l = Math.hypot(...m);
        floor = Math.max(floor, ground([m[0] / l, m[1] / l, m[2] / l]).h);
      }
      fm.cave = { R: size, wall: size * 0.28, mouth: 0.55, floor: floor + 0.05 };
    }
    out.push(fm);
  });
  return out;
}

/** where a point (unit, body frame) is in a formation's own frame, m: x, z */
export function localXZ(fm: Formation, n: V3, R: number): [number, number] {
  const d: V3 = [n[0] - fm.n[0], n[1] - fm.n[1], n[2] - fm.n[2]];
  const x = (d[0] * fm.e[0] + d[1] * fm.e[1] + d[2] * fm.e[2]) * R, z = -(d[0] * fm.nn[0] + d[1] * fm.nn[1] + d[2] * fm.nn[2]) * R;
  const c = Math.cos(-fm.yaw), s = Math.sin(-fm.yaw);
  // undo its turn about its up (three's rotateY)
  return [x * c + z * s, -x * s + z * c];
}

/** is a point inside rock? (for someone of radius 0.35 m walking) */
export function blocked(fm: Formation, x: number, z: number) {
  for (const [sx, sz, r] of fm.solids) if ((x - sx) ** 2 + (z - sz) ** 2 < (r + 0.35) ** 2) return true;
  const c = fm.cave;
  if (c) {
    const d = Math.hypot(x, z);
    // the wall of the chamber, but for the mouth (which faces local −z)
    if (d > c.R - c.wall - 0.35 && d < c.R + 0.35) {
      const ang = Math.atan2(x, -z);
      if (Math.abs(ang) > c.mouth) return true;
    }
  }
  return false;
}

/** in a cave's chamber (or its mouth)? */
export function inCave(fm: Formation, x: number, z: number) {
  return !!fm.cave && Math.hypot(x, z) < fm.cave.R - fm.cave.wall * 0.3;
}

// ------------------------------------------------------------------ the meshes
const CAVE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float open;
varying vec3 vP;
varying vec3 vN;
varying vec3 vC;
varying float vOpen;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = mv.xyz;
  vN = normalize(normalMatrix * normal);
  vC = color;
  vOpen = open;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const CAVE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float daylight;
varying vec3 vP;
varying vec3 vN;
varying vec3 vC;
varying float vOpen;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(vP);
  // the suit lamp: on your head, pointing where you look
  vec3 L = -vP / max(d, 1e-3);
  float lamp = 2.2 / (1.0 + pow(d / 7.0, 2.0)) * (0.35 + 0.65 * abs(dot(normalize(vN), L))) * (0.5 + 0.5 * smoothstep(0.75, 0.95, -vP.z / max(d, 1e-3)));
  vec3 c = vC * (0.015 + lamp + vOpen * daylight * 0.6);
  gl_FragColor = vec4(c, 1.0);
}`;

const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const caveMat = () => new THREE.ShaderMaterial({ vertexShader: CAVE_VERT, fragmentShader: CAVE_FRAG, vertexColors: true, side: THREE.BackSide, uniforms: { daylight: { value: 1 } } });
const crystalMat = (c: number) => new THREE.MeshBasicMaterial({ color: c });

/** roughen a geometry along its normals with noise, and colour it in strata */
function rough(g: THREE.BufferGeometry, amp: number, freq: number, seed: number, col: THREE.Color, strata = 0.12, keepBase = true) {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.computeVertexNormals();
  const p = geo.getAttribute('position') as THREE.BufferAttribute, nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const cols = new Float32Array(p.count * 3);
  // displace by the noise at each vertex's position, so shared corners move together
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const v = vnoise(x * freq + seed, y * freq, z * freq) - 0.5 + (vnoise(x * freq * 3.1, y * freq * 3.1 + seed, z * freq * 3.1) - 0.5) * 0.4;
    const k0 = keepBase && y < 0.05 ? 0.3 : 1;
    // displace along the direction from the axis, not the face normal, so faces stay joined
    const r = Math.hypot(x, z) || 1;
    p.setXYZ(k, x + (x / r) * v * amp * k0, y + v * amp * 0.3 * k0, z + (z / r) * v * amp * k0);
    const band = 1 + strata * Math.sin(y * 1.7 + vnoise(x * 0.2, y * 0.3, z * 0.2) * 3) + (vnoise(x * 2, y * 2, z * 2 + seed) - 0.5) * 0.15;
    cols[k * 3] = col.r * band; cols[k * 3 + 1] = col.g * band; cols[k * 3 + 2] = col.b * band;
  }
  void nrm;
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}

const ICY = new Set(['Europa', 'Enceladus', 'Pluto', 'Triton', 'Ganymede', 'Callisto', 'Charon']);

/** the mesh of a formation, standing on its own origin, y up, its mouth (a cave's) to −z */
export function formationMesh(fm: Formation, s: GroundSpec): THREE.Group {
  const g = new THREE.Group();
  const S = fm.size, sd = fm.seed % 1000, col = fm.color;
  const icy = s.look.style === 'ice' || ICY.has(s.look.real ?? '');
  const ice = icy ? new THREE.Color(0.82, 0.88, 0.95) : col;
  const mesh = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, rockMat); m.position.set(x, y, z); g.add(m); return m; };
  if (fm.kind === 'hoodoo') {
    // a column of soft rock under a hard cap that shelters it: the cap overhangs
    let y = -1;
    const parts = 3 + (sd % 3);
    for (let k = 0; k < parts; k++) {
      const h = (S * 0.8) / parts, r = S * (0.2 - 0.03 * k + 0.04 * Math.sin(k * 2 + sd));
      mesh(rough(new THREE.CylinderGeometry(r * 0.85, r, h, 9, 3).translate(0, h / 2, 0), r * 0.35, 0.4, sd + k, col, 0.2, false), 0, y, 0);
      y += h * 0.92;
    }
    mesh(rough(new THREE.CylinderGeometry(S * 0.32, S * 0.26, S * 0.16, 9, 1).translate(0, S * 0.08, 0), S * 0.06, 0.3, sd + 9, col.clone().multiplyScalar(0.75), 0.05, false), 0, y, 0);
  } else if (fm.kind === 'mushroom') {
    // wind-scoured at the base, where the sand flies: a thin stem under a wide head
    mesh(rough(new THREE.CylinderGeometry(S * 0.18, S * 0.12, S * 0.5, 9, 3).translate(0, S * 0.25 - 0.5, 0), S * 0.05, 0.6, sd, col, 0.25, false));
    const head = new THREE.SphereGeometry(S * 0.5, 12, 7);
    head.scale(1, 0.5, 0.8);
    mesh(rough(head, S * 0.12, 0.25, sd + 3, col, 0.2, false), 0, S * 0.62, 0);
  } else if (fm.kind === 'arch') {
    // an arch: a span of rock over a gap you can walk through
    const t = new THREE.TorusGeometry(S * 0.55, S * 0.17, 9, 18, Math.PI);
    t.scale(1, 1.2, 0.9);
    mesh(rough(t, S * 0.08, 0.25, sd, col, 0.18, false), 0, -S * 0.1, 0);
    for (const x of [-S * 0.55, S * 0.55]) mesh(rough(new THREE.CylinderGeometry(S * 0.2, S * 0.26, S * 0.3, 9, 2).translate(0, S * 0.05 - 0.6, 0), S * 0.05, 0.4, sd + x, col, 0.18, false), x, 0, 0);
  } else if (fm.kind === 'mesa') {
    // a mesa: steep walls under a harder rim that juts out over them
    mesh(rough(new THREE.CylinderGeometry(S * 0.72, S * 0.8, S * 0.45, 16, 4).translate(0, S * 0.22 - 1, 0), S * 0.1, 0.08, sd, col, 0.3, false));
    mesh(rough(new THREE.CylinderGeometry(S * 0.85, S * 0.74, S * 0.1, 16, 1).translate(0, S * 0.45 - 1, 0), S * 0.06, 0.1, sd + 5, col.clone().multiplyScalar(0.8), 0.05, false));
  } else if (fm.kind === 'blades') {
    // a field of blades sculpted by sunlight subliming the ice (Pluto's are 500 m tall; these are the small kind)
    for (const [x, z] of fm.solids) {
      const h = S * (0.6 + 0.8 * hash(Math.round(x * 10), Math.round(z * 10), sd));
      const b = new THREE.ConeGeometry(S * 0.09, h, 5, 2).translate(0, h / 2 - 0.3, 0);
      mesh(rough(b, S * 0.03, 0.8, sd + x, ice, 0.05, false), x, 0, z).rotation.set((hash(x, z, 1) - 0.5) * 0.3, hash(x, z, 2) * 6, (hash(x, z, 3) - 0.5) * 0.3);
    }
  } else if (fm.kind === 'cave') {
    const c = fm.cave!, R = c.R, H = R * 0.62, fl = c.floor - fm.h;
    // the outside: a mound of rock with a mouth facing −z
    const shellGeo = (r: number, inner: boolean) => {
      const geo = new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
      geo.scale(1, H / R, 1);
      const p = geo.getAttribute('position') as THREE.BufferAttribute;
      const open = new Float32Array(p.count);
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const ang = Math.atan2(x, -z);
        // the mouth: an arch cut out of the side
        const mouthUp = H * 0.72 * Math.cos(Math.min(1, Math.abs(ang) / c.mouth) * Math.PI / 2);
        let yy = y;
        if (Math.abs(ang) < c.mouth && y < mouthUp) yy = mouthUp;
        const v = vnoise(x * 0.3 + sd, y * 0.3, z * 0.3) - 0.5;
        const k2 = 1 + v * (inner ? 0.18 : 0.22);
        p.setXYZ(k, x * k2, yy * (1 + v * 0.1) + fl, z * k2);
        open[k] = Math.max(0, 1 - Math.abs(ang) / (c.mouth * 2.2)) * (inner ? 1 : 0);
      }
      geo.setAttribute('open', new THREE.BufferAttribute(open, 1));
      return geo;
    };
    const outer = rough(shellGeo(R, false), 0, 1, sd, col, 0.15, false);
    g.add(new THREE.Mesh(outer, rockMat));
    // the inside: the same shell a wall's thickness in, seen from within, dark but for the lamp and the mouth
    const innerGeo = shellGeo(R - c.wall, true);
    const ip = innerGeo.getAttribute('position') as THREE.BufferAttribute, icol = new Float32Array(ip.count * 3);
    const wallCol = icy ? new THREE.Color(0.55, 0.7, 0.85) : col.clone().multiplyScalar(0.8);
    for (let k = 0; k < ip.count; k++) { const b = 0.85 + 0.3 * vnoise(ip.getX(k) * 0.5, ip.getY(k) * 0.5 + sd, ip.getZ(k) * 0.5); icol[k * 3] = wallCol.r * b; icol[k * 3 + 1] = wallCol.g * b; icol[k * 3 + 2] = wallCol.b * b; }
    innerGeo.setAttribute('color', new THREE.BufferAttribute(icol, 3));
    const inner = new THREE.Mesh(innerGeo, caveMat());
    inner.name = 'caveInner';
    g.add(inner);
    // the floor, level, under the same lamp
    const floorGeo = new THREE.CircleGeometry(R - c.wall * 0.6, 24).rotateX(-Math.PI / 2).translate(0, fl, 0);
    const fp = floorGeo.getAttribute('position') as THREE.BufferAttribute, fcol = new Float32Array(fp.count * 3), fopen = new Float32Array(fp.count);
    for (let k = 0; k < fp.count; k++) {
      const b = 0.7 + 0.3 * vnoise(fp.getX(k) * 0.7 + sd, 0, fp.getZ(k) * 0.7);
      fcol[k * 3] = wallCol.r * b; fcol[k * 3 + 1] = wallCol.g * b; fcol[k * 3 + 2] = wallCol.b * b;
      fopen[k] = Math.max(0, Math.min(1, (-fp.getZ(k) - R * 0.2) / (R * 0.6)));
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
    floorGeo.setAttribute('open', new THREE.BufferAttribute(fopen, 1));
    const floorMat = caveMat();
    floorMat.side = THREE.FrontSide;
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.name = 'caveFloor';
    g.add(floor);
    // stalactites and stalagmites; crystals in ice
    const drip = icy ? crystalMat(0x7fd8ff) : new THREE.MeshLambertMaterial({ color: wallCol.clone().multiplyScalar(0.9), flatShading: true });
    for (let k = 0; k < 18; k++) {
      const a = hash(sd, k, 1) * Math.PI * 2, r = (R - c.wall) * (0.2 + 0.65 * hash(sd, k, 2));
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (z < 0 && Math.abs(Math.atan2(x, -z)) < c.mouth * 1.3) continue;
      const len = 0.5 + 2.5 * hash(sd, k, 3);
      const ceil = H * Math.sqrt(Math.max(0, 1 - (r / (R - c.wall)) ** 2)) * 0.9 + fl;
      if (icy) {
        const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.25 + 0.5 * hash(sd, k, 4), 0), drip);
        cr.scale.y = 2.5;
        cr.position.set(x, fl + 0.4, z);
        cr.rotation.set(hash(sd, k, 5) - 0.5, a, hash(sd, k, 6) - 0.5);
        g.add(cr);
      } else {
        const up = new THREE.Mesh(new THREE.ConeGeometry(0.18 + 0.2 * hash(sd, k, 4), len, 6), drip);
        up.position.set(x, fl + len / 2, z);
        const dn = new THREE.Mesh(new THREE.ConeGeometry(0.12 + 0.15 * hash(sd, k, 5), len * 0.8, 6), drip);
        dn.rotation.x = Math.PI;
        dn.position.set(x * 1.05, ceil - len * 0.4, z * 1.05);
        g.add(up, dn);
      }
    }
    if (icy) { const l = new THREE.PointLight(0x7fd8ff, 3, R * 1.5); l.position.set(0, fl + 1.5, R * 0.2); g.add(l); }
  }
  g.traverse(o => { o.frustumCulled = false; });
  return g;
}

/** the caves' daylight at the mouth */
export function setCaveDaylight(g: THREE.Group, d: number) {
  g.traverse(o => { const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined; if (m?.uniforms?.daylight) m.uniforms.daylight.value = d; });
}
