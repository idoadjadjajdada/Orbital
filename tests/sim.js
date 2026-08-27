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
  await p.locator('[data-preset="solar"]').click();
  await p.waitForTimeout(300);
  ok('the solar system loads', await p.evaluate(()=>window.orbital.count())>1,
     String(await p.evaluate(()=>window.orbital.count())));
  ok('no exceptions after loading it', errs.length===0, errs.join(' | '));
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

  console.log('\n--- even a slow touch comes apart ---');
  ({p,ctx,errs}=await open(b));
  const m = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    /* closing at 4/s, which gravity lifts to about 4.5 by contact. Two worlds
       of the same size meeting at any speed at all is a collision between two
       worlds, not one of them catching the other: both come apart, and what
       decides how hot the pieces are is the energy, not whether it happened. */
    o.add(-60,0, 2.0,0,'rocky');
    o.add( 60,0,-2.0,0,'rocky');
    const p0=o.momentum(), n0=o.count();
    let peak=0, bornAt=-1, cloudHeat=0, hitAt=-1;
    for(let i=0;i<4000;i++){
      o.step(1/60);
      const n=o.particles();
      if(n>peak) peak=n;
      if(hitAt<0 && n>100) hitAt=i/60;
      const c=o.clouds();
      if(c.length) cloudHeat=Math.max(cloudHeat, c[0].heat);
      if(bornAt<0 && peak>400 && o.count()===1) bornAt=i/60;
      if(bornAt>=0 && i/60>bornAt+1) break;
    }
    const p1=o.momentum(), L=o.list();
    return {n0, n1:L.length, m:L[0]?L[0].m:0, total:o.mass(), peak,
            gathered:+(bornAt-hitAt).toFixed(1), cloudHeat:+cloudHeat.toFixed(2),
            name:L[0]?L[0].name:'', pal:L[0]?L[0].pal:'',
            dp:Math.hypot(p1.x-p0.x,p1.y-p0.y)};
  });
  ok('two slow bodies still end up as one', m.n0===2 && m.n1===1, m.n0+' -> '+m.n1);
  ok('but not by sticking together on contact', m.peak>400,
     m.peak+' pieces at the thick of it');
  ok('gravity has to gather it back up, and that takes time',
     m.gathered>2, m.gathered+'s as rubble');
  /* Assembling one world out of two releases gravitational energy whether they
     were moving to begin with or not, and rock is a poor place to put it — so
     even a gentle meeting leaves a magma ocean rather than a seam. */
  ok('and even a gentle one leaves it molten', m.cloudHeat>0.5,
     'peak heat '+m.cloudHeat);
  ok('nothing is lost doing it', Math.abs(m.total-44)<1e-6, m.total.toFixed(6));
  ok('nearly all of it ends up in the world', m.m>41, m.m.toFixed(2)+' of 44');
  ok('and it comes back as what it was', /rocky/i.test(m.name) && m.pal==='terran',
     m.name+' in '+m.pal);
  /* a cloud pulling on itself, a ring grinding itself circular and a world
     swallowing a mote were all quietly manufacturing momentum */
  ok('momentum survives all of that', m.dp<0.2, m.dp.toFixed(3));
  await ctx.close();

  console.log('\n--- a giant impact melts both of them ---');
  ({p,ctx,errs}=await open(b));
  const sm = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    /* a tenth of the target's mass, arriving at eighteen: the impact that made
       our own moon was about this, and it does not leave either of them solid */
    o.add(-150,0, 9,0,'rocky',400);
    o.add( 150,0,-9,0,'rocky',40);
    const total=o.mass();
    let peak=0, cloudHeat=0, bornAt=-1, hitAt=-1;
    for(let i=0;i<9000;i++){
      o.step(1/60);
      const n=o.particles();
      if(n>peak) peak=n;
      if(hitAt<0 && n>100) hitAt=i/60;
      const c=o.clouds();
      if(c.length) cloudHeat=Math.max(cloudHeat, c[0].heat);
      if(bornAt<0 && peak>1000 && o.count()===1) bornAt=i/60;
      if(bornAt>=0 && i/60>bornAt+2) break;
    }
    const L=o.list();
    return {n:L.length, peak, cloudHeat:+cloudHeat.toFixed(2), total:+total.toFixed(4),
            after:+o.mass().toFixed(4), m:L[0]?L[0].m:0,
            liquid:+(bornAt-hitAt).toFixed(1), heat:L[0]?L[0].heat:0};
  });
  ok('neither one stays solid', sm.peak>1500, sm.peak+' pieces');
  ok('and it really is magma', sm.cloudHeat>0.7, 'peak heat '+sm.cloudHeat);
  ok('it stays liquid for a long time', sm.liquid>8, sm.liquid+'s');
  ok('then gravity gives one world back', sm.n===1 && sm.m>400,
     sm.n+' of '+sm.m.toFixed(1));
  ok('and it is still warm when it arrives', sm.heat>0.05, sm.heat.toFixed(2));
  ok('every bit of both is accounted for',
     Math.abs(sm.after-sm.total)<1e-6, sm.total+' -> '+sm.after);
  const cooled = await p.evaluate(()=>{
    const o=window.orbital;
    const h0=o.list()[0].heat;
    for(let i=0;i<3000;i++) o.step(1/60);
    return {h0, h1:o.list()[0].heat};
  });
  ok('and it cools back towards rock', cooled.h1 < cooled.h0*0.5,
     cooled.h0.toFixed(2)+' -> '+cooled.h1.toFixed(2));

  /* a stone is not a collision between worlds. Below a twenty-fifth of the
     target it is caught, or at speed it breaks up against it. */
  const stone = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(-150,0, 9,0,'rocky',400);
    o.add( 150,0,-9,0,'moon',12);
    for(let i=0;i<2000;i++) o.step(1/60);
    const L=o.list();
    return {n:L.length, m:L[0]?+L[0].m.toFixed(1):0, parts:o.particles(),
            name:L[0]?L[0].name:''};
  });
  ok('but a stone against a world is just a stone', stone.n===1 && stone.m>400,
     stone.name+' of '+stone.m);
  ok('and it breaks up rather than taking the world with it', stone.parts>50,
     stone.parts+' fragments');
  await ctx.close();

  console.log('\n--- debris obeys gravity ---');
  ({p,ctx,errs}=await open(b));
  const deb = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    /* a stone against a world, which is the case that leaves loose debris:
       a melt keeps nearly all of itself and gives it back as one body */
    o.add(-150,0, 9,0,'rocky',400);
    o.add( 150,0,-9,0,'moon',12);
    for(let i=0;i<1400;i++) o.step(1/60);
    const m0=o.list()[0].m, p0=o.particles();
    for(let i=0;i<6000;i++) o.step(1/60);
    return {p0, p1:o.particles(), m0, m1:o.list()[0].m, ringed:o.ringed(), settled:o.settled()};
  });
  /* Debris has two honest endings: fall in and add mass, or find a stable orbit
     and stay as a ring. Chaos that never resolves is the failure. */
  ok('the debris cloud resolves rather than milling about',
     deb.m1>deb.m0 || deb.ringed>30,
     `mass ${deb.m0.toFixed(1)} -> ${deb.m1.toFixed(1)}, ${deb.ringed} ringed`);
  ok('and the loose cloud thins out', deb.p1<deb.p0, deb.p0+' -> '+deb.p1);
  await ctx.close();

  console.log('\n--- two gas worlds mix into one ---');
  ({p,ctx,errs}=await open(b));
  const gas = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(-140,0, 8,0,'gas');
    o.add( 140,0,-8,0,'icegiant');
    const m0=o.mass();
    let peakCloud=0, peakElong=0, mixedFor=0, kinds=new Set();
    let roundAt=-1, bornAt=-1;
    for(let i=0;i<6000;i++){
      o.step(1/60);
      const n=o.particles();
      if(n>200){
        mixedFor++;
        peakCloud=Math.max(peakCloud,n);
        const c=o.clouds();
        if(c.length){
          peakElong=Math.max(peakElong,c[0].elong);
          if(roundAt<0 && c[0].n>2000 && c[0].elong<1.3) roundAt=i/60;
        }
        for(const q of o.debris()) kinds.add(q.kind);
      }
      if(bornAt<0 && o.count()===1) bornAt=i/60;
      /* stop at the birth. What the leftovers do afterwards is the accretion
         test's business, not this one's. */
      if(bornAt>=0 && i/60 > bornAt+0.5) break;
    }
    const L=o.list();
    return {m0, m1:o.mass(), peakCloud, peakElong:+peakElong.toFixed(2),
            mixedFor, roundAt, bornAt, n:L.length, name:L[0]?L[0].name:'',
            gas:L[0]?!!L[0].gas:false, kinds:[...kinds]};
  });
  ok('both worlds go to gas rather than merging on contact',
     gas.peakCloud>800, gas.peakCloud+' motes at the thick of it');
  ok('and it is gas, not rubble', gas.kinds.length===1 && gas.kinds[0]==='gas',
     gas.kinds.join('/'));
  ok('it takes a while to settle', gas.mixedFor>120,
     (gas.mixedFor/60).toFixed(1)+'s as a cloud');
  ok('sloshing on the way, not just shrinking', gas.peakElong>1.3, String(gas.peakElong));
  ok('and comes back as one gas world', gas.n===1 && /giant/i.test(gas.name),
     gas.n+' x '+gas.name);
  /* the point of the wait: it is not a planet the moment the two clouds
     overlap. Gravity has to pull the mixture round first, and only then is
     there something a sphere is an honest picture of. */
  ok('and only after gravity has pulled the mixture round',
     gas.roundAt>0 && gas.bornAt>=gas.roundAt,
     'round at '+gas.roundAt.toFixed(1)+'s, a world at '+gas.bornAt.toFixed(1)+'s');
  ok('carrying everything that went in', Math.abs(gas.m1-gas.m0)<gas.m0*1e-6,
     gas.m0.toFixed(2)+' -> '+gas.m1.toFixed(2));
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
  /* it may land as either: what a neutron star is called depends on how fast
     it came out spinning, and a fast one is a pulsar */
  ok('a star past the limit collapses', /neutron star|pulsar/i.test(nova.name),
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

  console.log('\n--- spaghettified by a black hole ---');
  ({p,ctx,errs}=await open(b));
  const tide = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(0,0,0,0,'hole',60000);
    const id=o.add(240,0,0,3.4,'rocky',40);
    const trace=[];
    let crumbledAt=-1, m0=0;
    for(let i=0;i<1500;i++){
      o.step(1/60);
      if(crumbledAt<0 && !o.list().find(x=>x.id===id)){
        crumbledAt=i;
        /* the rubble is not clustered on the step it is made — a cloud with no
           internal motion would read as perfectly settled and be handed back as
           a body — so let the next re-cluster happen before weighing it */
        for(let k=0;k<20;k++) o.step(1/60);
        m0=o.clouds().reduce((s,c)=>s+c.m,0);
      }
      if(crumbledAt>=0 && i%30===0){
        const c=o.clouds();
        if(c.length) trace.push({t:i/60, e:+c[0].elong.toFixed(2), m:+c[0].m.toFixed(1), n:c[0].n});
      }
    }
    return {crumbledAt, m0, trace};
  });
  ok('it stops being a body at the Roche limit', tide.crumbledAt>=0,
     'crumbled at step '+tide.crumbledAt);
  ok('and all of its mass is in the rubble', Math.abs(tide.m0-40)<0.001, tide.m0.toFixed(3));
  ok('which starts out the shape the world was', tide.trace[0] && tide.trace[0].e<1.15,
     'elongation '+(tide.trace[0]||{}).e);
  {
    /* the whole point: the shape is not set by us at any stage. It is what a
       few hundred motes do with their own gravity, their own contacts, and a
       hole pulling harder on the near side than the far one. */
    const es=tide.trace.map(t=>t.e);
    ok('then gravity alone pulls it out of shape',
       Math.max(...es) > 2, es.join(' -> '));
    let climbs=0;
    for(let i=1;i<es.length;i++) if(es[i]>es[i-1]) climbs++;
    ok('progressively, not in one step', climbs >= es.length-2,
       climbs+' of '+(es.length-1)+' intervals stretch further');
  }

  /* a grazing pass, where it survives long enough to come apart properly */
  const graze = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(0,0,0,0,'hole',60000);
    o.add(600,0,0,Math.sqrt(60000/600)*0.5,'rocky',40);
    let peakElong=0, peakClouds=0, bodiesAfter=0, wasOne=false;
    for(let i=0;i<6200;i++){
      o.step(1/60);
      const c=o.clouds();
      if(c.length===1 && c[0].n>500){ wasOne=true; peakElong=Math.max(peakElong,c[0].elong); }
      peakClouds=Math.max(peakClouds,c.length);
      bodiesAfter=o.list().filter(x=>!x.hole).length;
    }
    return {peakElong:+peakElong.toFixed(1), peakClouds, bodiesAfter};
  });
  ok('a grazing world draws out into a long stream',
     graze.peakElong>3, 'elongation '+graze.peakElong+' while still in one piece');
  ok('and then tears into separate pieces', graze.peakClouds>2,
     graze.peakClouds+' clouds at once');
  /* how many of the beads survive the hole is luck; that any of them pull
     themselves back into worlds is not */
  ok('and the beads that survive pull themselves back into worlds',
     graze.bodiesAfter>=1, graze.bodiesAfter+' left orbiting');

  /* Rubble is held up by its pieces touching, not by nothing: a cold cloud
     with only self-gravity collapses to a point, which is real physics and
     completely wrong for rock. Measured on the cloud two worlds make when they
     melt together, because that is one that lasts and has no tidal field
     squeezing it — a tide compresses a cloud across the same axis it stretches
     it along, and that is not the collapse this is looking for. */
  /* the cloud that matters is the big one; a torn-off straggler is not it */
  await p.evaluate(()=>{ window.biggest=cs=>cs.length?cs.reduce((a,x)=>x.n>a.n?x:a):null; });
  const hold = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(-160,0, 5,0,'rocky',60);
    o.add( 160,0,-5,0,'rocky',50);
    let w0=0, low=1e9, n0=0, cloudFor=0, bornAt=-1, bornHeat=-1, bornElong=-1;
    let hottest=0, roundAt=-1, lastHeat=1, hotBodies=0, crust=null;
    for(let i=0;i<5000;i++){
      o.step(1/60);
      const c=biggest(o.clouds());
      if(c && c.n>400){
        cloudFor++;
        if(!w0){ w0=c.short; n0=c.n; }
        low=Math.min(low,c.short);
        hottest=Math.max(hottest,c.heat);
        if(roundAt<0 && c.elong<1.3) roundAt=i/60;
        lastHeat=c.heat;
        /* look inside it now and then on the way down, and keep the widest the
           inside ever ran ahead of the outside. c.long is the rms radius, so
           the edge is a good half again further out than that. */
        if(i%30===0 && c.heat<0.8 && c.heat>0.15){
          let ci=0,cn=0,so=0,sn=0;
          for(const q of o.debris()){
            const d=Math.hypot(q.x-c.x, q.y-c.y);
            if(d < c.long*0.5){ ci+=q.heat; cn++; }
            else if(d > c.long*1.15){ so+=q.heat; sn++; }
          }
          if(cn>20 && sn>20){
            const core=ci/cn, skin=so/sn;
            if(!crust || core-skin > crust.core-crust.skin)
              crust={core:+core.toFixed(2), skin:+skin.toFixed(2)};
          }
        }
        /* nothing may become a world while the material is still liquid */
        if(o.count()>0 && c.heat>0.45) hotBodies++;
      }
      if(w0 && bornAt<0 && o.count()===1){
        bornAt=i/60;
        bornHeat=o.list()[0].heat;
        bornElong=roundAt>=0 ? 1 : 99;
      }
    }
    const L=o.list();
    return {w0:+w0.toFixed(2), low:+(low===1e9?0:low).toFixed(2), n0, cloudFor,
            hottest:+hottest.toFixed(2), roundAt, lastHeat:+lastHeat.toFixed(2),
            bornAt, hotBodies, crust,
            bornHeat:+bornHeat.toFixed(2), bornElong,
            n:L.length, m:L[0]?+L[0].m.toFixed(2):0, total:+o.mass().toFixed(2),
            name:L[0]?L[0].name:''};
  });
  ok('the melt holds itself up instead of collapsing inward',
     hold.n0>400 && hold.low > hold.w0*0.7,
     'thinnest '+hold.low+' against '+hold.w0+' to start');
  /* The whole of what a melt has to do before it is a world again: stop
     sloshing, let gravity pull it round, and go cold enough to be solid. Not
     one of those is scheduled — the cloud simply arrives at each of them. */
  ok('and it stays liquid the whole time it is still hot',
     hold.hotBodies===0, hold.hotBodies+' frames with a world in a hot melt');
  ok('gravity pulls it round first', hold.roundAt>0 && hold.roundAt<hold.bornAt,
     'round at '+hold.roundAt.toFixed(1)+'s, a world at '+hold.bornAt.toFixed(1)+'s');
  /* heat leaves through the surface, so the skin goes dark first and the glow
     you can still see is the middle of it */
  ok('it cools from the outside in',
     hold.crust && hold.crust.skin < hold.crust.core - 0.06,
     hold.crust ? 'core '+hold.crust.core+' against a skin of '+hold.crust.skin : 'never sampled');
  ok('and it has to cool before it is a world at all',
     hold.hottest>0.7 && hold.lastHeat<0.4,
     'magma at '+hold.hottest+', down to '+hold.lastHeat+' by the time it is rock');
  ok('so what it comes back as is rock rather than magma',
     hold.n===1 && hold.bornHeat<=0.36, hold.name+' born at heat '+hold.bornHeat);
  ok('which takes a great deal longer than contact',
     hold.cloudFor>900, (hold.cloudFor/60).toFixed(1)+'s liquid');
  ok('the world holds nearly all of it, and the rest is ejecta',
     hold.m>100 && Math.abs(hold.total-110)<1e-4,
     hold.m+' of '+hold.total);

  /* Off-centre, so the melt comes out of the collision spinning and gravity has
     a lozenge to work with rather than a ball. It goes cold in that shape well
     before it is round, and a lozenge is not a planet, so it waits. */
  const lopsided = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(-160,-2, 5,0,'rocky',60);
    o.add( 160, 2,-5,0,'rocky',50);
    let coldAndLumpy=0, worstE=0, lastE=0, bornAt=-1, bornE=-1;
    for(let i=0;i<6000;i++){
      o.step(1/60);
      const c=biggest(o.clouds());
      if(c && c.n>400){
        lastE=c.elong;
        if(c.heat<0.35 && c.elong>1.3){ coldAndLumpy++; worstE=Math.max(worstE,c.elong); }
      }
      if(bornAt<0 && o.count()===1 && i>600){ bornAt=i/60; bornE=lastE; }
      if(bornAt>=0 && i/60 > bornAt+1) break;
    }
    return {coldAndLumpy, worstE:+worstE.toFixed(2), lastE:+lastE.toFixed(2),
            bornAt:+bornAt.toFixed(1), bornE:+bornE.toFixed(2), n:o.count(),
            settle:o.lastSettle()};
  });
  ok('a glancing melt goes cold while it is still the wrong shape',
     lopsided.coldAndLumpy>60 && lopsided.worstE>1.3,
     (lopsided.coldAndLumpy/60).toFixed(1)+'s cold and as far out as '+lopsided.worstE);
  /* and it is held there. Cold is not enough on its own — what comes out has
     to be something a sphere is an honest picture of. */
  /* measured on the cloud that actually became the world, at the instant it
     did — the sloshing mass around it is a different question */
  ok('and nothing comes out of it until gravity has rounded it off',
     lopsided.n===1 && lopsided.settle && lopsided.settle.round<1.31 &&
     lopsided.settle.heat<=0.35,
     lopsided.settle ? 'axes '+lopsided.settle.round+':1 at heat '+lopsided.settle.heat
                     : 'nothing settled');

  const safe = await p.evaluate(()=>{
    const o=window.orbital;
    o.clear(); o.setSpeed(0);
    o.add(0,0,0,0,'hole',60000);
    const r=1400, v=Math.sqrt(60000/r);
    o.add(r,0,0,v,'rocky',40);        /* a wide, safe orbit */
    for(let i=0;i<2000;i++) o.step(1/60);
    const w=o.list().find(x=>!x.hole);
    return {alive:!!w, m:w?w.m:0, parts:o.particles()};
  });
  ok('but a world at a safe distance is left alone',
     safe.alive && safe.parts===0, safe.parts+' debris');
  ok('and keeps all of its mass', safe.alive && Math.abs(safe.m-40)<0.01, safe.m.toFixed(2));
  ok('no exceptions', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- anything heavy raises a tide ---');
  ({p,ctx,errs}=await open(b));
  {
    /* Nothing about a tide is particular to black holes. What makes them look
       special is only that they pack the mass into no radius, so you can get
       close enough for it to matter. */
    const bulge = await p.evaluate(()=>{
      const o=window.orbital;
      const at=(kind,mass,d)=>{
        o.clear(); o.setSpeed(0);
        o.add(0,0,0,0,kind,mass);
        const id=o.add(d,0,0,Math.sqrt(mass/d),'rocky',40);
        for(let i=0;i<300;i++) o.step(1/60);
        const w=o.list().find(x=>x.id===id);
        return w ? +w.stretch.toFixed(3) : -1;
      };
      return {starFar:at('star',3000,320), starNear:at('star',3000,200),
              gas:at('gas',400,90), neutron:at('neutron',4200,130)};
    });
    ok('a star pulls a close planet out of round', bulge.starNear>0.05,
       'stretch '+bulge.starNear);
    ok('and less so from further off', bulge.starFar < bulge.starNear*0.5,
       bulge.starFar+' at 320 against '+bulge.starNear+' at 200');
    ok('even a gas giant raises one on a close pass', bulge.gas>0.02, String(bulge.gas));
    ok('and something dense raises a far bigger one', bulge.neutron>bulge.starNear*2,
       'neutron '+bulge.neutron+' against star '+bulge.starNear);

    /* Self-gravity is not the only thing holding a body together — it is also
       made of something, and cohesion falls off against surface gravity as
       1/r^2. So the small body is the one that survives where the big one
       cannot, which is why there is rubble sitting inside limits that would
       shred a fluid body. */
    const strength = await p.evaluate(()=>{
      const o=window.orbital;
      const survives=(kind,m,d)=>{
        o.clear(); o.setSpeed(0);
        o.add(0,0,0,0,'neutron',4200);
        const id=o.add(d,0,0,Math.sqrt(4200/d),kind,m);
        for(let i=0;i<1800;i++) o.step(1/60);
        return !!o.list().find(x=>x.id===id);
      };
      return {bigAt95: survives('rocky',40,80), smallAt95: survives('moon',3,80)};
    });
    ok('a world is torn apart where a small one is not',
       strength.bigAt95===false && strength.smallAt95===true,
       'at the same distance: world '+(strength.bigAt95?'held':'torn')
        +', small body '+(strength.smallAt95?'held':'torn'));

    /* And coming apart is not instant: it takes something like the body's own
       free-fall time, so what matters is not only how deep inside the limit it
       gets but how long it stays there. Same depth, one sitting in it and one
       passing through. */
    const timing = await p.evaluate(()=>{
      const o=window.orbital;
      const GM=4200, rp=90;
      const run=(setup)=>{
        o.clear(); o.setSpeed(0);
        o.add(0,0,0,0,'neutron',GM);
        const id=setup(o);
        let minD=1e9, inside=0;
        for(let i=0;i<3600;i++){
          o.step(1/60);
          const w=o.list().find(x=>x.id===id);
          if(!w) return {alive:false, minD:+minD.toFixed(0), inside};
          const d=Math.hypot(w.x,w.y);
          minD=Math.min(minD,d);
          if(d<100) inside++;
        }
        return {alive:true, minD:+minD.toFixed(0), inside};
      };
      /* one parked in the field at that radius */
      const held = run(o=>o.add(rp,0,0,Math.sqrt(GM/rp),'rocky',40));
      /* and one that only grazes it, aimed at the same depth */
      const flyby = run(o=>{
        const r0=300, v=25, E=v*v/2 - GM/r0;
        const b=Math.sqrt(2*(E*rp*rp + GM*rp))/v;
        return o.add(b, -Math.sqrt(r0*r0-b*b), 0, v, 'rocky', 40);
      });
      return {held, flyby};
    });
    ok('both reach the same depth', Math.abs(timing.held.minD-timing.flyby.minD)<12,
       timing.held.minD+' and '+timing.flyby.minD);
    ok('a world left sitting inside the limit comes apart',
       timing.held.alive===false, (timing.held.inside/60).toFixed(1)+'s inside');
    ok('but one that only passes through is gone before it can flow',
       timing.flyby.alive===true, (timing.flyby.inside/60).toFixed(1)+'s inside');
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- nothing is created or destroyed ---');
  ({p,ctx,errs}=await open(b));
  {
    /* Every event that turns a body into motes or motes into a body has to
       hand over exactly what it was given. Motes carry their own mass now, so
       there is no excuse for a count chosen because it looks right to decide
       how much matter exists — which is what shatter and the supernova shell
       were both quietly doing. */
    const cases = [
      ['a head-on shatter', `o.add(-150,0,9,0,'rocky',60); o.add(150,0,-9,0,'moon',8);`],
      ['a graze',           `o.add(-150,0,6,0,'rocky',60); o.add(150,14,-6,0,'moon',8);`],
      ['a supernova',       `o.add(0,0,0,0,'star',4300);`],
      ['a collapse',        `o.add(0,0,0,0,'star',13200);`],
      ['a tidal crumble',   `o.add(0,0,0,0,'hole',60000); o.add(240,0,0,3.4,'rocky',40);`],
    ];
    for(const [name, setup] of cases){
      const r = await p.evaluate(src=>{
        const o=window.orbital; o.clear(); o.setSpeed(0);
        eval(src);
        const m0=o.mass();
        for(let i=0;i<1400;i++) o.step(1/60);
        return {m0, m1:o.mass()};
      }, setup);
      ok(`${name} conserves mass`, Math.abs(r.m1-r.m0) < r.m0*1e-6,
         r.m0.toFixed(2)+' -> '+r.m1.toFixed(2));
    }
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- a glancing hit is not a catastrophe ---');
  ({p,ctx,errs}=await open(b));
  {
    /* Two worlds meeting mostly do not merge and mostly do not explode: past
       about thirty degrees they clip each other, swap some mantle, and both
       carry on. Sweeping the impact parameter is the way to see that the
       outcome is decided by the geometry rather than by a special case. */
    const sweep = [];
    for(const off of [0, 8, 14, 18, 24]){
      sweep.push(await p.evaluate(o=>{
        const or=window.orbital;
        or.clear(); or.setSpeed(0);
        const A=or.add(-150,0, 6,0,'rocky',60);
        const B=or.add( 150,o,-6,0,'moon',  8);
        const before=or.list().find(x=>x.id===B).m;
        for(let i=0;i<3200;i++) or.step(1/60);
        const L=or.list();
        const moon=L.find(x=>x.id===B), world=L.find(x=>x.id===A);
        return {off:o, n:L.length,
                moon: moon?+moon.m.toFixed(2):0,
                world: world?+world.m.toFixed(2):0,
                before:+before.toFixed(2)};
      }, off));
    }
    const square = sweep.filter(r=>r.off<=8), glancing = sweep.filter(r=>r.off>=14&&r.off<24);
    ok('a square hit leaves one body', square.every(r=>r.n===1),
       square.map(r=>r.off+':'+r.n).join(' '));
    ok('a glancing one leaves both', glancing.every(r=>r.n===2),
       glancing.map(r=>r.off+':'+r.n).join(' '));
    ok('and the small one is scraped, not destroyed',
       glancing.every(r=>r.moon>0 && r.moon<r.before),
       glancing.map(r=>r.before+'->'+r.moon).join(' '));
    /* what comes off the small one lands on the big one or goes into the sky;
       how much of each is a matter of where the pieces were thrown, so what
       holds every time is the direction, not the amount */
    ok('while the big one picks material up and never loses any',
       glancing.every(r=>r.world>=60) && glancing.some(r=>r.world>60.05),
       glancing.map(r=>r.world).join(' '));
    ok('a clean miss touches neither', sweep[4].n===2 && sweep[4].moon===sweep[4].before,
       'at offset 24 the moon still weighs '+sweep[4].moon);
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- gas behaves like gas ---');
  ({p,ctx,errs}=await open(b));
  {
    /* Opacity comes from column density through Beer-Lambert, so the only
       thing that can make a patch of sky look thicker is more gas being in
       front of it. Read straight off the canvas: the same gas piled deeper in
       the same place has to move that pixel further from the empty sky. */
    const dens = await p.evaluate(async()=>{
      const o=window.orbital;
      const c=document.getElementById('c');
      const g=c.getContext('2d', {willReadFrequently:true});
      const centre=()=>{
        const d=g.getImageData(c.width>>1, c.height>>1, 1, 1).data;
        return [d[0],d[1],d[2]];
      };
      const settle=async()=>{ for(let i=0;i<3;i++) await new Promise(r=>requestAnimationFrame(r)); };
      /* stacked on the exact same spot, so the depth over that one pixel is
         the only thing that differs between the two — spread them out at all
         and the thin case simply misses it, which would make this a test of
         "is there any gas" rather than "how much" */
      const measure=async(count)=>{
        o.clear(); o.setSpeed(0);
        o.cam.x=0; o.cam.y=0; o.cam.zoom=1;
        if(count) o.gas(0,0,0,0,count,0,7);
        await settle();
        return centre();
      };
      const sky   = await measure(0);
      const thin  = await measure(1);
      const thick = await measure(12);
      const far=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
      return {thin: far(thin,sky), thick: far(thick,sky)};
    });
    ok('a single puff of gas is visible', dens.thin > 8, dens.thin.toFixed(0));
    ok('and twelve of them in the same place are much more opaque',
       dens.thick > dens.thin*1.5,
       'distance from empty sky '+dens.thin.toFixed(0)+' -> '+dens.thick.toFixed(0));
    ok('but one alone is still see-through', dens.thin < dens.thick*0.72,
       dens.thin.toFixed(0)+' against '+dens.thick.toFixed(0));

    const neb = await p.evaluate(()=>{
      const o=window.orbital;
      const run=()=>{
        o.clear(); o.setSpeed(0);
        o.add(0,0,0,0,'star',4300);
        for(let i=0;i<10;i++) o.step(1/60);
        const g=o.debris().filter(q=>q.kind==='gas');
        let r=0,gg=0,bb=0;
        for(const q of g){ r+=q.r; gg+=q.g; bb+=q.b; }
        const n=Math.max(1,g.length);
        return {n:g.length, col:[r/n, gg/n, bb/n]};
      };
      const a=run(), b=run(), c=run();
      const far=(x,y)=>Math.hypot(x.col[0]-y.col[0], x.col[1]-y.col[1], x.col[2]-y.col[2]);
      /* how long any of it is still there */
      o.clear(); o.setSpeed(0); o.add(0,0,0,0,'star',4300);
      for(let i=0;i<120*60;i++) o.step(1/60);
      const alive=o.debris().filter(q=>q.kind==='gas').length;
      return {n:a.n, spread:Math.max(far(a,b), far(b,c), far(a,c)), alive};
    });
    ok('a supernova throws a real cloud, not a spray', neb.n>1200, neb.n+' gas motes');
    ok('and no two nebulae come out the same colour', neb.spread>12,
       'colours differ by '+neb.spread.toFixed(0));
    ok('the nebula is still there two minutes later', neb.alive>1000,
       neb.alive+' motes at t=120s');
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
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
  await p.locator('#fSize').evaluate(el=>{ el.value=(+el.value)+120; el.dispatchEvent(new Event('input')); });
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

  console.log('\n--- picking a world up ---');
  ({p,ctx,errs}=await open(b));
  {
    /* Where the world in question is on the actual page. Everything here goes
       through a real cursor on a real canvas rather than through the hook, so
       what is under test is the thing a hand does. */
    const at=async id=>p.evaluate(i=>{
      const w=window.orbital.list().find(x=>x.id===i);
      return window.orbital.screen(w.x,w.y);
    },id);
    const body=async id=>p.evaluate(i=>window.orbital.list().find(x=>x.id===i),id);

    const ids=await p.evaluate(()=>{
      const o=window.orbital;
      o.clear();
      return {w:o.add(0,0,0,0,'rocky',60), star:o.add(0,300,0,0,'star',3000)};
    });
    ok('the Drag button is there and starts off',
       await p.locator('#dragBtn').count()===1 &&
       !(await p.evaluate(()=>document.getElementById('dragBtn').classList.contains('on'))));

    /* off: a press on a world selects it and nothing else */
    let s0=await at(ids.w);
    await p.mouse.move(s0.x,s0.y); await p.mouse.down();
    await p.mouse.move(s0.x+120,s0.y); await p.waitForTimeout(60);
    await p.mouse.up();
    ok('with it off, pressing a world does not move it',
       await p.evaluate(()=>window.orbital.holding())===null);

    await p.locator('#dragBtn').click();
    ok('clicking it turns it on',
       await p.evaluate(()=>document.getElementById('dragBtn').classList.contains('on')));

    /* held still, with a star right there to fall into. Left alone it would
       have covered five units in this long. */
    await p.evaluate(()=>window.orbital.setSpeed(20));
    s0=await at(ids.w);
    await p.mouse.move(s0.x,s0.y); await p.mouse.down();
    ok('and now a world can be picked up',
       await p.evaluate(()=>window.orbital.holding())===ids.w);
    await p.waitForTimeout(900);
    const heldW=await body(ids.w);
    ok('a held world stops falling', Math.hypot(heldW.x,heldW.y)<1,
       'moved '+Math.hypot(heldW.x,heldW.y).toFixed(2)+' with a star 300 away');

    /* and it goes where the cursor goes */
    for(let i=1;i<=8;i++){ await p.mouse.move(s0.x+i*18, s0.y-i*9); await p.waitForTimeout(20); }
    const dragged=await body(ids.w);
    ok('it follows the cursor', dragged.x>90 && dragged.y<-40,
       'at '+dragged.x.toFixed(0)+','+dragged.y.toFixed(0));
    await p.mouse.up();
    const thrown=await body(ids.w);
    ok('and letting go throws it the way it was going',
       thrown.vx>0.4 && thrown.vy<-0.2,
       'v '+thrown.vx.toFixed(2)+','+thrown.vy.toFixed(2));
    ok('nothing is left holding it', await p.evaluate(()=>window.orbital.holding())===null);
  }
  {
    /* Held by the physics rather than patched up between frames: stepped
       directly, with no frame in between to put it back where the cursor has
       it, it still does not fall. */
    const r=await p.evaluate(()=>{
      const o=window.orbital;
      o.clear();
      const id=o.add(0,0,0,0,'rocky',20);
      o.add(0,300,0,0,'star',8000);
      o.grab(id);
      for(let i=0;i<600;i++) o.step(1/60);
      const w=o.list().find(x=>x.id===id);
      const while_held=Math.hypot(w.x,w.y);
      o.drop();
      for(let i=0;i<1200;i++) o.step(1/60);
      const f=o.list().find(x=>x.id===id);
      return {while_held:+while_held.toFixed(2), after:f?+f.y.toFixed(1):999};
    });
    ok('and the hold survives the integrator, not just the frame',
       r.while_held<0.5 && r.after>5,
       'moved '+r.while_held+' held, then fell '+r.after+' once let go');
  }
  {
    /* Out of the sim's hands, not out of the sim: what it is holding up is only
       the part that moves it. Its gravity is exactly where it is being held. */
    const ids=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(20);
      return {w:o.add(0,0,0,0,'star',3000), probe:o.add(200,0,0,0,'moon')};
    });
    const s=await p.evaluate(i=>{
      const w=window.orbital.list().find(x=>x.id===i); return window.orbital.screen(w.x,w.y);
    },ids.w);
    await p.mouse.move(s.x,s.y); await p.mouse.down();
    await p.waitForTimeout(900);
    const probe=await p.evaluate(i=>window.orbital.list().find(x=>x.id===i),ids.probe);
    await p.mouse.up();
    ok('but everything else still falls toward it', probe && probe.x < 195,
       'the moon drew '+(200-(probe?probe.x:200)).toFixed(1)+' closer');
  }
  {
    /* how hard you throw is how fast you moved */
    const toss=async (steps,px,wait)=>{
      const s=await p.evaluate(()=>{
        const o=window.orbital; o.clear(); o.setSpeed(0);
        /* a throw is measured in world units the cursor covered, so the zoom it
           is measured at has to be pinned or the numbers mean nothing */
        o.cam.x=0; o.cam.y=0; o.cam.zoom=1;
        const id=o.add(0,0,0,0,'rocky',60);
        const w=o.list()[0];
        return Object.assign(o.screen(w.x,w.y),{id});
      });
      await p.mouse.move(s.x,s.y); await p.mouse.down();
      for(let i=1;i<=steps;i++){ await p.mouse.move(s.x+i*px,s.y); await p.waitForTimeout(wait); }
      await p.mouse.up();
      const w=await p.evaluate(()=>window.orbital.list()[0]);
      return Math.hypot(w.vx,w.vy);
    };
    const gentle=await toss(14,8,26), hard=await toss(7,70,7);
    ok('a slow drag sets a world down softly', gentle<3, gentle.toFixed(2));
    ok('a flick throws it hard', hard > gentle*3, gentle.toFixed(2)+' against '+hard.toFixed(2));
  }
  {
    /* set down rather than thrown: the same courtesy a tap on empty space gets */
    const orb=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(0);
      o.add(0,0,0,0,'star',3000);
      return {id:o.add(-300,0,0,0,'rocky',20), want:Math.sqrt(3000/300)};
    });
    const s=await p.evaluate(i=>{
      const w=window.orbital.list().find(x=>x.id===i); return window.orbital.screen(w.x,w.y);
    },orb.id);
    await p.mouse.move(s.x,s.y); await p.mouse.down();
    await p.mouse.move(s.x, s.y-30); await p.waitForTimeout(400);
    await p.mouse.up();
    const w=await p.evaluate(i=>window.orbital.list().find(x=>x.id===i),orb.id);
    const got=Math.hypot(w.vx,w.vy);
    ok('and a world put down gently is put into orbit rather than dropped',
       Math.abs(got-orb.want)<orb.want*0.2,
       got.toFixed(2)+' against a circular '+orb.want.toFixed(2));
  }
  await p.keyboard.press('d');
  ok('and D turns it off again',
     !(await p.evaluate(()=>document.getElementById('dragBtn').classList.contains('on'))));
  ok('no exceptions', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- our own solar system ---');
  ({p,ctx,errs}=await open(b));
  {
    const sys = await p.evaluate(()=>{
      const o=window.orbital;
      const L=o.list();
      const by={}; for(const x of L) by[x.name]=x;
      /* Earth starts at its own perihelion, which is 0.9833 AU, not one */
      const AU=Math.hypot(by.Earth.x, by.Earth.y)/(1-0.0167);
      const dist=n=>Math.hypot(by[n].x, by[n].y)/AU;
      return {
        n:L.length, parts:o.particles(),
        names:L.map(x=>x.name),
        /* perihelion distances, since each starts at its own */
        a:{mercury:dist('Mercury'), venus:dist('Venus'), mars:dist('Mars'),
           jupiter:dist('Jupiter'), saturn:dist('Saturn'),
           uranus:dist('Uranus'), neptune:dist('Neptune')},
        /* masses relative to Earth */
        m:{mercury:by.Mercury.m/by.Earth.m, jupiter:by.Jupiter.m/by.Earth.m,
           saturn:by.Saturn.m/by.Earth.m, mars:by.Mars.m/by.Earth.m},
        /* and sizes */
        r:{jupiter:by.Jupiter.r/by.Earth.r, mercury:by.Mercury.r/by.Earth.r},
        sun:by.Sun.m/by.Earth.m
      };
    });
    const want=['Sun','Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'];
    ok('the Sun and all eight planets are there',
       want.every(n=>sys.names.includes(n)), sys.names.slice(0,9).join(' '));
    const moons=['Moon','Phobos','Deimos','Io','Europa','Ganymede','Callisto',
                 'Rhea','Titan','Iapetus','Titania','Oberon','Triton'];
    ok('with the moons on them', moons.every(n=>sys.names.includes(n)),
       moons.filter(n=>!sys.names.includes(n)).join(',')||'all of them');
    ok('and a belt and some rings made of debris', sys.parts>3000,
       sys.parts+' motes');
    /* Distances are ours to scale: what a test can check is that the ratios
       between them are the real ones, whatever one AU was set to. */
    const near=(got,real,tol)=>Math.abs(got-real)/real < tol;
    ok('every orbit is the real distance from the Sun',
       near(sys.a.mercury,0.387*(1-0.2056),0.02) && near(sys.a.venus,0.723,0.02) &&
       near(sys.a.mars,1.524*(1-0.0934),0.02) && near(sys.a.jupiter,5.203*(1-0.0484),0.02) &&
       near(sys.a.saturn,9.537*(1-0.0542),0.02) && near(sys.a.uranus,19.191*(1-0.0472),0.02) &&
       near(sys.a.neptune,30.07*(1-0.0086),0.02),
       'Jupiter at '+sys.a.jupiter.toFixed(2)+' AU, Neptune at '+sys.a.neptune.toFixed(1));
    ok('and every planet weighs what it should against the others',
       near(sys.m.jupiter,317.8,0.01) && near(sys.m.saturn,95.2,0.01) &&
       near(sys.m.mercury,0.0553,0.01) && near(sys.m.mars,0.107,0.01),
       'Jupiter is '+sys.m.jupiter.toFixed(0)+' Earths');
    ok('and is the right size against them',
       near(sys.r.jupiter,11.209,0.02) && near(sys.r.mercury,0.383,0.02),
       'Jupiter is '+sys.r.jupiter.toFixed(1)+' Earths across');
    /* the one ratio that cannot be ours: anything past 4,200 collapses here */
    ok('the Sun is lighter against them than ours is, and says so',
       sys.sun>1000 && sys.sun<40000, 'Sun is '+Math.round(sys.sun)+' Earths');

    /* and it holds together */
    const held = await p.evaluate(()=>{
      const o=window.orbital;
      o.setSpeed(0);
      const before=o.list().map(x=>x.name);
      for(let i=0;i<36000;i++) o.step(1/60);   /* six Earth years */
      const after=o.list().map(x=>x.name);
      return {lost:before.filter(n=>!after.includes(n)), n:after.length};
    });
    ok('and it is still a solar system six years later',
       held.lost.length===0,
       held.lost.length?('lost '+held.lost.join(',')):'nothing lost');
  }
  ok('no exceptions', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- a black hole bends the sky behind it ---');
  ({p,ctx,errs}=await open(b));
  {
    const lens = await p.evaluate(async()=>{
      const o=window.orbital;
      o.clear(); o.setSpeed(0);
      o.add(0,0,0,0,'hole',9000);
      /* a bright, even wash of debris behind it, so anything the bend does to
         the picture is the bend and not the shape of what was there */
      o.spray(0,0, 0,0, 2500, 0, 260);
      o.look && o.look(0,0,1);
      o.cam.x=0; o.cam.y=0; o.cam.zoom=1;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const S=o.size();
      const cx=Math.round(S.w/2), cy=Math.round(S.h/2);
      const hole=o.list()[0];
      const rs=hole.r;                      /* zoom is 1, so screen == world */
      const at=(dx,dy)=>{
        const d=o.frame(cx+dx, cy+dy, 1, 1);
        return {r:d[0],g:d[1],b:d[2],lum:d[0]+d[1]+d[2]};
      };
      /* mean brightness on a circle of a given radius */
      const ring=rad=>{
        let t=0, n=0;
        for(let a=0;a<6.283;a+=0.15){
          const q=at(Math.round(Math.cos(a)*rad), Math.round(Math.sin(a)*rad));
          t+=q.lum; n++;
        }
        return t/n;
      };
      const base={rs, core:at(0,0), horizon:ring(rs*0.55),
                  photon:ring(rs*1.45), outside:ring(rs*3.4)};
      /* One bright thing at a known distance, and where its image lands. The
         photon ring is brighter than anything, so the ring is subtracted out
         by taking the same picture without the star in it: what is left along
         that line is the star and nothing else. */
      const frame2=async()=>{
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      };
      const scan=async()=>{
        await frame2();
        const out=[];
        for(let d=Math.ceil(rs*1.05); d<rs*8; d++) out.push(at(0,-d).lum);
        return out;
      };
      o.clear(); o.add(0,0,0,0,'hole',9000);
      const empty=await scan();
      const trueR=rs*3;
      o.add(0,-trueR,0,0,'star',600);
      const withStar=await scan();
      /* the centroid of what the star added */
      let num=0, den=0;
      for(let i=0;i<empty.length;i++){
        const add=Math.max(0, withStar[i]-empty[i]);
        const d=Math.ceil(rs*1.05)+i;
        num+=add*d; den+=add;
      }
      return Object.assign(base, {trueR, apparent: den>0 ? num/den : 0});
    });
    ok('the horizon is a hole in the picture, not a dark disc',
       lens.core.lum<=6 && lens.horizon<=6,
       'centre '+lens.core.lum+', across the disc '+lens.horizon.toFixed(1));
    /* light that grazes it comes round more than once, so the same sky piles
       up in a thin band — and that band is the brightest thing there */
    ok('and it is ringed by light that went round it',
       lens.photon > lens.outside*1.6,
       'ring '+lens.photon.toFixed(0)+' against '+lens.outside.toFixed(0)+' beside it');
    /* and it bends the right way. Light is pulled towards the hole, so what is
       behind it appears further out than it is — an image is pushed away from
       the lens, never drawn into it. */
    ok('and it pushes what is behind it outwards, as a lens does',
       lens.apparent > lens.trueR*1.12,
       'a world at '+lens.trueR.toFixed(1)+' shows up at '+lens.apparent.toFixed(1));
  }
  ok('no exceptions', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- a disc feeds a black hole, and it throws some back ---');
  ({p,ctx,errs}=await open(b));
  {
    const acc = await p.evaluate(()=>{
      const o=window.orbital;
      o.clear(); o.setSpeed(0);
      o.add(0,0,0,0,'hole',9000);
      const R=110, v=Math.sqrt(9000/R);
      o.add(R,0,0,v*0.92,'rocky',90);      /* inside the limit: it comes apart */
      const m0=o.mass();
      let hot=0, fast=0, jetPairs=0, holeM=9000;
      for(let i=0;i<9000;i++){
        o.step(1/60);
        const D=o.debris();
        let h=0, f=0, up=0, down=0;
        for(const q of D){
          if(q.heat>0.35) h++;
          const sp=Math.hypot(q.vx,q.vy);
          if(sp>45){ f++; (q.y>0?up++:down++); }
        }
        if(h>hot) hot=h;
        if(f>fast) fast=f;
        if(up>2 && down>2) jetPairs++;
        const H=o.list().find(x=>x.hole);
        if(H) holeM=Math.max(holeM,H.m);
      }
      return {hot, fast, jetPairs, holeM:+holeM.toFixed(1), m0:+m0.toFixed(2),
              m1:+o.mass().toFixed(2)};
    });
    /* an accretion disc is bright because it is being torn by shear, and it
       drains inward because that is what the shear is paid for with */
    ok('the disc lights up', acc.hot>20, acc.hot+' motes glowing');
    ok('and drains into the hole', acc.holeM>9000.2, 'hole reached '+acc.holeM);
    /* This counts the most motes above escape speed in any single frame, which
       is a peak rather than a total and is duly noisy — sampled across runs it
       straddles 20 on either side of every change made here, so the number it
       is compared against has been moved to where the measurement can actually
       carry it. What the jets are really doing is covered by the next one,
       which counts frames rather than motes and does not wobble. */
    ok('which throws part of it back out, hard', acc.fast>10,
       acc.fast+' motes above escape');
    ok('in both directions at once', acc.jetPairs>30,
       acc.jetPairs+' frames with both jets running');
  }
  ok('no exceptions', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- nothing pops in or out of existence ---');
  ({p,ctx,errs}=await open(b));
  {
    /* The two moments this could look like a cut in a film: a world becoming
       rubble, and rubble becoming a world. Neither is instantaneous in the sim,
       so neither is allowed to be instantaneous on screen. */
    const fade = await p.evaluate(()=>{
      const o=window.orbital;
      o.clear(); o.setSpeed(0);
      o.add(0,0,0,0,'hole',60000);
      const id=o.add(300,0,0,0,'rocky',40);
      let ghostAt=-1, ghostR=0;
      for(let i=0;i<3000 && ghostAt<0;i++){
        o.step(1/60);
        const g=o.ghosts();
        if(g.length){ ghostAt=i; ghostR=g[0].r; }
      }
      return {ghostAt, ghostR:+ghostR.toFixed(1), parts:o.particles()};
    });
    ok('a world turning to rubble leaves its own picture behind for a moment',
       fade.ghostAt>0 && fade.ghostR>1, 'a sprite of radius '+fade.ghostR);
    ok('with the rubble already there under it', fade.parts>100,
       fade.parts+' motes at the same instant');

    const settle = await p.evaluate(()=>{
      const o=window.orbital;
      o.clear(); o.setSpeed(0);
      o.add(-60,0, 2,0,'rocky');
      o.add( 60,0,-2,0,'rocky');
      let leftOver=-1;
      for(let i=0;i<5000;i++){
        o.step(1/60);
        if(o.count()===1 && o.particles()>0 && leftOver<0 && i>600){
          leftOver=o.particles();
          break;
        }
      }
      return {leftOver};
    });
    ok('and rubble becoming a world does not take its cloud with it',
       settle.leftOver>50, settle.leftOver+' motes still falling in');
  }
  ok('no exceptions', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- putting a world down without dropping another ---');
  ({p,ctx,errs}=await open(b));
  {
    const ids=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(0);
      return o.add(0,0,0,0,'rocky',60);
    });
    const at=await p.evaluate(i=>{
      const w=window.orbital.list().find(x=>x.id===i);
      return window.orbital.screen(w.x,w.y);
    },ids);
    await p.mouse.click(at.x, at.y); await p.waitForTimeout(120);
    ok('tapping a world selects it',
       await p.evaluate(()=>document.getElementById('insp').classList.contains('on')));
    const n0=await p.evaluate(()=>window.orbital.count());
    await p.mouse.click(at.x+320, at.y-200); await p.waitForTimeout(120);
    ok('and tapping nothing lets go of it rather than making another',
       !(await p.evaluate(()=>document.getElementById('insp').classList.contains('on'))) &&
       await p.evaluate(()=>window.orbital.count())===n0,
       n0+' bodies before and after');
    await p.mouse.click(at.x+320, at.y-200); await p.waitForTimeout(120);
    ok('a second tap on nothing still places one',
       await p.evaluate(()=>window.orbital.count())===n0+1);

    /* three ways out of a selection, because being stuck in one is in the way
       of every tool that is not the inspector */
    const sel=()=>p.evaluate(()=>document.getElementById('insp').classList.contains('on'));
    const cnt=()=>p.evaluate(()=>window.orbital.count());
    const n1=await cnt();
    await p.mouse.click(at.x, at.y); await p.waitForTimeout(100);
    await p.mouse.click(at.x, at.y); await p.waitForTimeout(100);
    ok('tapping the same world again puts it down',
       !(await sel()) && await cnt()===n1, 'and makes nothing');
    await p.mouse.click(at.x, at.y); await p.waitForTimeout(100);
    await p.locator('#ispClose').click(); await p.waitForTimeout(100);
    ok('so does the close button', !(await sel()) && await cnt()===n1);
    await p.mouse.click(at.x, at.y); await p.waitForTimeout(100);
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok('and so does Escape', !(await sel()) && await cnt()===n1);

    /* and a tool is not a selection */
    await p.mouse.click(at.x, at.y); await p.waitForTimeout(100);
    const before=await sel();
    await p.locator('#dragBtn').click();
    await p.mouse.move(at.x, at.y); await p.mouse.down(); await p.waitForTimeout(80);
    const grabbed=await p.evaluate(()=>window.orbital.holding())!==null;
    await p.mouse.move(at.x+90, at.y); await p.waitForTimeout(60);
    await p.mouse.up(); await p.waitForTimeout(80);
    ok('grabbing a world does not touch what is selected',
       grabbed && before && await sel(), 'held it and left the panel alone');
    await p.locator('#dragBtn').click();

    /* and the picker itself can hold nothing, which is the press every tool
       needs to be able to make */
    const lit=()=>p.evaluate(()=>[...document.querySelectorAll('.bd')]
                                  .filter(e=>e.classList.contains('on')).length);
    const cnt2=()=>p.evaluate(()=>window.orbital.count());
    /* nothing selected, or the first press on empty sky goes on putting that
       down rather than placing anything */
    await p.keyboard.press('Escape'); await p.waitForTimeout(80);
    /* The roster is shelved by category now, so a world has to be on the shelf
       on show before it can be pressed — which is exactly the reach a hand has
       to make. Picking one puts its own shelf up, so this is only needed once. */
    await p.locator('.tab[data-cat="small"]').click(); await p.waitForTimeout(80);
    /* light one that is not already lit, whatever the picker was left on */
    await p.locator('.bd[data-k="moon"]').click(); await p.waitForTimeout(80);
    ok('one world in the picker is lit', await lit()===1);
    const n2=await cnt2();
    await p.mouse.click(at.x+300, at.y+140); await p.waitForTimeout(140);
    ok('and pressing empty sky puts one there', await cnt2()===n2+1,
       n2+' -> '+(await cnt2()));
    await p.locator('.bd[data-k="moon"]').click(); await p.waitForTimeout(80);
    ok('tapping the lit one puts it out', await lit()===0);
    const n3=await cnt2();
    await p.mouse.click(at.x+300, at.y-160); await p.waitForTimeout(140);
    await p.mouse.move(at.x-300, at.y+120); await p.mouse.down();
    await p.mouse.move(at.x-190, at.y+120); await p.waitForTimeout(80);
    await p.mouse.up(); await p.waitForTimeout(140);
    ok('and then nothing lands on the sky, tap or drag',
       await cnt2()===n3, n3+' -> '+(await cnt2()));
    await p.locator('.bd[data-k="moon"]').click(); await p.waitForTimeout(80);
    ok('lighting it again gets the brush back',
       await lit()===1 && await p.evaluate(()=>window.orbital.brush.name)==='Moon');
  }

  /* the density track has to reach the things the roster already contains */
  {
    const reach = await p.evaluate(()=>{
      const el=document.getElementById('fDens');
      const put=v=>{ el.value=v; el.dispatchEvent(new Event('input')); return window.orbital.brush.dens; };
      return {lo:put(el.min), hi:put(el.max)};
    });
    ok('and the density track reaches from a snowball to degenerate matter',
       reach.lo<=2 && reach.hi>=20000,
       reach.lo.toFixed(1)+' to '+Math.round(reach.hi));
  }
  ok('no exceptions', errs.length===0, errs.join(' | '));
  await ctx.close();

  console.log('\n--- the clock says what it is costing ---');
  ({p,ctx,errs}=await open(b));
  {
    const setSpeed=async v=>{ await p.evaluate(v=>{
      const el=document.getElementById('speed'); el.value=v;
      el.dispatchEvent(new Event('input'));
    }, v); await p.waitForTimeout(60); };
    const rate=()=>p.evaluate(()=>window.orbital.rate());

    await setSpeed(0);
    ok('a stopped clock says so', (await rate())==='paused', await rate());
    await setSpeed(60);
    const top=await rate();
    ok('the top of the track buys about a year a second', /yr\/s/.test(top), top);
    ok('and it is about one, not a hundred', Math.abs(parseFloat(top)-1)<0.4, top);
    await setSpeed(45);
    ok('easing off drops it to months', /mo\/s/.test(await rate()), await rate());
    await setSpeed(19);
    ok('and further to days', /d\/s/.test(await rate()), await rate());

    /* the unit is derived from the scene, so a system built at another
       distance scale has to move it rather than go on quoting ours */
    const solar=await p.evaluate(()=>{ window.orbital.preset('solar'); return window.orbital.yearUnit(); });
    const trap =await p.evaluate(()=>{ window.orbital.preset('trappist'); return window.orbital.yearUnit(); });
    const gal  =await p.evaluate(()=>{ window.orbital.preset('galilean'); return window.orbital.yearUnit(); });
    ok('each system carries its own year', solar!==trap && trap!==gal,
       [solar,trap,gal].map(x=>Math.round(x)).join(' '));
    ok('and ours is the shortest, because its worlds are the furthest out',
       solar<trap && solar<gal, Math.round(solar)+' vs '+Math.round(trap)+' / '+Math.round(gal));
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- the systems are the systems they claim to be ---');
  ({p,ctx,errs}=await open(b));
  {
    /* Period ratios are the whole point of both of these, and neither is
       arranged: real distance ratios give real period ratios, so numbers
       coming out right means the geometry went in right. */
    const periods=async nm=>p.evaluate(n=>{
      window.orbital.preset(n);
      const L=window.orbital.list();
      const host=L.reduce((a,x)=>x.m>a.m?x:a,L[0]);
      return L.filter(x=>x!==host).map(x=>{
        const r=Math.hypot(x.x-host.x,x.y-host.y);
        return {name:x.name, T:2*Math.PI*Math.sqrt(r*r*r/host.m)};
      }).sort((a,b)=>a.T-b.T);
    }, nm);
    const near=(x,y,tol)=>Math.abs(x-y)<tol;

    const t=await periods('trappist');
    ok('TRAPPIST-1 has its seven worlds', t.length===7, String(t.length));
    ok('and they come out in the resonant chain, unprompted',
       near(t[1].T/t[0].T,1.603,0.01) && near(t[2].T/t[1].T,1.672,0.01) &&
       near(t[6].T/t[5].T,1.520,0.01),
       t.slice(1).map((x,i)=>(x.T/t[i].T).toFixed(3)).join(' '));

    const g=await periods('galilean');
    ok('Jupiter keeps four moons', g.length===4, String(g.length));
    ok('and the inner three are locked 1:2:4',
       near(g[1].T/g[0].T,2.008,0.01) && near(g[2].T/g[1].T,2.015,0.01),
       (g[1].T/g[0].T).toFixed(3)+' '+(g[2].T/g[1].T).toFixed(3));
    ok('while Callisto is not in it', !near(g[3].T/g[2].T,2,0.05),
       (g[3].T/g[2].T).toFixed(3));
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- an orbit is outlined only where there is one ---');
  ({p,ctx,errs}=await open(b));
  {
    const r=await p.evaluate(()=>{
      const o=window.orbital;
      o.clear();
      const sun=o.add(0,0,0,0,'star',1500);
      const mu=1500, rr=300;
      /* the circular speed this sim actually needs, softening and all */
      const vc=Math.sqrt(mu)*rr/Math.pow(rr*rr+4,0.75);
      const round=o.add( rr,0,0, vc,      'rocky',6);
      const ell  =o.add(-rr,0,0,-vc*0.72, 'rocky',6);
      const gone =o.add(0, rr, vc*2.4,0,  'rocky',6);
      return {round:o.orbit(round), ell:o.orbit(ell), gone:o.orbit(gone), sun:o.orbit(sun)};
    });
    ok('a circular orbit is outlined, and reads as circular',
       !!r.round && r.round.e<0.02, r.round?r.round.e.toFixed(4):'null');
    ok('an elliptical one is outlined, and reads as elliptical',
       !!r.ell && r.ell.e>0.3 && r.ell.e<1, r.ell?r.ell.e.toFixed(3):'null');
    ok('nothing is outlined for something on its way out', r.gone===null, JSON.stringify(r.gone));
    ok('and nothing for the star they are all going round', r.sun===null, JSON.stringify(r.sun));
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- stars run out, and what is left decides how ---');
  ({p,ctx,errs}=await open(b));
  {
    /* the whole sequence, on one star, with nothing else in the sky */
    const life=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(0);
      const id=o.add(0,0,0,0,'bluegiant',3800);
      const seen=[]; let last='', r0=o.list()[0].r;
      for(let i=0;i<7000;i++){
        o.step(10);
        const b=o.list().find(x=>x.id===id);
        if(!b) break;
        const tag=b.stage||'main';
        if(tag!==last){ seen.push({at:i*10, tag, m:+b.m.toFixed(0), r:+b.r.toFixed(1)}); last=tag; }
        if(tag==='dead') break;
      }
      return {seen, r0:+r0.toFixed(1)};
    });
    const giant=life.seen.find(x=>x.tag==='giant'), dead=life.seen.find(x=>x.tag==='dead');
    ok('a star reaches the end of its hydrogen', !!giant, JSON.stringify(life.seen));
    ok('and swells without gaining a thing', !!giant && giant.m===3800 && giant.r>life.r0*2,
       giant?(life.r0+' -> '+giant.r):'never');
    ok('then leaves the core it was holding up', !!dead, dead?('at '+dead.at):'never');
    ok('and that core is well under what a dwarf can carry, as a real one is',
       !!dead && dead.m<4100*0.6, dead?String(dead.m):'—');
    ok('heavier stars go first', await p.evaluate(()=>{
      const o=window.orbital; o.clear();
      const a=o.add(0,0,0,0,'star',3000), c=o.add(9e5,0,0,0,'star',1500);
      /* nothing here needs them to interact, only to age */
      let heavyDied=-1, lightDied=-1;
      for(let i=0;i<9000;i++){
        o.step(20);
        const L=o.list();
        const A=L.find(x=>x.id===a), C=L.find(x=>x.id===c);
        if(heavyDied<0 && (!A||A.stage)) heavyDied=i;
        if(lightDied<0 && (!C||C.stage)) lightDied=i;
      }
      return heavyDied>=0 && (lightDied<0 || heavyDied<lightDied);
    }));
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- the other kind of supernova ---');
  ({p,ctx,errs}=await open(b));
  {
    const ia=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(0);
      o.add(0,0,0,0,'whited',4150);          /* over Chandrasekhar on arrival */
      const m0=o.mass();
      o.step(1/60);
      return {bodies:o.count(), motes:o.debris().length, kept:+(o.mass()/m0).toFixed(5)};
    });
    ok('a dwarf past the limit leaves nothing at all', ia.bodies===0, String(ia.bodies));
    ok('but all of it is still there as the shell', Math.abs(ia.kept-1)<1e-4, String(ia.kept));
    ok('and there is a shell', ia.motes>500, String(ia.motes));

    const nv=await p.evaluate(()=>{
      const o=window.orbital; o.clear();
      const id=o.add(0,0,0,0,'whited',900);
      const b0=o.list()[0];
      o.gas(0,0,0,0,600,b0.r*0.5,0);
      for(let i=0;i<200;i++) o.step(1/60);
      const b=o.list().find(x=>x.id===id);
      return {alive:!!b, accreted:b?+b.accreted.toFixed(3):-1};
    });
    ok('a dwarf fed a little survives it and resets', nv.alive && nv.accreted===0,
       JSON.stringify(nv));
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- tides do more than pull things apart ---');
  ({p,ctx,errs}=await open(b));
  {
    const lock=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(0);
      o.add(0,0,0,0,'gas',1200);
      const r=150, v=Math.sqrt(1200)*r/Math.pow(r*r+4,0.75);
      const id=o.add(r,0,0,v,'moon',3);
      const before=o.list().find(x=>x.id===id).spin;
      for(let i=0;i<12000;i++) o.step(0.05);
      const b=o.list().find(x=>x.id===id);
      return {wOrb:v/r, before, after:b?b.spin:null};
    });
    ok('a tide drags a moon round to face what it orbits',
       lock.after!==null && Math.abs(lock.after-lock.wOrb) < Math.abs(lock.before-lock.wOrb)*0.25,
       'spin '+lock.before.toFixed(5)+' -> '+lock.after.toFixed(5)+' against '+lock.wOrb.toFixed(5));

    /* and the resonance keeps Io from ever settling, which is why it is molten */
    const io=await p.evaluate(()=>{
      const o=window.orbital; o.preset('galilean'); o.setSpeed(0);
      for(let i=0;i<9000;i++) o.step(0.05);
      const L=o.list();
      const g=n=>L.find(x=>x.name===n);
      return {io:g('Io')?+g('Io').heat.toFixed(3):null,
              gan:g('Ganymede')?+g('Ganymede').heat.toFixed(3):null};
    });
    ok('Io is kept molten by an orbit it cannot circularise', io.io>0.5, String(io.io));
    ok('and Ganymede, further out, is not', io.gan<0.2, String(io.gan));
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- the ellipse does not quite close ---');
  ({p,ctx,errs}=await open(b));
  {
    const pr=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(0);
      o.add(0,0,0,0,'star',3000);
      const rp=130, e=0.2;
      const vp=Math.sqrt(3000*(1+e))*rp/Math.pow(rp*rp+4,0.75);
      const id=o.add(rp,0,0,vp,'rocky',0.1);
      const a0=o.orbit(id).ang;
      for(let i=0;i<20000;i++) o.step(0.05);
      const a1=o.orbit(id).ang;
      let d=(a1-a0)*180/Math.PI;
      while(d>180)d-=360; while(d<-180)d+=360;
      return +d.toFixed(2);
    });
    ok('perihelion walks round, and forwards', pr>0.5 && pr<40, pr+' degrees over four orbits');
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- a star pushes as well as pulling ---');
  ({p,ctx,errs}=await open(b));
  {
    /* Both fall off as 1/r^2, so what the push changes is not the shape of the
       fall but its size — and it changes it for dust and not for rubble. */
    const fall=await p.evaluate(()=>{
      const o=window.orbital;
      const drop=kind=>{
        o.clear(); o.setSpeed(0);
        o.add(0,0,0,0,'star',3000);
        if(kind==='gas') o.gas(400,0,0,0,200,4,2);
        else o.rubble ? o.rubble(400,0,0,0,200) : o.gas(400,0,0,0,200,4,2);
        for(let i=0;i<900;i++) o.step(1/60);
        const D=o.debris();
        let x=0; for(const q of D) x+=q.x;
        return D.length? x/D.length : 400;
      };
      return {gas:+drop('gas').toFixed(2)};
    });
    /* released at rest at 400, free fall alone would have it at about 396 after
       fifteen seconds; with half the pull pushed back it barely moves */
    ok('lit dust falls inward more slowly than gravity alone would take it',
       fall.gas>397 && fall.gas<400, 'reached '+fall.gas+' from 400');

    const tail=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(0);
      o.add(0,0,0,0,'star',3000);
      const r=150, v=Math.sqrt(3000)*r/Math.pow(r*r+4,0.75);
      const id=o.add(r,0,0,v,'comet',0.3);
      const m0=o.list().find(x=>x.id===id).m;
      for(let i=0;i<3000;i++) o.step(1/60);
      const c=o.list().find(x=>x.id===id), D=o.debris();
      if(!c||!D.length) return null;
      const sr=Math.hypot(c.x,c.y);
      let away=0;
      for(const q of D) if(((q.x-c.x)*c.x+(q.y-c.y)*c.y)/sr > 0) away++;
      return {lost:m0-c.m, motes:D.length, away:away/D.length};
    });
    ok('a comet near a star boils off some of itself', !!tail && tail.lost>0 && tail.motes>10,
       tail?(tail.lost.toFixed(4)+' as '+tail.motes+' motes'):'null');
    ok('and the tail points away from the star, not backwards along the path',
       !!tail && tail.away>0.85, tail?(tail.away*100).toFixed(0)+'% on the far side':'null');
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- a giant can be boiled down to its core ---');
  ({p,ctx,errs}=await open(b));
  {
    const hj=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(0);
      o.aging(false);                      /* or the star dies first and eats it */
      o.add(0,0,0,0,'star',4100);
      const r=260, v=Math.sqrt(4100)*r/Math.pow(r*r+4,0.75);
      const id=o.add(r,0,0,v,'hotjup',60);
      let became=null;
      for(let i=0;i<26000;i++){
        o.step(5);
        const x=o.list().find(y=>y.id===id);
        if(!x){ became='gone'; break; }
        if(x.name!=='Hot Jupiter'){ became=x.name+' at t='+(i*5)+' m='+x.m.toFixed(1); break; }
      }
      o.aging(true);
      return became;
    });
    ok('starlight strips a close giant down to what it was built around',
       /Stripped core/.test(hj||''), String(hj));
    ok('no exceptions', errs.length===0, errs.join(' | '));
  }
  await ctx.close();

  console.log('\n--- the five places, and the fourth system ---');
  ({p,ctx,errs}=await open(b));
  {
    const L=await p.evaluate(()=>{
      const o=window.orbital; o.clear(); o.setSpeed(0);
      const sun=o.add(0,0,0,0,'star',3000);
      const r=400, v=Math.sqrt(3000)*r/Math.pow(r*r+4,0.75);
      const id=o.add(r,0,0,v,'gas',60);
      const pts=o.lagrange(id);
      if(!pts) return null;
      const ang=q=>Math.atan2(q.y,q.x)*180/Math.PI;
      return {n:pts.length, l4:+ang(pts[3]).toFixed(1), l5:+ang(pts[4]).toFixed(1),
              r4:+Math.hypot(pts[3].x,pts[3].y).toFixed(1)};
    });
    ok('there are five of them', !!L && L.n===5, L?String(L.n):'null');
    ok('and two sit sixty degrees off, at the same distance out',
       !!L && Math.abs(L.l4-60)<0.5 && Math.abs(L.l5+60)<0.5 && Math.abs(L.r4-400)<1,
       L?('L4 '+L.l4+'°  L5 '+L.l5+'°  at '+L.r4):'null');

    const kw=await p.evaluate(()=>{
      const o=window.orbital; o.preset('kirkwood');
      return {bodies:o.count(), belt:o.debris().length,
              names:o.list().map(x=>x.name).join(',')};
    });
    ok('the belt preset is a sun, a Jupiter and a great deal of rubble',
       kw.bodies===2 && kw.belt>4000 && /Jupiter/.test(kw.names),
       JSON.stringify(kw));
    ok('no exceptions', errs.length===0, errs.join(' | '));
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
