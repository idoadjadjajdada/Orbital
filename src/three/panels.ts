import type { Body } from '../physics/body';
import { AU_M, YEAR_S, fmtLength, fmtDuration, sig } from '../physics/units';
import { BTN } from '../ui/gamepad';
import type { View3D } from './view3d';
import { POWER, type Power } from './ship';
import { survey, LANDER } from './survey';
import { fmtTime } from './radar';

/**
 * The ship's consoles, as panels over the view: the comms log and the sensor
 * sweep on the bridge, the captain's log in the quarters, the survey in the
 * lab, power routing in engineering and the landing survey in the hangar.
 * They refresh once a second while open; Esc, F, E or the controller's B
 * closes them.
 */

export type PanelKind = 'comms' | 'sensors' | 'log' | 'survey' | 'power' | 'bay';

const TITLE: Record<PanelKind, string> = {
  comms: 'Comms log', sensors: 'Sensor sweep', log: "Captain's log", survey: 'Science survey', power: 'Power routing', bay: 'Hangar · landing survey',
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
      + '</div>';
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
    return `<div class="phero"><div><div class="pbig">${esc(s.name)}</div><div class="pdim">${esc(s.kind)}${picked ? ' · selected' : ' · nearest'}</div></div>${this.btns(b, true)}</div>`
      + `<table class="ptab">${s.rows.map(([k, x]) => `<tr><td>${k}</td><td>${esc(x)}</td></tr>`).join('')}</table>`
      + `<div class="pland ${s.land.ok ? 'ok' : 'no'}">${s.land.ok ? '✓' : '✗'} ${esc(s.land.why)}</div>`;
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
    return `<div class="pland no">Lander 1 is not flight-ready: the descent software, the bay doors and the landing legs are still being fitted.</div>`
      + `<p class="pdim">Rated for up to ${LANDER.maxG} g, ${LANDER.maxK} K and ${LANDER.maxBar} bar, on anything wider than ${LANDER.minKm} km. Nearby worlds:</p>${rows}`;
  }
}

/** a year in seconds, for the sleep */
export const SLEEP_HOURS = 8;
export const sleepWarp = (seconds: number) => (SLEEP_HOURS * 3600) / seconds / YEAR_S;
