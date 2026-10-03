import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M } from '../physics/units';
import { bodyQuat, dirOf, latLonOf, arc } from './ground';
import type { V3 } from '../pixel/sprites';
import { NLAMP } from './lightglsl';
export { LIGHT_GLSL } from './lightglsl';

/**
 * Light you bring yourself. The ship's floodlight throws a beam from its nose
 * far enough to light the night side of a world below; on foot or outside, a
 * lamp on the helmet lights the ground a few tens of metres ahead. A dial in
 * the settings lifts the dark everywhere (the "night-side light"). And lamps
 * can be hung in the sky: each stays over one place on a world, turning with
 * it, throwing a pool of light round the point under it — and can be sent
 * anywhere on the world at any time, made brighter or dimmer, wider or
 * narrower. Every surface shader (the worlds, their clouds, the ground close
 * up) reads the same slots through LIGHT_GLSL; the meshes on the ground get
 * spotlights to match.
 */

/** slot 0 the ship's floodlight, 1 the helmet lamp, 2–4 the lamps in the sky */
const SKY0 = 2;
export const MAX_SKY_LAMPS = NLAMP - SKY0;

export interface SkyLamp {
  id: number; b: Body;
  /** where it is over, and where it is going, degrees in the body's frame */
  lat: number; lon: number; toLat: number; toLon: number;
  /** height over the datum, m; the radius of the pool of light, m; brightness */
  alt: number; spread: number; power: number;
  on: boolean;
  mesh: THREE.Group;
}

export class Lights {
  readonly uniforms = {
    lampPos: { value: Array.from({ length: NLAMP }, () => new THREE.Vector4()) },
    lampDir: { value: Array.from({ length: NLAMP }, () => new THREE.Vector4(0, 0, -1, 0.99)) },
    lampCol: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3(1, 1, 1)) },
    lampRange: { value: new Array<number>(NLAMP).fill(0) },
    ambientX: { value: 0 },
  };
  /** the ship's floodlight, and the helmet lamp, on or off (one switch: whichever you are with) */
  flood = false;
  /** the night-side light from the settings, 0–1 */
  ambient = 0;
  readonly lamps: SkyLamp[] = [];
  /** spotlights for the meshes (buildings, craft, the ship), one per slot so the shaders never change */
  private spots: THREE.SpotLight[] = [];
  private nextId = 1;
  private root = new THREE.Group();

  constructor(scene: THREE.Scene, private glow: THREE.Texture) {
    for (let i = 0; i < NLAMP; i++) {
      const s = new THREE.SpotLight(0xfff4e0, 0, 0, 0.3, 0.4, 0);
      s.visible = true;
      scene.add(s, s.target);
      this.spots.push(s);
    }
    scene.add(this.root);
  }

  /** the uniforms to merge into a ShaderMaterial that uses LIGHT_GLSL */
  get shaderUniforms() { return this.uniforms; }

  /**
   * Each frame: where the lights are, from where the view is (`P`, AU) — the ship's nose and
   * heading (camera-relative, m), and the viewer's eye and gaze when on foot or outside
   */
  frame(dt: number, P: V3, ship: { pos: THREE.Vector3; fwd: THREE.Vector3; inside: boolean } | null, helmet: { pos: THREE.Vector3; fwd: THREE.Vector3 } | null) {
    const u = this.uniforms;
    u.ambientX.value = this.ambient * 0.22;
    // the floodlight: from the nose, a 12° beam that reaches to the ground from orbit
    this.slot(0, this.flood && ship ? ship.pos : null, ship?.fwd ?? null, Math.cos(12 * Math.PI / 180), 0.8, 0, [1, 0.96, 0.88]);
    // (seen from inside, its spotlight would light the cabin through the hull: the beam is for outside)
    if (ship?.inside) this.spots[0].intensity = 0;
    // the helmet lamp: a wide, short beam
    this.slot(1, this.flood && helmet ? helmet.pos : null, helmet?.fwd ?? null, Math.cos(28 * Math.PI / 180), 1.4, 45, [0.92, 0.96, 1]);
    for (let k = 0; k < MAX_SKY_LAMPS; k++) {
      const L = this.lamps[k];
      if (!L || !L.b.alive) { this.slot(SKY0 + k, null, null, 1, 0, 0, [1, 1, 1]); continue; }
      this.move(L, dt);
      const q = bodyQuat(L.b);
      const n = new THREE.Vector3(...dirOf(L.lat, L.lon)).applyQuaternion(q);
      const R = L.b.r * AU_M;
      const c = new THREE.Vector3((L.b.x - P[0]) * AU_M, (L.b.y - P[1]) * AU_M, (L.b.z - P[2]) * AU_M);
      const pos = n.clone().multiplyScalar(R + L.alt).add(c);
      const cosA = Math.cos(Math.atan2(L.spread, L.alt));
      this.slot(SKY0 + k, L.on ? pos : null, n.clone().negate(), cosA, L.power, 0, [1, 0.95, 0.85]);
      // the lamp itself: a bright point in the sky, and a faint shaft through the air under it
      L.mesh.position.copy(pos);
      L.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), n.clone().negate());
      const d = pos.length();
      const star = L.mesh.children[0] as THREE.Sprite;
      star.scale.setScalar(Math.max(L.alt * 0.02, d * 0.035) / L.alt);
      star.material.opacity = L.on ? 1 : 0.25;
      L.mesh.scale.setScalar(L.alt);
      const shaft = L.mesh.children[1] as THREE.Mesh;
      shaft.visible = L.on;
      shaft.scale.set(L.spread / L.alt, 1, L.spread / L.alt);
    }
  }

  private slot(i: number, pos: THREE.Vector3 | null, dir: THREE.Vector3 | null, cosA: number, power: number, range: number, col: V3) {
    const u = this.uniforms, s = this.spots[i];
    if (!pos || !dir || power <= 0) { u.lampPos.value[i].w = 0; s.intensity = 0; return; }
    u.lampPos.value[i].set(pos.x, pos.y, pos.z, power);
    const d = dir.clone().normalize();
    u.lampDir.value[i].set(d.x, d.y, d.z, cosA);
    u.lampCol.value[i].set(col[0], col[1], col[2]);
    u.lampRange.value[i] = range;
    s.position.copy(pos);
    s.target.position.copy(pos).addScaledVector(d, 100);
    s.target.updateMatrixWorld();
    s.angle = Math.min(1.5, Math.acos(Math.max(-1, Math.min(1, cosA))) * 1.15);
    s.distance = range ? range * 6 : 0;
    s.color.setRGB(col[0], col[1], col[2]);
    s.intensity = power * 2.2;
  }

  /** along the great circle toward where it was sent: anywhere on the world within twenty seconds or so */
  private move(L: SkyLamp, dt: number) {
    const a = dirOf(L.lat, L.lon), b = dirOf(L.toLat, L.toLon);
    const ang = arc(a, b);
    if (ang < 1e-6) return;
    const step = Math.min(ang, Math.max(1.5 * Math.PI / 180, ang / 6) * dt);
    const t = step / ang, s = Math.sin(ang);
    const w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s;
    const n: V3 = [a[0] * w1 + b[0] * w2, a[1] * w1 + b[1] * w2, a[2] * w1 + b[2] * w2];
    [L.lat, L.lon] = latLonOf(n);
  }

  /** hang a lamp over a point (degrees, the body's frame) of a world */
  hang(b: Body, lat: number, lon: number): SkyLamp | string {
    if (this.lamps.filter(l => l.b.alive).length >= MAX_SKY_LAMPS) return `${MAX_SKY_LAMPS} lamps are all in the sky already: move one, or take one down`;
    const R = b.r * AU_M;
    // high enough to see a good way round, low enough to make a bright pool
    const alt = Math.max(15e3, Math.min(400e3, R * 0.025));
    const mesh = this.lampMesh();
    this.root.add(mesh);
    const L: SkyLamp = { id: this.nextId++, b, lat, lon, toLat: lat, toLon: lon, alt, spread: Math.min(alt * 1.2, Math.max(3e3, R * 0.03)), power: 1, on: true, mesh };
    this.lamps.push(L);
    return L;
  }

  /** send a lamp somewhere (degrees) */
  send(L: SkyLamp, lat: number, lon: number) {
    L.toLat = Math.max(-89.5, Math.min(89.5, lat));
    L.toLon = ((lon + 540) % 360) - 180;
  }

  /** nudge where a lamp is going: north, south, east or west, by about the width of its pool */
  nudge(L: SkyLamp, dir: 'n' | 's' | 'e' | 'w') {
    const deg = Math.max(0.2, (L.spread * 1.5) / (L.b.r * AU_M) * 180 / Math.PI);
    const cl = Math.max(0.05, Math.cos(L.toLat * Math.PI / 180));
    this.send(L, L.toLat + (dir === 'n' ? deg : dir === 's' ? -deg : 0), L.toLon + (dir === 'e' ? deg / cl : dir === 'w' ? -deg / cl : 0));
  }

  remove(L: SkyLamp) {
    const i = this.lamps.indexOf(L);
    if (i >= 0) this.lamps.splice(i, 1);
    this.root.remove(L.mesh);
    L.mesh.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
  }

  byId(id: number) { return this.lamps.find(l => l.id === id) ?? null; }

  /** a lamp: a glow you can see from the ground, and a cone of lit air under it (unit height, pointing down) */
  private lampMesh() {
    const g = new THREE.Group();
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xfff2d8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    g.add(star);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 48, 1, true).translate(0, -0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    g.add(cone);
    g.traverse(o => { o.frustumCulled = false; });
    return g;
  }
}
