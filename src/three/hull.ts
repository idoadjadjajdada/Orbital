import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The ship you fly, inside and out, in metres: x to starboard, y up, z aft, so
 * the nose points along −z. It is about 55 m from the nose to the nozzles,
 * built from slabs that are hull plating on the outside and wall panels on
 * the inside, so the same walls are seen from both sides and the windows are
 * real gaps you can look through either way.
 *
 * The main deck, forward to aft: the bridge (the helm, the comms and sensor
 * consoles, a holographic nav table); a passage with the crew quarters to
 * port (bunks, a desk with the captain's log) and the science lab to
 * starboard (a survey console, a globe of the target, a sample locker); the
 * commons (a skylight, the galley, a dining table, a couch at the port
 * window, the telescope at the starboard one, souvenirs, and the airlock to
 * port); another passage; and engineering (the reactor inside the wormhole
 * drive's ring, the power routing console, a hatch down).
 *
 * Below engineering, the second deck: the hangar, with a lander parked over
 * the bay doors, a landing survey console, fuel and suits. Outside, the
 * hangar is the belly pod, with the bay doors under it and landing legs
 * folded against its sides. The lander does not fly yet: the doors, the legs
 * and the lander are kept apart from the rest so a later version can move
 * them.
 */

export type StationId =
  | 'helm' | 'nav' | 'comms' | 'sensors'
  | 'bunk' | 'log' | 'survey' | 'globe' | 'samples'
  | 'scope' | 'airlock' | 'shelf' | 'coffee' | 'galley' | 'couch'
  | 'reactor' | 'power' | 'down' | 'up' | 'lander' | 'bay';
export interface Station { id: StationId; at: THREE.Vector3; label: string; reach: number; deck: number }
interface Rect { x0: number; x1: number; z0: number; z1: number }
interface Hole { a0: number; a1: number; y0: number; y1: number; glass?: boolean }
/** a wall's doors and windows; `open` for no wall; `none` where the neighbouring room's wall stands */
type Wall = Hole[] | 'open' | 'none';
type Side = 'n' | 's' | 'w' | 'e';
interface Room { name: string; r: Rect; deck: number; y: number; H: number; walls: Record<Side, Wall>; sky?: Rect }

/** what the hull shows: the state of the drives */
export interface HullState { od: number; charge: number; worm: number; tunnel: boolean; thrust: number; boardable: boolean }

const T = 0.25;
/** the floor of each deck: the main deck, and the hangar below it */
export const DECK_Y = [0, -4.9];
const HANGAR_H = 4.4;
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
/** the foot of the ladder between the decks, either end */
export const LADDER = new THREE.Vector3(-3.6, 0, 10.3);

export class Hull {
  readonly group = new THREE.Group();
  readonly stations: Station[] = [];
  private rooms: Room[] = [];
  private walk: (Rect & { deck: number })[] = [];
  private blocks: (Rect & { deck: number })[] = [];
  private rounds: { x: number; z: number; r: number; deck: number }[] = [];
  /** coarse boxes of the outside, to keep a spacewalker out of the hull */
  private solids: THREE.Box3[] = [];
  /** the deck being built */
  private deck = 0;

  private mat = {
    hull: new THREE.MeshLambertMaterial({ color: 0xd2d5dc, flatShading: true, map: plating('hull') }),
    dark: new THREE.MeshLambertMaterial({ color: 0x5a6274, flatShading: true, map: plating('hull') }),
    accent: new THREE.MeshLambertMaterial({ color: 0xd8643a, flatShading: true }),
    wall: new THREE.MeshLambertMaterial({ color: 0xa8b0c0, flatShading: true, map: plating('wall') }),
    // (the deck's plates have a sheen: the lamps shine in them)
    floor: new THREE.MeshLambertMaterial({ color: 0x59606e, flatShading: true, map: plating('floor') }),
    ceil: new THREE.MeshLambertMaterial({ color: 0x7c8494, flatShading: true, map: plating('ceil') }),
    trim: new THREE.MeshLambertMaterial({ color: 0x2a303c, flatShading: true }),
    steel: new THREE.MeshLambertMaterial({ color: 0x8e96a4, flatShading: true }),
    white: new THREE.MeshLambertMaterial({ color: 0xe4e6ea, flatShading: true }),
    cloth: new THREE.MeshLambertMaterial({ color: 0x3f6a8a, flatShading: true }),
    blanket: new THREE.MeshLambertMaterial({ color: 0x8a3f4f, flatShading: true }),
    rug: new THREE.MeshLambertMaterial({ color: 0x4a3a5c, flatShading: true }),
    wood: new THREE.MeshLambertMaterial({ color: 0x8a6440, flatShading: true }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x4f9a4a, flatShading: true }),
    glass: new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff1d0 }),
    cyan: new THREE.MeshBasicMaterial({ color: 0x5fd0ff }),
    amber: new THREE.MeshBasicMaterial({ color: 0xffb050 }),
    stripe: new THREE.MeshBasicMaterial({ color: 0xe8c040 }),
    hazard: new THREE.MeshLambertMaterial({ map: hazardTexture() }),
    // light along the tops of the walls, and dim guide lights along their feet
    cove: new THREE.MeshBasicMaterial({ color: 0xe6d6b8 }),
    guide: new THREE.MeshBasicMaterial({ color: 0x2f9cc0 }),
    // the outside: painted and bare metal, with the plates' seams in relief, that catches the light and shines
    // (setEnv gives it something to reflect)
    xhull: metal(0xdfe2e8, 0.35, 0.5, 'hull'),
    xdark: metal(0x4e5668, 0.55, 0.42, 'hull'),
    xaccent: new THREE.MeshStandardMaterial({ color: 0xd8643a, flatShading: true, metalness: 0.2, roughness: 0.4 }),
    xsteel: new THREE.MeshStandardMaterial({ color: 0xb4bcc8, flatShading: true, metalness: 0.9, roughness: 0.3 }),
    xburnt: new THREE.MeshStandardMaterial({ color: 0x3a3f4a, flatShading: true, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide }),
  };
  /** the materials tiled in metres, whatever the size of the piece */
  private tiled = new Set<THREE.Material>([this.mat.hull, this.mat.dark, this.mat.wall, this.mat.floor, this.mat.ceil, this.mat.hazard, this.mat.xhull, this.mat.xdark]);

  // animated parts
  private core: THREE.MeshBasicMaterial;
  private coreRings: THREE.Mesh[] = [];
  private wormRing: THREE.Mesh;
  private wormMat: THREE.MeshBasicMaterial;
  private lights: { l: THREE.PointLight; base: THREE.Color; k: number }[] = [];
  private navLights: THREE.Sprite[] = [];
  private strobes: THREE.Sprite[] = [];
  /** the merged outside, with plain twins of its materials for when you are inside (see viewFrom) */
  private outer: { m: THREE.Mesh; shine: THREE.Material; plain: THREE.Material }[] = [];
  private hatchLight: THREE.MeshBasicMaterial;
  private holo: THREE.Points;
  private holoRing: THREE.Mesh;
  private screens = new Map<string, { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string; tint: string }>();
  private trophySlots: THREE.Vector3[] = [];
  private trophies: THREE.Mesh[] = [];
  private globe: THREE.Mesh;
  private vials: THREE.Mesh[] = [];
  readonly flames: THREE.Sprite[] = [];
  /** for the landing to come: the lander, the bay doors under it, the legs folded against the belly */
  readonly lander = new THREE.Group();
  readonly bayDoors: THREE.Mesh[] = [];
  readonly legs: THREE.Group[] = [];
  /** the ladder from the airlock to the ground */
  readonly ladder = new THREE.Group();
  private rungs: THREE.Mesh[] = [];
  private t = 0;

  constructor(glow: THREE.Texture) {
    const g = this.group, M = this.mat;
    const door = (a: number, w = 1.2): Hole => ({ a0: a - w, a1: a + w, y0: 0, y1: 2.4 });
    const pane = (a0: number, a1: number, y0: number, y1: number): Hole => ({ a0, a1, y0, y1, glass: true });

    // ---- the main deck
    this.room('bridge', { x0: -4.5, x1: 4.5, z0: -24, z1: -14 }, 3, {
      n: [pane(-4.2, 4.2, 0.5, 2.85)], s: [door(0)], w: [pane(-22, -16.5, 1.0, 2.4)], e: [pane(-22, -16.5, 1.0, 2.4)],
    }, { two: ['s'] });
    this.room('forward passage', { x0: -1.2, x1: 1.2, z0: -13.75, z1: -8.25 }, 3, { n: 'open', s: 'open', w: [door(-11, 0.9)], e: [door(-11, 0.9)] }, { two: ['w', 'e'] });
    this.room('quarters', { x0: -4.5, x1: -1.45, z0: -13.75, z1: -8.25 }, 3, { n: 'none', s: 'none', e: 'none', w: [pane(-11.3, -9.7, 1.0, 2.0)] });
    this.room('lab', { x0: 1.45, x1: 4.5, z0: -13.75, z1: -8.25 }, 3, { n: 'none', s: 'none', w: 'none', e: [pane(-13.4, -12.2, 1.1, 2.1)] });
    this.room('commons', { x0: -6, x1: 6, z0: -8, z1: 4 }, 3, {
      n: [door(0)], s: [door(0)],
      w: [pane(-7, -2.8, 0.9, 2.5), door(0)],
      e: [pane(-7, -2.8, 0.9, 2.5), pane(0, 3.5, 0.9, 2.5)],
    }, { two: ['n'], sky: { x0: -3, x1: 3, z0: -5, z1: 1 } });
    this.room('aft passage', { x0: -1.2, x1: 1.2, z0: 4.25, z1: 7.75 }, 3, { n: 'open', s: 'open', w: [], e: [] });
    this.room('engineering', { x0: -4.5, x1: 4.5, z0: 8, z1: 18 }, 4.2, { n: [door(0)], s: [], w: [], e: [] }, { two: ['n'] });
    this.room('airlock', { x0: -8.6, x1: -6.25, z0: -1.6, z1: 1.6 }, 3, { n: [], s: [], w: [], e: 'open' });
    // through the doors, across the thickness of the walls
    this.walk.push(
      { x0: -1.2, x1: 1.2, z0: -15, z1: -12.8, deck: 0 }, { x0: -1.2, x1: 1.2, z0: -9.2, z1: -7, deck: 0 },
      { x0: -2.5, x1: -0.2, z0: -11.9, z1: -10.1, deck: 0 }, { x0: 0.2, x1: 2.5, z0: -11.9, z1: -10.1, deck: 0 },
      { x0: -1.2, x1: 1.2, z0: 3, z1: 5.2, deck: 0 }, { x0: -1.2, x1: 1.2, z0: 6.8, z1: 9, deck: 0 },
      { x0: -7.4, x1: -4.9, z0: -1.2, z1: 1.2, deck: 0 },
    );

    // ---- the hangar deck, under engineering
    this.deck = 1;
    this.room('hangar', { x0: -5.5, x1: 5.5, z0: 4.5, z1: 18 }, HANGAR_H, {
      n: [], s: [], w: [pane(5.0, 6.6, 1.6, 2.4), pane(14.6, 16.6, 1.6, 2.4)], e: [pane(5.0, 6.6, 1.6, 2.4), pane(10.6, 12.6, 1.6, 2.4)],
    });
    this.deck = 0;

    // ---- the outside
    this.box(-4, 4, -1.9, -T, -23.5, 4.25, M.xdark, true);
    this.box(-5.6, 5.6, -1.6, -T, -7.6, 3.6, M.xhull, true);
    // the prow: a long faceted wedge under the bridge's glass, its chin swept up to a point
    const prow = new THREE.LatheGeometry([0.02, 1.2, 2.4, 3.3, 3.9, 4.2, 4.3].map((r, k) => new THREE.Vector2(r, -k * 1.7)), 10);
    prow.rotateX(-Math.PI / 2);
    prow.scale(1, 0.36, 1);
    const nose = new THREE.Mesh(prow, M.xhull);
    nose.position.set(0, -0.85, -34.2);
    g.add(nose);
    const keel = new THREE.Mesh(prow.clone().scale(0.55, 0.6, 0.98), M.xdark);
    keel.position.set(0, -1.35, -33.8);
    g.add(keel);
    this.solids.push(new THREE.Box3(new THREE.Vector3(-3.5, -2, -32), new THREE.Vector3(3.5, 0.6, -24)));
    this.dress(glow);
    // a spine and stripes
    this.box(-0.7, 0.7, 3 + T, 3.6, -13.5, -8.5, M.xaccent, false);
    for (const s of [1, -1]) this.box(s > 0 ? 6 + T : -6.3, s > 0 ? 6.3 : -6 - T, 2.55, 2.75, -8, 4, M.xaccent, false);
    for (const s of [1, -1]) this.box(s > 0 ? 5.5 + T : -5.8, s > 0 ? 5.8 : -5.5 - T, -1.2, -0.95, 4.5, 18, M.xaccent, false);
    // wings and their pods
    const wing = new THREE.Shape();
    wing.moveTo(0, 8); wing.lineTo(11.5, 14.5); wing.lineTo(11.5, 18.2); wing.lineTo(0, 18);
    const wingG = new THREE.ExtrudeGeometry(wing, { depth: 0.35, bevelEnabled: false });
    wingG.rotateX(Math.PI / 2);
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(wingG, M.xhull);
      w.scale.x = s;
      w.position.set(s * 4.7, 0.9, 0);
      g.add(w);
      this.solids.push(new THREE.Box3(new THREE.Vector3(s > 0 ? 4.7 : -16.2, 0.4, 10), new THREE.Vector3(s > 0 ? 16.2 : -4.7, 1.0, 18.4)));
      const nl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: s > 0 ? 0x40ff70 : 0xff3030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      nl.position.set(s * 17.4, 0.9, 12.4);
      nl.scale.setScalar(2.4);
      g.add(nl);
      this.navLights.push(nl);
    }
    // engines
    for (const [x, y] of [[-2.6, 0.6], [2.6, 0.6], [0, 2.6]] as const) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 6, 12), M.xdark);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(x, y, 21.3);
      g.add(eng);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.75, 0.6, 12, 1, true), M.xburnt);
      bell.rotation.x = Math.PI / 2;
      bell.position.set(x, y, 24.5);
      g.add(bell);
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 12), this.mat.cyan);
      noz.rotation.x = Math.PI / 2;
      noz.position.set(x, y, 24.35);
      g.add(noz);
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x7fb4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      f.position.set(x, y, 25.5);
      g.add(f);
      this.flames.push(f);
    }
    this.solids.push(new THREE.Box3(new THREE.Vector3(-4, -0.8, 18), new THREE.Vector3(4, 3.8, 24.5)));
    // a fin and a dish
    this.box(-0.15, 0.15, 4.2 + T, 8, 11.5, 18.5, M.xaccent, true);
    const dishPost = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6), M.xdark);
    dishPost.position.set(4.2, 3.85, 2.2);
    const dish = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.5, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xc9ccd4, flatShading: true, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }));
    dish.position.set(4.2, 4.6, 2.2);
    dish.rotation.set(Math.PI * 0.8, 0, 0.4);
    g.add(dishPost, dish);
    // the hatch, seen from outside
    const hatch = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.12, 6, 16), M.xaccent);
    hatch.rotation.y = Math.PI / 2;
    hatch.position.set(-8.6 - T - 0.05, 1.3, 0);
    this.hatchLight = new THREE.MeshBasicMaterial({ color: 0x40ff70 });
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.25), this.hatchLight);
    hl.position.set(-8.6 - T - 0.08, 2.6, 0);
    g.add(hatch, hl);
    // under the belly pod: the bay doors' seams, and the legs folded up against its sides
    const Y1 = DECK_Y[1], under = Y1 - T - 0.02;
    for (const [x0, x1, z0, z1] of [[-2.45, 3.65, 8.95, 9.05], [-2.45, 3.65, 15.95, 16.05], [-2.45, -2.35, 8.95, 16.05], [3.55, 3.65, 8.95, 16.05], [0.56, 0.64, 9, 16]]) {
      this.box(x0, x1, under - 0.02, under, z0, z1, M.trim, false);
    }
    // four on the belly pod's sides, two under the bridge: each a sleeve and a strut that telescopes out of it to reach the ground
    for (const [x, y, z] of [[5.5 + T + 0.2, -1.5, 6.2], [5.5 + T + 0.2, -1.5, 16.4], [-(5.5 + T + 0.2), -1.5, 6.2], [-(5.5 + T + 0.2), -1.5, 16.4], [3.2, -0.35, -19], [-3.2, -0.35, -19]]) {
      const leg = new THREE.Group();
      leg.position.set(x, y, z);
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.6, 0.42), M.xdark);
      sleeve.position.y = -0.8;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1, 0.28), M.xsteel);
      strut.name = 'strut';
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.18, 10), M.xdark);
      pad.name = 'pad';
      leg.add(sleeve, strut, pad);
      g.add(leg);
      this.legs.push(leg);
    }
    this.setLegs(0);
    // the boarding ladder, down from the airlock to the ground once landed
    this.ladder.position.set(-8.6 - T - 0.6, 0.6, 0);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.06), M.xsteel);
      rail.position.set(0, -0.5, s * 0.3);
      rail.name = 'rail';
      this.ladder.add(rail);
    }
    this.ladder.visible = false;
    g.add(this.ladder);
    this.solids.push(new THREE.Box3(new THREE.Vector3(-6.5, Y1 - 0.6, 5.6), new THREE.Vector3(6.5, -1.4, 17)));

    // ---- the bridge
    // helm chair
    this.box(-0.45, 0.45, 0.45, 0.6, -21.4, -20.6, M.cloth, false);
    this.box(-0.45, 0.45, 0.6, 1.7, -20.6, -20.4, M.cloth, false);
    this.box(-0.12, 0.12, 0, 0.45, -21.1, -20.9, M.trim, false);
    for (const s of [1, -1]) this.box(s * 0.45 - 0.08, s * 0.45 + 0.08, 0.6, 0.85, -21.4, -20.7, M.trim, false);
    this.round(0, -20.9, 0.55);
    this.station('helm', new THREE.Vector3(0, 0.9, -20.9), 'Take the helm', 2.2);
    // the console, with a live screen and a row of lit keys
    this.box(-2.6, 2.6, 0, 0.7, -24, -22.9, M.trim, false);
    this.box(-2.6, 2.6, 0.7, 0.74, -24, -22.6, M.steel, false);
    const scr = this.screen('helm', 512, 170, 1.5, 0.5, '#7fe0ff');
    scr.position.set(0, 0.98, -23.55);
    scr.rotation.x = -0.75;
    for (let k = 0; k < 8; k++) this.box(-2.3 + k * 0.2, -2.18 + k * 0.2, 0.74, 0.76, -22.85, -22.7, k % 3 ? M.cyan : M.amber, false);
    for (let k = 0; k < 8; k++) this.box(1.1 + k * 0.15, 1.2 + k * 0.15, 0.74, 0.76, -22.85, -22.7, k % 2 ? M.amber : M.cyan, false);
    this.block(-2.6, 2.6, -24, -22.5);
    // side consoles: comms to port, sensors to starboard
    for (const s of [1, -1]) {
      this.box(s > 0 ? 3.4 : -4.5, s > 0 ? 4.5 : -3.4, 0, 1.0, -21.5, -17.5, M.trim, false);
      this.box(s > 0 ? 3.3 : -4.5, s > 0 ? 4.5 : -3.3, 1.0, 1.04, -21.6, -17.4, M.steel, false);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.7), new THREE.MeshBasicMaterial({ map: graphTexture(s, s > 0 ? 'SENSORS' : 'COMMS') }));
      p.position.set(s * 3.42, 1.45, -19.5);
      p.rotation.y = -s * Math.PI / 2;
      g.add(p);
      this.block(s > 0 ? 3.3 : -4.5, s > 0 ? 4.5 : -3.3, -21.6, -17.4);
      this.plant(s * 3.9, -14.7);
    }
    this.station('comms', new THREE.Vector3(-3.6, 1.2, -19.5), 'Read the comms log', 2.4);
    this.station('sensors', new THREE.Vector3(3.6, 1.2, -19.5), 'Sensor sweep', 2.4);
    // the nav table, with a hologram of what is round the ship
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 0.9, 16), M.trim);
    ped.position.set(0, 0.45, -16.4);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 24), new THREE.MeshLambertMaterial({ color: 0x0c1822, emissive: 0x08303e }));
    top.position.set(0, 0.93, -16.4);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.03, 4, 32), M.cyan);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0.965, -16.4);
    g.add(ped, top, rim);
    this.holo = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true }));
    this.holo.position.set(0, 1.75, -16.4);
    this.holo.frustumCulled = false;
    this.holoRing = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.012, 4, 48), new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.6 }));
    this.holoRing.position.copy(this.holo.position);
    this.holoRing.rotation.x = Math.PI / 2;
    g.add(this.holo, this.holoRing);
    this.round(0, -16.4, 1.0);
    this.station('nav', new THREE.Vector3(0, 1.3, -16.4), 'Plot a course', 2.6);
    this.lamp(0, 2.9, -19, 0xfff1d0, 1, 26);

    // ---- the quarters: a bunk bed, a desk with the log, a locker, a poster
    const qx0 = -4.5;
    for (const y of [0.35, 1.55]) {
      this.box(qx0, qx0 + 1.05, y, y + 0.12, -13.75, -11.6, M.steel, false);
      this.box(qx0 + 0.05, qx0 + 1.0, y + 0.12, y + 0.32, -13.7, -11.65, M.white, false);
      this.box(qx0 + 0.05, qx0 + 1.0, y + 0.32, y + 0.36, -13.0, -11.65, M.blanket, false);
      this.box(qx0 + 0.15, qx0 + 0.9, y + 0.32, y + 0.44, -13.65, -13.25, M.white, false);
    }
    for (const z of [-13.7, -11.65]) this.box(qx0 + 0.98, qx0 + 1.06, 0, 2.2, z - 0.04, z + 0.04, M.steel, false);
    this.box(qx0 + 0.98, qx0 + 1.06, 1.9, 1.96, -13.7, -11.65, M.steel, false);
    for (let k = 0; k < 3; k++) this.box(qx0 + 1.0, qx0 + 1.08, 0.7 + k * 0.3, 0.74 + k * 0.3, -12.1, -11.7, M.steel, false);
    this.block(qx0, qx0 + 1.15, -13.75, -11.5);
    this.station('bunk', new THREE.Vector3(-4.0, 0.8, -12.6), 'Sleep for eight hours', 2.0);
    this.box(qx0, -2.8, 0.72, 0.78, -8.95, -8.25, M.wood, false);
    this.box(qx0, qx0 + 0.5, 0, 0.72, -8.95, -8.25, M.trim, false);
    this.box(-3.2, -2.8, 0, 0.72, -8.95, -8.25, M.trim, false);
    const logScr = this.screen('log', 256, 160, 0.6, 0.38, '#ffd27a');
    logScr.position.set(-3.7, 1.05, -8.4);
    logScr.rotation.y = Math.PI;
    this.box(-3.95, -3.45, 0.42, 0.48, -9.6, -9.1, M.cloth, false);
    this.box(-3.95, -3.45, 0.48, 1.0, -9.62, -9.56, M.cloth, false);
    this.block(qx0, -2.7, -9.0, -8.25);
    this.station('log', new THREE.Vector3(-3.7, 1.0, -8.6), "Read the captain's log", 2.0);
    this.box(-2.25, -1.45, 0, 2.2, -13.75, -13.15, M.steel, false);
    this.box(-1.88, -1.82, 0.9, 1.3, -13.16, -13.1, M.trim, false);
    this.block(-2.3, -1.45, -13.75, -13.1);
    this.box(-4.0, -2.0, 0.005, 0.02, -11.2, -9.6, M.rug, false);
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), new THREE.MeshBasicMaterial({ map: posterTexture() }));
    poster.position.set(-2.9, 1.7, -13.74);
    g.add(poster);
    this.lamp(-3, 2.7, -11, 0xffd8a8, 0.45, 9);

    // ---- the lab: a survey console, a globe of the target, the sample locker
    this.box(3.95, 4.5, 0, 0.85, -11.9, -9.5, M.trim, false);
    this.box(3.85, 4.5, 0.85, 0.89, -11.95, -9.45, M.white, false);
    const surv = this.screen('survey', 512, 300, 1.7, 1.0, '#9fe8c8');
    surv.position.set(4.46, 1.75, -10.7);
    surv.rotation.y = -Math.PI / 2;
    this.block(3.85, 4.5, -12, -9.4);
    this.station('survey', new THREE.Vector3(4.1, 1.3, -10.7), 'Survey the target', 2.2);
    const gped = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.0, 12), M.trim);
    gped.position.set(2.9, 0.5, -12.5);
    const gring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.025, 4, 32), M.steel);
    gring.position.set(2.9, 1.5, -12.5);
    gring.rotation.y = 0.3;
    g.add(gped, gring);
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 20), new THREE.MeshLambertMaterial({ color: 0x40505a }));
    this.globe.position.set(2.9, 1.5, -12.5);
    this.globe.rotation.z = 0.4;
    g.add(this.globe);
    this.round(2.9, -12.5, 0.55);
    this.station('globe', new THREE.Vector3(2.9, 1.4, -12.5), 'Study the globe', 2.0);
    this.box(2.0, 4.5, 0, 1.6, -8.85, -8.25, M.white, false);
    this.box(2.05, 4.45, 1.6, 1.64, -8.9, -8.25, M.steel, false);
    for (let row = 0; row < 2; row++) for (let k = 0; k < 6; k++) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8), new THREE.MeshBasicMaterial({ color: 0x24303a }));
      v.position.set(2.3 + k * 0.38, 0.55 + row * 0.6, -8.9);
      g.add(v);
      this.vials.push(v);
    }
    this.box(2.0, 4.5, 0.3, 1.5, -8.87, -8.86, M.glass, false);
    this.block(1.95, 4.5, -9.0, -8.25);
    this.station('samples', new THREE.Vector3(3.2, 1.0, -8.7), 'Open the sample locker', 2.0);
    this.lamp(3, 2.7, -11, 0xe0f4ff, 0.5, 9);

    // ---- the commons
    // the couch facing the port window, a low table and a rug
    this.box(-4.4, -3.4, 0.2, 0.55, -6.6, -3.4, M.cloth, false);
    this.box(-3.4, -3.15, 0.2, 1.3, -6.6, -3.4, M.cloth, false);
    this.box(-4.4, -3.15, 0, 0.2, -6.6, -3.4, M.trim, false);
    for (const z of [-6.6, -3.65]) this.box(-4.4, -3.15, 0.2, 0.8, z, z + 0.25, M.cloth, false);
    this.block(-4.5, -3.1, -6.7, -3.3);
    this.station('couch', new THREE.Vector3(-3.9, 0.6, -5), 'Sit and watch', 2.2);
    this.box(-5.2, -4.8, 0, 0.45, -5.6, -4.4, M.wood, false);
    this.block(-5.3, -4.7, -5.7, -4.3);
    this.box(-5.6, -2.8, 0.005, 0.02, -6.9, -3.1, M.rug, false);
    // shelves of souvenirs either side of the forward door
    for (const s of [1, -1]) {
      const x0 = s > 0 ? 2 : -5.8, x1 = s > 0 ? 5.8 : -2;
      for (const y of [0.9, 1.7]) this.box(x0, x1, y - 0.06, y, -8, -7.5, M.wood, false);
      this.box(x0, x1, 0, 0.5, -8, -7.5, M.trim, false);
      for (const y of [0.9, 1.7]) for (const x of [0.25, 0.75]) this.trophySlots.push(new THREE.Vector3(x0 + (x1 - x0) * x, y + 0.2, -7.75));
      this.block(x0, x1, -8, -7.4);
      this.station('shelf', new THREE.Vector3((x0 + x1) / 2, 1.3, -7.75), 'Look at the souvenirs', 2.4);
    }
    // a round table and four stools under the skylight
    const tbl = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 20), M.wood);
    tbl.position.set(2.4, 0.76, -3.4);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.25, 0.73, 8), M.trim);
    leg.position.set(2.4, 0.365, -3.4);
    g.add(tbl, leg);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.48, 10), M.cloth);
      st.position.set(2.4 + Math.cos(a) * 1.05, 0.24, -3.4 + Math.sin(a) * 1.05);
      g.add(st);
    }
    this.round(2.4, -3.4, 0.85);
    // the telescope at the starboard window
    const tri = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.35, 1.2, 3), M.trim);
    tri.position.set(5.1, 0.6, 1.75);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.5, 12), M.accent);
    tube.rotation.z = Math.PI / 2 - 0.25;
    tube.position.set(5.2, 1.4, 1.75);
    g.add(tri, tube);
    this.round(5.1, 1.75, 0.55);
    this.station('scope', new THREE.Vector3(5.0, 1.4, 1.75), 'Look through the telescope', 2.2);
    // the galley along the aft wall: a counter, cupboards, a cooker, the coffee machine
    this.box(-5.95, -2.2, 0, 0.92, 3.35, 4, M.white, false);
    this.box(-5.98, -2.17, 0.92, 0.97, 3.3, 4, M.steel, false);
    this.box(-5.95, -2.2, 1.85, 2.55, 3.65, 4, M.white, false);
    for (let k = 0; k < 4; k++) this.box(-5.85 + k * 0.92, -5.0 + k * 0.92, 1.95, 2.45, 3.64, 3.65, M.steel, false);
    for (const x of [-3.7, -3.2]) for (const z of [3.5, 3.8]) this.box(x - 0.12, x + 0.12, 0.97, 0.985, z - 0.1, z + 0.1, M.trim, false);
    this.box(-5.95, -5.25, 0.97, 1.6, 3.45, 3.95, M.trim, false);
    this.box(-5.3, -5.24, 1.3, 1.36, 3.55, 3.85, M.lamp, false);
    this.block(-6, -2.1, 3.2, 4);
    this.station('coffee', new THREE.Vector3(-5.5, 1.2, 3.6), 'Make a coffee', 1.8);
    this.station('galley', new THREE.Vector3(-3.5, 1.1, 3.6), 'Cook something', 1.8);
    // a wall screen by the aft door: where the ship is
    const wallScr = this.screen('wall', 512, 240, 3.0, 1.4, '#ffe2a8');
    wallScr.position.set(3.4, 1.85, 3.99);
    wallScr.rotation.y = Math.PI;
    this.box(1.85, 4.95, 1.1, 2.6, 3.995, 4, M.trim, false);
    this.plant(5.4, 3.4);
    this.lamp(0, 2.9, -6, 0xfff1d0, 1, 22);
    this.lamp(0, 2.9, 2.6, 0xffe0c0, 1, 18);

    // ---- the airlock
    for (let k = 0; k < 6; k++) this.box(-8.4 + k * 0.36, -8.24 + k * 0.36, 0.005, 0.02, -1.5, 1.5, k % 2 ? M.trim : M.stripe, false);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.12, 20), M.hull);
    inner.rotation.z = Math.PI / 2;
    inner.position.set(-8.55, 1.3, 0);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 6, 16), M.accent);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(-8.45, 1.3, 0);
    g.add(inner, wheel);
    // two suits on the wall
    for (const z of [-1.1, 1.1]) this.suit(-8.35, z, Math.PI / 2, 0);
    this.block(-8.6, -8.1, -1.6, -0.7);
    this.block(-8.6, -8.1, 0.7, 1.6);
    this.station('airlock', new THREE.Vector3(-8.4, 1.3, 0), 'Step outside', 2.4);
    this.lamp(-6.8, 2.8, 0, 0xffc070, 0.22, 6);

    // ---- engineering
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4.2, 20, 1, true), M.glass);
    glass.position.set(0, 2.1, 13);
    this.core = new THREE.MeshBasicMaterial({ color: 0x70e0ff });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 4.2, 12), this.core);
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
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.04, 4, 32), M.accent);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(0, 1.0, 13);
    g.add(rail);
    for (let a = 0; a < 8; a++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 4), M.trim);
      post.position.set(1.8 * Math.cos((a * Math.PI) / 4), 0.5, 13 + 1.8 * Math.sin((a * Math.PI) / 4));
      g.add(post);
    }
    this.round(0, 13, 1.95);
    this.station('reactor', new THREE.Vector3(0, 1.6, 13), 'Check the drives', 3.2);
    // pipes, a workbench, crates
    for (const s of [1, -1]) for (const y of [3.2, 3.6]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 10, 8), M.dark);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(s * 4.3, y, 13);
      g.add(pipe);
    }
    this.box(3.5, 4.5, 0, 0.9, 9.6, 12.4, M.wood, false);
    this.box(4.4, 4.5, 0.9, 2.2, 9.6, 12.4, M.trim, false);
    for (let k = 0; k < 5; k++) this.box(4.35, 4.4, 1.2 + (k % 2) * 0.4, 1.7 + (k % 2) * 0.3, 9.9 + k * 0.5, 10.0 + k * 0.5, M.steel, false);
    this.block(3.4, 4.5, 9.5, 12.5);
    this.box(-4.5, -3.3, 0, 1.1, 15.6, 16.8, M.wood, false);
    this.box(-4.5, -3.6, 0, 0.8, 16.8, 18, M.wood, false);
    this.box(-4.2, -3.5, 1.1, 1.7, 15.9, 16.6, M.dark, false);
    this.block(-4.5, -3.2, 15.5, 18);
    // the drive console: power routing
    this.box(-1.6, 1.6, 0, 1.1, 17.2, 18, M.trim, false);
    this.box(-1.4, 1.4, 1.1, 1.9, 17.8, 17.95, this.wormMat, false);
    const pwr = this.screen('power', 384, 128, 1.2, 0.4, '#c8b0ff');
    pwr.position.set(0, 1.15, 17.45);
    pwr.rotation.x = -Math.PI / 2 + 0.5;
    pwr.rotation.y = Math.PI;
    pwr.rotation.order = 'YXZ';
    this.block(-1.7, 1.7, 17.1, 18);
    this.station('power', new THREE.Vector3(0, 1.2, 17.4), 'Route the power', 2.4);
    // the hatch down to the hangar
    const [lx, , lz] = [LADDER.x, 0, 9.0];
    this.box(lx - 0.55, lx + 0.55, 0.005, 0.03, lz - 0.55, lz + 0.55, M.hazard, false);
    this.box(lx - 0.42, lx + 0.42, 0.03, 0.05, lz - 0.42, lz + 0.42, M.trim, false);
    for (const [x, z] of [[lx + 0.6, lz - 0.6], [lx + 0.6, lz + 0.6]]) this.box(x - 0.04, x + 0.04, 0, 1.05, z - 0.04, z + 0.04, M.stripe, false);
    this.box(lx + 0.56, lx + 0.64, 1.0, 1.06, lz - 0.6, lz + 0.6, M.stripe, false);
    this.box(lx - 0.6, lx + 0.6, 1.0, 1.06, lz + 0.56, lz + 0.64, M.stripe, false);
    for (let k = 0; k < 2; k++) this.box(lx - 0.25 + k * 0.42, lx - 0.17 + k * 0.42, 0.05, 0.6, lz - 0.6, lz - 0.52, M.steel, false);
    this.block(-4.5, lx + 0.7, 8, lz + 0.7);
    this.station('down', new THREE.Vector3(lx, 0.6, lz), 'Climb down to the hangar', 2.0);
    this.lamp(0, 3.9, 10, 0x80e0ff, 1, 22);

    // ---- the hangar
    this.deck = 1;
    const y1 = DECK_Y[1];
    // the bay doors under the lander, ringed by hazard stripes
    this.box(-2.75, 3.95, y1 + 0.004, y1 + 0.012, 8.65, 16.35, M.hazard, false);
    for (const [x0, x1] of [[-2.45, 0.6], [0.6, 3.65]]) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 0.04, 0.03, 7), M.dark);
      d.position.set((x0 + x1) / 2, y1 + 0.02, 12.5);
      g.add(d);
      this.bayDoors.push(d);
    }
    // the lander: a squat cabin on four legs, a window forward, an engine under it
    this.buildLander(M);
    this.lander.position.set(0.6, y1, 12.5);
    g.add(this.lander);
    this.block(-1.9, 3.1, 9.7, 15.3);
    this.station('lander', new THREE.Vector3(0.6, y1 + 1.6, 12.5), 'Fly Lander 1', 3.6);
    // the ladder up through the hatch
    for (const s of [-1, 1]) this.box(lx + s * 0.25 - 0.03, lx + s * 0.25 + 0.03, y1, -0.25, lz - 0.45, lz - 0.39, M.steel, false);
    for (let y = y1 + 0.35; y < -0.4; y += 0.32) this.box(lx - 0.25, lx + 0.25, y, y + 0.04, lz - 0.44, lz - 0.4, M.steel, false);
    this.box(lx - 0.55, lx + 0.55, -0.52, -0.5, lz - 0.55, lz + 0.55, M.hazard, false);
    this.block(lx - 0.5, lx + 0.5, lz - 0.6, lz + 0.1);
    this.station('up', new THREE.Vector3(lx, y1 + 1.4, lz - 0.4), 'Climb up to engineering', 2.0);
    // the landing survey console on the starboard wall
    this.box(4.85, 5.5, y1, y1 + 0.95, 6.9, 9.1, M.trim, false);
    this.box(4.75, 5.5, y1 + 0.95, y1 + 0.99, 6.85, 9.15, M.steel, false);
    const bay = this.screen('bay', 512, 300, 1.8, 1.05, '#ffd27a');
    bay.position.set(5.46, y1 + 1.9, 8.0);
    bay.rotation.y = -Math.PI / 2;
    this.block(4.7, 5.5, 6.8, 9.2);
    this.station('bay', new THREE.Vector3(5.0, y1 + 1.3, 8.0), 'Landing survey', 2.4);
    // fuel for the lander, crates, a rack of suits, a tool wall
    for (const z of [15.6, 16.9]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.4, 16), M.white);
      tank.position.set(4.7, y1 + 1.2, z);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.18, 16), M.accent);
      band.position.set(4.7, y1 + 1.6, z);
      g.add(tank, band);
      this.round(4.7, z, 0.6);
    }
    this.box(-5.5, -4.2, y1, y1 + 1.2, 15.2, 18, M.wood, false);
    this.box(-5.5, -4.5, y1 + 1.2, y1 + 2.1, 16.4, 17.6, M.wood, false);
    this.box(-4.1, -3.2, y1, y1 + 0.8, 16.8, 18, M.dark, false);
    this.block(-5.5, -3.1, 15.1, 18);
    for (let k = 0; k < 3; k++) this.suit(-5.3, 11.4 + k * 0.9, Math.PI / 2, y1);
    this.block(-5.5, -4.9, 10.9, 13.7);
    this.box(-2, 3.2, y1 + 1.2, y1 + 2.6, 4.5, 4.56, M.trim, false);
    for (let k = 0; k < 9; k++) this.box(-1.8 + k * 0.55, -1.7 + k * 0.55, y1 + 1.4 + (k % 3) * 0.12, y1 + 2.2, 4.55, 4.62, k % 2 ? M.steel : M.accent, false);
    // guide lines on the deck
    for (const x of [-4.4, 4.4]) this.box(x - 0.04, x + 0.04, y1 + 0.004, y1 + 0.012, 5, 17.5, M.stripe, false);
    this.lamp(0.6, y1 + 3.9, 8, 0xffe8c8, 0.9, 16);
    this.lamp(0.6, y1 + 3.9, 15.5, 0xffe8c8, 0.9, 16);
    this.deck = 0;

    // ---- signs
    this.sign('QUARTERS', -1.19, 2.62, -11, Math.PI / 2);
    this.sign('LAB', 1.19, 2.62, -11, -Math.PI / 2);
    this.sign('BRIDGE', 0, 2.62, -7.99, 0);
    this.sign('COMMONS', 0, 2.62, -13.99, Math.PI);
    this.sign('ENGINEERING', 0, 2.62, 3.99, Math.PI);
    this.sign('COMMONS', 0, 2.62, 8.01, 0);
    this.sign('AIRLOCK', -5.99, 2.62, 0, Math.PI / 2);
    this.sign('HANGAR ▼', -4.49, 1.9, 9.0, Math.PI / 2);
    this.sign('HANGAR · DECK 2', 0.6, y1 + 3.6, 4.51, 0, 2.4);
    this.sign('▲ ENGINEERING', -5.49, y1 + 2.9, 9.0, Math.PI / 2);
    this.sign('LANDER 1', 0.6, y1 + 3.0, 17.99, Math.PI, 2.6);

    // a few hundred boxes cost a draw each: the ones that never move are merged, one mesh a material
    this.merge(new Set<THREE.Object3D>([...this.coreRings, this.wormRing, this.holoRing, this.globe, ...this.vials, ...this.bayDoors]));
    g.traverse(o => { o.frustumCulled = false; });
  }

  /** the lander, in its own frame: its belly on the floor at y 0 and its nose to −z */
  private buildLander(M: Hull['mat']) {
    const L = this.lander;
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const p = new THREE.Mesh(geo, m);
      p.position.set(x, y, z);
      L.add(p);
      return p;
    };
    // the cabin: a side profile (z, y), nose down to the front, extruded across
    const prof = new THREE.Shape();
    const pts: [number, number][] = [[-1.5, 1.0], [1.9, 1.0], [1.9, 2.7], [1.3, 3.1], [-0.7, 3.1], [-2.2, 2.25], [-2.2, 1.35]];
    prof.moveTo(pts[0][0], pts[0][1]);
    for (const [z, y] of pts.slice(1)) prof.lineTo(z, y);
    const cab = new THREE.ExtrudeGeometry(prof, { depth: 2.6, bevelEnabled: false });
    cab.rotateY(-Math.PI / 2);
    cab.translate(1.3, 0, 0);
    L.add(new THREE.Mesh(cab, M.white));
    // the window, on the slope of the nose
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.8), new THREE.MeshBasicMaterial({ color: 0x1a2c3c }));
    win.position.set(0, 2.68, -1.47);
    win.lookAt(0, 2.68 + 0.86, -1.47 - 0.51);
    L.add(win);
    part(new THREE.BoxGeometry(2.64, 0.22, 3.0), M.accent, 0, 1.4, 0.3);
    part(new THREE.CylinderGeometry(0.45, 0.75, 0.6, 12, 1, true), new THREE.MeshLambertMaterial({ color: 0x3a3f4a, side: THREE.DoubleSide }), 0, 0.75, 0.6);
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 2.0], [1.6, 2.0]]) {
      const leg = part(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6), M.steel, x * 0.85, 0.75, z * 0.85);
      leg.rotation.set(z > 0 ? -0.35 : 0.35, 0, x > 0 ? 0.35 : -0.35);
      part(new THREE.CylinderGeometry(0.3, 0.36, 0.08, 10), M.dark, x * 1.1, 0.04, z * 1.1);
    }
    for (const s of [-1, 1]) part(new THREE.BoxGeometry(0.08, 0.6, 0.6), M.dark, s * 1.33, 2.0, -0.6);
    part(new THREE.BoxGeometry(0.8, 1.3, 0.06), M.trim, 0, 1.65, 1.92);
  }

  /** a spacesuit hanging on a wall, facing `rot` */
  private suit(x: number, z: number, rot: number, y0: number) {
    const s = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => { const p = new THREE.Mesh(geo, m); p.position.set(px, py, pz); s.add(p); };
    add(new THREE.BoxGeometry(0.5, 0.65, 0.3), this.mat.white, 0, 1.35, 0);
    add(new THREE.SphereGeometry(0.19, 12, 8), this.mat.white, 0, 1.88, 0);
    add(new THREE.BoxGeometry(0.26, 0.13, 0.05), this.mat.amber, 0, 1.9, 0.17);
    add(new THREE.BoxGeometry(0.42, 0.55, 0.2), this.mat.steel, 0, 1.35, -0.25);
    for (const k of [-1, 1]) {
      add(new THREE.BoxGeometry(0.14, 0.6, 0.14), this.mat.white, k * 0.33, 1.3, 0);
      add(new THREE.BoxGeometry(0.17, 0.7, 0.17), this.mat.white, k * 0.13, 0.7, 0);
    }
    add(new THREE.BoxGeometry(0.5, 0.05, 0.05), this.mat.accent, 0, 1.55, 0.16);
    s.position.set(x, y0, z);
    s.rotation.y = rot;
    s.updateMatrixWorld(true);
    // into the group as loose meshes, so they merge with the rest
    for (const p of [...s.children] as THREE.Mesh[]) {
      p.applyMatrix4(s.matrix);
      this.group.add(p);
    }
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
        if (this.tiled.has(p.mat)) worldUV(p.geo);
        if (!buckets.has(p.mat)) buckets.set(p.mat, []);
        buckets.get(p.mat)!.push(p.geo);
      }
      this.group.remove(m);
    }
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      if (mat instanceof THREE.MeshStandardMaterial) this.outer.push({ m: mesh, shine: mat, plain: new THREE.MeshLambertMaterial({ color: mat.color, map: mat.map, flatShading: true, side: mat.side }) });
      this.group.add(mesh);
      for (const g of geos) g.dispose();
    }
  }

  /** a room: floor, ceiling and four walls, each with its doors and windows */
  private room(name: string, r: Rect, H: number, w: Record<Side, Wall>, o: { sky?: Rect; two?: Side[] } = {}) {
    const M = this.mat, Y = DECK_Y[this.deck], sky = o.sky;
    this.rooms.push({ name, r, deck: this.deck, y: Y, H, walls: w, sky });
    this.walk.push({ ...r, deck: this.deck });
    this.solids.push(new THREE.Box3(new THREE.Vector3(r.x0 - T, Y - T, r.z0 - T), new THREE.Vector3(r.x1 + T, Y + H + T, r.z1 + T)));
    this.slab(r.x0 - T, r.x1 + T, Y - T, Y, r.z0 - T, r.z1 + T, 2, M.floor);
    // the ceiling, round a skylight
    const parts = sky ? [
      { x0: r.x0 - T, x1: r.x1 + T, z0: r.z0 - T, z1: sky.z0 },
      { x0: r.x0 - T, x1: r.x1 + T, z0: sky.z1, z1: r.z1 + T },
      { x0: r.x0 - T, x1: sky.x0, z0: sky.z0, z1: sky.z1 },
      { x0: sky.x1, x1: r.x1 + T, z0: sky.z0, z1: sky.z1 },
    ] : [{ x0: r.x0 - T, x1: r.x1 + T, z0: r.z0 - T, z1: r.z1 + T }];
    for (const p of parts) this.slab(p.x0, p.x1, Y + H, Y + H + T, p.z0, p.z1, 3, M.ceil);
    if (sky) {
      this.box(sky.x0, sky.x1, Y + H + T / 2 - 0.01, Y + H + T / 2 + 0.01, sky.z0, sky.z1, M.glass, false);
      for (let x = sky.x0 + 1.5; x < sky.x1; x += 1.5) this.box(x - 0.06, x + 0.06, Y + H, Y + H + T, sky.z0, sky.z1, M.trim, false);
    }
    // the walls: along x for the fore and aft ones, along z for the sides
    const side = (s: Side, a0: number, a1: number, piece: (b0: number, b1: number, y0: number, y1: number) => void, pane: (b0: number, b1: number, y0: number, y1: number) => void) => {
      const holes = w[s];
      if (holes === 'open' || holes === 'none') return;
      let at = a0;
      for (const h of [...holes].sort((p, q) => p.a0 - q.a0)) {
        if (h.a0 > at) piece(at, h.a0, Y, Y + H);
        if (h.y0 > 0) piece(h.a0, h.a1, Y, Y + h.y0);
        if (h.y1 < H) piece(h.a0, h.a1, Y + h.y1, Y + H);
        if (h.glass) pane(h.a0, h.a1, Y + h.y0, Y + h.y1);
        else this.frame(h, s === 'n' || s === 's' ? 'x' : 'z', s === 'n' ? r.z0 - T : s === 's' ? r.z1 : s === 'w' ? r.x0 - T : r.x1, Y);
        at = h.a1;
      }
      if (a1 > at) piece(at, a1, Y, Y + H);
    };
    const two = (s: Side) => o.two?.includes(s);
    // the fore and aft walls stop short where a side is open, rather than poke into the next room's wall
    const solid = (s: Side) => Array.isArray(w[s]);
    const xa = solid('w') ? r.x0 - T : r.x0, xb = solid('e') ? r.x1 + T : r.x1;
    const dressed = (s: Side, b0: number, b1: number, y0: number, y1: number) => this.dressWall(s, r, b0, b1, y0 - Y, y1 - Y, Y, H);
    side('n', xa, xb, (b0, b1, y0, y1) => { this.slab(b0, b1, y0, y1, r.z0 - T, r.z0, 4, M.wall, two('n')); dressed('n', b0, b1, y0, y1); }, (b0, b1, y0, y1) => this.box(b0, b1, y0, y1, r.z0 - T / 2 - 0.01, r.z0 - T / 2 + 0.01, M.glass, false));
    side('s', xa, xb, (b0, b1, y0, y1) => { this.slab(b0, b1, y0, y1, r.z1, r.z1 + T, 5, M.wall, two('s')); dressed('s', b0, b1, y0, y1); }, (b0, b1, y0, y1) => this.box(b0, b1, y0, y1, r.z1 + T / 2 - 0.01, r.z1 + T / 2 + 0.01, M.glass, false));
    side('w', r.z0, r.z1, (b0, b1, y0, y1) => { this.slab(r.x0 - T, r.x0, y0, y1, b0, b1, 0, M.wall, two('w')); dressed('w', b0, b1, y0, y1); }, (b0, b1, y0, y1) => this.box(r.x0 - T / 2 - 0.01, r.x0 - T / 2 + 0.01, y0, y1, b0, b1, M.glass, false));
    side('e', r.z0, r.z1, (b0, b1, y0, y1) => { this.slab(r.x1, r.x1 + T, y0, y1, b0, b1, 1, M.wall, two('e')); dressed('e', b0, b1, y0, y1); }, (b0, b1, y0, y1) => this.box(r.x1 + T / 2 - 0.01, r.x1 + T / 2 + 0.01, y0, y1, b0, b1, M.glass, false));
    // a strip of light along the middle of the ceiling, and a skirting rail
    const lx = (r.x0 + r.x1) / 2, lz = (r.z0 + r.z1) / 2;
    if (r.x1 - r.x0 < r.z1 - r.z0 || !sky) this.box(lx - 0.12, lx + 0.12, Y + H - 0.04, Y + H, r.z0 + 0.6, r.z1 - 0.6, M.lamp, false);
    else this.box(r.x0 + 0.6, r.x1 - 0.6, Y + H - 0.04, Y + H, lz + 4, lz + 4.2, M.lamp, false);
  }

  /**
   * a stretch of wall's fittings, on its inner face: from the floor, a dark kick plate with a line of guide
   * light along it; on a full-height stretch, a rail at waist height and a rib at each end; under the
   * ceiling, a cove of light. `y0` and `y1` are its bottom and top over the deck, `b0` to `b1` its length
   */
  private dressWall(s: Side, r: Rect, b0: number, b1: number, y0: number, y1: number, Y: number, H: number) {
    const M = this.mat, len = b1 - b0;
    if (len < 0.3) return;
    // a box standing `d` m out from the face, along b from a0 to a1, up from h0 to h1 (over the deck)
    const on = (a0: number, a1: number, h0: number, h1: number, d: number, m: THREE.Material) => {
      if (s === 'n') this.box(a0, a1, Y + h0, Y + h1, r.z0, r.z0 + d, m, false);
      else if (s === 's') this.box(a0, a1, Y + h0, Y + h1, r.z1 - d, r.z1, m, false);
      else if (s === 'w') this.box(r.x0, r.x0 + d, Y + h0, Y + h1, a0, a1, m, false);
      else this.box(r.x1 - d, r.x1, Y + h0, Y + h1, a0, a1, m, false);
    };
    // (inset from the ends a little, so neighbouring walls' fittings do not cross in the corners)
    const a0 = b0 + 0.04, a1 = b1 - 0.04;
    if (y0 < 0.01) {
      on(a0, a1, 0, 0.16, 0.025, M.trim);
      on(a0, a1, 0.06, 0.085, 0.035, M.guide);
    }
    if (y0 < 0.01 && y1 > H - 0.01) {
      on(a0, a1, 1.0, 1.07, 0.05, M.steel);
      if (len > 0.8) for (const a of [a0 + 0.07, a1 - 0.07]) on(a - 0.07, a + 0.07, 0.16, H - 0.12, 0.06, M.trim);
    }
    if (y1 > H - 0.01 && H - y0 > 0.2) {
      on(a0, a1, H - 0.12, H - 0.04, 0.07, M.trim);
      on(a0, a1, H - 0.115, H - 0.105, 0.075, M.cove);
    }
  }

  /** a door frame in the accent colour */
  private frame(h: Hole, along: 'x' | 'z', lo: number, Y: number) {
    const M = this.mat.accent, d = 0.08, a = lo - d, b = lo + T + d, y1 = Y + h.y1;
    if (along === 'x') {
      this.box(h.a0, h.a0 + 0.1, Y, y1, a, b, M, false);
      this.box(h.a1 - 0.1, h.a1, Y, y1, a, b, M, false);
      this.box(h.a0, h.a1, y1 - 0.1, y1, a, b, M, false);
    } else {
      this.box(a, b, Y, y1, h.a0, h.a0 + 0.1, M, false);
      this.box(a, b, Y, y1, h.a1 - 0.1, h.a1, M, false);
      this.box(a, b, y1 - 0.1, y1, h.a0, h.a1, M, false);
    }
  }

  /**
   * the outside's dressing, none of it over a window or a door: the canopy's
   * frame round the bridge glass, a dorsal spine with a glass bubble over the
   * commons' skylight, the wings' leading edges and the engine nacelles at
   * their tips, the shroud round the main engines with their exhaust cones,
   * canted tail fins, RCS blocks, sensor domes, antennas, running lights,
   * and the ship's name along its flanks
   */
  private dress(glow: THREE.Texture) {
    const g = this.group, M = this.mat;
    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.rotation.set(rx, ry, rz);
      g.add(o);
      return o;
    };
    // the canopy frame: a dark bezel round the bridge's front glass, and a visor ridge over it
    for (const [x0, x1, y0, y1] of [[-4.6, 4.6, 2.85, 3.2], [-4.6, 4.6, 0.25, 0.5], [-4.6, -4.25, 0.25, 3.2], [4.25, 4.6, 0.25, 3.2], [-0.1, 0.1, 0.5, 2.85]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.3), M.xdark);
      b.position.set((x0 + x1) / 2, (y0 + y1) / 2, -24.2);
      g.add(b);
    }
    mesh(new THREE.BoxGeometry(9.4, 0.35, 1.6), M.xdark, 0, 3.35, -23.6, 0.12, 0, 0);
    // the dorsal spine, fore and aft of the commons' skylight, and a glass bubble over the skylight
    // (the upper half of a cylinder, on each section's own roof)
    const spine = (z0: number, z1: number, roof = 3.0) => {
      const sp = mesh(new THREE.CylinderGeometry(1.5, 1.5, z1 - z0, 10, 1, false, Math.PI / 2, Math.PI), M.xhull, 0, roof + T, (z0 + z1) / 2, Math.PI / 2, 0, 0);
      sp.scale.set(1, 1, 0.55);
      return sp;
    };
    spine(-13.6, -6.2);
    spine(2.2, 7.75);
    spine(7.75, 18, 4.2);
    const bubble = mesh(new THREE.SphereGeometry(3.4, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x9cc4e6, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }), 0, 3.0 + 0.25, -2);
    bubble.scale.set(1, 0.42, 1.05);
    mesh(new THREE.TorusGeometry(3.4, 0.12, 6, 32), M.xdark, 0, 3.3, -2, Math.PI / 2, 0, 0).scale.set(1, 1.05, 1);
    // the wings' leading edges, a darker strip, and a fence
    for (const s of [1, -1]) {
      const le = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, Math.hypot(11.5, 6.5), 8), M.xdark);
      le.position.set(s * (4.7 + 5.75), 0.73, 11.25);
      le.rotation.set(Math.PI / 2, 0, 0);
      le.rotateX(0);
      le.rotation.z = 0;
      le.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(s * 11.5, 0, 6.5).normalize());
      g.add(le);
      mesh(new THREE.BoxGeometry(0.12, 0.6, 5), M.xaccent, s * 10, 1.1, 15.5);
      // the nacelle at the tip: a long pod with an intake ring at the front and a glowing nozzle at the back
      const nx = s * 16.6;
      mesh(new THREE.CylinderGeometry(1.1, 1.25, 9, 14), M.xhull, nx, 0.75, 15.5, Math.PI / 2, 0, 0);
      mesh(new THREE.CylinderGeometry(0.6, 1.1, 2.2, 14), M.xhull, nx, 0.75, 9.9, Math.PI / 2, 0, 0);
      mesh(new THREE.TorusGeometry(1.15, 0.12, 6, 16), M.xaccent, nx, 0.75, 11.1);
      mesh(new THREE.CylinderGeometry(1.0, 0.85, 1.2, 14, 1, true), M.xburnt, nx, 0.75, 20.6, Math.PI / 2, 0, 0);
      mesh(new THREE.CircleGeometry(0.8, 14), M.cyan, nx, 0.75, 20.3, 0, Math.PI, 0);
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x7fb4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      f.position.set(nx, 0.75, 21.4);
      g.add(f);
      this.flames.push(f);
      this.solids.push(new THREE.Box3(new THREE.Vector3(nx - 1.3, -0.5, 8.8), new THREE.Vector3(nx + 1.3, 2.0, 21)));
      // a canted tail fin over each side of the engines
      const fin = new THREE.Shape();
      fin.moveTo(0, 0); fin.lineTo(5.5, 0); fin.lineTo(6.8, 4.6); fin.lineTo(4.6, 4.6); fin.lineTo(0, 0);
      // (its outline along the ship, its thickness across, leaning outward from its root on engineering's roof)
      const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.25, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.125, 0, 0);
      mesh(fg, M.xhull, s * 3.4, 4.2 + T, 13.5, 0, 0, -s * 0.45);
      // RCS blocks: four nozzles on each corner of the hull
      for (const [y, z] of [[2.6, -20], [-1.2, -20], [2.6, 15], [-1.2, 15]]) {
        mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), M.xdark, s * 4.85, y, z);
        for (const [dy, dz] of [[0.42, 0], [-0.42, 0], [0, 0.42], [0, -0.42]]) mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.2, 6), M.xsteel, s * 4.85, y + dy, z + dz, dz ? Math.PI / 2 : 0, 0, 0);
      }
      // the ship's name along the flank, on the engineering section
      const tex = nameplate();
      if (tex) {
        const plate = mesh(new THREE.PlaneGeometry(7, 1.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), s * (4.5 + 0.27), 2.1, 13, 0, s * Math.PI / 2, 0);
        plate.renderOrder = 1;
      }
      // running lights along the flank
      for (const z of [-20, -10, 6, 17]) {
        const l = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff2c0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        l.position.set(s * 4.8, 3.05, z);
        l.scale.setScalar(0.6);
        g.add(l);
      }
    }
    // the shroud round the main engines: an octagonal cowling with a lip, open at the back
    const shroud = new THREE.CylinderGeometry(4.3, 4.0, 6.2, 8, 1, true);
    mesh(shroud, M.xdark, 0, 1.2, 21.3, Math.PI / 2, 0, Math.PI / 8).material = new THREE.MeshStandardMaterial({ color: 0x5a6274, flatShading: true, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide });
    mesh(new THREE.TorusGeometry(4.35, 0.2, 6, 8), M.xaccent, 0, 1.2, 24.4, 0, 0, Math.PI / 8);
    // exhaust cones in the nozzles
    for (const [x, y] of [[-2.6, 0.6], [2.6, 0.6], [0, 2.6]] as const) mesh(new THREE.ConeGeometry(0.45, 1.2, 10), M.xsteel, x, y, 24.9, -Math.PI / 2, 0, 0);
    // sensor domes under the prow and on the spine, and a pair of antennas
    mesh(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.xsteel, 0, -2.2, -21, Math.PI, 0, 0);
    mesh(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.xsteel, 0, 4.2 + T + 0.75, 10);
    for (const x of [-1.2, 1.2]) mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 4), M.xsteel, x, 5.4, 15, 0, 0, x * 0.15);
    // white strobes on the fin's tip and under the belly, flashing twice
    for (const [x, y, z] of [[0, 8.15, 18.4], [0, DECK_Y[1] - T - 0.4, 12.5], [0, -2.4, -30]]) {
      const st = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      st.position.set(x, y, z);
      st.scale.setScalar(3);
      g.add(st);
      this.strobes.push(st);
    }
    // the roofs' fittings: vents, junction boxes, conduits and hatches, where nothing else stands
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const kit = [M.xdark, M.xsteel, M.xhull, M.xdark];
    const fit = (x0: number, x1: number, z0: number, z1: number, y: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const w = 0.25 + rnd() * 0.9, d = 0.3 + rnd() * 1.4, h = 0.08 + rnd() * 0.3;
        const x = x0 + w / 2 + rnd() * (x1 - x0 - w), z = z0 + d / 2 + rnd() * (z1 - z0 - d);
        mesh(new THREE.BoxGeometry(w, h, d), kit[k % kit.length], x, y + h / 2, z);
      }
      // a conduit along the run
      mesh(new THREE.CylinderGeometry(0.07, 0.07, z1 - z0, 6), M.xsteel, x0 + 0.1, y + 0.08, (z0 + z1) / 2, Math.PI / 2, 0, 0);
    };
    for (const sd of [1, -1]) {
      // engineering's roof, either side of the spine and clear of the fin
      fit(sd > 0 ? 1.8 : -4.3, sd > 0 ? 4.3 : -1.8, 8.4, 17.6, 4.2 + T, 9);
      // the commons' roof, outboard of the skylight's bubble
      fit(sd > 0 ? 3.6 : -5.8, sd > 0 ? 5.8 : -3.6, -7.6, 3.6, 3 + T, 6);
      // the passages' and quarters' roofs
      fit(sd > 0 ? 1.7 : -4.3, sd > 0 ? 4.3 : -1.7, -13.5, -8.5, 3 + T, 4);
    }
  }

  /** a slab of hull: plating outside, `inner` (a box face: +x −x +y −y +z −z) panelled, and the face opposite too if it is `two`-sided */
  private slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, inner: number, m: THREE.Material, two = false) {
    const mats: THREE.Material[] = Array(6).fill(this.mat.xhull);
    // (the belly in the darker paint)
    mats[3] = this.mat.xdark;
    mats[inner] = m;
    if (two) mats[inner ^ 1] = m;
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

  private block(x0: number, x1: number, z0: number, z1: number) { this.blocks.push({ x0, x1, z0, z1, deck: this.deck }); }
  private round(x: number, z: number, r: number) { this.rounds.push({ x, z, r, deck: this.deck }); }

  private plant(x: number, z: number) {
    const Y = DECK_Y[this.deck];
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.5, 10), this.mat.accent);
    pot.position.set(x, Y + 0.25, z);
    this.group.add(pot);
    for (let k = 0; k < 7; k++) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.28), this.mat.leaf);
      leaf.position.set(x + Math.cos(k * 0.9) * 0.15, Y + 0.8 + (k % 2) * 0.12, z + Math.sin(k * 0.9) * 0.15);
      leaf.rotation.set(Math.sin(k * 0.9) * 0.5, k * 0.9, Math.cos(k * 0.9) * 0.5);
      this.group.add(leaf);
    }
    this.round(x, z, 0.38);
  }

  private lamp(x: number, y: number, z: number, color: number, k: number, dist: number) {
    const l = new THREE.PointLight(color, 14 * k, dist, 1.4);
    l.position.set(x, y, z);
    this.group.add(l);
    this.lights.push({ l, base: new THREE.Color(color), k: 14 * k });
  }

  private station(id: StationId, at: THREE.Vector3, label: string, reach: number) {
    this.stations.push({ id, at, label, reach, deck: this.deck });
  }

  /** a name plate over a door, facing along `rot` (about y) */
  private sign(text: string, x: number, y: number, z: number, rot: number, w = 1.3) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 96;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#1b2230';
    c.fillRect(0, 0, 512, 96);
    c.strokeStyle = '#d8643a';
    c.lineWidth = 6;
    c.strokeRect(3, 3, 506, 90);
    c.fillStyle = '#f0e6d0';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let px = 54;
    do { c.font = `600 ${px}px ui-sans-serif, system-ui, sans-serif`; px -= 2; } while (c.measureText(text).width > 470 && px > 20);
    c.fillText(text, 256, 50);
    const tex = canvasTex(cv);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(x, y, z);
    m.rotation.y = rot;
    this.group.add(m);
  }

  /** a live screen, `w` × `h` metres, drawn into a canvas of `cw` × `ch` */
  private screen(id: string, cw: number, ch: number, w: number, h: number, tint: string) {
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const tex = canvasTex(cv);
    this.screens.set(id, { cv, tex, key: '', tint });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    this.group.add(m);
    return m;
  }

  // ---------------------------------------------------------------- walking
  /** can someone of radius `r` stand at (x, z) on a deck? */
  canStand(x: number, z: number, r = 0.3, deck = 0) {
    if (!this.walk.some(w => w.deck === deck && x > w.x0 + r && x < w.x1 - r && z > w.z0 + r && z < w.z1 - r)) return false;
    if (this.blocks.some(b => b.deck === deck && x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r)) return false;
    return !this.rounds.some(c => c.deck === deck && (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2);
  }

  /** the station someone at `eye` on a deck, looking along `dir` (ship coordinates), can use */
  facing(eye: THREE.Vector3, dir: THREE.Vector3, deck = 0): Station | null {
    let best: Station | null = null, score = Infinity;
    const d = new THREE.Vector3();
    for (const s of this.stations) {
      if (s.deck !== deck) continue;
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

  /** the room a point (ship coordinates) is in */
  roomAt(p: THREE.Vector3, grow = 0): Room | null {
    for (const rm of this.rooms) {
      const { r } = rm;
      if (p.x >= r.x0 - grow && p.x <= r.x1 + grow && p.z >= r.z0 - grow && p.z <= r.z1 + grow && p.y >= rm.y - 0.01 && p.y <= rm.y + rm.H + 0.01) return rm;
    }
    return null;
  }

  /** the name of the room someone standing at (x, z) on a deck is in */
  roomName(x: number, z: number, deck = 0) {
    return this.roomAt(new THREE.Vector3(x, DECK_Y[deck] + 1, z))?.name ?? 'doorway';
  }

  /**
   * whether something far off along `dir` can be seen from `eye` (ship
   * coordinates): through the windows, open doors and the skylight, not
   * through the walls. Outside the hull, everything can.
   */
  seesOut(eye: THREE.Vector3, dir: THREE.Vector3) {
    // in a doorway, inside the thickness of a wall: as if just inside the room it opens from
    let rm = this.roomAt(eye) ?? this.roomAt(eye, T + 0.05);
    if (!rm) return true;
    const p = eye.clone(), q = new THREE.Vector3();
    p.x = Math.min(rm.r.x1, Math.max(rm.r.x0, p.x));
    p.z = Math.min(rm.r.z1, Math.max(rm.r.z0, p.z));
    for (let hop = 0; hop < 5; hop++) {
      const { r } = rm;
      const tx = dir.x > 1e-9 ? (r.x1 - p.x) / dir.x : dir.x < -1e-9 ? (r.x0 - p.x) / dir.x : Infinity;
      const ty = dir.y > 1e-9 ? (rm.y + rm.H - p.y) / dir.y : dir.y < -1e-9 ? (rm.y - p.y) / dir.y : Infinity;
      const tz = dir.z > 1e-9 ? (r.z1 - p.z) / dir.z : dir.z < -1e-9 ? (r.z0 - p.z) / dir.z : Infinity;
      const t = Math.max(0, Math.min(tx, ty, tz));
      q.copy(p).addScaledVector(dir, t);
      if (ty <= tx && ty <= tz) return dir.y > 0 && !!rm.sky && q.x > rm.sky.x0 && q.x < rm.sky.x1 && q.z > rm.sky.z0 && q.z < rm.sky.z1;
      const s: Side = tx <= tz ? (dir.x > 0 ? 'e' : 'w') : (dir.z > 0 ? 's' : 'n');
      const along = s === 'n' || s === 's' ? q.x : q.z, n = Math.abs(s === 'n' || s === 's' ? dir.z : dir.x);
      // across the wall, into whatever is on the other side
      const next = q.clone().addScaledVector(dir, Math.min(3, (T + 0.03) / Math.max(n, 1e-3)));
      const there = this.roomAt(next);
      const opp: Record<Side, Side> = { n: 's', s: 'n', w: 'e', e: 'w' };
      let holes: Wall = rm.walls[s];
      if ((holes === 'none' || holes === 'open') && there) holes = there.walls[opp[s]];
      if (holes === 'none') return false;
      if (holes !== 'open') {
        const h = q.y - rm.y, hole = holes.find(o => along >= o.a0 && along <= o.a1 && h >= o.y0 && h <= o.y1);
        if (!hole) return false;
        if (hole.glass) return true;
      }
      if (!there) return holes !== 'open';
      rm = there;
      p.copy(next);
    }
    return false;
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
  /** a screen: a title and a few lines of readout */
  drawScreen(id: string, lines: string[]) {
    const s = this.screens.get(id);
    if (!s) return;
    const key = lines.join('|');
    if (key === s.key) return;
    s.key = key;
    const { cv, tex } = s, g = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#081a26');
    bg.addColorStop(1, '#030b12');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const lh = Math.floor(H / Math.max(5, lines.length + 0.6));
    const fs = Math.floor(lh * 0.72);
    g.textBaseline = 'top';
    lines.forEach((l, k) => {
      g.font = `${k === 0 ? 700 : 500} ${fs}px ui-monospace, Menlo, Consolas, monospace`;
      g.fillStyle = k === 0 ? s.tint : '#bfefff';
      g.fillText(l, Math.round(W * 0.04), Math.round(lh * 0.3 + k * lh), W * 0.92);
    });
    g.fillStyle = s.tint;
    g.globalAlpha = 0.5;
    g.fillRect(Math.round(W * 0.04), Math.round(lh * 1.12), Math.round(W * 0.92), 2);
    g.globalAlpha = 1;
    // scan lines, faintly
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
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
    for (const t of this.trophies) { this.group.remove(t); const m = t.material as THREE.MeshLambertMaterial; m.map?.dispose(); m.dispose(); }
    this.trophies = maps.slice(0, this.trophySlots.length).map((tex, k) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 12), new THREE.MeshLambertMaterial({ map: tex }));
      m.position.copy(this.trophySlots[k]);
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
  }

  /** the globe in the lab: the target's surface, or blank */
  setGlobe(tex: THREE.Texture | null) {
    const m = this.globe.material as THREE.MeshLambertMaterial;
    m.map = tex;
    m.color.setHex(tex ? 0xffffff : 0x40505a);
    m.needsUpdate = true;
  }

  /** the sample locker: a lit vial for each world brought aboard */
  setSamples(colors: number[]) {
    this.vials.forEach((v, k) => (v.material as THREE.MeshBasicMaterial).color.setHex(k < colors.length ? colors[k] : 0x24303a));
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
    const ph = t % 1.7, strobe = ph < 0.06 || (ph > 0.22 && ph < 0.28) ? 1 : 0;
    for (const st of this.strobes) st.material.opacity = strobe;
    this.hatchLight.color.setHex(s.boardable ? (Math.sin(t * 6) > 0 ? 0x40ff70 : 0x103018) : 0x40ff70);
    this.holoRing.rotation.z += dt * 0.4;
    this.trophies.forEach((m, k) => { m.rotation.y = t * 0.3 + k; });
    this.globe.rotation.y = t * 0.25;
    const f = 1.4 + 3 * s.thrust + 3 * s.od;
    for (const fl of this.flames) {
      fl.scale.setScalar(f * (0.92 + 0.08 * Math.sin(t * 30 + fl.position.x)));
      fl.material.color.setHex(s.worm > 0.05 ? 0xc890ff : s.od > 0.05 ? 0xe0e8ff : 0x7fb4ff);
    }
  }

  /**
   * something for the outside's metal to reflect, made once: a dark sky with a broad warm light to one
   * side, a dimmer cool one opposite and a few small bright ones, so the plates shine as the ship turns
   */
  setEnv(r: THREE.WebGLRenderer) {
    const pm = new THREE.PMREMGenerator(r), sc = new THREE.Scene();
    sc.background = new THREE.Color(0x06080d);
    const panel = (w: number, h: number, color: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      sc.add(m);
    };
    panel(60, 40, 0xfff0dc, 70, 40, -40);
    panel(90, 50, 0x30486a, -70, -30, 30);
    panel(30, 30, 0x9aa6b8, 0, 90, 0);
    for (const [x, y, z] of [[-40, 30, -70], [50, -40, 60], [-60, 10, -20], [20, -70, -30]]) panel(6, 6, 0xffffff, x, y, z);
    const env = pm.fromScene(sc, 0.03).texture;
    const M = this.mat;
    this.group.traverse(o => {
      const ms = (o as THREE.Mesh).material;
      for (const m of Array.isArray(ms) ? ms : ms ? [ms] : []) if (m instanceof THREE.MeshStandardMaterial) { m.envMap = env; m.envMapIntensity = 1; m.needsUpdate = true; }
    });
    M.xsteel.envMap = env;
    pm.dispose();
  }

  /**
   * from inside, the outside in plain paint: it is only glimpsed through the windows, and its shining metal
   * would cost more than the rooms themselves, lit behind every wall whether it shows or not
   */
  viewFrom(inside: boolean) {
    for (const o of this.outer) o.m.material = inside ? o.plain : o.shine;
  }

  /** for the landing to come: open the bay doors (0 shut – 1 open) */
  setBay(open: number) {
    const [a, b] = this.bayDoors;
    a.position.x = -0.92 - 3.0 * open;
    b.position.x = 2.12 + 3.0 * open;
  }

  /**
   * the landing legs: `out` swings them down (0 stowed – 1 deployed), and
   * `reach` (m, straight down from each leg's hip, in the ship's frame) is how
   * far each strut telescopes to find the ground
   */
  setLegs(out: number, reach?: number[]) {
    this.legs.forEach((l, k) => {
      const bridge = l.position.z < 0;
      const ang = bridge ? 0 : Math.sign(l.position.x) * out * 0.35;
      l.rotation.z = ang;
      const stowed = bridge ? 0.3 : 3.2;
      const want = reach?.[k] !== undefined ? Math.max(1.2, reach[k] / Math.cos(ang)) : stowed + (6 - stowed) * out;
      const len = stowed + (want - stowed) * Math.min(1, out);
      const strut = l.getObjectByName('strut')!, pad = l.getObjectByName('pad')!;
      strut.scale.y = len;
      strut.position.y = -len / 2;
      pad.position.y = -len - 0.05;
      pad.visible = out > 0.05 || !bridge;
    });
  }

  /** the boarding ladder: down to `drop` m below the airlock's sill, or stowed */
  setLadder(drop: number | null) {
    this.ladder.visible = drop !== null;
    if (drop === null) return;
    const len = Math.max(1, drop);
    for (const r of this.ladder.children) if (r.name === 'rail') { r.scale.y = len; r.position.y = -len / 2; }
    const want = Math.floor(len / 0.32);
    while (this.rungs.length < want) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), this.mat.xsteel);
      this.ladder.add(r);
      this.rungs.push(r);
    }
    this.rungs.forEach((r, k) => { r.visible = k < want; r.position.y = -0.3 - k * 0.32; });
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

/** texture coordinates from where each face is, in metres (a texture covers two), projected along its normal */
function worldUV(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const [u, v] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
    uv[i * 2] = u / 2;
    uv[i * 2 + 1] = v / 2;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function canvasTex(cv: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** a tileable grey texture for a kind of surface, two metres square, that the material's colour tints */
function plating(kind: 'hull' | 'wall' | 'floor' | 'ceil') {
  const N = 256, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d')!;
  let seed = { hull: 7, wall: 13, floor: 29, ceil: 41 }[kind];
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const px = N / 2; // pixels a metre
  c.fillStyle = '#e8e8e8';
  c.fillRect(0, 0, N, N);
  const panel = (x: number, y: number, w: number, h: number, shade: number) => {
    c.fillStyle = `rgb(${shade},${shade},${shade})`;
    c.fillRect(x, y, w, h);
  };
  const seam = (x: number, y: number, w: number, h: number) => {
    c.fillStyle = 'rgba(40,40,40,0.55)';
    c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(x + (w > h ? 0 : w), y + (w > h ? h : 0), w > h ? w : 1, w > h ? 1 : h);
  };
  const bolt = (x: number, y: number) => {
    c.fillStyle = 'rgba(60,60,60,0.6)';
    c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(x - 1, y - 1, 1, 1);
  };
  if (kind === 'floor') {
    // one-metre plates with a tread of little bars
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      panel(i * px, j * px, px, px, 205 + Math.floor(rnd() * 30));
      for (let a = 8; a < px - 6; a += 10) for (let b = 8; b < px - 6; b += 10) {
        c.fillStyle = 'rgba(255,255,255,0.22)';
        if ((a + b) % 20) c.fillRect(i * px + a, j * px + b, 6, 2); else c.fillRect(i * px + a + 2, j * px + b - 2, 2, 6);
      }
      for (const [bx, by] of [[5, 5], [px - 5, 5], [5, px - 5], [px - 5, px - 5]]) bolt(i * px + bx, j * px + by);
    }
    for (let k = 0; k <= 2; k++) { seam(k * px - 1, 0, 2, N); seam(0, k * px - 1, N, 2); }
  } else if (kind === 'wall') {
    // tall panels with a rail across at waist height, alternating tone
    for (let i = 0; i < 4; i++) {
      panel(i * px / 2, 0, px / 2, N, 215 + Math.floor(rnd() * 25));
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(i * px / 2 + 6, 8, px / 2 - 12, 3);
    }
    for (let k = 0; k <= 4; k++) seam(k * px / 2 - 1, 0, 2, N);
    c.fillStyle = 'rgba(30,30,30,0.35)';
    c.fillRect(0, N - Math.round(1.05 * px) - 6, N, 10);
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.fillRect(0, N - Math.round(1.05 * px) - 7, N, 1);
    // a small vent
    c.fillStyle = 'rgba(40,40,40,0.4)';
    for (let k = 0; k < 5; k++) c.fillRect(px * 1.1, N - px * 0.35 + k * 5, px * 0.3, 2);
  } else if (kind === 'ceil') {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) panel(i * px / 2, j * px / 2, px / 2, px / 2, 210 + Math.floor(rnd() * 30));
    for (let k = 0; k <= 4; k++) { seam(k * px / 2 - 1, 0, 2, N); seam(0, k * px / 2 - 1, N, 2); }
    c.fillStyle = 'rgba(40,40,40,0.35)';
    for (let k = 0; k < 6; k++) c.fillRect(px * 0.15, px * 0.15 + k * 6, px * 0.2, 3);
  } else {
    // hull plating: big plates, a metre high and two long, staggered, a little uneven, riveted along their edges
    const rows = 2, h = N / rows;
    for (let j = 0; j < rows; j++) {
      const off = (j % 2) * px;
      for (let i = -1; i < 2; i++) {
        panel(off + i * 2 * px, j * h, 2 * px, h, 222 + Math.floor(rnd() * 18));
        seam(off + i * 2 * px - 1, j * h, 2, h);
        for (let k = 8; k < h; k += 16) bolt(off + i * 2 * px + 6, j * h + k);
      }
      seam(0, j * h - 1, N, 2);
      for (let k = 8; k < N; k += 16) bolt(k, j * h + 6);
    }
    // and an access panel or two
    c.strokeStyle = 'rgba(50,50,50,0.5)';
    c.lineWidth = 1.5;
    c.strokeRect(px * 0.3, px * 0.3, px * 0.4, px * 0.3);
    c.strokeRect(px * 1.25, px * 1.35, px * 0.5, px * 0.2);
  }
  // a little grime
  for (let k = 0; k < 900; k++) {
    c.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rnd() * 0.04})`;
    c.fillRect(rnd() * N, rnd() * N, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** the outside's plating, painted metal: its seams and rivets in relief, from the plating's own picture */
function metal(color: number, metalness: number, roughness: number, kind: 'hull') {
  const map = plating(kind);
  return new THREE.MeshStandardMaterial({ color, flatShading: true, map, metalness, roughness, normalMap: reliefOf(map.image as HTMLCanvasElement, 3), normalScale: new THREE.Vector2(0.7, 0.7) });
}

/** a normal map from a picture's light and dark: the dark seams sunk, the light plates raised */
function reliefOf(src: HTMLCanvasElement, k: number) {
  const N = src.width, M = src.height, d = src.getContext('2d')!.getImageData(0, 0, N, M).data;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = M;
  const c = cv.getContext('2d')!, out = c.createImageData(N, M);
  const h = (x: number, y: number) => d[(((y + M) % M) * N + ((x + N) % N)) * 4] / 255;
  for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * k, dy = (h(x, y + 1) - h(x, y - 1)) * k;
    const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  c.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** yellow and black diagonal stripes */
function hazardTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#1c1c1c';
  c.fillRect(0, 0, 256, 256);
  c.fillStyle = '#e8b830';
  for (let k = -256; k < 512; k += 32) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 16, 0); c.lineTo(k + 272, 256); c.lineTo(k + 256, 256); c.fill(); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** a poster for the quarters: a ringed world over a dusky moon */
function posterTexture() {
  const cv = document.createElement('canvas');
  cv.width = 330; cv.height = 225;
  const c = cv.getContext('2d')!;
  const sky = c.createLinearGradient(0, 0, 0, 225);
  sky.addColorStop(0, '#0b1030');
  sky.addColorStop(1, '#3a2048');
  c.fillStyle = sky;
  c.fillRect(0, 0, 330, 225);
  for (let k = 0; k < 60; k++) { c.fillStyle = `rgba(255,255,255,${0.3 + (k % 5) / 8})`; c.fillRect((k * 97) % 330, (k * 53) % 150, 1.5, 1.5); }
  const pl = c.createRadialGradient(150, 80, 6, 170, 95, 62);
  pl.addColorStop(0, '#ffe6b0');
  pl.addColorStop(1, '#a8743c');
  c.fillStyle = pl;
  c.beginPath(); c.arc(170, 95, 55, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(240,220,180,0.8)';
  c.lineWidth = 5;
  c.beginPath(); c.ellipse(170, 95, 105, 22, -0.25, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#2a1830';
  c.beginPath(); c.ellipse(165, 250, 260, 70, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#f0e6d0';
  c.font = '600 20px ui-sans-serif, system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('VISIT THE RINGS', 165, 212);
  c.strokeStyle = '#d8643a';
  c.lineWidth = 8;
  c.strokeRect(0, 0, 330, 225);
  return canvasTex(cv);
}

/** a little canvas of made-up graphs for the side consoles, under a title */
function graphTexture(seed: number, title: string) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 106;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#04121c';
  g.fillRect(0, 0, 512, 106);
  const col = seed > 0 ? '#7fe0ff' : '#ffb070';
  g.fillStyle = col;
  g.font = '700 22px ui-monospace, Menlo, monospace';
  g.textBaseline = 'top';
  g.fillText(title, 12, 8);
  for (let x = 0; x < 300; x += 6) {
    const h = 8 + 50 * Math.abs(Math.sin(x * 0.03 * seed + Math.cos(x * 0.013)));
    g.globalAlpha = 0.85;
    g.fillRect(200 + x, 96 - h, 4, h);
  }
  g.globalAlpha = 1;
  g.strokeStyle = col;
  g.lineWidth = 2;
  g.beginPath();
  for (let x = 0; x < 180; x += 3) g.lineTo(12 + x, 70 + 18 * Math.sin(x * 0.09 * seed));
  g.stroke();
  return canvasTex(cv);
}

/** the ship's name, stencilled, for its flanks */
function nameplate() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8643a'; g.fillRect(0, 62, 512, 8);
  g.font = 'bold 54px sans-serif';
  g.fillStyle = '#2a303c';
  g.textBaseline = 'middle';
  g.fillText('ORBITAL  ·  NX-01', 12, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
