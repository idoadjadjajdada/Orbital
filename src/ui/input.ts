import * as THREE from 'three';
import type { App } from '../app';
import type { Body } from '../physics/body';

type Mode = 'none' | 'rotate' | 'pan' | 'press-body' | 'grab' | 'aim' | 'touch2';

/**
 * Pointer and keyboard. One finger or the left button does whatever makes
 * sense where it lands: on a body it selects or carries it, on empty space
 * it throws the picked body or, with nothing picked, turns the view.
 */
export class Input {
  private mode: Mode = 'none';
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private pressBody: Body | null = null;
  private aimStart: THREE.Vector3 | null = null;
  private aimHost: Body | null = null;
  private aimVel: THREE.Vector3 | null = null;
  private lastAim = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = { d: 0, a: 0, mx: 0, my: 0 };
  private spaceDown = false;
  private handHist: { t: number; p: THREE.Vector3 }[] = [];

  constructor(private app: App, private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    canvas.addEventListener('dblclick', e => {
      const b = this.app.bodies.pick(e.offsetX, e.offsetY);
      if (b) { this.app.select(b); this.app.follow(b); }
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.key(e));
    window.addEventListener('keyup', e => { if (e.code === 'Space') this.spaceDown = false; });
  }

  private zoom(f: number) {
    const v = this.app.view;
    v.distGoal = Math.min(1e6, Math.max(1e-9, v.distGoal * f));
  }

  /** where a screen point meets the placement plane, in world coordinates */
  private worldAt(x: number, y: number, zScene?: number): THREE.Vector3 | null {
    const p = this.app.view.rayToPlane(x, y, zScene);
    if (!p) return null;
    const o = this.app.view.origin;
    return p.add(new THREE.Vector3(o.x, o.y, o.z));
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (this.pointers.size === 2) {
      // second finger: abandon whatever the first was doing and pinch
      this.cancelAim();
      this.dropHeld();
      this.mode = 'touch2';
      this.pinchStart();
      return;
    }
    if (this.pointers.size > 2) return;
    this.start = { x: e.offsetX, y: e.offsetY };
    this.last = { ...this.start };
    if (e.button === 2 || (e.button === 0 && e.altKey)) { this.mode = 'rotate'; return; }
    if (e.button === 1 || (e.button === 0 && (e.shiftKey || this.spaceDown))) { this.mode = 'pan'; return; }
    const hit = this.app.bodies.pick(e.offsetX, e.offsetY);
    if (hit) { this.mode = 'press-body'; this.pressBody = hit; return; }
    if (this.app.armed) {
      const p = this.worldAt(e.offsetX, e.offsetY);
      if (p) {
        this.mode = 'aim';
        this.aimStart = p;
        this.aimHost = this.app.hostAt(p);
        this.aimVel = null;
        return;
      }
    }
    this.mode = 'rotate';
  }

  private move(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) {
      // hover feedback
      if (e.target === this.canvas) {
        const hit = this.app.bodies.pick(e.offsetX, e.offsetY);
        this.canvas.classList.toggle('grab', !!hit);
      }
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    this.pointers.set(e.pointerId, { x, y });
    const dx = x - this.last.x, dy = y - this.last.y;
    this.last = { x, y };
    const moved = Math.hypot(x - this.start.x, y - this.start.y);
    const v = this.app.view;
    switch (this.mode) {
      case 'touch2': this.pinchMove(); break;
      case 'rotate':
        v.az -= dx * 0.006;
        v.el = Math.max(-1.55, Math.min(1.55, v.el + dy * 0.006));
        break;
      case 'pan': this.panBy(dx, dy); break;
      case 'press-body':
        if (moved > 6 && this.pressBody) this.grab(this.pressBody, x, y);
        break;
      case 'grab': this.carry(x, y); break;
      case 'aim': {
        if (!this.aimStart) break;
        if (moved < 6) { this.app.aim(null, null, null); this.aimVel = null; break; }
        const zs = this.aimStart.z - v.origin.z;
        const p = this.worldAt(x, y, zs);
        if (!p) break;
        const drag = p.clone().sub(this.aimStart);
        this.aimVel = this.app.throwVelocity(this.aimStart, drag, this.aimHost);
        const now = performance.now();
        if (now - this.lastAim > 45) {
          this.lastAim = now;
          this.app.aim(this.aimStart, this.aimVel, this.aimHost);
        }
        break;
      }
    }
  }

  private up(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === 'touch2') {
      if (this.pointers.size === 0) this.mode = 'none';
      else { this.mode = 'rotate'; const p = [...this.pointers.values()][0]; this.last = { ...p }; this.start = { x: -1e9, y: -1e9 }; }
      return;
    }
    const moved = Math.hypot(this.last.x - this.start.x, this.last.y - this.start.y);
    switch (this.mode) {
      case 'press-body': {
        const b = this.pressBody;
        this.app.select(this.app.selected === b ? null : b);
        break;
      }
      case 'grab': this.dropHeld(); break;
      case 'aim': {
        const p = this.aimStart, host = this.aimHost;
        if (p) {
          let v: THREE.Vector3;
          if (this.aimVel && moved >= 6) v = this.aimVel;
          else v = this.app.flags.auto ? this.app.circularVelocity(p, host) : new THREE.Vector3(host?.vx ?? 0, host?.vy ?? 0, host?.vz ?? 0);
          this.app.place(p, v);
        }
        this.cancelAim();
        break;
      }
      case 'rotate':
        if (moved < 4 && e.button === 0 && this.app.selected) this.app.select(null);
        break;
    }
    this.mode = 'none';
    this.pressBody = null;
  }

  private cancelAim() {
    this.aimStart = null;
    this.aimVel = null;
    this.app.aim(null, null, null);
  }

  private panBy(dx: number, dy: number) {
    const v = this.app.view;
    const pw = v.pixelWorld(v.dist);
    const right = new THREE.Vector3().setFromMatrixColumn(v.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(v.camera.matrixWorld, 1);
    const d = right.multiplyScalar(-dx * pw).add(up.multiplyScalar(dy * pw));
    this.app.pan.x += d.x; this.app.pan.y += d.y; this.app.pan.z += d.z;
  }

  private grab(b: Body, x: number, y: number) {
    const host = this.app.hostOf(b);
    this.app.select(b);
    b.held = true;
    this.mode = 'grab';
    this.handHist = [];
    const target = new THREE.Vector3(b.x - (host?.x ?? 0), b.y - (host?.y ?? 0), b.z - (host?.z ?? 0));
    this.app.held = { b, target, vel: new THREE.Vector3(), last: target.clone(), t: performance.now(), host };
    this.canvas.classList.add('grabbing');
    this.carry(x, y);
  }

  private carry(x: number, y: number) {
    const h = this.app.held;
    if (!h) return;
    const v = this.app.view;
    const zs = h.b.z - v.origin.z;
    const p = this.worldAt(x, y, zs);
    if (!p) return;
    p.x -= h.host?.x ?? 0; p.y -= h.host?.y ?? 0; p.z -= h.host?.z ?? 0;
    h.target.copy(p);
    // the hand's speed over the last tenth of a second, converted to sim time
    const now = performance.now();
    this.handHist.push({ t: now, p: p.clone() });
    while (this.handHist.length > 2 && now - this.handHist[0].t > 100) this.handHist.shift();
    const a = this.handHist[0];
    const dt = (now - a.t) / 1000;
    if (dt > 0.008) h.vel.copy(p).sub(a.p).divideScalar(dt * this.app.warp);
  }

  private dropHeld() {
    const h = this.app.held;
    if (!h) return;
    const now = performance.now();
    if (this.handHist.length && now - this.handHist[this.handHist.length - 1].t > 80) h.vel.set(0, 0, 0);
    h.b.held = false;
    this.app.world.moved(h.b);
    this.app.held = null;
    this.canvas.classList.remove('grabbing');
  }

  private pinchStart() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  private pinchMove() {
    const [a, b] = [...this.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (this.pinch.d > 0 && d > 0) this.zoom(this.pinch.d / d);
    this.app.view.az -= ang - this.pinch.a;
    this.panBy(mx - this.pinch.mx, my - this.pinch.my);
    this.pinch = { d, a: ang, mx, my };
  }

  private key(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    const app = this.app;
    switch (e.code) {
      case 'Space': e.preventDefault(); if (!e.repeat) { this.spaceDown = true; app.paused = !app.paused; } break;
      case 'BracketLeft': app.warpLog = Math.max(-7.5, app.warpLog - 0.25); break;
      case 'BracketRight': app.warpLog = Math.min(4, app.warpLog + 0.25); break;
      case 'KeyT': app.flags.trails = !app.flags.trails; break;
      case 'KeyO': app.flags.orbits = !app.flags.orbits; break;
      case 'KeyZ': app.flags.zones = !app.flags.zones; break;
      case 'KeyL': app.flags.labels = !app.flags.labels; break;
      case 'KeyA': app.flags.auto = !app.flags.auto; break;
      case 'KeyF': app.follow(app.selected ?? null); break;
      case 'KeyC': app.clear(); break;
      case 'Escape': app.select(null); app.armed = null; this.cancelAim(); break;
      case 'Delete': case 'Backspace': app.deleteSelected(); break;
      default: return;
    }
    this.onChange();
  }

  onChange: () => void = () => {};
}
