import { chromium } from 'playwright';
import { createServer } from 'vite';
const OUT = process.env.SHOTS;
const server = await createServer({ server: { port: 4179, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:4179/');
await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
const W = process.env.WORLD || 'Mars', P = process.env.PRESET || 'inner', site = process.env.SITE || 'Perseverance · Jezero crater';
await page.evaluate(([p, w]) => { const a = window.orbital; a.loadPreset(p); a.select(a.world.sources.find(b => b.name === w)); }, [P, W]);
await page.keyboard.press('KeyV');
await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
await page.evaluate(s => window.orbital.v3.goToSite(window.orbital.selected, s), site);
await page.waitForFunction(() => window.orbital.v3.landing?.phase === 'landed', null, { timeout: 60000 });
await page.evaluate(() => { const v = window.orbital.v3; v.leaveHelm(); v.use('airlock'); });
await page.waitForTimeout(2500);
const kinds = await page.evaluate(() => [...window.orbital.v3.ground.forms.values()].map(f => f.fm.kind + ':' + f.fm.size.toFixed(0)));
console.log('forms', kinds.join(' '));
for (const kind of ['arch', 'hoodoo', 'mushroom', 'mesa', 'blades', 'cave', 'cave-in']) {
  const ok = await page.evaluate(k => {
    const v = window.orbital.v3, G = v.ground, R = G.spec.R;
    const want = k === 'cave-in' ? 'cave' : k;
    const f = [...G.forms.values()].map(x => x.fm).find(x => x.kind === want);
    if (!f) return false;
    // stand off it (or inside the cave, looking at the back wall), facing it
    const back = k === 'cave-in' ? -0.3 : k === 'cave' ? 2.6 : 2.2;
    // the mouth faces local −z, turned by yaw: in world tangent terms, local −z is north rotated
    const d = f.size * back;
    const ang = f.yaw; // facing direction of its −z axis from north, about up
    const dirN = Math.cos(ang), dirE = -Math.sin(ang);
    const off = [f.e[0] * dirE + f.nn[0] * dirN, f.e[1] * dirE + f.nn[1] * dirN, f.e[2] * dirE + f.nn[2] * dirN];
    const m = [f.n[0] + off[0] * d / R, f.n[1] + off[1] * d / R, f.n[2] + off[2] * d / R];
    const l = Math.hypot(...m);
    v.surf.n = [m[0] / l, m[1] / l, m[2] / l];
    // face the formation: yaw so forward = −off
    const fe = -dirE * Math.sign(back), fn = -dirN * Math.sign(back);
    v.surf.yaw = Math.atan2(-fe, fn); v.surf.pitch = k === 'cave-in' ? 0.1 : 0.12;
    return true;
  }, kind);
  if (!ok) continue;
  await page.waitForTimeout(1500);
  console.log(kind, await page.evaluate(() => JSON.stringify(window.orbital.v3.ground.formationAt(window.orbital.v3.surf.n))));
  await page.screenshot({ path: `${OUT}/${W}-form-${kind}.png` });
}
console.log('errors:', errs.join(' | '));
await browser.close(); await server.close();
