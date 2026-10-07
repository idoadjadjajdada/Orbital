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
const ALL = ['map', 'ship', 'land', 'base', 'rocket', 'giant', 'touch'];
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

  // the early solar system: its eras, a jump to Theia, and Theia striking the proto-Earth
  await page.evaluate(() => window.orbital.loadPreset('early'));
  ok('the early solar system starts in the Sun\'s disc, 4.567 billion years ago', await until(page, () => !document.getElementById('eraBox').hidden && /4\.567 billion years ago/.test(document.getElementById('eraAgo').textContent) && window.orbital.world.sources.some(b => b.name === 'Planet Five')));
  await page.click('#eraBtn');
  await page.click('#eraMenu [data-era="3"]');
  ok('Eras jumps to Theia: it waits at the Earth\'s Lagrange point', await until(page, () => window.orbital.early.current.key === 'theia' && window.orbital.world.sources.some(b => b.name === 'Theia') && /Theia/.test(document.getElementById('eraName').textContent)));
  await page.evaluate(() => { window.orbital.early.age = 62.0001; });
  ok('Theia strikes the proto-Earth', await page.waitForFunction(() => !window.orbital.world.sources.some(b => b.name === 'Theia'), null, { timeout: 90000 }).then(() => true, () => false));
  await page.evaluate(() => window.orbital.loadPreset('solar'));

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
  ok('V opens the 3D view at real time', await page.evaluate(() => window.orbital.mode3d && Math.abs(window.orbital.warp * 31557600 - 1) < 1e-6 && !document.getElementById('c3').hidden && document.getElementById('modeBtn').textContent === '2D'));
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
  await page.keyboard.down('KeyS');
  ok('F leaves the helm, and you can walk the ship in the wormhole', await until(page, f => { const v = window.orbital.v3; return v.mode === 'walk' && v.foot.p.z > f + 0.5 && !!v.ship.worm; }, f0));
  await page.keyboard.up('KeyS');
  await page.evaluate(() => { const v = window.orbital.v3; v.foot.p.set(0, 0, -19.6); v.foot.yaw = 0; v.foot.pitch = -0.6; });
  ok('the helm is in reach', await until(page, () => window.orbital.v3.prompt?.label === 'Take the helm'));
  await page.keyboard.press('KeyF');
  ok('F takes the helm', await page.evaluate(() => window.orbital.v3.mode === 'pilot'));
  await page.waitForFunction(() => !window.orbital.v3.ship.worm, null, { timeout: 30000 });
  ok('the wormhole comes out at the Sun and drains the drive', await page.evaluate(() => window.orbital.v3.nearest().b?.name === 'Sun' && window.orbital.v3.ship.charge < 0.2));
  await page.keyboard.press('KeyO');
  // (held until it is going faster than light: frames can be slow in a software renderer)
  await page.keyboard.down('KeyW');
  ok('O overdrive flies faster than light', await until(page, () => Math.hypot(...window.orbital.v3.ship.nav.vel) > 3e8));
  await page.keyboard.up('KeyW');
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
  ok('the ship wears its model: the new hull, and its furniture in the way (an armchair in the commons)', await until(page, () => { const h = window.orbital.v3.ship.hull; return h.modelled && !h.canStand(-2.55, -6.75, 0.3, 0) && h.canStand(0, -2, 0.3, 0); }));
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
  // (each button held until what it does has happened: the pad is read once a frame, and frames can be slow)
  const hold = async (i, fn, v = 1) => {
    await page.evaluate(([i, v]) => { window.__pad.buttons[i].pressed = true; window.__pad.buttons[i].value = v; }, [i, v]);
    const r = await until(page, fn);
    await page.evaluate(i => { window.__pad.buttons[i].pressed = false; window.__pad.buttons[i].value = 0; }, i);
    await until(page, () => true);
    return r;
  };
  const q0 = await page.evaluate(() => window.orbital.v3.where());
  ok('the controller left stick flies', await until(page, p => { const q = window.orbital.v3.where(); return window.orbital.pad.connected && Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 0; }, q0));
  await page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; });
  ok('the controller View button opens the map', await hold(8, () => !document.querySelector('.nav3').hidden));
  await hold(1, () => document.querySelector('.nav3').hidden);
  await hold(15, () => !!window.orbital.selected);
  ok('B closes the map and the d-pad picks a target', await page.evaluate(() => document.querySelector('.nav3').hidden && window.orbital.v3.mode === 'pilot' && !!window.orbital.selected));
  ok('Menu goes back to 2D', await hold(9, () => !window.orbital.mode3d));
  await page.evaluate(() => { window.__s0 = window.orbital.view.scale; });
  ok('RT zooms the 2D map in', await hold(7, () => window.orbital.view.scale > window.__s0 * 1.5));
  ok('Menu steps back into 3D', await hold(9, () => window.orbital.mode3d));
  await page.evaluate(() => { window.__pad.connected = false; });
  await page.keyboard.press('KeyV');
  // (and the 3D picture is gone, not left frozen over the 2D view; the button offers 3D again)
  ok('V goes back to 2D', await until(page, () => !window.orbital.mode3d && getComputedStyle(document.getElementById('c3')).display === 'none' && document.getElementById('modeBtn').textContent === '3D'));
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
  ok('L lands', await page.waitForFunction(() => window.orbital.v3.landing?.phase === 'landed', null, { timeout: 150000 }).then(() => true, () => false));
  ok('each leg telescopes to the ground under it', await page.evaluate(() => window.orbital.v3.landing.reach.length === 6 && window.orbital.v3.landing.reach.every(r => r > 0.3 && r < 20)));
  await page.evaluate(() => { const v = window.orbital.v3; v.leaveHelm(); v.use('airlock'); });
  ok('the airlock lets you down the ladder onto the Moon', await page.evaluate(() => window.orbital.v3.mode === 'surface' && /On Moon/.test(window.orbital.v3.readout().where) && /0\.17 g · vacuum/.test(window.orbital.v3.readout().near)));
  await page.evaluate(() => window.orbital.v3.hangLamp());
  ok('a lamp hangs in the sky over where you stand', await until(page, () => { const v = window.orbital.v3, L = v.lights.lamps[0]; return v.lights.lamps.length === 1 && !!L && L.b.name === 'Moon' && v.lights.uniforms.lampPos.value[2].w > 0; }));
  ok('and can be sent north', await page.evaluate(() => { const v = window.orbital.v3, L = v.lights.lamps[0], la = L.toLat; v.lights.nudge(L, 'n'); return L.toLat > la; }));
  await page.evaluate(() => { const v = window.orbital.v3; v.lights.remove(v.lights.lamps[0]); });
  ok('Apollo 11 is found and logged', await until(page, () => window.orbital.v3.logbook.finds.some(f => /Apollo 11/.test(f.what))));
  const s0 = await page.evaluate(() => [...window.orbital.v3.surf.n]);
  await page.keyboard.down('KeyW');
  ok('W walks on the ground', await until(page, n => { const m = window.orbital.v3.surf.n; return Math.hypot(m[0] - n[0], m[1] - n[1], m[2] - n[2]) * 1737e3 > 1; }, s0));
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  ok('Space jumps, and in a sixth of a g you stay up', await until(page, () => window.orbital.v3.surf.y > 0.6));
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
  // a lava tube near Tranquility Base: in at its mouth, down its ramp under the ground, and its walls in the way
  const tube = await page.waitForFunction(() => {
    const v = window.orbital.v3, G = v.ground, q = [...G.forms.placed.values()].find(q => q.f.net), S = v.surf;
    if (!q) return null;
    const f = q.f, net = f.net, R = G.spec.R, at = (x, z) => { const m = [0, 1, 2].map(i => f.n[i] + (q.right[i] * x + q.back[i] * z) / R), l = Math.hypot(...m); return m.map(c => c / l); };
    // a couple of metres out from the mouth, facing down the ramp
    const a = net.nodes[0], b = net.nodes[Math.min(3, net.nodes.length - 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    S.n = at(a.x - dx / l * 2, a.z - dz / l * 2); S.foot = -Infinity; S.y = 0; S.vy = 0; S.pitch = 0;
    const fd = [0, 1, 2].map(i => q.right[i] * dx + q.back[i] * dz), n = S.n, e0 = [-n[1], n[0], 0], el = Math.hypot(e0[0], e0[1]), E = [e0[0] / el, e0[1] / el, 0];
    const N = [n[1] * E[2] - n[2] * E[1], n[2] * E[0] - n[0] * E[2], n[0] * E[1] - n[1] * E[0]];
    S.yaw = Math.atan2(-(fd[0] * E[0] + fd[1] * E[1] + fd[2] * E[2]), fd[0] * N[0] + fd[1] * N[1] + fd[2] * N[2]);
    v.placeSurf();
    return f.key;
  }, null, { timeout: 60000 }).then(h => h.jsonValue(), () => null);
  ok('a lava tube near Tranquility Base: its way in cut down into the ground', !!tube && await page.evaluate(() => { const G = window.orbital.v3.ground, q = [...G.forms.placed.values()].find(q => q.f.net); return G.forms.ramps().length > 0 && q.f.net.segs.some(s => !s.ramp); }));
  await page.keyboard.down('KeyW');
  ok('W walks down into it, under the ground', await page.waitForFunction(() => { const v = window.orbital.v3, S = v.surf; return !!S.inside && S.foot < v.ground.heightAt(S.n, 0.5) - 2.5; }, null, { timeout: 60000 }).then(() => true, () => false));
  await page.keyboard.up('KeyW');
  // turned to the wall and walking into it: you stay in the tunnel
  const f0 = await page.evaluate(() => { const S = window.orbital.v3.surf; S.yaw += Math.PI / 2; return S.foot; });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => /Solid rock/.test(document.body.textContent), null, { timeout: 20000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  ok('its walls are rock: you stay inside, on its floor', await page.evaluate(f0 => { const v = window.orbital.v3, S = v.surf; return !!S.inside && Math.abs(S.foot - f0) < 1.5 && S.foot < v.ground.heightAt(S.n, 0.5) - 2; }, f0));
  await page.evaluate(() => { const v = window.orbital.v3; v.surf.foot = -Infinity; v.surf.n = v.ladderFoot(); });
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

  if (await part('base')) {
  // a base: up the outpost's stairs and in, its consoles and monitors, a craft's camera on one, the hangar's rover
  await page.evaluate(() => { const a = window.orbital; a.loadPreset('earth'); a.select(a.world.sources.find(b => b.name === 'Earth')); });
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
  await page.evaluate(() => {
    const a = window.orbital, v = a.v3, b = a.world.sources.find(x => x.name === 'Earth'), c = v.fleet.crafts.find(q => q.name === 'Canaveral Base');
    const w = v.fleet.bodyPoint(c, new v.camera.position.constructor(0, 1500, 0)).applyQuaternion(window.__bodyQuat(b)), AU = 1.495978707e11;
    v.travel = null; v.ship.nav.anchor = b; v.ship.nav.off = [w.x / AU, w.y / AU, w.z / AU]; v.ship.nav.vel = [0, 0, 0];
  });
  await page.waitForFunction(() => window.orbital.v3.ground.ready, null, { timeout: 90000 }).catch(() => {});
  // hovering over the base, the ship turns with the Earth: the ground under it stays put (it used to slide past at 400 m/s)
  const overGround = () => page.evaluate(() => {
    const a = window.orbital, v = a.v3, b = a.world.sources.find(x => x.name === 'Earth'), n = v.ship.nav, A = n.anchor;
    const p = new v.camera.position.constructor(A.x + n.off[0] - b.x, A.y + n.off[1] - b.y, A.z + n.off[2] - b.z).applyQuaternion(window.__bodyQuat(b).invert()).normalize();
    return { p: [p.x, p.y, p.z], t: a.world.time * 31557600 };
  });
  const g0 = await overGround();
  await page.waitForFunction(t => window.orbital.world.time * 31557600 > t + 5, g0.t, { timeout: 60000 });
  const g1 = await overGround();
  ok('hovering, the ship keeps its place over the turning Earth', Math.hypot(g1.p[0] - g0.p[0], g1.p[1] - g0.p[1], g1.p[2] - g0.p[2]) * 6.371e6 < 5);
  // on foot at a point of the base (its frame, m), facing toward another
  const stand = (x, z, x2, z2, pitch = 0) => page.evaluate(([x, z, x2, z2, pitch]) => {
    const v = window.orbital.v3, f = v.fleet, c = f.crafts.find(q => q.name === 'Canaveral Base');
    const n = f.onBase(c, x, z), m = f.onBase(c, x2, z2), d = [m[0] - n[0], m[1] - n[1], m[2] - n[2]];
    const l = Math.hypot(n[0], n[1]), e = [-n[1] / l, n[0] / l, 0], nn = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
    v.toSurface(n, Math.atan2(-(d[0] * e[0] + d[1] * e[1] + d[2] * e[2]), d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]));
    v.surf.pitch = pitch;
  }, [x, z, x2, z2, pitch]);
  const local = () => page.evaluate(() => { const v = window.orbital.v3, f = v.fleet, c = f.crafts.find(q => q.name === 'Canaveral Base'), l = f.toLocal(c, v.surf.n); return { x: l.x, z: l.z, foot: v.surf.foot - f.level(c) }; });
  ok('the base\'s buildings are in', await page.waitForFunction(() => window.orbital.v3.fleet.crafts.find(q => q.name === 'Canaveral Base').mesh.children[0]?.userData.buildings?.every(h => !h.g.getObjectByName('stand-in')), null, { timeout: 60000 }).then(() => true, () => false));
  await stand(0, -10, 0, 0);
  await page.keyboard.down('KeyW');
  ok('W climbs the outpost\'s stairs to its floor, 1.6 m up', await page.waitForFunction(() => { const v = window.orbital.v3, f = v.fleet, c = f.crafts.find(q => q.name === 'Canaveral Base'); return v.surf.foot - f.level(c) > 1.55; }, null, { timeout: 60000 }).then(() => true, () => false), JSON.stringify(await local()));
  await page.keyboard.up('KeyW');
  ok('its walls stop you; its doorways do not', await page.evaluate(() => {
    const v = window.orbital.v3, f = v.fleet, c = f.crafts.find(q => q.name === 'Canaveral Base'), at = (x, z) => f.structureAt(c.b, f.onBase(c, x, z));
    return at(6.5, -1.75)?.solid === true && at(0, -6.1)?.solid === false && at(0, 3)?.solid === false && at(0, 0)?.solid === true && Math.abs(at(-1.5, -1.5).floor - f.level(c) - 1.6) < 0.05;
  }));
  await stand(-1.6, -1.6, 0, 0, -0.3);
  ok('the command table: Mission Control', await until(page, () => window.orbital.v3.prompt?.label === 'The command table: Mission Control'));
  await stand(6.6, -0.4, 6.6, 1, -0.2);
  ok('a console in the control room is a monitor', await until(page, () => /^The ship console: Mission Control, or a craft's camera on it/.test(window.orbital.v3.prompt?.label ?? '')));
  await page.keyboard.press('KeyF');
  ok('F there opens Mission Control, with a 📺 button for each craft', await until(page, () => !document.querySelector('.panel3').hidden && !!document.querySelector('button[data-act="feed"]')));
  const iss = await page.evaluate(() => window.orbital.v3.fleet.crafts.find(c => c.name === 'ISS').id);
  await page.click(`button[data-act="feed"][data-id="${iss}"]`);
  await page.keyboard.press('Escape');
  ok('📺 puts the ISS\'s camera on that console', await page.evaluate(id => { const f = window.orbital.v3.feeds; return f.showing(f.target) === id; }, iss));
  ok('and it is drawn while you look at it', await until(page, () => window.orbital.v3.feeds.drawn >= 2));
  await stand(0, -32, 0, -60);
  const d0 = await page.evaluate(() => window.orbital.v3.feeds.drawn);
  await page.waitForTimeout(1500);
  ok('but not while you are away from it', await page.evaluate(d => window.orbital.v3.feeds.drawn === d, d0));
  // the dome's growth lab: set up a chamber, sow, and (time run on) the harvest goes in the log
  await stand(-26.2, -0.9, -27.4, -1.65, -0.45);
  ok('the growth lab is in reach in the dome', await until(page, () => window.orbital.v3.prompt?.label === 'The growth lab: soils and plants'));
  await page.keyboard.press('KeyF');
  ok('F opens it, six chambers', await until(page, () => document.querySelectorAll('.panel3 button[data-act="gset"]').length === 6));
  await page.click('.panel3 button[data-act="gset"][data-id="0"]');
  await page.click('.panel3 button[data-act="gplant"][data-id="1"]');
  ok('a chamber is set up with a soil, its analysis, and a plant', await page.evaluate(() => /Soil: Potting soil/.test(document.querySelector('.panel3').textContent) && /Plant: Lettuce/.test(document.querySelector('.panel3').textContent) && /Nitrogen/.test(document.querySelector('.panel3').textContent)));
  await page.click('.panel3 button[data-act="gsow"]');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const v = window.orbital.v3, ch = v.growlab.chambers(v.growlab.base)[0]; ch.start -= 46 / (365.25 * 1440); });
  ok('it grows, and the harvest is logged', await until(page, () => window.orbital.v3.logbook.finds.some(f => /^Grown: Lettuce in Potting soil/.test(f.what) && /100% of what potting soil gives/.test(f.note))));
  ok('the chamber shows the plant', await page.evaluate(() => { const v = window.orbital.v3, c = v.fleet.crafts.find(q => q.name === 'Canaveral Base'); let n = 0; c.inside.group.getObjectByName('growlab').traverse(o => { if (o.isMesh && o.geometry.type === 'SphereGeometry') n++; }); return n >= 8; }));
  const s0 = await page.evaluate(() => { const v = window.orbital.v3; v.panels.show('growlab'); return v.fleet.crafts.find(q => q.name === 'Canaveral Base').stores ?? 90; });
  await page.click('.panel3 button[data-act="gclear"][data-id="0"]');
  ok('the harvest goes into the base\'s stores as food', await page.evaluate(s0 => { const c = window.orbital.v3.fleet.crafts.find(q => q.name === 'Canaveral Base'); return c.stores - s0 > 1.3 && c.stores - s0 < 1.6 && !window.orbital.v3.growlab.chambers(c.id)[0]; }, s0));
  await page.keyboard.press('Escape');
  await stand(28, -6, 28, 4, -0.2);
  ok('the hangar\'s rover stands in its bay', await page.evaluate(() => { const c = window.orbital.v3.fleet.crafts.find(q => q.name === 'Canaveral Base'), v = []; c.mesh.traverse(o => { if (o.name === 'hangar-rover') v.push(o.visible); }); return v.length > 3 && v.every(x => x); }));
  ok('the hangar\'s rover is in reach', await until(page, () => window.orbital.v3.prompt?.label === 'The rover: drive it out'));
  await page.keyboard.press('KeyF');
  ok('F drives it out of the hangar', await until(page, () => window.orbital.v3.mode === 'craft' && window.orbital.v3.fleet.crafts.some(c => c.kind === 'rover' && /rover/.test(c.name))));
  // (the hangar's own rover: its pieces of the model, there in the bay until it drives out)
  const parked = () => { const c = window.orbital.v3.fleet.crafts.find(q => q.name === 'Canaveral Base'), out = []; c.mesh.traverse(o => { if (o.name === 'hangar-rover') out.push(o.visible); }); return out; };
  ok('the hangar\'s bay is empty while its rover is out', await until(page, p => { const v = eval(p)(); return v.length > 3 && v.every(x => !x); }, `(${parked})`));
  // modules beside the base: room and food
  ok('a greenhouse, an ice drill, a habitat and silos built beside the base give it room and food', await page.evaluate(() => {
    const v = window.orbital.v3, f = v.fleet, c = f.crafts.find(q => q.name === 'Canaveral Base'), r0 = f.room(c);
    for (const [k, x, z] of [['greenhouse', -20, 50], ['drill', 25, 52], ['habitat', 70, 0], ['silo', -70, 0]]) { const m = f.build(k, c.b, f.onBase(c, x, z), c.head); m.build = 0.999; }
    f.step(0.1);
    const r1 = f.room(c);
    return r1.crew === r0.crew + 6 && r1.stores === r0.stores + 180 && Math.abs(r1.food - r0.food - 0.6) < 1e-9 && f.crafts.filter(m => m.base === c.id).every(m => /^working for Canaveral Base/.test(m.status));
  }));
  ok('they feed its crew: its stores fall slower', await page.evaluate(() => { const f = window.orbital.v3.fleet, c = f.crafts.find(q => q.name === 'Canaveral Base'), s0 = c.stores, crew = c.crew ?? 6; f.live(10); return Math.abs(c.stores - (s0 - 10 * crew / 6 + 10 * f.room(c).food)) < 1e-3; }));
  ok('a module stands in the way', await page.evaluate(() => { const v = window.orbital.v3, f = v.fleet, c = f.crafts.find(q => q.name === 'Canaveral Base'), g = f.crafts.find(m => m.kind === 'greenhouse' && m.base === c.id); return !!f.structureAt(c.b, g.n)?.solid; }));
  clean('base');
  }

  if (await part('rocket')) {
  // the rockets: beside the Wayfarer on Canaveral's pad, load it, ride it to the base; the Mammoth up to the ISS
  await page.evaluate(() => { const a = window.orbital; a.loadPreset('earth'); a.select(a.world.sources.find(b => b.name === 'Earth')); });
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.orbital.v3?.active, null, { timeout: 30000 });
  await page.evaluate(() => {
    const a = window.orbital, v = a.v3, b = a.world.sources.find(x => x.name === 'Earth'), c = v.fleet.crafts.find(q => q.name === 'Canaveral Base');
    const w = v.fleet.bodyPoint(c, new v.camera.position.constructor(0, 1500, 0)).applyQuaternion(window.__bodyQuat(b)), AU = 1.495978707e11;
    v.travel = null; v.ship.nav.anchor = b; v.ship.nav.off = [w.x / AU, w.y / AU, w.z / AU]; v.ship.nav.vel = [0, 0, 0];
  });
  await page.waitForFunction(() => window.orbital.v3.ground.ready, null, { timeout: 90000 }).catch(() => {});
  // gravity on the ship: the engines hold it against the Earth's pull; off, it falls
  ok('the engines hold the ship against a g', await until(page, () => { const v = window.orbital.v3; return v.mode === 'pilot' && /holding against 1\.\d\d g/.test(v.readout().drive); }));
  const alt0 = await page.evaluate(() => { const v = window.orbital.v3; v.toggleCoast(); return v.nearest().alt; });
  ok('engines off, it falls', await page.waitForFunction(a0 => { const v = window.orbital.v3, n = v.ship.nav, o = n.off, r = Math.hypot(...o); return a0 - v.nearest().alt > 20 && (n.vel[0] * o[0] + n.vel[1] * o[1] + n.vel[2] * o[2]) / r < -5; }, alt0, { timeout: 60000 }).then(() => true, () => false));
  // (and with the clock sped up, it falls in the sandbox's time: a minute a second, sixty times as fast)
  ok('engines off, it falls in the sandbox\'s time, the time cheat too', await page.evaluate(async () => {
    const v = window.orbital.v3, a = window.orbital, n = v.ship.nav, w0 = a.warpLog, off0 = [...n.off];
    // (a thousand kilometres up, so it is still falling, not stopped on the ground, after a while)
    const R = n.anchor.r * 1.495978707e11, l = Math.hypot(...n.off); n.off = n.off.map(x => x / l * (R + 1e6) / 1.495978707e11);
    n.vel = [0, 0, 0]; a.warpLog = Math.log10(60 / (365.25 * 86400));
    const f0 = a.frameNo;
    while (a.frameNo < f0 + 4) await new Promise(r => setTimeout(r, 50));
    const o = n.off, r = Math.hypot(...o), vr = -(n.vel[0] * o[0] + n.vel[1] * o[1] + n.vel[2] * o[2]) / r, frames = a.frameNo - f0;
    a.warpLog = w0; n.off = off0; n.vel = [0, 0, 0];
    // (a frame is never more than a tenth of a second of real time: at 60 times that, well over what real time would give)
    return vr > 9.8 * 0.1 * frames * 10;
  }));
  await page.evaluate(() => { const v = window.orbital.v3; v.toggleCoast(); v.ship.nav.vel = [0, 0, 0]; });
  ok('the spaceports start with a rocket on each pad', await page.evaluate(() => { const f = window.orbital.v3.fleet; return ['Canaveral Launch Pad', 'Baikonur Launch Pad'].every(n => !!f.rocketAt(f.crafts.find(c => c.name === n))); }));
  await page.evaluate(() => { const v = window.orbital.v3, f = v.fleet, c = f.crafts.find(x => x.rocket?.kind === 'wayfarer'); v.toSurface(f.offset(c.n, 7, c.head + Math.PI / 2, c.b.r * 1.495978707e11), c.head - Math.PI / 2); });
  ok('beside it, it can be flown', await until(page, () => /^The Wayfarer 1: load it, fly it, ride it/.test(window.orbital.v3.prompt?.label ?? '')));
  ok('its doors and hatches open as you come up to it', await page.waitForFunction(() => window.orbital.v3.fleet.crafts.find(x => x.rocket?.kind === 'wayfarer').rocket.doors >= 1, null, { timeout: 30000 }).then(() => true, () => false));
  // inside it: in through its airlock, up its ladders, out again
  await page.keyboard.press('KeyF');
  await page.waitForSelector('.panel3 button[data-act="rinside"]', { timeout: 30000 });
  await page.click('.panel3 button[data-act="rinside"]');
  ok('you can go inside it, into its service bay', await until(page, () => window.orbital.v3.mode === 'inside' && window.orbital.v3.visit.room() === 'Service bay'));
  await page.keyboard.down('KeyW');
  ok('you walk about its deck', await page.waitForFunction(() => window.orbital.v3.visit.at.p.z < 0.7, null, { timeout: 30000 }).then(() => true, () => false));
  await page.keyboard.up('KeyW');
  ok('the crates are in the way', await page.evaluate(() => { const I = window.orbital.v3.visit.at.I, V = window.orbital.v3.camera.position.constructor; return !I.canBe(new V(-1.07, 7.28, -0.55), 0.3) && I.canBe(new V(0, 7.28, 1), 0.3); }));
  ok('its ladder goes up', await until(page, () => /^Climb up to the passenger cabin/.test(window.orbital.v3.prompt?.label ?? '')));
  await page.keyboard.press('KeyF');
  ok('up into the passenger cabin, and on to the flight deck', await until(page, () => window.orbital.v3.visit.room() === 'Passenger cabin') && await page.evaluate(() => { const v = window.orbital.v3; v.visit.use('r-up:1', v.visit.at.c); return v.visit.room() === 'Flight deck'; }));
  ok('the pilot\'s seat is where it is flown from', await page.evaluate(() => { const v = window.orbital.v3; v.visit.use('r-pilot', v.visit.at.c); const ok = !!document.querySelector('.panel3 button[data-act="rfly"]'); v.panels.close(); return ok; }));
  ok('down the ladders and out of the airlock, beside it', await page.evaluate(() => {
    const v = window.orbital.v3, c = v.visit.at.c;
    v.visit.use('r-down:2', c); v.visit.use('r-down:1', c);
    if (v.visit.room() !== 'Service bay') return false;
    v.visit.use('r-out:0', c);
    const d = Math.acos(Math.min(1, c.n[0] * v.surf.n[0] + c.n[1] * v.surf.n[1] + c.n[2] * v.surf.n[2])) * c.b.r * 1.495978707e11;
    return v.mode === 'surface' && d > 3 && d < 8;
  }));
  ok('each rocket\'s decks, from its model', await page.evaluate(async () => {
    const { rocketInterior } = await import('/src/three/rocketry.ts'), { load } = await import('/src/three/models.ts');
    const n = [];
    for (const k of ['courier', 'wayfarer', 'mammoth']) { const m = await load(`rocket-${k}`), I = rocketInterior(m, k); n.push(I.discs.length, I.spots.filter(s => s.id.startsWith('r-out')).length, I.spots.filter(s => s.id === 'r-crate').length); }
    return n.join() === '2,1,2,3,2,2,3,2,8';
  }));
  await until(page, () => /^The Wayfarer 1/.test(window.orbital.v3.prompt?.label ?? ''));
  await page.keyboard.press('KeyF');
  ok('F opens its panel: load and destinations', await until(page, () => !!document.querySelector('.panel3 button[data-act="rfly"]')));
  for (const sel of ['button[data-act="rcrew"][data-id="1"]', 'button[data-act="rcrew"][data-id="1"]', 'button[data-act="rsup"][data-id="1"]']) await page.click(`.panel3 ${sel}`);
  if (!(await page.evaluate(() => /Aboard/.test(document.querySelector('.panel3 button[data-act="rride"]').textContent)))) await page.click('.panel3 button[data-act="rride"]');
  const base = await page.evaluate(() => window.orbital.v3.fleet.crafts.find(c => c.name === 'Canaveral Base').id);
  await page.click(`.panel3 button[data-act="rfly"][data-id="${base}"]`);
  ok('it lifts off with you aboard, watching it', await until(page, () => { const v = window.orbital.v3, c = v.fleet.crafts.find(x => x.rocket?.kind === 'wayfarer'); return c.state === 'flight' && c.rocket.aboard && v.mode === 'craft'; }));
  ok('on its plume', await until(page, () => window.orbital.v3.fleet.crafts.find(x => x.rocket?.kind === 'wayfarer').mesh.getObjectByName('plume').visible));
  ok('shut for the flight', await page.waitForFunction(() => window.orbital.v3.fleet.crafts.find(x => x.rocket?.kind === 'wayfarer').rocket.doors === 0, null, { timeout: 30000 }).then(() => true, () => false));
  ok('riding, you look out from the cockpit', await page.evaluate(() => window.orbital.v3.craftView?.seat === 'cockpit'));
  const seats = [];
  for (let k = 0; k < 3; k++) { await page.keyboard.press('KeyZ'); seats.push(await page.evaluate(() => window.orbital.v3.craftView?.seat)); }
  ok('Z goes to the cabin, outside, and back to the cockpit', seats.join() === 'cabin,out,cockpit', seats.join());
  // (most of the flight run on: it is shown at its own pace, slow in a software renderer)
  await page.evaluate(() => { const r = window.orbital.v3.fleet.crafts.find(x => x.rocket?.kind === 'wayfarer').rocket.trip; r.t = r.Ta + r.Tc + r.Td - 1; });
  ok('it lands on the base\'s pad and you climb out beside it', await page.waitForFunction(() => window.orbital.v3.mode === 'surface', null, { timeout: 60000 }).then(() => true, () => false));
  // (its stores have been eaten into while the test ran: a day a minute)
  ok('its crew and supplies are the base\'s now', await page.evaluate(() => { const c = window.orbital.v3.fleet.crafts.find(x => x.name === 'Canaveral Base'); return c.crew === 8 && c.stores > 105 && c.stores <= 120; }));
  ok('a crew eats into its stores: eight a little faster than six', await page.evaluate(() => { const v = window.orbital.v3, c = v.fleet.crafts.find(x => x.name === 'Canaveral Base'), s0 = c.stores; v.fleet.live(3); return Math.abs(s0 - c.stores - 4) < 1e-6; }));
  ok('it can fly back where it came from, or run there and back', await page.evaluate(() => {
    const v = window.orbital.v3, f = v.fleet, w = f.crafts.find(x => x.rocket?.kind === 'wayfarer'), pad = f.crafts.find(x => x.name === 'Canaveral Launch Pad'), base = f.crafts.find(x => x.name === 'Canaveral Base');
    if (w.rocket.home !== pad.id) return false;
    if (f.runRoute(w, pad) !== '' || !w.rocket.route) return false;
    // (the leg run on to its end, the turnaround skipped)
    w.rocket.trip.t = w.rocket.trip.Ta + w.rocket.trip.Tc + w.rocket.trip.Td; f.step(0.01);
    if (w.rocket.at !== pad.id) return false;
    w.rocket.route.wait = 0; f.step(0.01);
    const back = w.rocket.trip?.to.site === base.id;
    f.stopRoute(w);
    return back && !w.rocket.route;
  }));
  ok('the Mammoth flies up to the ISS and docks', await page.evaluate(() => {
    const v = window.orbital.v3, f = v.fleet, m = f.crafts.find(x => x.rocket?.kind === 'mammoth'), iss = f.crafts.find(x => x.name === 'ISS');
    m.rocket.load.supplies = 2;
    if (f.fly(m, iss)) return false;
    const tr = m.rocket.trip; tr.t = tr.Ta + tr.Tc + tr.Td + 0.1;
    f.step(0.01);
    return m.rocket.docked && iss.stores > 135 && iss.stores <= 150 && f.local(m).distanceTo(f.local(iss)) < 200;
  }));
  ok('and from the station on to a pad on the Moon: a flight between worlds', await page.evaluate(() => {
    const v = window.orbital.v3, f = v.fleet, m = f.crafts.find(x => x.rocket?.kind === 'mammoth'), moon = window.orbital.world.sources.find(b => b.name === 'Moon');
    const pad = f.build('pad', moon, [0.0, 0.0, 1.0].map((x, k) => [Math.cos(0.3), 0, Math.sin(0.3)][k]), 0); pad.build = 1;
    if (f.fly(m, pad)) return false;
    const tr = m.rocket.trip, out = [!tr.hop && tr.Ta === 0 && tr.Td > 0];
    tr.t = tr.Ta + tr.Tc * 0.75; f.step(0.01); out.push(m.b === moon && m.state === 'flight');
    tr.t = tr.Ta + tr.Tc + tr.Td + 0.1; f.step(0.01); out.push(m.state === 'surface' && m.b === moon && f.rocketAt(pad) === m);
    return out.every(Boolean);
  }));
  // a station's inside, from Mission Control: Dock flies the ship there, Go aboard steps in
  await page.evaluate(() => { const v = window.orbital.v3; v.toSurface(v.surf.n, 0); v.landing = null; v.mode = 'pilot'; v.panels.show('mission'); });
  const iss = await page.evaluate(() => window.orbital.v3.fleet.crafts.find(c => c.name === 'ISS').id);
  await page.click(`.panel3 button[data-act="cdock"][data-id="${iss}"]`);
  ok('Dock in Mission Control flies the ship to a station to dock', await page.evaluate(() => window.orbital.v3.travel?.dock?.name === 'ISS'));
  // (the station is going round the Earth at 7.7 km/s: the ship has to catch it up, not just fly to where it was)
  ok('the ship catches the station up and docks', await page.waitForFunction(() => window.orbital.v3.visit.docked?.name === 'ISS', null, { timeout: 150000 }).then(() => true, () => false));
  ok('docked, the helm offers to undock (L), not F', await until(page, () => window.orbital.v3.mode === 'pilot' && window.orbital.v3.prompt?.label === 'Undock from ISS'));
  await page.keyboard.press('KeyF');
  ok('F leaves the helm and the ship stays docked, to walk to the airlock', await until(page, () => window.orbital.v3.mode === 'walk' && window.orbital.v3.visit.docked?.name === 'ISS'));
  await page.evaluate(() => window.orbital.v3.panels.show('mission'));
  await page.click(`.panel3 button[data-act="cdock"][data-id="${iss}"]`);
  ok('docked, Go aboard takes you inside it', await until(page, () => window.orbital.v3.mode === 'inside' && window.orbital.v3.visit.docked?.name === 'ISS'));
  ok('a rocket can be stacked on a free pad', await page.evaluate(() => { const f = window.orbital.v3.fleet, pad = f.crafts.find(c => c.name === 'Canaveral Launch Pad'); const c = f.stack('courier', pad); return typeof c !== 'string' && c.state === 'surface' && c.build === 0; }));
  clean('rocket');
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
  // into it: through the horizon there is no way back, down to the singularity, and out again by the game's grace
  ok('through a black hole\'s horizon, you fall in', await page.evaluate(() => {
    const a = window.orbital, v = a.v3, b = a.selected, G = (0.01720209895 * 365.25) ** 2, C = 299792458 * 365.25 * 86400 / 1.495978707e11, rs = 2 * G * b.m / (C * C);
    v.mode = 'pilot'; v.travel = null; v.ship.nav.anchor = b; v.ship.nav.off = [0.97 * rs, 0, 0]; v.ship.nav.vel = [0, 0, 0];
    return true;
  }) && await until(page, () => { const v = window.orbital.v3; return !!v.fall && /inside the horizon/.test(v.readout().drive); }));
  ok('and at the singularity you are put back outside', await page.evaluate(() => { const v = window.orbital.v3; v.fall.t = v.fall.dur; return true; }) && await until(page, () => { const a = window.orbital, v = a.v3, b = a.selected, p = v.where(); return !v.fall && v.logbook.finds.some(f => /singularity/.test(f.what)) && Math.hypot(p[0] - b.x, p[1] - b.y, p[2] - b.z) > 30 * b.r; }));
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
