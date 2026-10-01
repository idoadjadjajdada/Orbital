import * as THREE from 'three';
import type { Body } from '../physics/body';
import { schwarzschild } from '../physics/units';
import { POINTS_VERT, POINTS_FRAG } from './shaders';
import type { View } from './view';

/** Test particles — debris, winds, ejecta, tails — as one additive point cloud. */
export class ParticleLayer {
  private cap = 0;
  private geom = new THREE.BufferGeometry();
  private pos!: Float32Array;
  private tint!: Float32Array;
  private size!: Float32Array;
  private mat: THREE.ShaderMaterial;
  readonly points: THREE.Points;
  private c = new THREE.Color();

  constructor(private view: View) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG,
      uniforms: { uScale: { value: 1 }, uMinPx: { value: 1.9 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geom, this.mat);
    this.points.frustumCulled = false;
    this.grow(4096);
    view.scene.add(this.points);
  }

  private grow(n: number) {
    this.cap = n;
    this.pos = new Float32Array(n * 3);
    this.tint = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('tint', new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
  }

  update(bodies: Body[], holes: Body[]) {
    let n = 0;
    for (const b of bodies) if (!b.source && b.alive) n++;
    if (n > this.cap) this.grow(Math.ceil(n * 1.5));
    const o = this.view.origin;
    let i = 0;
    for (const b of bodies) {
      if (b.source || !b.alive) continue;
      this.pos[i * 3] = b.x - o.x; this.pos[i * 3 + 1] = b.y - o.y; this.pos[i * 3 + 2] = b.z - o.z;
      let heat = b.heat;
      // matter falling into a black hole is heated by its own friction as it spirals in
      for (const h of holes) {
        const rs = schwarzschild(h.m);
        const d = Math.hypot(b.x - h.x, b.y - h.y, b.z - h.z);
        if (d < 400 * rs) heat = Math.max(heat, Math.min(1, (400 * rs / d - 1) * 0.15));
      }
      this.c.setHex(b.look.c1).convertSRGBToLinear();
      let r = this.c.r, g = this.c.g, bl = this.c.b, a: number, s: number;
      if (b.cls === 'gasp') {
        const k = 0.35 + 2.5 * heat;
        r = r * k + heat * 1.2; g = g * k + heat * 0.6; bl = bl * k + heat * 0.25;
        a = 0.55;
        // a parcel stands for a growing volume of gas as the cloud spreads
        const v = Math.hypot(b.vx, b.vy, b.vz);
        s = Math.max(0, 0.12 * v * b.age);
      } else {
        const k = 1.1;
        r = r * k + heat * 2.4; g = g * k + heat * 0.9; bl = bl * k + heat * 0.25;
        a = 1;
        s = 2 * b.r;
      }
      this.tint[i * 4] = r; this.tint[i * 4 + 1] = g; this.tint[i * 4 + 2] = bl; this.tint[i * 4 + 3] = a;
      this.size[i] = s;
      i++;
    }
    this.geom.setDrawRange(0, i);
    for (const k of ['position', 'tint', 'size']) (this.geom.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    this.mat.uniforms.uScale.value = this.view.height / (2 * Math.tan((this.view.camera.fov * Math.PI) / 360));
  }
}
