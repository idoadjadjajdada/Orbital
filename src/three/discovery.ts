import type { Body } from '../physics/body';
import { AU_M } from '../physics/units';
import { maps } from '../pixel/maps';
import { hash } from '../pixel/noise';
import { atmosphereOf, compositionOf, airAt, type Atmosphere } from './science';
import { biosphereOf, speciesAt, biomeOf, type Biosphere, type Species, type LifeFacts } from './life';
import { latLon, dirOf, type V3 } from './terrain';
import { gravity } from './landing';
import { SITES, type Site } from './sites';

/**
 * What the instruments find. A world's air, interior and life are worked out
 * once and kept; scans on the ground — on foot, by a rover or a lander — read
 * the soil and the air where they are and turn up the species living there,
 * which go into the discoveries.
 */

export interface Finding { b: Body; text: string; species?: Species }

export class Science {
  private air = new Map<Body, Atmosphere>();
  private bio = new Map<Body, Biosphere>();
  /** species found, per world (by its name, so a log survives the world being rebuilt) */
  readonly found = new Map<string, Map<string, Species>>();
  /** what is known about a world: from afar (spectra), in orbit (mapped), in its air (sampled), on its ground (landed) */
  readonly known = new Map<string, Set<'spectra' | 'mapped' | 'sampled' | 'landed'>>();
  /** the most recent findings, newest first */
  readonly log: { t: number; text: string }[] = [];

  constructor(private stars: () => Body[], private now: () => number) {}

  atmosphere(b: Body): Atmosphere {
    let a = this.air.get(b);
    if (!a) { a = atmosphereOf(b, this.stars()); this.air.set(b, a); }
    return a;
  }

  composition(b: Body) { return compositionOf(b); }

  facts(b: Body): LifeFacts {
    const a = this.atmosphere(b);
    const star = this.stars().filter(s => s !== b).sort((p, q) => ((q.star?.L ?? 0) / ((q.x - b.x) ** 2 + (q.y - b.y) ** 2 + (q.z - b.z) ** 2)) - ((p.star?.L ?? 0) / ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 + (p.z - b.z) ** 2)))[0];
    return {
      surfaceK: a.surfaceK, surfaceBar: a.kind === 'envelope' ? 0 : a.surfaceBar,
      gases: a.gases.map(g => ({ formula: g.formula, frac: g.frac })), g: gravity(b) / 9.81, starTeff: star?.star?.teff ?? 5772,
    };
  }

  biosphere(b: Body): Biosphere {
    let s = this.bio.get(b);
    if (!s) { s = biosphereOf(b, this.facts(b)); this.bio.set(b, s); }
    return s;
  }

  /** what has been learnt about a world, and say so */
  learn(b: Body, what: 'spectra' | 'mapped' | 'sampled' | 'landed') {
    let k = this.known.get(b.name);
    if (!k) { k = new Set(); this.known.set(b.name, k); }
    k.add(what);
  }
  knows(b: Body, what: 'spectra' | 'mapped' | 'sampled' | 'landed') { return !!this.known.get(b.name)?.has(what); }

  note(text: string) {
    this.log.unshift({ t: this.now(), text });
    if (this.log.length > 80) this.log.pop();
  }

  /** the biome at a spot on a world, from what its map shows there and how high it is */
  biome(b: Body, n: V3, hM: number): string {
    const m = maps.want(b.look, 256);
    const [lat, lon] = latLon(n);
    const u = ((lon / 360) % 1 + 1) % 1, v = Math.max(0, Math.min(0.999, lat / 180 + 0.5));
    const k = Math.floor(v * m.h) * m.w + Math.floor(u * m.w);
    return biomeOf([m.rgb[k * 3], m.rgb[k * 3 + 1], m.rgb[k * 3 + 2]], m.spec[k] > 0, lat, hM, this.atmosphere(b).surfaceK);
  }

  /**
   * A scan at a spot (`n`, body frame, `hM` metres up): the ground, the air,
   * and whatever lives within reach. `who` names the instrument. `seed`
   * varies what turns up between scans at the same place.
   */
  scan(b: Body, n: V3, hM: number, who: string, seed: number): Finding[] {
    const out: Finding[] = [];
    const a = this.atmosphere(b), c = compositionOf(b);
    const [lat, lon] = latLon(n);
    const where = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
    this.learn(b, 'landed');
    // the ground: the surface's makeup, a little different from spot to spot
    // what the ground is here: the seas and ice caps of the world as a whole are not under your feet on dry land
    const biomeHere = this.biome(b, n, hM);
    const wet = biomeHere === 'ocean', icy = biomeHere === 'ice';
    const here = c.surface.filter(s => (wet || !/ocean|seawater|sea water|lake/i.test(s.name)) && (icy || wet || !/glacial|ice sheet|ice cap/i.test(s.name)));
    const tot = here.reduce((k, s) => k + s.frac, 0) || 1;
    // a little different from spot to spot, still adding up to the whole
    const jit = here.slice(0, 4).map((s, i) => s.frac * (1 + (hash(Math.floor(lat * 100), Math.floor(lon * 100), i + seed) - 0.5) * 0.3));
    const jt = jit.reduce((k, x) => k + x, 0) || 1;
    const ground = here.slice(0, 4).map((s, i) => `${s.name} ${(jit[i] / jt * 100).toFixed(jit[i] / jt < 0.05 ? 1 : 0)}%`);
    void tot;
    if (ground.length) out.push({ b, text: `${who} · soil at ${where}: ${ground.join(', ')}` });
    // the air here
    if (a.exists && a.kind !== 'envelope') {
      const s = airAt(a, b, hM);
      out.push({ b, text: `${who} · air: ${s.bar < 0.01 ? `${(s.bar * 1e5).toFixed(0)} Pa` : `${s.bar.toFixed(s.bar < 10 ? 3 : 1)} bar`}, ${Math.round(s.K)} K, ${a.gases.slice(0, 3).map(g => `${g.formula} ${(g.frac * 100).toFixed(g.frac < 0.01 ? 2 : 1)}%`).join(', ')}` });
    } else out.push({ b, text: `${who} · no air to speak of: ${a.kind === 'exosphere' ? 'a thin exosphere of ' + a.trace.slice(0, 3).map(g => g.formula).join(', ') : 'vacuum'}` });
    // life
    const bio = this.biosphere(b);
    const biome = biomeHere;
    if (bio.level === 'none' || bio.level === 'prebiotic') {
      out.push({ b, text: `${who} · life scan (${biome}): nothing living. ${bio.level === 'prebiotic' ? bio.biosignatures[0] ?? '' : ''}`.trim() });
    } else {
      // a few draws at this spot
      let got = 0;
      for (let k = 0; k < 4; k++) {
        const roll = hash(Math.floor(lat * 3000) + k * 7, Math.floor(lon * 3000), seed + k * 131);
        const sp = speciesAt(bio, biome, roll);
        if (!sp) continue;
        const map = this.found.get(b.name) ?? new Map<string, Species>();
        this.found.set(b.name, map);
        if (map.has(sp.id)) continue;
        map.set(sp.id, sp);
        got++;
        out.push({ b, text: `New species on ${b.name}: ${sp.name} (${sp.common}), ${sp.kind} · ${sp.size} · ${sp.habitat}`, species: sp });
      }
      if (!got) out.push({ b, text: `${who} · life scan (${biome}): nothing new here. ${this.found.get(b.name)?.size ?? 0} of ${bio.species.length} species found on ${b.name}` });
    }
    // anything famous nearby
    const site = this.nearSite(b, n, 3000);
    if (site) out.push({ b, text: `${site.name}: ${site.desc}` });
    for (const f of out) this.note(f.text);
    return out;
  }

  /** the real site nearest a spot, within `rangeM` */
  nearSite(b: Body, n: V3, rangeM: number): Site | null {
    const real = b.look.real;
    if (!real) return null;
    const R = b.r * AU_M;
    let best: Site | null = null, bd = rangeM;
    for (const s of SITES) {
      if (s.body !== real || s.model === 'city' || s.kind === 'feature') continue;
      const d = dirOf(s.lat, s.lon);
      const dist = Math.acos(Math.min(1, d[0] * n[0] + d[1] * n[1] + d[2] * n[2])) * R;
      if (dist < bd) { bd = dist; best = s; }
    }
    return best;
  }
}
