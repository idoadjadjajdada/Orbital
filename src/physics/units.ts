// Simulation units: astronomical units, Julian years, solar masses.
// Every number the integrator sees is in these units; conversions live here.

export const AU_M = 1.495978707e11;
export const YEAR_S = 365.25 * 86400;
export const DAY = 1 / 365.25;
export const HOUR = DAY / 24;
export const MSUN_KG = 1.98847e30;

// Gaussian gravitational constant, k^2 in AU^3 / (Msun day^2), converted to years.
// GM_sun is known far better than G or M_sun separately, so it anchors the units.
export const G = (0.01720209895 * 365.25) ** 2;

export const C = 299792458 * YEAR_S / AU_M; // speed of light, AU/yr (~63241)
export const KM = 1000 / AU_M;               // one kilometre in AU
export const KMS = 1000 * YEAR_S / AU_M;     // one km/s in AU/yr (~0.2109)

export const M_EARTH = 1 / 332946.0487;
export const M_JUP = 1 / 1047.348644;
export const M_MOON = M_EARTH / 81.30056;
export const R_SUN = 695700 * KM;
export const R_EARTH = 6371 * KM;
export const R_JUP = 69911 * KM;

// Densities: one g/cm^3 expressed in Msun / AU^3.
export const GCC = 1000 * AU_M ** 3 / MSUN_KG;

export const radiusFromDensity = (m: number, rhoGcc: number) =>
  Math.cbrt((3 * m) / (4 * Math.PI * rhoGcc * GCC));
export const densityOf = (m: number, r: number) => m / ((4 / 3) * Math.PI * r ** 3) / GCC;

export const schwarzschild = (m: number) => (2 * G * m) / (C * C);

// --- readable formatting -------------------------------------------------

export function fmtMass(m: number): string {
  if (m >= 0.08) return `${sig(m)} M☉`;
  if (m >= 0.05 * M_JUP) return `${sig(m / M_JUP)} M♃`;
  if (m >= 1e-3 * M_EARTH) return `${sig(m / M_EARTH)} M⊕`;
  return `${(m * MSUN_KG).toExponential(2)} kg`;
}

/** A distance in AU, km or m; `solar` prefers solar radii for star-sized things. */
export function fmtLength(r: number, solar = false): string {
  if (solar && r >= 0.5 * R_SUN && r < 2) return `${sig(r / R_SUN)} R☉`;
  if (r >= 0.01) return `${sig(r)} AU`;
  if (r * AU_M >= 1e3) return `${sig(r / KM)} km`;
  return `${sig(r * AU_M)} m`;
}

export function fmtDuration(t: number): string {
  const a = Math.abs(t);
  if (a >= 1e9) return `${sig(t / 1e9)} Gyr`;
  if (a >= 1e6) return `${sig(t / 1e6)} Myr`;
  if (a >= 1e4) return `${sig(t / 1e3)} kyr`;
  if (a >= 1) return `${sig(t)} yr`;
  if (a >= 1 / 12) return `${sig(t * 12)} mo`;
  if (a >= DAY) return `${sig(t / DAY)} d`;
  if (a >= HOUR) return `${sig(t / HOUR)} h`;
  return `${sig(t / HOUR * 60)} min`;
}

export function sig(x: number, n = 3): string {
  if (x === 0 || !isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-3) return x.toExponential(n - 1);
  return Number(x.toPrecision(n)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
