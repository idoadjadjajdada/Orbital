import type { Body } from '../physics/body';
import { AU_M, YEAR_S, fmtLength, fmtDuration, sig } from '../physics/units';
import { BTN } from '../ui/gamepad';
import type { View3D } from './view3d';
import { POWER, type Power } from './ship';
import { survey, LANDER } from './survey';
import { fmtTime } from './radar';
import { atmosphere, interior, composition, habitability, life, gravity, airAt, type Atmosphere, type Layer } from './science';
import { KINDS, pct, fmtLL, type CraftKind } from './fleet';
import { latLonOf } from './ground';
import { speciesIn } from './sites';
import { MAX_SKY_LAMPS } from './lights';

/**
 * The ship's consoles, as panels over the view: the comms log and the sensor
 * sweep on the bridge, the captain's log in the quarters, the survey in the
 * lab, power routing in engineering and the landing survey in the hangar.
 * They refresh once a second while open; Esc, F, E or the controller's B
 * closes them.
 */

export type PanelKind = 'comms' | 'sensors' | 'log' | 'survey' | 'power' | 'bay' | 'mission' | 'craft' | 'scan';

const TITLE: Record<PanelKind, string> = {
  comms: 'Comms log', sensors: 'Sensor sweep', log: "Captain's log", survey: 'Science survey', power: 'Power routing', bay: 'Hangar · landing survey',
  mission: 'Mission control', craft: 'Craft telemetry', scan: 'Field scan',
};

const esc = (s: string | undefined) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class Panels {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private head: HTMLElement;
  kind: PanelKind | null = null;
  private t = 0;
  private fade: HTMLElement;
  /** a finger or button is down on the panel: hold the refresh, so what is pressed is still there when it is let go */
  private pressing = false;
  private html = '';
  /** with a controller: which button the d-pad has picked */
  private focus = -1;
  /** the craft whose telemetry is open, and the site picked for the next lander */
  private craftId = 0;
  private site = 0;

  constructor(private v: View3D) {
    this.el = document.createElement('div');
    this.el.className = 'panel3';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="phead"><b></b><button class="x" aria-label="Close">✕</button></div><div class="pbody"></div>';
    this.head = this.el.querySelector('.phead b')!;
    this.body = this.el.querySelector('.pbody')!;
    this.el.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      if (t.closest('.x')) { this.close(); return; }
      const b = t.closest<HTMLElement>('[data-act]');
      if (b && !(b as HTMLButtonElement).disabled) this.act(b.dataset.act!, b.dataset.id ?? '');
    });
    this.el.addEventListener('pointerdown', () => { this.pressing = true; });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.el.addEventListener(ev, () => { this.pressing = false; });
    this.fade = document.createElement('div');
    this.fade.className = 'fade3';
  }

  /** the black for sleeping, over everything */
  get fadeEl() { return this.fade; }
  setFade(x: number) {
    const o = Math.max(0, Math.min(1, x)).toFixed(2);
    if (this.fade.style.opacity !== o) this.fade.style.opacity = o;
  }

  get open() { return this.kind !== null; }

  /** show the controller's pick */
  private mark() {
    const btns = [...this.body.querySelectorAll<HTMLButtonElement>('button[data-act]:not(:disabled)')];
    btns.forEach((b, k) => b.classList.toggle('pf', k === this.focus));
    btns[this.focus]?.scrollIntoView({ block: 'nearest' });
  }

  show(kind: PanelKind, craft?: number) {
    if (craft !== undefined) this.craftId = craft;
    this.kind = kind;
    this.head.textContent = TITLE[kind];
    this.el.hidden = false;
    this.el.dataset.kind = kind;
    this.t = 0;
    this.focus = -1;
    this.html = '';
    this.refresh();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  close() {
    this.kind = null;
    this.el.hidden = true;
  }

  key(e: KeyboardEvent) {
    if (e.type !== 'keydown' || e.repeat) return;
    if (['Escape', 'KeyF', 'KeyE', 'KeyB', 'Backspace'].includes(e.code)) { e.preventDefault(); this.close(); }
  }

  tick(dt: number) {
    if (!this.kind) return;
    const p = this.v.app.pad;
    if (p.connected) {
      if (p.hit(BTN.B)) { this.close(); return; }
      // the d-pad walks the buttons, A presses one
      const btns = [...this.body.querySelectorAll<HTMLButtonElement>('button[data-act]:not(:disabled)')];
      const step = (p.hit(BTN.DOWN) || p.hit(BTN.RIGHT) ? 1 : 0) - (p.hit(BTN.UP) || p.hit(BTN.LEFT) ? 1 : 0);
      if (step && btns.length) { this.focus = (Math.max(-1, this.focus) + step + btns.length) % btns.length; this.mark(); }
      else if (p.hit(BTN.A) && btns[this.focus]) { const b = btns[this.focus]; this.act(b.dataset.act!, b.dataset.id ?? ''); return; }
    }
    this.t -= dt;
    if (this.t <= 0 && !this.pressing) { this.t = 1; this.refresh(); }
  }

  private byId(id: string): Body | null {
    const n = Number(id);
    return this.v.app.world.bodies.find(b => b.id === n && b.alive) ?? null;
  }

  private act(a: string, id: string) {
    const v = this.v, b = this.byId(id);
    if (a === 'sel' && b) v.app.select(b);
    else if (a === 'go' && b) { v.goTo(b); this.close(); }
    else if (a === 'jump' && b) { v.jumpTo(b); this.close(); }
    else if (a === 'power') { v.ship.power = id as Power; v.app.onToast(`Power routed: ${POWER[id as Power].name}`); }
    else if (a === 'launch') v.launch(id as CraftKind, this.siteName());
    else if (a === 'site') this.site++;
    else if (a === 'cview') { this.close(); v.viewCraft(Number(id)); return; }
    else if (a === 'clog') { this.show('craft', Number(id)); return; }
    else if (a === 'crover') v.roverFrom(Number(id));
    else if (a === 'cdrop') { const c = v.fleet.byId(Number(id)); if (c) { v.fleet.remove(c); v.app.onToast(`${c.name} decommissioned`); } }
    else if (a === 'mission') { this.show('mission'); return; }
    else if (a === 'site') { /* handled above */ }
    else if (a === 'gosite') { const t = v.missionTarget(); if (t) { v.goToSite(t, id); this.close(); return; } }
    else if (a === 'lhang') v.hangLamp();
    else if (a.startsWith('l') && a.length > 1) {
      // a lamp in the sky: id, then what to do with it
      const [lid, arg] = id.split(':');
      const L = v.lights.byId(Number(lid));
      if (L) {
        if (a === 'lmv') v.lights.nudge(L, arg as 'n' | 's' | 'e' | 'w');
        else if (a === 'lhere') { const [la, lo] = v.pointUnder(L.b); v.lights.send(L, la, lo); v.app.onToast(`Lamp ${L.id} on its way over you`); }
        else if (a === 'lpow') L.power = Math.max(0.25, Math.min(4, L.power * (arg === '+' ? 1.5 : 1 / 1.5)));
        else if (a === 'lspr') L.spread = Math.max(L.alt * 0.05, Math.min(L.alt * 3, L.spread * (arg === '+' ? 1.5 : 1 / 1.5)));
        else if (a === 'lon') L.on = !L.on;
        else if (a === 'ldrop') { v.lights.remove(L); v.app.onToast(`Lamp ${L.id} taken down`); }
      }
    }
    this.t = 0;
    this.refresh();
  }

  /** the buttons for a body: select, fly there, open a wormhole */
  private btns(b: Body, jump = false) {
    const sel = this.v.app.selected === b;
    const goWhy = this.v.goBlock(), jWhy = this.v.jumpBlock();
    return `<span class="pbtns"><button data-act="sel" data-id="${b.id}"${sel ? ' class="on"' : ''}>${sel ? 'Selected' : 'Select'}</button>`
      + `<button data-act="go" data-id="${b.id}"${goWhy ? ` disabled title="${esc(goWhy)}"` : ''}>Go</button>`
      + (jump ? `<button class="worm" data-act="jump" data-id="${b.id}"${jWhy ? ` disabled title="${esc(jWhy)}"` : ''}>Jump</button>` : '') + '</span>';
  }

  refresh() {
    if (!this.kind) return;
    const html = this[this.kind]();
    if (this.html !== html) {
      const y = this.body.scrollTop;
      this.html = html;
      this.body.innerHTML = html;
      this.body.scrollTop = y;
      if (this.focus >= 0) this.mark();
    }
  }

  // ---------------------------------------------------------------- the consoles
  private comms() {
    const app = this.v.app, now = app.world.time;
    if (!app.eventLog.length) return '<p class="pdim">Quiet on all channels. Collisions, captures, supernovae and the like are logged here as they happen.</p>';
    return app.eventLog.map(e => {
      const ago = now - e.t;
      const b = e.body && e.body.alive ? e.body : null;
      return `<div class="prow"><div><div>${esc(e.msg)}</div><div class="pdim">${ago < 1 / 365.25 / 1440 ? 'just now' : `${fmtDuration(ago)} ago`} · sim time</div></div>${b ? this.btns(b) : ''}</div>`;
    }).join('');
  }

  private sensors() {
    const v = this.v, P = v.shipPos(), sv = v.shipVel();
    const list = v.app.visual.filter(b => b.source || b === v.app.selected)
      .map(b => ({ b, d: Math.hypot(b.x - P[0], b.y - P[1], b.z - P[2]) }))
      .sort((a, c) => a.d - c.d).slice(0, 16);
    const rows = list.map(({ b, d }) => {
      const rx = b.x - P[0], ry = b.y - P[1], rz = b.z - P[2], dl = Math.hypot(rx, ry, rz) || 1;
      // closing speed, m/s: the ship's velocity is m/s, a body's AU/yr
      const k = AU_M / YEAR_S;
      const rv = [b.vx * k - sv[0], b.vy * k - sv[1], b.vz * k - sv[2]];
      const close = -(rv[0] * rx + rv[1] * ry + rv[2] * rz) / dl;
      const sp = Math.abs(close) < 1000 ? `${close.toFixed(0)} m/s` : `${sig(close / 1000, 3)} km/s`;
      const surf = Math.max(0, d - b.r);
      return `<div class="prow"><div><div class="pnm">${esc(b.name)}</div><div class="pdim">${survey(b, [], null).kind} · ${fmtLength(surf)} · ${close >= 0 ? 'closing' : 'opening'} ${sp.replace('-', '')}</div></div>${this.btns(b, true)}</div>`;
    });
    return `<p class="pdim">The nearest ${list.length} objects, distance to their surface, and how fast the gap is changing.</p>${rows.join('')}`;
  }

  private log() {
    const v = this.v, L = v.logbook;
    const aboard = (performance.now() - L.start) / 1000;
    const stat = (k: string, x: string) => `<div class="pstat"><span>${k}</span><b>${x}</b></div>`;
    const fmtV = (x: number) => x < 1e3 ? `${x.toFixed(0)} m/s` : x < 3e6 ? `${sig(x / 1e3, 3)} km/s` : `${sig(x / 299792458, 3)} c`;
    let h = '<div class="pgrid">'
      + stat('Time aboard', fmtTime(aboard))
      + stat('Distance flown', fmtLength(L.metres / AU_M))
      + stat('Top speed', fmtV(L.top))
      + stat('Wormhole transits', String(L.jumps))
      + stat('Worlds visited', String(L.firsts.length))
      + stat('Spacewalks', String(L.walks))
      + stat('Nights slept', String(L.sleeps))
      + stat('Coffees', String(L.coffees))
      + stat('Landings', String(L.landings))
      + stat('Worlds walked on', String(L.walkedOn.length))
      + stat('Craft launched', String(v.fleet.crafts.length))
      + stat('Discoveries', String(L.finds.length))
      + '</div>';
    if (L.finds.length) h += '<div class="psub">Discoveries</div>' + L.finds.slice().reverse().slice(0, 40).map(f => `<div class="prow"><div><div class="pnm">${esc(f.what)}</div><div class="pdim">${esc(f.where)} · ${esc(f.note)}</div></div></div>`).join('');
    h += '<div class="psub">Visited</div>';
    h += L.firsts.length ? L.firsts.slice().reverse().map(f => `<div class="prow"><div><div class="pnm">${esc(f.name)}</div><div class="pdim">${esc(f.note)}</div></div></div>`).join('')
      : '<p class="pdim">Nowhere yet. Fly within a few radii of a world and it goes in the log, on the shelf, and into the sample locker.</p>';
    return h;
  }

  private survey() {
    const v = this.v, b = v.surveyTarget();
    if (!b) return '<p class="pdim">Nothing to survey. Select something, or fly near it.</p>';
    const s = survey(b, v.stars(), v.app.hostOf(b));
    const picked = b === v.app.selected;
    const stars = v.stars();
    return `<div class="phero"><div><div class="pbig">${esc(s.name)}</div><div class="pdim">${esc(s.kind)}${picked ? ' · selected' : ' · nearest'}</div></div>${this.btns(b, true)}</div>`
      + `<table class="ptab">${s.rows.map(([k, x]) => `<tr><td>${k}</td><td>${esc(x)}</td></tr>`).join('')}</table>`
      + `<div class="pland ${s.land.ok ? 'ok' : 'no'}">${s.land.ok ? '✓' : '✗'} ${esc(s.land.why)}</div>`
      + this.science(b, stars);
  }

  /** the atmosphere reader, the interior, the ground, habitability and life, for a body */
  private science(b: Body, stars: Body[]) {
    const a = atmosphere(b, stars), it = interior(b), cp = composition(b), hab = habitability(b, stars), L = life(b, stars);
    let h = `<div class="psub">Atmosphere reader</div>` + atmoTable(a);
    h += `<div class="psub">Inside</div><div class="pcut">${cutaway(it.layers)}<div>${it.layers.slice().reverse().map(l => `<div class="prow tight"><div><span class="pdot" style="background:#${l.color.toString(16).padStart(6, '0')}"></span><b>${esc(l.name)}</b> <span class="pdim">${esc(l.what)} · to ${(l.r1 * 100).toFixed(0)}% of the radius</span></div></div>`).join('')}<p class="pdim">${esc(it.note)}</p></div></div>`;
    if (cp.rows.length) h += `<div class="psub">Ground</div>${bars(cp.rows)}<p class="pdim">${esc(cp.note)}</p>`;
    if (!['star', 'wd', 'ns', 'bh'].includes(b.cls)) {
      h += `<div class="psub">Habitability</div><div class="pgrid"><div class="pstat"><span>Score</span><b>${(hab.score * 100).toFixed(0)}%</b></div><div class="pstat"><span>Habitable zone</span><b>${hab.zone[1] ? `${hab.zone[0].toPrecision(2)}–${hab.zone[1].toPrecision(2)} AU` : '—'}</b></div><div class="pstat"><span>${hab.inZone ? 'Inside it' : 'Outside it'}</span><b>${isFinite(hab.dist) ? `${hab.dist.toPrecision(3)} AU` : '—'}</b></div><div class="pstat"><span>Water</span><b>${esc(hab.water)}</b></div></div>`
        + `<p class="pdim">${hab.reasons.map(esc).join(' · ')}</p>`;
      h += `<div class="psub">Life</div><div class="pland ${L.tier === 'none' ? 'no' : L.tier === 'candidate' ? 'maybe' : 'ok'}">${esc(L.verdict)}</div>`
        + (L.signs.length ? `<ul class="plist">${L.signs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '')
        + (L.forms.length ? L.forms.map(f => `<div class="prow tight"><div><span class="pdot" style="background:#${f.color.toString(16).padStart(6, '0')}"></span><b>${esc(f.name)}</b> <span class="pdim">${f.kind} · ${esc(f.about)}${f.size ? ` · ${f.size.toPrecision(2)} m` : ''}</span></div></div>`).join('') : '');
    }
    return h;
  }

  // ---------------------------------------------------------------- mission control
  /** the landing sites on offer for the target: under the ship, then the real ones */
  private sites(b: Body | null) { return b ? ['below the ship', ...this.v.ground.siteListFor(b).map(x => x.name)] : ['below the ship']; }
  private siteName() { const l = this.sites(this.v.missionTarget()); const n = l[this.site % l.length]; return n === 'below the ship' ? undefined : n; }

  private mission() {
    const v = this.v, b = v.missionTarget(), f = v.fleet;
    let h = '';
    if (b) {
      const d = Math.max(0, (Math.hypot(b.x - v.shipPos()[0], b.y - v.shipPos()[1], b.z - v.shipPos()[2]) - b.r) * AU_M);
      const site = this.sites(b)[this.site % this.sites(b).length];
      h += `<div class="phero"><div><div class="pbig">${esc(b.name)}</div><div class="pdim">target · ${fmtLength(d / AU_M)} from the ship${b === v.app.selected ? ' · selected' : ' · nearest'}</div></div></div>`;
      h += `<div class="plaunch">${KINDS.map(k => { const why = v.launchBlock(k.k); return `<button data-act="launch" data-id="${k.k}"${why ? ` disabled title="${esc(why)}"` : ''}><b>${k.name}</b><span>${why ? esc(why) : esc(k.about)}</span></button>`; }).join('')}</div>`;
      h += `<div class="prow"><div class="pdim">Landers and rovers set down at</div><button data-act="site">${esc(site)} ▸</button></div>`;
      const all = v.ground.siteListFor(b);
      const row = (x: (typeof all)[number]) => `<div class="prow tight"><div><div class="pnm">${esc(x.name)}${x.year ? ` <span class="pdim">· ${x.year}</span>` : ''}</div><div class="pdim">${esc(x.about)}</div></div><span class="pbtns"><button data-act="gosite" data-id="${esc(x.name)}"${v.goBlock() ? ` disabled title="${esc(v.goBlock())}"` : ''}>Fly there</button></span></div>`;
      const real = all.filter(x => x.kind !== 'peak'), peaks = all.filter(x => x.kind === 'peak');
      if (real.length) h += `<div class="psub">Where people have landed</div>` + real.map(row).join('');
      if (peaks.length) h += `<div class="psub">Mountains</div>` + peaks.map(row).join('');
    } else h += '<p class="pdim">No target. Select a world, or fly near one.</p>';
    h += this.lampsHtml(b);
    h += `<div class="psub">The fleet</div>`;
    if (!f.crafts.length) h += '<p class="pdim">Nothing launched yet.</p>';
    for (const c of f.crafts.slice().reverse()) {
      const last = c.log[c.log.length - 1]?.msg ?? '';
      const lander = c.kind === 'lander' && c.state === 'surface' && !f.crafts.some(x => x.parent === c.id);
      h += `<div class="prow"><div><div class="pnm">${esc(c.name)} <span class="pdim">· ${esc(c.b.name)} · ${esc(c.status)}</span></div><div class="pdim">${esc(last)}</div></div><span class="pbtns">`
        + `${c.state !== 'lost' ? `<button data-act="cview" data-id="${c.id}">${c.kind === 'rover' && c.state === 'surface' ? 'Drive' : 'View'}</button>` : ''}`
        + `<button data-act="clog" data-id="${c.id}">Data</button>${lander ? `<button data-act="crover" data-id="${c.id}">Rover</button>` : ''}</span></div>`;
    }
    return h;
  }

  /** the lamps hung in the sky, and how to move them */
  private lampsHtml(b: Body | null) {
    const v = this.v, lamps = v.lights.lamps.filter(l => l.b.alive);
    const full = lamps.length >= MAX_SKY_LAMPS;
    let h = `<div class="psub">Lamps in the sky</div>`;
    h += `<div class="prow"><div class="pdim">A lamp hangs over one place on a world and keeps to it as the world turns, lighting the ground round it by night. Send it anywhere, any time.</div>`
      + `<span class="pbtns"><button data-act="lhang"${!b || full ? ` disabled title="${!b ? 'No world to hang it over' : 'All the lamps are up'}"` : ''}>Hang a lamp${b ? ` over ${esc(b.name)}` : ''}</button></span></div>`;
    for (const L of lamps) {
      const moving = Math.abs(L.lat - L.toLat) + Math.abs(L.lon - L.toLon) > 0.01;
      const k = `${L.id}`;
      h += `<div class="prow"><div><div class="pnm">Lamp ${L.id} <span class="pdim">· ${esc(L.b.name)} · ${fmtLL(L.lat, L.lon)}${moving ? ' · moving' : ''}${L.on ? '' : ' · off'}</span></div>`
        + `<div class="pdim">${fmtLength(L.alt / AU_M)} up · lights ${fmtLength(L.spread / AU_M)} round · ×${L.power.toFixed(2)}</div></div>`
        + `<span class="pbtns lampbtns"><button data-act="lmv" data-id="${k}:w" title="West">◀</button><button data-act="lmv" data-id="${k}:n" title="North">▲</button><button data-act="lmv" data-id="${k}:s" title="South">▼</button><button data-act="lmv" data-id="${k}:e" title="East">▶</button>`
        + `<button data-act="lhere" data-id="${k}">Over me</button><button data-act="lpow" data-id="${k}:+">Brighter</button><button data-act="lpow" data-id="${k}:-">Dimmer</button>`
        + `<button data-act="lspr" data-id="${k}:+">Wider</button><button data-act="lspr" data-id="${k}:-">Narrower</button><button data-act="lon" data-id="${k}">${L.on ? 'Off' : 'On'}</button><button data-act="ldrop" data-id="${k}">Take down</button></span></div>`;
    }
    return h;
  }

  private craft() {
    const v = this.v, c = v.fleet.byId(this.craftId);
    if (!c) return '<p class="pdim">That craft is gone.</p>';
    const [la, lo] = latLonOf(c.n);
    let h = `<div class="phero"><div><div class="pbig">${esc(c.name)}</div><div class="pdim">${esc(c.b.name)} · ${esc(c.status)}${c.state === 'surface' || c.state === 'descent' ? ` · ${fmtLL(la, lo)}` : ''}</div></div><span class="pbtns">${c.state !== 'lost' ? `<button data-act="cview" data-id="${c.id}">${c.kind === 'rover' ? 'Drive' : 'View'}</button>` : ''}<button data-act="mission">Back</button><button data-act="cdrop" data-id="${c.id}">Retire</button></span></div>`;
    const stat = (k: string, x: string) => `<div class="pstat"><span>${k}</span><b>${x}</b></div>`;
    h += '<div class="pgrid">' + stat('Mission time', fmtTime(c.age))
      + (c.kind === 'rover' ? stat('Driven', `${(c.odo / 1000).toFixed(2)} km`) : '')
      + (c.kind === 'orbiter' ? stat('Mapped', `${(c.cover * 100).toFixed(0)}%`) : '')
      + (c.orbit ? stat('Orbit', `${((c.orbit.r - c.b.r * AU_M) / 1000).toFixed(0)} km up`) : '')
      + (c.kind === 'base' ? stat('Built', `${(c.build * 100).toFixed(0)}%`) : '')
      + (c.state === 'descent' ? stat('Altitude', `${(c.alt / 1000).toFixed(1)} km`) : '') + '</div>';
    if (c.profile.length > 1) h += `<div class="psub">Descent profile</div>${profileSvg(c.profile)}<table class="ptab small"><tr><td>Height</td><td>Pressure · temperature</td></tr>${c.profile.filter((_, k) => k % Math.max(1, Math.floor(c.profile.length / 14)) === 0 || k === c.profile.length - 1).map(p => `<tr><td>${p.z.toFixed(1)} km</td><td>${p.bar > 1e-4 ? `${p.bar.toPrecision(3)} bar` : p.bar > 0 ? `${p.bar.toExponential(1)} bar` : 'vacuum'} · ${Math.round(p.T)} K${p.note ? ` · ${esc(p.note)}` : ''}</td></tr>`).join('')}</table>`;
    if (c.kind === 'orbiter' && c.cover >= 0.6) h += this.science(c.b, v.stars());
    h += `<div class="psub">Log</div>${c.log.slice().reverse().map(r => `<div class="prow tight"><div><span class="pdim">T+${fmtTime(r.t)}</span> ${esc(r.msg)}</div></div>`).join('')}`;
    return h;
  }

  /** standing on a world: what the suit's instruments read here */
  private scan() {
    const v = this.v, G = v.ground, b = G.body, S = v.surf;
    if (!b || !G.atmo || v.mode !== 'surface') return '<p class="pdim">Step out onto a world to scan it.</p>';
    const [la, lo] = latLonOf(S.n), z = G.heightAt(S.n, 1), smp = G.last_sample;
    const g = gravity(b), air = airAt(G.atmo, g, Math.max(0, z) / 1000);
    const stat = (k: string, x: string) => `<div class="pstat"><span>${k}</span><b>${x}</b></div>`;
    let h = `<div class="phero"><div><div class="pbig">${esc(b.name)}</div><div class="pdim">${fmtLL(la, lo)} · ${z.toFixed(0)} m ${z >= 0 ? 'above' : 'below'} the datum</div></div></div>`;
    h += '<div class="pgrid">' + stat('Gravity', `${(g / 9.81).toFixed(3)} g`) + stat('Air pressure', air.bar > 1e-4 ? `${air.bar.toPrecision(3)} bar` : 'vacuum')
      + stat('Temperature', `${Math.round(air.T)} K · ${Math.round(air.T - 273.15)} °C`) + stat('Daylight', G.daylight > 0.6 ? 'day' : G.daylight > 0.05 ? 'twilight' : 'night') + '</div>';
    h += `<div class="psub">Air here</div>${G.atmo.kind === 'thin' || G.atmo.kind === 'thick' ? atmoTable({ ...G.atmo, bar: air.bar, T: air.T }) : atmoTable(G.atmo)}`;
    const cp = composition(b);
    if (cp.rows.length) h += `<div class="psub">Under your feet</div><div class="prow tight"><div><span class="pdot" style="background:rgb(${Math.round(smp.r * 255)},${Math.round(smp.g * 255)},${Math.round(smp.b * 255)})"></span> ${smp.rock > 0.5 ? 'rocky, boulder-strewn' : 'fine soil and pebbles'}</div></div>${bars(cp.rows)}`;
    const L = G.lifeInfo!;
    h += `<div class="psub">Life nearby</div>`;
    if (b.look.real === 'Earth' && G.biome) {
      const sp = speciesIn(G.biome);
      h += `<p class="pdim">Biome: <b>${G.biome}</b>. Living here:</p>` + sp.map(x => `<div class="prow tight"><div><span class="pdot" style="background:#${x.color.toString(16).padStart(6, '0')}"></span><b>${esc(x.name)}</b> <i class="pdim">${esc(x.latin)}</i> <span class="pdim">· ${x.kind}${x.size ? ` · ${x.size} m` : ''}</span></div></div>`).join('');
    } else h += `<div class="pland ${L.tier === 'none' ? 'no' : L.tier === 'candidate' ? 'maybe' : 'ok'}">${esc(L.verdict)}</div>` + L.forms.map(f => `<div class="prow tight"><div><b>${esc(f.name)}</b> <span class="pdim">${f.kind} · ${esc(f.about)}</span></div></div>`).join('');
    const finds = v.logbook.finds.filter(x => x.where === b.name);
    if (finds.length) h += `<div class="psub">Found here so far</div>${finds.map(x => `<div class="prow tight"><div><b>${esc(x.what)}</b> <span class="pdim">${esc(x.note)}</span></div></div>`).join('')}`;
    return h;
  }

  private power() {
    const sh = this.v.ship;
    const opts = (Object.keys(POWER) as Power[]).map(p => {
      const P = POWER[p], on = sh.power === p;
      return `<button class="popt${on ? ' on' : ''}" data-act="power" data-id="${p}"><b>${P.name}</b><span>${P.about}</span>`
        + `<span class="pdim">overdrive spools in ${P.spool} s · wormhole recharge ${P.refill} s</span></button>`;
    }).join('');
    const ch = sh.worm ? 'in use' : sh.charge >= 1 ? 'charged' : `${(sh.charge * 100).toFixed(0)}% · ${Math.ceil((1 - sh.charge) * sh.refill())} s to full`;
    return `<div class="pgrid"><div class="pstat"><span>Overdrive</span><b>${sh.od ? `${(sh.odLevel * 100).toFixed(0)}%` : 'off'}</b></div><div class="pstat"><span>Wormhole drive</span><b>${ch}</b></div></div>${opts}`;
  }

  private bay() {
    const v = this.v, P = v.shipPos(), stars = v.stars();
    const near = v.app.visual.filter(b => b.source && !['star', 'wd', 'ns', 'bh'].includes(b.cls) && !b.look.craft)
      .map(b => ({ b, d: Math.hypot(b.x - P[0], b.y - P[1], b.z - P[2]) }))
      .sort((a, c) => a.d - c.d).slice(0, 10);
    const rows = near.map(({ b, d }) => {
      const s = survey(b, stars, null);
      return `<div class="prow"><div><div class="pnm"><span class="${s.land.ok ? 'pok' : 'pno'}">${s.land.ok ? '✓' : '✗'}</span> ${esc(b.name)}</div><div class="pdim">${fmtLength(Math.max(0, d - b.r))} · ${sig(s.g, 2)} g · ${esc(s.land.why)}</div></div>${this.btns(b)}</div>`;
    }).join('');
    return `<div class="phero"><div class="pdim">Probes, orbiters, landers, rovers, stations and bases launch from here.</div><button data-act="mission">Mission control</button></div>`
      + `<p class="pdim">The landers are rated for up to ${LANDER.maxG} g, ${LANDER.maxK} K and ${LANDER.maxBar} bar, on anything wider than ${LANDER.minKm} km. Nearby worlds:</p>${rows}`;
  }
}

/** a year in seconds, for the sleep */
export const SLEEP_HOURS = 8;
export const sleepWarp = (seconds: number) => (SLEEP_HOURS * 3600) / seconds / YEAR_S;

/** an atmosphere as the reader shows it: the pressure and temperature, and every gas to the last part per million */
function atmoTable(a: Atmosphere) {
  if (a.kind === 'none' || !a.gases.length) return `<div class="pland no">No atmosphere. ${esc(a.note)}</div>`;
  const head = a.kind === 'exosphere' ? `An exosphere only${a.bar > 0 ? `, about ${a.bar.toExponential(0)} bar` : ''}: a few atoms, no weather.` : a.kind === 'giant' ? `At the 1-bar level: ${Math.round(a.T)} K. Scale height ${a.H.toFixed(1)} km.` : `${a.bar.toPrecision(3)} bar at the surface, ${Math.round(a.T)} K. Scale height ${a.H.toFixed(1)} km.`;
  return `<p class="pdim">${head} Clouds: ${esc(a.clouds)}.</p>` + bars(a.gases.map(x => [`${x.f} · ${x.name}`, x.x * 100]), true) + `<p class="pdim">${esc(a.note)}</p>`;
}

/** shares as bars, largest first */
function bars(rows: [string, number][], gas = false) {
  const max = Math.max(...rows.map(r => r[1]), 1e-9);
  return `<div class="pbars">${rows.map(([k, x]) => `<div class="pbar"><span>${esc(k)}</span><i style="width:${Math.max(0.5, (Math.log10(1 + x * 9 / max * 10) / Math.log10(91)) * 100).toFixed(1)}%"></i><b>${gas ? pct(x / 100) : `${x.toFixed(1)}%`}</b></div>`).join('')}</div>`;
}

/** a world cut open: its layers as rings, a quarter taken out */
function cutaway(layers: Layer[]) {
  const R = 70, c = 76;
  let s = `<svg viewBox="0 0 152 152" class="pcutsvg"><circle cx="${c}" cy="${c}" r="${R}" fill="#${(layers[layers.length - 1]?.color ?? 0x888888).toString(16).padStart(6, '0')}" opacity="0.35"/>`;
  for (const l of layers.slice().reverse()) {
    const r = l.r1 * R, col = `#${l.color.toString(16).padStart(6, '0')}`;
    s += `<path d="M${c},${c} L${c},${c - r} A${r},${r} 0 1,1 ${c - r},${c} Z" fill="${col}"/>`;
  }
  return s + '</svg>';
}

/** a probe's descent: temperature (orange) and pressure (blue, log) against height */
function profileSvg(p: { z: number; bar: number; T: number }[]) {
  const W = 300, H = 140, zs = p.map(x => x.z), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const Ts = p.map(x => x.T), t0 = Math.min(...Ts) * 0.95, t1 = Math.max(...Ts) * 1.05;
  const lp = p.map(x => Math.log10(Math.max(x.bar, 1e-6))), p0 = Math.min(...lp), p1 = Math.max(...lp) + 0.01;
  const y = (z: number) => H - 8 - ((z - z0) / Math.max(1e-6, z1 - z0)) * (H - 16);
  const xT = (t: number) => 8 + ((t - t0) / Math.max(1e-6, t1 - t0)) * (W - 16);
  const xP = (l: number) => 8 + ((l - p0) / Math.max(1e-6, p1 - p0)) * (W - 16);
  const line = (pts: string, col: string) => `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="pprof">${line(p.map(x => `${xT(x.T).toFixed(1)},${y(x.z).toFixed(1)}`).join(' '), '#ffa060')}${line(p.map((x, k) => `${xP(lp[k]).toFixed(1)},${y(x.z).toFixed(1)}`).join(' '), '#70c0ff')}<text x="8" y="12" class="t">${z1.toFixed(0)} km</text><text x="8" y="${H - 2}" class="t">${z0.toFixed(0)} km</text><text x="${W - 8}" y="12" text-anchor="end" class="t"><tspan fill="#ffa060">temperature</tspan> · <tspan fill="#70c0ff">pressure (log)</tspan></text></svg>`;
}
