import type { App } from '../app';
import { GRID, MATERIALS, SHAPES, shapeStats, makeShape, slump, lookFromShape, type Shape } from '../physics/materials';
import { buildCustom } from '../physics/custom';
import { fmtMass, sig, KMS, G, AU_M, YEAR_S } from '../physics/units';
import { msLife, giantLife, newStar, structure, teffOf } from '../physics/stellar';
import { bakeShaped, drawCells } from '../pixel/shaped';
import { iconOf } from '../app';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type Tool = 'paint' | 'erase' | 'fill';
const CELL = 9; // CSS px per grid cell in the editor

/**
 * The body builder. Draw a cross-section on a grid with materials, or start
 * from a ready-made shape. The panel works out what that drawing would be at
 * the chosen size — its mass, its gravity, and whether its material is strong
 * enough to hold the shape against its own weight. If it is not, it will slump
 * toward a sphere once it is placed; “Test” plays that slump here first.
 */
export class Builder {
  private tool: Tool = 'paint';
  private mat = 2;
  private mirror = false;
  private undo: Uint8Array[] = [];
  private grid: HTMLCanvasElement;
  private prev: HTMLCanvasElement;
  private drawing = false;
  private test: { shape: Shape; t: number; tEnd: number } | null = null;
  private spin = 0;
  private raf = 0;
  /** the preview's finished picture (a star, or a shape that has settled), kept rather than painted again every frame */
  private icon: { key: string; img: HTMLImageElement } | null = null;

  constructor(private app: App, private onUse: () => void) {
    this.grid = $<HTMLCanvasElement>('bGrid');
    this.prev = $<HTMLCanvasElement>('bPrev');
    this.grid.width = this.grid.height = GRID * CELL;
    this.prev.width = this.prev.height = 96;
    this.buildPalette();
    this.buildShapes();
    this.bindGrid();
    const c = app.custom;
    $<HTMLInputElement>('bSize').value = String(c.sizeLog);
    $<HTMLInputElement>('bDay').value = String(Math.log10(c.dayH));
    $<HTMLInputElement>('bName').value = c.name;
    $<HTMLInputElement>('bSize').oninput = () => { c.sizeLog = Number($<HTMLInputElement>('bSize').value); this.test = null; this.update(); };
    $<HTMLInputElement>('bDay').oninput = () => { c.dayH = 10 ** Number($<HTMLInputElement>('bDay').value); this.update(); };
    $<HTMLInputElement>('bName').oninput = () => { c.name = $<HTMLInputElement>('bName').value; };
    $<HTMLInputElement>('bStarM').oninput = () => { c.starMass = 10 ** Number($<HTMLInputElement>('bStarM').value); this.update(); };
    $<HTMLInputElement>('bStarAge').oninput = () => { c.starAge = Number($<HTMLInputElement>('bStarAge').value); this.update(); };
    for (const b of document.querySelectorAll<HTMLElement>('[data-btool]')) b.onclick = () => { this.tool = b.dataset.btool as Tool; this.sync(); };
    $('bMirror').onclick = () => { this.mirror = !this.mirror; this.sync(); };
    $('bUndo').onclick = () => { const u = this.undo.pop(); if (u) { c.cells = u; this.test = null; this.update(); } };
    $('bClear').onclick = () => { this.push(); c.cells = new Uint8Array(GRID * GRID); this.test = null; this.update(); };
    $('bTest').onclick = () => this.startTest();
    $('bUse').onclick = () => { this.close(); this.onUse(); };
    $('bClose').onclick = () => this.close();
    window.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('builder').hidden) this.close(); });
    for (const b of document.querySelectorAll<HTMLElement>('[data-bmode]')) b.onclick = () => { c.mode = b.dataset.bmode as 'world' | 'star'; this.test = null; this.sync(); this.update(); };
  }

  open() { $('builder').hidden = false; this.sync(); this.update(); if (!this.raf) this.loop(); }
  close() { $('builder').hidden = true; cancelAnimationFrame(this.raf); this.raf = 0; }
  get isOpen() { return !$('builder').hidden; }

  private push() { this.undo.push(this.app.custom.cells.slice()); if (this.undo.length > 40) this.undo.shift(); }

  private buildPalette() {
    const box = $('bMats');
    for (const m of MATERIALS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.mat = String(m.id);
      b.title = `${m.name}: ${m.blurb} ${m.rho} g/cm³${m.Y ? `, strength ${sig(m.Y / 1e6, 2)} MPa` : ', no strength'}`;
      b.innerHTML = `<i style="background:#${m.color.toString(16).padStart(6, '0')}"></i><span>${m.name}</span>`;
      b.onclick = () => { this.mat = m.id; if (this.tool === 'erase') this.tool = 'paint'; this.sync(); };
      box.appendChild(b);
    }
  }

  private buildShapes() {
    const box = $('bShapes');
    for (const s of SHAPES) {
      const b = document.createElement('button');
      b.className = 'chip small';
      b.textContent = s.name;
      b.onclick = () => { this.push(); this.app.custom.cells = s.make(); this.test = null; this.update(); };
      box.appendChild(b);
    }
  }

  private bindGrid() {
    const cv = this.grid;
    const at = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { i: Math.floor(((e.clientX - r.left) / r.width) * GRID), j: Math.floor(((e.clientY - r.top) / r.height) * GRID) };
    };
    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      this.push();
      this.test = null;
      const { i, j } = at(e);
      if (this.tool === 'fill') { this.fill(i, j); this.update(); return; }
      this.drawing = true;
      this.dab(i, j, e.button === 2);
    });
    cv.addEventListener('pointermove', e => { if (this.drawing) { const { i, j } = at(e); this.dab(i, j, (e.buttons & 2) !== 0); } });
    const end = () => { this.drawing = false; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('contextmenu', e => e.preventDefault());
  }

  private set(i: number, j: number, v: number) {
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return;
    this.app.custom.cells[j * GRID + i] = v;
    if (this.mirror) this.app.custom.cells[j * GRID + (GRID - 1 - i)] = v;
  }

  private dab(i: number, j: number, erase: boolean) {
    const v = erase || this.tool === 'erase' ? 0 : this.mat;
    this.set(i, j, v);
    this.update();
  }

  private fill(i: number, j: number) {
    const c = this.app.custom.cells;
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return;
    const from = c[j * GRID + i], to = this.mat;
    if (from === to) return;
    const st = [[i, j]];
    while (st.length) {
      const [x, y] = st.pop()!;
      if (x < 0 || y < 0 || x >= GRID || y >= GRID || c[y * GRID + x] !== from) continue;
      c[y * GRID + x] = to;
      st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  private sync() {
    const c = this.app.custom;
    for (const b of document.querySelectorAll<HTMLElement>('[data-btool]')) b.classList.toggle('on', b.dataset.btool === this.tool);
    for (const b of document.querySelectorAll<HTMLElement>('[data-bmode]')) b.classList.toggle('on', b.dataset.bmode === c.mode);
    for (const b of document.querySelectorAll<HTMLElement>('.swatch')) b.classList.toggle('on', Number(b.dataset.mat) === this.mat && this.tool !== 'erase');
    $('bMirror').classList.toggle('on', this.mirror);
    $('bWorld').hidden = c.mode !== 'world';
    $('bStar').hidden = c.mode !== 'star';
    document.querySelector<HTMLElement>('[data-world]')!.hidden = c.mode !== 'world';
    $<HTMLInputElement>('bStarM').value = String(Math.log10(c.starMass));
    $<HTMLInputElement>('bStarAge').value = String(c.starAge);
  }

  private startTest() {
    const c = this.app.custom;
    const st = shapeStats(c.cells, 10 ** c.sizeLog);
    if (!st.filled) return;
    const shape = makeShape(c.cells, st);
    // play the slump in two seconds, whatever its real timescale
    this.test = { shape, t: 0, tEnd: 2 };
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.spin += 0.012;
    if (this.test) {
      const s = this.test.shape;
      this.test.t += 1 / 60;
      slump(s, (s.tau * 6) / 120);
    }
    this.drawPreview();
  };

  private drawPreview() {
    const c = this.app.custom;
    const ctx = this.prev.getContext('2d')!;
    ctx.clearRect(0, 0, 96, 96);
    if (c.mode === 'star') { if (this.icon?.key.startsWith('star') && this.icon.img.complete) ctx.drawImage(this.icon.img, 18, 18); return; }
    const shape = this.test?.shape ?? makeShape(c.cells, shapeStats(c.cells, 10 ** c.sizeLog));
    if (shape.packed) {
      const look = { ...lookFromShape(shape, c.seed), seed: c.seed };
      const key = `shape|${JSON.stringify(look)}`;
      if (this.icon?.key !== key) {
        const img = new Image();
        img.src = iconOf({ look, heat: 0, cls: 'rock', tilt: 0.3 }, 60);
        this.icon = { key, img };
      }
      if (this.icon.img.complete) ctx.drawImage(this.icon.img, 18, 18);
      return;
    }
    const sp = bakeShaped(shape, 60, this.spin, [-0.6, 0.5, 0.65], [1.1, 1.08, 1.04], 0);
    const o = Math.round(48 - sp.size / 2);
    const tmp = new ImageData(sp.data, sp.size, sp.size);
    ctx.putImageData(tmp, o, o);
  }

  update() {
    const c = this.app.custom;
    const g = this.grid.getContext('2d')!;
    g.fillStyle = '#0a0c14';
    g.fillRect(0, 0, this.grid.width, this.grid.height);
    // faint guides: the frame's centre and a circle a sphere would fill
    g.strokeStyle = 'rgba(160,180,255,0.12)';
    g.beginPath(); g.arc(GRID * CELL / 2, GRID * CELL / 2, GRID * CELL * 0.45, 0, 2 * Math.PI); g.stroke();
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = GRID * CELL;
    drawCells(tmp.getContext('2d')!, c.cells, CELL);
    g.drawImage(tmp, 0, 0);
    if (this.mirror) {
      g.fillStyle = 'rgba(255,210,122,0.35)';
      g.fillRect(GRID * CELL / 2 - 0.5, 0, 1, this.grid.height);
    }

    const out: [string, string][] = [];
    let verdict = '', cls = '';
    if (c.mode === 'world') {
      const size = 10 ** c.sizeLog;
      const st = shapeStats(c.cells, size);
      $('bSizeV').textContent = `${fmtKm(size)} across`;
      $('bDayV').textContent = c.dayH < 48 ? `${sig(c.dayH, 2)} h` : `${sig(c.dayH / 24, 2)} d`;
      if (st.filled) {
        const gSurf = (G * st.mass) / (st.rEq * st.rEq) * AU_M / (YEAR_S * YEAR_S);
        const vesc = Math.sqrt((2 * G * st.mass) / st.rEq) / KMS;
        out.push(['Mass', fmtMass(st.mass)]);
        out.push(['Mean density', `${sig(st.rho, 3)} g/cm³`]);
        out.push(['Surface gravity', gSurf > 0.5 ? `${sig(gSurf / 9.81, 2)} g` : `${sig(gSurf * 100, 2)} cm/s²`]);
        out.push(['Escape speed', vesc > 1 ? `${sig(vesc, 3)} km/s` : `${sig(vesc * 1000, 3)} m/s`]);
        out.push(['Load / strength', isFinite(st.stress) ? `${sig(st.stress, 2)}×` : 'no strength']);
        if (st.potatoKm > 0) out.push(['Keeps this shape up to', fmtKm(st.potatoKm * 2)]);
        // a ball spinning faster than orbital speed at its equator flies apart
        const wBreak = Math.sqrt((G * st.mass) / st.rEq ** 3) / (2 * Math.PI) * 365.25 * 24;
        if (1 / c.dayH > wBreak) out.push(['Spin', 'faster than breakup']);
        if (st.stress <= 1) { verdict = 'Strong enough: it keeps its shape.'; cls = 'ok'; }
        else if (st.stress < 4) { verdict = `Overloaded ${sig(st.stress, 2)}×: it will sag partway toward round.`; cls = 'warn'; }
        else { verdict = `Too big for its strength: it will slump into a sphere${st.differentiates ? ', melt, and separate into layers' : ''}.`; cls = 'bad'; }
      } else verdict = 'Draw something.';
    } else {
      const s = newStar(c.starMass, c.starAge);
      const stc = structure(s);
      const teff = teffOf(stc.L, stc.r);
      $('bStarMV').textContent = `${sig(c.starMass, 3)} M☉`;
      $('bStarAgeV').textContent = c.starAge < 0 ? 'still contracting' : c.starAge <= 1 ? `${Math.round(c.starAge * 100)}% through its main sequence` : 'a giant';
      out.push(['Luminosity', `${sig(stc.L, 3)} L☉`]);
      out.push(['Surface', `${Math.round(teff)} K`]);
      out.push(['Radius', `${sig(stc.r / 0.00465047, 3)} R☉`]);
      out.push(['Lifetime', fmtYears(msLife(c.starMass) + giantLife(c.starMass))]);
      out.push(['Ends as', c.starMass < 8 ? 'a white dwarf' : c.starMass < 25 ? 'a neutron star, after a supernova' : 'a black hole']);
      verdict = '';
      const key = `star|${c.starMass}`;
      if (this.icon?.key !== key) {
        const img = new Image();
        img.src = iconOf({ look: { style: 'star', seed: 1, c1: 0, c2: 0 }, heat: 0, cls: 'star', tilt: 0, star: { m0: c.starMass, age: 0, phase: stc.phase, L: stc.L, teff, coreM: 0 } }, 60);
        this.icon = { key, img };
      }
    }
    $('bStats').innerHTML = out.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const vEl = $('bVerdict');
    vEl.textContent = verdict;
    vEl.className = `verdict ${cls}`;
    $('bTest').hidden = c.mode !== 'world' || cls === 'ok' || !cls;
    $<HTMLButtonElement>('bUse').disabled = !buildCustom(c);
  }
}

function fmtKm(km: number) {
  return km < 1 ? `${sig(km * 1000, 2)} m` : km < 1e4 ? `${sig(km, 3)} km` : `${sig(km / 1000, 3)} thousand km`;
}
function fmtYears(y: number) {
  return y > 1e9 ? `${sig(y / 1e9, 2)} billion yr` : y > 1e6 ? `${sig(y / 1e6, 2)} million yr` : `${sig(y, 2)} yr`;
}
