// Pictures of the 3D view, to look at by eye: node tests/shot.mjs <body> <radii away> <out.png> [az°] [el°] [preset]
// Puts the ship that far from the body, on its sunlit side turned by az/el, facing it.
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [name = 'Mars', radii = '3', out = 'shot.png', az = '0', el = '0', preset = 'solar', wait = '6000'] = process.argv.slice(2);
const server = await createServer({ server: { port: 4175, strictPort: true }, logLevel: 'error' });
await server.listen();
const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://localhost:4175/');
  await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
  await page.evaluate(([p, n]) => { const a = window.orbital; a.loadPreset(p); a.select(a.world.sources.find(b => b.name === n)); }, [preset, name]);
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
  const place = ([n, k, az, el]) => {
    const a = window.orbital, v = a.v3, b = a.world.sources.find(x => x.name === n);
    const sun = a.world.sources.find(x => x.cls === 'star');
    let d = [sun.x - b.x, sun.y - b.y, sun.z - b.z];
    if (b === sun) d = [1, 0, 0];
    if (typeof az === 'string') {
      // '@lat,lon': over that point of the body's own frame
      const [la, lo] = az.slice(1).replace('n', '').split(',').map(x => +x * Math.PI / 180);
      const V = v.camera.position.constructor;
      const at = () => new V(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)).applyQuaternion(window.__bodyQuat(b));
      // turn the body so the point is in daylight (unless asked for night with a trailing 'n')
      if (b !== sun && !String(az).endsWith('n')) {
        let best = 0, bd = -2;
        for (let k = 0; k < 360; k++) { b.spinAngle = k * Math.PI / 180; const w = at(); const dd = w.x * d[0] + w.y * d[1] + w.z * d[2]; if (dd > bd) { bd = dd; best = b.spinAngle; } }
        b.spinAngle = best;
      }
      const w = at();
      d = [w.x, w.y, w.z]; az = 0; el = 0;
    }
    const L = Math.hypot(...d); d = d.map(x => x / L);
    const ca = Math.cos(az * Math.PI / 180), sa = Math.sin(az * Math.PI / 180);
    d = [d[0] * ca - d[1] * sa, d[0] * sa + d[1] * ca, d[2]];
    const ce = Math.cos(el * Math.PI / 180), se = Math.sin(el * Math.PI / 180);
    d = [d[0] * ce, d[1] * ce, se + d[2] * ce];
    const M = Math.hypot(...d); d = d.map(x => x / M);
    v.travel = null;
    v.ship.nav.anchor = b; v.ship.nav.off = d.map(x => x * b.r * k); v.ship.nav.vel = [0, 0, 0];
    const V = v.camera.position.constructor;
    v.ship.quat.setFromUnitVectors(new V(0, 0, -1), new V(-d[0], -d[1], -d[2]));
    v.ship.view = 'chase';
  };
  await page.evaluate(place, [name, +radii, az.startsWith('@') ? az : +az, +el]);
  await page.waitForTimeout(+wait);
  await page.evaluate(place, [name, +radii, az.startsWith('@') ? az : +az, +el]);
  // EVAL: code to run in the page first (v is the 3D view, a the app, b the body)
  if (process.env.EVAL) console.log('eval:', await page.evaluate(([code, n]) => { const a = window.orbital; return String(new Function('v', 'a', 'b', code)(a.v3, a, a.world.sources.find(x => x.name === n))); }, [process.env.EVAL, name]));
  // full resolution, whatever the software renderer's frame time
  await page.evaluate(() => { const v = window.orbital.v3; v.res.scale = 1; v.res.t = -1e9; v.renderer.setPixelRatio(1); v.resize(); });
  await page.waitForTimeout(2500);
  if (process.env.PROBE) console.log('probe:', await page.evaluate(([code, n]) => { const a = window.orbital; return String(new Function('v', 'a', 'b', code)(a.v3, a, a.world.sources.find(x => x.name === n))); }, [process.env.PROBE, name]));
  console.log(await page.evaluate(n => { const a = window.orbital, v = a.v3; const b = a.world.sources.find(x => x.name === n); const o = v.objs.get(b); return JSON.stringify({ map: o?.base?.w, style: o?.style, pr: v.renderer.getPixelRatio() }); }, name));
  await page.evaluate(() => document.querySelectorAll('.hud, #inspector, .hint, .chips, #hud3, .bar3').forEach(e => { e.style.visibility = 'hidden'; }));
  await page.screenshot({ path: out });
  console.log('saved', out);
  // SHOT2=ms: a second picture that much later, to see what moves
  if (process.env.SHOT2) { await page.waitForTimeout(+process.env.SHOT2); await page.screenshot({ path: out.replace(/\.png$/, '-b.png') }); }
} finally {
  await browser.close();
  await server.close();
}
