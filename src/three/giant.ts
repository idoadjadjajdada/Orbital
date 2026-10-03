import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M } from '../physics/units';
import { frameOf, toWorld, type SkyState } from './ground';
import { tangent, dirOf, type V3 } from './terrain';
import type { Atmosphere } from './science';
import { airAt } from './science';

/**
 * Inside a giant planet: below the cloud tops there is no ground, only deck
 * after deck of cloud — ammonia ice, then ammonium hydrosulphide, then water,
 * where the lightning is — getting darker, hotter and denser all the way
 * down. Cloud banks stream past on the winds; near Jupiter's Great Red Spot
 * the winds turn, the clouds redden and the lightning comes thick.
 */

/** where the big storms are: body, latitude, longitude (as painted), radius (degrees) */
const STORMS: [string, number, number, number][] = [['Jupiter', -22, 60, 9], ['Neptune', -20, 120, 10]];

/** the colours of the decks, top to bottom, for each kind of giant */
const DECKS: Record<string, V3[]> = {
  gas: [[0.86, 0.78, 0.62], [0.62, 0.42, 0.26], [0.38, 0.42, 0.5], [0.22, 0.12, 0.08]],
  saturn: [[0.88, 0.8, 0.58], [0.7, 0.58, 0.36], [0.4, 0.42, 0.46], [0.2, 0.14, 0.1]],
  icegiant: [[0.6, 0.85, 0.88], [0.32, 0.55, 0.75], [0.16, 0.26, 0.5], [0.06, 0.08, 0.2]],
  hotjupiter: [[0.45, 0.3, 0.25], [0.35, 0.18, 0.1], [0.3, 0.1, 0.05], [0.4, 0.08, 0.02]],
  browndwarf: [[0.5, 0.22, 0.3], [0.45, 0.14, 0.12], [0.5, 0.12, 0.04], [0.6, 0.15, 0.02]],
};

function puff(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  // a soft heap of overlapping blobs
  for (let k = 0; k < 22; k++) {
    const x = 64 + (Math.sin(k * 2.39) * 30) * (k / 22), y = 64 + (Math.cos(k * 2.39) * 22) * (k / 22), r = 34 - k * 0.8;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const N = 150;

export class Weather {
  readonly group = new THREE.Group();
  private sprites: THREE.Sprite[] = [];
  /** each bank's place (body frame, m from the centre), size */
  private at: V3[] = [];
  private body: Body | null = null;
  flash = 0;
  private storm = 0;

  constructor(scene: THREE.Scene) {
    const tex = puff();
    for (let k = 0; k < N; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      s.frustumCulled = false;
      this.sprites.push(s);
      this.group.add(s);
      this.at.push([0, 0, 0]);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  /** the palette of a giant */
  private decks(b: Body) {
    const st = b.look.real === 'Saturn' ? 'saturn' : b.look.style === 'icegiant' ? 'icegiant' : b.look.style === 'hotjupiter' ? 'hotjupiter' : b.look.style === 'browndwarf' ? 'browndwarf' : 'gas';
    return DECKS[st];
  }

  /** the colour of the cloud `depth` km below the 1-bar level */
  colour(b: Body, depth: number): V3 {
    const d = this.decks(b), t = Math.max(0, Math.min(2.999, depth / 45));
    const i = Math.floor(t), f = t - i, a = d[i], c = d[i + 1];
    const red = this.storm * 0.5;
    return [(a[0] + (c[0] - a[0]) * f) * (1 + red * 0.4), (a[1] + (c[1] - a[1]) * f) * (1 - red * 0.35), (a[2] + (c[2] - a[2]) * f) * (1 - red * 0.5)];
  }

  /** how near a big storm a direction is, 0–1 */
  stormAt(b: Body, n: V3) {
    let s = 0;
    for (const [name, la, lo, r] of STORMS) {
      if (b.look.real !== name) continue;
      const d = dirOf(la, lo);
      const ang = Math.acos(Math.min(1, d[0] * n[0] + d[1] * n[1] + d[2] * n[2])) * 180 / Math.PI;
      s = Math.max(s, Math.max(0, 1 - ang / (r * 1.6)));
    }
    return s;
  }

  /**
   * The sky inside (or over) a giant for a viewer `alt` metres above its
   * 1-bar level at direction `n` (body frame); `sunUp` how high its star is.
   */
  sky(b: Body, a: Atmosphere, alt: number, n: V3, sunUp: number, dt: number): SkyState {
    this.storm = this.stormAt(b, n);
    const depth = -alt / 1000;
    const inside = Math.max(0, Math.min(1, (8 - alt / 1000) / 18));
    const s = airAt(a, b, alt);
    // sunlight fading down through the decks, and the heat of the deep glowing red
    const sun = Math.max(0.04, sunUp) * Math.exp(-Math.max(0, depth) / 70);
    const heat = Math.max(0, Math.min(1, (s.K - 700) / 900));
    // lightning, in the water clouds, thick in a storm
    const inWater = depth > 35 && depth < 140 ? 1 : depth > 15 ? 0.25 : 0;
    if (Math.random() < dt * inWater * (0.25 + 2.5 * this.storm)) this.flash = 0.6 + Math.random() * 0.6;
    this.flash = Math.max(0, this.flash - dt * 5);
    const top = this.colour(b, Math.max(0, depth - 20)), low = this.colour(b, depth + 25);
    const air = { ...a };
    return {
      strength: Math.pow(Math.max(0, Math.min(1, (Math.log10(Math.max(1e-12, s.bar)) + 4.5) / 4.5)), 0.7),
      zenith: air.sky, horizon: air.horizon, sunset: air.sunset, haze: Math.min(1, 0.4 + depth / 60),
      inside, deepTop: [top[0] + heat * 0.5, top[1] + heat * 0.12, top[2]], deepLow: [low[0] + heat * 0.9, low[1] + heat * 0.25, low[2]],
      glow: sun * 0.9 + heat * 0.6 + 0.02, flash: this.flash,
    };
  }

  /**
   * Cloud banks round a viewer at `n`, `alt` m up, drifting on the winds;
   * `centre` is the giant's centre from the camera (m).
   */
  update(b: Body | null, n: V3, alt: number, centre: THREE.Vector3, sky: SkyState, dt: number) {
    const on = !!b && sky.inside > 0.15;
    this.group.visible = on;
    if (!b || !on) { this.body = null; return; }
    const R = b.r * AU_M, f = frameOf(b);
    const me: V3 = [n[0] * (R + alt), n[1] * (R + alt), n[2] * (R + alt)];
    const [e, nn] = tangent(n);
    const span = 30000, vis = Math.max(2500, 14000 - Math.max(0, -alt) * 0.08);
    const fresh = this.body !== b;
    this.body = b;
    // the winds: east or west by latitude band, wheeling round a storm
    const lat = Math.asin(n[2]);
    const zonal = 120 * Math.cos(lat * 6) * (b.look.style === 'icegiant' ? 3 : 1);
    for (let k = 0; k < N; k++) {
      const p = this.at[k];
      let dx = p[0] - me[0], dy = p[1] - me[1], dz = p[2] - me[2];
      if (fresh || Math.hypot(dx, dy, dz) > span) {
        // a new bank, somewhere round about (ahead of the wind, mostly)
        const a = Math.random() * Math.PI * 2, r = (fresh ? Math.random() : 0.85 + Math.random() * 0.15) * span, h = (Math.random() - 0.5) * 9000;
        dx = (e[0] * Math.cos(a) + nn[0] * Math.sin(a)) * r + n[0] * h;
        dy = (e[1] * Math.cos(a) + nn[1] * Math.sin(a)) * r + n[1] * h;
        dz = (e[2] * Math.cos(a) + nn[2] * Math.sin(a)) * r + n[2] * h;
        p[0] = me[0] + dx; p[1] = me[1] + dy; p[2] = me[2] + dz;
        this.sprites[k].scale.setScalar(2500 + Math.random() * 6000);
      }
      // drift: along the band, and round the storm's eye
      const swirl = this.storm * 260;
      p[0] += (e[0] * zonal + nn[0] * swirl) * dt;
      p[1] += (e[1] * zonal + nn[1] * swirl) * dt;
      p[2] += (e[2] * zonal + nn[2] * swirl) * dt;
      const w = toWorld(f, p);
      const s = this.sprites[k];
      s.position.set(centre.x + w[0], centre.y + w[1], centre.z + w[2]);
      const d = Math.hypot(dx, dy, dz);
      const up = dx * n[0] + dy * n[1] + dz * n[2];
      const c = this.colour(b, (-alt - up) / 1000);
      const lit = sky.glow + sky.flash * 0.8;
      s.material.color.setRGB(Math.min(1, c[0] * lit * 1.25), Math.min(1, c[1] * lit * 1.25), Math.min(1, c[2] * lit * 1.25));
      // thin when you are inside one, fading into the murk with distance
      const size = s.scale.x;
      s.material.opacity = 0.85 * Math.exp(-d / vis) * sky.inside * Math.min(1, Math.max(0, (d - size * 0.15) / (size * 0.5)));
    }
  }
}
