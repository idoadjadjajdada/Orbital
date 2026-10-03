// Pictures of a catalog object, on the map and in 3D: node tests/special-shot.mjs <key> <outPrefix> [map AU radius] [3D distance, in units of the extent] [elevation°]
// The extent is the object's disc or shell if it has one (from its particles), otherwise its radius.
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [key = 'ton618', out = 'special', mapR = '0', dist = '1.6', el = '25', wait = '5000'] = process.argv.slice(2);
const server = await createServer({ server: { port: 4177, strictPort: true }, logLevel: 'error' });
await server.listen();
const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  page.on('console', m => { if (m.text().startsWith('probe')) console.log(m.text()); });
  await page.goto('http://localhost:4177/');
  if (process.env.PR) await page.evaluate(pr => { window.__PR = pr; }, process.env.PR);
  await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
  const info = await page.evaluate(([k, mapR]) => {
    const a = window.orbital;
    a.clear(); a.armed = k; const b = a.place({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }); a.armed = null; a.paused = false;
    a.select(b); a.focus = b;
    // the extent: the furthest of what came with it (disc, shell, companion), or its radius
    let ext = b.r;
    for (const x of a.world.bodies) if (x !== b) ext = Math.max(ext, Math.hypot(x.x - b.x, x.y - b.y, x.z - b.z));
    a.fitRadius(+mapR || ext * 1.2); a.view.scale = a.view.scaleGoal;
    return { name: b.name, r: b.r, ext, n: a.world.bodies.length };
  }, [key, mapR]);
  console.log(JSON.stringify(info));
  await page.waitForTimeout(2500);
  if (process.env.HIDEUI !== '0') await page.evaluate(() => document.querySelectorAll('.hud, #inspector, .toasts').forEach(e => { e.style.visibility = 'hidden'; }));
  await page.screenshot({ path: `${out}-map.png` });
  await page.evaluate(() => document.querySelectorAll('.hud, #inspector, .toasts').forEach(e => { e.style.visibility = ''; }));
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
  const place = ([k, d, el, ext]) => {
    const a = window.orbital, v = a.v3, b = a.selected;
    const e = el * Math.PI / 180;
    // looking at it from `el` above its disc (the disc's axis is its spin, or z)
    let ax = [b.lx ?? 0, b.ly ?? 0, b.lz ?? 0];
    if (Math.hypot(...ax) < 1e-12) ax = [0, 0, 1];
    const L = Math.hypot(...ax);
    const z = ax.map(x => x / L);
    const ref = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let x = [ref[1] * z[2] - ref[2] * z[1], ref[2] * z[0] - ref[0] * z[2], ref[0] * z[1] - ref[1] * z[0]];
    const xl = Math.hypot(...x); x = x.map(q => q / xl);
    const dir = [0, 1, 2].map(i => x[i] * Math.cos(e) + z[i] * Math.sin(e));
    v.travel = null;
    v.ship.nav.anchor = b; v.ship.nav.off = dir.map(q => q * ext * d); v.ship.nav.vel = [0, 0, 0];
    const V = v.camera.position.constructor;
    v.ship.quat.setFromUnitVectors(new V(0, 0, -1), new V(-dir[0], -dir[1], -dir[2]));
    v.ship.view = 'chase';
  };
  await page.evaluate(place, [key, +dist, +el, info.ext]);
  await page.waitForTimeout(+wait);
  await page.evaluate(place, [key, +dist, +el, info.ext]);
  // EVAL: code run in the page every frame from here on (v is the 3D view, a the app, b the object)
  if (process.env.EVAL) await page.evaluate(code => { const a = window.orbital, f = new Function('v', 'a', 'b', code); const tick = () => { f(a.v3, a, a.selected); requestAnimationFrame(tick); }; tick(); }, process.env.EVAL);
  await page.evaluate(() => { const v = window.orbital.v3; v.res.scale = 1; v.res.t = -1e9; v.renderer.setPixelRatio(+(window.__PR ?? 1)); v.resize(); v.ship.hull.group.scale.setScalar(1e-9); });
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelectorAll('.hud, #inspector, .toasts, #ui3, #labels3, .panel3').forEach(e => { e.style.visibility = 'hidden'; }));
  await page.screenshot({ path: `${out}-3d.png` });
  if (process.env.SHOT2) { await page.waitForTimeout(+process.env.SHOT2); await page.screenshot({ path: `${out}-3d-b.png` }); }
  console.log('saved', out);
} finally {
  await browser.close();
  await server.close();
}
