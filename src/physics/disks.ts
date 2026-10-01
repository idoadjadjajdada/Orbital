import { Body } from './body';
import type { World } from './world';
import { G, AU_M, MSUN_KG, radiusFromDensity, KMS } from './units';
import { hostOfPoint, lagrangePoints } from './analysis';
import { spawnFragments } from './events';

/*
 * Discs and rings: what a swarm of debris or gas does when it is going round
 * something, beyond following its own orbit.
 *
 * Collisions. Particles that share a patch of a disc hit each other. Each hit
 * keeps momentum and loses energy, so the random part of the motion — the
 * eccentricities and inclinations, the spread of velocities at one place —
 * dies away while the shared orbital motion survives. That is the whole
 * reason a cloud of debris becomes a thin, nearly circular ring. In a disc of
 * optical depth τ each particle is hit about 3Ωτ times per radian of orbit
 * (the kinetic theory of planetary rings), so the random velocities in a
 * patch relax toward the patch's mean at that rate. Each simulated particle
 * stands for a great many metre-sized pieces; τ is computed from their real
 * total cross-section.
 *
 * Clumping. Outside the Roche limit the pieces in a patch can hold together
 * once their combined Hill sphere is bigger than the patch: they gather into
 * a moonlet. Inside it tides win and they never can — so what is left inside
 * the Roche limit stays a ring.
 *
 * Viscosity. Gas round a compact object is turbulent; the stress carries
 * angular momentum outward and lets the gas spiral in (Shakura & Sunyaev's
 * α-disc, α = 0.1, aspect ratio 0.05), heating as it goes.
 */

const LOG_DR = 0.04;     // radial cell width, as a fraction of radius
const GRAIN = 1;         // m: the size a debris particle's mass is assumed to be broken into
const GRAIN_RHO = 1500;  // kg/m³
const ALPHA = 0.1, ASPECT = 0.05;


export class DiskPhysics {
  private frame = 0;
  private hostOf = new Map<Body, Body | null>();

  step(w: World, hosts: Map<Body, { host: Body | null; hill: number }>, dt: number): boolean {
    this.frame++;
    const groups = new Map<Body, Body[]>();
    const srcs = w.sources;
    if (!srcs.length) return false;
    for (const p of w.bodies) {
      if (!p.alive || !p.isParticle) continue;
      // who it goes round changes slowly; refresh an eighth of the swarm each frame
      let h = this.hostOf.get(p);
      if (h === undefined || (p.id + this.frame) % 8 === 0 || (h && !h.alive)) {
        h = hostOfPoint([p.x, p.y, p.z], [p.vx, p.vy, p.vz], srcs, hosts);
        if (h) {
          const dx = p.x - h.x, dy = p.y - h.y, dz = p.z - h.z;
          const v2 = (p.vx - h.vx) ** 2 + (p.vy - h.vy) ** 2 + (p.vz - h.vz) ** 2;
          // bound against the pull that is left after starlight pushes back (radiation pressure)
          const mEff = h.m - p.beta * (h.star?.L ?? 0);
          if (mEff <= 0 || v2 / 2 - G * mEff / Math.hypot(dx, dy, dz) >= 0) h = null; // just passing, or blowing away
        }
        this.hostOf.set(p, h);
      }
      if (!h) continue;
      let g = groups.get(h);
      if (!g) groups.set(h, (g = []));
      g.push(p);
    }
    for (const p of this.hostOf.keys()) if (!p.alive) this.hostOf.delete(p);

    let touched = false;
    for (const [host, list] of groups) if (list.length >= 6 && this.relax(w, host, list, dt)) touched = true;
    return touched;
  }

  private relax(w: World, host: Body, list: Body[], dt: number): boolean {
    // the disc's own plane: perpendicular to the swarm's total angular momentum
    let Lx = 0, Ly = 0, Lz = 0;
    for (const p of list) {
      const rx = p.x - host.x, ry = p.y - host.y, rz = p.z - host.z;
      const vx = p.vx - host.vx, vy = p.vy - host.vy, vz = p.vz - host.vz;
      Lx += p.m * (ry * vz - rz * vy); Ly += p.m * (rz * vx - rx * vz); Lz += p.m * (rx * vy - ry * vx);
    }
    const Ln = Math.hypot(Lx, Ly, Lz);
    if (!(Ln > 0)) return false;
    const ez = [Lx / Ln, Ly / Ln, Lz / Ln];
    const t = Math.abs(ez[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let e1 = [t[1] * ez[2] - t[2] * ez[1], t[2] * ez[0] - t[0] * ez[2], t[0] * ez[1] - t[1] * ez[0]];
    const n1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = [e1[0] / n1, e1[1] / n1, e1[2] / n1];
    const e2 = [ez[1] * e1[2] - ez[2] * e1[1], ez[2] * e1[0] - ez[0] * e1[2], ez[0] * e1[1] - ez[1] * e1[0]];

    // Cells are columns through the disc (radius × azimuth): the optical depth
    // that sets the collision rate is a column quantity, and particles above
    // and below the plane must share a cell to damp their vertical motion.
    // Azimuthal resolution is chosen so a cell holds several particles.
    const n = list.length;
    const loc = new Float64Array(n * 6); // R, x, y in the disc plane; vR, vφ, vz
    let rMin = Infinity, rMax = 0;
    for (let k = 0; k < n; k++) {
      const p = list[k];
      const rx = p.x - host.x, ry = p.y - host.y, rz = p.z - host.z;
      const vx = p.vx - host.vx, vy = p.vy - host.vy, vz = p.vz - host.vz;
      const x = rx * e1[0] + ry * e1[1] + rz * e1[2];
      const y = rx * e2[0] + ry * e2[1] + rz * e2[2];
      const R = Math.hypot(x, y);
      const vxp = vx * e1[0] + vy * e1[1] + vz * e1[2], vyp = vx * e2[0] + vy * e2[1] + vz * e2[2];
      loc[k * 6] = R; loc[k * 6 + 1] = x; loc[k * 6 + 2] = y;
      loc[k * 6 + 3] = (x * vxp + y * vyp) / R;             // radial
      loc[k * 6 + 4] = (x * vyp - y * vxp) / R;             // azimuthal
      loc[k * 6 + 5] = vx * ez[0] + vy * ez[1] + vz * ez[2]; // vertical
      if (R > host.r) { rMin = Math.min(rMin, R); rMax = Math.max(rMax, R); }
    }
    if (!(rMax > rMin)) return false;
    const nR = Math.max(1, Math.ceil(Math.log(rMax / rMin) / LOG_DR));
    const nPhi = Math.max(6, Math.min(64, Math.floor(n / (nR * 6))));
    const sigK = 3 / (4 * GRAIN_RHO * GRAIN) / (AU_M * AU_M) * MSUN_KG; // AU² of grain cross-section per M☉
    const GM = G * host.m;
    interface Col { m: number; vol: number; sig: number; R: number; gas: number; mvR: number; mvz: number; L: number; Lk: number; idx: number[] }
    const cells = new Map<number, Col>();
    for (let k = 0; k < n; k++) {
      const R = loc[k * 6];
      if (!(R > host.r)) continue;
      const p = list[k];
      const ir = Math.floor(Math.log(R) / LOG_DR);
      const ip = Math.floor(((Math.atan2(loc[k * 6 + 2], loc[k * 6 + 1]) + Math.PI) / (2 * Math.PI)) * nPhi) % nPhi;
      const key = (ir + 100000) * 128 + ip;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { m: 0, vol: 0, sig: 0, R: 0, gas: 0, mvR: 0, mvz: 0, L: 0, Lk: 0, idx: [] }));
      c.m += p.m; c.vol += p.m / p.dens; c.sig += p.m * sigK; c.R += p.m * R;
      c.mvR += p.m * loc[k * 6 + 3]; c.mvz += p.m * loc[k * 6 + 5];
      c.L += p.m * R * loc[k * 6 + 4];
      c.Lk += p.m * R * Math.sqrt(GM / R);
      if (p.cls === 'gasp') c.gas++;
      c.idx.push(k);
    }

    const compact = host.compact;
    const rhoHost = Math.max(0.01, host.density);
    let touched = false;
    for (const c of cells.values()) {
      if (c.m <= 0) continue;
      const R = c.R / c.m;
      const Om = Math.sqrt(GM / (R * R * R));
      let changed = false;
      if (c.idx.length >= 2) {
        const area = R * R * LOG_DR * (2 * Math.PI / nPhi);
        // gas is collisional however thin it is; debris collides in proportion to its optical depth
        const tau = c.gas * 2 > c.idx.length ? 3 : c.sig / area;
        const wc = Math.min(3 * Om * tau, 20 * Om);
        const k = Math.exp(-0.5 * wc * dt);
        if (k < 0.9999) {
          // Random motion relaxes; the shared flow survives. Radial and vertical
          // velocities go toward the patch means, azimuthal toward the Keplerian
          // profile scaled so the patch keeps exactly its angular momentum.
          const uR = c.mvR / c.m, uz = c.mvz / c.m, lam = c.L / c.Lk;
          for (const i of c.idx) {
            const Ri = loc[i * 6];
            loc[i * 6 + 3] = uR + (loc[i * 6 + 3] - uR) * k;
            loc[i * 6 + 5] = uz + (loc[i * 6 + 5] - uz) * k;
            loc[i * 6 + 4] = loc[i * 6 + 4] * k + lam * Math.sqrt(GM / Ri) * (1 - k);
          }
          changed = true;
        }
      }
      // viscous inflow of gas round a compact object: the stress carries off
      // a share of its angular momentum, and the heat that releases makes it shine
      if (compact && c.gas > 0) {
        const kv = Math.exp(-dt * ALPHA * ASPECT * ASPECT * Om);
        for (const i of c.idx) {
          const p = list[i];
          if (p.cls !== 'gasp') continue;
          loc[i * 6 + 4] *= kv;
          p.heat = Math.max(p.heat, Math.min(1, Math.pow(Math.max(host.captureRadius, 2e-5) * 3 / loc[i * 6], 0.75)));
        }
        changed = true;
      }
      if (changed) {
        for (const i of c.idx) {
          const p = list[i];
          const Ri = loc[i * 6], cx = loc[i * 6 + 1] / Ri, cy = loc[i * 6 + 2] / Ri;
          const vR = loc[i * 6 + 3], vp = loc[i * 6 + 4], vz = loc[i * 6 + 5];
          // back to world: eR = cx e1 + cy e2, eφ = −cy e1 + cx e2
          const a1 = vR * cx - vp * cy, a2 = vR * cy + vp * cx;
          p.vx = host.vx + a1 * e1[0] + a2 * e2[0] + vz * ez[0];
          p.vy = host.vy + a1 * e1[1] + a2 * e2[1] + vz * ez[1];
          p.vz = host.vz + a1 * e1[2] + a2 * e2[2] + vz * ez[2];
        }
        touched = true;
      }

      // the fluid Roche limit for this patch's own material
      const aRoche = host.cls === 'bh' || host.cls === 'ns' ? Infinity : 2.44 * host.r * Math.cbrt(rhoHost / (c.m / c.vol));
      let ux = 0, uy = 0, uz = 0;
      for (const i of c.idx) { const p = list[i]; ux += p.m * p.vx; uy += p.m * p.vy; uz += p.m * p.vz; }
      ux /= c.m; uy /= c.m; uz /= c.m;
      const cl = { gas: c.gas, m: c.m, vol: c.vol, list: c.idx.map(i => list[i]) };
      // Gathering into a moonlet, only outside the Roche limit. Pieces that hit
      // each other slower than the escape speed of what they would make stick;
      // once the collisions have damped the patch that far, it accretes.
      // ...and only if the patch's orbit stays outside it: a clump whose periapsis
      // dips inside will be torn apart again on its next pass, so it never forms
      let rpOk = false;
      if (cl.gas === 0 && cl.list.length >= 4 && R > aRoche) {
        const vR = c.mvR / c.m, vP = c.L / c.m / R, vZ = c.mvz / c.m;
        const eps = (vR * vR + vP * vP + vZ * vZ) / 2 - GM / R;
        if (eps < 0) {
          const aM = -GM / (2 * eps), h = R * vP;
          const ecc = Math.sqrt(Math.max(0, 1 - (h * h) / (GM * aM)));
          rpOk = aM * (1 - ecc) > aRoche;
        }
      }
      if (rpOk) {
        // random speeds in the patch, with the Keplerian shear taken out
        let dv2 = 0;
        const uR = c.mvR / c.m, uzc = c.mvz / c.m, lam = c.L / c.Lk;
        for (const i of c.idx) {
          const Ri = loc[i * 6];
          dv2 += list[i].m * ((loc[i * 6 + 3] - uR) ** 2 + (loc[i * 6 + 4] - lam * Math.sqrt(GM / Ri)) ** 2 + (loc[i * 6 + 5] - uzc) ** 2);
        }
        const rClump = radiusFromDensity(c.m, c.m / c.vol);
        if (dv2 / c.m < 2 * G * c.m / rClump) {
          let x = 0, y = 0, z = 0;
          for (const p of cl.list) { x += p.m * p.x; y += p.m * p.y; z += p.m * p.z; w.kill(p); }
          const b = new Body({ name: 'moonlet', kind: 'fragment', cls: 'debris', m: c.m, r: rClump,
            look: { style: 'barren', seed: Math.floor(Math.random() * 1e6), c1: 0x6a625a, c2: 0x9a9088 }, source: c.m > 1e-13, spin: 0 });
          b.setPos(x / c.m, y / c.m, z / c.m);
          b.setVel(ux, uy, uz);
          b.heat = 0.4;
          b.dens = c.m / c.vol;
          w.add(b);
          w.structural();
          touched = true;
        }
      }
    }
    return touched;
  }
}

/**
 * Roche-lobe overflow. A star bigger than its Roche lobe (Eggleton 1983) loses
 * its outer layers through the inner Lagrange point, at a rate that climbs
 * steeply with how far it overflows. The gas leaves L1 moving with the binary
 * and falls toward the companion carrying angular momentum, so it cannot hit
 * it directly: it circles, collides with itself, and becomes a disc.
 */
export function rocheOverflow(w: World, hosts: Map<Body, { host: Body | null; hill: number }>, dt: number, pending: WeakMap<Body, number>) {
  for (const s of w.sources) {
    if (s.cls !== 'star' || !s.alive) continue;
    // its partner: whatever it orbits, or the heaviest thing that orbits it
    let c = hosts.get(s)?.host ?? null;
    if (!c) for (const o of w.sources) if (hosts.get(o)?.host === s && o.m > 0.05 * s.m && (!c || o.m > c.m)) c = o;
    if (!c) continue;
    const a = Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z);
    const q = s.m / c.m, q3 = Math.cbrt(q), q23 = q3 * q3;
    const rL = a * 0.49 * q23 / (0.6 * q23 + Math.log(1 + q3));
    if (s.r <= rL) continue;
    const over = (s.r - rL) / s.r;
    const tDyn = Math.sqrt(s.r ** 3 / (G * s.m));
    let dm = Math.min(0.01 * s.m, 1e-3 * s.m * over ** 3 / tDyn * dt);
    const L1 = s.m < c.m ? lagrangePoints(s, c)[0] : lagrangePoints(c, s)[0];
    const M = s.m + c.m;
    const cx = (s.x * s.m + c.x * c.m) / M, cy = (s.y * s.m + c.y * c.m) / M, cz = (s.z * s.m + c.z * c.m) / M;
    const vx = (s.vx * s.m + c.vx * c.m) / M, vy = (s.vy * s.m + c.vy * c.m) / M, vz = (s.vz * s.m + c.vz * c.m) / M;
    const rx = c.x - s.x, ry = c.y - s.y, rz = c.z - s.z;
    const ux = c.vx - s.vx, uy = c.vy - s.vy, uz = c.vz - s.vz;
    const r2 = rx * rx + ry * ry + rz * rz;
    const wx = (ry * uz - rz * uy) / r2, wy = (rz * ux - rx * uz) / r2, wz = (rx * uy - ry * ux) / r2;
    const ox = L1[0] - cx, oy = L1[1] - cy, oz = L1[2] - cz;
    // co-rotating at L1, nudged toward the companion at about the sound speed
    const push = 10 * KMS / Math.sqrt(r2);
    const pvx = vx + wy * oz - wz * oy + rx * push, pvy = vy + wz * ox - wx * oz + ry * push, pvz = vz + wx * oy - wy * ox + rz * push;
    const acc = (pending.get(s) ?? 0) + dm;
    const parcel = Math.max(1e-12, s.m * 2e-9);
    const n = Math.min(40, Math.floor(acc / parcel));
    pending.set(s, acc - n * parcel);
    dm = n * parcel;
    if (n === 0) continue;
    const made = spawnFragments(w, { mass: dm, n, cls: 'gasp', x: L1[0], y: L1[1], z: L1[2], vx: pvx, vy: pvy, vz: pvz,
      rIn: 0, rOut: s.r * 0.02, vMin: 0, vMax: 2 * KMS, heat: 0.4, color: 0xffb070 });
    const given = made.reduce((t, p) => t + p.m, 0);
    if (given > 0) { s.m -= given; w.massChanged(s); }
  }
}
