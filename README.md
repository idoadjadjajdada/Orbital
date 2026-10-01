# Orbital

An n-body gravity sandbox at real scale. The masses, distances, radii and
lifetimes are the real ones, gravity is integrated without fudge factors, and
what happens when things collide, pass too close or run out of fuel follows
published physics rather than tuned effects.

```
npm install
npm run dev        # http://localhost:5173
npm test           # physics tests (vitest)
npm run build      # static site in dist/
npm run test:browser   # smoke test in Chromium, after a build
```

## Playing

| | |
|---|---|
| Pick a body on the shelf, drag from space | throw it — the dotted line is its real future path, integrated with the rest of the system |
| Tap space with a body picked | drop it into a circular orbit (**Auto-orbit**) or at rest |
| Tap a body · double-tap | select · follow it with the camera |
| Drag a body | pick it up; let go and it keeps your hand's speed |
| Drag empty space / right-drag | turn the view |
| Shift-drag, middle-drag, two fingers | pan |
| Scroll / pinch | zoom |
| `Space` `[` `]` | pause · slower · faster |
| `T` `O` `Z` `L` `A` | trails · orbits · zones · labels · auto-orbit |
| `F` `Esc` `Del` `1`–`9` | follow · deselect · delete · pick from the shelf |

The clock says what it is actually doing. If the integrator cannot keep up
with the speed you asked for — a moon on a two-day orbit needs thousands of
steps a year — the readout shows the rate it is really achieving. Accuracy is
never traded for speed.

## The physics

**Units.** AU, Julian years, solar masses; G is the Gaussian constant, so GM☉
is exact. Nothing is rescaled: Jupiter is 1/1047 of the Sun, the Moon is
384,400 km from the Earth, a neutron star is 24 km across.

**Gravity** is integrated with a fourth-order Hermite predictor–corrector on
individual block time steps (Makino & Aarseth 1992), with the corrector iterated
to near time-symmetry (Kokubo, Yoshinaga & Makino 1998). Every body takes its
own power-of-two step from its own acceleration and derivatives, so Io steps
thousands of times a year while Neptune steps a few times, and an asteroid belt
never pays for the moons. There is no softening. Energy is conserved to about
1e-9 per orbit on circular orbits and better than 1e-6 over thirty orbits at
e = 0.95.

**Relativity.** The leading post-Newtonian correction is a 1/r³ potential term
(Nobili & Roxburgh 1986) that reproduces the periapsis advance
6πGM/(c²a(1−e²)) — Mercury's 43″ a century, S2's 12′ an orbit. Compact objects
lose orbital energy to gravitational waves at the Peters (1964) rate, so two
black holes spiral together on the timescale the formula predicts and merge,
radiating ~5% of their mass.

**Collisions** are resolved by regime (Leinhardt & Stewart 2012): a slow
impact merges, a grazing one is a hit-and-run in which both survive, and a
violent one leaves a largest remnant given by the universal law, with the rest
thrown out above escape speed. Debris worth more than a percent of the remnant
is spawned as self-gravitating fragments that pull each other and can re-form
moons; lighter debris is a swarm of test particles. Anything that hits a star
or a compact object is swallowed; anything inside three Schwarzschild radii of
a black hole has no stable orbit left and falls in.

**Tides.** A body inside the Roche limit of something much heavier — 2.44 for
fluid bodies, ~1.5 for rubble — comes apart, and the pieces keep the spin and
orbit it had. The stream that follows is the tidal tail, not a drawing of one;
a star at Sgr A* becomes a tidal disruption event the same way.

**Stars** follow fitted relations for mass, luminosity, radius and lifetime
(L ∝ M⁴ near a solar mass, lifetime ∝ M/L, the Sun calibrated to 0.7 L☉ at
birth and 1 L☉ at 4.6 Gyr), then a giant branch that swells and sheds its
envelope as a dust-driven wind. Below 8 M☉ they leave a white dwarf on the
Kalirai initial–final mass relation and a planetary nebula; up to 25 M☉ a
core-collapse supernova leaves a kicked neutron star; above that a black hole,
directly and quietly above 40 M☉. A white dwarf fed past 1.38 M☉ detonates and
leaves nothing; a neutron star past 2.3 M☉ collapses. Starlight pushes on gas
and dust, which is why a comet's tail points away from its star.

## Real scale, honestly

At true scale the Earth is 1/23,000 of an AU across — less than a pixel from
anywhere you can see its orbit. Bodies are drawn at their **true size** when
you are close enough and never smaller than a few pixels; a moon is hidden
while its dot would sit on top of its planet. Nothing else is scaled.

Real timescales come with real consequences:

- **Collisions are rare.** Planets are tiny targets. The aim line marks an
  impact when the path you are drawing hits something.
- **Stars live for billions of years.** The catalogue's dying giant and red
  supergiant are placed near the end of their lives so the end is something
  you can watch, and **Age to next stage** skips a star's clock forward. That
  is a jump in its age, not a physical process, and it says so.
- **Kirkwood gaps take ~10⁴–10⁵ years to open**, and only in semi-major axis —
  a top-down view of the belt never shows them. The Kirkwood system adds a
  histogram of the belt by semi-major axis with Jupiter's resonances marked.
  At the ~30 yr/s a laptop manages, expect several minutes of running.

## Systems

- **Solar system** — the eight planets and Pluto at their J2000 elements
  (Standish), Ceres, Vesta, 600 belt asteroids, and eleven moons on their real
  orbits, tilted with their planets' equators. Triton goes backwards.
- **TRAPPIST-1** — seven planets with Agol et al. (2021) masses, radii and
  periods round a 0.09 M☉ dwarf. The semi-major axes come from the periods.
- **Galilean moons** — Io, Europa and Ganymede set in the Laplace resonance
  (λ_I − 3λ_E + 2λ_G = 180°), Callisto outside it.
- **Kirkwood gaps** — the Sun, Mars, Jupiter, Saturn and 3,000 asteroids.
- **Sagittarius A\*** — 4.15 million suns, S2 and five neighbours on their
  published orbits, and a Sun-like star on a plunging orbit.
- **Black hole merger** — two 30 M☉ holes about forty minutes from merging.

## Limits

- Test particles (belt asteroids, light debris, winds, ejecta) feel gravity but
  exert none inside a step; their pull on the bodies they left is applied as a
  split kick each frame, so momentum holds to second order.
- Fragments are the smallest thing resolved: when they meet they stick.
- The 1PN term is the test-particle form, exact for periapsis advance; it does
  not include frame-dragging or the full Einstein–Infeld–Hoffmann terms.
- Stellar evolution is single-star and parametric, not a stellar-structure code.
- Gravitational lensing is drawn as a point lens in screen space; it bends the
  whole image, including anything in front of the hole.

## Layout

```
src/physics/   integrator, forces, collisions, stars, presets — no DOM, fully tested
src/render/    three.js scene, shaders, overlays
src/ui/        input, HUD, the belt histogram
tests/         physics.test.ts (vitest), browser.mjs (Playwright smoke test)
```
