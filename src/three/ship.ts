import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M, C } from '../physics/units';

/** the speed of light, m/s */
export const C_MS = (C * AU_M) / (365.25 * 86400);
/** top speed on the ordinary drive, m/s */
export const CRUISE = 0.05 * C_MS;
/** top speed in overdrive, m/s */
export const OD_MAX = 1e4 * C_MS;
/** a wormhole jump: seconds to open the mouth, to dive in, to ride the tunnel, to clear the far mouth */
export const OPEN = 2.5, DIVE = 0.8, TUNNEL = 3, EXIT = 1.2;
/** seconds to recharge the wormhole drive after a jump */
export const JUMP_REFILL = 40;
/** how much bigger the hull is drawn than its model: about 32 m nose to tail */
export const HULL = 4;

export type JumpPhase = 'open' | 'dive' | 'tunnel' | 'exit';

/**
 * The ship: its drives and how it looks.
 *
 * The ordinary drive tops out at 5% of light speed, enough to cross from a
 * world to its moons in under a minute. Overdrive is a warp: it spools up
 * over a few seconds towards ten thousand times light speed, but is held back
 * near anything massive (never faster than three times the height above the
 * nearest surface per second), so it carries you across a system and slows
 * by itself on the way in. The wormhole drive opens a mouth ahead, dives
 * through, and comes out beside the selected body; it needs time to recharge.
 */
export class Ship {
  /** overdrive engaged, and how far it has spooled (0–1) */
  od = false;
  odLevel = 0;
  /** wormhole capacitor, 0–1; a jump needs it full */
  charge = 1;
  /** a jump under way: where to (null for a natural wormhole), which phase, how long into it, and what to do on coming out */
  jump: { b: Body | null; phase: JumpPhase; t: number; arrive: () => void } | null = null;
  /** seconds of the arrival flash left */
  flash = 0;
  view: 'chase' | 'cockpit' = 'chase';
  /** how hard the engines push, 0–1, for the exhaust */
  thrust = 0;

  readonly mesh: THREE.Group;
  /** where the airlock door is on the hull, ship frame, m */
  readonly airlock = new THREE.Vector3(-1.3, 0.3, 4.6).multiplyScalar(HULL * 0.75);
  private flame: THREE.Sprite;
  private light = new THREE.DirectionalLight(0xffffff, 2.2);
  private ambient = new THREE.AmbientLight(0x404858, 1.2);
  private streaks: THREE.LineSegments;
  private seeds: Float32Array;
  private lockLight: THREE.Mesh;

  constructor(private camera: THREE.PerspectiveCamera, private scene: THREE.Scene, glow: THREE.Texture) {
    this.mesh = buildShip();
    const inner = this.mesh.children[0];
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x7fb4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flame.position.set(0, 0, 6);
    inner.add(this.flame);
    // a light by the airlock, for finding the way back in
    this.lockLight = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.6), new THREE.MeshBasicMaterial({ color: 0x5fffa0 }));
    this.lockLight.position.copy(this.airlock).multiplyScalar(1 / (HULL * 0.75));
    inner.add(this.lockLight);
    camera.add(this.mesh);
    scene.add(this.light);
    scene.add(this.light.target);
    scene.add(this.ambient);
    scene.add(camera);

    // streaks: short lines around the viewer, swept past along the motion
    const n = 400;
    this.seeds = new Float32Array(n * 3);
    for (let k = 0; k < n * 3; k++) this.seeds[k] = (Math.random() * 2 - 1) * 400;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    this.streaks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc8d8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.streaks.frustumCulled = false;
    scene.add(this.streaks);
  }

  /** the speed the drive allows here, m/s, given the height above the nearest surface */
  cap(alt: number) {
    const a = Math.max(1, isFinite(alt) ? alt : 1e16);
    if (this.odLevel <= 0) return CRUISE;
    const top = CRUISE * Math.pow(OD_MAX / CRUISE, this.odLevel);
    return Math.max(CRUISE, Math.min(top, 3 * a * this.odLevel));
  }

  /** whether a jump can start now */
  ready() { return this.charge >= 1 && !this.jump; }

  /** open a wormhole to a body; `arrive` puts the ship there when the tunnel ends */
  startJump(b: Body, arrive: () => void) {
    if (!this.ready() || !b.alive) return false;
    this.jump = { b, phase: 'open', t: 0, arrive };
    this.od = false;
    return true;
  }

  /** through a natural wormhole: straight into its tunnel, no charge needed */
  startTransit(arrive: () => void) {
    if (this.jump) return;
    this.jump = { b: null, phase: 'tunnel', t: TUNNEL * 0.4, arrive };
    this.od = false;
  }

  /** the ship is between the mouths: the world outside is not drawn */
  inTunnel() { return this.jump?.phase === 'tunnel'; }

  /** can the controls steer: not while the drive has hold of the ship */
  steerable() { return !this.jump || this.jump.phase === 'exit'; }

  update(dt: number) {
    this.odLevel = this.od ? Math.min(1, this.odLevel + dt / 3) : Math.max(0, this.odLevel - dt / 0.8);
    this.flash = Math.max(0, this.flash - dt);
    const j = this.jump;
    if (!j) { this.charge = Math.min(1, this.charge + dt / JUMP_REFILL); return; }
    if (j.b && !j.b.alive && j.phase !== 'exit') { this.jump = null; return; }
    j.t += dt;
    const next = (p: JumpPhase | null) => { if (p) { j.phase = p; j.t = 0; } else this.jump = null; };
    switch (j.phase) {
      case 'open': if (j.t >= OPEN) next('dive'); break;
      case 'dive': if (j.t >= DIVE) next('tunnel'); break;
      case 'tunnel':
        if (j.t >= TUNNEL) {
          j.arrive();
          if (j.b) this.charge = 0;
          this.flash = 1;
          next('exit');
        }
        break;
      case 'exit': if (j.t >= EXIT) next(null); break;
    }
  }

  /** the portal ahead: how open and how far (m), or null */
  portal(): { open: number; dist: number } | null {
    const j = this.jump;
    if (!j) return null;
    if (j.phase === 'open') return { open: j.t / OPEN, dist: 900 };
    if (j.phase === 'dive') return { open: 1, dist: 900 * (1 - j.t / DIVE) ** 2 + 1 };
    if (j.phase === 'exit') return { open: 1 - j.t / EXIT, dist: -120 - 400 * (j.t / EXIT) };
    return null;
  }

  /** how far through the tunnel (0–1), or null */
  tunnel(): number | null {
    const j = this.jump;
    return j && j.phase === 'tunnel' ? Math.min(1, j.t / TUNNEL) : null;
  }

  /** how hard the drive is pulling, 0–1, for the warp core and the streaks */
  warp() {
    const j = this.jump;
    if (!j) return this.odLevel;
    if (j.phase === 'open') return Math.max(this.odLevel, j.t / OPEN);
    if (j.phase === 'exit') return 1 - j.t / EXIT;
    return 1;
  }

  /**
   * Where the hull is drawn: behind the camera for the chase view, out in
   * space at `at` (m from the viewer) for a spacewalk, or not at all from the
   * cockpit or inside.
   */
  placeHull(where: 'chase' | 'world' | 'none', q?: THREE.Quaternion, at?: THREE.Vector3) {
    const m = this.mesh;
    if (where === 'chase') {
      if (m.parent !== this.camera) this.camera.add(m);
      m.position.set(0, -3.6 * HULL, -17 * HULL);
      m.quaternion.identity();
      m.visible = true;
    } else if (where === 'world') {
      if (m.parent !== this.scene) this.scene.add(m);
      m.position.copy(at!);
      m.quaternion.copy(q!);
      m.visible = true;
    } else m.visible = false;
  }

  /** draw: exhaust, light on the hull, warp streaks; `vel` is the ship's velocity (m/s), `sun` the direction the light travels */
  draw(dt: number, q: THREE.Quaternion, vel: [number, number, number], sun: THREE.Vector3 | null) {
    const warp = this.warp();
    this.flame.scale.setScalar(1.2 + 2.5 * this.thrust + 2.5 * warp);
    (this.flame.material as THREE.SpriteMaterial).color.setHex(this.jump ? 0xc890ff : warp > 0.05 ? 0xe0e8ff : 0x7fb4ff);
    const t = performance.now() / 1000;
    const inner = this.mesh.children[0] as THREE.Group;
    inner.rotation.z = Math.sin(t * 0.7) * 0.02;
    inner.position.y = Math.sin(t * 1.1) * 0.06;
    (this.lockLight.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 4) > 0 ? 0x5fffa0 : 0x1d5a38);

    if (sun) {
      this.light.position.copy(sun).multiplyScalar(-1e4);
      this.light.target.position.set(0, 0, 0);
      this.light.intensity = 2.2;
    } else this.light.intensity = 0.4;

    // field of view widens with the warp
    const fov = 70 + 30 * warp;
    if (Math.abs(this.camera.fov - fov) > 0.1) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // streaks along the motion
    const sp = Math.hypot(vel[0], vel[1], vel[2]);
    const show = this.inTunnel() ? 0 : Math.max(warp, Math.min(1, Math.max(0, Math.log10(sp / 1e5) / 4)));
    const mat = this.streaks.material as THREE.LineBasicMaterial;
    mat.opacity = Math.min(0.9, show);
    mat.color.setHex(this.jump ? 0xc890ff : 0xc8d8ff);
    this.streaks.visible = show > 0.02;
    if (!this.streaks.visible) return;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const dir = sp > 0 && !this.jump ? [vel[0] / sp, vel[1] / sp, vel[2] / sp] : [f.x, f.y, f.z];
    const visSp = 60 + 3000 * show, len = 2 + 160 * show * show;
    const s = this.seeds, a = (this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute);
    const out = a.array as Float32Array;
    for (let k = 0; k < s.length; k += 3) {
      for (let j = 0; j < 3; j++) {
        s[k + j] -= dir[j] * visSp * dt;
        if (s[k + j] > 400) s[k + j] -= 800; else if (s[k + j] < -400) s[k + j] += 800;
      }
      out[k * 2] = s[k]; out[k * 2 + 1] = s[k + 1]; out[k * 2 + 2] = s[k + 2];
      out[k * 2 + 3] = s[k] + dir[0] * len; out[k * 2 + 4] = s[k + 1] + dir[1] * len; out[k * 2 + 5] = s[k + 2] + dir[2] * len;
    }
    a.needsUpdate = true;
  }
}

/** a small, chunky ship: a hull, swept wings, a cockpit, two engines; faces −z. The outer group holds the scale; the inner one bobs. */
function buildShip() {
  const outer = new THREE.Group();
  const g = new THREE.Group();
  outer.add(g);
  const hullM = new THREE.MeshLambertMaterial({ color: 0xc9ccd4, flatShading: true });
  const darkM = new THREE.MeshLambertMaterial({ color: 0x4a5162, flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: 0xd8643a, flatShading: true });
  const glass = new THREE.MeshBasicMaterial({ color: 0x5fd0ff });
  const wingM = new THREE.MeshLambertMaterial({ color: 0xb4b8c2, flatShading: true, side: THREE.DoubleSide });

  const hull = new THREE.Mesh(new THREE.ConeGeometry(1.1, 7, 6), hullM);
  hull.rotation.x = -Math.PI / 2;
  g.add(hull);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 2.4, 6), darkM);
  back.rotation.x = Math.PI / 2;
  back.position.z = 4.6;
  g.add(back);
  const cock = new THREE.Mesh(new THREE.SphereGeometry(0.62, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  cock.scale.set(1, 0.8, 2);
  cock.position.set(0, 0.55, 0.2);
  g.add(cock);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -1.5); wingShape.lineTo(4.6, 2.8); wingShape.lineTo(4.6, 3.8); wingShape.lineTo(0, 3.2);
  const wingG = new THREE.ExtrudeGeometry(wingShape, { depth: 0.18, bevelEnabled: false });
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(wingG, wingM);
    w.rotation.x = Math.PI / 2;
    w.scale.x = s;
    w.position.set(s * 0.5, -0.1, 0);
    g.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 1.4), accent);
    tip.position.set(s * 5.0, 0.2, 3.1);
    g.add(tip);
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.2, 6), darkM);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(s * 1.6, -0.25, 3.9);
    g.add(eng);
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.6, 2.2), accent);
  fin.position.set(0, 1.2, 4.1);
  g.add(fin);
  outer.scale.setScalar(HULL * 0.75);
  return outer;
}
