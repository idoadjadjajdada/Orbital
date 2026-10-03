// Into a giant: the ship at a few depths, screenshots
import { chromium } from 'playwright';
import { createServer } from 'vite';
const OUT = process.env.SHOTS || '/tmp/shots';
const server = await createServer({ server: { port: 4176, strictPort: true }, logLevel: 'error' });
await server.listen();
const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:4176/');
await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
const world = process.env.WORLD || 'Jupiter', preset = process.env.PRESET || 'jupiter';
await page.evaluate(([p, w]) => { const a = window.orbital; a.loadPreset(p); a.select(a.world.sources.find(b => b.name === w)); }, [preset, world]);
await page.keyboard.press('KeyV');
await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
for (const [i, alt, pitch] of [[1, 40000, -0.3], [2, -15000, -0.2], [3, -90000, 0]]) {
  await page.evaluate(([w, al, pi]) => {
    const v = window.orbital.v3, b = window.orbital.world.sources.find(x => x.name === w), T = window.__THREE;
    // the day side, a little off the sub-solar point
    const sun = window.orbital.world.sources.find(x => x.name === 'Sun');
    const d = new T.Vector3(sun.x - b.x, sun.y - b.y, sun.z - b.z).normalize().add(new T.Vector3(0, 0, -0.35)).normalize();
    const R = b.r * 1.495978707e11 + al;
    const p = d.multiplyScalar(R);
    v.ship.nav.anchor = b; v.ship.nav.off = [p.x / 1.495978707e11, p.y / 1.495978707e11, p.z / 1.495978707e11]; v.ship.nav.vel = [0, 0, 0];
    const up = p.clone().normalize();
    const f = new T.Vector3(0, 0, 1).projectOnPlane(up).normalize();
    const m = new T.Matrix4().lookAt(new T.Vector3(), f, up);
    v.ship.quat.setFromRotationMatrix(m);
    v.ship.quat.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), pi));
  }, [world, alt, pitch]);
  await page.waitForTimeout(2500);
  console.log(i, await page.evaluate(() => window.orbital.v3.readout().near));
  await page.screenshot({ path: `${OUT}/${world}-giant-${i}.png` });
}
console.log('errors:', errs.slice(0, 10).join(' | '));
await browser.close();
await server.close();
