import * as THREE from 'three';
import type { Body, Style } from '../physics/body';
import { blackbody } from '../physics/stellar';
import { schwarzschild } from '../physics/units';
import { BODY_VERT, PLANET_FRAG, STAR_FRAG, RING_VERT, RING_FRAG, ATMO_FRAG, JET_VERT, JET_FRAG } from './shaders';
import type { View } from './view';

const STYLE_ID: Record<Style, number> = {
  terran: 0, ocean: 1, rocky: 2, barren: 3, ice: 4, lava: 5, iron: 6, carbon: 7, desert: 8,
  gas: 9, icegiant: 10, hotjupiter: 11, browndwarf: 12, star: -1, wd: -1, ns: -1, bh: -1,
};

const SPHERE = new THREE.SphereGeometry(1, 96, 48);
const SPHERE_LO = new THREE.SphereGeometry(1, 32, 16);

/** shared light uniforms: every lit material points at these same objects */
export const lights = {
  uLightPos: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
  uLightCol: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
  uNLights: { value: 0 },
};

let ringTex: THREE.Texture | null = null;
/** a soft bright annulus, for shock fronts */
export function ringTexture() {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.02)');
  grd.addColorStop(0.9, 'rgba(255,255,255,0.35)');
  grd.addColorStop(0.96, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  ringTex = new THREE.CanvasTexture(c);
  ringTex.colorSpace = THREE.SRGBColorSpace;
  return ringTex;
}

let glowTex: THREE.Texture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.08, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.18)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.03)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const col3 = (hex: number) => new THREE.Color(hex);

/** Blackbody colour, saturated a little so it survives tone mapping (a 5800 K star is otherwise plain white). */
export function starColor(teff: number) {
  const [r, g, b] = blackbody(teff);
  const k = 2.8;
  const c = new THREE.Color(r ** k, g ** k, b ** k);
  const m = Math.max(c.r, c.g, c.b);
  return c.multiplyScalar(1 / m).convertSRGBToLinear();
}

/** The material for a planet-like body, also used to draw catalogue icons. */
export function planetMaterial(b: Pick<Body, 'look' | 'heat'>, ambient = 0.012) {
  const L = b.look;
  return new THREE.ShaderMaterial({
    vertexShader: BODY_VERT,
    fragmentShader: PLANET_FRAG,
    uniforms: {
      uStyle: { value: STYLE_ID[L.style] },
      uC1: { value: col3(L.c1).convertSRGBToLinear() },
      uC2: { value: col3(L.c2).convertSRGBToLinear() },
      uAtmo: { value: col3(L.atmo ?? 0).convertSRGBToLinear() },
      uAtmoK: { value: L.atmo ? 0.9 : 0 },
      uSeed: { value: (L.seed % 1000) * 0.137 },
      uHeat: { value: b.heat },
      uTime: { value: 0 },
      uAmbient: { value: ambient },
      uCraters: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
      uCraterHot: { value: new Array(32).fill(0) },
      uNCraters: { value: 0 },
      uRingKind: { value: 0 },
      uRingN: { value: new THREE.Vector3(0, 0, 1) },
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uRingIn: { value: 0 }, uRingOut: { value: 0 }, uRingScale: { value: 1 },
      ...lights,
    },
  });
}

const RING_KIND = { saturn: 1, uranus: 2, neptune: 3, jupiter: 4 } as const;

export function starMaterial(teff: number, giant: boolean, seed: number) {
  return new THREE.ShaderMaterial({
    vertexShader: BODY_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uColor: { value: starColor(teff) },
      uTime: { value: 0 },
      uSeed: { value: (seed % 1000) * 0.31 },
      uGran: { value: giant ? 3 : 18 },
      uBright: { value: 1.7 },
    },
  });
}

export class BodyVisual {
  group = new THREE.Group();     // positioned at the body
  tilt = new THREE.Group();      // spin axis frame
  mesh: THREE.Mesh;
  atmo?: THREE.Mesh;
  ring?: THREE.Mesh;
  glow?: THREE.Sprite;
  beams?: THREE.Group;
  jets?: THREE.Group;
  /** smoothed accretion rate, M☉/yr, and the jet power it drives (0..1) */
  accRate = 0;
  jetPower = 0;
  private craterLocal = new Map<object, THREE.Vector3>();
  spin = 0;
  style: Style;
  /** displayed radius this frame, scene units */
  rVis = 0;
  /** projected screen position and radius this frame */
  sx = 0; sy = 0; spx = 0; onScreen = false;
  hidden = false;
  scenePos = new THREE.Vector3();

  constructor(readonly body: Body) {
    this.style = body.look.style;
    this.group.add(this.tilt);
    this.mesh = new THREE.Mesh(SPHERE, this.makeMaterial());
    this.tilt.add(this.mesh);
    this.build();
  }

  private makeMaterial(): THREE.Material {
    const b = this.body;
    if (b.cls === 'star' && b.star) return starMaterial(b.star.teff, b.star.phase === 'giant' || b.star.phase === 'agb', b.look.seed);
    if (b.cls === 'wd' || b.cls === 'ns') {
      const m = starMaterial(b.cls === 'ns' ? 1e5 : Math.max(b.star?.teff ?? 20000, 6000), false, b.look.seed);
      m.uniforms.uGran.value = 40;
      m.uniforms.uBright.value = b.cls === 'ns' ? 6 : 4;
      return m;
    }
    if (b.cls === 'bh') return new THREE.MeshBasicMaterial({ color: 0x000000 });
    return planetMaterial(b);
  }

  private build() {
    const b = this.body;
    const L = b.look;
    const ax = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), b.tilt).applyAxisAngle(new THREE.Vector3(0, 0, 1), b.node);
    this.tilt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
    if (L.atmo && this.style !== 'star') {
      const m = new THREE.ShaderMaterial({
        vertexShader: BODY_VERT, fragmentShader: ATMO_FRAG, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.BackSide,
        uniforms: { uAtmo: { value: col3(L.atmo).convertSRGBToLinear() }, uK: { value: 1.4 }, ...lights },
      });
      this.atmo = new THREE.Mesh(SPHERE_LO, m);
      this.atmo.scale.setScalar(1.035);
      this.mesh.add(this.atmo);
    }
    if (L.rings) {
      const g = new THREE.RingGeometry(L.rings.inner, L.rings.outer, 160, 1);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (r - L.rings.inner) / (L.rings.outer - L.rings.inner), 0.5);
      }
      const m = new THREE.ShaderMaterial({
        vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: col3(L.rings.color).convertSRGBToLinear() }, uOpacity: { value: L.rings.kind ? 1 : L.rings.opacity },
          uSeed: { value: (L.seed % 100) * 0.1 }, uPlanetPos: { value: new THREE.Vector3() }, uPlanetR: { value: 1 },
          uInner: { value: L.rings.inner }, uOuter: { value: L.rings.outer }, uKind: { value: L.rings.kind ? RING_KIND[L.rings.kind] : 0 },
          ...lights,
        },
      });
      this.ring = new THREE.Mesh(g, m);
      this.tilt.add(this.ring);
    }
    if (b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns' || b.cls === 'bh' || this.style === 'browndwarf') {
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
      }));
      this.group.add(this.glow);
    }
    if (b.cls === 'bh' || b.cls === 'ns') {
      // jets: two cones along the spin axis, set by what the hole is fed
      this.jets = new THREE.Group();
      const g = new THREE.CylinderGeometry(0.06, 0.0, 1, 24, 24, true);
      g.translate(0, 0.5, 0);
      const mat = new THREE.ShaderMaterial({
        vertexShader: JET_VERT, fragmentShader: JET_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.7, 1.0) } },
      });
      for (const sgn of [1, -1]) {
        const c = new THREE.Mesh(g, mat);
        if (sgn < 0) c.rotation.x = Math.PI;
        this.jets.add(c);
      }
      this.jets.visible = false;
      this.group.add(this.jets);
    }
    if (L.pulsar) {
      this.beams = new THREE.Group();
      const cone = new THREE.ConeGeometry(0.18, 1, 24, 1, true);
      cone.translate(0, -0.5, 0);
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fc8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      for (const s of [1, -1]) {
        const c = new THREE.Mesh(cone, mat);
        c.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        this.beams.add(c);
      }
      this.beams.rotation.y = 0.5; // magnetic axis off the spin axis
      const holder = new THREE.Group();
      holder.add(this.beams);
      this.tilt.add(holder);
      this.beams.userData.holder = holder;
    }
  }

  /** the class or look changed (a star died, a world melted into another) */
  rebuildIfNeeded() {
    if (this.body.look.style === this.style) return false;
    return true;
  }

  /** Craters live in the body's own turning frame: fix each one there the first time it is seen. */
  updateCraters(now: number) {
    const b = this.body;
    const mat = this.mesh.material as THREE.ShaderMaterial;
    if (!mat.uniforms?.uCraters) return;
    if (!b.craters.length) { mat.uniforms.uNCraters.value = 0; return; }
    this.mesh.updateMatrixWorld();
    const inv = new THREE.Quaternion();
    this.mesh.getWorldQuaternion(inv).invert();
    const live = new Set<object>(b.craters);
    for (const k of this.craterLocal.keys()) if (!live.has(k)) this.craterLocal.delete(k);
    const list = [...b.craters].sort((x, y) => y.a - x.a).slice(0, 32);
    const gas = b.cls === 'gas';
    list.forEach((c, i) => {
      let d = this.craterLocal.get(c);
      if (!d) { d = new THREE.Vector3(c.x, c.y, c.z).applyQuaternion(inv).normalize(); this.craterLocal.set(c, d); }
      mat.uniforms.uCraters.value[i].set(d.x, d.y, d.z, c.a);
      // fresh melt glows for a while; a scar in a giant's clouds is smeared out in weeks
      const age = now - c.t;
      mat.uniforms.uCraterHot.value[i] = gas ? Math.exp(-age / 0.08) : Math.exp(-age / Math.max(0.002, 3 * c.a));
    });
    mat.uniforms.uNCraters.value = list.length;
  }

  dispose() {
    (this.mesh.material as THREE.Material).dispose();
    if (this.atmo) (this.atmo.material as THREE.Material).dispose();
    if (this.ring) { this.ring.geometry.dispose(); (this.ring.material as THREE.Material).dispose(); }
    if (this.glow) this.glow.material.dispose();
    this.group.removeFromParent();
  }
}

const MIN_PX: Partial<Record<string, number>> = { star: 4, wd: 2.5, ns: 2.5, bh: 2, gas: 3, rock: 2.2, ice: 2.2, debris: 1.3 };

export class BodyLayer {
  map = new Map<Body, BodyVisual>();
  root = new THREE.Group();
  private tmp = new THREE.Vector3();

  constructor(private view: View) {
    view.scene.add(this.root);
  }

  sync(sources: Body[]) {
    const live = new Set(sources);
    for (const [b, v] of this.map) if (!live.has(b) || !b.alive || v.rebuildIfNeeded()) { v.dispose(); this.map.delete(b); }
    for (const b of sources) if (!this.map.has(b)) {
      const v = new BodyVisual(b);
      this.map.set(b, v);
      this.root.add(v.group);
    }
  }

  /** choose the (up to four) stars that light the scene, weighted by their flux at the view centre */
  updateLights(sources: Body[]) {
    const o = this.view.origin;
    const g = this.view.glide;
    const cands: { b: Body; f: number }[] = [];
    for (const b of sources) {
      if (!b.star || b.star.L <= 0 || b.cls === 'bh' || b.cls === 'ns') continue;
      const d2 = (b.x - o.x - g.x) ** 2 + (b.y - o.y - g.y) ** 2 + (b.z - o.z - g.z) ** 2 + b.r * b.r;
      cands.push({ b, f: b.star.L / d2 });
    }
    cands.sort((a, c) => c.f - a.f);
    const n = Math.min(4, cands.length);
    const fmax = n ? cands[0].f : 1;
    for (let i = 0; i < n; i++) {
      const { b, f } = cands[i];
      this.view.toScene(b, lights.uLightPos.value[i]);
      const c = starColor(b.star!.teff);
      // compress the dynamic range: a second star a hundred times fainter still shows
      const w = 1.7 * Math.pow(f / fmax, 0.35);
      lights.uLightCol.value[i].set(c.r * w, c.g * w, c.b * w);
    }
    lights.uNLights.value = n;
  }

  update(dtSim: number, timeReal: number, hostOf: (b: Body) => Body | null, simTime = 0, dtReal = 1 / 60) {
    const cam = this.view.camera.position;
    for (const v of this.map.values()) {
      const b = v.body;
      this.view.toScene(b, v.scenePos);
      v.group.position.copy(v.scenePos);
      const d = Math.max(1e-30, v.scenePos.distanceTo(cam));
      const pw = this.view.pixelWorld(d);
      const minPx = MIN_PX[b.cls] ?? 2;
      let rTrue = b.r;
      if (b.cls === 'bh') rTrue = 2.6 * schwarzschild(b.m); // the shadow, photon sphere seen from far away
      v.rVis = Math.max(rTrue, minPx * pw);
      v.mesh.scale.setScalar(v.rVis);
      const p = this.view.project(v.scenePos);
      v.sx = p.x; v.sy = p.y; v.spx = v.rVis / pw; v.onScreen = !p.behind;

      // visual spin, capped so a fast clock does not strobe
      const dθ = b.spin * dtSim;
      v.spin += Math.max(-0.08, Math.min(0.08, dθ));
      v.mesh.rotation.z = v.spin;

      const mat = v.mesh.material as THREE.ShaderMaterial;
      if (mat.uniforms) {
        if (mat.uniforms.uTime) mat.uniforms.uTime.value = timeReal;
        if (mat.uniforms.uHeat) mat.uniforms.uHeat.value = b.heat;
        if (b.star && mat.uniforms.uColor && b.cls === 'star') {
          mat.uniforms.uColor.value.copy(starColor(b.star.teff));
          mat.uniforms.uGran.value = b.star.phase === 'giant' || b.star.phase === 'agb' ? 3 : 18;
        }
        // a star that fills the view is exposed for, so its surface and colour show
        if (mat.uniforms.uBright) mat.uniforms.uBright.value = (b.cls === 'ns' ? 4 : 2.2) * (1 - 0.6 * Math.min(1, v.spx / 160));
      }
      if (v.ring) {
        const rm = v.ring.material as THREE.ShaderMaterial;
        rm.uniforms.uPlanetPos.value.copy(v.scenePos);
        rm.uniforms.uPlanetR.value = v.rVis;
        v.ring.scale.setScalar(v.rVis);
        if (mat.uniforms?.uRingKind && b.look.rings) {
          mat.uniforms.uRingKind.value = rm.uniforms.uKind.value || 5;
          mat.uniforms.uRingN.value.set(0, 0, 1).applyQuaternion(v.tilt.getWorldQuaternion(new THREE.Quaternion()));
          mat.uniforms.uCenter.value.copy(v.scenePos);
          mat.uniforms.uRadius.value = v.rVis;
          mat.uniforms.uRingIn.value = b.look.rings.inner;
          mat.uniforms.uRingOut.value = b.look.rings.outer;
          mat.uniforms.uRingScale.value = rm.uniforms.uOpacity.value;
        }
      }
      v.updateCraters(simTime);
      if (v.jets) {
        // what fell in this step, against the Eddington rate (2.2×10⁻⁸ M☉/yr per M☉ at 10% efficiency)
        const inst = dtSim > 0 ? b.swallowed / dtSim : 0;
        b.swallowed = 0;
        v.accRate += (inst - v.accRate) * Math.min(1, dtReal * 1.5);
        const edd = 2.2e-8 * b.m;
        const want = v.accRate > 0 ? Math.max(0, Math.min(1, (Math.log10(v.accRate / edd) + 4) / 4)) : 0;
        v.jetPower += (want - v.jetPower) * Math.min(1, dtReal * 2);
        v.jets.visible = v.jetPower > 0.02;
        if (v.jets.visible) {
          const Ln = Math.hypot(b.lx, b.ly, b.lz);
          const ax = Ln > 0 ? new THREE.Vector3(b.lx / Ln, b.ly / Ln, b.lz / Ln) : new THREE.Vector3(0, 0, 1);
          v.jets.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax);
          const len = Math.max(3000 * schwarzschild(b.m), 140 * pw) * (0.4 + v.jetPower);
          v.jets.scale.set(len, len, len);
          const jm = (v.jets.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
          jm.uniforms.uTime.value = timeReal;
          jm.uniforms.uPower.value = v.jetPower;
        }
      }
      if (v.glow) {
        const L = b.star?.L ?? 0;
        let px: number, c: THREE.Color, a = 1;
        if (b.cls === 'bh') { px = 0; c = new THREE.Color(0); a = 0; }
        else if (b.cls === 'ns') { px = 16; c = new THREE.Color(0.6, 0.75, 1.0); }
        else if (b.cls === 'wd') { px = 12; c = starColor(b.star?.teff ?? 20000); }
        else if (b.cls === 'star') { px = Math.min(110, 26 + 11 * Math.log10(1 + L)); c = starColor(b.star?.teff ?? 5772); }
        else { px = 7; c = new THREE.Color(0.8, 0.25, 0.1); a = 0.6; }
        // far away the halo is the star; close up it is only a corona round the disc
        const halo = px * pw, disc = v.rVis * 2.4;
        const size = Math.max(disc, halo);
        const k = Math.min(1, Math.max(0.05, (halo / disc) ** 1.5));
        v.glow.scale.setScalar(size);
        v.glow.material.color.copy(c).multiplyScalar(a * 1.6 * k);
        v.glow.visible = a > 0;
      }
      if (v.beams) {
        const holder = v.beams.userData.holder as THREE.Group;
        holder.rotation.z = v.spin * 3;
        v.beams.scale.setScalar(Math.max(v.rVis * 60, 40 * pw));
      }

      // a moon drawn larger than life would sit on top of its planet: hide it until they separate
      v.hidden = false;
      const host = hostOf(b);
      if (host && host.cls !== 'star' && host.cls !== 'bh') {
        const hv = this.map.get(host);
        if (hv) {
          this.view.toScene(host, this.tmp);
          const hp = this.view.project(this.tmp);
          const sep = Math.hypot(hp.x - p.x, hp.y - p.y);
          const hpx = hv.rVis / this.view.pixelWorld(Math.max(1e-30, this.tmp.distanceTo(cam)));
          if (sep < hpx + v.spx + 2 && v.rVis > b.r * 1.5) v.hidden = true;
        }
      }
      v.group.visible = !v.hidden;
    }
  }

  /** the body under a screen point, preferring the nearest centre */
  pick(sx: number, sy: number, slop = 10): Body | null {
    let best: Body | null = null, bd = Infinity;
    for (const v of this.map.values()) {
      if (!v.onScreen || v.hidden) continue;
      const d = Math.hypot(v.sx - sx, v.sy - sy);
      const reach = Math.max(slop, v.spx + 4);
      if (d < reach && d - v.spx < bd) { bd = d - v.spx; best = v.body; }
    }
    return best;
  }
}
