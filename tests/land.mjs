// Landing test with screenshots: put the ship over a site, land, step out, look round.
import { chromium } from 'playwright';
import { createServer } from 'vite';
const OUT = process.env.SHOTS || '/tmp/shots';
const server = await createServer({ server: { port: 4175, strictPort: true }, logLevel: 'error' });
await server.listen();
const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('DBG')) errs.push(m.text()); });
await page.goto('http://localhost:4175/');
await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
const world = process.env.WORLD || 'Moon', preset = process.env.PRESET || 'earth';
const lat = Number(process.env.LAT ?? 0.674), lon = Number(process.env.LON ?? 23.47), alt = Number(process.env.ALT ?? 3000);
await page.evaluate(([p, w]) => { const a = window.orbital; a.loadPreset(p); a.select(a.world.sources.find(b => b.name === w)); }, [preset, world]);
await page.keyboard.press('KeyV');
await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
await page.waitForTimeout(500);
// put the ship over the site
await page.evaluate(([w, la, lo, al]) => {
  const v = window.orbital.v3, b = window.orbital.world.sources.find(x => x.name === w);
  window.__place = () => {
    const q = window.__bodyQuat(b);
    const n = [Math.cos(la * Math.PI / 180) * Math.cos(lo * Math.PI / 180), Math.cos(la * Math.PI / 180) * Math.sin(lo * Math.PI / 180), Math.sin(la * Math.PI / 180)];
    const R = b.r * 1.495978707e11 + al;
    const p = new window.__THREE.Vector3(n[0] * R, n[1] * R, n[2] * R).applyQuaternion(q);
    v.ship.nav.anchor = b; v.ship.nav.off = [p.x / 1.495978707e11, p.y / 1.495978707e11, p.z / 1.495978707e11]; v.ship.nav.vel = [0, 0, 0];
    // level, looking north-ish
    const up = p.clone().normalize();
    const m = new window.__THREE.Matrix4().lookAt(new window.__THREE.Vector3(), new window.__THREE.Vector3(0, 0, 1).projectOnPlane(up).normalize(), up);
    v.ship.quat.setFromRotationMatrix(m);
  };
  window.__place();
}, [world, lat, lon, alt]);
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${world}-${name}.png` }); };
for (let k = 0; k < 40; k++) { await page.waitForTimeout(250); if (await page.evaluate(() => window.orbital.v3.ground.ready)) break; await page.evaluate(() => window.__place()); }
console.log('ground ready', await page.evaluate(() => window.orbital.v3.ground.ready), await page.evaluate(() => window.orbital.v3.readout().near));
await page.waitForTimeout(800);
await shot('1-above');
console.log('land block:', await page.evaluate(() => window.orbital.v3.landBlock()));
await page.keyboard.press('KeyL');
await page.waitForFunction(() => window.orbital.v3.landing?.phase === 'landed', null, { timeout: 60000 }).catch(async () => console.log('did not land', await page.evaluate(() => JSON.stringify(window.orbital.v3.landing?.phase))));
await page.waitForTimeout(2500);
await shot('2-landed');
await page.keyboard.press('KeyZ');
await page.waitForTimeout(600);
await shot('3-cockpit');
// out of the airlock
await page.evaluate(() => { const v = window.orbital.v3; v.leaveHelm(); v.use('airlock'); });
await page.waitForTimeout(1500);
console.log('mode', await page.evaluate(() => window.orbital.v3.mode), await page.evaluate(() => window.orbital.v3.readout().where), await page.evaluate(() => window.orbital.v3.readout().near));
await shot('4-out');
await page.evaluate(() => { const v = window.orbital.v3; v.surf.yaw += Math.PI; v.surf.pitch = 0.15; });
await page.waitForTimeout(800);
await shot('5-ship');
await page.keyboard.down('KeyW'); await page.waitForTimeout(3000); await page.keyboard.up('KeyW');
await page.evaluate(() => { const v = window.orbital.v3; v.surf.yaw += Math.PI * 0.6; v.surf.pitch = -0.1; });
await page.waitForTimeout(800);
await shot('6-walk');
await page.keyboard.press('KeyR');
await page.waitForTimeout(800);
await shot('7-scan');
console.log('errors:', errs.slice(0, 10).join(' | '));
await browser.close();
await server.close();
