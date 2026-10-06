// The ship as a 3D model file, outside and in, as the game builds it: node tools/export-ship.mjs
// Writes public/ship/orbital-ship.glb (glTF, for Blender and most viewers) and public/ship/orbital-ship.usdz
// (for an iPhone's or iPad's Quick Look, and AR). The game is opened in a headless browser, the ship's hull
// copied without its lamps, glow sprites and wormhole effects, and written out with three.js's exporters.
// (CHROMIUM_PATH for the browser, as for the tests.)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'fs';

const dir = 'public/ship';
const server = await createServer({ server: { port: Number(process.env.PORT || 4177), strictPort: true }, logLevel: 'error' });
await server.listen();
const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto(`http://localhost:${process.env.PORT || 4177}/`);
  await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
  await page.keyboard.press('KeyV');
  // (with its model in: the new hull and the rooms' furniture)
  await page.waitForFunction(() => window.orbital.v3?.active && window.orbital.v3.ship.hull.modelled && window.orbital.v3.frameNo > 10, null, { timeout: 60000 });
  const [glb, usdz] = await page.evaluate(async () => {
    const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
    const { USDZExporter } = await import('/node_modules/three/examples/jsm/exporters/USDZExporter.js');
    const v = window.orbital.v3, h = v.ship.hull;
    // the outside in its shining metal, and the frame loop held still while the ship is copied
    h.viewFrom(false);
    v.active = false;
    const g = h.group.clone(true);
    v.active = true;
    g.position.set(0, 0, 0); g.quaternion.identity(); g.scale.set(1, 1, 1);
    g.name = 'Orbital ship';
    const drop = [];
    g.traverse(o => { if (o.isLight || o.isSprite || !o.visible) drop.push(o); });
    for (const o of drop) o.parent?.remove(o);
    const glb = await new GLTFExporter().parseAsync(g, { binary: true, onlyVisible: true, maxTextureSize: 1024 });
    // USDZ takes standard materials only, and no points or lines: the painted and lit ones are made standard,
    // the lit ones (screens, lamps) glowing with their own colour
    const u = g.clone(true), loose = [], std = new Map();
    const Std = h.mat.xhull.constructor;
    const conv = m => {
      if (m.isMeshStandardMaterial) return m;
      if (!std.has(m)) {
        const lit = !!m.isMeshBasicMaterial;
        std.set(m, new Std({ color: m.color ? m.color.clone() : 0xffffff, map: m.map ?? null, transparent: m.transparent, opacity: m.opacity, side: m.side, roughness: 0.7, metalness: 0, emissive: lit ? m.color.clone() : 0x000000, emissiveMap: lit ? m.map ?? null : null }));
      }
      return std.get(m);
    };
    u.traverse(o => {
      if (o.isPoints || o.isLine) loose.push(o);
      else if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    });
    for (const o of loose) o.parent?.remove(o);
    const usdz = await new USDZExporter().parseAsync(u, { maxTextureSize: 1024 });
    const enc = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
    return [enc(glb), enc(usdz)];
  });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of [['orbital-ship.glb', glb], ['orbital-ship.usdz', usdz]]) {
    fs.writeFileSync(`${dir}/${name}`, Buffer.from(data, 'base64'));
    console.log(`${dir}/${name}`, fs.statSync(`${dir}/${name}`).size, 'bytes');
  }
} finally {
  await browser.close();
  await server.close();
}
