// A picture from the helm, hovering over a place: node tests/hover-shot.mjs <body> <lat> <lon> <alt m> <out.png> [preset] [day|night]
// (EVAL runs code in the page first, with v the 3D view and a the app, and prints what it returns)
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [name = 'Earth', lat = '48', lon = '8', alt = '300', out = 'hover.png', preset = 'earth', when = 'day'] = process.argv.slice(2);
const PORT = Number(process.env.PORT || 4178);
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 1500)); });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
  await page.evaluate(([p, n]) => { const a = window.orbital; a.loadPreset(p); a.select(a.world.sources.find(b => b.name === n)); }, [preset, name]);
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
  await page.evaluate(([n, la, lo, alt, when]) => {
    const a = window.orbital, v = a.v3, b = a.world.sources.find(x => x.name === n);
    const sun = a.world.sources.find(x => x.cls === 'star');
    const V = v.camera.position.constructor;
    const L = la * Math.PI / 180, O = lo * Math.PI / 180;
    const at = () => new V(Math.cos(L) * Math.cos(O), Math.cos(L) * Math.sin(O), Math.sin(L)).applyQuaternion(window.__bodyQuat(b));
    const s = new V(sun.x - b.x, sun.y - b.y, sun.z - b.z).normalize();
    const want = when === 'night' ? -0.6 : 0.6;
    let best = 0, bd = 9;
    for (let k = 0; k < 720; k++) { b.spinAngle = k * Math.PI / 360; const d = Math.abs(at().dot(s) - want); if (d < bd) { bd = d; best = b.spinAngle; } }
    b.spinAngle = best;
    a.paused = true;
    const w = at(), r = b.r + alt / 1.495978707e11;
    v.travel = null;
    v.ship.nav.anchor = b; v.ship.nav.off = [w.x * r, w.y * r, w.z * r]; v.ship.nav.vel = [0, 0, 0];
    v.res.scale = 1; v.res.t = -1e9; v.renderer.setPixelRatio(1); v.resize();
  }, [name, +lat, +lon, +alt, when]);
  await page.waitForFunction(() => window.orbital.v3.ground.ready, null, { timeout: 120000 }).catch(() => console.log('ground not ready'));
  await page.waitForTimeout(8000);
  if (process.env.EVAL) console.log('eval:', await page.evaluate(async code => { const a = window.orbital; const F = Object.getPrototypeOf(async () => {}).constructor; return String(await new F('v', 'a', code)(a.v3, a)); }, process.env.EVAL));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out });
  console.log('saved', out);
} finally {
  await browser.close();
  await server.close();
}
