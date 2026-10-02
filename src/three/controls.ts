import * as THREE from 'three';
import type { View3D } from './view3d';
import type { V3 } from '../pixel/sprites';

/**
 * Flying controls for the 3D view, mapped for keyboard and mouse and for touch.
 *
 * Desktop: click to capture the mouse and look around; WASD to move, Space and
 * C (or R and F) up and down, Q and E to roll, Shift to boost tenfold, the
 * wheel or + and − to set the throttle. Click with the mouse captured selects
 * what is under the crosshair; T flies to the selection; V goes back to the map.
 *
 * Touch: a stick on the left moves, dragging anywhere else looks, a tap selects,
 * and buttons on the right go up, down, boost, change the throttle and fly to
 * the selection.
 */
export class Controls3D {
  throttle = 1;
  private keys = new Set<string>();
  private stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0 };
  private look = { id: -1, x: 0, y: 0, moved: 0 };
  private hold = { up: false, down: false, boost: false };
  readonly root: HTMLElement;
  private hudEl: HTMLElement;
  private knob: HTMLElement;
  private flashEl: HTMLElement;

  constructor(private v: View3D) {
    this.root = document.createElement('div');
    this.root.id = 'ui3';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="xhair"></div>
      <div class="hud3" id="hud3"></div>
      <div class="hint3">Click to look · WASD fly · Space / C up, down · Q / E roll · Shift boost · Wheel throttle · Click selects · T go · O overdrive · J jump · M map · Z view · V back</div>
      <div class="flash3" id="flash3"></div>
      <div class="stick3" id="stick3"><div class="knob3" id="knob3"></div></div>
      <div class="btns3">
        <button data-b="up">▲</button><button data-b="down">▼</button>
        <button data-b="boost">Boost</button><button data-b="slower">−</button><button data-b="faster">+</button>
        <button data-b="go">Go to</button>
        <button data-b="od">Overdrive</button><button data-b="jump">Jump</button><button data-b="map">Map</button><button data-b="view">View</button>
      </div>`;
    document.body.appendChild(this.root);
    this.hudEl = this.root.querySelector('#hud3')!;
    this.knob = this.root.querySelector('#knob3')!;
    this.flashEl = this.root.querySelector('#flash3')!;
    const stick = this.root.querySelector('#stick3') as HTMLElement;

    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    window.addEventListener('blur', () => this.keys.clear());

    const cv = v.canvas;
    cv.addEventListener('click', () => {
      if (!this.v.active) return;
      if (document.pointerLockElement === cv) {
        const b = this.v.pick();
        this.app().select(b);
      } else if (matchMedia('(pointer: fine)').matches) cv.requestPointerLock?.();
    });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== cv) return;
      this.turn(-e.movementX * 0.0022, -e.movementY * 0.0022, 0);
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.throttle = clamp(this.throttle * Math.exp(-e.deltaY * 0.0015), 1e-3, 1e3); }, { passive: false });

    // touch: the stick
    stick.addEventListener('pointerdown', e => {
      e.preventDefault();
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

    // touch (and pen): drag to look, tap to select
    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || !this.v.active) return;
      cv.setPointerCapture(e.pointerId);
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    });
    cv.addEventListener('pointermove', e => {
      if (e.pointerId !== this.look.id) return;
      const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y;
      this.look.x = e.clientX; this.look.y = e.clientY;
      this.look.moved += Math.abs(dx) + Math.abs(dy);
      this.turn(dx * 0.004, dy * 0.004, 0);
    });
    const lookEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.look.id) return;
      if (this.look.moved < 8) this.app().select(this.v.pick(e.clientX, e.clientY));
      this.look.id = -1;
    };
    cv.addEventListener('pointerup', lookEnd);
    cv.addEventListener('pointercancel', lookEnd);

    for (const b of this.root.querySelectorAll<HTMLElement>('[data-b]')) {
      const k = b.dataset.b!;
      const set = (on: boolean) => { if (k === 'up' || k === 'down' || k === 'boost') this.hold[k] = on; };
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        set(true);
        if (k === 'slower') this.throttle = clamp(this.throttle / 2, 1e-3, 1e3);
        if (k === 'faster') this.throttle = clamp(this.throttle * 2, 1e-3, 1e3);
        if (k === 'go') this.goSelected();
        this.command(k);
      });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointerleave', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
    }
  }

  private app() { return this.v.app; }

  show(on: boolean) {
    this.root.hidden = !on;
    this.keys.clear();
  }

  private goSelected() {
    const s = this.app().selected;
    if (s && s.alive) this.v.goTo(s);
  }

  /** the ship's commands, from keys or buttons */
  private command(k: string) {
    const sh = this.v.ship;
    if (k === 'od') { sh.od = !sh.od; if (sh.od) this.v.travel = null; }
    if (k === 'jump') { const s = this.app().selected; if (s && s.alive) this.v.jumpTo(s); }
    if (k === 'map') { this.v.radar.toggle(); if (this.v.radar.big && document.pointerLockElement) document.exitPointerLock(); }
    if (k === 'view') sh.view = sh.view === 'chase' ? 'cockpit' : 'chase';
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.v.active) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (down) {
      if (e.code === 'KeyT') this.goSelected();
      if (!e.repeat) {
        if (e.code === 'KeyO') this.command('od');
        if (e.code === 'KeyJ') this.command('jump');
        if (e.code === 'KeyM') this.command('map');
        if (e.code === 'KeyZ') this.command('view');
      }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.throttle = clamp(this.throttle * 2, 1e-3, 1e3);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.throttle = clamp(this.throttle / 2, 1e-3, 1e3);
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'KeyR', 'KeyF'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    } else this.keys.delete(e.code);
  }

  /** rotate the view about its own axes: yaw, pitch, roll (radians) */
  private turn(yaw: number, pitch: number, roll: number) {
    const q = this.v.camera.quaternion;
    const t = new THREE.Quaternion();
    t.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); q.multiply(t);
    t.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch); q.multiply(t);
    t.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll); q.multiply(t);
    q.normalize();
  }

  /** is the pilot asking to move (which cancels an autopilot)? */
  moving() {
    const k = this.keys;
    return k.has('KeyW') || k.has('KeyS') || k.has('KeyA') || k.has('KeyD') || k.has('Space') || k.has('KeyC') || k.has('KeyR') || k.has('KeyF')
      || this.stick.id >= 0 || this.hold.up || this.hold.down;
  }

  update(dt: number) {
    const k = this.keys;
    const roll = (k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0);
    if (roll) this.turn(0, 0, roll * dt * 1.4);
  }

  /** the velocity the pilot is asking for, world frame, m/s */
  thrust(speed: number): V3 {
    const k = this.keys;
    let f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) - this.stick.y;
    let s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.stick.x;
    let u = (k.has('Space') || k.has('KeyR') || this.hold.up ? 1 : 0) - (k.has('KeyC') || k.has('KeyF') || this.hold.down ? 1 : 0);
    const l = Math.hypot(f, s, u);
    if (l > 1) { f /= l; s /= l; u /= l; }
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.hold.boost ? 10 : 1;
    const q = this.v.camera.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const v = fwd.multiplyScalar(f).add(right.multiplyScalar(s)).add(up.multiplyScalar(u)).multiplyScalar(speed * boost);
    return [v.x, v.y, v.z];
  }

  hud(r: { speed: string; near: string; target: string; riding: string; throttle: number; drive: string; charge: number; flash: number }) {
    const t = r.throttle >= 1 ? `×${r.throttle.toFixed(r.throttle < 10 ? 1 : 0)}` : `÷${(1 / r.throttle).toFixed(1)}`;
    const bar = '▮'.repeat(Math.floor(r.charge * 10)) + '▯'.repeat(10 - Math.floor(r.charge * 10));
    const html = `<b>${r.speed}</b> <span>throttle ${t}</span><div class="drv">${r.drive}</div><div class="jmp">jump ${bar}</div>`
      + `${r.near ? `<div>near ${r.near}</div>` : ''}${r.target ? `<div class="tgt">◎ ${r.target}</div>` : ''}${r.riding ? `<div class="dim">moving with ${r.riding}</div>` : ''}`;
    if (this.hudEl.innerHTML !== html) this.hudEl.innerHTML = html;
    const o = Math.min(1, r.flash).toFixed(2);
    if (this.flashEl.style.opacity !== o) this.flashEl.style.opacity = o;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-b="od"]')) b.classList.toggle('on', this.v.ship.od);
  }
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
