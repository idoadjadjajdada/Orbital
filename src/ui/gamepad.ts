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
    this.held = g.buttons.map(b => b.pressed);
    this.ls = stick(g.axes[0] ?? 0, g.axes[1] ?? 0);
    this.rs = stick(g.axes[2] ?? 0, g.axes[3] ?? 0);
    this.lt = trig(g.buttons[BTN.LT]?.value ?? 0);
    this.rt = trig(g.buttons[BTN.RT]?.value ?? 0);
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
