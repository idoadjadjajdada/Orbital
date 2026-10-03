/**
 * A game controller, read through the browser's Gamepad API in the standard
 * (Xbox) layout. Polled once a frame: sticks with a dead zone, triggers 0–1,
 * which buttons are held and which went down since the last frame.
 */
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

export class Pad {
  connected = false;
  name = '';
  ls: [number, number] = [0, 0];
  rs: [number, number] = [0, 0];
  lt = 0;
  rt = 0;
  private held: boolean[] = [];
  private was: boolean[] = [];
  /**
   * where each axis and trigger sits at rest, from the first reading after the
   * controller connects. Some controllers and browsers report a trigger as an
   * axis resting at −1, or a trigger that never quite lets go, which would
   * otherwise read as held for ever — and zoom or turn the view on its own
   */
  private rest: { id: string; axes: number[]; lt: number; rt: number } | null = null;

  constructor(onConnect?: (name: string, on: boolean) => void) {
    window.addEventListener('gamepadconnected', e => onConnect?.(short(e.gamepad.id), true));
    window.addEventListener('gamepaddisconnected', e => onConnect?.(short(e.gamepad.id), false));
  }

  poll() {
    const all = navigator.getGamepads?.() ?? [];
    let g: Gamepad | null = null;
    for (const p of all) if (p && p.connected && (!g || p.mapping === 'standard')) g = p;
    this.was = this.held;
    if (!g) {
      this.connected = false;
      this.held = [];
      this.ls = [0, 0]; this.rs = [0, 0]; this.lt = this.rt = 0;
      return;
    }
    this.connected = true;
    this.name = short(g.id);
    if (!this.rest || this.rest.id !== g.id) {
      this.rest = { id: g.id, axes: g.axes.map(a => (Math.abs(a) > 0.5 ? a : 0)), lt: g.buttons[BTN.LT]?.value ?? 0, rt: g.buttons[BTN.RT]?.value ?? 0 };
      // a trigger that reads fully pressed at rest is reported back to front: nothing to calibrate from
      if (this.rest.lt > 0.9) this.rest.lt = 0;
      if (this.rest.rt > 0.9) this.rest.rt = 0;
    }
    const r = this.rest;
    // an axis that rests far off centre is a trigger, not half a stick: leave it out of the sticks
    const ax = (k: number) => (r.axes[k] ? 0 : g!.axes[k] ?? 0);
    this.held = g.buttons.map(b => b.pressed);
    this.ls = stick(ax(0), ax(1));
    this.rs = stick(ax(2), ax(3));
    const tr = (v: number, z: number) => trig(z > 0.06 ? Math.max(0, (v - z) / (1 - z)) : v);
    this.lt = tr(g.buttons[BTN.LT]?.value ?? 0, r.lt);
    this.rt = tr(g.buttons[BTN.RT]?.value ?? 0, r.rt);
  }

  /** held now */
  on(b: number) { return !!this.held[b]; }
  /** went down this frame */
  hit(b: number) { return !!this.held[b] && !this.was[b]; }
}

/** a radial dead zone, rescaled so the stick still reaches 1, and squared-ish for fine control near the centre */
function stick(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y), dz = 0.15;
  if (l < dz) return [0, 0];
  const m = Math.min(1, (l - dz) / (1 - dz)), k = (m * (0.4 + 0.6 * m)) / l;
  return [x * k, y * k];
}

function trig(v: number) { return v < 0.06 ? 0 : (v - 0.06) / 0.94; }

function short(id: string) { return id.replace(/\s*\(.*$/, '').trim() || 'Controller'; }
