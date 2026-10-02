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
| `S` `H` `P` `G` `X` `K` | tools: select · move · push · attract · repel · laser |
| `N` `M` `D` `R` `E` | tools: blast · bombard · clone · ruler · erase (same key again: put it down) |
| `B` · `Ctrl`/`⌘` `Z` | build a body · undo |

**Tools** (left edge). Tap a tool again, or press `Esc`, to put it down.
*Select* (the default): tap to select, double-tap to follow, drag to look
around; it never moves anything. *Move*: drag a body and let go to throw it.
*Push*: drag from a body to change its velocity; a full-length drag is its
whole orbital speed, and the dotted line is the new path. *Attract* and
*Repel*: hold for a gravity well that pulls everything nearby in (with a
little drag, so what it catches gathers and collides) or throws it away; drag
to move it. *Laser*: hold on a body, or press and drag to aim — rock boils off
the lit face as a hot plume that pushes the body like a rocket; a moon goes in
seconds, a world in tens, and what is left flies apart. *Blast*: tap for an
explosion that throws everything nearby outward and shatters worlds near the
middle. *Bombard*: hold on a world to rain small rocks on it and watch it
crater. *Clone*: tap a body, then tap (or drag to throw) to place copies.
*Ruler*: drag between two points or bodies for distance, light-time, gap and
relative speed. *Erase*: rub out bodies and debris. Stars and black holes are
too big for the hand tools. Every change you make can be undone.

**Inspector.** Select a body for its orbit and physical data, a map of its
surface as it is now — craters included, night side dark — flat or as an
equal-area globe, and for a hand-built body its cross-section. *Circularize*,
*Reverse* and *Shatter* act on it directly. **Find** jumps to any body by name.

**Build a body.** Draw a cross-section on a 32×32 grid in ten materials
(iron, rock, basalt, carbon, rubble, ice, water, magma, gas, gold), or start
from a shape — sphere, potato, contact binary, dog bone, cigar, cube, star,
ring, layered planets — and pick its size. The builder works out its mass,
gravity and escape speed, and whether it can hold its shape: the stress its
own weight puts on it, (2π/3)Gρ²R² scaled by how far from round it is,
against the strength of what it is made of. A small body keeps whatever you
drew. One that is too big slumps toward a sphere on its free-fall timescale,
partway if it is only a little overloaded; one heavy enough to melt
separates as it goes — iron to the middle, water and gas on top — and ends
as an ordinary round world with what floated up as its surface. *Test the
slump* plays it first. The Star tab makes a star of any mass and age.

**3D** (the *3D* button or `V`). Step inside the sandbox at true scale, in a
ship you can fly, walk around in, and step out of. You ride with whatever pulls
on you hardest, so worlds do not race away at tens of km/s, and your cruising
speed is half your height above the nearest surface per second, so the same
stick skims a moon or crosses a system. The clock runs at one second a second,
as it would for you; *Settings → Cheats* speeds it up or slows it down. It is
drawn in the same pixel style: half-resolution, nearest filtering, lighting in
a few steps, every world wearing the same surface map (craters and all) it has
on the map. three.js is loaded only when you first open it.

There are four places to be, and the controls follow you. A bar along the
bottom shows the main actions for where you are, in the glyphs of whatever you
last used (keys or a controller); a prompt under the crosshair says what you
can use; `H` shows every control for every place.

| | Keyboard and mouse | Controller (Xbox layout) |
|---|---|---|
| **At the helm** | click to capture the mouse and steer · `W` `A` `S` `D` fly · `Space` `C` up, down · `Q` `E` roll · `Shift` boost · wheel or `+` `−` throttle · click selects · `T` fly to it · `O` overdrive · `J` wormhole · `M` nav map · `Z` chase view or cockpit · `F` leave the helm | left stick flies, right stick steers, `LT` `RT` down, up, `LB` `RB` roll, `L3` boost, `R3` camera · `A` selects (again: fly there) · `X` overdrive · `Y` wormhole · `B` leave the helm · d-pad ◀ ▶ targets, ▲ ▼ throttle · View nav map |
| **On foot** | `W` `A` `S` `D` walk · mouse look · `Shift` run · `Space` jump · `F` or click use · `M` nav map | left stick walks, right stick looks, `L3` run, `X` jump, `A` use, View nav map |
| **Outside** | `W` `A` `S` `D` `Space` `C` thrusters · `Q` `E` roll · `Shift` boost · wheel thrust level · `F` board (at the airlock) · `G` call the ship · `M` nav map | left stick and triggers thrust, bumpers roll, `A` board or select, `X` call the ship |
| **Telescope** | mouse aim · wheel zoom · click select · `T` track the target · `F` or `Esc` step back | right stick aims, triggers zoom, `A` select, `X` track, `B` step back |

`V` (or Menu) goes back to the map from anywhere. Touch has a stick, drag to
look, tap to select (or use, on foot), and buttons for each place.

**The ship** is about 55 m long. Forward is the **bridge**: the helm, a
console with live readouts, and a holographic **nav table** showing what is
round the ship. Aft of it the **commons**, under a skylight: a couch facing the
port window, a **telescope** at the starboard one (it zooms to a few
hundredths of a degree, enough to see the Moon's craters from the Earth), a
shelf of **souvenirs** — a little globe of every world you have flown close to
— a coffee machine, and the **airlock**. At the back, **engineering**: the
reactor, pulsing faster the harder the drives work, inside the ring of the
wormhole drive. Leave the helm and the ship flies on by itself: the autopilot
and wormholes keep going while you walk about. Nobody at the helm and nothing
to do, it holds station.

**Outside** you are in a suit with thrusters: a few metres a second, more
with the throttle. The ship holds station while you are out; `G` calls it to
you, and the airlock's hatch is marked so you can find your way back.

**Drives.** The ordinary drive tops out at 5% of light speed — a minute from a
world to its moons. **Overdrive** (`O`) spools up over three seconds towards
ten thousand times light speed, but is held back near anything massive (never
faster than three times your height above the nearest surface per second), so
it crosses a system in seconds and slows by itself on the way in; the
autopilot switches it on for any trip more than a few seconds long. The
**wormhole drive** (`J`) opens a way to the selected body: three seconds to
open a mouth ahead of the ship, a dive into it, a ride down the throat — from
four seconds for a short hop to a dozen across a system — and out of a second
mouth near the destination, which closes behind you. Then forty seconds to
recharge. Fly into a wormhole in the sandbox and the same throat takes you
out of its other mouth.

**The nav map** (`M`, the scope in the corner, or the nav table) is the system
from above at true scale, from a moon's orbit out to the whole system: every
body with its present orbit, the ship with its heading, a route to the target
with how long it takes, and destinations nearest first to fly to or open a
wormhole to. Wheel or pinch to zoom, drag to pan, tap to select, double-tap to
go; on a controller the left stick pans, the triggers zoom, the d-pad picks,
`A` goes, `Y` opens a wormhole, `X` finds the ship, `B` closes it.

Coming next: landing, with terrain, caves and formations generated from what
each world is made of.

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

**Spin.** Collisions keep angular momentum: what an impact brings that does
not leave as debris or go into orbit becomes spin, up to the rate at which
the merged body would fly apart. The Theia impact leaves the Earth with a day
of a few hours.

**Small impacts dig craters.** Something under 1/10,000 of the target's mass
does not just add itself: it makes a crater sized by the Schmidt–Housen
π-scaling law and throws out ejecta, of which the part faster than escape
speed leaves. A big planet keeps most of the impactor; a small moon or
asteroid, with an escape speed of metres per second, loses more than it
gains — small bodies are worn down. Fresh craters glow with melt and cool;
a gas giant takes a dark scar in its clouds that fades in weeks, as
Shoemaker–Levy 9's did on Jupiter. On a world with an Earth-like atmosphere
anything smaller than about fifty metres bursts in the air instead, as the
Chelyabinsk meteor did (Venus stops much bigger ones).

**Tides.** How much a close pass does depends on how deep it goes: the
penetration factor β = r_t/r_p, with r_t = R (M/m)^⅓ the tidal radius.
Crossing the Roche distance (2.44 r_t for anything held together by its own
gravity, ~1.5 for rubble piles) only works out what this pass will do. A
fluid body loses nothing until β ≈ 0.5; between that and β ≈ 0.9 it is
*stripped* — the layers beyond its two Lagrange points pulled off into a
leading and a trailing tidal tail, the leading one more bound than the body
and the trailing one less — and past it, or on any orbit that stays inside
the limit, it is destroyed (Guillochon & Ramirez-Ruiz 2013). It comes apart
where the tides actually tear it, at the tidal radius or at periapsis, and
the pieces keep the rotation and orbit it had there. That sets the spread of
orbital energy across the debris, ΔE ≈ GMR/r², and so how long the
spaghetti-like stream grows and how fast it falls back: around a black hole
half a star's debris is bound and returns over weeks to months, settles into
a disc through its own collisions, spirals in and feeds the jets; the other
half leaves.

Slower tides act too. A body's spin is braked (or wound up) toward its
orbital period at the rate the tidal torque gives (Gladman et al. 1996), so
moons lock; an eccentric locked moon is flexed every orbit and heats, by
(21/2)(k₂/Q)GM²R⁵ne²/a⁶ — Io's resonances keep that going.

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

**A Moon from a giant impact.** The Theia graze leaves about 2% of the mass
in orbit (Canup 2004), surface density falling as r^−1.5. Inside the Roche
limit it is a ring of 500 small pieces that collide and settle. Outside it,
as the impact simulations find, it is a few intact clumps of Theia's mantle,
the largest holding about half (Canup & Asphaug 2001). A third of the disc
starts as rock vapour turning in the impact's plane; it does not gravitate
here, but it drags on the clumps until it condenses, about a year, damping
their eccentricities on the timescale of Tanaka & Ward (2004). Clumps that
meet slowly inside their mutual Hill sphere merge — the gravitational
aggregation rule of N-body lunar-accretion studies — and the merged Earth
takes the recoil of the uneven disc, keeping momentum exact. The process is
chaotic, as the real one was: in nine test runs at the preset's own clock,
eight left a moon or two moons totalling about a lunar mass (largest single
moons 0.6 to 1.4 lunar masses) within a few weeks, at four to eight Earth
radii; one scattered its clumps and left only fragments. Roughly half the
disc falls back onto the Earth, as Ida et al. (1997) found.

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
and dust, which is why a comet's tail points away from its star, and drags on
it through Poynting–Robertson drag (the light is aberrated by the grain's own
motion), so dust spirals slowly in.

**Hawking radiation.** A black hole radiates as a black body and loses mass
faster the smaller it is: its lifetime is 2.1×10⁶⁷ yr (M/M☉)³. Every real
black hole outlives the universe by far; the catalogue's 200,000-tonne one
is gone in about twenty years and ends in a burst.

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
black holes merging; Sgr A* with the S-stars and a tidal disruption; a
Sun-like star torn apart by a million-sun hole (β = 2); two Earths round a
10-sun hole, one stripped and one spaghettified; a quasar in its ring of gas
with a giant falling in; the Kirkwood belt with a semi-major-axis histogram.

**Catalogue**, seven shelves: comets, asteroids, Psyche-like metal and
Arrokoth-like Kuiper objects, a rubble-pile Itokawa, a metal dog-bone
Kleopatra and a ringed centaur (the small ones keep the shapes they have),
moons, dwarf planets; rocky, desert, icy, ocean, Hycean, molten, iron,
carbon, eyeball and stripped-core worlds and super-Earths; gas, ringed and
ice giants, mini-Neptunes, super-puffs, hot Jupiters, brown dwarfs;
protostars, red, K, Sun-like, F, A, B and O stars, a blue supergiant, dying
giants, red supergiants and hypergiants, an Eta Carinae-class star, a
Thorne–Żytkow object; white, helium-white and black dwarfs, neutron stars,
pulsars, millisecond pulsars, magnetars, quark stars, stellar,
intermediate-mass, merged and supermassive black holes; and spacecraft — the
ISS, Tiangong, Hubble, JWST, Voyager 1, New Horizons, Parker Solar Probe,
Cassini, a GPS satellite, a Starlink, a lander and a solar sail that
sunlight really pushes (β = 0.05).

**Things that arrive already going.** Some objects only do what they are
known for in the right surroundings, so they are placed with them:

- *Quasar, blazar, M87\*, TON 618*: a ring of gas from 40 to 400
  Schwarzschild radii and an inner accretion disc too small to resolve,
  already falling in at a set fraction of the Eddington rate. Its mass is
  already in the hole's; the rate lights the jets from the start. Jets are as
  long as the hole is big — thousands of Schwarzschild radii — and as bright
  as it is fed; a blazar's points almost straight at you.
- *Microquasar (SS 433), X-ray pulsar (Her X-1), cataclysmic variable*: a
  companion star just past filling its Roche lobe, a disc the stream has
  already built, and the inner disc feeding.
- *Merging neutron stars, binary black hole, double pulsar*: both members,
  on the orbit gravitational waves are shrinking.
- *Planetary nebula, supernova remnant (the Crab)*: the shell they threw off,
  still coasting outward.
- *Protoplanetary disc*: a young Sun in a disc of dust and planetesimals that
  settles and gathers by itself.
- *Wormhole*: both mouths. Anything entering one leaves the other, moving the
  same way at the same speed.
- *White hole*: a black hole run backwards. It pulls like one, but whatever
  reaches its horizon is turned back, and it pours out gas at a third of light
  speed. White holes and wormholes are hypothetical; they are here as what
  general relativity allows, not as things known to exist.

Magnetars flare every few decades; pulsars sweep their beams. Supernovae
throw out a filamented blast wave; mergers of black holes and neutron stars
send out gravitational-wave ripples (drawn as a quadrupole pattern — the
real waves are invisible), and neutron-star mergers a kilonova.

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
- Gravitational lensing is drawn as a point lens on the background sky, as if
  seen from a height equal to the view's width. Simulated bodies lie beside a
  hole rather than behind it and are not lensed.
- A hand-built body's shape is drawn and its strength tested against its own
  weight, but gravity treats it as a point mass like everything else.

## Layout

```
src/physics/   integrator, forces, collisions, stars, presets — no DOM, fully tested
src/pixel/     pixel-art renderer: surface maps, sprites, rings, particles, lensing, bursts
src/three/     the 3D view (three.js, loaded on demand), its flying controls, the ship and its scope
src/physics/data/moons.ts   generated from JPL by tools/fetch-moons.py
src/ui/        input and tools, HUD, the body builder, the belt histogram
tests/         physics.test.ts (vitest), browser.mjs (Playwright smoke test)
```
