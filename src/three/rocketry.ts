import * as THREE from 'three';
import { model, type ModelName } from './models';

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
}

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

/** the rocket's model (its stand-in until it loads), with an exhaust plume under its engines */
export function rocketMesh(kind: RocketModel): THREE.Group {
  const g = new THREE.Group(), spec = ROCKETS[kind];
  const body = new THREE.Group();
  body.name = 'rocket-body';
  g.add(body);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, spec.height, 12).translate(0, spec.height / 2, 0), new THREE.MeshLambertMaterial({ color: 0xd8dade }));
  stand.name = 'stand-in';
  body.add(stand);
  const put = (root: THREE.Group) => { body.remove(stand); const o = root.clone(); o.traverse(x => { x.frustumCulled = false; }); body.add(o); };
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
