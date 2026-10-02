import type { App, P3 } from '../app';
import type { Body } from '../physics/body';

type Mode = 'none' | 'pan' | 'press-body' | 'grab' | 'aim' | 'touch2' | 'ruler' | 'push' | 'bombard' | 'erase';

/**
 * Pointer and keyboard for a flat, top-down view. One finger or the left
 * button does what makes sense where it lands: on a body it selects or
 * carries it; on empty space it throws the picked body or, with nothing
 * picked, slides the view. Two fingers pinch and slide; the wheel zooms
 * about the cursor.
 */
export class Input {
  private mode: Mode = 'none';
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private pressBody: Body | null = null;
  private aimStart: P3 | null = null;
  private aimHost: Body | null = null;
  private aimVel: P3 | null = null;
  private lastAim = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = { d: 0, mx: 0, my: 0 };
  private handHist: { t: number; p: P3 }[] = [];
  /** iOS never fires dblclick for touch: double taps are found here */
  private lastTap = { t: 0, x: 0, y: 0, b: null as Body | null };

  constructor(private app: App, private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
    canvas.addEventListener('dblclick', e => {
      const b = this.app.view.pick(e.offsetX, e.offsetY);
      if (b) { this.app.select(b); this.app.follow(b); }
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.key(e));
    // Safari's own pinch-zoom and double-tap-zoom would fight the view's
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false } as AddEventListenerOptions);
  }

  private local(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** zoom by factor f, keeping the world point under (x, y) where it is */
  private zoomAt(f: number, x: number, y: number) {
    const v = this.app.view;
    const before = v.unproject(x, y);
    const s = Math.min(1e13, Math.max(1e-4, v.scale * f));
    v.scale = v.scaleGoal = s;
    const after = v.unproject(x, y);
    this.app.pan.x += before.x - after.x;
    this.app.pan.y += before.y - after.y;
    v.cx += before.x - after.x;
    v.cy += before.y - after.y;
  }

  private panBy(dx: number, dy: number) {
    const k = this.app.view.perCss;
    this.app.pan.x -= dx * k;
    this.app.pan.y += dy * k;
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      // a second finger: whatever the first was doing becomes a pinch
      this.cancelAim();
      this.dropHeld();
      this.mode = 'touch2';
      this.pinchStart();
      return;
    }
    if (this.pointers.size > 2) return;
    this.start = { ...p };
    this.last = { ...p };
    if (e.button === 1 || e.button === 2) { this.mode = 'pan'; return; }
    const hit = this.app.view.pick(p.x, p.y);
    if (this.app.tool !== 'hand' && this.toolDown(p, hit)) return;
    if (hit) { this.mode = 'press-body'; this.pressBody = hit; return; }
    if (this.app.armed) {
      this.mode = 'aim';
      this.aimStart = this.app.view.unproject(p.x, p.y);
      this.aimHost = this.app.hostAt(this.aimStart);
      this.aimVel = null;
      return;
    }
    this.mode = 'pan';
  }

  private move(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) {
      if (e.target === this.canvas) this.canvas.classList.toggle('grab', !!this.app.view.pick(e.offsetX, e.offsetY));
      return;
    }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const dx = p.x - this.last.x, dy = p.y - this.last.y;
    this.last = { ...p };
    const moved = Math.hypot(p.x - this.start.x, p.y - this.start.y);
    switch (this.mode) {
      case 'ruler': if (this.app.ruler) this.app.ruler.b = this.app.view.pick(p.x, p.y) ?? this.app.view.unproject(p.x, p.y); break;
      case 'push': this.pushMove(p); break;
      case 'erase': this.app.brush = { ...p }; this.app.eraseAt(p.x, p.y, 14); break;
      case 'bombard': break;
      case 'touch2': this.pinchMove(); break;
      case 'pan': this.panBy(dx, dy); break;
      case 'press-body': if (moved > 6 && this.pressBody) this.grab(this.pressBody, p.x, p.y); break;
      case 'grab': this.carry(p.x, p.y); break;
      case 'aim': {
        if (!this.aimStart) break;
        if (moved < 6) { this.app.aim(null, null, null); this.aimVel = null; break; }
        const q = this.app.view.unproject(p.x, p.y);
        const drag = { x: q.x - this.aimStart.x, y: q.y - this.aimStart.y, z: 0 };
        this.aimVel = this.app.throwVelocity(this.aimStart, drag, this.aimHost);
        const now = performance.now();
        if (now - this.lastAim > 45) { this.lastAim = now; this.app.aim(this.aimStart, this.aimVel, this.aimHost); }
        break;
      }
    }
  }

  private up(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === 'touch2') {
      if (this.pointers.size === 0) this.mode = 'none';
      else { this.mode = 'pan'; const q = [...this.pointers.values()][0]; this.last = { ...q }; this.start = { x: -1e9, y: -1e9 }; }
      return;
    }
    const moved = Math.hypot(this.last.x - this.start.x, this.last.y - this.start.y);
    switch (this.mode) {
      case 'ruler': if (moved < 6 && !this.pressBody) this.app.ruler = null; break;
      case 'push': if (moved >= 6) this.app.applyPush(); else { this.app.push = null; this.app.view.setAim(null, null); } break;
      case 'bombard': this.app.bombard = null; break;
      case 'erase': this.app.brush = null; break;
      case 'press-body': {
        const b = this.pressBody;
        const now = performance.now(), lt = this.lastTap;
        if (b && lt.b === b && now - lt.t < 350 && Math.hypot(lt.x - this.start.x, lt.y - this.start.y) < 30) {
          this.app.select(b);
          this.app.follow(b);
          this.lastTap.b = null;
        } else {
          this.app.select(e.pointerType === 'mouse' && this.app.selected === b ? null : b);
          this.lastTap = { t: now, x: this.start.x, y: this.start.y, b };
        }
        break;
      }
      case 'grab': this.dropHeld(); break;
      case 'aim': {
        const p = this.aimStart, host = this.aimHost;
        if (p) {
          const v = this.aimVel && moved >= 6 ? this.aimVel
            : this.app.flags.auto ? this.app.circularVelocity(p, host) : { x: host?.vx ?? 0, y: host?.vy ?? 0, z: host?.vz ?? 0 };
          this.app.place(p, v);
        }
        this.cancelAim();
        break;
      }
      case 'pan':
        if (moved < 4 && this.app.selected && e.button === 0) this.app.select(null);
        break;
    }
    this.mode = 'none';
    this.pressBody = null;
  }

  /** The pointer went down with a tool other than the hand. Returns true if the tool took it. */
  private toolDown(p: { x: number; y: number }, hit: Body | null): boolean {
    const app = this.app;
    switch (app.tool) {
      case 'ruler':
        this.mode = 'ruler';
        this.pressBody = hit;
        app.ruler = { a: hit ?? app.view.unproject(p.x, p.y), b: hit ?? app.view.unproject(p.x, p.y) };
        return true;
      case 'push': {
        const b = hit ?? app.selected;
        if (!b) { app.onToast('Push: press on a body and drag the way you want it to go'); return true; }
        app.select(b);
        this.mode = 'push';
        app.push = { b, dv: { x: 0, y: 0, z: 0 } };
        return true;
      }
      case 'bombard': {
        const t = hit ?? app.hostAt(app.view.unproject(p.x, p.y));
        if (!t) return true;
        app.remember(`bombarding ${t.name}`);
        app.select(t);
        this.mode = 'bombard';
        app.bombard = { target: t, acc: 0 };
        return true;
      }
      case 'erase':
        app.remember('erasing');
        this.mode = 'erase';
        app.brush = { ...p };
        app.eraseAt(p.x, p.y, 14);
        return true;
    }
    return false;
  }

  private pushMove(p: { x: number; y: number }) {
    const pu = this.app.push;
    if (!pu) return;
    // 60 CSS px of drag is the body's whole orbital speed; small drags are fine adjustments
    const k = this.app.pushScale(pu.b);
    const dx = (p.x - this.start.x) / 60, dy = -(p.y - this.start.y) / 60;
    pu.dv = { x: dx * k, y: dy * k, z: 0 };
    const now = performance.now();
    if (now - this.lastAim > 45) { this.lastAim = now; this.app.previewPush(pu.b, pu.dv); }
  }

  private cancelAim() { this.aimStart = null; this.aimVel = null; this.app.aim(null, null, null); }

  private grab(b: Body, x: number, y: number) {
    const host = this.app.hostOf(b);
    this.app.select(b);
    b.held = true;
    this.mode = 'grab';
    this.handHist = [];
    this.app.held = { b, target: { x: b.x - (host?.x ?? 0), y: b.y - (host?.y ?? 0), z: b.z - (host?.z ?? 0) }, vel: { x: 0, y: 0, z: 0 }, host };
    this.canvas.classList.add('grabbing');
    this.carry(x, y);
  }

  private carry(x: number, y: number) {
    const h = this.app.held;
    if (!h) return;
    const w = this.app.view.unproject(x, y);
    const p = { x: w.x - (h.host?.x ?? 0), y: w.y - (h.host?.y ?? 0), z: h.target.z };
    h.target = p;
    // the hand's speed over the last tenth of a second, in sim time
    const now = performance.now();
    this.handHist.push({ t: now, p });
    while (this.handHist.length > 2 && now - this.handHist[0].t > 100) this.handHist.shift();
    const a = this.handHist[0], dt = (now - a.t) / 1000;
    if (dt > 0.008) h.vel = { x: (p.x - a.p.x) / (dt * this.app.warp), y: (p.y - a.p.y) / (dt * this.app.warp), z: 0 };
  }

  private dropHeld() {
    const h = this.app.held;
    if (!h) return;
    const now = performance.now();
    if (this.handHist.length && now - this.handHist[this.handHist.length - 1].t > 80) h.vel = { x: 0, y: 0, z: 0 };
    h.b.setVel(h.vel.x + (h.host?.vx ?? 0), h.vel.y + (h.host?.vy ?? 0), h.vel.z + (h.host?.vz ?? 0));
    h.b.held = false;
    this.app.world.moved(h.b);
    this.app.held = null;
    this.canvas.classList.remove('grabbing');
  }

  private pinchStart() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  private pinchMove() {
    const [a, b] = [...this.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.panBy(mx - this.pinch.mx, my - this.pinch.my);
    if (this.pinch.d > 0 && d > 0) this.zoomAt(d / this.pinch.d, mx, my);
    this.pinch = { d, mx, my };
  }

  private key(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    const app = this.app;
    if (e.code === 'KeyV' && !e.metaKey && !e.ctrlKey) { void app.toggle3D(); return; }
    // in 3D the flying controls own the keyboard
    if (app.mode3d) return;
    switch (e.code) {
      case 'Space': e.preventDefault(); if (!e.repeat) app.paused = !app.paused; break;
      case 'BracketLeft': app.warpLog = Math.max(-7.5, app.warpLog - 0.25); break;
      case 'BracketRight': app.warpLog = Math.min(4, app.warpLog + 0.25); break;
      case 'Equal': case 'NumpadAdd': this.zoomAt(1.4, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2); break;
      case 'Minus': case 'NumpadSubtract': this.zoomAt(1 / 1.4, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2); break;
      case 'KeyT': app.flags.trails = !app.flags.trails; break;
      case 'KeyO': app.flags.orbits = !app.flags.orbits; break;
      case 'KeyL': app.flags.labels = !app.flags.labels; break;
      case 'KeyA': app.flags.auto = !app.flags.auto; break;
      case 'KeyF': app.follow(app.selected ?? null); break;
      case 'KeyC': app.clear(); break;
      case 'Escape': app.select(null); app.armed = null; app.tool = 'hand'; app.ruler = null; this.cancelAim(); break;
      case 'KeyZ':
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); app.undo(); break; }
        app.flags.zones = !app.flags.zones; break;
      case 'KeyH': app.tool = 'hand'; break;
      case 'KeyR': app.tool = app.tool === 'ruler' ? 'hand' : 'ruler'; break;
      case 'KeyP': app.tool = app.tool === 'push' ? 'hand' : 'push'; break;
      case 'KeyM': app.tool = app.tool === 'bombard' ? 'hand' : 'bombard'; break;
      case 'KeyE': app.tool = app.tool === 'erase' ? 'hand' : 'erase'; break;
      case 'KeyB': app.openBuilder(); break;
      case 'Delete': case 'Backspace': app.deleteSelected(); break;
      default: return;
    }
    this.onChange();
  }

  onChange: () => void = () => {};
}
