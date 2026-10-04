// A picture from the ground, to look at by eye: node tests/surface-shot.mjs <body> <lat> <lon> <out.png> [yaw°] [preset] [day|night]
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [name = 'Earth', lat = '28.57', lon = '-80.65', out = 'surface.png', yaw = '0', preset = 'earth', when = 'day'] = process.argv.slice(2);
const server = await createServer({ server: { port: 4176, strictPort: true }, logLevel: 'error' });
await server.listen();
const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://localhost:4176/');
  await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
  await page.evaluate(([p, n]) => { const a = window.orbital; a.loadPreset(p); a.select(a.world.sources.find(b => b.name === n)); }, [preset, name]);
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
  const put = ([n, la, lo, when]) => {
    const a = window.orbital, v = a.v3, b = a.world.sources.find(x => x.name === n);
    const sun = a.world.sources.find(x => x.cls === 'star');
    const V = v.camera.position.constructor;
    const L = la * Math.PI / 180, O = lo * Math.PI / 180;
    const at = () => new V(Math.cos(L) * Math.cos(O), Math.cos(L) * Math.sin(O), Math.sin(L)).applyQuaternion(window.__bodyQuat(b));
    const s = new V(sun.x - b.x, sun.y - b.y, sun.z - b.z).normalize();
    // the hour: the sun some way up (day) or well down (night)
    const want = when === 'night' ? -0.6 : 0.45;
    let best = 0, bd = 9;
    for (let k = 0; k < 720; k++) { b.spinAngle = k * Math.PI / 360; const d = Math.abs(at().dot(s) - want); if (d < bd) { bd = d; best = b.spinAngle; } }
    b.spinAngle = best;
    const w = at(), r = b.r + 2500 / 1.495978707e11;
    v.travel = null;
    v.ship.nav.anchor = b; v.ship.nav.off = [w.x * r, w.y * r, w.z * r]; v.ship.nav.vel = [0, 0, 0];
    return [Math.cos(L) * Math.cos(O), Math.cos(L) * Math.sin(O), Math.sin(L)];
  };
  const n = await page.evaluate(put, [name, +lat, +lon, when]);
  await page.waitForFunction(() => window.orbital.v3.ground.ready, null, { timeout: 90000 });
  await page.evaluate(([n, y]) => { const v = window.orbital.v3; v.toSurface(n, y * Math.PI / 180); v.res.scale = 1; v.res.t = -1e9; v.renderer.setPixelRatio(1); v.resize(); }, [n, +yaw]);
  // until the ground under you is built down to its finest (slow in a software renderer)
  await page.waitForFunction(() => window.orbital.v3.ground.tiles.under < 3, null, { timeout: 120000 }).catch(() => console.log('ground still coarse underfoot'));
  await page.waitForTimeout(5000);
  await page.evaluate(() => { const v = window.orbital.v3; v.surf.pitch = 0.05; });
  // EVAL: code to run in the page once on the ground (v is the 3D view, a the app)
  if (process.env.EVAL) console.log('eval:', await page.evaluate(async code => { const a = window.orbital; return String(await new Function('v', 'a', code)(a.v3, a)); }, process.env.EVAL));
  await page.waitForTimeout(3000);
  console.log(await page.evaluate(() => { const v = window.orbital.v3; return JSON.stringify({ mode: v.mode, fogK: v.ground.fogK, where: v.readout().where }); }));
  await page.screenshot({ path: out });
  console.log('saved', out);
} finally {
  await browser.close();
  await server.close();
}
