import { sampleMap } from '../pixel/surface';
import { iconOf, type App, type Flag, type Tool } from '../app';
import { Builder } from './builder';
import { buildCustom } from '../physics/custom';
import { bakeShaped, drawCells } from '../pixel/shaped';
import { drawCraft, drawWhiteHole, drawWormhole, drawPulsar, drawJet } from '../pixel/phenomena';
import { GRID } from '../physics/materials';
import type { Body } from '../physics/body';
import { CATALOG, SHELVES, makeBody, type Shelf } from '../physics/catalog';
import { PRESETS } from '../physics/presets';
import { ERAS, Early } from '../physics/early';
import { osculating, relative, norm } from '../physics/orbit';
import { fmtMass, fmtLength, fmtDuration, sig, KMS, M_EARTH, M_JUP, densityOf } from '../physics/units';
import { msLife, giantLife } from '../physics/stellar';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const KIND: Record<string, string> = {
  rock: 'Rocky body', ice: 'Icy body', gas: 'Giant', star: 'Star', wd: 'White dwarf', ns: 'Neutron star', bh: 'Black hole', debris: 'Debris',
};
const PHASE: Record<string, string> = { proto: 'pre-main-sequence', ms: 'main sequence', giant: 'giant branch', agb: 'asymptotic giant branch', remnant: 'remnant' };

/** icons drawn the way the renderer draws the thing itself: craft, white holes, wormholes, active nuclei, pulsars */
function specialIcon(b: Body): string {
  const S = 22;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const halo = (R: number, c: [number, number, number], k: number) => {
    const h = document.createElement('canvas');
    const n = Math.max(3, Math.ceil(R * 2) | 1);
    h.width = h.height = n;
    const g = h.getContext('2d')!;
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, `rgba(${c.map(v => Math.round(v * 255)).join(',')},${Math.min(1, k)})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
    return h;
  };
  const c = S / 2;
  if (b.look.craft) {
    // the sprite, doubled so it reads at shelf size
    const t = document.createElement('canvas'); t.width = t.height = 11;
    drawCraft(t.getContext('2d')!, b, 5, 5);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t, 0, 0, 22, 22);
  } else if (b.look.white) drawWhiteHole(ctx, c, c, 3, 0.3, halo);
  else if (b.look.wormhole) drawWormhole(ctx, c, c, 4.5, 0.3, 7);
  else if (b.cls === 'ns') {
    drawPulsar(ctx, c, c, 2, 0.6, !!b.look.magnetar);
    ctx.fillStyle = '#cfe0ff'; ctx.fillRect(c - 1, c - 1, 3, 3);
  } else {
    // an active nucleus: the black disc, its glowing ring, the jets
    b.lx = 0.7; b.ly = 0.5; b.lz = 0.5;
    drawJet(ctx, b, c, c, 2, 0.9, 11, 0.3, halo);
    ctx.fillStyle = '#000'; ctx.fillRect(c - 2, c - 2, 5, 5);
    ctx.fillStyle = '#ffb070'; ctx.fillRect(c - 3, c, 7, 1);
  }
  return cv.toDataURL();
}

/** a body's icon: its drawn outline if it holds one, otherwise the round sprite */
function shapedIcon(b: Body): string {
  if (b.shape && !b.shape.packed && b.shape.roundGoal < 0.95) {
    let ext = 1;
    for (const v of b.shape.outline) ext = Math.max(ext, v);
    const sp = bakeShaped(b.shape, Math.round(40 / ext), 0.4, [-0.6, 0.5, 0.65], [1.1, 1.08, 1.04], 0);
    const cv = document.createElement('canvas');
    cv.width = cv.height = sp.size;
    cv.getContext('2d')!.putImageData(new ImageData(sp.data, sp.size, sp.size), 0, 0);
    return cv.toDataURL();
  }
  return iconOf(b);
}

export class Hud {
  private shelf: Shelf = 'Worlds';
  private icons = new Map<string, string>();
  private lastInspect = 0;
  private toastBox = $('toasts');
  builder!: Builder;
  private ownIcon: { key: string; url: string } | null = null;

  constructor(private app: App) {
    for (const e of CATALOG) {
      const b = { look: { ...e.look, seed: 7 }, heat: e.key === 'lava' ? 1 : 0, cls: e.cls, tilt: ((e.tilt ?? 0) * Math.PI) / 180,
        star: e.cls === 'star' ? { m0: e.m, age: 0, phase: e.key === 'redgiant' || e.key === 'supergiant' || e.key === 'hypergiant' ? 'giant' as const : 'ms' as const, L: 1,
          teff: ({ protostar: 4300, reddwarf: 3200, kdwarf: 4500, sun: 5772, fstar: 6600, astar: 9900, bstar: 15000, ostar: 38000, bluesg: 12000,
            redgiant: 3400, supergiant: 3600, hypergiant: 3500, lbv: 25000 } as Record<string, number>)[e.key] ?? 5772, coreM: 0 } : undefined };
      const special = e.look.craft || e.look.white || e.look.wormhole || e.extra?.kind === 'agn' || e.look.pulsar;
      this.icons.set(e.key, e.shape ? shapedIcon(makeBody(e.key, 7)) : special ? specialIcon(makeBody(e.key, 7)) : iconOf(b));
    }
    this.buildPresets();
    this.buildShelves();
    this.buildToggles();
    this.buildInspector();
    this.builder = new Builder(app, () => { this.updateForge(); this.arm('custom'); });
    this.buildClock();
    this.buildTools();
    this.buildFind();
    this.buildEras();
    app.openBuilder = () => this.builder.open();
    $('undoBtn').onclick = () => app.undo();
    app.onUndo = label => {
      const b = $<HTMLButtonElement>('undoBtn');
      b.disabled = !label;
      b.title = label ? `Undo ${label} (Ctrl/⌘ Z)` : 'Nothing to undo';
    };
    $('helpBtn').onclick = () => { $('help').hidden = !$('help').hidden; };
    $('modeBtn').onclick = () => void app.toggle3D();
    app.onMode = () => {
      $('modeBtn').textContent = app.mode3d ? '2D' : '3D';
      $('modeBtn').title = app.mode3d ? 'Back to the 2D view (V)' : 'Fly through it in 3D (V)';
      $('modeBtn').classList.toggle('on', app.mode3d);
      // on a touch screen the 3D view needs its room: the inspector folds to its name
      if (app.mode3d && matchMedia('(pointer: coarse)').matches) $('inspector').classList.add('min');
      this.sync();
    };
    // settings, and the cheat for the clock
    $('setBtn').onclick = () => { $('settings').hidden = !$('settings').hidden; };
    $('sClose').onclick = () => { $('settings').hidden = true; };
    const cheat = $<HTMLInputElement>('cheatWarp');
    cheat.oninput = () => { app.warpLog = Number(cheat.value); };
    $('cheatReal').onclick = () => { app.warpLog = Math.log10(1 / (365.25 * 86400)); };
    $('hClose').onclick = () => { $('help').hidden = true; };
    this.buildCompact();
    $('clear').onclick = () => app.clear();
    let last: unknown = null;
    app.onSelect = b => {
      // on a small screen (or a touch screen in 3D) a newly picked body shows just its name until opened
      if (b && b !== last && (Hud.compact() || (app.mode3d && matchMedia('(pointer: coarse)').matches))) $('inspector').classList.add('min');
      last = b;
      this.inspect(true);
    };
    app.onToast = m => this.toast(m);
    app.onFrame = () => this.tick();
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || app.mode3d || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!$('builder').hidden) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const list = CATALOG.filter(c => c.shelf === this.shelf);
        const c = list[n - 1];
        if (c) this.arm(app.armed === c.key ? null : c.key);
      }
    });
  }

  private static HINT: Record<string, string> = {
    select: 'Select: tap a body to select it, double-tap to follow it, drag to look around.',
    hand: 'Move: drag a body to carry it and let go to throw it. Tap Move again to put it down.',
    attract: 'Attract: press and hold to pull everything nearby in. Drag to move the pull. Hold long enough and what it gathers collides.',
    repel: 'Repel: press and hold to push everything nearby away.',
    laser: 'Laser: hold on a body to boil it away, or press and drag to aim the beam. What it boils off pushes the body like a rocket.',
    blast: 'Blast: tap to set off an explosion. It throws everything nearby outward and shatters worlds near the middle.',
    clone: 'Clone: tap a body to copy it, then tap empty space to place copies (drag to throw them).',
    ruler: 'Ruler: drag between two points; start or end on a body to measure from it as it moves.',
    push: 'Push: press on a body and drag — a full-length drag is its whole orbital speed. The dotted line is the new path.',
    bombard: 'Bombard: press and hold on a world to rain small rocks on it. Watch the craters build up, or the scars on a giant.',
    erase: 'Erase: rub over bodies and debris to remove them.',
  };

  private buildTools() {
    for (const el of document.querySelectorAll<HTMLElement>('[data-tool]')) {
      el.onclick = () => {
        this.app.setTool(el.dataset.tool as Tool);
        if (this.app.tool !== 'select' || el.dataset.tool === 'select') this.toast(Hud.HINT[this.app.tool]);
        this.sync();
      };
    }
  }

  private buildFind() {
    const menu = $('findMenu'), q = $<HTMLInputElement>('findQ'), list = $('findList');
    const fill = () => {
      const s = q.value.trim().toLowerCase();
      const hits = this.app.world.sources.concat(this.app.visual.filter(b => !b.source))
        .filter((b, i, a) => b.alive && a.indexOf(b) === i && b.name !== 'debris' && b.name !== 'moonlet' && (!s || b.name.toLowerCase().includes(s)))
        .sort((a, b) => b.m - a.m).slice(0, 40);
      list.innerHTML = '';
      for (const b of hits) {
        const el = document.createElement('button');
        el.innerHTML = `<b>${b.name}</b><span>${KIND[b.cls] ?? ''}</span>`;
        el.onclick = () => { this.app.select(b); this.app.follow(b); menu.hidden = true; };
        list.appendChild(el);
      }
      if (!hits.length) list.innerHTML = '<div class="mgroup">Nothing by that name</div>';
    };
    q.oninput = fill;
    q.onkeydown = e => { if (e.key === 'Enter') (list.querySelector('button') as HTMLElement | null)?.click(); if (e.key === 'Escape') menu.hidden = true; };
    $('findBtn').onclick = () => { menu.hidden = !menu.hidden; $('presetMenu').hidden = true; if (!menu.hidden) { q.value = ''; fill(); q.focus(); } };
    document.addEventListener('pointerdown', e => {
      if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== $('findBtn')) menu.hidden = true;
    });
  }

  /** the early solar system's eras: where it is, what comes next, a jump to any era, and at the end the score */
  private buildEras() {
    const menu = $('eraMenu');
    const fill = (score: boolean) => {
      const e = this.app.early;
      if (!e) return;
      if (score && e.score) {
        menu.innerHTML = `<div class="era-score"><div><span>Against the real solar system</span><b class="big">${e.score.total.toFixed(0)}%</b></div>`
          + e.score.rows.map(r => `<div><span>${r.name}<i>${r.note}</i></span><b>${(r.score * 100).toFixed(0)}%</b></div>`).join('') + '</div>';
        return;
      }
      menu.innerHTML = '<div class="mgroup">Jump to an era, as the textbooks have it</div>' + ERAS.map((x, k) => `<button data-era="${k}"${k === e.era ? ' class="on"' : ''}><b>${x.name}</b><span>${Early.ago(x.at)}</span></button>`).join('');
      for (const b of menu.querySelectorAll<HTMLElement>('[data-era]')) b.onclick = () => { this.app.remember('jumping to an era'); this.app.startEarly(Number(b.dataset.era)); menu.hidden = true; };
    };
    // (open on the first press, or when it shows the other list; shut on the second)
    const open = (kind: string) => { const show = menu.hidden || menu.dataset.kind !== kind; menu.hidden = !show; menu.dataset.kind = kind; if (show) fill(kind === 'score'); };
    $('eraBtn').onclick = () => open('eras');
    $('eraScore').onclick = () => open('score');
  }

  private eraTick() {
    const e = this.app.early, box = $('eraBox');
    box.hidden = !e;
    document.body.classList.toggle('era-on', !!e);
    if (!e) { $('eraMenu').hidden = true; return; }
    const set = (id: string, t: string) => { const el = $(id); if (el.textContent !== t) el.textContent = t; };
    set('eraAgo', Early.ago(e.age));
    set('eraName', e.current.name);
    set('eraNext', e.next());
    $('eraScore').hidden = !e.score;
    $('eraName').title = e.current.blurb;
  }

  private buildPresets() {
    const menu = $('presetMenu');
    let group = '';
    for (const p of PRESETS) {
      if (p.group !== group) {
        group = p.group;
        const h = document.createElement('div');
        h.className = 'mgroup';
        h.textContent = group;
        menu.appendChild(h);
      }
      const b = document.createElement('button');
      b.innerHTML = `<b>${p.name}</b><span>${p.blurb}</span>`;
      b.onclick = () => { this.app.loadPreset(p.key); menu.hidden = true; this.sync(); };
      menu.appendChild(b);
    }
    $('presetBtn').onclick = () => { menu.hidden = !menu.hidden; };
    document.addEventListener('pointerdown', e => {
      if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== $('presetBtn')) menu.hidden = true;
    });
  }

  private buildShelves() {
    const box = $('shelves');
    for (const s of SHELVES) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = s;
      b.dataset.shelf = s;
      b.onclick = () => { this.shelf = s; this.buildCards(); this.syncShelves(); };
      box.appendChild(b);
    }
    this.syncShelves();
    this.buildCards();
  }
  private syncShelves() {
    for (const b of $('shelves').children) (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.shelf === this.shelf);
  }

  private buildCards() {
    const box = $('cards');
    box.innerHTML = '';
    CATALOG.filter(c => c.shelf === this.shelf).forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'card';
      d.dataset.key = c.key;
      d.title = c.blurb;
      d.innerHTML = `<img src="${this.icons.get(c.key)}" alt=""><span>${c.name}</span><kbd>${i + 1}</kbd>`;
      d.onclick = () => this.arm(this.app.armed === c.key ? null : c.key);
      box.appendChild(d);
    });
    const f = document.createElement('div');
    f.className = 'card';
    f.dataset.key = 'custom';
    f.innerHTML = `<img src="${this.forgeIcon()}" alt=""><span>Build…</span><kbd>B</kbd>`;
    f.title = 'Draw your own world from materials, or set up a star';
    f.onclick = () => this.builder.open();
    box.appendChild(f);
    this.syncCards();
  }
  private armedIcon: string | null | undefined;
  private syncCards() {
    const key = this.app.armed;
    for (const c of $('cards').children) (c as HTMLElement).classList.toggle('on', (c as HTMLElement).dataset.key === key);
    const icon = key ? (key === 'custom' ? this.forgeIcon() : this.icons.get(key) ?? null) : null;
    if (icon === this.armedIcon) return;
    this.armedIcon = icon;
    $('drawerBtn').innerHTML = icon ? `<img src="${icon}" alt=""><span>Armed</span>` : '<b>＋</b><span>Bodies</span>';
    $('drawerBtn').classList.toggle('on', !!key);
  }

  arm(key: string | null) {
    this.app.armed = key;
    this.syncCards();
    // the drawer gets out of the way so you can see where to throw, and its button wears what you picked
    if (key && Hud.compact()) document.body.classList.remove('drawer');
    if (key) {
      const e = CATALOG.find(c => c.key === key);
      if (e) this.toast(`${e.name}: ${e.blurb} Drag from space to throw it, tap to place it.`);
      else if (key === 'custom') this.toast(`${this.app.custom.name || 'Your body'} is ready: drag from space to throw it, tap to place it.`);
    }
  }

  private buildToggles() {
    for (const el of document.querySelectorAll<HTMLElement>('.tog')) {
      el.onclick = () => { const f = el.dataset.flag as Flag; this.app.flags[f] = !this.app.flags[f]; this.sync(); };
    }
  }

  private buildClock() {
    const w = $<HTMLInputElement>('warp');
    w.oninput = () => { this.app.warpLog = Number(w.value); };
    $('pause').onclick = () => { this.app.paused = !this.app.paused; this.sync(); };
  }

  sync() {
    for (const el of document.querySelectorAll<HTMLElement>('.tog')) el.classList.toggle('on', this.app.flags[el.dataset.flag as Flag]);
    for (const el of document.querySelectorAll<HTMLElement>('[data-tool]')) el.classList.toggle('on', el.dataset.tool === this.app.tool);
    $<HTMLInputElement>('warp').value = String(this.app.warpLog);
    $('pause').textContent = this.app.paused ? '▶' : '❚❚';
    this.syncCards();
  }

  /**
   * Small screens: the less-used buttons fold behind ⋯, the bodies to throw
   * in sit in a drawer behind ＋, the inspector folds down to its title, and
   * 👁 hides everything to leave just the sky.
   */
  private buildCompact() {
    const app = this.app, body = document.body;
    $('moreBtn').onclick = () => $('moreBtn').closest('.top-right')!.classList.toggle('more');
    document.addEventListener('pointerdown', e => {
      const tr = $('moreBtn').closest('.top-right')!;
      if (tr.classList.contains('more') && !tr.contains(e.target as Node)) tr.classList.remove('more');
    });
    const clean = (on: boolean) => { body.classList.toggle('clean', on); $('showUi').hidden = !on; };
    $('hideBtn').onclick = () => { clean(true); $('moreBtn').closest('.top-right')!.classList.remove('more'); };
    $('showUi').onclick = () => clean(false);
    $('drawerBtn').onclick = () => body.classList.toggle('drawer');
    $('iMin').onclick = e => { e.stopPropagation(); $('inspector').classList.toggle('min'); };
    $('inspector').querySelector('.ihead')!.addEventListener('click', e => {
      if (!(e.target as HTMLElement).closest('button') && $('inspector').classList.contains('min')) $('inspector').classList.remove('min');
    });
    // the look settings, kept on this device
    const sp = $<HTMLInputElement>('lookSpeed'), inv = $<HTMLInputElement>('lookInvert');
    const show = () => { $('lookV').textContent = `×${app.lookSpeed.toFixed(2)}`; };
    try {
      const saved = JSON.parse(localStorage.getItem('orbital.look') ?? 'null');
      if (saved) { sp.value = String(saved.speed ?? 0); inv.checked = !!saved.invert; }
    } catch { /* no storage: defaults */ }
    const apply = () => {
      app.lookSpeed = Math.pow(3, Number(sp.value));
      app.lookInvert = inv.checked;
      show();
      try { localStorage.setItem('orbital.look', JSON.stringify({ speed: Number(sp.value), invert: inv.checked })); } catch { /* fine */ }
    };
    sp.oninput = apply;
    inv.onchange = apply;
    apply();
    // the night-side light, kept too
    const nl = $<HTMLInputElement>('nightLight');
    try { const v = Number(localStorage.getItem('orbital.night') ?? '0'); if (isFinite(v)) nl.value = String(v); } catch { /* defaults */ }
    const night = () => {
      app.nightLight = Number(nl.value);
      $('nightV').textContent = app.nightLight ? `${Math.round(app.nightLight * 100)}%` : 'off';
      try { localStorage.setItem('orbital.night', nl.value); } catch { /* fine */ }
    };
    nl.oninput = night;
    night();
  }

  /** a small screen, where panels fold away */
  static compact() { return matchMedia('(max-width: 720px), (max-height: 520px)').matches; }

  private buildInspector() {
    $('iClose').onclick = () => this.app.select(null);
    $('iFollow').onclick = () => {
      const a = this.app;
      a.follow(a.focus === a.selected ? null : a.selected);
      this.inspect(true);
    };
    $('iDelete').onclick = () => this.app.deleteSelected();
    $('iCirc').onclick = () => { if (this.app.selected) this.app.circularize(this.app.selected); };
    $('iRev').onclick = () => { if (this.app.selected) this.app.reverse(this.app.selected); };
    $('iShatter').onclick = () => { if (this.app.selected) this.app.shatter(this.app.selected); };
    for (const el of document.querySelectorAll<HTMLElement>('[data-proj]')) el.onclick = () => { this.proj = el.dataset.proj as 'flat' | 'moll' | 'cut'; this.inspect(true); };
  }

  private inspect(force = false) {
    const now = performance.now();
    if (!force && now - this.lastInspect < 250) return;
    this.lastInspect = now;
    const b = this.app.selected;
    const box = $('inspector');
    if (!b || !b.alive) { box.hidden = true; return; }
    box.hidden = false;
    let icon = this.icons.get(b.kind) ?? this.icons.get(b.cls === 'star' ? 'sun' : b.cls === 'bh' ? 'bh' : b.cls === 'debris' ? 'asteroid' : 'terran');
    if (b.kind === 'custom' && b.cls !== 'star') {
      const key = `${b.id}|${Math.round((b.shape?.round ?? 1) * 10)}|${b.shape?.packed}`;
      if (this.ownIcon?.key !== key) this.ownIcon = { key, url: shapedIcon(b) };
      icon = this.ownIcon.url;
    }
    $<HTMLImageElement>('iIcon').src = icon ?? '';
    $('iName').textContent = b.name;
    let kind = b.look.craft ? 'Spacecraft' : b.look.white ? 'White hole (hypothetical)' : b.look.wormhole ? 'Wormhole mouth (hypothetical)'
      : b.look.magnetar ? 'Magnetar' : b.look.pulsar ? 'Pulsar' : b.feed > 0 && b.cls === 'bh' ? 'Active black hole' : KIND[b.cls] ?? b.cls;
    if (b.star && b.cls === 'star') kind += ` · ${PHASE[b.star.phase]}`;
    $('iKind').textContent = kind;
    const rows: [string, string][] = [];
    rows.push(['Mass', `${fmtMass(b.m)}${b.m < 0.08 && b.m >= 0.05 * M_JUP ? ` · ${sig(b.m / M_EARTH)} M⊕` : ''}`]);
    rows.push([b.cls === 'bh' ? 'Horizon' : 'Radius', fmtLength(b.r, b.cls === 'star')]);
    if (b.cls !== 'bh') rows.push(['Density', `${sig(densityOf(b.m, b.r))} g/cm³`]);
    const host = this.app.hostOf(b);
    if (host) {
      const { r, v, mu } = relative(b, host);
      const o = osculating(mu, r, v);
      rows.push(['Orbits', `<a data-id="${host.id}">${host.name}</a>`]);
      rows.push(['Distance', fmtLength(norm(r))]);
      rows.push(['Speed', `${sig(norm(v) / KMS)} km/s`]);
      if (o.a > 0 && o.e < 1) {
        rows.push(['Semi-major axis', fmtLength(o.a)]);
        rows.push(['Eccentricity', sig(o.e, 3)]);
        rows.push(['Inclination', `${sig((o.i * 180) / Math.PI, 3)}°`]);
        rows.push(['Period', fmtDuration(o.period)]);
      } else rows.push(['Orbit', 'unbound — escaping']);
      const hill = this.app.hillOf(b);
      if (isFinite(hill) && b.source) rows.push(['Hill radius', fmtLength(hill)]);
    }
    if (b.star) {
      const s = b.star;
      if (b.cls === 'star') {
        rows.push(['Luminosity', `${sig(s.L)} L☉`]);
        rows.push(['Surface', `${Math.round(s.teff)} K`]);
        rows.push(['Born with', fmtMass(s.m0)]);
        const life = msLife(s.m0) + giantLife(s.m0);
        rows.push(['Age', s.age < 0 ? `${fmtDuration(-s.age)} to ignition` : fmtDuration(s.age)]);
        rows.push(['Time left', fmtDuration(Math.max(0, life - s.age))]);
      } else if (b.cls === 'wd') rows.push(['Cooling for', fmtDuration(s.age)]);
    }
    if (b.heat > 0.05 && !b.star) rows.push(['Surface', b.heat > 0.55 ? 'molten' : b.heat > 0.3 ? 'volcanic' : 'cooling']);
    if (b.craters.length) rows.push([b.cls === 'gas' ? 'Impact scars' : 'Craters', String(b.craters.length)]);
    if (b.compact) {
      const rate = this.app.accRate(b);
      if (rate > 0) rows.push(['Feeding', `${sig(rate)} M☉/yr · ${sig(rate / (2.2e-8 * b.m))}× Eddington`]);
    }
    if (b.look.wormhole) {
      const o = this.app.world.sources.find(x => x.id === b.partnerId);
      rows.push(['Leads to', o ? `<a data-id="${o.id}">${o.name}</a>` : 'nothing — its other mouth is gone']);
    }
    if (b.feedLeft > 0) rows.push(['Inner disc', `${fmtMass(b.feedLeft)} left, feeding ${sig(b.feed)} M☉/yr`]);
    if (b.sizeGuess) rows.push(['Note', 'mass estimated, not measured']);
    if (!b.source && !b.isParticle) rows.push(['Gravity', 'too small to pull on others']);
    this.drawMap(b);
    const dl = $('iStats');
    dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    for (const a of dl.querySelectorAll<HTMLElement>('a[data-id]')) {
      const id = Number(a.dataset.id);
      a.onclick = () => { const t = this.app.world.sources.find(s => s.id === id); if (t) this.app.select(t); };
    }
    $('iFollow').textContent = this.app.focus === b ? 'Unfollow' : 'Follow';
    $('iFollow').classList.toggle('on', this.app.focus === b);
  }

  // ---- the inspector's map ----
  private proj: 'flat' | 'moll' | 'cut' = 'flat';

  /**
   * The selected world unrolled: an equirectangular map (or Mollweide's
   * equal-area globe) of its surface as it is now, craters included, with the
   * night side dark. A hand-drawn body can also be cut open to show what it
   * was built from.
   */
  private drawMap(b: Body) {
    const box = $('iMapBox');
    const surf = this.app.view.surfaceOf(b, this.app.world.sources);
    const canCut = !!b.shape;
    if (!surf && !canCut) { box.hidden = true; return; }
    box.hidden = false;
    $('iCut').hidden = !canCut;
    if (this.proj === 'cut' && !canCut) this.proj = 'flat';
    if (!surf && this.proj !== 'cut') this.proj = 'cut';
    for (const el of document.querySelectorAll<HTMLElement>('[data-proj]')) el.classList.toggle('on', el.dataset.proj === this.proj);
    const cv = $<HTMLCanvasElement>('iMap');
    const ctx = cv.getContext('2d')!;
    if (this.proj === 'cut' && b.shape) {
      $('iMapT').textContent = b.shape.packed ? 'Cross-section, settled' : 'Cross-section';
      cv.width = cv.height = GRID * 2;
      cv.style.aspectRatio = '1 / 1';
      cv.style.width = '50%';
      cv.style.alignSelf = 'center';
      drawCells(ctx, b.shape.cells, 2, b.shape.marks);
      return;
    }
    cv.style.aspectRatio = '2 / 1';
    cv.style.width = '100%';
    if (!surf) return;
    $('iMapT').textContent = b.craters.length ? `Surface · ${b.craters.length} ${b.cls === 'gas' ? 'scars' : 'craters'}` : 'Surface';
    const { map, frame, L } = surf;
    const W = 384, H = 192;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const img = ctx.createImageData(W, H);
    // the light in the body's own frame
    let Ll: number[] | null = null;
    if (L) {
      const n = Math.hypot(L[0], L[1], L[2]) || 1;
      const l = [L[0] / n, L[1] / n, L[2] / n];
      Ll = frame.map(e => e[0] * l[0] + e[1] * l[1] + e[2] * l[2]);
    }
    const moll = this.proj === 'moll';
    const smp = { r: 0, g: 0, b: 0, e: 0, s: 0, dx: 0, dy: 0 };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let lat: number, lon: number;
        if (moll) {
          // inverse Mollweide: the ellipse fills the canvas
          const X = ((x + 0.5) / W * 2 - 1) * 2 * Math.SQRT2, Y = (1 - (y + 0.5) / H * 2) * Math.SQRT2;
          if ((X * X) / 8 + (Y * Y) / 2 > 1) continue;
          const th = Math.asin(Y / Math.SQRT2);
          lat = Math.asin((2 * th + Math.sin(2 * th)) / Math.PI);
          lon = Math.PI + (Math.PI * X) / (2 * Math.SQRT2 * Math.cos(th));
        } else {
          lat = (0.5 - (y + 0.5) / H) * Math.PI;
          lon = ((x + 0.5) / W) * 2 * Math.PI;
        }
        sampleMap(map, lat, lon, smp);
        let r = smp.r, g = smp.g, bl = smp.b;
        const e = smp.e + Math.max(0, (b.heat - 0.55) / 0.45) * 0.6;
        if (Ll) {
          const nx = Math.cos(lat) * Math.cos(lon), ny = Math.cos(lat) * Math.sin(lon), nz = Math.sin(lat);
          const mu = nx * Ll[0] + ny * Ll[1] + nz * Ll[2];
          const lit = 0.28 + 0.72 * Math.max(0, Math.min(1, (mu + 0.05) / 0.12));
          r *= lit; g *= lit; bl *= lit;
        }
        if (e > 0) { r = Math.max(r, e); g = Math.max(g, e * 0.45); bl = Math.max(bl, e * 0.12); }
        const o = (y * W + x) * 4;
        img.data[o] = r * 255; img.data[o + 1] = g * 255; img.data[o + 2] = bl * 255; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---- builder ----
  private forgeIcon() {
    const c = this.app.custom;
    const b = buildCustom(c);
    if (!b) return this.icons.get('asteroid') ?? '';
    return shapedIcon(b);
  }

  private updateForge() {
    const card = document.querySelector<HTMLImageElement>('.card[data-key="custom"] img');
    if (card) card.src = this.forgeIcon();
    const name = document.querySelector<HTMLElement>('.card[data-key="custom"] span');
    if (name) name.textContent = this.app.custom.name || 'Custom';
  }

  toast(msg: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    this.toastBox.appendChild(t);
    while (this.toastBox.children.length > 3) this.toastBox.firstChild!.remove();
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 700); }, 3800);
  }

  private tick() {
    const a = this.app;
    $('elapsed').textContent = `t = ${fmtDuration(a.world.time)}`;
    if (!$('settings').hidden) {
      const c = $<HTMLInputElement>('cheatWarp');
      if (c !== document.activeElement) c.value = String(a.warpLog);
      $('cheatV').textContent = a.warp * 365.25 * 86400 < 1.5 && a.warp * 365.25 * 86400 > 0.67 ? 'real time — one second a second' : `${fmtDuration(a.warp)} per second`;
    }
    const want = a.warp;
    $('rate').textContent = a.paused ? 'paused' : `${fmtDuration(want)} per second`;
    const lag = !a.paused && a.rate < 0.8 * want ? ` running at ${fmtDuration(a.rate)}/s` : '';
    $('lag').textContent = lag;
    $('lag').title = lag ? 'The integrator is taking the steps the closest pair of bodies needs; accuracy is not traded for speed.' : '';
    if ($<HTMLInputElement>('warp') !== document.activeElement) $<HTMLInputElement>('warp').value = String(a.warpLog);
    $('pause').textContent = a.paused ? '▶' : '❚❚';
    for (const el of document.querySelectorAll<HTMLElement>('.tog')) el.classList.toggle('on', a.flags[el.dataset.flag as Flag]);
    const n = a.world.sources.length, p = a.world.particleCount;
    $('stats').textContent = `${n} bodies · ${p} particles`;
    const rt = a.rulerText();
    const rb = $('rulerBox');
    rb.hidden = !rt;
    if (rt && rb.textContent !== rt) rb.textContent = rt;
    for (const el of document.querySelectorAll<HTMLElement>('[data-tool]')) el.classList.toggle('on', el.dataset.tool === a.tool);
    this.eraTick();
    this.inspect();
  }
}


