import type { App, Flag } from '../app';
import type { Style } from '../physics/body';
import { CATALOG, SHELVES, type Shelf } from '../physics/catalog';
import { PRESETS } from '../physics/presets';
import { osculating, relative, norm } from '../physics/orbit';
import { fmtMass, fmtLength, fmtDuration, sig, KMS, M_EARTH, M_JUP, densityOf } from '../physics/units';
import { msLife, giantLife } from '../physics/stellar';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const KIND: Record<string, string> = {
  rock: 'Rocky body', ice: 'Icy body', gas: 'Giant', star: 'Star', wd: 'White dwarf', ns: 'Neutron star', bh: 'Black hole', debris: 'Debris',
};
const PHASE: Record<string, string> = { proto: 'pre-main-sequence', ms: 'main sequence', giant: 'giant branch', agb: 'asymptotic giant branch', remnant: 'remnant' };

export class Hud {
  private shelf: Shelf = 'Worlds';
  private icons = new Map<string, string>();
  private lastInspect = 0;
  private toastBox = $('toasts');

  constructor(private app: App) {
    for (const e of CATALOG) {
      const b = { look: { ...e.look, seed: 7 }, heat: e.key === 'lava' ? 1 : 0, cls: e.cls, tilt: ((e.tilt ?? 0) * Math.PI) / 180,
        star: e.cls === 'star' ? { m0: e.m, age: 0, phase: e.key === 'redgiant' || e.key === 'supergiant' ? 'giant' as const : 'ms' as const, L: 1,
          teff: { protostar: 4300, reddwarf: 3200, sun: 5772, astar: 9900, ostar: 38000, redgiant: 3400, supergiant: 3600 }[e.key] ?? 5772, coreM: 0 } : undefined };
      this.icons.set(e.key, app.icons.render(b));
    }
    this.buildPresets();
    this.buildShelves();
    this.buildToggles();
    this.buildInspector();
    this.buildForge();
    this.buildClock();
    $('helpBtn').onclick = () => { $('help').hidden = !$('help').hidden; };
    $('hClose').onclick = () => { $('help').hidden = true; };
    $('clear').onclick = () => app.clear();
    app.onSelect = () => this.inspect(true);
    app.onToast = m => this.toast(m);
    app.onFrame = () => this.tick();
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const list = CATALOG.filter(c => c.shelf === this.shelf);
        const c = list[n - 1];
        if (c) this.arm(app.armed === c.key ? null : c.key);
      }
    });
  }

  private buildPresets() {
    const menu = $('presetMenu');
    for (const p of PRESETS) {
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
    f.innerHTML = `<img src="${this.forgeIcon()}" alt=""><span>Forge…</span><kbd>&nbsp;</kbd>`;
    f.onclick = () => { $('forge').hidden = false; this.updateForge(); };
    box.appendChild(f);
    this.syncCards();
  }
  private syncCards() {
    for (const c of $('cards').children) (c as HTMLElement).classList.toggle('on', (c as HTMLElement).dataset.key === this.app.armed);
  }

  arm(key: string | null) {
    this.app.armed = key;
    this.syncCards();
    if (key) {
      const e = CATALOG.find(c => c.key === key);
      if (e) this.toast(`${e.name}: ${e.blurb} Drag from space to throw it, tap to place it.`);
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
    $<HTMLInputElement>('warp').value = String(this.app.warpLog);
    $('pause').textContent = this.app.paused ? '▶' : '❚❚';
    this.syncCards();
  }

  private buildInspector() {
    $('iClose').onclick = () => this.app.select(null);
    $('iFollow').onclick = () => {
      const a = this.app;
      a.follow(a.focus === a.selected ? null : a.selected);
      this.inspect(true);
    };
    $('iDelete').onclick = () => this.app.deleteSelected();
    $('iAge').onclick = () => this.app.ageSelected();
  }

  private inspect(force = false) {
    const now = performance.now();
    if (!force && now - this.lastInspect < 250) return;
    this.lastInspect = now;
    const b = this.app.selected;
    const box = $('inspector');
    if (!b || !b.alive) { box.hidden = true; return; }
    box.hidden = false;
    const icon = this.icons.get(b.kind) ?? this.icons.get(b.cls === 'star' ? 'sun' : b.cls === 'bh' ? 'bh' : b.cls === 'debris' ? 'asteroid' : 'terran');
    $<HTMLImageElement>('iIcon').src = icon ?? '';
    $('iName').textContent = b.name;
    let kind = KIND[b.cls] ?? b.cls;
    if (b.star && b.cls === 'star') kind += ` · ${PHASE[b.star.phase]}`;
    $('iKind').textContent = kind;
    const rows: [string, string][] = [];
    rows.push(['Mass', `${fmtMass(b.m)}${b.m < 0.08 && b.m > 1e-3 * M_EARTH ? ` · ${sig(b.m / (b.m > 0.05 * M_JUP ? M_EARTH : M_JUP))} ${b.m > 0.05 * M_JUP ? 'M⊕' : 'M♃'}` : ''}`]);
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
    if (b.heat > 0.05 && !b.star) rows.push(['Surface', b.heat > 0.4 ? 'molten' : 'cooling']);
    const dl = $('iStats');
    dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    for (const a of dl.querySelectorAll<HTMLElement>('a[data-id]')) {
      const id = Number(a.dataset.id);
      a.onclick = () => { const t = this.app.world.sources.find(s => s.id === id); if (t) this.app.select(t); };
    }
    $('iFollow').textContent = this.app.focus === b ? 'Unfollow' : 'Follow';
    $('iFollow').classList.toggle('on', this.app.focus === b);
    $('iAge').hidden = !(b.cls === 'star');
  }

  // ---- forge ----
  private buildForge() {
    const c = this.app.custom;
    const style = $<HTMLSelectElement>('fStyle'), mass = $<HTMLInputElement>('fMass'), rho = $<HTMLInputElement>('fRho');
    const c1 = $<HTMLInputElement>('fC1'), c2 = $<HTMLInputElement>('fC2');
    const defaults: Partial<Record<Style, [number, number, number]>> = {
      terran: [0x1d4f8c, 0x4f8a3c, 5.5], rocky: [0x6a5a48, 0x9aa070, 5.0], barren: [0x5d5a57, 0xb8b2a8, 3.3], desert: [0x8a3e1c, 0xd08a52, 4.0],
      ocean: [0x0c3a78, 0x2a7cc0, 3.0], ice: [0x6a9cc0, 0xeaf6ff, 1.8], lava: [0x1c0e0c, 0xff6a1a, 5.0], iron: [0x403c3a, 0x8a8480, 8.0],
      carbon: [0x15141a, 0x4a4450, 4.5], gas: [0xb08860, 0xf0e0c8, 1.3], icegiant: [0x2a50c0, 0x6aa0f0, 1.6], star: [0, 0, 1.4],
    };
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    style.onchange = () => {
      c.style = style.value as Style;
      const d = defaults[c.style];
      if (d) { c.c1 = d[0]; c.c2 = d[1]; c.rho = d[2]; c1.value = hex(d[0]); c2.value = hex(d[1]); rho.value = String(d[2]); }
      if (c.style === 'gas') { c.massLog = 2.5; mass.value = '2.5'; }
      if (c.style === 'icegiant') { c.massLog = 1.2; mass.value = '1.2'; }
      this.updateForge();
    };
    mass.oninput = () => { c.massLog = Number(mass.value); this.updateForge(); };
    rho.oninput = () => { c.rho = Number(rho.value); this.updateForge(); };
    c1.oninput = () => { c.c1 = parseInt(c1.value.slice(1), 16); this.updateForge(); };
    c2.oninput = () => { c.c2 = parseInt(c2.value.slice(1), 16); this.updateForge(); };
    $('fSeed').onclick = () => { c.seed = Math.floor(Math.random() * 1e6); this.updateForge(); };
    $('fUse').onclick = () => { this.arm('custom'); $('forge').hidden = true; this.toast('Custom body ready: drag from space to throw it.'); };
    $('fClose').onclick = () => { $('forge').hidden = true; };
  }

  private forgeIcon() {
    const c = this.app.custom;
    if (c.style === 'star') return this.app.icons.render({ look: { style: 'star', seed: c.seed, c1: 0, c2: 0 }, heat: 0, cls: 'star', tilt: 0, star: { m0: 1, age: 0, phase: 'ms', L: 1, teff: 5772 * Math.pow(this.app.customStarMass(), 0.55), coreM: 0 } });
    return this.app.icons.render({ look: { style: c.style, seed: c.seed, c1: c.c1, c2: c.c2, atmo: c.style === 'terran' || c.style === 'ocean' ? 0x7ab0ff : undefined }, heat: c.style === 'lava' ? 0.8 : 0, cls: 'rock', tilt: 0.3 });
  }

  private updateForge() {
    const c = this.app.custom;
    $<HTMLImageElement>('fPrev').src = this.forgeIcon();
    const star = c.style === 'star';
    $('fMassV').textContent = star ? `${sig(this.app.customStarMass())} M☉` : fmtMass(Math.pow(10, c.massLog) * M_EARTH);
    $('fRhoV').textContent = star ? 'set by the star' : `${sig(c.rho)} g/cm³`;
    $<HTMLInputElement>('fRho').disabled = star;
    const card = document.querySelector<HTMLImageElement>('.card[data-key="custom"] img');
    if (card) card.src = $<HTMLImageElement>('fPrev').src;
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
    this.inspect();
  }
}


