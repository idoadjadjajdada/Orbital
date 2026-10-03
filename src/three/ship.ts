import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M, C } from '../physics/units';
import type { V3 } from '../pixel/sprites';
import { Hull } from './hull';
import { mouthMesh, tickMouth, tunnelMesh, tickTunnel } from './wormhole';

/** the speed of light, m/s */
export const C_MS = (C * AU_M) / (365.25 * 86400);
/** top speed on the ordinary drive, m/s */
export const CRUISE = 0.05 * C_MS;
/** top speed in overdrive, m/s */
export const OD_MAX = 1e4 * C_MS;
/** seconds to charge the wormhole drive, and to refill it after a transit */
export const JUMP_CHARGE = 3, JUMP_REFILL = 40;
/** how big a mouth the drive opens, m, and how far ahead of the ship */
export const MOUTH_R = 70, MOUTH_AHEAD = 500;
/** seconds to come out of the far mouth */
export const EXIT_T = 2.5;

/** where the reactor's power goes: a balance, more to the engines, or more to the wormhole drive */
export type Power = 'balanced' | 'engines' | 'wormhole';
export const POWER: Record<Power, { name: string; spool: number; reach: number; top: number; refill: number; about: string }> = {
  balanced: { name: 'Balanced', spool: 3, reach: 3, top: 1, refill: JUMP_REFILL, about: 'Overdrive and the wormhole drive share the reactor evenly.' },
  engines: { name: 'Engines', spool: 1.8, reach: 4.5, top: 1, refill: 100, about: 'Overdrive spools faster and runs closer to worlds; the wormhole drive recharges slowly.' },
  wormhole: { name: 'Wormhole drive', spool: 5, reach: 2, top: 0.75, refill: 15, about: 'The wormhole drive recharges fast; overdrive is slower to spool and tops out lower.' },
};

/** something that moves on its own: an offset (AU) from the body it rides with, and a velocity (m/s) relative to it */
export interface Mover { anchor: Body | null; off: V3; vel: V3 }

/**
 * A wormhole transit, in stages: the drive charges and opens a mouth ahead
 * (`charge`), the ship flies into it (`enter`), rides the throat (`tunnel`)
 * — longer the further it goes, a few seconds to a dozen — and comes out of
 * a second mouth near the destination, which closes behind it (`exit`). A
 * wormhole already in the sandbox skips the opening: fly into its mouth and
 * the throat takes you to its partner (`natural`).
 */
export interface Worm {
  phase: 'charge' | 'enter' | 'tunnel' | 'exit';
  t: number;
  to: Body;
  /** seconds in the throat */
  dur: number;
  natural: boolean;
  /** where the mouth is: the one going in, then the one coming out */
  mouth: Mover;
  /** the velocity to come out with, through a natural wormhole */
  keep?: V3;
}

/**
 * The ship: its drives, where it is, and how it looks.
 *
 * The ordinary drive tops out at 5% of light speed, enough to cross from a
 * world to its moons in under a minute. Overdrive is a warp: it spools up
 * over a few seconds towards ten thousand times light speed, but is held back
 * near anything massive (never faster than three times the height above the
 * nearest surface per second), so it carries you across a system and slows
 * by itself on the way in. The wormhole drive opens a way to the selected body
 * outright, but needs time to recharge between transits.
 */
export class Ship {
  readonly nav: Mover = { anchor: null, off: [0, 0, 0], vel: [0, 0, 0] };
  /** which way the ship faces: its −z is forward, +y up */
  readonly quat = new THREE.Quaternion();
  /** overdrive engaged, and how far it has spooled (0–1) */
  od = false;
  odLevel = 0;
  /** wormhole drive capacitor, 0–1; a transit needs it full */
  charge = 1;
  worm: Worm | null = null;
  /** seconds of the arrival flash left */
  flash = 0;
  /** at the helm: looking from behind the ship, or out of the bridge */
  view: 'chase' | 'cockpit' = 'chase';
  /** how hard the engines push, 0–1, for the exhaust */
  thrust = 0;
  /** a spacewalker is at the hatch */
  boardable = false;
  /** where the reactor's power goes */
  power: Power = 'balanced';

  readonly hull: Hull;
  readonly mouthIn: THREE.Group;
  readonly mouthOut: THREE.Group;
  readonly tunnel: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private ambient = new THREE.AmbientLight(0x404858, 1.4);
  private streaks: THREE.LineSegments;
  private seeds: Float32Array;

  constructor(scene: THREE.Scene, glow: THREE.Texture) {
    this.hull = new Hull(glow);
    scene.add(this.hull.group);
    this.tunnel = tunnelMesh();
    this.hull.group.add(this.tunnel);
    this.mouthIn = mouthMesh(glow);
    this.mouthOut = mouthMesh(glow);
    for (const m of [this.mouthIn, this.mouthOut]) { m.visible = false; m.traverse(o => { o.frustumCulled = false; }); scene.add(m); }
    scene.add(this.sun, this.sun.target, this.ambient);

    // streaks: short lines round the viewer, swept past along the motion
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
    const P = POWER[this.power];
    const top = CRUISE * Math.pow(OD_MAX / CRUISE, this.odLevel * P.top);
    return Math.max(CRUISE, Math.min(top, P.reach * a * this.odLevel));
  }

  /** seconds the wormhole drive takes to recharge, as the power is routed */
  refill() { return POWER[this.power].refill; }

  /** whether a transit can start now */
  ready() { return this.charge >= 1 && !this.worm; }

  /** how far the wormhole drive is wound up, 0–1, for the reactor and the exhaust */
  wormLevel() {
    const w = this.worm;
    if (!w) return 0;
    return w.phase === 'charge' ? w.t / JUMP_CHARGE : w.phase === 'exit' ? 1 - w.t / EXIT_T : 1;
  }

  /** advance the overdrive, the capacitor and the flash */
  update(dt: number) {
    this.odLevel = this.od ? Math.min(1, this.odLevel + dt / POWER[this.power].spool) : Math.max(0, this.odLevel - dt / 0.8);
    this.flash = Math.max(0, this.flash - dt);
    if (!this.worm) this.charge = Math.min(1, this.charge + dt / this.refill());
  }

  /**
   * draw the effects round the viewer: the streaks along `vel` (m/s, the
   * ship's), the light of `sun` (direction from the star, world) on the hull
   * at `at` (m from the viewer), the camera's field of view (`wide` when it
   * should widen with the warp)
   */
  draw(dt: number, camera: THREE.PerspectiveCamera, vel: V3, sun: THREE.Vector3 | null, at: THREE.Vector3, wide: boolean, tunnel: boolean) {
    const w = this.worm;
    this.hull.update(dt, { od: this.odLevel, charge: w?.phase === 'charge' ? w.t / JUMP_CHARGE : 0, worm: this.wormLevel(), tunnel, thrust: this.thrust, boardable: this.boardable });
    const now = performance.now() / 1000;
    if (w) {
      const pIn = w.phase === 'charge' ? w.t / JUMP_CHARGE : w.phase === 'enter' ? 1 : 0;
      tickMouth(this.mouthIn, now, pIn);
      tickMouth(this.mouthOut, now, w.phase === 'exit' && !w.natural ? 1 - w.t / EXIT_T : 0);
      this.tunnel.visible = w.phase === 'tunnel';
      if (this.tunnel.visible) tickTunnel(this.tunnel, now, w.t / w.dur);
    } else this.tunnel.visible = false;

    if (sun) {
      this.sun.target.position.copy(at);
      this.sun.position.copy(at).addScaledVector(sun, -100);
      this.sun.intensity = 2.2;
    } else this.sun.intensity = 0.3;

    // field of view widens with the warp
    const warp = Math.max(this.odLevel, this.wormLevel());
    const fov = wide ? 70 + 30 * warp : 70;
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }

    // streaks along the motion
    const sp = Math.hypot(vel[0], vel[1], vel[2]);
    const show = tunnel ? 0 : Math.max(this.odLevel, Math.min(1, Math.max(0, Math.log10(sp / 1e5) / 4)));
    const mat = this.streaks.material as THREE.LineBasicMaterial;
    mat.opacity = Math.min(0.9, show);
    this.streaks.visible = show > 0.02;
    if (!this.streaks.visible) return;
    const dir = sp > 0 ? [vel[0] / sp, vel[1] / sp, vel[2] / sp] : (() => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat); return [f.x, f.y, f.z]; })();
    const visSp = 60 + 3000 * show, len = 2 + 160 * show * show;
    const s = this.seeds, a = this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute;
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
