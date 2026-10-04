import * as THREE from 'three';
import { AU_M } from '../physics/units';
import type { V3 } from '../pixel/sprites';
import type { View3D } from './view3d';
import { padMesh, baseMesh } from './craftmesh';
import { bodyQuat } from './ground';
import { tangent } from './terrain';

/**
 * Choosing where to build: a see-through model of the base or launch pad
 * stands on the ground where you look, green where it can go and red where
 * it cannot (in the sea, on a slope too steep to level, on top of something
 * already there). F builds it there, facing you; Esc gives up.
 */
export class Placer {
  kind: 'base' | 'pad' | null = null;
  /** where it would go, and why not, if not */
  n: V3 | null = null;
  head = 0;
  why = '';
  private ghost: THREE.Group | null = null;
  private ok = new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.32, depthWrite: false });
  private bad = new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.32, depthWrite: false });

  constructor(private v: View3D) {}

  start(kind: 'base' | 'pad') {
    this.stop();
    this.kind = kind;
    this.ghost = kind === 'pad' ? padMesh() : baseMesh(1);
    this.ghost.traverse(o => { o.frustumCulled = false; });
    this.v.ground.root.add(this.ghost);
    this.v.app.onToast(`Look at where the ${kind === 'pad' ? 'launch pad' : 'base'} should go: F builds it there, Esc cancels`);
  }

  stop() {
    if (this.ghost) this.v.ground.root.remove(this.ghost);
    this.ghost = null;
    this.kind = null;
    this.n = null;
  }

  /** each frame: find the ground under the crosshair */
  frame() {
    const v = this.v, g = v.ground, b = g.body, spec = g.spec;
    if (!this.kind || !this.ghost) return;
    if (!b || !spec) { this.stop(); return; }
    const P = v.where(), qi = bodyQuat(b).invert();
    const o = new THREE.Vector3((P[0] - b.x) * AU_M, (P[1] - b.y) * AU_M, (P[2] - b.z) * AU_M).applyQuaternion(qi);
    const d = v.camera.getWorldDirection(new THREE.Vector3()).applyQuaternion(qi);
    // march along the line of sight to the ground, then home in on it
    const above = (t: number) => { const p = o.clone().addScaledVector(d, t), r = p.length(); return r - spec.R - Math.max(0, g.heightAt([p.x / r, p.y / r, p.z / r], 2)); };
    let t0 = 0, t1 = -1;
    for (let t = 2; t < 3000; t += Math.max(1, t * 0.04)) { if (above(t) < 0) { t1 = t; break; } t0 = t; }
    if (t1 < 0) { this.ghost.visible = false; this.n = null; this.why = 'Look at the ground'; return; }
    for (let k = 0; k < 12; k++) { const m = (t0 + t1) / 2; if (above(m) < 0) t1 = m; else t0 = m; }
    // its near edge where you look, the rest beyond
    const hit = o.clone().addScaledVector(d, t1), upv = hit.clone().normalize();
    const flat = d.clone().addScaledVector(upv, -d.dot(upv));
    if (flat.lengthSq() > 1e-6) hit.addScaledVector(flat.normalize(), this.kind === 'pad' ? 22 : 28);
    const p = hit.normalize();
    const n: V3 = [p.x, p.y, p.z];
    // facing you
    const [e, nn] = tangent(n), to = o.clone().sub(p.clone().multiplyScalar(o.length())).normalize();
    this.head = Math.atan2(-(to.x * e[0] + to.y * e[1] + to.z * e[2]), to.x * nn[0] + to.y * nn[1] + to.z * nn[2]) + Math.PI;
    this.n = n;
    // can it go here?
    const h = g.heightAt(n, 1), sea = g.last_sample.sea, up = g.normalAt(n, 15);
    const slope = Math.acos(Math.min(1, up[0] * n[0] + up[1] * n[1] + up[2] * n[2]));
    const near = v.fleet.crafts.find(c => c.b === b && (c.kind === 'base' || c.kind === 'pad') && Math.acos(Math.min(1, c.n[0] * n[0] + c.n[1] * n[1] + c.n[2] * n[2])) * spec.R < 90);
    this.why = sea ? 'That is water' : slope > 0.3 ? 'Too steep to level' : near ? `Too close to ${near.name}` : '';
    // the model, standing there
    const r = spec.R + (sea ? 0 : h);
    this.ghost.visible = true;
    this.ghost.position.set(n[0] * r, n[1] * r, n[2] * r);
    this.ghost.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.head));
    const mat = this.why ? this.bad : this.ok;
    this.ghost.traverse(x => { if ((x as THREE.Mesh).isMesh) (x as THREE.Mesh).material = mat; });
  }

  /** F: build it here */
  confirm() {
    const v = this.v, b = v.ground.body;
    if (!this.kind || !b) return;
    if (!this.n) { v.app.onToast('Look at the ground where it should go'); return; }
    if (this.why) { v.app.onToast(this.why); return; }
    const c = v.fleet.build(this.kind, b, this.n, this.head);
    v.app.onToast(`${c.name}: building, about twenty seconds`);
    this.stop();
  }

  prompt(): { label: string; act: () => void } | null {
    if (!this.kind) return null;
    return { label: this.why || `Build the ${this.kind === 'pad' ? 'launch pad' : 'base'} here`, act: () => this.confirm() };
  }
}
