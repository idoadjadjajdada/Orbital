const { chromium } = require('playwright');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

let fails=0;
const ok=(n,c,x='')=>{ if(!c) fails++; console.log((c?'  ok  ':'FAIL  ')+n+(x?'  ['+x+']':'')); };

async function open(b, vp){
  const ctx=await b.newContext({viewport:vp||{width:1200,height:820},deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
  await p.goto(URL); await p.waitForTimeout(500);
  return {p,ctx,errs};
}
(async()=>{
  const b=await chromium.launch(LAUNCH);

  console.log('\n--- it boots ---');
  let {p,ctx,errs}=await open(b);
  ok('no exceptions', errs.length===0, errs.join(' | '));
  ok('the default system is populated', await p.evaluate(()=>window.orbital.count())>5,
     String(await p.evaluate(()=>window.orbital.count())));
  ok('a scripting hook is exposed', await p.evaluate(()=>typeof window.orbital.energy==='function'));
  for(const n of ['binary','solar','rings','cluster']){
    await p.locator(`[data-preset="${n}"]`).click();
    await p.waitForTimeout(350);
    ok(`preset ${n} loads`, await p.evaluate(()=>window.orbital.count())>1,
       String(await p.evaluate(()=>window.orbital.count())));
  }
  ok('still no exceptions after every preset', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- the integrator holds an orbit ---');
  ({p,ctx,errs}=await open(b));
  const orbitDrift = await p.evaluate(async()=>{
    const o=window.orbital;
    o.clear();
    o.add(0,0,0,0,'star');
    /* circular velocity for r = 200 about a 1400 mass: v = sqrt(GM/r) */
    const r=200, v=Math.sqrt(1400/r);
    const id=o.add(r,0,0,v,'moon');
    const radius=()=>{ const b=o.list().find(q=>q.id===id); return Math.hypot(b.x,b.y); };
    const r0=radius();
    let min=r0, max=r0;
    /* 4000 steps at 1/60 is a bit over a minute of simulated time */
    for(let i=0;i<4000;i++){ window.orbital.step(1/60); const rr=radius(); if(rr<min)min=rr; if(rr>max)max=rr; }
    return {r0, min, max, drift: Math.max(Math.abs(max-r0), Math.abs(r0-min))/r0};
  });
  ok('a circular orbit stays circular over a simulated minute', orbitDrift.drift < 0.03,
     'radius '+orbitDrift.min.toFixed(1)+'–'+orbitDrift.max.toFixed(1)+' from '+orbitDrift.r0.toFixed(1));

  const energyDrift = await p.evaluate(async()=>{
    const o=window.orbital;
    o.clear();
    o.add(0,0,0,0,'star');
    const r=200, v=Math.sqrt(1400/r);
    o.add(r,0,0,v,'planet');
    o.add(-330,0,0,-Math.sqrt(1400/330),'moon');
    const e0=o.energy();
    for(let i=0;i<4000;i++) window.orbital.step(1/60);
    return Math.abs((o.energy()-e0)/e0);
  });
  ok('total energy is conserved to within a fraction of a percent', energyDrift < 0.005,
     'drift '+(energyDrift*100).toFixed(3)+'%');
  await ctx.close();

  console.log('\n--- collisions merge ---');
  ({p,ctx,errs}=await open(b));
  const m = await p.evaluate(async()=>{
    const o=window.orbital;
    o.clear();
    o.add(-60,0, 6,0,'planet');
    o.add( 60,0,-6,0,'planet');
    const p0=o.momentum(), n0=o.count();
    for(let i=0;i<900;i++) window.orbital.step(1/60);
    const p1=o.momentum();
    return {n0, n1:o.count(), list:o.list(),
            px0:p0.x, px1:p1.x, py0:p0.y, py1:p1.y};
  });
  ok('two bodies become one', m.n0===2 && m.n1===1, m.n0+' -> '+m.n1);
  ok('mass adds up', Math.abs(m.list[0].m - 36) < 1e-6, String(m.list[0].m));
  ok('momentum is conserved through the merge',
     Math.abs(m.px1-m.px0) < 1e-6 && Math.abs(m.py1-m.py0) < 1e-6,
     `${m.px0.toFixed(4)} -> ${m.px1.toFixed(4)}`);
  await ctx.close();

  console.log('\n--- flinging a body ---');
  ({p,ctx,errs}=await open(b));
  await p.evaluate(()=>window.orbital.clear());
  await p.waitForTimeout(120);
  const box = await p.locator('#c').boundingBox();
  const cx = box.x + box.width/2, cy = box.y + box.height/2;
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx+120, cy, {steps:8});
  await p.waitForTimeout(120);
  ok('a prediction path is drawn while aiming',
     await p.evaluate(()=>!!(window.orbital.aim && window.orbital.aim.active && window.orbital.aim.path.length>4)));
  await p.mouse.up();
  await p.waitForTimeout(150);
  const flung = await p.evaluate(()=>window.orbital.list());
  ok('the drag creates exactly one body', flung.length===1, String(flung.length));
  ok('and it moves in the direction dragged', flung[0] && flung[0].vx > 0.5 && Math.abs(flung[0].vy) < 0.5,
     flung[0] ? `v = (${flung[0].vx.toFixed(2)}, ${flung[0].vy.toFixed(2)})` : 'none');
  await ctx.close();

  console.log('\n--- auto-orbit assist ---');
  ({p,ctx,errs}=await open(b));
  const assisted = await p.evaluate(async()=>{
    const o=window.orbital;
    o.clear(); o.add(0,0,0,0,'star');
    return null;
  });
  ok('assist is on by default', await p.locator('#orbitAssist').evaluate(e=>e.classList.contains('on')));
  const b2 = await p.locator('#c').boundingBox();
  /* a tap, no drag, a good way out from the star at screen centre */
  await p.mouse.click(b2.x + b2.width/2 + 190, b2.y + b2.height/2);
  await p.waitForTimeout(200);
  const orbiting = await p.evaluate(async()=>{
    const o=window.orbital;
    const moon = o.list().find(q=>q.m < 1000);
    if(!moon) return null;
    const rad = ()=>{ const q=o.list().find(z=>z.id===moon.id); return q ? Math.hypot(q.x,q.y) : null; };
    const r0 = rad();
    let min=r0, max=r0;
    for(let i=0;i<2400;i++){ window.orbital.step(1/60); const r=rad(); if(r===null) return {lost:true}; if(r<min)min=r; if(r>max)max=r; }
    return {r0, min, max, ecc:(max-min)/(max+min)};
  });
  ok('a tap drops the body into a near-circular orbit',
     orbiting && !orbiting.lost && orbiting.ecc < 0.06,
     orbiting ? (orbiting.lost ? 'body was lost' : 'eccentricity '+orbiting.ecc.toFixed(3)) : 'nothing created');
  await ctx.close();

  console.log('\n--- selecting, following, deleting ---');
  ({p,ctx,errs}=await open(b));
  await p.evaluate(()=>{ const o=window.orbital; o.clear(); o.add(0,0,0,0,'star'); o.add(200,0,0,Math.sqrt(1400/200),'planet'); });
  await p.waitForTimeout(200);
  await p.evaluate(()=>window.orbital.select(window.orbital.list()[1].id));
  await p.waitForTimeout(250);
  ok('the inspector opens', await p.locator('#insp').evaluate(e=>e.classList.contains('on')));
  ok('it names what the body orbits', (await p.locator('#ispHost').textContent())==='Star',
     await p.locator('#ispHost').textContent());
  ok('it reports a bound orbit, not an escape',
     !/escap/i.test(await p.locator('#ispPer').textContent()), await p.locator('#ispPer').textContent());
  await p.locator('#ispDel').click();
  await p.waitForTimeout(200);
  ok('delete removes it', await p.evaluate(()=>window.orbital.count())===1);
  ok('and closes the inspector', !await p.locator('#insp').evaluate(e=>e.classList.contains('on')));
  await ctx.close();

  console.log('\n--- camera ---');
  ({p,ctx,errs}=await open(b));
  const z0 = await p.evaluate(()=>window.orbital.cam.zoom);
  await p.mouse.move(600,400);
  await p.mouse.wheel(0,-600);
  await p.waitForTimeout(150);
  const z1 = await p.evaluate(()=>window.orbital.cam.zoom);
  ok('the wheel zooms in', z1 > z0*1.05, z0.toFixed(3)+' -> '+z1.toFixed(3));
  await p.mouse.wheel(0,1200);
  await p.waitForTimeout(150);
  ok('and back out', await p.evaluate(()=>window.orbital.cam.zoom) < z1, 'ok');
  await p.locator('#fit').click();
  await p.waitForTimeout(200);
  ok('Fit frames the system', await p.evaluate(()=>{
    const o=window.orbital, l=o.list();
    if(!l.length) return false;
    /* every body should land inside the viewport after a fit */
    return l.every(b=>{
      const sx=(b.x-o.cam.x)*o.cam.zoom + 600, sy=(b.y-o.cam.y)*o.cam.zoom + 410;
      return sx>-40 && sx<1240 && sy>-40 && sy<860;
    });
  }));
  await ctx.close();

  console.log('\n--- touch: two fingers pinch and pan ---');
  ({p,ctx,errs}=await open(b, {width:1024,height:768}));
  const before = await p.evaluate(()=>({z:window.orbital.cam.zoom, x:window.orbital.cam.x}));
  /* The preset seeds a random number of moons, so compare against itself. */
  const nBefore = await p.evaluate(()=>window.orbital.count());
  await p.evaluate(()=>{
    const c=document.getElementById('c');
    const pd=(id,x,y,t)=>c.dispatchEvent(new PointerEvent(t,{pointerId:id,clientX:x,clientY:y,bubbles:true,pointerType:'touch'}));
    c.setPointerCapture = ()=>{};
    pd(1,400,400,'pointerdown'); pd(2,600,400,'pointerdown');
    pd(1,300,400,'pointermove'); pd(2,700,400,'pointermove');
    pd(1,300,400,'pointerup');   pd(2,700,400,'pointerup');
  });
  await p.waitForTimeout(200);
  const after = await p.evaluate(()=>({z:window.orbital.cam.zoom, x:window.orbital.cam.x}));
  ok('spreading two fingers zooms in', after.z > before.z*1.4,
     before.z.toFixed(3)+' -> '+after.z.toFixed(3));
  ok('a two-finger gesture creates no bodies', await p.evaluate(()=>window.orbital.count())===nBefore,
     nBefore+' -> '+await p.evaluate(()=>window.orbital.count()));
  await ctx.close();

  console.log('\n--- keyboard ---');
  ({p,ctx,errs}=await open(b));
  await p.keyboard.press('Space'); await p.waitForTimeout(150);
  ok('space pauses', (await p.locator('#play').textContent())==='Play', await p.locator('#play').textContent());
  await p.keyboard.press('Space'); await p.waitForTimeout(150);
  ok('and resumes', (await p.locator('#play').textContent())==='Pause');
  await p.keyboard.press('t'); await p.waitForTimeout(120);
  ok('t toggles trails off', !await p.locator('#trails').evaluate(e=>e.classList.contains('on')));
  await p.keyboard.press('c'); await p.waitForTimeout(150);
  ok('c clears the sky', await p.evaluate(()=>window.orbital.count())===0);
  ok('no exceptions anywhere', errs.length===0, errs.join(' | '));
  await ctx.close();

  await b.close();
  console.log(fails?`\n${fails} FAILURE(S)`:'\nALL PASS');
  process.exit(fails?1:0);
})();
