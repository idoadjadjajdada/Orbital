import { describe, it, expect } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import type { Body } from '../src/physics/body';
import { AU_M } from '../src/physics/units';
import { atmosphere, interior, composition, habitability, habitableZone, life, gravity, giantPressure, giantTemp, cloudDecks, airAt } from '../src/three/science';
import { groundSpec, groundAt, buildTile, faceDir, faceOf, TILE_N, type GroundSample } from '../src/three/terrain';
import { SITES, sitesOn, earthBiome, speciesIn } from '../src/three/sites';

const solar = buildPreset('solar');
const stars = solar.sources.filter(b => b.cls === 'star');
const body = (name: string) => solar.sources.find(b => b.name === name)!;
const D = Math.PI / 180;
const dir = (la: number, lo: number): [number, number, number] => [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
const smp: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
const spec = (b: Body) => groundSpec(b.look, b.r * AU_M, gravity(b), atmosphere(b, stars).bar);

describe('the atmosphere reader', () => {
  it('reads the Earth’s air as measured, and it adds up', () => {
    const a = atmosphere(body('Earth'), stars);
    const sum = a.gases.reduce((s, x) => s + x.x, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(a.gases[0].f).toBe('N₂');
    expect(a.gases[0].x).toBeGreaterThan(0.77);
    expect(a.gases.find(x => x.f === 'O₂')!.x).toBeGreaterThan(0.2);
    expect(a.bar).toBeCloseTo(1.013, 2);
  });
  it('knows the Moon has none to speak of, Mars a thin one, Venus a crushing one', () => {
    expect(atmosphere(body('Moon'), stars).kind).toBe('exosphere');
    const m = atmosphere(body('Mars'), stars);
    expect(m.kind).toBe('thin');
    expect(m.gases[0].f).toBe('CO₂');
    expect(atmosphere(body('Venus'), stars).bar).toBeGreaterThan(90);
    expect(atmosphere(body('Titan'), stars).bar).toBeCloseTo(1.47, 1);
  });
  it('thins with height on the Earth: about a third at 8.5 km times ln 3', () => {
    const a = atmosphere(body('Earth'), stars);
    expect(airAt(a, 9.81, 8.5 * Math.log(3)).bar).toBeCloseTo(1.013 / 3, 2);
    // the troposphere cools by about 9.8 K per km on the dry adiabat
    expect(288 - airAt(a, 9.81, 1).T).toBeGreaterThan(9);
    expect(288 - airAt(a, 9.81, 1).T).toBeLessThan(11);
  });
  it('puts Jupiter’s air where the Galileo probe found it: about 22 bar and 425 K at 150 km down', () => {
    const a = atmosphere(body('Jupiter'), stars);
    expect(a.kind).toBe('giant');
    expect(giantTemp(a, 150)).toBeGreaterThan(380);
    expect(giantTemp(a, 150)).toBeLessThan(470);
    expect(giantPressure(a, 150)).toBeGreaterThan(14);
    expect(giantPressure(a, 150)).toBeLessThan(40);
    // the decks in order: ammonia, then ammonium hydrosulphide, then water
    const d = cloudDecks(body('Jupiter'), a);
    expect(d.map(x => x.what)).toEqual(['ammonia ice', 'ammonium hydrosulphide', 'water ice and droplets: lightning']);
    expect(d[0].depth).toBeLessThan(d[1].depth);
    expect(d[1].depth).toBeLessThan(d[2].depth);
  });
});

describe('inside and underfoot', () => {
  it('layers the Earth from the inner core out', () => {
    const it = interior(body('Earth'));
    expect(it.layers[0].name).toBe('Inner core');
    expect(it.layers[it.layers.length - 1].r1).toBe(1);
    for (let k = 1; k < it.layers.length; k++) expect(it.layers[k].r0).toBe(it.layers[k - 1].r1);
  });
  it('gives the ground’s chemistry: Mars rusty, Europa icy', () => {
    expect(composition(body('Mars')).rows.find(r => r[0] === 'FeO')![1]).toBeGreaterThan(15);
    const eu = solar.bodies.find(b => b.name === 'Europa');
    if (eu) expect(composition(eu).rows[0][0]).toMatch(/H₂O/);
  });
});

describe('habitability and life', () => {
  it('puts the Sun’s habitable zone at about 0.95 to 1.67 AU, with the Earth in it and Venus not', () => {
    const [i, o] = habitableZone(1, 5780);
    expect(i).toBeCloseTo(0.95, 1);
    expect(o).toBeCloseTo(1.67, 1);
    expect(habitability(body('Earth'), stars).inZone).toBe(true);
    expect(habitability(body('Venus'), stars).inZone).toBe(false);
  });
  it('confirms life on the Earth only; elsewhere, only candidates', () => {
    expect(life(body('Earth'), stars).tier).toBe('earth');
    expect(life(body('Mars'), stars).tier).toBe('candidate');
    expect(life(body('Moon'), stars).tier).toBe('none');
    expect(life(body('Jupiter'), stars).tier).toBe('none');
  });
  it('keeps a made-up world’s life the same every time', () => {
    const e = body('Earth');
    const fake = { ...e, look: { ...e.look, real: undefined, seed: 4242 }, star: undefined } as unknown as Body;
    expect(JSON.stringify(life(fake, stars))).toBe(JSON.stringify(life(fake, stars)));
  });
});

describe('the ground', () => {
  it('stands Olympus Mons far above Hellas, and Jezero below the datum', () => {
    const s = spec(body('Mars'));
    const oly = groundAt(s, dir(18.65, -133.8), 30000, smp), hel = groundAt(s, dir(-42.4, 70.5), 30000, smp), jez = groundAt(s, dir(18.44, 77.45), 30000, smp);
    expect(oly - hel).toBeGreaterThan(25000);
    expect(oly).toBeGreaterThan(15000);
    expect(jez).toBeLessThan(0);
  });
  it('puts the Moon’s maria below its highlands', () => {
    const s = spec(body('Moon'));
    expect(groundAt(s, dir(0.674, 23.47), 30000, smp)).toBeLessThan(groundAt(s, dir(-8.97, 15.5), 30000, smp));
  });
  it('keeps the Earth’s seas flat at sea level', () => {
    const s = spec(body('Earth'));
    expect(groundAt(s, dir(0, -30), 1, smp)).toBe(0);
    expect(smp.sea).toBe(true);
    expect(groundAt(s, dir(30, 90), 1, smp)).toBeGreaterThan(0);
  });
  it('is the same ground every time it is asked, worker or main thread', () => {
    const s = spec(body('Moon'));
    expect(groundAt(s, dir(10, 20), 1, smp)).toBe(groundAt(s, dir(10, 20), 1, smp));
  });
  it('builds fixed tiles that meet at their edges and are the same every time', () => {
    const s = spec(body('Moon'));
    const N = TILE_N;
    const t = buildTile({ key: 'a', spec: s, f: 0, L: 12, x: 2000, y: 2100 });
    expect(t.pos.every(x => isFinite(x))).toBe(true);
    expect(t.nrm.every(x => isFinite(x))).toBe(true);
    expect(t.spacing).toBeLessThan(25);
    const again = buildTile({ key: 'a', spec: s, f: 0, L: 12, x: 2000, y: 2100 });
    expect(Array.from(again.pos)).toEqual(Array.from(t.pos));
    // the tile to its right shares its right edge
    const u = buildTile({ key: 'b', spec: s, f: 0, L: 12, x: 2001, y: 2100 });
    const R = s.R;
    for (let j = 0; j <= N; j += 8) {
      const a = j * (N + 1) + N, b = j * (N + 1);
      const pa = [t.pos[a * 3] + t.c[0] * R, t.pos[a * 3 + 1] + t.c[1] * R, t.pos[a * 3 + 2] + t.c[2] * R];
      const pb = [u.pos[b * 3] + u.c[0] * R, u.pos[b * 3 + 1] + u.c[1] * R, u.pos[b * 3 + 2] + u.c[2] * R];
      expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])).toBeLessThan(0.05);
    }
    // the same boulders whichever tile draws them: a tile's, and its four children's together
    const R0 = s.R, key = (t: ReturnType<typeof buildTile>) => { const out: string[] = []; for (let k = 0; k < t.rocks.length; k += 8) out.push(String(t.rocks[k + 7])); return out; };
    const near = (t: ReturnType<typeof buildTile>) => { const out: number[][] = []; for (let k = 0; k < t.rocks.length; k += 8) out.push([t.rocks[k] + t.c[0] * R0, t.rocks[k + 1] + t.c[1] * R0, t.rocks[k + 2] + t.c[2] * R0]); return out; };
    const par = buildTile({ key: 'p', spec: s, f: 0, L: 16, x: 32000, y: 33600 });
    const kids = [0, 1, 2, 3].map(q => buildTile({ key: 'c', spec: s, f: 0, L: 17, x: 64000 + (q & 1), y: 67200 + (q >> 1) }));
    expect(key(par).length).toBeGreaterThan(0);
    expect(kids.flatMap(key).sort()).toEqual(key(par).sort());
    const pp = near(par), kp = kids.flatMap(near);
    for (const p of pp) expect(Math.min(...kp.map(q => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])))).toBeLessThan(1.5);

    const [f, a, b] = faceOf(faceDir(3, 0.3, -0.7));
    expect(f).toBe(3); expect(a).toBeCloseTo(0.3, 9); expect(b).toBeCloseTo(-0.7, 9);
  });
});

describe('the sites', () => {
  it('has every Apollo landing, and the cities are on the Earth', () => {
    expect(sitesOn('Moon').filter(s => s.kind === 'apollo').length).toBe(6);
    expect(SITES.filter(s => s.kind === 'city').every(s => s.body === 'Earth')).toBe(true);
  });
  it('finds a biome’s life', () => {
    expect(earthBiome(-80, [0.9, 0.92, 0.95], false, 2000, false)).toBe('ice');
    expect(earthBiome(5, [0.2, 0.4, 0.15], false, 200, false)).toBe('tropical');
    expect(speciesIn('desert').some(s => s.name === 'Dromedary')).toBe(true);
  });
});

describe('the suit', () => {
  it('reads what is outside: fit to breathe on the Earth, crushing and hot on Venus, thin and toxic on Mars, deadly radiation on Io', async () => {
    const { environment } = await import('../src/three/suit');
    const env = (n: string) => environment(body(n), atmosphere(body(n), stars));
    expect(env('Earth').breathable).toBe(true);
    const venus = env('Venus');
    expect(venus.bar).toBeGreaterThan(80);
    expect(venus.hazards.join(' ')).toMatch(/bar/);
    expect(venus.T).toBeGreaterThan(400);
    expect(venus.hazards.join(' ')).toMatch(/SO₂|CO₂/);
    expect(env('Mars').hazards.join(' ')).toMatch(/too thin|vacuum/);
    expect(env('Moon').hazards).toContain('vacuum');
    expect(env('Io').hazards).toContain('lethal radiation');
  });
});
