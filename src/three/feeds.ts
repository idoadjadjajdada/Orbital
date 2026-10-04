import * as THREE from 'three';
import { AU_M } from '../physics/units';
import type { View3D } from './view3d';
import type { Craft } from './fleet';
import { bodyQuat } from './ground';

/** a three.js sphere's frame (poles on y, u from −x) turned to a world's own (poles on z, longitude from +x), as its maps are laid out */
const SPHERE_TO_BODY = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));

/**
 * Monitors that show a craft's camera.
 *
 * Any monitor in a base, the station or the ship can be left showing one of
 * your craft — a rover driving, an orbiter over its world, a probe on its way
 * down — and keeps showing it while you get on with something else. Each
 * camera is drawn into a small picture of its own (256 × 160) from a tiny
 * scene: the craft, the world under it as a lit sphere wearing its map, the
 * sunlight. To keep the frame rate up it is only drawn while you are near
 * enough to see it (15 m), facing it, a few times a second at most (once a
 * second while the view is cutting its resolution to keep up), and never
 * more than one monitor in a frame; otherwise the monitor keeps the last
 * picture it got.
 */

const W = 256, H = 160, FPS = 3, NEAR = 15;

interface Monitor {
  key: string;
  mesh: THREE.Mesh;
  label: string;
  /** what it was showing before a camera was put on it */
  base: THREE.Material | THREE.Material[];
  craft: number | null;
  rt: THREE.WebGLRenderTarget | null;
  t: number;
}

export class Feeds {
  /** the monitor you were at when you opened Mission Control: its camera buttons put a craft on it */
  target: string | null = null;
  /** how many camera pictures have been drawn, all told */
  drawn = 0;
  private mons = new Map<string, Monitor>();
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(55, W / H, 0.3, 4e8);
  private world: THREE.Mesh;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private models = new Map<number, THREE.Object3D>();

  constructor(private v: View3D) {
    this.world = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.MeshLambertMaterial({ color: 0x808080 }));
    this.scene.add(this.world, this.sun, new THREE.AmbientLight(0x404a5a, 0.9));
    this.scene.background = new THREE.Color(0x02030a);
  }

  /** a monitor that can show a camera */
  register(key: string, mesh: THREE.Mesh, label: string) {
    if (this.mons.has(key)) return;
    this.mons.set(key, { key, mesh, label, base: mesh.material, craft: null, rt: null, t: -1 });
  }

  label(key: string) { return this.mons.get(key)?.label ?? 'the monitor'; }
  showing(key: string) { return this.mons.get(key)?.craft ?? null; }

  /** put a craft's camera on a monitor, or (null) take it off */
  assign(key: string, craft: number | null) {
    const m = this.mons.get(key);
    if (!m) return;
    m.craft = craft;
    m.t = -1;
    if (craft === null) { m.mesh.material = m.base; m.rt?.dispose(); m.rt = null; return; }
    if (!m.rt) {
      m.rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
      m.rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    m.mesh.material = new THREE.MeshBasicMaterial({ map: m.rt.texture, toneMapped: false });
  }

  /** each frame, before the main view is drawn: at most one camera, if one is due and in sight */
  frame(now: number) {
    if (!this.mons.size) return;
    const cam = this.v.camera, fwd = cam.getWorldDirection(new THREE.Vector3()), p = new THREE.Vector3();
    // (once a second when frames are running slow)
    const due: Monitor[] = [], fps = this.v.res.scale < 0.6 ? 1 : FPS;
    for (const m of this.mons.values()) {
      if (m.craft === null || !m.rt || now - m.t < 1 / fps) continue;
      if (!visible(m.mesh)) continue;
      m.mesh.getWorldPosition(p);
      const d = p.length();
      if (d > NEAR || (d > 1.5 && p.dot(fwd) / d < 0.2)) continue;
      due.push(m);
    }
    if (!due.length) return;
    // take turns: the one drawn longest ago
    const m = due.reduce((a, b) => (b.t < a.t ? b : a));
    const c = this.v.fleet.byId(m.craft!);
    if (!c || c.state === 'lost') { this.assign(m.key, null); return; }
    this.draw(c, m.rt!);
    m.t = now;
    this.drawn++;
  }

  /** the craft's camera: behind it and a little above, its world beneath, lit by its star */
  private draw(c: Craft, rt: THREE.WebGLRenderTarget) {
    const v = this.v, f = v.fleet, b = c.b, loc = f.local(c), q = f.quat(c);
    // the craft at the middle of this little scene, its world where it is from it
    let model = this.models.get(c.id);
    if (!model) { model = (c.mesh.children[0] ?? new THREE.Group()).clone(); this.models.set(c.id, model); this.scene.add(model); }
    for (const [id, o] of this.models) o.visible = id === c.id;
    model.quaternion.copy(q);
    model.scale.copy(c.mesh.scale);
    const R = b.r * AU_M, ground = c.state === 'surface' || c.state === 'descent' ? loc.length() - (c.state === 'descent' ? c.alt : 0) : R;
    this.world.position.copy(loc).negate();
    this.world.scale.setScalar(c.state === 'surface' || c.state === 'descent' ? ground - 0.3 : R);
    const tex = v.texOf(b), wm = this.world.material as THREE.MeshLambertMaterial;
    if (wm.map !== tex) { wm.map = tex; wm.color.set(tex ? 0xffffff : 0x808080); wm.needsUpdate = true; }
    this.world.quaternion.copy(bodyQuat(b)).multiply(SPHERE_TO_BODY);
    // sunlight from its star
    const star = v.stars()[0];
    if (star) this.sun.position.set(star.x - b.x, star.y - b.y, star.z - b.z).normalize();
    // the camera
    const U = loc.clone().normalize();
    let fw = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fw.addScaledVector(U, -fw.dot(U));
    if (fw.lengthSq() < 1e-8) fw = new THREE.Vector3(1, 0, 0).addScaledVector(U, -U.x);
    fw.normalize();
    const dist = ({ rover: 9, lander: 11, probe: 9, orbiter: 16, station: 85, base: 70, pad: 60, rocket: 40 } as Record<string, number>)[c.kind] ?? 12;
    this.cam.position.copy(fw).multiplyScalar(-dist).addScaledVector(U, dist * 0.38);
    this.cam.up.copy(U);
    this.cam.lookAt(0, 0, 0);
    const r = v.renderer, old = r.getRenderTarget();
    r.setRenderTarget(rt);
    r.render(this.scene, this.cam);
    r.setRenderTarget(old);
  }

  /** what the camera buttons in Mission Control say, for a craft */
  buttonFor(c: Craft) {
    if (!this.target) return '';
    const on = this.showing(this.target) === c.id;
    return `<button data-act="feed" data-id="${on ? -1 : c.id}">${on ? '📺 Off' : '📺 On the monitor'}</button>`;
  }
}

/** shown, all the way up? */
function visible(o: THREE.Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}
