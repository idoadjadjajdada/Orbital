import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The ship you fly, inside and out, in metres: x to starboard, y up, z aft, so
 * the nose points along −z. It is about 55 m from the nose to the nozzles,
 * built from slabs that are hull plating on the outside and wall panels on
 * the inside, so the same walls are seen from both sides and the windows are
 * real gaps you can look through either way.
 *
 * Forward to aft: the bridge (helm, consoles, a holographic nav table), a
 * short passage, the commons (a skylight, a telescope at the starboard
 * window, a couch facing the port window, a shelf of souvenirs from the
 * worlds you have been to, a coffee machine, the airlock to port), another
 * passage, and engineering (the reactor, with the wormhole drive's ring
 * round it).
 */

export type StationId = 'helm' | 'nav' | 'scope' | 'airlock' | 'shelf' | 'coffee' | 'reactor' | 'couch';
export interface Station { id: StationId; at: THREE.Vector3; label: string; reach: number }
interface Rect { x0: number; x1: number; z0: number; z1: number }
interface Hole { a0: number; a1: number; y0: number; y1: number; glass?: boolean }
type Wall = Hole[] | 'open';

/** what the hull shows: the state of the drives */
export interface HullState { od: number; charge: number; worm: number; tunnel: boolean; thrust: number; boardable: boolean }

const T = 0.25;
/** where the eye is, seated at the helm */
export const HELM_EYE = new THREE.Vector3(0, 1.75, -21.1);
/** the chase camera, behind and above */
export const CHASE_EYE = new THREE.Vector3(0, 12, 64);
/** the telescope's eyepiece */
export const SCOPE_EYE = new THREE.Vector3(5.2, 1.5, 1.75);
/** outside the airlock hatch, and just inside it */
export const HATCH_OUT = new THREE.Vector3(-9.2, 1.4, 0);
export const HATCH_IN = new THREE.Vector3(-7.4, 0, 0);
/** the couch: where the eye is when sitting on it */
export const COUCH_EYE = new THREE.Vector3(-3.9, 1.15, -5);

export class Hull {
  readonly group = new THREE.Group();
  readonly stations: Station[] = [];
  private walk: Rect[] = [];
  private blocks: Rect[] = [];
  private rounds: { x: number; z: number; r: number }[] = [];
  /** coarse boxes of the outside, to keep a spacewalker out of the hull */
  private solids: THREE.Box3[] = [];

  private mat = {
    hull: new THREE.MeshLambertMaterial({ color: 0xc9ccd4, flatShading: true }),
    dark: new THREE.MeshLambertMaterial({ color: 0x4a5162, flatShading: true }),
    accent: new THREE.MeshLambertMaterial({ color: 0xd8643a, flatShading: true }),
    wall: new THREE.MeshLambertMaterial({ color: 0x8c96aa, flatShading: true }),
    floor: new THREE.MeshLambertMaterial({ color: 0x3b4352, flatShading: true }),
    ceil: new THREE.MeshLambertMaterial({ color: 0x5c6577, flatShading: true }),
    trim: new THREE.MeshLambertMaterial({ color: 0x2a303c, flatShading: true }),
    cloth: new THREE.MeshLambertMaterial({ color: 0x3f6a8a, flatShading: true }),
    wood: new THREE.MeshLambertMaterial({ color: 0x8a6440, flatShading: true }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x4f9a4a, flatShading: true }),
    glass: new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff1d0 }),
    cyan: new THREE.MeshBasicMaterial({ color: 0x5fd0ff }),
    stripe: new THREE.MeshBasicMaterial({ color: 0xe8c040 }),
  };

  // animated parts
  private core: THREE.MeshBasicMaterial;
  private coreRings: THREE.Mesh[] = [];
  private wormRing: THREE.Mesh;
  private wormMat: THREE.MeshBasicMaterial;
  private lights: { l: THREE.PointLight; base: THREE.Color; k: number }[] = [];
  private navLights: THREE.Sprite[] = [];
  private hatchLight: THREE.MeshBasicMaterial;
  private holo: THREE.Points;
  private holoRing: THREE.Mesh;
  private screen: { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string };
  private trophySlots: THREE.Vector3[] = [];
  private trophies: THREE.Mesh[] = [];
  readonly flames: THREE.Sprite[] = [];
  private t = 0;

  constructor(glow: THREE.Texture) {
    const g = this.group;
    // ---- rooms
    const door = (a: number): Hole => ({ a0: a - 1.2, a1: a + 1.2, y0: 0, y1: 2.4 });
    // bridge
    this.room({ x0: -4.5, x1: 4.5, z0: -24, z1: -14 }, 3, {
      n: [{ a0: -4.2, a1: 4.2, y0: 0.5, y1: 2.85, glass: true }],
      s: [door(0)],
      w: [{ a0: -22, a1: -16.5, y0: 1.0, y1: 2.4, glass: true }],
      e: [{ a0: -22, a1: -16.5, y0: 1.0, y1: 2.4, glass: true }],
    });
    // passage forward
    this.room({ x0: -1.2, x1: 1.2, z0: -14, z1: -8 }, 3, {
      n: 'open', s: 'open',
      w: [{ a0: -12, a1: -10, y0: 1.2, y1: 2.0, glass: true }],
      e: [{ a0: -12, a1: -10, y0: 1.2, y1: 2.0, glass: true }],
    });
    // commons, with a skylight
    this.room({ x0: -6, x1: 6, z0: -8, z1: 4 }, 3, {
      n: [door(0)], s: [door(0)],
      w: [{ a0: -7, a1: -2.8, y0: 0.9, y1: 2.5, glass: true }, door(0)],
      e: [{ a0: -7, a1: -2.8, y0: 0.9, y1: 2.5, glass: true }, { a0: 0, a1: 3.5, y0: 0.9, y1: 2.5, glass: true }],
    }, { x0: -3, x1: 3, z0: -5, z1: 1 });
    // passage aft
    this.room({ x0: -1.2, x1: 1.2, z0: 4, z1: 8 }, 3, { n: 'open', s: 'open', w: [], e: [] });
    // engineering, taller
    this.room({ x0: -4.5, x1: 4.5, z0: 8, z1: 18 }, 4.2, { n: [door(0)], s: [], w: [], e: [] });
    // airlock, off the commons to port
    this.room({ x0: -8.6, x1: -6.25, z0: -1.6, z1: 1.6 }, 3, { n: [], s: [], w: [], e: 'open' });
    this.walk.push({ x0: -7.2, x1: -4.8, z0: -1.2, z1: 1.2 }, { x0: -1.2, x1: 1.2, z0: -15.2, z1: -6.8 }, { x0: -1.2, x1: 1.2, z0: 2.8, z1: 9.2 });

    // ---- the outside
    const M = this.mat;
    this.box(-4, 4, -1.9, -T, -23.5, 17.8, M.dark, true);
    this.box(-5.6, 5.6, -1.6, -T, -7.6, 3.6, M.hull, true);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(4.4, 8, 4), M.hull);
    nose.geometry.rotateY(Math.PI / 4);
    nose.geometry.rotateX(-Math.PI / 2);
    nose.scale.set(1, 0.42, 1);
    nose.position.set(0, -0.75, -28.2);
    g.add(nose);
    this.solids.push(new THREE.Box3(new THREE.Vector3(-3.5, -2, -32), new THREE.Vector3(3.5, 0.6, -24)));
    // a spine and stripes
    this.box(-0.7, 0.7, 3 + T, 3.6, -13.5, -8.5, M.accent, false);
    for (const s of [1, -1]) this.box(s > 0 ? 6 + T : -6.3, s > 0 ? 6.3 : -6 - T, 2.55, 2.75, -8, 4, M.accent, false);
    // wings and their pods
    const wing = new THREE.Shape();
    wing.moveTo(0, 8); wing.lineTo(11.5, 14.5); wing.lineTo(11.5, 18.2); wing.lineTo(0, 18);
    const wingG = new THREE.ExtrudeGeometry(wing, { depth: 0.35, bevelEnabled: false });
    wingG.rotateX(Math.PI / 2);
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(wingG, M.hull);
      w.scale.x = s;
      w.position.set(s * 4.7, 0.9, 0);
      g.add(w);
      this.solids.push(new THREE.Box3(new THREE.Vector3(s > 0 ? 4.7 : -16.2, 0.4, 10), new THREE.Vector3(s > 0 ? 16.2 : -4.7, 1.0, 18.4)));
      this.box(s * 15.6 - 0.5, s * 15.6 + 0.5, 0.2, 1.6, 13.5, 19, M.accent, true);
      const nl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: s > 0 ? 0x40ff70 : 0xff3030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      nl.position.set(s * 16.3, 0.9, 13.4);
      nl.scale.setScalar(2.4);
      g.add(nl);
      this.navLights.push(nl);
    }
    // engines
    for (const [x, y] of [[-2.6, 0.6], [2.6, 0.6], [0, 2.6]] as const) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 6, 8), M.dark);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(x, y, 21);
      g.add(eng);
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 8), this.mat.cyan);
      noz.rotation.x = Math.PI / 2;
      noz.position.set(x, y, 24.05);
      g.add(noz);
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x7fb4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      f.position.set(x, y, 25.2);
      g.add(f);
      this.flames.push(f);
    }
    this.solids.push(new THREE.Box3(new THREE.Vector3(-4, -0.8, 18), new THREE.Vector3(4, 3.8, 24.2)));
    // a fin and a dish
    this.box(-0.15, 0.15, 4.2 + T, 8, 11.5, 18.5, M.accent, true);
    const dishPost = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6), M.dark);
    dishPost.position.set(4.2, 3.85, 2.2);
    const dish = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.5, 10, 1, true), M.hull);
    dish.material = new THREE.MeshLambertMaterial({ color: 0xc9ccd4, flatShading: true, side: THREE.DoubleSide });
    dish.position.set(4.2, 4.6, 2.2);
    dish.rotation.set(Math.PI * 0.8, 0, 0.4);
    g.add(dishPost, dish);
    // the hatch, seen from outside
    const hatch = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.12, 6, 16), M.accent);
    hatch.rotation.y = Math.PI / 2;
    hatch.position.set(-8.6 - T - 0.05, 1.3, 0);
    this.hatchLight = new THREE.MeshBasicMaterial({ color: 0x40ff70 });
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.25), this.hatchLight);
    hl.position.set(-8.6 - T - 0.08, 2.6, 0);
    g.add(hatch, hl);

    // ---- the bridge
    // helm chair
    this.box(-0.45, 0.45, 0.45, 0.6, -21.4, -20.6, M.cloth, false);
    this.box(-0.45, 0.45, 0.6, 1.7, -20.6, -20.4, M.cloth, false);
    this.box(-0.12, 0.12, 0, 0.45, -21.1, -20.9, M.trim, false);
    for (const s of [1, -1]) this.box(s * 0.45 - 0.08, s * 0.45 + 0.08, 0.6, 0.85, -21.4, -20.7, M.trim, false);
    this.rounds.push({ x: 0, z: -20.9, r: 0.55 });
    this.station('helm', new THREE.Vector3(0, 0.9, -20.9), 'Take the helm', 2.2);
    // console with a live screen
    this.box(-2.6, 2.6, 0, 0.7, -24, -22.9, M.trim, false);
    const cv = document.createElement('canvas');
    cv.width = 192; cv.height = 64;
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    this.screen = { cv, tex, key: '' };
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4), new THREE.MeshBasicMaterial({ map: tex }));
    scr.position.set(0, 0.86, -23.5);
    scr.rotation.x = -0.95;
    g.add(scr);
    this.box(-0.8, 0.8, 0.7, 0.74, -23.9, -23.2, M.trim, false);
    this.blocks.push({ x0: -2.6, x1: 2.6, z0: -24, z1: -22.8 });
    // side stations, with static readouts
    for (const s of [1, -1]) {
      this.box(s > 0 ? 3.4 : -4.5, s > 0 ? 4.5 : -3.4, 0, 1.0, -21.5, -17.5, M.trim, false);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.6), new THREE.MeshBasicMaterial({ map: graphTexture(s) }));
      p.position.set(s * 3.42, 1.35, -19.5);
      p.rotation.y = -s * Math.PI / 2;
      p.rotation.x = 0;
      g.add(p);
      this.blocks.push({ x0: s > 0 ? 3.3 : -4.5, x1: s > 0 ? 4.5 : -3.3, z0: -21.6, z1: -17.4 });
      this.plant(s * 3.9, -14.7);
    }
    // the nav table, with a hologram of what is round the ship
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 0.9, 10), M.trim);
    ped.position.set(0, 0.45, -16.4);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 20), M.cyan);
    top.position.set(0, 0.93, -16.4);
    g.add(ped, top);
    this.holo = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true }));
    this.holo.position.set(0, 1.75, -16.4);
    this.holo.frustumCulled = false;
    this.holoRing = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.012, 4, 48), new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.6 }));
    this.holoRing.position.copy(this.holo.position);
    this.holoRing.rotation.x = Math.PI / 2;
    g.add(this.holo, this.holoRing);
    this.rounds.push({ x: 0, z: -16.4, r: 1.0 });
    this.station('nav', new THREE.Vector3(0, 1.3, -16.4), 'Plot a course', 2.6);
    this.lamp(0, 3, -19, 0xfff1d0, 1, 26);

    // ---- the commons
    // the couch facing the port window, and a low table
    this.box(-4.4, -3.4, 0.2, 0.55, -6.6, -3.4, M.cloth, false);
    this.box(-3.4, -3.15, 0.2, 1.3, -6.6, -3.4, M.cloth, false);
    this.box(-4.4, -3.15, 0, 0.2, -6.6, -3.4, M.trim, false);
    this.blocks.push({ x0: -4.5, x1: -3.1, z0: -6.7, z1: -3.3 });
    this.station('couch', new THREE.Vector3(-3.9, 0.6, -5), 'Sit and watch', 2.2);
    this.box(-5.2, -4.8, 0, 0.45, -5.6, -4.4, M.wood, false);
    this.blocks.push({ x0: -5.3, x1: -4.7, z0: -5.7, z1: -4.3 });
    // shelves of souvenirs either side of the forward door
    for (const s of [1, -1]) {
      const x0 = s > 0 ? 2 : -5.8, x1 = s > 0 ? 5.8 : -2;
      for (const y of [0.9, 1.7]) this.box(x0, x1, y - 0.06, y, -8, -7.5, M.wood, false);
      this.box(x0, x1, 0, 0.5, -8, -7.5, M.trim, false);
      for (const y of [0.9, 1.7]) for (const x of [0.25, 0.75]) this.trophySlots.push(new THREE.Vector3(x0 + (x1 - x0) * x, y + 0.2, -7.75));
      this.blocks.push({ x0, x1, z0: -8, z1: -7.4 });
      this.station('shelf', new THREE.Vector3((x0 + x1) / 2, 1.3, -7.75), 'Look at the souvenirs', 2.4);
    }
    // the telescope at the starboard window
    const tri = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.35, 1.2, 3), M.trim);
    tri.position.set(5.1, 0.6, 1.75);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.5, 8), M.accent);
    tube.rotation.z = Math.PI / 2 - 0.25;
    tube.position.set(5.2, 1.4, 1.75);
    g.add(tri, tube);
    this.rounds.push({ x: 5.1, z: 1.75, r: 0.55 });
    this.station('scope', new THREE.Vector3(5.0, 1.4, 1.75), 'Look through the telescope', 2.2);
    // the coffee machine
    this.box(-5.95, -5.1, 0, 0.95, 2.9, 3.95, M.trim, false);
    this.box(-5.95, -5.25, 0.95, 1.6, 3.0, 3.85, M.hull, false);
    this.box(-5.3, -5.24, 1.3, 1.36, 3.3, 3.4, M.lamp, false);
    this.blocks.push({ x0: -6, x1: -5.0, z0: 2.8, z1: 4 });
    this.station('coffee', new THREE.Vector3(-5.4, 1.2, 3.4), 'Make a coffee', 2.0);
    this.plant(5.4, 3.4);
    this.lamp(0, 2.9, -6, 0xfff1d0, 1, 22);
    this.lamp(0, 2.9, 2.6, 0xffe0c0, 1, 18);

    // ---- the airlock
    for (let k = 0; k < 6; k++) this.box(-8.4 + k * 0.36, -8.24 + k * 0.36, 0.005, 0.02, -1.5, 1.5, k % 2 ? M.trim : M.stripe, false);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.12, 16), M.hull);
    inner.rotation.z = Math.PI / 2;
    inner.position.set(-8.55, 1.3, 0);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 4, 12), M.accent);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(-8.45, 1.3, 0);
    g.add(inner, wheel);
    this.station('airlock', new THREE.Vector3(-8.4, 1.3, 0), 'Step outside', 2.4);
    this.lamp(-6.8, 2.8, 0, 0xffc070, 0.22, 6);

    // ---- engineering
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4.2, 16, 1, true), M.glass);
    glass.position.set(0, 2.1, 13);
    this.core = new THREE.MeshBasicMaterial({ color: 0x70e0ff });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 4.2, 10), this.core);
    core.position.set(0, 2.1, 13);
    g.add(glass, core);
    for (let k = 0; k < 3; k++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.05, 4, 20), this.core);
      r.rotation.x = Math.PI / 2;
      r.position.set(0, 0, 13);
      g.add(r);
      this.coreRings.push(r);
    }
    this.wormMat = new THREE.MeshBasicMaterial({ color: 0x9a70ff });
    this.wormRing = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.13, 6, 6), this.wormMat);
    this.wormRing.rotation.x = Math.PI / 2;
    this.wormRing.position.set(0, 2.2, 13);
    g.add(this.wormRing);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.04, 4, 24), M.accent);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(0, 1.0, 13);
    g.add(rail);
    for (let a = 0; a < 8; a++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 4), M.trim);
      post.position.set(1.8 * Math.cos((a * Math.PI) / 4), 0.5, 13 + 1.8 * Math.sin((a * Math.PI) / 4));
      g.add(post);
    }
    this.rounds.push({ x: 0, z: 13, r: 1.95 });
    this.station('reactor', new THREE.Vector3(0, 1.6, 13), 'Check the drives', 3.2);
    // pipes, a bench, crates, the drive's console
    for (const s of [1, -1]) for (const y of [3.2, 3.6]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 10, 6), M.dark);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(s * 4.3, y, 13);
      g.add(pipe);
    }
    this.box(3.5, 4.5, 0, 0.9, 9, 12, M.wood, false);
    this.blocks.push({ x0: 3.4, x1: 4.5, z0: 8.9, z1: 12.1 });
    this.box(-4.5, -3.3, 0, 1.1, 15.6, 16.8, M.wood, false);
    this.box(-4.5, -3.6, 0, 0.8, 16.8, 18, M.wood, false);
    this.box(-4.2, -3.5, 1.1, 1.7, 15.9, 16.6, M.dark, false);
    this.blocks.push({ x0: -4.5, x1: -3.2, z0: 15.5, z1: 18 });
    this.box(-1.6, 1.6, 0, 1.1, 17.2, 18, M.trim, false);
    this.box(-1.4, 1.4, 1.1, 1.9, 17.8, 17.95, this.wormMat, false);
    this.blocks.push({ x0: -1.7, x1: 1.7, z0: 17.1, z1: 18 });
    this.lamp(0, 3.9, 10, 0x80e0ff, 1, 22);

    // a few hundred boxes cost a draw each: the ones that never move are merged, one mesh a material
    this.merge(new Set<THREE.Object3D>([...this.coreRings, this.wormRing, this.holoRing]));
    g.traverse(o => { o.frustumCulled = false; });
  }

  /** merge the still meshes, by material, into one each */
  private merge(keep: Set<THREE.Object3D>) {
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const still = this.group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && !keep.has(o));
    for (const m of still) {
      m.updateMatrix();
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
      // a mirrored mesh turns its triangles inside out: put them back
      if (m.matrix.determinant() < 0) flipWinding(geo);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const parts = Array.isArray(m.material) && geo.groups.length ? geo.groups.map(gr => ({ mat: mats[gr.materialIndex ?? 0], geo: slice(geo, gr.start, gr.count) })) : [{ mat: mats[0], geo }];
      for (const p of parts) {
        for (const k of Object.keys(p.geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') p.geo.deleteAttribute(k);
        if (!buckets.has(p.mat)) buckets.set(p.mat, []);
        buckets.get(p.mat)!.push(p.geo);
      }
      this.group.remove(m);
    }
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos);
      if (merged) this.group.add(new THREE.Mesh(merged, mat));
      for (const g of geos) g.dispose();
    }
  }

  /** a room: floor, ceiling and four walls, each with its doors and windows */
  private room(r: Rect, H: number, w: { n: Wall; s: Wall; w: Wall; e: Wall }, sky?: Rect) {
    const M = this.mat;
    this.walk.push(r);
    this.solids.push(new THREE.Box3(new THREE.Vector3(r.x0 - T, -T, r.z0 - T), new THREE.Vector3(r.x1 + T, H + T, r.z1 + T)));
    this.slab(r.x0 - T, r.x1 + T, -T, 0, r.z0 - T, r.z1 + T, 2, M.floor);
    // the ceiling, round a skylight
    const parts = sky ? [
      { x0: r.x0 - T, x1: r.x1 + T, z0: r.z0 - T, z1: sky.z0 },
      { x0: r.x0 - T, x1: r.x1 + T, z0: sky.z1, z1: r.z1 + T },
      { x0: r.x0 - T, x1: sky.x0, z0: sky.z0, z1: sky.z1 },
      { x0: sky.x1, x1: r.x1 + T, z0: sky.z0, z1: sky.z1 },
    ] : [{ x0: r.x0 - T, x1: r.x1 + T, z0: r.z0 - T, z1: r.z1 + T }];
    for (const p of parts) this.slab(p.x0, p.x1, H, H + T, p.z0, p.z1, 3, M.ceil);
    if (sky) {
      this.box(sky.x0, sky.x1, H + T / 2 - 0.01, H + T / 2 + 0.01, sky.z0, sky.z1, M.glass, false);
      for (let x = sky.x0 + 1.5; x < sky.x1; x += 1.5) this.box(x - 0.06, x + 0.06, H, H + T, sky.z0, sky.z1, M.trim, false);
    }
    // the walls: along x for the fore and aft ones, along z for the sides
    const side = (holes: Wall, a0: number, a1: number, piece: (b0: number, b1: number, y0: number, y1: number) => void, pane: (b0: number, b1: number, y0: number, y1: number) => void) => {
      if (holes === 'open') return;
      let at = a0;
      for (const h of [...holes].sort((p, q) => p.a0 - q.a0)) {
        if (h.a0 > at) piece(at, h.a0, 0, H);
        if (h.y0 > 0) piece(h.a0, h.a1, 0, h.y0);
        if (h.y1 < H) piece(h.a0, h.a1, h.y1, H);
        if (h.glass) pane(h.a0, h.a1, h.y0, h.y1);
        else this.frame(h, holes === w.n || holes === w.s ? 'x' : 'z', holes === w.n ? r.z0 - T : holes === w.s ? r.z1 : holes === w.w ? r.x0 - T : r.x1);
        at = h.a1;
      }
      if (a1 > at) piece(at, a1, 0, H);
    };
    side(w.n, r.x0 - T, r.x1 + T, (b0, b1, y0, y1) => this.slab(b0, b1, y0, y1, r.z0 - T, r.z0, 4, M.wall), (b0, b1, y0, y1) => this.box(b0, b1, y0, y1, r.z0 - T / 2 - 0.01, r.z0 - T / 2 + 0.01, M.glass, false));
    side(w.s, r.x0 - T, r.x1 + T, (b0, b1, y0, y1) => this.slab(b0, b1, y0, y1, r.z1, r.z1 + T, 5, M.wall), (b0, b1, y0, y1) => this.box(b0, b1, y0, y1, r.z1 + T / 2 - 0.01, r.z1 + T / 2 + 0.01, M.glass, false));
    side(w.w, r.z0, r.z1, (b0, b1, y0, y1) => this.slab(r.x0 - T, r.x0, y0, y1, b0, b1, 0, M.wall), (b0, b1, y0, y1) => this.box(r.x0 - T / 2 - 0.01, r.x0 - T / 2 + 0.01, y0, y1, b0, b1, M.glass, false));
    side(w.e, r.z0, r.z1, (b0, b1, y0, y1) => this.slab(r.x1, r.x1 + T, y0, y1, b0, b1, 1, M.wall), (b0, b1, y0, y1) => this.box(r.x1 + T / 2 - 0.01, r.x1 + T / 2 + 0.01, y0, y1, b0, b1, M.glass, false));
    // a strip of light along the middle of the ceiling
    const lx = (r.x0 + r.x1) / 2, lz = (r.z0 + r.z1) / 2;
    if (r.x1 - r.x0 < r.z1 - r.z0 || !sky) this.box(lx - 0.12, lx + 0.12, H - 0.04, H, r.z0 + 0.6, r.z1 - 0.6, M.lamp, false);
    else this.box(r.x0 + 0.6, r.x1 - 0.6, H - 0.04, H, lz + 4, lz + 4.2, M.lamp, false);
  }

  /** a door frame in the accent colour */
  private frame(h: Hole, along: 'x' | 'z', lo: number) {
    const M = this.mat.accent, d = 0.08, a = lo - d, b = lo + T + d;
    if (along === 'x') {
      this.box(h.a0, h.a0 + 0.1, 0, h.y1, a, b, M, false);
      this.box(h.a1 - 0.1, h.a1, 0, h.y1, a, b, M, false);
      this.box(h.a0, h.a1, h.y1 - 0.1, h.y1, a, b, M, false);
    } else {
      this.box(a, b, 0, h.y1, h.a0, h.a0 + 0.1, M, false);
      this.box(a, b, 0, h.y1, h.a1 - 0.1, h.a1, M, false);
      this.box(a, b, h.y1 - 0.1, h.y1, h.a0, h.a1, M, false);
    }
  }

  /** a slab of hull: plating outside, `inner` (a box face: +x −x +y −y +z −z) panelled */
  private slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, inner: number, m: THREE.Material) {
    const mats: THREE.Material[] = Array(6).fill(this.mat.hull);
    mats[inner] = m;
    this.add(x0, x1, y0, y1, z0, z1, mats);
  }

  private box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material, solid: boolean) {
    this.add(x0, x1, y0, y1, z0, z1, m);
    if (solid) this.solids.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
  }

  private add(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material | THREE.Material[]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.group.add(mesh);
    return mesh;
  }

  private plant(x: number, z: number) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.5, 6), this.mat.accent);
    pot.position.set(x, 0.25, z);
    this.group.add(pot);
    for (let k = 0; k < 5; k++) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.3), this.mat.leaf);
      leaf.position.set(x + Math.cos(k * 1.26) * 0.15, 0.8, z + Math.sin(k * 1.26) * 0.15);
      leaf.rotation.set(Math.sin(k * 1.26) * 0.5, k * 1.26, Math.cos(k * 1.26) * 0.5);
      this.group.add(leaf);
    }
    this.rounds.push({ x, z, r: 0.38 });
  }

  private lamp(x: number, y: number, z: number, color: number, k: number, dist: number) {
    const l = new THREE.PointLight(color, 14 * k, dist, 1.4);
    l.position.set(x, y, z);
    this.group.add(l);
    this.lights.push({ l, base: new THREE.Color(color), k: 14 * k });
  }

  private station(id: StationId, at: THREE.Vector3, label: string, reach: number) {
    this.stations.push({ id, at, label, reach });
  }

  // ---------------------------------------------------------------- walking
  /** can someone of radius `r` stand at (x, z) on the deck? */
  canStand(x: number, z: number, r = 0.3) {
    if (!this.walk.some(w => x > w.x0 + r && x < w.x1 - r && z > w.z0 + r && z < w.z1 - r)) return false;
    if (this.blocks.some(b => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r)) return false;
    return !this.rounds.some(c => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2);
  }

  /** the station someone at `eye` looking along `dir` (ship coordinates) can use */
  facing(eye: THREE.Vector3, dir: THREE.Vector3): Station | null {
    let best: Station | null = null, score = Infinity;
    const d = new THREE.Vector3();
    for (const s of this.stations) {
      d.subVectors(s.at, eye);
      const flat = Math.hypot(d.x, d.z);
      if (flat > s.reach) continue;
      const ang = d.angleTo(dir);
      if (ang > 0.6) continue;
      const sc = ang + flat * 0.08;
      if (sc < score) { score = sc; best = s; }
    }
    return best;
  }

  /** push a point (ship coordinates) out of the hull, for a spacewalker of radius `r` */
  pushOut(p: THREE.Vector3, r = 0.6) {
    let hit = false;
    for (const b of this.solids) {
      if (p.x < b.min.x - r || p.x > b.max.x + r || p.y < b.min.y - r || p.y > b.max.y + r || p.z < b.min.z - r || p.z > b.max.z + r) continue;
      const opts = [[b.min.x - r - p.x, 0], [b.max.x + r - p.x, 0], [b.min.y - r - p.y, 1], [b.max.y + r - p.y, 1], [b.min.z - r - p.z, 2], [b.max.z + r - p.z, 2]];
      let m = opts[0];
      for (const o of opts) if (Math.abs(o[0]) < Math.abs(m[0])) m = o;
      p.setComponent(m[1], p.getComponent(m[1]) + m[0]);
      hit = true;
    }
    return hit;
  }

  // ---------------------------------------------------------------- live parts
  /** the bridge console: a few lines of readout */
  drawScreen(lines: string[]) {
    const key = lines.join('|');
    if (key === this.screen.key) return;
    this.screen.key = key;
    const { cv, tex } = this.screen, g = cv.getContext('2d')!;
    g.fillStyle = '#04121c';
    g.fillRect(0, 0, cv.width, cv.height);
    g.font = '10px monospace';
    g.textBaseline = 'top';
    lines.forEach((l, k) => { g.fillStyle = k === 0 ? '#ffe2a8' : '#7fe0ff'; g.fillText(l, 6, 4 + k * 12); });
    tex.needsUpdate = true;
  }

  /** the hologram over the nav table: points in ship coordinates, within a metre of its centre */
  setHolo(pos: number[], col: number[]) {
    const g = this.holo.geometry;
    const n = pos.length / 3;
    let a = g.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!a || a.count < n) {
      const cap = Math.max(32, n * 2);
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      a = g.getAttribute('position') as THREE.BufferAttribute;
    }
    (a.array as Float32Array).set(pos);
    ((g.getAttribute('color') as THREE.BufferAttribute).array as Float32Array).set(col);
    a.needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, n);
  }

  /** small globes on the shelves, one per world visited, wearing its surface */
  setTrophies(maps: THREE.Texture[]) {
    for (const t of this.trophies) { this.group.remove(t); (t.material as THREE.Material).dispose(); }
    this.trophies = maps.slice(0, this.trophySlots.length).map((tex, k) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshLambertMaterial({ map: tex }));
      m.position.copy(this.trophySlots[k]);
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
  }

  update(dt: number, s: HullState) {
    this.t += dt;
    const t = this.t;
    // the reactor runs hotter and faster with the drives
    const rate = 1 + 3 * s.od + 6 * s.worm;
    this.coreRings.forEach((r, k) => { r.position.y = ((t * 0.6 * rate + k / 3) % 1) * 4.2; });
    this.core.color.setHSL(s.worm > 0.05 ? 0.75 : 0.53 - 0.1 * s.od, 0.8, 0.6 + 0.15 * Math.sin(t * 3 * rate));
    this.wormRing.rotation.z += dt * (0.3 + 12 * s.worm);
    this.wormMat.color.setHSL(0.74, 0.8, 0.25 + 0.45 * Math.max(s.charge, s.worm));
    // in the throat, the lights go violet and pulse
    for (const { l, base, k } of this.lights) {
      if (s.tunnel) { l.color.setHSL(0.76, 0.7, 0.6); l.intensity = k * (0.6 + 0.4 * Math.sin(t * 6)); }
      else { l.color.copy(base); l.intensity = k; }
    }
    const blink = Math.sin(t * 4) > 0.6 ? 1 : 0.15;
    for (const n of this.navLights) n.material.opacity = blink;
    this.hatchLight.color.setHex(s.boardable ? (Math.sin(t * 6) > 0 ? 0x40ff70 : 0x103018) : 0x40ff70);
    this.holo.rotation.y = 0;
    this.holoRing.rotation.z += dt * 0.4;
    this.trophies.forEach((m, k) => { m.rotation.y = t * 0.3 + k; });
    const f = 1.4 + 3 * s.thrust + 3 * s.od;
    for (const fl of this.flames) {
      fl.scale.setScalar(f * (0.92 + 0.08 * Math.sin(t * 30 + fl.position.x)));
      fl.material.color.setHex(s.worm > 0.05 ? 0xc890ff : s.od > 0.05 ? 0xe0e8ff : 0x7fb4ff);
    }
  }
}

/** part of a non-indexed geometry, as its own geometry */
function slice(g: THREE.BufferGeometry, start: number, count: number) {
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) {
    const n = a.itemSize;
    out.setAttribute(k, new THREE.BufferAttribute((a.array as Float32Array).slice(start * n, (start + count) * n), n));
  }
  return out;
}

/** swap the second and third corner of every triangle */
function flipWinding(g: THREE.BufferGeometry) {
  for (const a of Object.values(g.attributes)) {
    const arr = a.array as Float32Array, n = a.itemSize;
    for (let t = 0; t + 3 * n <= arr.length; t += 3 * n) {
      for (let k = 0; k < n; k++) { const x = arr[t + n + k]; arr[t + n + k] = arr[t + 2 * n + k]; arr[t + 2 * n + k] = x; }
    }
  }
}

/** a little canvas of made-up graphs for the side consoles */
function graphTexture(seed: number) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 24;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#04121c';
  g.fillRect(0, 0, 128, 24);
  g.fillStyle = seed > 0 ? '#7fe0ff' : '#ffb070';
  for (let x = 0; x < 128; x += 3) {
    const h = 4 + 14 * Math.abs(Math.sin(x * 0.11 * seed + Math.cos(x * 0.05)));
    g.fillRect(x, 22 - h, 2, h);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  return t;
}
