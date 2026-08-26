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
  ok('the default system is populated', await p.evaluate(()=>window.orbital.count())>8,
     String(await p.evaluate(()=>window.orbital.count())));
  for(const n of ['solar','binary','smash','cluster']){
    await p.locator(`[data-preset="${n}"]`).click();
    await p.waitForTimeout(300);
    ok(`preset ${n} loads`, await p.evaluate(()=>window.orbital.count())>1,
       String(await p.evaluate(()=>window.orbital.count())));
  }
  ok('no exceptions after every preset', errs.length===0, errs.join(' | '));
  ok('every class in the roster can be placed', await p.evaluate(()=>{
    const o=window.orbital; o.clear();
    const ids=[...document.querySelectorAll('.bd')].map(e=>e.dataset.k);
    ids.forEach((id,i)=>o.add(i*400, 0, 0, 0, id));
    return o.count()===ids.length;
  }));
  await ctx.close();

  console.log('\n--- the sim is drawn as pixels ---');
  ({p,ctx,errs}=await open(b,{width:1200,height:800}));
  const pix = await p.evaluate(()=>window.orbital.pix());
  ok('the render buffer is scaled down, not 1:1', pix>=2, pix+'x');
  ok('the canvas asks for nearest-neighbour upscaling',
     await p.evaluate(()=>getComputedStyle(document.getElementById('c')).imageRendering.includes('pixel')
                        || getComputedStyle(document.getElementById('c')).imageRendering.includes('crisp')));
  await ctx.close();

  console.log('\n--- world sprites ---');
  ({p,ctx,errs}=await open(b));
  const sprites = await p.evaluate(()=>{
    const o=window.orbital;
    const grab=spec=>{
      const c=o.sprite(spec,32), g=c.getContext('2d');
      return Array.from(g.getImageData(0,0,32,32).data);
    };
    const a=grab({cls:'rock',pal:'terran',seed:11});
    const a2=grab({cls:'rock',pal:'terran',seed:11});
    const bdiff=grab({cls:'rock',pal:'terran',seed:99});
    const gas=grab({cls:'gas',pal:'amber',seed:11});
    const same=(x,y)=>x.every((v,i)=>v===y[i]);
    /* a sphere: corners transparent, centre opaque */
    const alphaAt=(d,x,y)=>d[(y*32+x)*4+3];
    return {
      stable: same(a,a2),
      seedMatters: !same(a,bdiff),
      classMatters: !same(a,gas),
      cornerClear: alphaAt(a,0,0)===0 && alphaAt(a,31,31)===0,
      centreSolid: alphaAt(a,16,16)>200,
      /* terrain means more than one colour inside the disc */
      colours: new Set(Array.from({length:24},(_,i)=>{
        const x=6+(i%6)*4, y=6+((i/6)|0)*4;
        const j=(y*32+x)*4;
        return a[j]+','+a[j+1]+','+a[j+2];
      })).size
    };
  });
  ok('the same seed always gives the same world', sprites.stable);
  ok('a different seed gives different terrain', sprites.seedMatters);
  ok('a gas giant does not look like a rock', sprites.classMatters);
  ok('it is drawn as a sphere, not a square', sprites.cornerClear && sprites.centreSolid);
  ok('the surface has real terrain on it', sprites.colours>8, sprites.colours+' distinct colours sampled');
  await ctx.close();

  console.log('\n--- the integrator holds an orbit ---');
  ({p,ctx,errs}=await open(b));
  const drift = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    o.add(0,0,0,0,'star');
    const r=420, v=Math.sqrt(1500/r);
    const id=o.add(r,0,0,v,'moon');
    const rad=()=>{ const q=o.list().find(z=>z.id===id); return Math.hypot(q.x,q.y); };
    const r0=rad(); let min=r0,max=r0;
    for(let i=0;i<4000;i++){ o.step(1/60); const rr=rad(); if(rr<min)min=rr; if(rr>max)max=rr; }
    return {r0,min,max,drift:Math.max(Math.abs(max-r0),Math.abs(r0-min))/r0};
  });
  ok('a circular orbit stays circular over a simulated minute', drift.drift<0.03,
     'radius '+drift.min.toFixed(1)+'–'+drift.max.toFixed(1)+' from '+drift.r0.toFixed(1));
  const energy = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.add(0,0,0,0,'star');
    o.add(420,0,0,Math.sqrt(1500/420),'rocky');
    o.add(-700,0,0,-Math.sqrt(1500/700),'moon');
    const e0=o.energy();
    for(let i=0;i<4000;i++) o.step(1/60);
    return Math.abs((o.energy()-e0)/e0);
  });
  ok('total energy is conserved', energy<0.005, 'drift '+(energy*100).toFixed(3)+'%');
  await ctx.close();

  console.log('\n--- a gentle touch merges ---');
  ({p,ctx,errs}=await open(b));
  const m = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    /* closing at 4/s, which gravity lifts to about 4.5 by contact — still under
       the shatter threshold, so this should merge rather than break up */
    o.add(-60,0, 2.0,0,'rocky');
    o.add( 60,0,-2.0,0,'rocky');
    const p0=o.momentum(), n0=o.count();
    /* catch the heat at the moment of impact: it bleeds away within seconds */
    let heatAtMerge=0;
    for(let i=0;i<2500;i++){
      o.step(1/60);
      if(!heatAtMerge && o.count()===1) heatAtMerge=o.list()[0].heat;
    }
    const p1=o.momentum();
    return {n0,n1:o.count(),list:o.list(),parts:o.particles(),heatAtMerge,
            dx:Math.abs(p1.x-p0.x), dy:Math.abs(p1.y-p0.y)};
  });
  ok('two slow bodies become one', m.n0===2 && m.n1===1, m.n0+' -> '+m.n1);
  ok('mass adds up', Math.abs(m.list[0].m-44)<1e-6, String(m.list[0].m));
  ok('momentum survives the merge', m.dx<1e-6 && m.dy<1e-6, m.dx.toExponential(1));
  ok('a gentle merge throws no debris', m.parts===0, String(m.parts));
  ok('but it does leave the survivor hot', m.heatAtMerge>0, m.heatAtMerge.toFixed(2));
  await ctx.close();

  console.log('\n--- a hard impact shatters and melts ---');
  ({p,ctx,errs}=await open(b));
  const sm = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    o.add(-150,0, 9,0,'rocky',400);
    o.add( 150,0,-9,0,'rocky',40);
    let peakHeat=0;
    for(let i=0;i<1400;i++){
      o.step(1/60);
      const a=o.list()[0];
      if(a) peakHeat=Math.max(peakHeat,a.heat);
    }
    const after=o.list();
    return {n:o.count(), parts:o.particles(), heat:peakHeat, mass:after[0]?after[0].m:0};
  });
  ok('the smaller world is destroyed', sm.n===1, String(sm.n));
  ok('and thrown out as debris', sm.parts>150, sm.parts+' fragments');
  ok('the survivor is left molten', sm.heat>0.8, sm.heat.toFixed(2));
  ok('it keeps only part of what hit it', sm.mass>400 && sm.mass<440, sm.mass.toFixed(1));
  const cooled = await p.evaluate(()=>{
    const o=window.orbital;
    const h0=o.list()[0].heat;
    for(let i=0;i<3000;i++) o.step(1/60);
    return {h0, h1:o.list()[0].heat};
  });
  ok('and it cools back towards rock', cooled.h1 < cooled.h0-0.5,
     cooled.h0.toFixed(2)+' -> '+cooled.h1.toFixed(2));
  await ctx.close();

  console.log('\n--- debris obeys gravity ---');
  ({p,ctx,errs}=await open(b));
  const deb = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    o.add(-150,0, 9,0,'rocky',400);
    o.add( 150,0,-9,0,'rocky',40);
    for(let i=0;i<1400;i++) o.step(1/60);
    const m0=o.list()[0].m, p0=o.particles();
    for(let i=0;i<6000;i++) o.step(1/60);
    return {p0, p1:o.particles(), m0, m1:o.list()[0].m, ringed:o.ringed(), settled:o.settled()};
  });
  /* Debris has two honest endings: fall in and add mass, or find a stable orbit
     and stay as a ring. Chaos that never resolves is the failure. */
  ok('the debris cloud resolves rather than milling about',
     deb.m1>deb.m0 || deb.ringed>60,
     `mass ${deb.m0.toFixed(1)} -> ${deb.m1.toFixed(1)}, ${deb.ringed} ringed`);
  ok('and the loose cloud thins out', deb.p1<deb.p0, deb.p0+' -> '+deb.p1);
  await ctx.close();

  console.log('\n--- a gas world throws gas, not rock ---');
  ({p,ctx,errs}=await open(b));
  const gas = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    o.add(-140,0, 8,0,'gas');
    o.add( 140,0,-8,0,'icegiant');
    for(let i=0;i<1400;i++) o.step(1/60);
    return {n:o.count(), parts:o.particles()};
  });
  ok('a gas collision throws a large plume', gas.parts>300, gas.parts+' motes');
  ok('and leaves one world', gas.n===1, String(gas.n));
  await ctx.close();

  console.log('\n--- debris settles into rings and moons ---');
  ({p,ctx,errs}=await open(b));
  const ring = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    const id=o.add(0,0,0,0,'rocky',3000);
    const host=o.list()[0];
    /* a scatter of rubble well inside the Roche distance, on messy orbits */
    for(let i=0;i<260;i++){
      const a=Math.random()*6.283;
      const r=host.r*(1.3+Math.random()*1.0);
      const v=Math.sqrt(3000/r)*(0.82+Math.random()*0.34);
      o.spray(Math.cos(a)*r, Math.sin(a)*r, -Math.sin(a)*v, Math.cos(a)*v, 1, 0.35, 0);
    }
    const n0=o.count();
    for(let i=0;i<3000;i++) o.step(1/60);
    /* how circular the surviving rubble has become */
    const rs=[];
    const ringed=o.ringed();
    return {n0, n1:o.count(), ringed, parts:o.particles()};
  });
  ok('rubble inside the Roche distance settles into a ring', ring.ringed>60,
     ring.ringed+' of '+ring.parts+' fragments ringed');
  /* the point of the ring zone is that tides grind orbits circular; measure it */
  const circ = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    o.add(0,0,0,0,'rocky',3000);
    const host=o.list()[0];
    for(let i=0;i<180;i++){
      const a=Math.random()*6.283;
      const r=host.r*1.7;
      /* deliberately eccentric: 70-130% of circular speed */
      const v=Math.sqrt(3000/r)*(0.7+Math.random()*0.6);
      o.spray(Math.cos(a)*r,Math.sin(a)*r,-Math.sin(a)*v,Math.cos(a)*v,1,0,0);
    }
    /* Radial speed is zero at an apsis whatever the orbit, and these all start
       at one — so measure eccentricity itself, from energy and angular momentum. */
    const ecc=()=>{
      const h=o.list()[0], mu=h.m;
      let sum=0,n=0;
      for(const q of o.debris()){
        const dx=q.x-h.x, dy=q.y-h.y, r=Math.hypot(dx,dy)||1e-9;
        const vx=q.vx-h.vx, vy=q.vy-h.vy;
        const E=(vx*vx+vy*vy)/2 - mu/r;
        const L=dx*vy - dy*vx;
        sum+=Math.sqrt(Math.max(0, 1 + 2*E*L*L/(mu*mu))); n++;
      }
      return n?sum/n:0;
    };
    const before=ecc();
    for(let i=0;i<1800;i++) o.step(1/60);
    return {before, after:ecc()};
  });
  ok('and their orbits are ground circular', circ.after < circ.before*0.4,
     'mean eccentricity '+circ.before.toFixed(3)+' -> '+circ.after.toFixed(3));
  ok('and tides stop it clumping into a moon', ring.n1===ring.n0,
     ring.n0+' -> '+ring.n1+' bodies');

  const moon = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    o.add(0,0,0,0,'rocky',3000);
    const host=o.list()[0];
    /* the same rubble, but parked well outside the Roche distance and moving
       together, which is what lets gravity finish the job */
    const r=host.r*6;
    const v=Math.sqrt(3000/r);
    o.spray(r,0,0,v,150,0.05,3.0);
    const n0=o.count(), p0=o.particles();
    for(let i=0;i<600;i++) o.step(1/60);
    const made=o.list().filter(x=>x.m<50);
    return {n0,n1:o.count(),p0,p1:o.particles(),
            made:made.map(x=>({n:x.name,m:+x.m.toFixed(2)}))};
  });
  ok('rubble outside it pulls itself into a body', moon.n1>moon.n0,
     moon.n0+' -> '+moon.n1+' bodies');
  ok('and the fragments are consumed doing it', moon.p1<moon.p0,
     moon.p0+' -> '+moon.p1+' fragments');
  ok('the new body is named for what it grew into', moon.made.length>0 &&
     /Asteroid|Moon|Dwarf/.test(moon.made[0].n), JSON.stringify(moon.made));
  await ctx.close();

  console.log('\n--- stars collapse ---');
  ({p,ctx,errs}=await open(b));
  const nova = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    o.add(0,0,0,0,'star',4400);       /* straight past what it can hold up */
    const before=o.list()[0].name;
    for(let i=0;i<30;i++) o.step(1/60);
    const after=o.list()[0];
    return {before, name:after.name, mass:after.m, parts:o.particles(), waves:o.waves()};
  });
  ok('a star past the limit collapses', nova.name==='Neutron star',
     nova.before+' -> '+nova.name);
  ok('it sheds most of itself doing it', nova.mass<4400*0.7, nova.mass.toFixed(0));
  ok('the shell it throws is the nebula', nova.parts>200, nova.parts+' motes');
  ok('and it goes off with a shockwave', nova.waves>0, String(nova.waves));

  const hole = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    o.add(0,0,0,0,'rocky',20000);     /* anything heavy enough, not just stars */
    for(let i=0;i<30;i++) o.step(1/60);
    return o.list()[0];
  });
  ok('anything heavy enough becomes a black hole', hole.name==='Black hole' && hole.hole,
     hole.name);
  const stable = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.add(0,0,0,0,'star',1500); o.add(0,0,0,0,'neutron');
    for(let i=0;i<120;i++) o.step(1/60);
    return o.list().map(x=>x.name);
  });
  ok('an ordinary star and a neutron star are left alone',
     stable.includes('Star')||stable.includes('Neutron star'), JSON.stringify(stable));
  await ctx.close();

  console.log('\n--- shockwaves ---');
  ({p,ctx,errs}=await open(b));
  const shock = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    /* debris sitting still, then a blast goes off beside it */
    o.spray(300,0,0,0,120,0,10);
    const speed0=o.debris().reduce((s,q)=>s+Math.hypot(q.vx,q.vy),0)/120;
    o.add(0,0,0,0,'star',4400);
    let sawWave=false;
    for(let i=0;i<220;i++){ o.step(1/60); if(o.waves()>0) sawWave=true; }
    const d=o.debris().filter(q=>Math.hypot(q.x,q.y)>250);
    const speed1=d.reduce((s,q)=>s+Math.hypot(q.vx,q.vy),0)/Math.max(1,d.length);
    /* is the far debris now moving outward? */
    const outward=d.filter(q=>(q.x*q.vx+q.y*q.vy)>0).length/Math.max(1,d.length);
    return {sawWave, speed0, speed1, outward, n:d.length};
  });
  ok('a collapse sends a front out', shock.sawWave);
  ok('it kicks the debris it overtakes', shock.speed1>shock.speed0+0.5,
     shock.speed0.toFixed(2)+' -> '+shock.speed1.toFixed(2));
  ok('and kicks it outward, not at random', shock.outward>0.7,
     (shock.outward*100).toFixed(0)+'% moving away');
  await ctx.close();

  console.log('\n--- torn apart by a black hole ---');
  ({p,ctx,errs}=await open(b));
  const tide = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(0,0,0,0,'hole',60000);
    const id=o.add(240,0,0,3.4,'rocky',40);
    let maxStretch=0, gone=-1, firstDebris=-1, rose=false, lastM=1e9;
    for(let i=0;i<900;i++){
      o.step(1/60);
      const w=o.list().find(x=>x.id===id);
      if(w){
        maxStretch=Math.max(maxStretch,w.stretch);
        /* it should waste away, never claw its own stream back */
        if(w.m > lastM+0.4) rose=true;
        lastM=w.m;
      } else if(gone<0) gone=i;
      if(firstDebris<0 && o.particles()>20) firstDebris=i;
    }
    return {maxStretch, gone, firstDebris, parts:o.particles(), rose};
  });
  ok('it goes ellipsoidal on the way in', tide.maxStretch>0.5,
     'stretch '+tide.maxStretch.toFixed(2));
  ok('it starts shedding long before it is gone',
     tide.firstDebris>0 && tide.gone-tide.firstDebris>120,
     'shedding from step '+tide.firstDebris+', gone at '+tide.gone);
  ok('and never takes its own stream back', !tide.rose);
  ok('all of its mass ends up in the stream',
     Math.abs(tide.parts*0.055-40)<3, (tide.parts*0.055).toFixed(1)+' of 40');

  /* The point of the rewrite: nothing places the stream along that line. It is
     shed co-moving at the surface, and gravity alone draws it out — the inside
     of it orbits faster than the outside. Measured on a grazing pass, where
     the body survives, so no further shedding can be confused for stretching. */
  const drawn = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(0,0,0,0,'hole',60000);
    o.add(600,0,0,Math.sqrt(60000/600)*0.5,'rocky',40);
    const span=()=>{ let lo=1e9,hi=-1e9;
      for(const q of o.debris()){ const r=Math.hypot(q.x,q.y); if(r<lo)lo=r; if(r>hi)hi=r; }
      return hi>lo ? hi-lo : 0; };
    /* run to just past the pass, when it has shed what it is going to shed */
    for(let i=0;i<5300;i++) o.step(1/60);
    const n0=o.particles(), s0=span();
    let quiet=true;
    const marks=[];
    for(let k=0;k<5;k++){
      for(let i=0;i<800;i++) o.step(1/60);
      if(o.particles()>n0) quiet=false;     /* nothing new was shed */
      marks.push(+span().toFixed(0));
    }
    return {n0, s0:+s0.toFixed(0), marks, quiet};
  });
  ok('the stream starts as a clump', drawn.s0<120, 'span '+drawn.s0);
  ok('and gravity alone draws it out', drawn.marks[4] > drawn.s0*5,
     'span '+drawn.s0+' -> '+drawn.marks.join(' -> '));
  ok('with nothing further shed to do it', drawn.quiet, drawn.n0+' motes throughout');
  /* measured from the first mark, not from s0: the stream genuinely compacts
     as it rounds perihelion before it starts pulling apart, so s0 is not the
     floor of the growth */
  ok('it stretches the whole way, not in one jump',
     drawn.marks.every((v,i)=> i===0 || v > drawn.marks[i-1]), drawn.marks.join(' -> '));

  const safe = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(0,0,0,0,'hole',60000);
    const r=1400, v=Math.sqrt(60000/r);
    o.add(r,0,0,v,'rocky',40);        /* a wide, safe orbit */
    for(let i=0;i<2000;i++) o.step(1/60);
    const w=o.list().find(x=>!x.hole);
    return {alive:!!w, stretch:w?w.stretch:-1, m:w?w.m:0, parts:o.particles()};
  });
  ok('but a world at a safe distance is left alone',
     safe.alive && safe.stretch<0.01 && safe.parts===0,
     'stretch '+safe.stretch.toFixed(3)+', '+safe.parts+' debris');
  ok('and keeps all of its mass', safe.alive && Math.abs(safe.m-40)<0.01, safe.m.toFixed(2));
  ok('no exceptions', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- the clock goes faster ---');
  ({p,ctx,errs}=await open(b));
  await p.locator('#speed').evaluate(el=>{ el.value=60; el.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(150);
  const top = await p.evaluate(()=>parseFloat(document.getElementById('speedv').textContent));
  ok('the speed control reaches well past 4x', top>=40, top+'x');
  const fast = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.add(0,0,0,0,'star',1500);
    const r=420, v=Math.sqrt(1500/r);
    const id=o.add(r,0,0,v,'moon');
    const rad=()=>{ const q=o.list().find(z=>z.id===id); return q?Math.hypot(q.x,q.y):-1; };
    const r0=rad(); let min=r0,max=r0;
    /* a whole second of simulated time per call, as 60x fast-forward does */
    for(let i=0;i<600;i++){ o.step(1.0); const rr=rad(); if(rr<0) return {lost:true};
      if(rr<min)min=rr; if(rr>max)max=rr; }
    return {r0,min,max,drift:Math.max(max-r0,r0-min)/r0};
  });
  ok('and an orbit still holds at full speed', !fast.lost && fast.drift<0.05,
     fast.lost?'body lost':'radius '+fast.min.toFixed(0)+'–'+fast.max.toFixed(0));
  await ctx.close();

  console.log('\n--- the world forge ---');
  ({p,ctx,errs}=await open(b));
  await p.locator('#forgeBtn').click(); await p.waitForTimeout(250);
  ok('the forge opens', await p.locator('#forge').evaluate(e=>e.classList.contains('on')));
  const before = await p.evaluate(()=>({...window.orbital.brush}));
  await p.locator('#fClass button[data-cls="gas"]').click(); await p.waitForTimeout(150);
  ok('composition changes the brush', await p.evaluate(()=>window.orbital.brush.cls)==='gas');
  await p.locator('#fPal button[data-pal="violet"]').click(); await p.waitForTimeout(150);
  ok('palette changes the brush', await p.evaluate(()=>window.orbital.brush.pal)==='violet');
  await p.locator('#reroll').click(); await p.waitForTimeout(150);
  ok('reroll gives new terrain', await p.evaluate(()=>window.orbital.brush.seed)!==before.seed);
  const massBefore = await p.evaluate(()=>window.orbital.brush.mass);
  await p.locator('#fSize').evaluate(el=>{ el.value=80; el.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(150);
  const massAfter = await p.evaluate(()=>window.orbital.brush.mass);
  ok('a bigger world weighs more', massAfter>massBefore*2,
     massBefore.toFixed(1)+' -> '+massAfter.toFixed(1));
  /* the sliders should reach far enough to build something that collapses */
  const huge = await p.evaluate(()=>{
    const sz=document.getElementById('fSize'), dn=document.getElementById('fDens');
    const keepS=sz.value, keepD=dn.value;
    sz.value=sz.max; sz.dispatchEvent(new Event('input'));
    dn.value=dn.max; dn.dispatchEvent(new Event('input'));
    const m=window.orbital.brush.mass;
    /* put the brush back: the assertions after this one build with it */
    sz.value=keepS; sz.dispatchEvent(new Event('input'));
    dn.value=keepD; dn.dispatchEvent(new Event('input'));
    return m;
  });
  ok('and the sliders reach far past a black hole', huge>13000, huge.toExponential(2));
  ok('the preview shows the world you designed',
     await p.evaluate(()=>{
       const c=document.getElementById('fPrev');
       const d=c.getContext('2d').getImageData(0,0,48,48).data;
       let solid=0; for(let i=3;i<d.length;i+=4) if(d[i]>200) solid++;
       return solid>500;                      /* a filled disc, not an empty box */
     }));
  /* and what the forge designed is what actually gets built */
  await p.evaluate(()=>window.orbital.clear());
  const box=await p.locator('#c').boundingBox();
  await p.mouse.click(box.x+box.width/2, box.y+box.height/2);
  await p.waitForTimeout(200);
  const built = await p.evaluate(()=>window.orbital.list()[0]);
  ok('flinging places the designed world', built && built.cls==='gas' && built.pal==='violet',
     built ? built.cls+'/'+built.pal : 'nothing');
  ok('with the designed mass', built && Math.abs(built.m-massAfter)<1e-6,
     built ? built.m.toFixed(1) : '—');
  await ctx.close();

  console.log('\n--- the sky is decoration only ---');
  ({p,ctx,errs}=await open(b));
  const sky = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear();
    const n0=o.count(), p0=o.particles();
    for(let i=0;i<600;i++) o.step(1/60);
    return {n0,p0,n1:o.count(),p1:o.particles()};
  });
  ok('background stars and galaxies are not in the simulation',
     sky.n1===0 && sky.p1===0, `${sky.n1} bodies, ${sky.p1} particles on an empty sky`);
  await ctx.close();

  console.log('\n--- flinging, selecting, camera, keys ---');
  ({p,ctx,errs}=await open(b));
  await p.evaluate(()=>window.orbital.clear());
  const bx=await p.locator('#c').boundingBox();
  const cx=bx.x+bx.width/2, cy=bx.y+bx.height/2;
  await p.mouse.move(cx,cy); await p.mouse.down();
  await p.mouse.move(cx+140,cy,{steps:8}); await p.waitForTimeout(120);
  ok('a prediction path is drawn while aiming',
     await p.evaluate(()=>window.orbital.aim.active && window.orbital.aim.path.length>4));
  await p.mouse.up(); await p.waitForTimeout(150);
  const fl=await p.evaluate(()=>window.orbital.list());
  ok('the drag creates one body', fl.length===1, String(fl.length));
  ok('moving the way it was dragged', fl[0]&&fl[0].vx>0.5&&Math.abs(fl[0].vy)<0.5,
     fl[0]?`v=(${fl[0].vx.toFixed(2)},${fl[0].vy.toFixed(2)})`:'none');
  await p.evaluate(()=>{ const o=window.orbital; o.clear(); o.add(0,0,0,0,'star'); o.add(420,0,0,Math.sqrt(1500/420),'rocky'); });
  await p.waitForTimeout(150);
  await p.evaluate(()=>window.orbital.select(window.orbital.list()[1].id));
  await p.waitForTimeout(250);
  ok('the inspector opens', await p.locator('#insp').evaluate(e=>e.classList.contains('on')));
  ok('it names what the body orbits', (await p.locator('#ispHost').textContent())==='Star',
     await p.locator('#ispHost').textContent());
  ok('and reports a bound orbit', !/escap/i.test(await p.locator('#ispPer').textContent()),
     await p.locator('#ispPer').textContent());
  await p.locator('#ispDel').click(); await p.waitForTimeout(200);
  ok('delete removes it', await p.evaluate(()=>window.orbital.count())===1);
  const z0=await p.evaluate(()=>window.orbital.cam.zoom);
  await p.mouse.move(600,400); await p.mouse.wheel(0,-600); await p.waitForTimeout(150);
  ok('the wheel zooms', await p.evaluate(()=>window.orbital.cam.zoom)>z0*1.05, 'ok');
  await p.keyboard.press('Space'); await p.waitForTimeout(120);
  ok('space pauses', (await p.locator('#play').textContent())==='Play');
  await p.keyboard.press('Space'); await p.waitForTimeout(120);
  await p.keyboard.press('c'); await p.waitForTimeout(150);
  ok('c clears the sky', await p.evaluate(()=>window.orbital.count())===0);
  ok('no exceptions anywhere', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- the sky holds far more debris ---');
  ({p,ctx,errs}=await open(b));
  await p.evaluate(()=>{ window.orbital.clear(); window.orbital.setSpeed(0); });
  {
    const cap = await p.evaluate(()=>window.orbital.maxParts());
    ok('the debris ceiling is well past the old 7000', cap>=60000, String(cap));

    /* pour in more than the old limit and check none of it is quietly dropped */
    const held = await p.evaluate(()=>{
      const o=window.orbital;
      for(let i=0;i<6;i++) o.spray(0,0,0,0,5000,40,600);
      return o.particles();
    });
    ok('thirty thousand motes all survive', held===30000, String(held));

    /* and it still draws them at a playable rate */
    const fps = await p.evaluate(async()=>{
      await new Promise(r=>requestAnimationFrame(r));
      let last=performance.now(); const times=[];
      await new Promise(res=>{ let n=0;
        const tick=()=>{ const now=performance.now(); times.push(now-last); last=now;
                         if(++n<40) requestAnimationFrame(tick); else res(); };
        requestAnimationFrame(tick); });
      times.sort((a,b)=>a-b);
      return 1000/times[times.length>>1];
    });
    ok('and still draws them smoothly', fps>40, fps.toFixed(0)+' fps at 30k');

    /* lowering the ceiling trims immediately rather than waiting for age-out */
    const trimmed = await p.evaluate(()=>{ window.orbital.maxParts(5000); return window.orbital.particles(); });
    ok('lowering the ceiling trims the excess at once', trimmed===5000, String(trimmed));

    /* and the slider drives it */
    const viaSlider = await p.evaluate(()=>{
      const el=document.getElementById('debris');
      el.value=el.max; el.dispatchEvent(new Event('input'));
      return {cap:window.orbital.maxParts(), label:document.getElementById('debrisv').textContent};
    });
    ok('the debris slider raises the ceiling', viaSlider.cap>=200000, String(viaSlider.cap));
    ok('and reads out what it is set to', /k$/.test(viaSlider.label), viaSlider.label);
    ok('no exceptions under a heavy sky', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- two fingers pinch and pan ---');
  ({p,ctx,errs}=await open(b,{width:1024,height:768}));
  const zb=await p.evaluate(()=>window.orbital.cam.zoom);
  /* freeze the sky first: the default scene is live and merges bodies on its
     own, which would otherwise move the count out from under the assertion */
  await p.evaluate(()=>window.orbital.setSpeed(0));
  const nb=await p.evaluate(()=>window.orbital.count());
  await p.evaluate(()=>{
    const c=document.getElementById('c');
    c.setPointerCapture=()=>{};
    const ev=(id,x,y,t)=>c.dispatchEvent(new PointerEvent(t,{pointerId:id,clientX:x,clientY:y,bubbles:true,pointerType:'touch'}));
    ev(1,400,400,'pointerdown'); ev(2,600,400,'pointerdown');
    ev(1,300,400,'pointermove'); ev(2,700,400,'pointermove');
    ev(1,300,400,'pointerup');   ev(2,700,400,'pointerup');
  });
  await p.waitForTimeout(200);
  ok('spreading two fingers zooms in', await p.evaluate(()=>window.orbital.cam.zoom)>zb*1.4,
     zb.toFixed(2)+' -> '+(await p.evaluate(()=>window.orbital.cam.zoom)).toFixed(2));
  ok('and creates no bodies', await p.evaluate(()=>window.orbital.count())===nb);
  await ctx.close();

  await b.close();
  console.log(fails?`\n${fails} FAILURE(S)`:'\nALL PASS');
  process.exit(fails?1:0);
})();
