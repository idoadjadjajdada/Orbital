import type { Body } from '../physics/body';
import { AU_M, YEAR_S, fmtLength, fmtDuration, sig } from '../physics/units';
import { BTN } from '../ui/gamepad';
import type { View3D } from './view3d';
import { POWER, type Power } from './ship';
import { survey, LANDER } from './survey';
import type { CraftKind, Craft } from './crafts';
import { fmtTime } from './radar';

/**
 * The ship's consoles, as panels over the view: the comms log and the sensor
 * sweep on the bridge, the captain's log in the quarters, the survey in the
 * lab, power routing in engineering and the landing survey in the hangar.
 * They refresh once a second while open; Esc, F, E or the controller's B
 * closes them.
 */

export type PanelKind = 'comms' | 'sensors' | 'log' | 'survey' | 'power' | 'bay' | 'mission';

const TITLE: Record<PanelKind, string> = {
  comms: 'Comms log', sensors: 'Sensor sweep', log: "Captain's log", survey: 'Science survey', power: 'Power routing', bay: 'Hangar · landing survey', mission: 'Mission control',
};
type Tab = 'overview' | 'air' | 'interior' | 'life';
const KINDS: [CraftKind, string, string][] = [
  ['probe', 'Probe', 'falls through the air reporting pressure, heat and gases until it lands or is crushed; on an airless world, an impactor'],
  ['orbiter', 'Orbiter', 'circles it for real, mapping and reading its air by spectra'],
  ['lander', 'Lander', 'sets down and runs its instruments: soil, weather, a life scan'],
  ['rover', 'Rover', 'lands, then you drive it about and scan as you go'],
  ['station', 'Station', 'a crewed station in orbit, ISS-style'],
  ['base', 'Base', 'a crewed base on the ground, beside the ship'],
];

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
  /** the survey's tab, and the craft whose log is open in mission control */
  private tab: Tab = 'overview';
  private openCraft = 0;
  /** with a controller: which button the d-pad has picked */
  private focus = -1;

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

  show(kind: PanelKind) {
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
    else if (a === 'tab') this.tab = id as Tab;
    else if (a === 'deploy') { const t = this.missionTarget(); if (t) v.fleet.deploy(id as CraftKind, t); }
    else if (a === 'shuttle') { this.close(); v.fleet.launchShuttle(); return; }
    else if (a === 'cview' || a === 'cdrive') { const c = v.fleet.crafts.find(x => x.id === Number(id)); if (c) { this.close(); v.fleet.take(c, a === 'cdrive'); } return; }
    else if (a === 'clog') this.openCraft = this.openCraft === Number(id) ? 0 : Number(id);
    else if (a === 'cgo') { const c = v.fleet.crafts.find(x => x.id === Number(id)); if (c) { v.goTo(c.body ?? c.target); this.close(); } return; }
    else if (a === 'cscrap') { const c = v.fleet.crafts.find(x => x.id === Number(id)); if (c) v.fleet.scrap(c); }
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
      + stat('Craft sent out', String(v.fleet.crafts.filter(c => c.kind !== 'shuttle').length))
      + stat('Species found', String([...v.science.found.values()].reduce((k, m) => k + m.size, 0)))
      + '</div>';
    const disc = [...v.science.found.entries()].filter(([, m]) => m.size);
    if (disc.length) {
      h += '<div class="psub">Discoveries</div>';
      for (const [w, m] of disc) h += `<div class="prow"><div><div class="pnm">${esc(w)}</div><div class="pdim">${[...m.values()].map(x => `<i>${esc(x.name)}</i> (${esc(x.common)})`).join(', ')}</div></div></div>`;
    }
    if (v.science.log.length) {
      h += '<div class="psub">Science log</div>';
      h += v.science.log.slice(0, 12).map(l => `<div class="prow"><div class="pdim">${esc(l.text)}</div></div>`).join('');
    }
    h += '<div class="psub">Visited</div>';
    h += L.firsts.length ? L.firsts.slice().reverse().map(f => `<div class="prow"><div><div class="pnm">${esc(f.name)}</div><div class="pdim">${esc(f.note)}</div></div></div>`).join('')
      : '<p class="pdim">Nowhere yet. Fly within a few radii of a world and it goes in the log, on the shelf, and into the sample locker.</p>';
    return h;
  }

  private survey() {
    const v = this.v, b = v.surveyTarget();
    if (!b) return '<p class="pdim">Nothing to survey. Select something, or fly near it.</p>';
    const picked = b === v.app.selected;
    const tabs = (['overview', 'air', 'interior', 'life'] as Tab[]).map(t => `<button data-act="tab" data-id="${t}"${this.tab === t ? ' class="on"' : ''}>${{ overview: 'Overview', air: 'Atmosphere', interior: 'Interior', life: 'Life' }[t]}</button>`).join('');
    const head = `<div class="phero"><div><div class="pbig">${esc(b.name)}</div><div class="pdim">${esc(survey(b, [], null).kind)}${picked ? ' · selected' : ' · nearest'} · ${this.sources(b)}</div></div>${this.btns(b, true)}</div><div class="ptabs">${tabs}</div>`;
    return head + (this.tab === 'air' ? this.air(b) : this.tab === 'interior' ? this.interior(b) : this.tab === 'life' ? this.life(b) : this.overview(b));
  }

  /** where the data come from */
  private sources(b: Body) {
    const sc = this.v.science, have: string[] = [];
    if (sc.knows(b, 'mapped')) have.push('orbiter');
    if (sc.knows(b, 'sampled')) have.push('probe');
    if (sc.knows(b, 'landed')) have.push('ground');
    return have.length ? `data from: ${have.join(', ')}` : 'from the ship';
  }

  private overview(b: Body) {
    const v = this.v, s = survey(b, v.stars(), v.app.hostOf(b));
    return `<table class="ptab">${s.rows.map(([k, x]) => `<tr><td>${k}</td><td>${esc(x)}</td></tr>`).join('')}</table>`
      + `<div class="pland ${s.land.ok ? 'ok' : 'no'}">${s.land.ok ? '✓' : '✗'} ${esc(s.land.why)}</div>`
      + `<p class="pdim">${esc(v.landing.shipBlock(b) ? `The ship cannot land: ${v.landing.shipBlock(b)}.` : 'The ship can land here: fly within 40 km of the ground and press L.')}</p>`;
  }

  /** the atmosphere reader: what the air is made of, measured or reckoned */
  private air(b: Body) {
    const v = this.v, a = v.science.atmosphere(b);
    const S = v.shipPos(), d = Math.hypot(S[0] - b.x, S[1] - b.y, S[2] - b.z);
    const close = d < 60 * b.r || v.science.knows(b, 'spectra') || v.science.knows(b, 'sampled') || v.science.knows(b, 'landed');
    if (!close) return '<p class="pdim">Too far for the spectrometer to read its air. Fly within about 60 radii, or send an orbiter or a probe.</p>';
    const pct = (f: number) => f >= 0.001 ? `${(f * 100).toFixed(f >= 0.1 ? 2 : 3)}%` : f >= 1e-6 ? `${(f * 1e6).toFixed(f >= 1e-5 ? 0 : 1)} ppm` : `${(f * 1e9).toFixed(1)} ppb`;
    const bar = (f: number) => `<span class="pbar"><i style="width:${Math.max(1, Math.min(100, Math.sqrt(f) * 100)).toFixed(1)}%"></i></span>`;
    let h = `<div class="pland ${a.exists ? 'ok' : 'no'}">${a.exists ? (a.kind === 'envelope' ? 'A giant’s envelope: gas all the way down' : `An atmosphere: ${a.surfaceBar < 0.01 ? `${(a.surfaceBar * 1e5).toPrecision(2)} Pa` : `${a.surfaceBar.toPrecision(3)} bar`} at the ground`) : a.kind === 'exosphere' ? 'No atmosphere: only a thin exosphere' : 'No atmosphere'}</div>`;
    if (a.exists) {
      h += `<table class="ptab"><tr><td>${a.kind === 'envelope' ? 'Temperature at 1 bar' : 'Surface temperature'}</td><td>${Math.round(a.surfaceK)} K · ${Math.round(a.surfaceK - 273.15)} °C</td></tr>`
        + `<tr><td>Scale height</td><td>${a.scaleHeightKm.toFixed(1)} km</td></tr><tr><td>Mean molar mass</td><td>${a.molarMass.toFixed(2)} g/mol</td></tr></table>`;
    }
    const gases = a.gases.length ? a.gases : [];
    if (gases.length) h += '<div class="psub">Composition</div>' + gases.map(g => `<div class="pgas"><b>${esc(g.formula)}</b><span>${esc(g.name)}</span>${bar(g.frac)}<em>${pct(g.frac)}</em></div>`).join('');
    if (a.trace.length) h += `<div class="psub">${a.exists ? 'Trace' : 'Exosphere'}</div>` + a.trace.map(g => `<div class="pgas"><b>${esc(g.formula)}</b><span>${esc(g.name)}</span>${bar(g.frac)}<em>${pct(g.frac)}</em></div>`).join('');
    if (a.clouds.length) h += '<div class="psub">Cloud decks</div>' + a.clouds.map(c => `<div class="prow"><div><span class="pdot" style="background:#${c.color.toString(16).padStart(6, '0')}"></span> ${esc(c.name)}</div><div class="pdim">${c.altKm >= 0 ? `${c.altKm} km up` : `${-c.altKm} km below 1 bar`}</div></div>`).join('');
    // a probe's descent
    const pr = v.fleet.crafts.filter(c => c.target === b && c.profile.length).pop();
    if (pr) h += `<div class="psub">${esc(pr.name)} · descent profile</div><table class="ptab">${pr.profile.map(p => `<tr><td>${p.altKm.toFixed(1)} km</td><td>${p.bar < 0.01 ? p.bar.toExponential(1) : p.bar.toFixed(p.bar < 1 ? 3 : 1)} bar · ${Math.round(p.K)} K</td></tr>`).join('')}</table>`;
    h += `<p class="pdim">${a.measured ? 'Measured values. ' : 'Reckoned from its mass, size, light and kind: no measurements. '}${esc(a.notes)}</p>`;
    return h;
  }

  /** the interior: a cut through it, layer by layer, and what it is made of */
  private interior(b: Body) {
    const c = this.v.science.composition(b);
    const W = 200, R = 92, cx = 100, cy = 100;
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    let svg = `<svg class="pcut" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}">`;
    // a quarter cut away, as in the textbook pictures
    for (const l of [...c.layers].reverse()) {
      const r = l.r1 * R;
      svg += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${hex(l.color)}" stroke="rgba(0,0,0,0.35)" stroke-width="0.6"/>`;
    }
    svg += `<path d="M${cx},${cy} L${cx + R + 2},${cy} A${R + 2},${R + 2} 0 0,0 ${cx},${cy - R - 2} Z" fill="rgba(4,10,18,0.0)"/>`;
    svg += '</svg>';
    let h = `<div class="pcutw">${svg}<div>${c.layers.slice().reverse().map(l => `<div class="prow"><div><span class="pdot" style="background:${hex(l.color)}"></span> ${esc(l.name)}</div><div class="pdim">${(l.r0 * 100).toFixed(0)}–${(l.r1 * 100).toFixed(0)}% · ${l.state}</div></div>`).join('')}</div></div>`;
    if (c.surface.length) h += '<div class="psub">Surface</div>' + c.surface.map(x => `<div class="pgas"><span>${esc(x.name)}</span><span class="pbar"><i style="width:${(x.frac * 100).toFixed(1)}%"></i></span><em>${(x.frac * 100).toFixed(x.frac < 0.1 ? 1 : 0)}%</em></div>`).join('');
    if (c.bulk.length) h += '<div class="psub">Whole body, by mass</div>' + c.bulk.map(x => `<div class="pgas"><span>${esc(x.name)}</span><span class="pbar"><i style="width:${(x.frac * 100).toFixed(1)}%"></i></span><em>${(x.frac * 100).toFixed(x.frac < 0.1 ? 1 : 0)}%</em></div>`).join('');
    h += `<p class="pdim">${c.measured ? 'From measurements: gravity, seismology, spacecraft. ' : 'A model from its density and kind. '}${esc(c.notes)}</p>`;
    return h;
  }

  /** life: the verdict, the signs, and the species found so far */
  private life(b: Body) {
    const v = this.v, bio = v.science.biosphere(b);
    const found = [...(v.science.found.get(b.name)?.values() ?? [])];
    const lv = { none: 'No life', prebiotic: 'No life found: the chemistry is there', microbial: 'Microbial life', simple: 'Simple life: mats, plants, fronds', complex: 'Complex life: plants and animals', civilisation: 'A civilisation' }[bio.level];
    let h = `<div class="pland ${bio.level === 'none' || bio.level === 'prebiotic' ? 'no' : 'ok'}">${lv} · ${bio.confidence === 'confirmed' ? 'confirmed' : bio.confidence === 'possible' ? 'possible' : 'none known'}</div>`;
    h += `<p>${esc(bio.summary)}</p><table class="ptab"><tr><td>Where</td><td>${esc(bio.where)}</td></tr><tr><td>Habitable</td><td>${bio.habitable ? 'yes' : 'no'}</td></tr></table>`;
    if (bio.reasons.length) h += '<div class="psub">Why</div>' + bio.reasons.map(r => `<div class="prow"><div class="pdim">${esc(r)}</div></div>`).join('');
    if (bio.biosignatures.length) h += '<div class="psub">Signs</div>' + bio.biosignatures.map(r => `<div class="prow"><div class="pdim">${esc(r)}</div></div>`).join('');
    if (bio.species.length) {
      h += `<div class="psub">Species found · ${found.length} of ${bio.species.length}</div>`;
      h += found.length ? found.map(sp => `<div class="prow"><div><div class="pnm"><i>${esc(sp.name)}</i> · ${esc(sp.common)}</div><div class="pdim">${esc(sp.kind)} · ${esc(sp.size)} · ${esc(sp.habitat)}. ${esc(sp.desc)}</div></div></div>`).join('')
        : '<p class="pdim">None yet. Scan on the ground (R) — on foot, from a rover, or with a lander — in different places: forests, seas, deserts, ice.</p>';
    }
    return h;
  }

  /** what mission control sends craft to */
  private missionTarget(): Body | null {
    const v = this.v, sel = v.app.selected;
    if (sel && sel.alive && !sel.look.craft) return sel;
    return v.landing.landed?.b ?? v.landing.shipBody ?? v.nearest(v.shipPos()).b;
  }

  /** mission control: send craft, watch them, drive them */
  private mission() {
    const v = this.v, f = v.fleet, t = this.missionTarget();
    let h = `<div class="psub">Send to ${t ? esc(t.name) : '—'}${t === v.app.selected ? ' (selected)' : ''}</div><div class="pkinds">`;
    for (const [k, name, about] of KINDS) {
      const why = f.block(k, t);
      h += `<button class="pkind" data-act="deploy" data-id="${k}"${why ? ` disabled title="${esc(why)}"` : ''}><b>${f.icon({ kind: k } as Craft)} ${name}</b><span>${esc(why || about)}</span></button>`;
    }
    h += '</div>';
    const sh = f.crafts.find(c => c.kind === 'shuttle');
    h += `<button class="popt" data-act="shuttle" data-id="1"${sh && sh.state !== 'docked' ? ' disabled' : ''}><b>🚀 Fly Lander 1</b><span>${sh && sh.state !== 'docked' ? 'It is out' : 'Take the crewed lander out of the hangar and fly it down yourself'}</span></button>`;
    const list = f.crafts.filter(c => c.kind !== 'shuttle' || c.state !== 'docked');
    h += `<div class="psub">Craft · ${list.length}</div>`;
    if (!list.length) h += '<p class="pdim">Nothing sent out yet. Pick a world (select it, or fly near it) and send something.</p>';
    for (const c of list.slice().reverse()) {
      const live = c.state !== 'lost';
      h += `<div class="prow pcraft"><div><div class="pnm">${f.icon(c)} ${esc(c.name)}</div><div class="pdim">${esc(f.status(c))}</div></div><span class="pbtns">`
        + `<button data-act="cview" data-id="${c.id}"${live ? '' : ' disabled'}>View</button>`
        + (c.kind === 'rover' || c.kind === 'shuttle' ? `<button data-act="cdrive" data-id="${c.id}"${live && (c.state === 'landed' || c.state === 'flying') ? '' : ' disabled'}>Drive</button>` : '')
        + `<button data-act="clog" data-id="${c.id}"${this.openCraft === c.id ? ' class="on"' : ''}>Log</button>`
        + `<button data-act="cgo" data-id="${c.id}">Go</button>`
        + (c.kind !== 'shuttle' ? `<button data-act="cscrap" data-id="${c.id}">✕</button>` : '') + '</span></div>';
      if (this.openCraft === c.id) h += `<div class="plog">${c.log.slice(0, 14).map(l => `<div>${esc(l.text)}</div>`).join('')}</div>`;
    }
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
    const out = v.fleet.shuttle;
    return `<div class="pland ${out ? 'no' : 'ok'}">${out ? `Lander 1 is out: ${esc(v.fleet.status(out))}` : 'Lander 1 is fuelled and ready: use it (here, or from mission control, K) to fly it down yourself'}</div>`
      + `<p class="pdim">Rated for up to ${LANDER.maxG} g, ${LANDER.maxK} K and ${LANDER.maxBar} bar, on anything wider than ${LANDER.minKm} km. Nearby worlds:</p>${rows}`;
  }
}

/** a year in seconds, for the sleep */
export const SLEEP_HOURS = 8;
export const sleepWarp = (seconds: number) => (SLEEP_HOURS * 3600) / seconds / YEAR_S;
