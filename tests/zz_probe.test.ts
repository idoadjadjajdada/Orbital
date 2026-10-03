import { test } from 'vitest';
import { groundSpec, groundAt } from '../src/three/terrain';
test('probe', () => {
  const look = { style: 'barren', seed: 3, c1: 0x888888, c2: 0x444444, real: 'Moon' } as any;
  const s = groundSpec(look, 1737e3, 1.62, 0);
  const o = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
  const at = (la: number, lo: number, f = 50) => { const D = Math.PI / 180; return groundAt(s, [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)], f, o); };
  console.log('scale', s.scale, 'datum', s.datum, 'relief', s.relief);
  for (const [n, la, lo] of [['A11', 0.674, 23.47], ['A15', 26.1, 3.6], ['A16', -8.97, 15.5], ['farside highland', 10, 180], ['SPA', -53, -169]] as const) console.log(n, at(la, lo).toFixed(0), at(la, lo, 30000).toFixed(0));
  for (const [real, R, g, st, pts] of [['Mars', 3390e3, 3.71, 'desert', [['Olympus', 18.65, -133.8], ['Hellas', -42.4, 70.5], ['Gale', -4.59, 137.44], ['Jezero', 18.44, 77.45], ['Valles', -8, -70]]], ['Venus', 6052e3, 8.87, 'rocky', [['Maxwell', 65.2, 3.3], ['Venera13', -7.5, -57], ['plains', 30, 150]]], ['Earth', 6371e3, 9.81, 'terran', [['Everest', 27.99, 86.93], ['Denver', 39.7, -105], ['London', 51.5, -0.1], ['Tibet', 33, 88]]], ['Titan', 2575e3, 1.35, 'ice', [['Huygens', -10.25, -167.7], ['Xanadu', -10, 100], ['Kraken', 68, -50]]]] as const) {
    const s2 = groundSpec({ style: st, seed: 3, c1: 0x888888, c2: 0x444444, real } as any, R, g, 0);
    console.log(real, 'scale', s2.scale.toFixed(0));
    for (const [n, la, lo] of pts) { const D = Math.PI / 180; console.log(' ', n, groundAt(s2, [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)], 30000, o).toFixed(0), o.sea); }
  }
});
