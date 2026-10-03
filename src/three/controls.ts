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
    { k: ['L'], p: ['L3 + A'], t: 'Land · lift off', bar: true },
    { k: ['K'], p: [], t: 'Mission control' },
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
    { k: ['K'], p: [], t: 'Mission control', bar: true },
    { k: ['M'], p: ['View'], t: 'Nav map', bar: true },
    { k: ['V'], p: ['Menu'], t: 'Back to the 2D map' },
  ],
  ground: [
    { k: ['W', 'A', 'S', 'D'], p: ['LS'], t: 'Walk' },
    { k: ['Mouse'], p: ['RS'], t: 'Look' },
    { k: ['Shift'], p: ['L3'], t: 'Run' },
    { k: ['Space'], p: ['X'], t: 'Jump' },
    { k: ['F', 'Click'], p: ['A'], t: 'Use', bar: true },
    { k: ['R'], p: ['Y'], t: 'Scan', bar: true },
    { k: ['G'], p: ['B'], t: 'Call the ship', bar: true },
    { k: ['K'], p: [], t: 'Mission control' },
    { k: ['M'], p: ['View'], t: 'Nav map', bar: true },
    { k: ['V'], p: ['Menu'], t: 'Back to the 2D map' },
  ],
  craft: [
    { k: ['W', 'A', 'S', 'D'], p: ['LS'], t: 'Drive · fly' },
    { k: ['Mouse'], p: ['RS'], t: 'Look' },
    { k: ['Space', 'C'], p: ['RT', 'LT'], t: 'Up · down' },
    { k: ['Shift'], p: ['L3'], t: 'Boost' },
    { k: ['F'], p: ['A'], t: 'Use', bar: true },
    { k: ['R'], p: ['Y'], t: 'Scan', bar: true },
    { k: ['L'], p: ['X'], t: 'Land · lift off', bar: true },
    { k: ['K'], p: [], t: 'Mission control', bar: true },
    { k: ['Esc'], p: ['B'], t: 'Back to the ship', bar: true },
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

const TITLE: Record<Mode, string> = { pilot: 'At the helm', walk: 'On foot', eva: 'Spacewalk', scope: 'Telescope', ground: 'On the ground', craft: 'Craft control' };

/** touch: the buttons under the right thumb, held down */
const THUMB: Record<Mode, [string, string][]> = {
  pilot: [['up', '▲'], ['down', '▼'], ['boost', 'Boost']],
  walk: [['jump', 'Jump']],
  eva: [['up', '▲'], ['down', '▼'], ['boost', 'Boost']],
  scope: [['zin', '＋'], ['zout', '−']],
  ground: [['jump', 'Jump'], ['boost', 'Run']],
  craft: [['up', '▲'], ['down', '▼'], ['boost', 'Boost']],
};
/** touch: the rail of commands, tapped: key, icon, name */
const RAIL: Record<Mode, [string, string, string][]> = {
  pilot: [['go', '◎', 'Go to'], ['od', '⏩', 'Overdrive'], ['worm', '🌀', 'Wormhole'], ['land', '🛬', 'Land'], ['map', '🗺', 'Map'], ['view', '🎥', 'Camera'], ['mission', '🛰', 'Missions'], ['leave', '🚶', 'Leave helm'], ['help', '?', 'Help']],
  walk: [['mission', '🛰', 'Missions'], ['map', '🗺', 'Map'], ['help', '?', 'Help']],
  ground: [['scan', '🔬', 'Scan'], ['call', '📡', 'Call ship'], ['mission', '🛰', 'Missions'], ['map', '🗺', 'Map'], ['help', '?', 'Help']],
  craft: [['back', '↩', 'To the ship'], ['scan', '🔬', 'Scan'], ['land', '🛬', 'Land'], ['mission', '🛰', 'Missions'], ['help', '?', 'Help']],
  eva: [['call', '📡', 'Call ship'], ['map', '🗺', 'Map'], ['help', '?', 'Help']],
  scope: [['track', '◎', 'Track'], ['leave', '↩', 'Step back'], ['help', '?', 'Help']],
};
const HELD = new Set(['up', 'down', 'boost', 'jump']);

const TOUCH_HELP = 'Touch: put your left thumb down anywhere on the left of the screen and move it to fly or walk; drag anywhere else to look; tap something to select it (on foot: tap to use what is under the dot). The buttons under your right thumb are held; the ones down the side are tapped. − and + above the stick set the throttle. Things fade back when you leave them alone; 👁 at the top hides them all.';

export class Controls3D {
  throttle = 1;
  private keys = new Set<string>();
  private stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0, moved: 0 };
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
  private thumbEl: HTMLElement;
  private railEl: HTMLElement;
  private thrEl: HTMLElement;
  private stickEl: HTMLElement;
  private knob: HTMLElement;
  /** the last touch, for fading what is not being used */
  private touched = performance.now();
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
      <div class="thr3"><button data-b="slower">−</button><span></span><button data-b="faster">+</button></div>
      <div class="thumb3"></div>
      <div class="rail3"></div>
      <div class="sheet3" hidden></div>`;
    document.body.appendChild(this.root);
    const $ = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.topEl = $('.top3');
    this.barEl = $('.bar3');
    this.useEl = $('.use3');
    this.sheetEl = $('.sheet3');
    this.thumbEl = $('.thumb3');
    this.railEl = $('.rail3');
    this.thrEl = $('.thr3');
    this.stickEl = $('.stick3');
    this.knob = $('.knob3');
    this.flashEl = $('.flash3');
    const stick = this.stickEl;

    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    this.barEl.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-help]')) this.sheet(); });
    this.useEl.addEventListener('click', () => { if (!this.v.panels.open && !this.v.asleep) this.v.prompt?.act(); });
    this.sheetEl.addEventListener('click', e => { if ((e.target as HTMLElement).closest('.close')) this.sheet(false); });

    const cv = v.canvas;
    cv.addEventListener('click', () => {
      if (!this.v.active || this.v.nav.open || this.v.panels.open) return;
      if (document.pointerLockElement === cv) this.primary();
      else if (matchMedia('(pointer: fine)').matches) cv.requestPointerLock?.();
    });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== cv) return;
      this.dev = 'kb';
      this.v.turn(-e.movementX * 0.0022, -e.movementY * 0.0022, 0);
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.dev = 'kb'; this.zoom(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

    // touch: a stick wherever the left thumb lands, drag elsewhere to look, a tap selects (or uses, on foot)
    const down = (e: PointerEvent, el: HTMLElement) => {
      if (e.pointerType === 'mouse' || !this.v.active) return;
      e.preventDefault();
      this.dev = 'touch';
      this.wake();
      el.setPointerCapture(e.pointerId);
      const left = el === stick || (e.clientX < window.innerWidth * 0.42 && this.v.mode !== 'scope');
      if (left && this.stick.id < 0) {
        this.stick = { x: 0, y: 0, id: e.pointerId, cx: e.clientX, cy: e.clientY, moved: 0 };
        // the stick comes to the thumb
        stick.classList.add('live');
        stick.style.left = `${e.clientX - stick.offsetWidth / 2}px`;
        stick.style.top = `${e.clientY - stick.offsetHeight / 2}px`;
      } else if (this.look.id < 0) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === this.stick.id) {
        const R = 50;
        let dx = (e.clientX - this.stick.cx) / R, dy = (e.clientY - this.stick.cy) / R;
        this.stick.moved = Math.max(this.stick.moved, Math.hypot(dx, dy) * R);
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.stick.x = dx; this.stick.y = dy;
        this.knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      } else if (e.pointerId === this.look.id) {
        const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y;
        this.look.x = e.clientX; this.look.y = e.clientY;
        this.look.moved += Math.abs(dx) + Math.abs(dy);
        // the view follows the finger, as in most games; the setting turns it round
        const k = 0.0045 * this.app().lookSpeed * (this.app().lookInvert ? -1 : 1);
        this.v.turn(-dx * k, -dy * k, 0);
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.stick.id) {
        const tap = this.stick.moved < 8;
        this.stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0, moved: 0 };
        this.knob.style.transform = '';
        stick.classList.remove('live');
        stick.style.left = stick.style.top = '';
        if (tap && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
      } else if (e.pointerId === this.look.id) {
        if (this.look.moved < 8 && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
        this.look.id = -1;
      }
    };
    for (const el of [cv, stick]) {
      el.addEventListener('pointerdown', e => down(e, el));
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }

    // touch buttons: the held ones let go only when their own finger lifts
    const held = new Map<number, HTMLElement>();
    this.root.addEventListener('pointerdown', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-b]');
      if (!b) return;
      e.preventDefault();
      this.dev = 'touch';
      this.wake();
      const k = b.dataset.b!;
      if (HELD.has(k)) {
        this.hold[k as keyof typeof this.hold] = true;
        held.set(e.pointerId, b);
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
      }
      this.touchButton(k);
    });
    const letGo = (e: PointerEvent) => {
      const b = held.get(e.pointerId);
      if (!b) return;
      held.delete(e.pointerId);
      this.hold[b.dataset.b as keyof typeof this.hold] = false;
      b.classList.remove('down');
    };
    this.root.addEventListener('pointerup', letGo);
    this.root.addEventListener('pointercancel', letGo);
    // any touch on the screen brings the faded controls back
    window.addEventListener('pointerdown', () => this.wake(), true);
  }

  /** a tap on the view: on foot it uses what is in front of you, otherwise it selects what is under the finger */
  private tap(x: number, y: number) {
    if (this.v.panels.open || this.v.asleep) return;
    if (this.v.mode === 'walk' || this.v.mode === 'ground') this.v.prompt?.act();
    else this.app().select(this.v.pick(x, y));
  }

  private wake() {
    this.touched = performance.now();
    this.root.classList.remove('idle');
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
    if (v.mode === 'walk' || v.mode === 'ground') { v.prompt?.act(); return; }
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
      + `</div>${this.dev === 'touch' ? `<p>${TOUCH_HELP}</p>` : ''}<p>${pad ? 'Showing the keyboard and the controller.' : 'Plug in a controller and its buttons show here too.'} Use the helm to fly; leave it to walk the ship, which flies on by itself — the autopilot and wormholes included. The airlock is off the commons to port; outside, the ship holds station until you call it.</p><p>Around the ship: the bridge has the helm, the nav table, the comms log and a sensor sweep. Off the forward passage are the quarters (a bunk to sleep eight hours away, the captain's log) and the lab (a survey of the target and a globe of it). The commons has the galley, the telescope and a shelf of souvenirs. In engineering, route the reactor's power; a hatch there leads down to the hangar, where the lander waits for its refit and the landing survey says where it could set down.</p>`;
  }

  /** a touch button */
  private touchButton(k: string) {
    const v = this.v;
    if (k === 'slower') this.throttle = clamp(this.throttle / 2, 1e-3, 1e3);
    if (k === 'faster') this.throttle = clamp(this.throttle * 2, 1e-3, 1e3);
    if (k === 'go') this.goSelected();
    if (k === 'od') this.toggleOd();
    if (k === 'worm') this.jumpSelected();
    if (k === 'help') this.sheet();
    if (k === 'map') v.openMap();
    if (k === 'land') v.landToggle();
    if (k === 'mission') v.openMission();
    if (k === 'scan') v.scan();
    if (k === 'back') v.backToShip();
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
    if (v.asleep) return;
    if (v.nav.open) { v.nav.key(e); return; }
    if (v.panels.open) { v.panels.key(e); return; }
    if (e.code === 'KeyH' && !e.repeat) { this.sheet(); return; }
    if (e.code === 'Escape') {
      if (!this.sheetEl.hidden) this.sheet(false);
      else if (v.mode === 'scope') v.leaveScope();
      else if (v.mode === 'craft') v.backToShip();
      return;
    }
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'KeyF', 'KeyG'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoom(2);
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoom(0.5);
    if (e.repeat) return;
    if (e.code === 'KeyM') v.openMap();
    if (e.code === 'KeyK') { v.openMission(); return; }
    switch (v.mode) {
      case 'pilot':
        if (e.code === 'KeyT') this.goSelected();
        if (e.code === 'KeyO') this.toggleOd();
        if (e.code === 'KeyJ') this.jumpSelected();
        if (e.code === 'KeyZ') v.ship.view = v.ship.view === 'chase' ? 'cockpit' : 'chase';
        if (e.code === 'KeyF') v.leaveHelm();
        if (e.code === 'KeyL') v.landToggle();
        break;
      case 'ground':
        if (e.code === 'KeyF' || e.code === 'KeyE') v.prompt?.act();
        if (e.code === 'KeyG') v.callShip();
        if (e.code === 'KeyR') v.scan();
        break;
      case 'craft':
        if (e.code === 'KeyF' || e.code === 'KeyE') v.prompt?.act();
        if (e.code === 'KeyR') v.scan();
        if (e.code === 'KeyL') v.landToggle();
        if (e.code === 'KeyB') v.backToShip();
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
    if (v.nav.open || v.panels.open || v.asleep || !this.sheetEl.hidden && this.dev !== 'pad') return;
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
        if (p.on(BTN.LS) && p.hit(BTN.A)) v.landToggle();
        if (p.hit(BTN.UP)) this.zoom(2);
        if (p.hit(BTN.DOWN)) this.zoom(0.5);
        if (p.hit(BTN.RIGHT)) this.app().cycle(1, at);
        if (p.hit(BTN.LEFT)) this.app().cycle(-1, at);
        break;
      }
      case 'walk':
        if (p.hit(BTN.A)) v.prompt?.act();
        break;
      case 'ground':
        if (p.hit(BTN.A)) v.prompt?.act();
        if (p.hit(BTN.Y)) v.scan();
        if (p.hit(BTN.B)) v.callShip();
        break;
      case 'craft':
        if (p.hit(BTN.A)) v.prompt?.act();
        if (p.hit(BTN.Y)) v.scan();
        if (p.hit(BTN.X)) v.landToggle();
        if (p.hit(BTN.B)) v.backToShip();
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
    if (this.v.nav.open || this.v.panels.open) return [0, 0, 0];
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
    if (this.v.nav.open || this.v.panels.open || this.v.asleep) return { f: 0, s: 0, run: false, jump: false };
    let f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) - this.stick.y - p.ls[1];
    let s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.stick.x + p.ls[0];
    const l = Math.hypot(f, s);
    if (l > 1) { f /= l; s /= l; }
    return { f, s, run: k.has('ShiftLeft') || k.has('ShiftRight') || this.padBoost || this.hold.boost, jump: k.has('Space') || this.hold.jump || p.on(BTN.X) };
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
    const use = r.prompt ? `${dev === 'touch' ? '<b>👆</b>' : glyphs([useKey], dev === 'pad' ? 'pad' : 'kb')} ${r.prompt}` : '';
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
      this.thumbEl.innerHTML = THUMB[mode].map(([k, t]) => `<button data-b="${k}">${t}</button>`).join('');
      this.railEl.innerHTML = RAIL[mode].map(([k, i, t]) => `<button data-b="${k}"><b>${i}</b><span>${t}</span></button>`).join('');
      this.root.dataset.mode = mode;
    }
    for (const b of this.railEl.querySelectorAll<HTMLElement>('[data-b="od"]')) b.classList.toggle('on', r.od);
    for (const b of this.railEl.querySelectorAll<HTMLElement>('[data-b="view"]')) b.classList.toggle('on', r.view === 'cockpit');
    for (const b of this.railEl.querySelectorAll<HTMLElement>('[data-b="track"]')) b.classList.toggle('on', v.scope.track);
    const thrEl = this.thrEl.querySelector('span')!, tt = `×${r.throttle >= 1 ? r.throttle.toFixed(r.throttle < 10 ? 1 : 0) : r.throttle.toPrecision(2)}`;
    if (thrEl.textContent !== tt) thrEl.textContent = tt;
    // what has not been touched for a while fades back
    if (dev === 'touch' && performance.now() - this.touched > 5000) this.root.classList.add('idle');
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
