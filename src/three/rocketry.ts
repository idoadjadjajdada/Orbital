import * as THREE from 'three';
import { model, clips, type ModelName } from './models';
import { Interior } from './interior';

/**
 * The rockets: three of them, built from modules, that carry people and
 * cargo from pad to pad.
 *
 * The C-01 Courier is small: a pilot and one cargo bay. The P-06 Wayfarer
 * carries crew: two pilots, four passengers and a service bay. The H-12
 * Mammoth carries freight: two cargo decks and two side boosters, room for
 * a rover. They are stacked on a launch pad's landing circle or a base's pad
 * and fly from there to any other pad or base, on the same world or another,
 * or up to a station. They land on their legs where they are going.
 *
 * A flight is three parts. First a vertical climb off the pad. Then the
 * cruise: a ballistic arc to a pad on the same world, or a straight run
 * between worlds that are both moving. Last a burn down onto the pad, slowing
 * to nothing at the legs. Each is shown faster than real, so a hop across a
 * continent takes about a minute and a trip to Mars about two.
 */

export type RocketModel = 'courier' | 'wayfarer' | 'mammoth';

export interface RocketSpec { model: ModelName; name: string; seats: number; holds: number; about: string; height: number }
export const ROCKETS: Record<RocketModel, RocketSpec> = {
  courier: { model: 'rocket-courier', name: 'C-01 Courier', seats: 0, holds: 1, about: 'A pilot and one cargo bay: small deliveries, quick hops', height: 11.4 },
  wayfarer: { model: 'rocket-wayfarer', name: 'P-06 Wayfarer', seats: 4, holds: 1, about: 'Crew transfer: two pilots, four passengers, a service bay', height: 15.7 },
  mammoth: { model: 'rocket-mammoth', name: 'H-12 Mammoth', seats: 0, holds: 4, about: 'Freight: two cargo decks and two boosters; carries a rover', height: 16.5 },
};
/** a hold of supplies keeps a crew of six this many days */
export const HOLD_DAYS = 30;

/** what a rocket carries */
export interface Manifest { crew: number; supplies: number; rover: boolean }

/** one end of a flight: a pad, a base or a station (its craft id) */
export interface TripEnd { site: number }
export interface Trip {
  from: TripEnd; to: TripEnd;
  /** seconds in, and the length of each part */
  t: number; Ta: number; Tc: number; Td: number;
  /** a hop on one world (an arc over the ground) rather than a run between worlds */
  hop: boolean;
  /** how high the climb and descent go (m), and how high the hop's arc rises over them */
  A1: number; A2: number; apex: number;
}

export interface RocketState {
  kind: RocketModel;
  /** where it stands (a pad's or base's id), or the station it is docked at; null in flight */
  at: number | null;
  docked: boolean;
  load: Manifest;
  trip: Trip | null;
  /** you are aboard */
  aboard: boolean;
  /** flights flown */
  flights: number;
  /** its doors and hatches: 0 shut – 1 open */
  doors: number;
  /** where it last flew from, to fly back to */
  home: number | null;
  /** a supply route: from `a` to `b` with `load`, back empty, again and again; `wait` s until the next leg */
  route: { a: number; b: number; load: Manifest; runs: number; wait: number } | null;
}
/** seconds a rocket on a supply route stands at each end, unloading and loading */
export const TURNAROUND = 20;

/** how long each part of a flight takes (s), from what kind of flight and how far */
export function plan(hop: boolean, dist: number, fromGround: boolean, toGround: boolean): Omit<Trip, 'from' | 'to' | 't'> {
  if (hop) return { Ta: 10, Td: 14, Tc: 15 + 10 * Math.log10(1 + dist / 1e4), hop, A1: 1500, A2: 1500, apex: Math.max(3000, Math.min(250e3, dist * 0.2)) };
  return { Ta: fromGround ? 22 : 0, Td: toGround ? 24 : 0, Tc: 20 + 6 * Math.log10(1 + dist / 1e7), hop, A1: fromGround ? 120e3 : 0, A2: toGround ? 120e3 : 0, apex: 0 };
}

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/**
 * where along its flight a rocket is: which part, how far through it (0–1),
 * and for the climb and the descent how high over the pad (m)
 */
export function phase(tr: Trip): { part: 'climb' | 'cruise' | 'descent'; u: number; alt: number } {
  const t = tr.t;
  if (t < tr.Ta) { const u = t / tr.Ta; return { part: 'climb', u, alt: tr.A1 * u * u }; }
  if (t < tr.Ta + tr.Tc) return { part: 'cruise', u: smooth((t - tr.Ta) / tr.Tc), alt: 0 };
  const u = Math.min(1, (t - tr.Ta - tr.Tc) / Math.max(1e-6, tr.Td));
  return { part: 'descent', u, alt: tr.A2 * (1 - u) * (1 - u) };
}

/** open a rocket's doors and hatches (its model's group): 0 shut – 1 open */
export function setDoors(g: THREE.Object3D, open: number) {
  const d = g.userData.doors as { mixer: THREE.AnimationMixer; acts: THREE.AnimationAction[]; open: number } | undefined;
  if (!d || Math.abs(d.open - open) < 1e-4) return;
  d.open = open;
  for (const a of d.acts) a.time = open * a.getClip().duration;
  d.mixer.update(0);
}

/** the rocket's model (its stand-in until it loads), with an exhaust plume under its engines */
export function rocketMesh(kind: RocketModel): THREE.Group {
  const g = new THREE.Group(), spec = ROCKETS[kind];
  g.name = 'rocket-model';
  const body = new THREE.Group();
  body.name = 'rocket-body';
  g.add(body);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, spec.height, 12).translate(0, spec.height / 2, 0), new THREE.MeshLambertMaterial({ color: 0xd8dade }));
  stand.name = 'stand-in';
  body.add(stand);
  const put = (root: THREE.Group) => {
    body.remove(stand);
    const o = root.clone();
    o.traverse(x => { x.frustumCulled = false; });
    body.add(o);
    // its doors and hatches, from the model's own animations: each held at a point along its opening
    const cl = clips.get(spec.model) ?? [];
    if (cl.length) {
      const mixer = new THREE.AnimationMixer(o);
      const acts = cl.map(c => { const a = mixer.clipAction(c); a.play(); a.paused = true; return a; });
      g.userData.doors = { mixer, acts, open: -1 };
      setDoors(g, 0);
    }
  };
  const m = model(spec.model);
  if (m) put(m);
  else import('./models').then(x => x.load(spec.model)).then(r => { if (r) put(r); });
  // the plume: a bright core in a wider glow, narrow at the engines and spreading below them
  const plume = new THREE.Group();
  plume.name = 'plume';
  plume.visible = false;
  const core = new THREE.Mesh(new THREE.ConeGeometry(1.1, 9, 12, 1, true).translate(0, -4.5, 0), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const glow = new THREE.Mesh(new THREE.ConeGeometry(2.2, 16, 12, 1, true).translate(0, -8, 0), new THREE.MeshBasicMaterial({ color: 0xff8030, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  plume.add(core, glow);
  plume.position.y = 0.2;
  g.add(plume);
  return g;
}

/** a deck's name, from its module's: "03_PassengerCabin" → "Passenger cabin"; the capsule is the flight deck */
function deckName(mod: string) {
  const w = mod.replace(/^\d+_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return w === 'command capsule' ? 'Flight deck' : w[0].toUpperCase() + w.slice(1);
}

/**
 * the inside of a standing rocket, from its model (its group, once loaded):
 * a round deck over each module's floor, as wide as the floor, up to the next
 * floor or the top of its hull; the ladders between them, climbed at their
 * hatches; its airlock doors out; the crates and ladders in the way; a light
 * on each deck's ceiling. Null until the model is in.
 */
export function rocketInterior(rm: THREE.Object3D, name: string): Interior | null {
  rm.updateMatrixWorld(true);
  const inv = rm.matrixWorld.clone().invert();
  // (boxes in the rocket's own frame: each mesh's own box carried into it, not the scene's box of a tilted rocket)
  const box = (o: THREE.Object3D) => {
    const b = new THREE.Box3();
    o.traverse(x => { const m = x as THREE.Mesh; if (!m.isMesh) return; m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox!.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld))); });
    return b;
  };
  const at = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
  const floors: { mod: string; y: number; r: number; o: THREE.Object3D }[] = [], hulls = new Map<string, THREE.Box3>();
  rm.traverse(o => {
    const f = /^(\d+_\w+?)_floor$/.exec(o.name), h = /^(\d+_\w+?)_hull$/.exec(o.name);
    if (f) { const b = box(o); floors.push({ mod: f[1], y: b.max.y, r: (b.max.x - b.min.x) / 2, o }); }
    if (h) hulls.set(h[1], box(o));
  });
  if (!floors.length) return null;
  floors.sort((a, b) => a.y - b.y);
  const I = new Interior(name, false);
  const decks = floors.map((f, k) => ({ ...f, name: deckName(f.mod), top: k + 1 < floors.length ? floors[k + 1].y - 0.12 : Math.min(f.y + 2.6, hulls.get(f.mod)?.max.y ?? f.y + 2.6) }));
  const deckOf = (y: number) => decks.findIndex((d, k) => y >= d.y - 0.3 && (k + 1 === decks.length || y < decks[k + 1].y - 0.3));
  decks.forEach((d, k) => {
    const disc = { x: 0, z: 0, r: d.r, y0: d.y, y1: d.top };
    I.discs.push(disc);
    I.regions.push({ name: d.name, disc });
    I.lamps.push(new THREE.Vector3(0, d.top - 0.3, 0));
    if (k + 1 < decks.length) I.addSpot(`r-up:${k}`, new THREE.Vector3(0, d.y + 1.3, -0.45), `Climb up to the ${decks[k + 1].name.toLowerCase()}`);
    if (k > 0) I.addSpot(`r-down:${k}`, new THREE.Vector3(0, d.y + 0.05, 0), `Climb down to the ${decks[k - 1].name.toLowerCase()}`);
  });
  const parts: THREE.Object3D[] = [];
  rm.traverse(o => parts.push(o));
  for (const o of parts) {
    const n = o.name;
    if (/^DOOR_Airlock/.test(n)) { const p = at(o), k = deckOf(p.y); if (k >= 0) I.addSpot(`r-out:${k}`, new THREE.Vector3(0, decks[k].y + 1.2, p.z - 0.2), 'Step outside'); }
    else if (/^CARGO_Crate_\d+_\d+(_\d+)?$/.test(n)) { I.solids.push(box(o)); const p = at(o); I.addSpot('r-crate', p.setY(p.y + 0.8), 'A crate of supplies', 1.8); }
    else if (/_ladder$/.test(n)) I.solids.push(box(o));
    else if (/^Cargo[ _]management[ _]terminal/.test(n)) I.addSpot('r-cargo', at(o), 'The cargo terminal');
    else if (/^SEAT_Pilot_01$/.test(n)) { const p = at(o); I.addSpot('r-pilot', p.setY(p.y + 0.9), 'Take the pilot’s seat: where to fly'); }
    else if (/^SEAT_Passenger_\d+$/.test(n)) { const p = at(o); I.addSpot('r-seat', p.setY(p.y + 0.8), 'A passenger seat', 1.8); }
    else if (/^Life[ _]support[ _]display/.test(n)) I.addSpot('r-life', at(o), 'Life support');
  }
  // in through the lowest airlock, facing in
  const door = I.spots.find(s => s.id.startsWith('r-out:'));
  I.floor = decks[0].y;
  const k0 = door ? Number(door.id.slice(6)) : 0;
  I.spawn = { p: new THREE.Vector3(0, decks[k0].y, door ? decks[k0].r - 0.65 : 0.6), yaw: 0 };
  return I;
}
