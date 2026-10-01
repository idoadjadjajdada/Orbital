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
npm run test:browser   # smoke test in Chromium, desktop and iPad, after a build
python3 tools/fetch-moons.py   # refresh the moon table from JPL
```

Runs in any current browser, iPad Safari included: touch to throw and
select, double-tap to follow, pinch to zoom, drag to slide the view.

The view is a flat, top-down pixel-art map. The physics underneath is fully
3D — tilted orbits, ring planes and moons on their planets' equators are all
there, seen from above. Each body's surface is baked once into a map in its
own turning frame and shaded every frame as a sphere lit from the real
direction of its star, in a few dithered steps; rings are traced against
their measured profiles and shadow the planet and are shadowed by it.

## Playing

| | |
|---|---|
| Pick a body on the shelf, drag from space | throw it — the dotted line is its real future path, integrated with the rest of the system |
| Tap space with a body picked | drop it into a circular orbit (**Auto-orbit**) or at rest |
| Tap a body · double-tap | select · follow it with the camera |
| Drag a body | pick it up; let go and it keeps your hand's speed |
| Drag empty space, two fingers | slide the view |
| Scroll / pinch / `+` `−` | zoom |
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
impact merges; a grazing one near escape speed is a *graze-and-merge* that
leaves a few percent of the mass in an orbiting disc (the regime of the
Moon-forming impact, Canup 2004); a faster graze is a hit-and-run in which
both survive; a violent one leaves a largest remnant given by the universal
law, the rest thrown out above escape speed. Debris worth more than a percent
of the remnant is spawned as self-gravitating fragments. Anything that hits a
star or a compact object is swallowed; inside three Schwarzschild radii of a
black hole there is no stable orbit left and it falls in.

**Small impacts dig craters.** Something under 1/10,000 of the target's mass
does not just add itself: it makes a crater sized by the Schmidt–Housen
π-scaling law and throws out ejecta, of which the part faster than escape
speed leaves. A big planet keeps most of the impactor; a small moon or
asteroid, with an escape speed of metres per second, loses more than it
gains — small bodies are worn down. Fresh craters glow with melt and cool;
a gas giant takes a dark scar in its clouds that fades in weeks, as
Shoemaker–Levy 9's did on Jupiter.

**Tides.** A body inside the Roche limit of something much heavier comes
apart — the fluid limit, 2.44 R (ρ_M/ρ_m)^⅓, for anything held together by its
own gravity, ~1.5 for small rubble piles — and the pieces keep the spin and
orbit it had.

**Rings form; they are not painted on.** Debris going round something
collides with itself. Each simulated particle stands for a great many
metre-sized pieces, and in each patch of the disc their random velocities
relax toward the local orbital flow at the rate kinetic ring theory gives,
about 3Ωτ for optical depth τ, with each patch's angular momentum kept
exactly. That is what turns a cloud into a thin, circular ring. Outside the
Roche limit (for the debris' own density) a patch whose pieces collide slower
than the escape speed of what they would make — and whose orbit stays
outside the limit — gathers into a moonlet; inside it nothing can, so a ring
is what remains. Whether a torn-up moon becomes a ring or new moons depends on
where its orbit's angular momentum settles it: a(1−e²) inside or outside the
limit.

**Accretion discs and jets.** Gas round a white dwarf, neutron star or black
hole is an α-disc (Shakura & Sunyaev, α = 0.1): the same collisions settle it,
viscosity drains its angular momentum so it spirals in, and it glows hotter
inward as r^−3/4. What reaches the inner edge is swallowed; the rate is
measured against the Eddington rate and drives a pair of jets along the spin
axis the swallowed angular momentum defines. A star that outgrows its Roche
lobe (Eggleton 1983) feeds its companion through L1 — the stream cannot fall
straight in, so it circles and becomes the disc.

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
- **Stars live for billions of years.** Nothing skips time. The catalogue's
  dying giant, red supergiant and hypergiant are placed near the end of their
  lives as initial conditions, so the end is something you can watch.
- **Rings and discs take real time to settle**: months to years of simulated
  time for a ring, weeks for an X-ray binary's disc to start feeding its hole.
- **Kirkwood gaps take ~10⁴–10⁵ years to open**, and only in semi-major axis —
  a top-down view of the belt never shows them. The Kirkwood system adds a
  histogram of the belt by semi-major axis with Jupiter's resonances marked.
  At the ~30 yr/s a laptop manages, expect several minutes of running.

## Systems

**Solar System.** Every planet at its J2000 elements (Standish), each tilted to
its IAU pole, and **all 460 moons in JPL's satellite tables** placed in their
own reference frames (ecliptic, Laplace plane or planet equator) at J2000. The
43 with measured masses carry them; the rest are given 1.5 g/cm³ and their
published size (2 km where even that is unknown) and are flagged as estimates.
Moons lighter than 2×10¹⁹ kg are test particles: they feel everything but are
too small to pull on the others. Presets: the whole system with dwarf planets
and the main and Kuiper belts; the inner and outer systems; Earth with the
Moon, the ISS, Tiangong, Hubble, six GPS satellites, three geostationary ones
and JWST at L2; Jupiter, Saturn, Uranus, Neptune and Pluto–Charon with all
their moons and rings (Saturn's, Uranus's, Neptune's and Jupiter's drawn with
their measured radial profiles).

**Exoplanets.** TRAPPIST-1 (Agol 2021), Kepler-16's circumbinary Saturn
(Doyle 2011), HR 8799's four imaged giants (Wang 2018 masses), 55 Cancri
(Bourrier 2018; minimum masses), Kepler-90's eight planets (masses from the
Chen & Kipping relation except g and h, flagged), Proxima Centauri b and d.

**Events.** Theia grazing the proto-Earth; a moon torn into a ring; a black
hole binary in the SS 433 configuration (overflow, stream, disc, jets); two
black holes merging; Sgr A* with the S-stars and a tidal disruption; the
Kirkwood belt with a semi-major-axis histogram.

**Catalogue**, six shelves: comets, asteroids, Psyche-like metal and
Arrokoth-like Kuiper objects, moons, dwarf planets; rocky, desert, icy, ocean,
molten, iron, carbon, eyeball and stripped-core worlds and super-Earths;
gas, ringed and ice giants, mini-Neptunes, super-puffs, hot Jupiters, brown
dwarfs; protostars, red, K, Sun-like, F, A, B and O stars, a blue
supergiant, dying giants, red supergiants and hypergiants, an Eta
Carinae-class star; white dwarfs (one a whisker under Chandrasekhar), neutron
stars, pulsars, magnetars, stellar, intermediate-mass and supermassive black
holes; and a rogue planet, ʻOumuamua, a primordial black hole and TON 618.

## Limits

- Test particles (belt asteroids, light debris, winds, ejecta) feel gravity but
  exert none inside a step; their pull on the bodies they left is applied as a
  split kick each frame, so momentum holds to second order.
- Fragments are the smallest thing resolved: when they meet they stick.
- Ring and disc collisions are a kinetic (mean-field) model over patches of the
  disc, not particle-by-particle contact; viscous spreading of rings and moonlet
  migration by ring torques are not modelled.
- Jets are drawn from the measured accretion rate; their energy does not act
  back on the gas.
- A test particle's pull on a body it orbits many times per step is left out
  of the back-reaction kick rather than aliased; it averages out over each
  orbit.
- The 1PN term is the test-particle form, exact for periapsis advance; it does
  not include frame-dragging or the full Einstein–Infeld–Hoffmann terms.
- Stellar evolution is single-star and parametric, not a stellar-structure code.
- Gravitational lensing is drawn as a point lens on the finished image, as if
  seen from a height equal to the view's width; it bends everything near the
  hole, including what is in front of it.

## Layout

```
src/physics/   integrator, forces, collisions, stars, presets — no DOM, fully tested
src/pixel/     pixel-art renderer: surface maps, sprites, rings, particles, lensing
src/physics/data/moons.ts   generated from JPL by tools/fetch-moons.py
src/ui/        input, HUD, the belt histogram
tests/         physics.test.ts (vitest), browser.mjs (Playwright smoke test)
```
