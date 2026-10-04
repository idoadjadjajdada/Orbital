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
/** wait (up to a few seconds) for a condition in the page: frames can be slow in a software renderer */
const until = (pg, fn, arg) => pg.waitForFunction(fn, arg, { timeout: 8000 }).then(() => true, () => false);
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? '  ok  ' : 'FAIL  '}${name}${extra ? `  [${extra}]` : ''}`); };

/**
 * The suite is in parts, each in a page of its own, so they can run side by side (CI runs one
 * part per job): PARTS=map,ship picks some; all of them by default.
 */
const ALL = ['map', 'ship', 'land', 'giant', 'touch'];
const want = new Set((process.env.PARTS || ALL.join(',')).split(',').map(x => x.trim()).filter(Boolean));
for (const w of want) if (!ALL.includes(w)) { console.log(`unknown part ${w}: the parts are ${ALL.join(', ')}`); process.exit(2); }
let page, errs = [];
/** a fresh page with the app booted */
async function fresh() {
  if (page) await page.close();
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://localhost:4174/');
  await page.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
}
const part = async name => {
  if (!want.has(name)) return false;
  console.log(`-- ${name}`);
  await fresh();
  return true;
};
const clean = name => ok(`${name}: no errors`, errs.length === 0, errs.join(' | '));

try {
  if (await part('map')) {
  ok('boots without errors', errs.length === 0, errs.join(' | '));
  ok('the solar system is loaded', await page.evaluate(() => window.orbital.world.sources.length) >= 20);
  const nCtl = await page.evaluate(() => window.orbital.world.sources.length);
  await page.keyboard.press('Control+KeyC');
  ok('Ctrl+C copies, it does not clear the sandbox', await page.evaluate(n => window.orbital.world.sources.length === n, nCtl));

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
  const moonAt = () => page.evaluate(() => { const a = window.orbital, m = a.world.sources.find(b => b.name === 'Moon'), r = a.view.canvas.getBoundingClientRect(), k = r.width / a.view.W; return [a.view.sx(m.x) * k + r.left, a.view.sy(m.y) * k + r.top]; });
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

  ok('Mars is painted from MOLA and the mosaic, fetched once', await page.evaluate(async () => (await import('/src/pixel/marsdata.ts')).marsReady));
  clean('map');
  }

  if (await part('ship')) {
  // the view from inside
  await page.evaluate(() => { const a = window.orbital; a.loadPreset('earth'); a.select(a.world.sources.find(b => b.name === 'Earth')); });
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(2500);
  ok('V opens the 3D view at real time', await page.evaluate(() => window.orbital.mode3d && Math.abs(window.orbital.warp * 31557600 - 1) < 1e-6 && !document.getElementById('c3').hidden));
  const p0 = await page.evaluate(() => window.orbital.v3.where());
  await page.keyboard.down('KeyW');
  const flew = await until(page, p => { const q = window.orbital.v3.where(); return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 0; }, p0);
  await page.keyboard.up('KeyW');
  ok('W flies forward', flew);
  await page.keyboard.press('KeyN');
  ok('N switches the floodlight on', await until(page, () => window.orbital.v3.lights.flood && window.orbital.v3.lights.uniforms.lampPos.value[0].w > 0));
  await page.keyboard.press('KeyN');
  ok('and off', await page.evaluate(() => !window.orbital.v3.lights.flood));
  ok('the Sun boils: its surface is the live shader', await page.evaluate(() => { const a = window.orbital, v = a.v3, s = a.world.sources.find(b => b.name === 'Sun'); return !!v.objs.get(s)?.mat?.uniforms?.time; }));
  await page.evaluate(() => { const a = window.orbital; a.select(a.world.sources.find(b => b.name === 'Moon')); });
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(1500);
  ok('the autopilot engages overdrive for the Moon', await until(page, () => window.orbital.v3.ship.odLevel > 0));
  ok('T flies to the selection', await page.waitForFunction(() => window.orbital.v3.nearest().b?.name === 'Moon', null, { timeout: 40000 }).then(() => true, () => false));
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(400);
  ok('M opens the nav map with destinations', await page.evaluate(() => !document.querySelector('.nav3').hidden && document.querySelectorAll('.dest3 .row').length >= 3));
  await page.evaluate(() => { const a = window.orbital; a.select(a.world.sources.find(b => b.name === 'Sun')); });
  await page.waitForTimeout(300);
  await page.click('.dest3 .row.sel button[data-a="jump"]');
  await page.waitForTimeout(400);
  ok('the map opens a wormhole and closes', await page.evaluate(() => window.orbital.v3.ship.worm?.phase === 'charge' && document.querySelector('.nav3').hidden));
  ok('the ship goes into the throat', await page.waitForFunction(() => window.orbital.v3.ship.worm?.phase === 'tunnel', null, { timeout: 30000 }).then(() => true, () => false));
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(200);
  const f0 = await page.evaluate(() => window.orbital.v3.foot.p.z);
  await page.keyboard.down('KeyS'); await page.waitForTimeout(600); await page.keyboard.up('KeyS');
  ok('F leaves the helm, and you can walk the ship in the wormhole', await page.evaluate(f => { const v = window.orbital.v3; return v.mode === 'walk' && v.foot.p.z > f + 0.5 && !!v.ship.worm; }, f0));
  await page.evaluate(() => { const v = window.orbital.v3; v.foot.p.set(0, 0, -19.6); v.foot.yaw = 0; v.foot.pitch = -0.6; });
  ok('the helm is in reach', await until(page, () => window.orbital.v3.prompt?.label === 'Take the helm'));
  await page.keyboard.press('KeyF');
  ok('F takes the helm', await page.evaluate(() => window.orbital.v3.mode === 'pilot'));
  await page.waitForFunction(() => !window.orbital.v3.ship.worm, null, { timeout: 30000 });
  ok('the wormhole comes out at the Sun and drains the drive', await page.evaluate(() => window.orbital.v3.nearest().b?.name === 'Sun' && window.orbital.v3.ship.charge < 0.2));
  await page.keyboard.press('KeyO');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
  ok('O overdrive flies faster than light', await page.evaluate(() => Math.hypot(...window.orbital.v3.ship.nav.vel) > 3e8));
  await page.keyboard.press('KeyO');
  const view0 = await page.evaluate(() => window.orbital.v3.ship.view);
  await page.keyboard.press('KeyZ');
  ok('Z switches between the cockpit and the chase view', await page.evaluate(v => window.orbital.v3.ship.view !== v, view0));
  // out of the airlock and back
  await page.evaluate(() => { const a = window.orbital; a.loadPreset('earth'); a.select(a.world.sources.find(b => b.name === 'Moon')); });
  await page.keyboard.press('KeyV'); await page.keyboard.press('KeyV');
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyF');
  await page.evaluate(() => { const v = window.orbital.v3; v.foot.p.set(-7.4, 0, 0); v.foot.yaw = Math.PI / 2; v.foot.pitch = 0; });
  ok('the airlock is in reach', await until(page, () => window.orbital.v3.prompt?.label === 'Step outside'));
  await page.keyboard.press('KeyF');
  ok('F steps outside, at the hatch', await until(page, () => window.orbital.v3.mode === 'eva' && window.orbital.v3.prompt?.label === 'Board the ship'));
  await page.keyboard.press('KeyF');
  ok('F at the hatch boards the ship', await page.evaluate(() => window.orbital.v3.mode === 'walk'));
  await page.evaluate(() => { window.orbital.v3.foot.yaw = Math.PI / 2; });
  await until(page, () => window.orbital.v3.prompt?.label === 'Step outside');
  await page.keyboard.press('KeyF');
  await until(page, () => window.orbital.v3.mode === 'eva');
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  await until(page, () => +(window.orbital.v3.readout().where.match(/(\d+) m from/)?.[1] ?? 0) > 60);
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  const away = await page.evaluate(() => window.orbital.v3.readout().where);
  ok('the suit flies away from the ship', /Spacewalk · \d+ m/.test(away) && +away.match(/(\d+) m/)[1] > 45, away);
  await page.keyboard.press('KeyG');
  ok('G calls the ship', await page.evaluate(() => window.orbital.v3.travel?.name === 'you'));
  await page.evaluate(() => window.orbital.v3.board());
  // around the ship: the lab's survey, the power routing, the ladder to the hangar, sleeping
  await page.evaluate(() => { const v = window.orbital.v3; v.travel = null; v.ship.nav.vel = [0, 0, 0]; v.foot.p.set(2.4, 0, -10.7); v.foot.yaw = -Math.PI / 2; v.foot.pitch = 0; });
  ok('the survey console is in reach in the lab', await until(page, () => window.orbital.v3.prompt?.label === 'Survey the target'));
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(200);
  ok('F opens the survey, with the target\'s gravity and a landing verdict', await page.evaluate(() => !document.querySelector('.panel3').hidden && /Surface gravity/.test(document.querySelector('.panel3').textContent) && !!document.querySelector('.pland')));
  await page.keyboard.press('Escape');
  ok('Escape closes it', await page.evaluate(() => document.querySelector('.panel3').hidden));
  await page.evaluate(() => window.orbital.v3.use('power'));
  await page.click('.panel3 [data-id="wormhole"]');
  ok('power can be routed to the wormhole drive', await page.evaluate(() => window.orbital.v3.ship.power === 'wormhole' && window.orbital.v3.ship.refill() < 40));
  await page.evaluate(() => { const v = window.orbital.v3; v.ship.power = 'balanced'; v.panels.close(); v.foot.p.set(-3.6, 0, 10.6); v.foot.yaw = 0; v.foot.pitch = -0.5; });
  ok('the hatch in engineering leads down', await until(page, () => window.orbital.v3.prompt?.label === 'Climb down to the hangar'));
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(200);
  ok('F climbs down to the hangar', await page.evaluate(() => window.orbital.v3.foot.deck === 1 && /hangar/.test(window.orbital.v3.readout().where)));
  ok('the lander is in the way, the deck round it is not', await page.evaluate(() => { const h = window.orbital.v3.ship.hull; return !h.canStand(0.6, 12.5, 0.3, 1) && h.canStand(-3.6, 10.3, 0.3, 1) && !h.canStand(-3.6, 10.3, 0.3, 2); }));
  ok('labels are seen through windows, not walls', await page.evaluate(() => { const h = window.orbital.v3.ship.hull, V = window.orbital.v3.camera.position.constructor; const e = new V(0, 1.65, -2); return h.seesOut(e, new V(0, 1, 0)) && !h.seesOut(e, new V(0, 0, 1)) && h.seesOut(new V(0, 1.7, -20), new V(0, 0, -1)); }));
  const t0 = await page.evaluate(() => { const v = window.orbital.v3; v.climb(0); v.foot.p.set(-3.2, 0, -12.6); return window.orbital.world.time; });
  await page.evaluate(() => window.orbital.v3.use('bunk'));
  await page.waitForFunction(() => !window.orbital.v3.asleep, null, { timeout: 15000 });
  ok('a night in the bunk passes hours and puts the clock back', await page.evaluate(t => { const a = window.orbital; return (a.world.time - t) * 365.25 * 24 > 2 && Math.abs(a.warp * 31557600 - 1) < 1e-6 && a.v3.logbook.sleeps === 1; }, t0));
  await page.evaluate(() => window.orbital.v3.use('helm'));
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
  ok('the controller View button opens the map', await page.evaluate(() => !document.querySelector('.nav3').hidden));
  await page.evaluate(() => { window.__pad.buttons[1].pressed = true; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__pad.buttons[1].pressed = false; window.__pad.buttons[15].pressed = true; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__pad.buttons[15].pressed = false; });
  ok('B closes the map and the d-pad picks a target', await page.evaluate(() => document.querySelector('.nav3').hidden && window.orbital.v3.mode === 'pilot' && !!window.orbital.selected));
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
  clean('ship');
  }

  if (await part('land')) {
  // landing: fly to a real site, set down, step out, walk, scan, send a rover, back aboard, lift off
  await page.evaluate(() => { const a = window.orbital; a.loadPreset('earth'); a.select(a.world.sources.find(b => b.name === 'Moon')); });
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
  await page.evaluate(() => window.orbital.v3.goToSite(window.orbital.selected, 'Apollo 11 · Tranquility Base'));
  ok('the ship flies to Apollo 11 and the ground comes up', await page.waitForFunction(() => { const v = window.orbital.v3; return !v.travel && v.ground.ready && v.landBlock() === ''; }, null, { timeout: 90000 }).then(() => true, () => false));
  await page.keyboard.press('KeyL');
  ok('L lands', await page.waitForFunction(() => window.orbital.v3.landing?.phase === 'landed', null, { timeout: 60000 }).then(() => true, () => false));
  ok('each leg telescopes to the ground under it', await page.evaluate(() => window.orbital.v3.landing.reach.length === 6 && window.orbital.v3.landing.reach.every(r => r > 0.3 && r < 20)));
  await page.evaluate(() => { const v = window.orbital.v3; v.leaveHelm(); v.use('airlock'); });
  ok('the airlock lets you down the ladder onto the Moon', await page.evaluate(() => window.orbital.v3.mode === 'surface' && /On Moon/.test(window.orbital.v3.readout().where) && /0\.17 g · vacuum/.test(window.orbital.v3.readout().near)));
  await page.evaluate(() => window.orbital.v3.hangLamp());
  ok('a lamp hangs in the sky over where you stand', await until(page, () => { const v = window.orbital.v3, L = v.lights.lamps[0]; return v.lights.lamps.length === 1 && !!L && L.b.name === 'Moon' && v.lights.uniforms.lampPos.value[2].w > 0; }));
  ok('and can be sent north', await page.evaluate(() => { const v = window.orbital.v3, L = v.lights.lamps[0], la = L.toLat; v.lights.nudge(L, 'n'); return L.toLat > la; }));
  await page.evaluate(() => { const v = window.orbital.v3; v.lights.remove(v.lights.lamps[0]); });
  ok('Apollo 11 is found and logged', await until(page, () => window.orbital.v3.logbook.finds.some(f => /Apollo 11/.test(f.what))));
  const s0 = await page.evaluate(() => [...window.orbital.v3.surf.n]);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
  ok('W walks on the ground', await page.evaluate(n => { const m = window.orbital.v3.surf.n; return Math.hypot(m[0] - n[0], m[1] - n[1], m[2] - n[2]) * 1737e3 > 1; }, s0));
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  ok('Space jumps, and in a sixth of a g you stay up', await page.evaluate(() => window.orbital.v3.surf.y > 0.6));
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  ok('R scans: the air, the ground under your feet', await page.evaluate(() => { const t = document.querySelector('.panel3').textContent; return /Field scan/i.test(t) && /exosphere/.test(t) && /SiO₂/.test(t); }));
  await page.keyboard.press('Escape');
  ok('Mission control can send a rover', await page.evaluate(() => window.orbital.v3.launchBlock('rover') === ''));
  await page.evaluate(() => window.orbital.v3.launch('rover'));
  ok('the rover lands and reports', await page.waitForFunction(() => window.orbital.v3.fleet.crafts.some(c => c.kind === 'rover' && c.state === 'surface' && c.log.some(r => /Soil/.test(r.msg))), null, { timeout: 90000 }).then(() => true, () => false));
  await page.evaluate(() => window.orbital.v3.viewCraft(window.orbital.v3.fleet.crafts.find(c => c.kind === 'rover').id));
  // (held until it has gone a metre: frames can be slow in a software renderer)
  await page.keyboard.down('KeyW');
  ok('you can drive it', await until(page, () => window.orbital.v3.mode === 'craft' && window.orbital.v3.fleet.crafts.find(c => c.kind === 'rover').odo > 1));
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyF');
  ok('F comes back from the rover', await page.evaluate(() => window.orbital.v3.mode === 'surface'));
  await page.evaluate(() => { const v = window.orbital.v3; v.surf.n = v.ladderFoot(); });
  ok('at the ladder you can board', await until(page, () => window.orbital.v3.prompt?.label === 'Climb the ladder and board'));
  await page.keyboard.press('KeyF');
  ok('F climbs aboard', await page.evaluate(() => window.orbital.v3.mode === 'walk'));
  await page.evaluate(() => window.orbital.v3.use('helm'));
  await page.keyboard.press('KeyL');
  ok('L again lifts off', await page.waitForFunction(() => !window.orbital.v3.landing, null, { timeout: 60000 }).then(() => true, () => false));
  // Lander 1, flown by hand: out of the bay, down, out and back in, and home to dock
  await page.waitForFunction(() => { const v = window.orbital.v3, o = v.overGround(); return o && o.alt > 300; }, null, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => { const v = window.orbital.v3; v.leaveHelm(); v.use('lander'); });
  ok('Lander 1 launches from the hangar with you at its controls', await page.evaluate(() => window.orbital.v3.mode === 'shuttle' && window.orbital.v3.shuttle.state === 'flying'));
  await page.keyboard.press('KeyL');
  ok('L brings Lander 1 down on its legs', await page.waitForFunction(() => window.orbital.v3.shuttle.state === 'landed', null, { timeout: 120000 }).then(() => true, () => false));
  await page.keyboard.press('KeyF');
  ok('F steps out of it onto the ground', await page.evaluate(() => window.orbital.v3.mode === 'surface'));
  ok('beside it you can board again', await until(page, () => window.orbital.v3.prompt?.label === 'Board Lander 1'));
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyL');
  await page.evaluate(() => { const v = window.orbital.v3, s = v.shuttle, S = v.shipPos(), a = s.nav.anchor; s.nav.off = [S[0] - (a?.x ?? 0) + 3e-10, S[1] - (a?.y ?? 0), S[2] - (a?.z ?? 0)]; });
  ok('back by the ship it can dock', await until(page, () => window.orbital.v3.prompt?.label === 'Dock with the ship'));
  await page.keyboard.press('KeyF');
  ok('docked, you are in the hangar', await page.evaluate(() => window.orbital.v3.mode === 'walk' && window.orbital.v3.foot.deck === 1 && window.orbital.v3.shuttle.state === 'docked'));
  await page.evaluate(() => window.orbital.v3.use('helm'));
  clean('land');
  }

  if (await part('giant')) {
  // into a giant, and a probe after you
  await page.evaluate(() => { const a = window.orbital; a.loadPreset('jupiter'); a.select(a.world.sources.find(b => b.name === 'Jupiter')); });
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
  await page.evaluate(() => {
    const v = window.orbital.v3, b = window.orbital.selected, T = window.__THREE, sun = window.orbital.world.sources.find(x => x.name === 'Sun');
    const p = new T.Vector3(sun.x - b.x, sun.y - b.y, sun.z - b.z).normalize().multiplyScalar(b.r * 1.495978707e11 - 30000);
    v.ship.nav.anchor = b; v.ship.nav.off = [p.x / 1.495978707e11, p.y / 1.495978707e11, p.z / 1.495978707e11]; v.ship.nav.vel = [0, 0, 0];
  });
  ok('the ship can go down into Jupiter, and reads it', await until(page, () => /Inside Jupiter · 30 km below the cloud tops · \d+(\.\d)? bar/.test(window.orbital.v3.readout().near) && window.orbital.v3.giant.inside > 0.5));
  ok('Jupiter has no ground to land on', await page.evaluate(() => /no surface/.test(window.orbital.v3.landBlock())));
  await page.evaluate(() => window.orbital.v3.launch('probe'));
  ok('a probe falls into it, reading the air, until it is crushed', await page.waitForFunction(() => { const c = window.orbital.v3.fleet.crafts.find(x => x.kind === 'probe'); return c && c.state === 'lost' && c.profile.length > 5 && /crushed/.test(c.status); }, null, { timeout: 150000 }).then(() => true, () => false));
  await page.keyboard.press('KeyV');

  // TON 618: its traced disc reaches out to the gas round it, and its jets are on
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
  await page.evaluate(() => { const a = window.orbital; a.clear(); a.armed = 'ton618'; const b = a.place({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }); a.armed = null; a.select(b); });
  ok('a quasar has its lensed disc out to its gas, and its jets', await until(page, () => { const a = window.orbital, o = a.v3.objs.get(a.selected); return !!o?.hole && o.hole.outer > 100 && o.hole.jets.visible; }));
  clean('giant');
  }

  if (want.has('touch')) {
  console.log('-- touch');
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
  // 3D by touch
  await t.evaluate(() => { const a = window.orbital; a.loadPreset('earth'); a.select(a.world.sources.find(b => b.name === 'Earth')); });
  await t.tap('#modeBtn');
  await t.waitForFunction(() => window.orbital.mode3d && window.orbital.v3?.active, null, { timeout: 30000 });
  await t.waitForTimeout(1500);
  ok('iPad: the inspector folds to its name in 3D', await t.evaluate(() => document.getElementById('inspector').classList.contains('min')));
  const axes = () => t.evaluate(() => { const q = window.orbital.v3.ship.quat; const f = [0, 0, -1], r = [1, 0, 0];
    const rot = v => { const [x, y, z] = v, { x: qx, y: qy, z: qz, w: qw } = q; const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
      return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx]; };
    return { f: rot(f), r: rot(r) }; });
  const a0 = await axes();
  await touch('touchStart', [[800, 420]]);
  for (let k = 1; k <= 8; k++) await touch('touchMove', [[800 + 15 * k, 420]]);
  await touch('touchEnd', []);
  await t.waitForTimeout(200);
  const a1 = await axes();
  ok('iPad: dragging right turns the view right', a1.f[0] * a0.r[0] + a1.f[1] * a0.r[1] + a1.f[2] * a0.r[2] > 0.05);
  const tp0 = await t.evaluate(() => window.orbital.v3.where());
  await touch('touchStart', [[260, 420]]);
  for (let k = 1; k <= 5; k++) await touch('touchMove', [[260, 420 - 12 * k]]);
  await t.waitForTimeout(700);
  ok('iPad: a thumb anywhere on the left is a stick, and flies', await t.evaluate(p => { const q = window.orbital.v3.where(), s = document.querySelector('.stick3'); return s.classList.contains('live') && Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 0; }, tp0));
  await touch('touchEnd', []);
  await t.tap('.rail3 [data-b="map"]');
  await t.waitForTimeout(300);
  ok('iPad: the rail opens the nav map', await t.evaluate(() => !document.querySelector('.nav3').hidden));
  await t.tap('.navhead .close');
  await t.tap('.rail3 [data-b="leave"]');
  await t.waitForTimeout(300);
  ok('iPad: the rail leaves the helm, and the thumb button jumps', await t.evaluate(() => window.orbital.v3.mode === 'walk' && !!document.querySelector('.thumb3 [data-b="jump"]')));
  ok('iPad: no errors', terrs.length === 0, terrs.join(' | '));
  await ipad.close();

  // an iPhone: the panels fold away
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const ph = await phone.newPage();
  const perrs = [];
  ph.on('pageerror', e => perrs.push(e.message));
  await ph.goto('http://localhost:4174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ph.waitForFunction(() => window.orbital && window.orbital.world.time > 0, null, { timeout: 30000 });
  ok('iPhone: the less-used buttons are folded behind ⋯', !(await ph.isVisible('#findBtn')) && await ph.isVisible('#moreBtn'));
  await ph.tap('#moreBtn');
  ok('iPhone: ⋯ shows them', await ph.isVisible('#findBtn') && await ph.isVisible('.toggles'));
  await ph.tap('#moreBtn');
  ok('iPhone: the bodies are in a drawer', !(await ph.isVisible('#cards')));
  await ph.tap('#drawerBtn');
  await ph.tap('.card[data-key="terran"]');
  ok('iPhone: picking a body closes the drawer and arms it', !(await ph.isVisible('#cards')) && await ph.evaluate(() => window.orbital.armed === 'terran' && document.getElementById('drawerBtn').classList.contains('on')));
  await ph.evaluate(() => { const a = window.orbital; a.armed = null; a.select(a.world.sources.find(b => b.name === 'Earth')); });
  await ph.waitForTimeout(200);
  ok('iPhone: the inspector shows just the name until opened', await ph.evaluate(() => document.getElementById('inspector').classList.contains('min')) && !(await ph.isVisible('#iStats')));
  await ph.tap('#iMin');
  ok('iPhone: and opens', await ph.isVisible('#iStats'));
  await ph.tap('#hideBtn');
  ok('iPhone: 👁 hides everything', !(await ph.isVisible('#tools')) && !(await ph.isVisible('#inspector')) && await ph.isVisible('#showUi'));
  await ph.tap('#showUi');
  ok('iPhone: and brings it back', await ph.isVisible('#tools'));
  ok('iPhone: no errors', perrs.length === 0, perrs.join(' | '));
  await phone.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(fails ? 1 : 0);
