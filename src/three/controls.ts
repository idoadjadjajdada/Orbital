import * as THREE from 'three';
import type { View3D, Mode } from './view3d';
import type { V3 } from '../pixel/sprites';
import { BTN } from '../ui/gamepad';

/**
 * The controls of the 3D view, for keyboard and mouse, a controller (Xbox
 * layout) and touch, different in each place you can be: at the helm, on
 * foot, outside in a suit, at the telescope. A bar along the bottom shows the
 * main actions for where you are, in the glyphs of whatever you last
 * touched; a prompt under the crosshair says what you can use; H shows the
 * lot.
 */

type Dev = 'kb' | 'pad' | 'touch';
interface Bind { k: string[]; p: string[]; t: string; bar?: boolean }

const BINDS: Record<Mode, Bind[]> = {
  pilot: [
    { k: ['W', 'A', 'S', 'D'], p: ['LS'], t: 'Fly' },
    { k: ['Mouse'], p: ['RS'], t: 'Steer' },
    { k: ['Space', 'C'], p: ['RT', 'LT'], t: 'Up · down' },
    { k: ['Q', 'E'], p: ['LB', 'RB'], t: 'Roll' },
    { k: ['Shift'], p: ['L3'], t: 'Boost' },
    { k: ['Wheel', '+', '−'], p: ['▲', '▼'], t: 'Throttle' },
    { k: ['Click'], p: ['A'], t: 'Select', bar: true },
    { k: ['T'], p: ['A', 'A'], t: 'Fly to target', bar: true },
    { k: ['O'], p: ['X'], t: 'Overdrive', bar: true },
    { k: ['J'], p: ['Y'], t: 'Wormhole', bar: true },
    { k: ['M'], p: ['View'], t: 'Nav map', bar: true },
    { k: ['Z'], p: ['R3'], t: 'Camera' },
    { k: ['F'], p: ['B'], t: 'Leave the helm', bar: true },
    { k: [], p: ['◀', '▶'], t: 'Next target' },
    { k: ['V'], p: ['Menu'], t: 'Back to the 2D map' },
  ],
  walk: [
    { k: ['W', 'A', 'S', 'D'], p: ['LS'], t: 'Walk' },
    { k: ['Mouse'], p: ['RS'], t: 'Look' },
    { k: ['Shift'], p: ['L3'], t: 'Run' },
    { k: ['Space'], p: ['X'], t: 'Jump' },
    { k: ['F', 'Click'], p: ['A'], t: 'Use', bar: true },
    { k: ['M'], p: ['View'], t: 'Nav map', bar: true },
    { k: ['V'], p: ['Menu'], t: 'Back to the 2D map' },
  ],
  eva: [
    { k: ['W', 'A', 'S', 'D'], p: ['LS'], t: 'Thrusters' },
    { k: ['Mouse'], p: ['RS'], t: 'Look' },
    { k: ['Space', 'C'], p: ['RT', 'LT'], t: 'Up · down' },
    { k: ['Q', 'E'], p: ['LB', 'RB'], t: 'Roll' },
    { k: ['Shift'], p: ['L3'], t: 'Boost' },
    { k: ['Wheel', '+', '−'], p: ['▲', '▼'], t: 'Thrust level' },
    { k: ['Click'], p: ['A'], t: 'Select' },
    { k: ['F'], p: ['A'], t: 'Board (at the airlock)', bar: true },
    { k: ['G'], p: ['X'], t: 'Call the ship', bar: true },
    { k: ['M'], p: ['View'], t: 'Nav map', bar: true },
    { k: [], p: ['◀', '▶'], t: 'Next target' },
    { k: ['V'], p: ['Menu'], t: 'Back to the 2D map' },
  ],
  scope: [
    { k: ['Mouse'], p: ['RS'], t: 'Aim' },
    { k: ['Wheel', '+', '−'], p: ['RT', 'LT'], t: 'Zoom', bar: true },
    { k: ['Click'], p: ['A'], t: 'Select', bar: true },
    { k: ['T'], p: ['X'], t: 'Track the target', bar: true },
    { k: ['F', 'Esc'], p: ['B'], t: 'Step back', bar: true },
  ],
};

const TITLE: Record<Mode, string> = { pilot: 'At the helm', walk: 'On foot', eva: 'Spacewalk', scope: 'Telescope' };

/** touch buttons for each place */
const TOUCH: Record<Mode, [string, string][]> = {
  pilot: [['up', '▲'], ['down', '▼'], ['boost', 'Boost'], ['slower', '−'], ['faster', '+'], ['go', 'Go to'], ['od', 'Overdrive'], ['jump', 'Wormhole'], ['map', 'Map'], ['view', 'Camera'], ['leave', 'Leave helm']],
  walk: [['jump', 'Jump'], ['use', 'Use'], ['map', 'Map']],
  eva: [['up', '▲'], ['down', '▼'], ['boost', 'Boost'], ['slower', '−'], ['faster', '+'], ['use', 'Board'], ['call', 'Call ship'], ['map', 'Map']],
  scope: [['zin', 'Zoom +'], ['zout', 'Zoom −'], ['track', 'Track'], ['leave', 'Step back']],
};

export class Controls3D {
  throttle = 1;
  private keys = new Set<string>();
  private stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0 };
  private look = { id: -1, x: 0, y: 0, moved: 0 };
  private hold = { up: false, down: false, boost: false, jump: false };
  /** boost latched on by clicking the left stick, until the stick is let go */
  private padBoost = false;
  /** what was used last, for the glyphs */
  private dev: Dev = matchMedia('(pointer: coarse)').matches ? 'touch' : 'kb';
  readonly root: HTMLElement;
  private topEl: HTMLElement;
  private barEl: HTMLElement;
  private useEl: HTMLElement;
  private sheetEl: HTMLElement;
  private btnsEl: HTMLElement;
  private knob: HTMLElement;
  private flashEl: HTMLElement;
  private shownMode: Mode | null = null;
  private barKey = '';

  constructor(private v: View3D) {
    this.root = document.createElement('div');
    this.root.id = 'ui3';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="xhair"></div>
      <div class="visor3"></div>
      <div class="scope3"></div>
      <div class="top3"></div>
      <div class="use3" hidden></div>
      <div class="bar3"></div>
      <div class="flash3"></div>
      <div class="stick3"><div class="knob3"></div></div>
      <div class="btns3"></div>
      <div class="sheet3" hidden></div>`;
    document.body.appendChild(this.root);
    const $ = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.topEl = $('.top3');
    this.barEl = $('.bar3');
    this.useEl = $('.use3');
    this.sheetEl = $('.sheet3');
    this.btnsEl = $('.btns3');
    this.knob = $('.knob3');
    this.flashEl = $('.flash3');
    const stick = $('.stick3');

    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    this.barEl.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-help]')) this.sheet(); });
    this.useEl.addEventListener('click', () => this.v.prompt?.act());
    this.sheetEl.addEventListener('click', e => { if ((e.target as HTMLElement).closest('.close')) this.sheet(false); });

    const cv = v.canvas;
    cv.addEventListener('click', () => {
      if (!this.v.active || this.v.nav.open) return;
      if (document.pointerLockElement === cv) this.primary();
      else if (matchMedia('(pointer: fine)').matches) cv.requestPointerLock?.();
    });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== cv) return;
      this.dev = 'kb';
      this.v.turn(-e.movementX * 0.0022, -e.movementY * 0.0022, 0);
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.dev = 'kb'; this.zoom(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

    // touch: the stick
    stick.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.dev = 'touch';
      stick.setPointerCapture(e.pointerId);
      const r = stick.getBoundingClientRect();
      this.stick = { x: 0, y: 0, id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    stick.addEventListener('pointermove', e => {
      if (e.pointerId !== this.stick.id) return;
      const R = 50;
      let dx = (e.clientX - this.stick.cx) / R, dy = (e.clientY - this.stick.cy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.stick.x = dx; this.stick.y = dy;
      this.knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    });
    const release = (e: PointerEvent) => { if (e.pointerId === this.stick.id) { this.stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0 }; this.knob.style.transform = ''; } };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    // touch (and pen): drag to look, tap to select or use
    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || !this.v.active) return;
      this.dev = 'touch';
      cv.setPointerCapture(e.pointerId);
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    });
    cv.addEventListener('pointermove', e => {
      if (e.pointerId !== this.look.id) return;
      const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y;
      this.look.x = e.clientX; this.look.y = e.clientY;
      this.look.moved += Math.abs(dx) + Math.abs(dy);
      this.v.turn(dx * 0.004, dy * 0.004, 0);
    });
    const lookEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.look.id) return;
      if (this.look.moved < 8) {
        if (this.v.mode === 'walk') this.v.prompt?.act();
        else this.app().select(this.v.pick(e.clientX, e.clientY));
      }
      this.look.id = -1;
    };
    cv.addEventListener('pointerup', lookEnd);
    cv.addEventListener('pointercancel', lookEnd);

    this.btnsEl.addEventListener('pointerdown', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-b]');
      if (!b) return;
      e.preventDefault();
      this.dev = 'touch';
      const k = b.dataset.b!;
      if (k === 'up' || k === 'down' || k === 'boost' || k === 'jump') this.hold[k] = true;
      this.touchButton(k);
    });
    const off = () => { this.hold.up = this.hold.down = this.hold.boost = this.hold.jump = false; };
    this.btnsEl.addEventListener('pointerup', off);
    this.btnsEl.addEventListener('pointercancel', off);
    this.btnsEl.addEventListener('pointerleave', off);
  }

  private app() { return this.v.app; }

  show(on: boolean) {
    this.root.hidden = !on;
    this.keys.clear();
    if (!on) this.sheet(false);
  }

  /** the nav map closed: nothing held carries over */
  mapClosed() { this.keys.clear(); }

  /** the click, tap or A button: select at the helm and outside, use on foot */
  private primary() {
    const v = this.v;
    if (v.mode === 'walk') { v.prompt?.act(); return; }
    this.app().select(v.pick());
  }

  private zoom(k: number) {
    if (this.v.mode === 'scope') this.v.scope.fov = clamp(this.v.scope.fov / k, 0.02, 40);
    else this.throttle = clamp(this.throttle * k, 1e-3, 1e3);
  }

  private goSelected() {
    const s = this.app().selected;
    if (s && s.alive) this.v.goTo(s);
  }

  private jumpSelected() {
    const s = this.app().selected;
    if (s && s.alive) this.v.jumpTo(s);
    else this.app().onToast('Pick a destination for the wormhole first');
  }

  private toggleOd() {
    const sh = this.v.ship;
    if (sh.worm) return;
    sh.od = !sh.od;
    if (sh.od) this.v.travel = null;
  }

  /** the controls sheet */
  sheet(on = this.sheetEl.hidden) {
    this.sheetEl.hidden = !on;
    if (!on) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const pad = this.dev === 'pad';
    const order: Mode[] = [this.v.mode, ...(['pilot', 'walk', 'eva', 'scope'] as Mode[]).filter(m => m !== this.v.mode)];
    this.sheetEl.innerHTML = `<div class="fhead">Controls <button class="icon close">✕</button></div><div class="cols">`
      + order.map(m => `<div class="col${m === this.v.mode ? ' now' : ''}"><div class="bsub">${TITLE[m]}</div><table>`
        + BINDS[m].map(b => `<tr><td>${b.t}</td><td>${glyphs(b.k, 'kb')}</td><td>${glyphs(b.p, 'pad')}</td></tr>`).join('')
        + `</table></div>`).join('')
      + `</div><p>${pad ? 'Showing the keyboard and the controller.' : 'Plug in a controller and its buttons show here too.'} Use the helm to fly; leave it to walk the ship, which flies on by itself — the autopilot and wormholes included. The airlock is off the commons to port; outside, the ship holds station until you call it.</p>`;
  }

  /** a touch button */
  private touchButton(k: string) {
    const v = this.v;
    if (k === 'slower') this.throttle = clamp(this.throttle / 2, 1e-3, 1e3);
    if (k === 'faster') this.throttle = clamp(this.throttle * 2, 1e-3, 1e3);
    if (k === 'go') this.goSelected();
    if (k === 'od') this.toggleOd();
    if (k === 'jump' && v.mode === 'pilot') this.jumpSelected();
    if (k === 'map') v.openMap();
    if (k === 'view') v.ship.view = v.ship.view === 'chase' ? 'cockpit' : 'chase';
    if (k === 'leave') { if (v.mode === 'scope') v.leaveScope(); else v.leaveHelm(); }
    if (k === 'use') v.prompt?.act();
    if (k === 'call') v.callShip();
    if (k === 'zin') this.zoom(2);
    if (k === 'zout') this.zoom(0.5);
    if (k === 'track') v.scope.track = !v.scope.track;
  }

  private key(e: KeyboardEvent, down: boolean) {
    const v = this.v;
    if (!v.active) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (!down) { this.keys.delete(e.code); return; }
    this.dev = 'kb';
    if (v.nav.open) { v.nav.key(e); return; }
    if (e.code === 'KeyH' && !e.repeat) { this.sheet(); return; }
    if (e.code === 'Escape') {
      if (!this.sheetEl.hidden) this.sheet(false);
      else if (v.mode === 'scope') v.leaveScope();
      return;
    }
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'KeyF', 'KeyG'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoom(2);
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoom(0.5);
    if (e.repeat) return;
    if (e.code === 'KeyM') v.openMap();
    switch (v.mode) {
      case 'pilot':
        if (e.code === 'KeyT') this.goSelected();
        if (e.code === 'KeyO') this.toggleOd();
        if (e.code === 'KeyJ') this.jumpSelected();
        if (e.code === 'KeyZ') v.ship.view = v.ship.view === 'chase' ? 'cockpit' : 'chase';
        if (e.code === 'KeyF') v.leaveHelm();
        break;
      case 'walk':
        if (e.code === 'KeyF' || e.code === 'KeyE') v.prompt?.act();
        break;
      case 'eva':
        if (e.code === 'KeyF') v.prompt?.act();
        if (e.code === 'KeyG') v.callShip();
        break;
      case 'scope':
        if (e.code === 'KeyF') v.leaveScope();
        if (e.code === 'KeyT') v.scope.track = !v.scope.track;
        break;
    }
  }

  /** is the pilot asking to move (which cancels an autopilot)? */
  moving() {
    const k = this.keys, p = this.app().pad;
    return k.has('KeyW') || k.has('KeyS') || k.has('KeyA') || k.has('KeyD') || k.has('Space') || k.has('KeyC')
      || this.stick.id >= 0 || this.hold.up || this.hold.down
      || !!(p.ls[0] || p.ls[1] || p.lt || p.rt);
  }

  update(dt: number) {
    const k = this.keys, p = this.app().pad, v = this.v;
    if (v.nav.open || !this.sheetEl.hidden && this.dev !== 'pad') return;
    if (v.mode === 'pilot' || v.mode === 'eva') {
      const roll = (k.has('KeyQ') || p.on(BTN.LB) ? 1 : 0) - (k.has('KeyE') || p.on(BTN.RB) ? 1 : 0);
      if (roll) v.turn(0, 0, roll * dt * 1.4);
    }
    if (p.connected) this.padUpdate(dt);
  }

  private padUpdate(dt: number) {
    const p = this.app().pad, v = this.v;
    const any = p.ls[0] || p.ls[1] || p.rs[0] || p.rs[1] || p.lt || p.rt || [0, 1, 2, 3, 4, 5, 8, 10, 11, 12, 13, 14, 15].some(b => p.hit(b));
    if (any) this.dev = 'pad';
    if (!this.sheetEl.hidden) { if (p.hit(BTN.B) || p.hit(BTN.A)) this.sheet(false); return; }
    if (p.rs[0] || p.rs[1]) v.turn(-p.rs[0] * 2.4 * dt, -p.rs[1] * 1.8 * dt, 0);
    if (p.hit(BTN.LS)) this.padBoost = !this.padBoost;
    if (!p.ls[0] && !p.ls[1]) this.padBoost = false;
    if (p.hit(BTN.VIEW)) { v.openMap(); return; }
    const P = v.where(), at = { x: P[0], y: P[1], z: P[2] };
    switch (v.mode) {
      case 'pilot': {
        if (p.hit(BTN.A)) {
          // the first press picks what is under the crosshair; again, or with nothing there, flies to the selection
          const b = v.pick(), sel = this.app().selected;
          if (b && b !== sel) this.app().select(b);
          else this.goSelected();
        }
        if (p.hit(BTN.B)) v.leaveHelm();
        if (p.hit(BTN.X)) this.toggleOd();
        if (p.hit(BTN.Y)) this.jumpSelected();
        if (p.hit(BTN.RS)) v.ship.view = v.ship.view === 'chase' ? 'cockpit' : 'chase';
        if (p.hit(BTN.UP)) this.zoom(2);
        if (p.hit(BTN.DOWN)) this.zoom(0.5);
        if (p.hit(BTN.RIGHT)) this.app().cycle(1, at);
        if (p.hit(BTN.LEFT)) this.app().cycle(-1, at);
        break;
      }
      case 'walk':
        if (p.hit(BTN.A)) v.prompt?.act();
        break;
      case 'eva':
        if (p.hit(BTN.A)) { if (v.prompt) v.prompt.act(); else this.primary(); }
        if (p.hit(BTN.X)) v.callShip();
        if (p.hit(BTN.UP)) this.zoom(2);
        if (p.hit(BTN.DOWN)) this.zoom(0.5);
        if (p.hit(BTN.RIGHT)) this.app().cycle(1, at);
        if (p.hit(BTN.LEFT)) this.app().cycle(-1, at);
        break;
      case 'scope':
        if (p.lt || p.rt) this.zoom(Math.exp((p.rt - p.lt) * 2 * dt));
        if (p.hit(BTN.A)) this.primary();
        if (p.hit(BTN.X)) v.scope.track = !v.scope.track;
        if (p.hit(BTN.B)) v.leaveScope();
        break;
    }
  }

  /** the velocity the pilot (or the suit) is asking for, world frame, m/s, given which way it faces */
  thrust(speed: number, q: THREE.Quaternion): V3 {
    if (this.v.nav.open) return [0, 0, 0];
    const k = this.keys, p = this.app().pad;
    let f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) - this.stick.y - p.ls[1];
    let s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.stick.x + p.ls[0];
    let u = (k.has('Space') || this.hold.up ? 1 : 0) - (k.has('KeyC') || this.hold.down ? 1 : 0) + p.rt - p.lt;
    const l = Math.hypot(f, s, u);
    if (l > 1) { f /= l; s /= l; u /= l; }
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.hold.boost || this.padBoost ? 10 : 1;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const v = fwd.multiplyScalar(f).add(right.multiplyScalar(s)).add(up.multiplyScalar(u)).multiplyScalar(speed * boost);
    return [v.x, v.y, v.z];
  }

  /** on foot: forward and sideways (−1–1), running, jumping */
  walkInput() {
    const k = this.keys, p = this.app().pad;
    if (this.v.nav.open) return { f: 0, s: 0, run: false, jump: false };
    let f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) - this.stick.y - p.ls[1];
    let s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.stick.x + p.ls[0];
    const l = Math.hypot(f, s);
    if (l > 1) { f /= l; s /= l; }
    return { f, s, run: k.has('ShiftLeft') || k.has('ShiftRight') || this.padBoost, jump: k.has('Space') || this.hold.jump || p.on(BTN.X) };
  }

  hud(r: ReturnType<View3D['readout']>) {
    const v = this.v, mode = r.mode as Mode;
    // the readout along the top
    const bar = '▮'.repeat(Math.floor(r.charge * 10)) + '▯'.repeat(10 - Math.floor(r.charge * 10));
    const thr = r.throttle >= 1 ? `×${r.throttle.toFixed(r.throttle < 10 ? 1 : 0)}` : `÷${(1 / r.throttle).toFixed(1)}`;
    const top = `<div class="mode3">${r.where}</div><b>${r.speed}</b> <span>${mode === 'scope' ? '' : `throttle ${thr}`}</span>`
      + `<div class="drv${r.tunnel ? ' worm' : ''}">${r.drive}</div><div class="jmp">wormhole ${bar}</div>`
      + `${r.target ? `<div class="tgt">◎ ${r.target}</div>` : ''}${r.near ? `<div class="dim">near ${r.near}</div>` : ''}`;
    if (this.topEl.innerHTML !== top) this.topEl.innerHTML = top;

    // what you can use, under the crosshair
    const dev = this.dev;
    const useKey = mode === 'eva' ? (dev === 'pad' ? 'A' : 'F') : dev === 'pad' ? 'A' : 'F';
    const use = r.prompt ? `${dev === 'touch' ? '' : glyphs([useKey], dev === 'pad' ? 'pad' : 'kb')} ${r.prompt}` : '';
    if (this.useEl.innerHTML !== use) { this.useEl.innerHTML = use; this.useEl.hidden = !use; }

    // the bar of main actions, in the glyphs of what was used last
    const key = `${mode}|${dev}|${r.od}`;
    if (key !== this.barKey) {
      this.barKey = key;
      this.barEl.innerHTML = dev === 'touch' ? '' : BINDS[mode].filter(b => b.bar).map(b => {
        const g = dev === 'pad' ? b.p : b.k;
        const on = b.t === 'Overdrive' && r.od ? ' on' : '';
        return g.length ? `<span class="act${on}">${glyphs(g.slice(0, dev === 'pad' ? 1 : 2), dev)}<em>${b.t}</em></span>` : '';
      }).join('') + `<span class="act" data-help>${glyphs(['H'], 'kb')}<em>All controls</em></span>`;
    }
    // touch buttons for where you are
    if (this.shownMode !== mode) {
      this.shownMode = mode;
      this.btnsEl.innerHTML = TOUCH[mode].map(([k, t]) => `<button data-b="${k}">${t}</button>`).join('');
      this.root.dataset.mode = mode;
    }
    for (const b of this.btnsEl.querySelectorAll<HTMLElement>('[data-b="od"]')) b.classList.toggle('on', r.od);
    for (const b of this.btnsEl.querySelectorAll<HTMLButtonElement>('[data-b="use"]')) b.disabled = !r.prompt;
    for (const b of this.btnsEl.querySelectorAll<HTMLElement>('[data-b="track"]')) b.classList.toggle('on', v.scope.track);
    const o = Math.min(1, r.flash).toFixed(2);
    if (this.flashEl.style.opacity !== o) this.flashEl.style.opacity = o;
  }
}

/** keys as keycaps, or controller buttons in their colours */
function glyphs(gs: string[], dev: Dev) {
  if (!gs.length) return '<span class="dim">—</span>';
  return gs.map(g => dev === 'pad' ? `<span class="pad3 p-${g.replace(/[^A-Za-z0-9]/g, '') || 'd'}">${g}</span>` : `<kbd>${g}</kbd>`).join('');
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
