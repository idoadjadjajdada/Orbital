import * as THREE from 'three';
import type { Body } from '../physics/body';
import { blackbody } from '../physics/stellar';
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

  update(bodies: Body[], compact: Body[], emitters: Body[] = []) {
    let n = 0;
    for (const b of bodies) if (!b.source && b.alive && b.isParticle) n++;
    if (n > this.cap) this.grow(Math.ceil(n * 1.5));
    const o = this.view.origin;
    let i = 0;
    for (const b of bodies) {
      if (b.source || !b.alive || !b.isParticle) continue;
      this.pos[i * 3] = b.x - o.x; this.pos[i * 3 + 1] = b.y - o.y; this.pos[i * 3 + 2] = b.z - o.z;
      // the nearest compact object, if this is part of what is falling into it
      let near: Body | null = null, nd = Infinity;
      for (const h of compact) {
        const d = Math.hypot(b.x - h.x, b.y - h.y, b.z - h.z);
        if (d < nd) { nd = d; near = h; }
      }
      const inner = near ? Math.max(near.captureRadius, 2e-5) : 0;
      const disc = near && b.cls === 'gasp' && nd < 3000 * inner;
      let r: number, g: number, bl: number, a: number, s: number;
      if (disc) {
        // a thin disc's temperature climbs inward as r^-3/4: red at the rim, blue-white at the inner edge
        const h = Math.max(b.heat, Math.min(1, Math.pow(3 * inner / nd, 0.75)));
        this.c.setRGB(...blackbody(2500 + 30000 * h * h)).convertSRGBToLinear();
        const k = 0.6 + 4 * h * h;
        r = this.c.r * k; g = this.c.g * k; bl = this.c.b * k;
        a = 0.7;
        // a parcel spreads into the gas round it, so the disc reads as a disc
        s = 0.05 * nd;
      } else if (b.cls === 'gasp') {
        this.c.setHex(b.look.c1).convertSRGBToLinear();
        const heat = b.heat, k = 0.35 + 2.5 * heat;
        r = this.c.r * k + heat * 1.2; g = this.c.g * k + heat * 0.6; bl = this.c.b * k + heat * 0.25;
        a = 0.55;
        // a parcel stands for a growing volume of gas as the cloud spreads —
        // never more than a fraction of its distance from whatever it left
        let dc = nd;
        for (const st of emitters) dc = Math.min(dc, Math.hypot(b.x - st.x, b.y - st.y, b.z - st.z));
        s = Math.max(0, Math.min(0.12 * Math.hypot(b.vx - (near?.vx ?? 0), b.vy - (near?.vy ?? 0), b.vz - (near?.vz ?? 0)) * b.age, 0.3 * dc));
      } else {
        this.c.setHex(b.look.c1).convertSRGBToLinear();
        const heat = b.heat, k = 1.1;
        r = this.c.r * k + heat * 2.4; g = this.c.g * k + heat * 0.9; bl = this.c.b * k + heat * 0.25;
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
