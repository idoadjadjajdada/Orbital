// Smoke test in a real browser: boots, every system loads, a body can be thrown.
// Run after `npm run build`: `npm run test:browser` (CHROMIUM_PATH picks the browser).
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 4174, strictPort: true }, logLevel: 'error' });
await server.listen();
const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? '  ok  ' : 'FAIL  '}${name}${extra ? `  [${extra}]` : ''}`); };

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://localhost:4174/');
  await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
  ok('boots without errors', errs.length === 0, errs.join(' | '));
  ok('the solar system is loaded', await page.evaluate(() => window.orbital.world.sources.length) >= 20);

  for (const key of ['inner', 'earth', 'saturn', 'trappist', 'kepler16', 'theia', 'ringmaker', 'xrb', 'kirkwood', 'sgra', 'merger', 'tde', 'spaghetti', 'quasar', 'solar']) {
    await page.evaluate(k => window.orbital.loadPreset(k), key);
    await page.waitForTimeout(400);
    ok(`${key} loads and runs`, await page.evaluate(() => window.orbital.world.sources.length > 0 && isFinite(window.orbital.world.time)));
  }

  await page.keyboard.press('Space');
  const before = await page.evaluate(() => window.orbital.world.sources.length);
  await page.click('.card[data-key="terran"]');
  await page.mouse.move(760, 300);
  await page.mouse.down();
  await page.mouse.move(720, 280, { steps: 6 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  ok('dragging from space throws a body', await page.evaluate(() => window.orbital.world.sources.length) === before + 1);

  await page.evaluate(() => { const a = window.orbital; a.select(a.world.sources.find(b => b.name === 'Sun')); });
  await page.waitForTimeout(400);
  ok('selecting shows the inspector', await page.isVisible('#inspector'));

  ok('the inspector draws a surface map', await page.evaluate(() => { const a = window.orbital; a.select(a.world.sources.find(b => b.name === 'Earth')); return true; }) && (await page.waitForTimeout(400), await page.isVisible('#iMap')));

  // the builder: draw, check, place
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(200);
  ok('B opens the builder', await page.isVisible('#builder'));
  await page.click('#bShapes button:has-text("Dog bone")');
  await page.fill('#bSize', '2');
  await page.dispatchEvent('#bSize', 'input');
  const verdictSmall = await page.textContent('#bVerdict');
  await page.fill('#bSize', '4');
  await page.dispatchEvent('#bSize', 'input');
  const verdictBig = await page.textContent('#bVerdict');
  ok('a small iron bone holds its shape; a huge one slumps', /keeps its shape/.test(verdictSmall) && /slump/.test(verdictBig), `${verdictSmall} / ${verdictBig}`);
  const gb = await page.$('#bGrid');
  const box = await gb.boundingBox();
  await page.click('.swatch[data-mat="7"]');
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 40, { steps: 5 }); await page.mouse.up();
  await page.click('#bUse');
  const n0 = await page.evaluate(() => window.orbital.world.sources.length);
  // somewhere with nothing under the pointer
  const spot = await page.evaluate(() => { for (let y = 160; y < 600; y += 23) for (let x = 400; x < 900; x += 31) if (!window.orbital.view.pick(x, y)) return [x, y]; return [700, 200]; });
  await page.mouse.click(spot[0], spot[1]);
  await page.waitForTimeout(300);
  ok('a built body can be placed', await page.evaluate(n => window.orbital.world.sources.length === n + 1 && window.orbital.world.sources.some(b => b.kind === 'custom' && b.shape), n0));
  await page.evaluate(() => { window.orbital.paused = false; });
  await page.waitForTimeout(1500);
  ok('the huge one slumped into a sphere', await page.evaluate(() => window.orbital.world.sources.find(b => b.kind === 'custom')?.shape?.round > 0.5));

  // undo puts it back
  await page.keyboard.press('Control+KeyZ');
  await page.waitForTimeout(200);
  ok('undo removes it', await page.evaluate(n => window.orbital.world.sources.length === n, n0));

  // tools
  await page.keyboard.press('Escape');
  await page.click('[data-tool="ruler"]');
  await page.mouse.move(300, 300); await page.mouse.down(); await page.mouse.move(600, 500, { steps: 5 }); await page.mouse.up();
  ok('the ruler measures', await page.isVisible('#rulerBox') && /AU|km/.test(await page.textContent('#rulerBox')));
  await page.click('[data-tool="hand"]');
  await page.evaluate(() => window.orbital.loadPreset('earth'));
  await page.waitForTimeout(300);
  await page.evaluate(() => { const a = window.orbital; a.tool = 'bombard'; a.bombard = { target: a.world.sources.find(b => b.name === 'Moon'), acc: 0 }; });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.orbital.bombard = null; window.orbital.tool = 'hand'; });
  ok('bombarding the Moon leaves craters', await page.evaluate(() => window.orbital.world.sources.find(b => b.name === 'Moon').craters.length > 0));
  // the tool in hand goes back down when picked again
  await page.click('[data-tool="ruler"]');
  await page.click('[data-tool="ruler"]');
  ok('picking a tool again puts it down', await page.evaluate(() => window.orbital.tool === 'select'));
  // where the Moon is on screen, in CSS px, and a point beside it
  const moonAt = () => page.evaluate(() => { const a = window.orbital, m = a.world.sources.find(b => b.name === 'Moon'), r = a.view.canvas?.getBoundingClientRect?.() ?? { left: 0, top: 0 }; return [a.view.sx(m.x) * 2 + r.left, a.view.sy(m.y) * 2 + r.top]; });
  const relV = () => page.evaluate(() => { const a = window.orbital, m = a.world.sources.find(b => b.name === 'Moon'), e = a.world.sources.find(b => b.name === 'Earth'); return [m.vx - e.vx, m.vy - e.vy, m.x, m.y]; });
  const fresh = async () => {
    await page.evaluate(() => { const a = window.orbital; a.loadPreset('earth'); a.follow(a.world.sources.find(b => b.name === 'Earth')); a.fitRadius(6e-3); a.view.scale = a.view.scaleGoal; a.warpLog = -3; });
    await page.waitForTimeout(600);
  };
  await fresh();
  let [mx, my] = await moonAt();
  await page.keyboard.press('KeyG');
  let v0 = await relV();
  await page.mouse.move(mx + 60, my); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  let v1 = await relV();
  ok('attract pulls the Moon towards the pointer', v1[0] - v0[0] > 0 && Math.abs(v1[0] - v0[0]) > Math.abs(v1[1] - v0[1]) * 0.5, `${v1[0] - v0[0]} ${v1[1] - v0[1]}`);
  await fresh();
  [mx, my] = await moonAt();
  await page.keyboard.press('KeyX');
  v0 = await relV();
  await page.mouse.move(mx + 60, my); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  v1 = await relV();
  ok('repel pushes it away', v1[0] - v0[0] < 0, `${v1[0] - v0[0]}`);
  await fresh();
  [mx, my] = await moonAt();
  await page.keyboard.press('KeyK');
  const m0 = await page.evaluate(() => window.orbital.world.sources.find(b => b.name === 'Moon').m);
  await page.mouse.move(mx, my); await page.mouse.down(); await page.waitForTimeout(2500); await page.mouse.up();
  ok('the laser boils the Moon away', await page.evaluate(m => { const M = window.orbital.world.sources.find(b => b.name === 'Moon'); return !M || M.m < m * 0.9; }, m0));
  await page.keyboard.press('KeyN');
  await page.mouse.click(mx + 30, my + 30);
  await page.waitForTimeout(300);
  ok('blast goes off', await page.evaluate(() => window.orbital.tool === 'blast'));
  await fresh();
  await page.evaluate(() => { window.orbital.paused = true; });
  [mx, my] = await moonAt();
  await page.keyboard.press('KeyD');
  const ns = await page.evaluate(() => window.orbital.world.sources.length);
  await page.mouse.click(mx, my);
  await page.mouse.click(mx - 120, my - 120);
  await page.waitForTimeout(300);
  ok('clone copies a body', await page.evaluate(n => window.orbital.world.sources.length === n + 1 && window.orbital.world.sources.some(b => b.name === 'Moon (copy)'), ns));
  await page.keyboard.press('Escape');
  ok('Escape puts the tool down', await page.evaluate(() => window.orbital.tool === 'select' && !window.orbital.armed));
  await page.evaluate(() => { window.orbital.paused = false; });
  await page.click('#findBtn');
  await page.fill('#findQ', 'Hubble');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  ok('find follows a body by name', await page.evaluate(() => window.orbital.focus?.name === 'Hubble'));

  // the new shelf and the objects that arrive already going
  await page.click('.chip[data-shelf="Craft"]');
  ok('the craft shelf lists spacecraft', (await page.$$('.card')).length >= 10);
  for (const key of ['ton618', 'blazar', 'microquasar', 'wormhole', 'whitehole', 'magnetar', 'nsmerger', 'ppdisc', 'snr', 'iss']) {
    await page.evaluate(k => { const a = window.orbital; a.clear(); a.armed = k; a.place({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }); a.armed = null; a.paused = false; }, key);
    await page.waitForTimeout(250);
    ok(`${key} places and runs`, await page.evaluate(() => window.orbital.world.bodies.length > 0 && isFinite(window.orbital.world.time)));
  }

  // the view from inside
  await page.evaluate(() => { const a = window.orbital; a.loadPreset('earth'); a.select(a.world.sources.find(b => b.name === 'Earth')); });
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(2500);
  ok('V opens the 3D view at real time', await page.evaluate(() => window.orbital.mode3d && Math.abs(window.orbital.warp * 31557600 - 1) < 1e-6 && !document.getElementById('c3').hidden));
  const p0 = await page.evaluate(() => window.orbital.v3.where());
  await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW');
  ok('W flies forward', await page.evaluate(p => { const q = window.orbital.v3.where(); return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 0; }, p0));
  await page.evaluate(() => { const a = window.orbital; a.select(a.world.sources.find(b => b.name === 'Moon')); });
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(1500);
  ok('the autopilot engages overdrive for the Moon', await page.evaluate(() => window.orbital.v3.ship.odLevel > 0));
  await page.waitForTimeout(7000);
  ok('T flies to the selection', await page.evaluate(() => window.orbital.v3.nearest().b?.name === 'Moon'));
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(400);
  ok('M opens the ship map with destinations', await page.evaluate(() => document.querySelector('.radar3').classList.contains('big') && document.querySelectorAll('.dest3 .row').length >= 3));
  await page.evaluate(() => { const a = window.orbital; a.select(a.world.sources.find(b => b.name === 'Sun')); });
  await page.waitForTimeout(300);
  await page.click('.dest3 .row.sel button[data-a="jump"]');
  await page.waitForTimeout(400);
  ok('the map starts a jump and closes', await page.evaluate(() => !!window.orbital.v3.ship.jump && !document.querySelector('.radar3').classList.contains('big')));
  await page.waitForTimeout(3000);
  ok('the jump arrives at the Sun and drains the drive', await page.evaluate(() => window.orbital.v3.nearest().b?.name === 'Sun' && window.orbital.v3.ship.charge < 0.2));
  await page.keyboard.press('KeyO');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
  ok('O overdrive flies faster than light', await page.evaluate(() => Math.hypot(...window.orbital.v3.pilot.vel) > 3e8));
  await page.keyboard.press('KeyO');
  await page.keyboard.press('KeyZ');
  ok('Z switches to the cockpit', await page.evaluate(() => window.orbital.v3.ship.view === 'cockpit'));
  // a controller, faked through the Gamepad API
  await page.evaluate(() => {
    const btn = () => Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    window.__pad = { id: 'Test pad (STANDARD GAMEPAD)', connected: true, mapping: 'standard', axes: [0, -1, 0, 0], buttons: btn() };
    navigator.getGamepads = () => [window.__pad];
  });
  const q0 = await page.evaluate(() => window.orbital.v3.where());
  await page.waitForTimeout(800);
  ok('the controller left stick flies', await page.evaluate(p => { const q = window.orbital.v3.where(); return window.orbital.pad.connected && Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 0; }, q0));
  await page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; window.__pad.buttons[8].pressed = true; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__pad.buttons[8].pressed = false; });
  ok('the controller View button opens the map', await page.evaluate(() => document.querySelector('.radar3').classList.contains('big')));
  await page.evaluate(() => { window.__pad.buttons[1].pressed = true; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__pad.buttons[1].pressed = false; window.__pad.buttons[15].pressed = true; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__pad.buttons[15].pressed = false; });
  ok('B closes the map and the d-pad picks a target', await page.evaluate(() => !document.querySelector('.radar3').classList.contains('big') && !!window.orbital.selected));
  await page.evaluate(() => { window.__pad.buttons[9].pressed = true; });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__pad.buttons[9].pressed = false; });
  ok('Menu goes back to the 2D map', await page.evaluate(() => !window.orbital.mode3d));
  await page.evaluate(() => { const v = window.orbital.view; window.__s0 = v.scale; window.__pad.buttons[7].value = 1; window.__pad.buttons[7].pressed = true; });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__pad.buttons[7].value = 0; window.__pad.buttons[7].pressed = false; window.__pad.buttons[9].pressed = true; });
  ok('RT zooms the 2D map in', await page.evaluate(() => window.orbital.view.scale > window.__s0 * 1.5));
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__pad.buttons[9].pressed = false; window.__pad.connected = false; });
  ok('Menu steps back into 3D', await page.evaluate(() => window.orbital.mode3d));
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(300);
  ok('V goes back to the map', await page.evaluate(() => !window.orbital.mode3d && document.getElementById('c3').hidden));

  ok('still no errors', errs.length === 0, errs.join(' | '));
  await page.close();

  // the same app on an iPad: touch only, no hover, no keyboard
  const ipad = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const t = await ipad.newPage();
  const terrs = [];
  t.on('pageerror', e => terrs.push(e.message));
  await t.goto('http://localhost:4174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await t.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
  await t.tap('#presetBtn');
  await t.tap('#presetMenu button:has-text("Saturn")');
  await t.waitForTimeout(500);
  ok('iPad: a system loads from the menu by touch', await t.evaluate(() => window.orbital.presetKey === 'saturn'));
  const cdp = await ipad.newCDPSession(t);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  const d0 = await t.evaluate(() => window.orbital.view.scale);
  await touch('touchStart', [[500, 400], [700, 400]]);
  for (let k = 1; k <= 6; k++) await touch('touchMove', [[500 - 20 * k, 400], [700 + 20 * k, 400]]);
  await touch('touchEnd', []);
  ok('iPad: pinching zooms', await t.evaluate(d => window.orbital.view.scale > d, d0));
  ok('iPad: no errors', terrs.length === 0, terrs.join(' | '));
  await ipad.close();
} finally {
  await browser.close();
  await server.close();
}
process.exit(fails ? 1 : 0);
