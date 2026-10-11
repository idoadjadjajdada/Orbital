// The notes app (public/notes/index.html) on a phone, with GitHub mocked: nothing here reaches
// api.github.com or the CDN. `node tests/notes-app.mjs` (CHROMIUM_PATH picks the browser,
// NOTES_PORT the port, SHOTS=dir saves a picture of the Add and Edit pages).
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = +(process.env.NOTES_PORT || 4191);
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const launch = {};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? '  ok  ' : 'FAIL  '}${name}${extra ? `  [${extra}]` : ''}`); };
const until = (pg, fn, arg) => pg.waitForFunction(fn, arg, { timeout: 8000 }).then(() => true, () => false);
const BUGS = '# Bugs\n\n## Open\n- [ ] old thing\n\n## Known limits\n';

/** a phone page on the notes app; `writes` collects every POST and PATCH sent to GitHub */
async function phone(hash, { withToken = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  if (withToken) await ctx.addInitScript(() => localStorage.setItem('orbital-notes-token', 'x'));
  const writes = [], errs = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
  await ctx.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: /purify/.test(r.request().url()) ? 'window.DOMPurify={sanitize:x=>x}' : 'window.marked={parse:t=>"<p>"+t+"</p>"}' }));
  await ctx.route('https://api.github.com/**', r => {
    const q = r.request(), url = q.url(), m = q.method();
    const json = o => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (m === 'POST' || m === 'PATCH') { writes.push({ method: m, url, body: q.postDataJSON() }); return json({ sha: 'x' }); }
    if (url.includes('/git/ref/')) return json({ object: { sha: 'h1' } });
    if (url.includes('/git/commits/')) return json({ tree: { sha: 't1' } });
    if (url.includes('/git/trees/')) return json({ tree: [{ type: 'blob', path: 'notes/Bugs.md', sha: 'b1' }] });
    if (url.includes('/git/blobs/')) return json({ content: Buffer.from(BUGS).toString('base64') });
    if (url.endsWith('/user')) return json({ login: 'owner' });
    return r.fulfill({ status: 404, headers: cors, body: 'not mocked' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}/notes/index.html${hash}`);
  return { page, ctx, writes, errs };
}
/** the text of each blob posted, decoded */
const blobs = writes => writes.filter(w => w.method === 'POST' && w.url.endsWith('/git/blobs')).map(w => Buffer.from(w.body.content, 'base64').toString('utf8'));

try {
  // 1. Add with no token keeps what was typed: it is back in the form once the token is saved
  {
    const { page, ctx, writes, errs } = await phone('#/add');
    await page.waitForSelector('#msg');
    await page.fill('#msg', 'The rover flips over');
    await page.fill('#where', 'Mars, Jezero');
    await page.tap('#go');
    ok('no token: Add goes to Settings', await until(page, () => location.hash === '#/settings' && !!document.querySelector('#tok')));
    ok('no token: nothing is written', writes.length === 0, `${writes.length} writes`);
    await page.fill('#tok', 'x');
    await page.tap('#saveTok');
    const back = await until(page, () => location.hash === '#/add' && document.querySelector('#msg')?.value === 'The rover flips over' && document.querySelector('#where')?.value === 'Mars, Jezero');
    ok('no token: after saving the token the typed message is back', back);
    if (back) {
      await page.tap('#go');
      ok('no token: then it is added', await until(page, () => location.hash === '#/n/notes%2FBugs.md'));
      ok('no token: the bug is in Bugs.md', blobs(writes).some(t => t.includes('- [ ] The rover flips over · Mars, Jezero (')));
    }
    ok('no token: no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  // 1b. Saving an edit with no token keeps the edited text on the page
  {
    const { page, ctx, writes } = await phone('#/edit/notes%2FBugs.md');
    await page.waitForSelector('#ed');
    await page.fill('#ed', 'my unsaved edit');
    await page.tap('#save');
    ok('no token: Save says a token is needed', await until(page, () => [...document.querySelectorAll('.toast')].some(t => /token/i.test(t.textContent))));
    ok('no token: the edit stays on the page', await page.evaluate(() => location.hash === '#/edit/notes%2FBugs.md' && document.querySelector('#ed')?.value === 'my unsaved edit'));
    ok('no token: nothing is written by Save', writes.length === 0, `${writes.length} writes`);
    await ctx.close();
  }
  // 2. The floating + Add is not over Add, Edit or Settings, where it would throw away what is typed
  {
    const { page, ctx } = await phone('#/edit/notes%2FBugs.md', { withToken: true });
    await page.waitForSelector('#ed');
    await page.fill('#ed', 'my unsaved edit');
    const shown = () => page.evaluate(() => !document.querySelector('#addBtn').hidden && getComputedStyle(document.querySelector('#addBtn')).display !== 'none');
    ok('+ Add is not shown on Edit', !(await shown()));
    if (await shown()) {
      await page.tap('#addBtn');
      await page.waitForFunction(() => location.hash === '#/add');
      await page.goBack();
      await page.waitForSelector('#ed');
      ok('the edit is still there after + Add and Back', await page.evaluate(() => document.querySelector('#ed').value === 'my unsaved edit'));
    }
    for (const [h, sel, want] of [['#/add', '#msg', false], ['#/settings', '#tok', false], ['#/', '.tiles', true], ['#/n/notes%2FBugs.md', '.md', true]]) {
      await page.evaluate(x => { location.hash = x; }, h);
      await page.waitForSelector(sel);
      ok(`+ Add is ${want ? '' : 'not '}shown on ${h}`, (await shown()) === want);
    }
    await ctx.close();
  }
  // 3. Every text field is at least 16 px, so iOS does not zoom the page when one is focused
  {
    const { page, ctx } = await phone('#/add', { withToken: true });
    const px = sel => page.evaluate(x => parseFloat(getComputedStyle(document.querySelector(x)).fontSize), sel);
    await page.waitForSelector('#msg');
    for (const sel of ['#msg', '#where']) ok(`${sel} is at least 16 px`, (await px(sel)) >= 16, `${await px(sel)} px`);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/notes-add.png` });
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.waitForSelector('#tok');
    ok('#tok is at least 16 px', (await px('#tok')) >= 16, `${await px('#tok')} px`);
    await page.evaluate(() => { location.hash = '#/edit/notes%2FBugs.md'; });
    await page.waitForSelector('#ed');
    ok('#ed is at least 16 px', (await px('#ed')) >= 16, `${await px('#ed')} px`);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/notes-edit.png` });
    await ctx.close();
  }
} catch (e) { fails++; console.log(`FAIL  ${e.stack || e}`); }
await browser.close();
await server.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
