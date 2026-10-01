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

  for (const key of ['inner', 'earth', 'saturn', 'trappist', 'kepler16', 'theia', 'ringmaker', 'xrb', 'kirkwood', 'sgra', 'merger', 'solar']) {
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
