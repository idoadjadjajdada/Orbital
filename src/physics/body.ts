import { schwarzschild, densityOf } from './units';
import type { Shape } from './materials';

/** What a body is made of — this decides how it collides, tears and evolves. */
export type Cls =
  | 'rock'    // silicate / iron worlds and small bodies
  | 'ice'     // ice-rich worlds, comets
  | 'gas'     // giant planets, brown dwarfs
  | 'star'    // anything fusing (or about to)
  | 'wd' | 'ns' | 'bh'
  | 'debris'  // solid fragments
  | 'gasp';   // gas parcels: stellar winds, ejecta, nebulae

/** Purely visual: picks the surface shader and its palette. */
export type Style =
  | 'terran' | 'ocean' | 'rocky' | 'barren' | 'ice' | 'lava' | 'iron' | 'carbon' | 'desert'
  | 'gas' | 'icegiant' | 'hotjupiter' | 'browndwarf'
  | 'star' | 'wd' | 'ns' | 'bh';

export interface Look {
  style: Style;
  seed: number;
  /** two surface colours, 0xRRGGBB, the shader mixes between them */
  c1: number;
  c2: number;
  atmo?: number;            // rim-glow colour
  /** in body radii; `kind` picks a measured radial profile */
  rings?: { inner: number; outer: number; color: number; opacity: number; kind?: 'saturn' | 'uranus' | 'neptune' | 'jupiter' };
  pulsar?: boolean;
  /** a magnetar: a pulsar whose field gives way now and then in a giant flare */
  magnetar?: boolean;
  /** hypothetical objects drawn their own way */
  white?: boolean;
  wormhole?: boolean;
  /** a spacecraft: which pixel sprite */
  craft?: 'station' | 'telescope' | 'mirror' | 'probe' | 'sat' | 'sail' | 'lander';
  /** a real world, painted from its maps rather than made up (its name) */
  real?: string;
}

export type Phase = 'proto' | 'ms' | 'giant' | 'agb' | 'remnant' | 'none';

export interface StarState {
  m0: number;      // mass the star was born with — sets its whole life
  age: number;     // yr since zero-age main sequence (negative while contracting)
  phase: Phase;
  L: number;       // luminosity, L_sun
  teff: number;    // K
  coreM: number;   // the remnant it will leave
}

let nextId = 1;
/** a new body id */
export function freshId() { return nextId++; }

export class Body {
  id = nextId++;
  name: string;
  kind: string;  // catalogue key, or 'fragment' / 'gas' / 'custom'
  cls: Cls;
  look: Look;

  m: number;     // Msun
  r: number;     // AU — physical radius (for a black hole, its horizon)

  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;

  // ---- Hermite integrator state (owned by integrator.ts) ----
  ax = 0; ay = 0; az = 0;
  jx = 0; jy = 0; jz = 0;
  px = 0; py = 0; pz = 0;     // predicted position at the current block time
  pvx = 0; pvy = 0; pvz = 0;
  nax = 0; nay = 0; naz = 0;   // acceleration and jerk at the end of the step being taken
  njx = 0; njy = 0; njz = 0;
  ncross = Infinity;
  t = 0;                       // time this body's state refers to, within the frame
  dt = 0;                      // current block step
  dtWant = 0;                  // what the error criterion asked for

  /** Exerts gravity. Fragments and gas parcels are test particles: they feel
   *  everything that is a source, but nothing feels them. */
  source: boolean;
  alive = true;
  /** set while held by the pointer: its state is overwritten every frame */
  held = false;

  heat = 0;          // 0..1, visual glow after an impact, cools with time
  spin: number;      // rad/yr, visual
  spinAngle = 0;
  tilt: number;      // rad, obliquity of the spin axis
  node = 0;          // rad, which way the spin axis leans
  beta = 0;          // radiation-pressure / gravity ratio (test particles only)
  /** a fragment's age, so a nebula can thin out */
  age = 0;
  star?: StarState;
  hostId = 0;        // cached orbital host (analysis.ts), 0 = none
  /** Roche distance from a source of mass M is rocheK · ∛M; 0 = cannot be torn apart */
  rocheK = 0;
  /** a tidal pass under way: the source it is passing, the distance at which it
   *  comes apart on this pass (0 = already dealt with), and when it began */
  tidalHost = 0;
  tidalR = 0;
  tidalT = 0;
  /** for fragments and particles: the bulk density (g/cm³) of what they came from */
  dens = 3;
  /** mass is an estimate from an assumed size and density, not a measurement */
  sizeGuess = false;
  /** craters, in the body's own turning frame (see `toBodyFrame`): unit direction, angular radius (rad), sim time made */
  craters: { x: number; y: number; z: number; a: number; t: number }[] = [];
  /** a hand-drawn body: its outline and what it is made of, while it holds a shape */
  shape?: Shape;
  /**
   * An active nucleus: gas in an inner accretion disc too small to resolve,
   * already counted in the body's mass, falling in at `feed` M☉/yr until
   * `feedLeft` is used up. It powers the jets from the start, rather than
   * waiting for the resolved ring of gas to spiral in.
   */
  feed = 0;
  feedLeft = 0;
  /** the other mouth of a wormhole */
  partnerId = 0;
  /** compact objects: mass swallowed since the renderer last looked, and the angular momentum it brought */
  swallowed = 0;
  lx = 0; ly = 0; lz = 0;

  constructor(o: {
    name: string; kind: string; cls: Cls; look: Look; m: number; r: number;
    source?: boolean; spin?: number; tilt?: number; star?: StarState;
  }) {
    this.name = o.name;
    this.kind = o.kind;
    this.cls = o.cls;
    this.look = o.look;
    this.m = o.m;
    this.r = o.r;
    this.source = o.source ?? true;
    this.spin = o.spin ?? 2 * Math.PI * 365.25;
    this.tilt = o.tilt ?? 0;
    this.star = o.star;
  }

  get compact() { return this.cls === 'wd' || this.cls === 'ns' || this.cls === 'bh'; }
  get luminous() { return !!this.star && this.star.L > 0; }
  get isParticle() { return this.cls === 'debris' || this.cls === 'gasp'; }

  /** Radius at which something hitting this body is gone. For a black hole
   *  that is the innermost stable circular orbit, three horizons out: inside
   *  it there is no circular orbit left to sit in and matter plunges. */
  get captureRadius() { return this.cls === 'bh' && !this.look.white && !this.look.wormhole ? 3 * schwarzschild(this.m) : this.r; }

  get density() { return densityOf(this.m, this.r); }

  setPos(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; }
  setVel(vx: number, vy: number, vz: number) { this.vx = vx; this.vy = vy; this.vz = vz; }
}

/**
 * A direction in the sandbox's axes, in a body's own turning frame: z along
 * its spin axis, x towards its prime meridian as it has turned by now. The
 * renderers wear the surface map in the same frame (pixel/sprites bodyFrame).
 */
export function toBodyFrame(b: Body, d: [number, number, number]): [number, number, number] {
  const t = b.tilt, n = b.node;
  const a: [number, number, number] = [Math.sin(t) * Math.sin(n), -Math.sin(t) * Math.cos(n), Math.cos(t)];
  const ref: [number, number, number] = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cr = (u: number[], v: number[]): [number, number, number] => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  let e1 = cr(ref, a);
  const l = Math.hypot(e1[0], e1[1], e1[2]);
  e1 = [e1[0] / l, e1[1] / l, e1[2] / l];
  const e2 = cr(a, e1);
  const c = Math.cos(b.spinAngle), s = Math.sin(b.spinAngle);
  const x = [c * e1[0] + s * e2[0], c * e1[1] + s * e2[1], c * e1[2] + s * e2[2]];
  const y = cr(a, x);
  return [d[0] * x[0] + d[1] * x[1] + d[2] * x[2], d[0] * y[0] + d[1] * y[1] + d[2] * y[2], d[0] * a[0] + d[1] * a[1] + d[2] * a[2]];
}
