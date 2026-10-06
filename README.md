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
npm run test:browser   # smoke test in Chromium, desktop and iPad (PARTS=map,ship,land,base,rocket,giant,touch picks parts)
python3 tools/fetch-moons.py   # refresh the moon table from JPL
python3 tools/bake-mars.py     # Mars' heights and colour from the MOLA map and mosaic in tools/data
python3 tools/bake-sun.py      # the Sun's surface from the photograph in tools/data
python3 tools/pack-models.py   # the bases, trees, ruins and rockets (GLB) in tools/data, textures cut down
```

## Working on this: start with the notes

**Agents, and anyone else: read [`AGENTS.md`](AGENTS.md) first, then the notebook in [`notes/`](notes/README.md).**

The owner works from a phone, and `notes/` is how they follow the project and
tell it what they want: the roadmap, open bugs, ideas, reference pictures, the
model packs, and every message they have sent, word for word. They read and
write it in the notes app at
**https://idoadjadjajdada.github.io/Orbital/notes/** (an Obsidian vault too).

Keeping it up is part of every task:
- **Their messages** go in `notes/Feedback/` word for word, with any pictures they sent.
- **Bugs** go in `notes/Bugs.md`, both the ones they report and the ones you find.
- **Features** go in `notes/Roadmap.md`, ideas in `notes/Ideas.md`.
- **Reference pictures** you used go in `notes/References.md`.
- **What you built** goes in `notes/Built.md`, ticked off where it was asked for, with the commit.

Everything is committed to `main`. `AGENTS.md` has the details: the format, the
checks to run before pushing, and how CI is watched.

Runs in any current browser, iPad and iPhone Safari included: touch to throw
and select, double-tap to follow, pinch to zoom, drag to slide the view. On a
small screen what is not needed folds away: the less-used buttons sit behind
⋯, the bodies to throw in are in a drawer behind ＋ at the start of the tools
(it closes once you pick one, so you can see where to throw it), the inspector
shows just a body's name until you open it, and 👁 hides everything to leave
just the sky.

The view is a flat, top-down map. The physics underneath is fully 3D —
tilted orbits, ring planes and moons on their planets' equators are all
there, seen from above. Each body's surface is painted into a map in its own
turning frame and shaded every frame as a sphere lit from the real direction
of its star, with relief from its height map; rings are traced against their
measured profiles and shadow the planet and are shadowed by it.

**Surfaces are real where they can be.** The Earth's continents, ice caps,
deserts, lakes and mountain ranges come from Natural Earth (public domain),
baked by `tools/fetch-earth.py`. **Mars is measured**: its ground is MOLA's
laser altimetry (Olympus Mons at 21.9 km, Hellas' floor near −7, the north
lower than the south) and its colour a true-colour mosaic, both read back by
`tools/bake-mars.py` from the maps in `tools/data` — the elevation from the
MOLA map's colour scale, the summits above the scale's top rebuilt to their
measured heights, the poles from its polar insets, the mosaic fitted to the
relief so the two line up — and written as two small pictures, 180° W at the
left like the Earth's, that each painting thread fetches once. Landing on Mars
puts you on that ground. The Moon has its maria and rayed craters in
the right places, and Mercury, Venus, Jupiter (bands and the Great Red Spot),
Saturn, Uranus, Neptune, Io, Europa, Ganymede, Callisto, Titan, Triton,
Pluto (Sputnik Planitia and Cthulhu), Charon and the other major moons and
dwarf planets their own painters. Anything else is generated from its style.
Maps are painted in two background workers and sharpen as a body grows on
screen, up to 2048 texels round, with the relief kept to 16 bits so it shades
smoothly close up.

**The Sun is a photograph, alive.** Its surface is an extreme-ultraviolet
picture of the Sun (coronal loops over the active regions, the dark coronal
holes), wrapped round the sphere by `tools/bake-sun.py` with no seam, and set
moving by a shader: the equator turning faster than the poles, the plasma
drawn along a slowly changing flow, granules boiling under it and the bright
knots flaring. Every other star wears the same weather in its own colour —
deep orange on a red dwarf, blue-white on an A star — turned to a face of its
own.

**Weather on the giants.** Their belts and zones slide past each other on
alternating jets, eddies wander along them, and lightning flickers in the
belts on the night side. Jupiter's Great Red Spot, painted with its brick-red
spiral core, pale collar and turbulent wake, turns on itself (anticlockwise,
fastest near its rim), as does Neptune's Great Dark Spot. In the rings, clumps
and wakes go round at the orbital speed of their radius, the inner edge
lapping the outer, and Saturn's spokes come and go across the B ring. The
rings cast their shadow across the planet, and the planet its shadow across
the rings behind it.

**A disc has to be built.** A bare black hole is just its shadow, the
starlight behind it (and the Milky Way) bent into a ring round it. Its disc
comes only from what it actually eats: matter that reaches it first settles
into a ring round it over a few seconds, then drains through the disc into the
hole over tens of seconds, and the disc's brightness follows what is in it —
a stray asteroid barely shows, a planet round a stellar hole glows, a star
torn apart by a million-sun hole (try *Star torn apart* and wait for the
debris to fall back, a month and a half in) blazes. The disc lies across the
spin of what fell in. Jets come up only after the disc has been bright for a
while, and die away after it fades. A hole that comes with its gas already in
place — a quasar, TON 618, M87*, a microquasar's companion overflowing onto
it — starts with its disc and jets established.

**Black holes, traced.** Up close in 3D every pixel round a hole follows its
ray of light back through the hole's gravity (the photon orbit equation in
Schwarzschild space). Rays that fall in make the shadow, 2.6 horizons across;
rays that skim the photon sphere make the thin ring round it; rays that cross
the accretion disc pick up its light, so seen edge-on the far side of the
disc arches up over the top of the hole and its underside shows as a ring
beneath it, as in NASA's visualisations and *Interstellar*. The disc burns
deep red through orange to gold and near white where it is brightest, bright
from the innermost stable orbit out to a few tens of horizons (the thin-disc
temperature law) and drawn out by the shear into fine streaks; the dim gas
further out (round TON 618, a torus hundreds of horizons across) glows deep
orange. Its gas goes round at the orbital speed of each radius, and the side
coming toward you is brighter (Doppler beaming at up to half the speed of
light). From far off a fed hole
is a brilliant point, as quasars are. Its jets are dense beams of plasma
along the spin axis: they light up a few horizons out, pouring off the top of
the shadow in a wide white funnel that narrows within a few tens of horizons
into a tight, solid, white-hot beam, bright a long way out, with knots
streaming along it; never thinner than a line on screen, so they read from
any distance. The shadow and the bright disc hide whatever part of a jet is
behind them. The stars
behind a hole are lensed into arcs. On the map the same disc is drawn tilted
as it lies, flowing, beamed and ringed round its shadow, with smooth, tapering
jets.

**The other strange things.** A pulsar is drawn as Chandra sees the Crab's:
a bright inner ring and a wider torus of plasma round its equator going round
it, matter lifted out of it along the magnetic field's loops to the poles,
and jets straight out of the poles, carrying it away in knots that stream
outward; its two lighthouse beams sweep round from the magnetic poles, 35° off
its spin. A magnetar is the same in violet, its field loops brighter and
twisted, flaring every so often when its crust gives way.
A planetary nebula is a traced shell of glowing gas, blue-green oxygen inside
a red rim, brightest at its edge as the Ring Nebula is. A supernova remnant
has blue-white filaments shot with red. A protoplanetary disc is dust lit by
its young star, with bright rings and dark gaps where planets are clearing
their paths, as ALMA saw round HL Tauri. White dwarfs and neutron stars are
white-hot. A white hole is a blinding blue-white glare. Every bright thing's
glow is worked out per pixel from how near your line of sight passes it, so
it stays right from any distance, inside the glow or out.

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
as it would for you; *Settings → Cheats* speeds it up or slows it down. Every
world wears the same surface map (craters and all) it has on the map, with
bump-mapped relief, a soft terminator, glinting seas, drifting clouds and an
atmosphere at the limb. three.js is loaded only when you first open it.

There are six places to be, and the controls follow you. A bar along the
bottom shows the main actions for where you are, in the glyphs of whatever you
last used (keys or a controller); a prompt under the crosshair says what you
can use; `H` shows every control for every place.

| | Keyboard and mouse | Controller (Xbox layout) |
|---|---|---|
| **At the helm** | click to capture the mouse and steer · `W` `A` `S` `D` fly · `Space` `C` up, down · `Q` `E` roll · `Shift` boost · wheel or `+` `−` throttle · click selects · `T` fly to it · `O` overdrive · `J` wormhole · `N` floodlight · `M` nav map · `Z` chase view or cockpit · `F` leave the helm | left stick flies, right stick steers, `LT` `RT` down, up, `LB` `RB` roll, `L3` boost, `R3` camera · `A` selects (again: fly there) · `X` overdrive · `Y` wormhole · `B` leave the helm · d-pad ◀ ▶ targets, ▲ ▼ throttle · View nav map |
| **On foot** | `W` `A` `S` `D` walk · mouse look · `Shift` run · `Space` jump · `F` or click use · `M` nav map | left stick walks, right stick looks, `L3` run, `X` jump, `A` use, View nav map |
| **Outside** | `W` `A` `S` `D` `Space` `C` thrusters · `Q` `E` roll · `Shift` boost · wheel thrust level · `F` board (at the airlock) · `G` call the ship · `M` nav map | left stick and triggers thrust, bumpers roll, `A` board or select, `X` call the ship |
| **Telescope** | mouse aim · wheel zoom · click select · `T` track the target · `F` or `Esc` step back | right stick aims, triggers zoom, `A` select, `X` track, `B` step back |
| **On the ground** | `W` `A` `S` `D` walk · mouse look · `Shift` run · `Space` jump · `F` board (at the ladder) · `R` scan · `G` call the ship down · `N` helmet lamp · `K` mission control | left stick walks, right stick looks, `X` jump, `A` board, `Y` scan, `B` call the ship |
| **Flying Lander 1** | mouse steers · `W` `A` `S` `D` thrust · `Space` `C` up, down · `Shift` boost · `L` come down or lift off · `F` step out, board, dock · `M` nav map | left stick thrusts, right stick steers, `LT` `RT` down, up, `X` land or lift off, `A` step out or dock |
| **Watching a craft** | mouse round it · wheel closer, further · `W` `A` `S` `D` drive (a rover) · `[` `]` other craft · `F` or `Esc` back | left stick drives, right stick looks, d-pad ◀ ▶ other craft, ▲ ▼ closer, `B` back |

At the helm, `L` (or `X` near the ground) lands and lifts off, and `K` anywhere
aboard opens **Mission control**.

`V` (or Menu) goes back to 2D from anywhere; the button at the top says **2D** or **3D**, whichever it takes you to.

**Touch.** Put your left thumb down anywhere on the left of the screen and a
stick appears under it, to fly or walk; drag anywhere else to look (the view
follows your finger; *Settings* can turn that round, and set how fast it
turns); tap something to select it, or on foot to use what is in front of you.
The round buttons under your right thumb are held (up, down, boost; jump on
foot), the rail beside them is tapped (go to, overdrive, wormhole, map, camera,
leave the helm), − and + above the stick set the throttle, and what you can
use shows as a big button. Controls you leave alone fade back after a few
seconds.

**The ship** is about 55 m long, on two decks, and its consoles work.

- The **bridge**: the helm, a console with live readouts, a holographic
  **nav table** showing what is round the ship, the **comms log** (collisions,
  supernovae, captures — with Select and Go for whatever they happened to) and
  a **sensor sweep** of the nearest objects, how far and how fast they close.
- Off the forward passage, the **quarters**: bunks — sleep and eight hours pass
  in a few seconds while the ship holds station — and a desk with the
  **captain's log**: distance flown, top speed, transits, worlds visited.
- Opposite, the **lab**: a **survey** of the target (gravity, escape velocity,
  temperature, air, ground, and whether a lander could set down there, from
  measured values for real bodies), a globe wearing its surface, and a sample
  locker that fills a vial for every world you visit.
- The **commons**, under a skylight: the galley and coffee machine, a dining
  table, a couch facing the port window, a **telescope** at the starboard one
  (it zooms to a few hundredths of a degree, enough to see the Moon's craters
  from the Earth), a shelf of **souvenirs** — a little globe of every world you
  have flown close to — a screen saying where the ship is, and the **airlock**.
- **Engineering**: the reactor, pulsing faster the harder the drives work,
  inside the ring of the wormhole drive, and the **power routing** console —
  balanced, engines (overdrive spools faster and runs closer to worlds; the
  wormhole drive recharges slowly) or wormhole (a 15-second recharge, a slower,
  lower overdrive). A hatch leads down to…
- The **hangar**, the belly pod on the lower deck: **Lander 1** parked over the
  bay doors (fly it out yourself), the **landing survey** of nearby worlds,
  fuel, suits, and **Mission control**, where the probes, orbiters, landers,
  rovers, stations and bases go out from (the bay doors open as each one
  leaves).

Signs over the doors say where they go, and labels for worlds show through the
windows, not the walls. Leave the helm and the ship flies on by itself: the
autopilot and wormholes keep going while you walk about. Nobody at the helm and
nothing to do, it holds station.

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

### Landing

Fly down within 8 km of any solid world's ground and **land** (`L`). The ship
levels itself on the slope and comes down, slowing to a walking pace; each of
its six legs telescopes to the ground under it, and a ladder drops from the
airlock. Step outside from the commons and you are **on the ground**, in that
world's gravity — a long, slow jump on the Moon, a short one on the Earth —
under its sky. `L` again lifts off. Out in a suit, fly down to the ground and
you land on your feet; `G` brings the ship down beside you. Mission control
lists the real landing sites and flies you to any of them.

**The ground** comes from the same painter as the world's map, so Olympus
Mons, Hellas, the maria and the continents are where the map has them, scaled
to each world's measured relief (the spread of its elevations from LOLA, MOLA
and Magellan: the Moon's maria sit 2 km below its highlands, Olympus 25 km
over Hellas). The Earth's land stands on NASA's SRTM topography, so the
Himalaya, the Andes, the Alps, Tibet and the Altiplano are where they are, as
high as they are, and how rugged the ground is follows the measured relief
round it: sharp ridges and glacier-cut valleys in the high ranges, gentle
swells on the plains. Below what the map can hold, fractal hills, crater
fields at every scale on airless worlds (fresh and worn), boulders, and dunes
where there is sand and wind carry the detail down to the metre. Above the
tree line the ground is bare rock, above the snow line snow (both lower
toward the poles), and steep slopes shed their snow and soil to show crags.

**From orbit and from the air**, a world keeps its detail as you come down.
The Earth's coasts come from Natural Earth's coastlines at about 10 km, and
close up the globe draws the shore sharper than its map. Close to any world,
hills and hollows show finer than the map holds, and craters too where a world
keeps them: the Moon and other airless worlds are cratered at every size,
Mars somewhat, the Earth, Venus, Titan and Io not at all. From a couple of
kilometres up, the ground shows relief from kilometres down to tens of
metres, in a shader for the air that drops the close-up detail it could not
show from there.

It is one continuous world, the same wherever you stand: a fixed lattice of
tiles on a cube round it, each split into four finer ones near you, coarse at
the horizon and down to half a metre underfoot, built in two workers and kept
for when you come back. A tile is always the same tile, and the boulders on it
come from a lattice fixed to the world, so walking never changes the ground in
front of you. Venus's and
Titan's maps are their cloud tops, so their ground has its own painters, from
the radar: Ishtar, Maxwell Montes, Aphrodite; Titan's dune seas, Xanadu and
its northern methane seas. Seas are flat and shine.

**Mountains you can find.** The great summits are raised to their measured
heights in their own shapes, sites Mission control flies you to: Everest, K2,
Kangchenjunga and Makalu as horns with arêtes, Mont Blanc and Denali as
massifs, Kilimanjaro, Fuji, Elbrus, Rainier and Etna as volcanoes with summit
craters, Mauna Kea and Mauna Loa as shields, the Matterhorn, Uluru's sheer
monolith; on Mars, **Olympus Mons** whole — its nested caldera, the long
shield and the cliffs up to 8 km high round its foot — and Mount Sharp; on the
Moon, Mons Hadley and Huygens. A made-up rocky world gets folded mountain belts
where its crust is pushed together.

**Arches, overhangs and caves.** A heightfield cannot hold an arch or a cave.
Arches, hoodoos, overhangs and spires are rock of their own standing on the
ground, on a fixed lattice about a kilometre a cell, each cell's setting
deciding what it holds: natural arches and stands of hoodoos in sandstone
deserts (Mars is full of them), rock shelters under overhangs, frost-split
spires on rugged ground. Caves are under the ground (caves.ts): limestone
caves with stalactites in wet country, ice caves on frozen worlds, lava tubes
in the Moon's maria. A ramp cut down into the land (its land cut away in the
ground's shader) leads into the hill to a network of passages and chambers
with side passages and a lower level, kept under several metres of rock, its
floors never steeper than a walk; a lava tube is a great tube 15 m across,
reached down the rubble where its roof fell in. The rock is one surface (a
surface net over the passages' air), so the branches open into each other.
Its walls stop you; its floor carries you, its roof stops your jumps, the
daylight dies away behind you and your helmet lamp shows the way (shaded rock
outside gets light bounced off the sunlit ground).

**The sky** is the colour the air makes it: blue on the Earth, butterscotch
with blue sunsets on Mars (its dust lights a sky the thin gas alone could not),
orange on Titan, black on the Moon, fading to stars at night. Sunlight reddens
through a long path of air at sunset; distance hazes toward the sky's colour as
thickly as the air and its dust make it — on the Earth a mountain 60 km off is
a pale shape and one past 100 km is gone, and the buildings and craft on the
ground fade with it, as do their labels, which also stop at the horizon;
under Venus's clouds the light comes from the whole sky.

**What the day hides.** Under a daylit sky only what is bright enough shows:
the Sun, the Moon's disc; faint moons and planets, the belts' rubble and their
labels fade out until dusk.

**Light you bring.** `N` switches on the ship's floodlight: a beam from its
nose that reaches the ground from orbit, so the night side can be seen (on foot
or outside it is your helmet lamp too). Settings has a **night-side light**
that lifts the dark on every world. And Mission control hangs **lamps in the
sky**: up to three, each over one place on a world and keeping to it as the
world turns, lighting the ground round it — send one north, south, east or
west, call it over where you are, make it brighter or wider, at any time.

**What is there.** The hardware real missions left where they left it: every
Apollo descent stage with its flag (and the rovers of 15, 16 and 17), Luna 9,
Lunokhod 1, the Chang'e landers and Yutus, Chandrayaan-3, SLIM, the Vikings,
Pathfinder, Spirit, Opportunity, Curiosity, Perseverance, Zhurong, InSight, the
Veneras, Huygens; on the Earth its 42 largest cities, lit at night. The Earth's
plants and animals are those of the biome you stand in — spruce and moose in
the taiga, kapok trees and jaguars in the rainforest, saguaro and dromedaries
in the desert, 50 species in all, with their Latin names.

**Trees** stand where they grew: each sits in a fixed lattice cell on the
ground, so walking away and back finds the same forest. Near you they are
modelled — oak, birch, maple, palm and pine, each species drawn by the nearest
model — and every tree is its own: its height from what its species grows to
(a sequoia is tall, a birch slight), then its own build, stretched taller or
squatter, broader or more slender, leaning a little, turned its own way, its
leaves a shade lighter or darker. Further off they become simple trunks and
crowns, and past a few hundred metres they are not drawn at all; each kind of
tree is one instanced draw, so a forest costs a handful of draws.

**Ruins** stand here and there on the worlds with ground: an arch, a
colonnade, an obelisk, a shrine, a fallen tower, a length of wall. They are
rare: a site every fifty kilometres or so on a world without a people, rarer
still on the Earth, more often where a civilisation lives. Like the trees they
are fixed to the world, so a site you found is there when you come back. Each
is cut from the stone of the ground under it, tinted to its colour (grey on
the Moon, rust on Mars, pale on ice), and set down at the lowest ground under
its footprint so it never floats. You walk round them, under their arches and
up their steps: where you can stand comes from the models, as in the bases.
They are drawn within three kilometres and labelled within six. Coming within
eighty metres of one logs it.

**Grass** grows where the ground is grassy. On the Earth that is ground with
more green in it than red or blue; on a made-up world, ground the colour of its
plants; never on a cliff or bare rock. From afar it is a texture in the
ground's own shader: drier and lusher patches a few metres across, soil showing
through here and there, a fine speckle of lit blade tips and dark gaps close
by, and the sheen grass has when you see it at a glance. Round you on foot it
is tufts of blades out to 20 m, swaying in the wind and fading out at the
edge. Like the trees they sit on a lattice fixed to the world, so the same
tufts are there when you come back. Their heights come from the corners of
two-metre cells, each worked out once and kept, so walking on costs only the
new cells at the edge, and all of them are one instanced draw.

**Worlds with life of their own.** A made-up world's life is rolled from its
seed and weighted by how habitable it is: in its star's habitable zone
(Kopparapu et al. 2013), at a temperature where water is liquid, with water to
hand, and of a mass that holds an atmosphere. It may have microbes; plants
coloured for its star (green under a G star, yellow-orange under a K, near
black under an M dwarf, as Kiang et al. 2007 worked out); animals that wander
about; or — rarely — a civilisation, whose towns of domes, towers and spires
stand on its continents. There is free oxygen in its air only if something
makes it. **Discoveries** — each site, species, life form and town you come
across — go in the captain's log.

### Inside a giant

There is no landing on a gas giant, but you can go in. Below the cloud tops
the air thickens and heats on its adiabat (Jupiter's 425 K and 22 bar at
150 km down, as the Galileo probe measured), and the ship goes down through
the decks real descents found — on Jupiter ammonia ice at 0.7 bar, ammonium
hydrosulphide at 2, water at 5, where the lightning is — until the hull can
take no more, at 1,000 bar. The decks wear the planet's own map, so the belts
and zones are where they are seen from outside; they drift on the zonal winds
and wind round the Great Red Spot (Neptune's dark spot, Saturn's polar
vortex). Between them is fog that darkens as the sunlight fails, lit from
inside by lightning, and the winds carry the ship along and shake it.

### Mission control and the fleet

From the hangar (or `K`), send craft to the target — the selected world, or
the nearest:

- a **probe** falls through the air on its parachute, reading pressure,
  temperature and make-up all the way down, to the ground or until it is
  crushed (past 120 bar in a giant); with no air it is an impactor;
- an **orbiter** circles on a polar orbit and maps the world: the atmosphere
  first, then the layers inside from its gravity field, then the ground;
- a **lander** sets down below the ship or at a real site, reads the air and
  the soil and runs the life experiments (on Mars, Viking's ambiguous result);
- a **rover** drives off a lander, or is dropped on its own, and stops every
  60 m to sample the rock (a lake-bed mudstone, haematite blueberries,
  anorthosite, a nickel-iron meteorite…);
- a **station**, ISS-sized, goes into orbit;
- a **base** or a **launch pad** is built where you choose: a see-through model
  stands where you look, red where it cannot go (water, too steep, too close
  to something), and `F` builds it there;
- an **orbital lamp** is hung over where you are.

From the ground, anything going up into space leaves from a **launch pad** on
its rocket: build one first. The Earth starts with the **ISS** in its real
orbit (420 km, 51.6°) and bases with launch pads beside Cape Canaveral and
Baikonur. Bases stand level on a terrace and pads on their aprons, ground you
walk and land on.

Each reports as it goes. **View** any of them and the camera goes to it; a
rover you can drive. Their labels show in the view.

**Rockets** carry people and cargo from pad to pad. There are three:
- the **C-01 Courier**: a pilot and one cargo bay;
- the **P-06 Wayfarer**: two pilots, four passengers and a service bay;
- the **H-12 Mammoth**: two cargo decks, two boosters, and room for a rover.

Mission Control stacks one on a free launch pad's landing circle or a base's
pad, which takes about fifteen seconds; Canaveral and Baikonur start with a
Wayfarer and a Mammoth on their pads. Its panel, from Mission Control or `F`
beside it on foot, loads it:
- **crew** for the base or station it flies to;
- **supplies**, thirty days a hold;
- for the Mammoth, a **rover**, which drives off where it lands.

Then it sends the rocket to any pad, base or station, on the same world or
another. Standing beside it, you can **ride along**: the camera stays on it,
and when it is down you climb out onto the pad, or into the station. A flight
is a vertical climb off the pad, then the cruise, then a burn down onto the
destination pad, slowing to nothing at the legs, its plume burning on the way
up and down. On one world the cruise is a ballistic arc; between worlds it is
a straight run between two moving worlds. Each is shown faster than real: a
hop across a continent takes about a minute. What a rocket brings changes
where it lands: the base's console shows its crew and stores.

**Lander 1** is the ship's own crewed lander, and you fly it. Walk down to the
hangar and use it: it drops out of the bay doors with you at the controls —
`W` `A` `S` `D` and `Space` `C` thrust against the gravity of whatever is
nearest, the mouse steers, and when you let go it holds a hover. Low down it
levels itself; `L` brings it straight down onto its legs (gently, slowing as
the ground comes up). `F` steps out onto the ground; walk back to it and `F`
boards again; `L` (or a push on the stick) lifts off. Fly back within a
hundred metres of the ship and `F` docks it in the hangar. With a launch pad it
shuttles by itself: from a pad, `F` flies it up to the ship and into the
hangar; out of the hangar near a world with a pad, `F` flies it there and sets
it down on the pad's circle. Touch the controls to take it back.

### Inside the station and the bases

**The station** is laid out as the ISS is, inside and out from one list of
modules, and you float through it (`W` `A` `S` `D` the way you look, `Space`
`C` up and down): the docking adapter, Zvezda's galley and sleep stations, the
Unity node with the Columbus lab (experiments, a glovebox, lettuce growing
under pink light) on one side and Kibo's robotics post and airlock on the
other, Tranquility's life support and treadmill with the **Cupola** under it
— seven windows looking down at the world turning below — Destiny's command
post and comms, and stowage with the suits. Racks, cables, handrails and light
strips line every module; the screens show live readings (the orbit, the
ground track, the air and water, the arm). From the helm, **dock** with a
station (the ship flies to it if it is far) and the ship's airlock opens into
it; leave by Kibo's airlock on a spacewalk and come back in the same way.

**A base** is three buildings on a level terrace, with paths between them
and its pad. The **outpost** stands on legs in the middle: climb its stairs and
through its airlock to the hub, where the **command table opens Mission
Control**. East of the hub is the control room, with three consoles (the base,
the ship, a camera). West are the quarters, with bunks to sleep in and the
suit lockers that top up your suit. South is the hydroponics. The **dome** is
the common room, where the galley serves something hot, with a greenhouse and
the growth lab in front of it, a medical bay, and the lab, where the sample
analyser reads the case you collected. The **hangar** holds a rover that drives out of its open end with
you at the wheel; behind it is a crew room with a briefing table (the map),
three consoles and lockers. The flight desk (or `G` on the ground near the
base) **calls the ship to its pad**, and the ship flies over and lands there.

Where you can walk comes from the buildings themselves. A quarter-metre grid
is made once from each model, giving its floors, stairs and decks, and its
walls and furniture cut through at knee to head height. So you climb the
stairs step by step, go in and out through real doorways, and stop at a desk
or a bunk. Inside, the ceiling lights nearest you come on.

**The ground close up** is lit pixel by pixel. Within a couple of hundred
metres the shader tilts the light over a relief of grit, stones and hummocks,
so they catch the sun, and shows what the ground is made of:
- steep or rough ground is bare rock in strata, cracked;
- loose ground has stones and pebbles standing out of it;
- the sand of Mars and Titan lies in wind ripples;
- ice is smooth and cracked in long lines, glinting where a facet turns the
  sun to you;
- Io's and Venus's lava rock is dark and pitted with gas bubbles.

It fades out with distance, so it costs nothing further off.

**The growth lab** is a bench of six glass chambers in front of the dome's
greenhouse racks. Each chamber runs one experiment: a soil, a plant, and
whatever you did to the soil first, grown under lights at a day a minute, its
plant growing in the chamber and its label showing the day.
- **Soils:** potting soil and a nutrient solution to compare against,
  simulants of the Moon's highlands and of washed Mars ground, and every
  sample you have analysed. A sample's chemistry comes from where it came
  from: Mars ground has Phoenix's pH 7.7, plenty of phosphorus and 0.6%
  perchlorate; Moon regolith has no nitrogen and sharp, unweathered glass;
  Titan's ice has cyanides and no phosphorus; Enceladus's has the
  phosphates Cassini found.
- **Analysis:** the lab reads each soil as what a root can take up (nitrogen,
  phosphorus, potassium), its pH, what poisons it, how well it holds water,
  its organic matter and how sharp its grains are.
- **Plants:** thale cress, lettuce, radish, dwarf wheat, pea, dwarf tomato
  and potato.
- **Amendments:** compost, a rinse (which washes out what dissolves, such as
  perchlorate and salts, and some nutrients too), a pH buffer, fertiliser,
  and rhizobia, which let a legume make its own nitrogen.

A plant grows as fast as the scarcest thing it needs allows (Liebig's law of
the minimum), slowed further by the wrong pH, by poisons, by a soil that dries
out and by grains that cut its roots. Starved of nitrogen it yellows; poisoned
or cut, it purples. Raw Mars ground kills a radish until it is rinsed. Fed
Apollo-like regolith grows cress slowly and purple, as the real Apollo soil
did (Paul et al. 2022). A pea with rhizobia thrives in washed Mars simulant.
When a plant is grown, its yield against potting soil and what held it back
go into the log.

**Monitors.** Every console in a base (and the big screen in the station's
Destiny) is a monitor. Use one and Mission Control opens; each craft there has
a 📺 button that **puts its camera on that monitor**. It stays there while
you walk away: a rover crawling across a crater, the ISS over the Earth, a
probe falling toward its world. Each camera is drawn into a small picture
(256 × 160) from a tiny scene of its own: the craft, its world beneath as a
lit globe, and the sunlight. To keep the frame rate up, a monitor is drawn
only when you are within 15 m and facing it, at most 3 times a second (once a
second while frames run slow), and only one in any frame. Otherwise it keeps its last picture, so a base full of
monitors costs nothing while you are elsewhere. With no camera on it, a
console shows its readings, refreshed twice a second.

**Keeping it light.** Interiors are attached only within 900 m of their base
or station. The building models load once, on demand, and are shared. The
modelled trees are drawn only within 110 m and are rebuilt only when you have
walked 25 m. Shadows are not drawn, and the view lowers its resolution when
frames run slow.

### The suit and what you ride

**The suit** reads what is outside and does what it takes to keep you alive:
sealed and pressurised in a vacuum, a hard shell against Venus's 92 bar,
cooling at full in its 460 °C, heaters on Titan, filters against sulphur
dioxide, ammonia or hydrogen cyanide, shielding against radiation (Jupiter's
belts at Io and Europa would kill you in hours without it), the visor open only
where the air is fit to breathe. Doing it costs oxygen and power, faster the
harsher it is outside; the visor shows them, it warns when they run low and
carries a reserve, and the ship's airlock, a base's suit room and the station
top it up. Its kit: the scanner (`R`), the lamp (`N`), a **jetpack** (`J`, then
`Space` to fire) and a **sampler** (`T`) that fills a case of ten samples for a
lab to analyse into the log.

On the ground `B` brings out a **buggy** like the Apollo rovers, and `B` again a
**hover bike**, fast, riding a metre over rock, sand and water alike.

### The ship and the animals

The ship has a long prow under the bridge glass, a dorsal spine with a glass
bubble over the commons' skylight, swept wings with engine nacelles at their
tips, a shroud round the main engines, canted tail fins, RCS blocks, sensor
domes, running lights and its name on its flanks — none of it over a window.
Its plates are painted and bare metal that catch the light and reflect a dark
sky with a few lights in it, with their seams and rivets in relief and a darker
belly; white strobes flash on the fin, the belly and the chin, and the roofs
carry vents, boxes and conduits. Inside, every wall has a kick plate with a
line of guide light along the floor, a rail at waist height, ribs at its ends
and a cove of light under the ceiling.

Over that, the ship wears a model reworked outside the game
(`tools/data/models/orbital-ship.glb`, packed by `tools/pack-models.py`): a
new swept hull, white with orange stripes, a longer nose, three nozzles at the
back and slimmer pods at the wingtips; furniture in every room (chairs on the
bridge, armchairs, shelves and a kitchen island in the commons, new suits),
solid to walk round; and new textures on the plating. The old hull is cut away
where the new one covers it. The rooms, stations, screens and moving parts are
still the game's own.

The ship's 3D model, outside and in, is on the site at
[/ship/](https://idoadjadjajdada.github.io/Orbital/ship/) to download: GLB for
Blender and most 3D apps, and USDZ, which an iPhone or iPad opens in Quick
Look and AR. `node tools/export-ship.mjs` makes both from the game's own ship.

Near a world, the ship (and Lander 1, and you on a spacewalk) turns with it, so
the ground holds still under you while you come down; low over the ground a
spacewalker sinks to it under its gravity, slowed by the suit's thrusters.

Each of the Earth's animals is built to its own body plan — the elephant's
trunk, tusks and ears, the giraffe's neck and patches, the zebra's stripes,
the bison's hump, antlered deer and moose, maned lions and spotted cats, foxes
with their brushes, bears and apes, penguins, birds, scorpions — and a made-up
world's animals get body plans of their own from their seed (six legs or four,
stilts or stumps, eye-stalks, crests, glowing spots). They walk with their legs
swinging in a gait, heads nodding and tails swaying; birds flap.

### The instruments

The lab's **science survey** carries the **atmosphere reader** — every gas down
to parts per million, with the pressure, temperature, scale height and clouds,
or that there is no air at all (Mercury and the Moon have only an exosphere of a
few atoms) — a **cutaway** of the world's layers, the **chemistry of its
ground**, its **habitability** and what is known of **life** there. Real bodies
use measured values: the Galileo probe, Venera, Viking and Curiosity, Huygens,
Cassini's flights through Enceladus's plumes, Juno, MESSENGER, New Horizons.
Life is confirmed only on the Earth; elsewhere the survey lists the real
candidate biosignatures — Mars's methane and Perseverance's leopard spots,
Venus's disputed phosphine, the salt, hydrogen and phosphates from Europa's and
Enceladus's oceans — none of them confirmed. On the ground, `R` scans where you
stand: the air there, the ground under your feet, and what lives round you.

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
- On the map, gravitational lensing is drawn as a point lens on the background
  sky, as if seen from a height equal to the view's width; simulated bodies lie
  beside a hole rather than behind it and are not lensed. In 3D a hole's own
  disc and the stars behind it are traced; other bodies behind it are not.
- A hole's disc in 3D is drawn from the thin-disc law, not from the
  simulated gas: the gas sets how far out the disc reaches and the accretion
  rate sets how bright it is. Spinning (Kerr) holes are drawn as Schwarzschild
  holes.
- A hand-built body's shape is drawn and its strength tested against its own
  weight, but gravity treats it as a point mass like everything else.
- The ground close up is generated: its large features are the real ones (from
  each world's map), its relief is scaled to the measured spread of elevations,
  and what is finer than the map is fractal. The Earth's mountains come from a
  coarse mask, not a real elevation model, so Everest is not its true height.
- Landed craft and the ship ride with their world as it turns, but nothing on
  the ground feels the simulation's gravity or tides; craft in orbit keep a
  circular orbit round their world rather than being integrated.
- Probe descents and rover drives are shown faster than real time (a Galileo
  descent takes a couple of minutes, not an hour) so they can be watched.
- A made-up world's life is a seeded roll weighted by habitability, not a
  model of evolution.

## Layout

```
src/physics/   integrator, forces, collisions, stars, presets — no DOM, fully tested
src/pixel/     the map renderer: surface maps (worlds.ts paints the real ones, built in a worker), sprites, rings, particles, lensing, bursts
src/pixel/data/earth.ts     generated from Natural Earth by tools/fetch-earth.py
src/pixel/data/mars-*       Mars' heights and colour, baked by tools/bake-mars.py (marsdata.ts loads them)
src/pixel/data/sun-map.jpg  the Sun's surface, baked by tools/bake-sun.py (star.ts animates it)
src/pixel/data/earth-height.png  the Earth's land elevation (NASA SRTM), baked by tools/bake-earth-height.py (earthdata.ts loads it)
src/three/     the 3D view (three.js, loaded on demand), its flying controls, the ship (hull.ts), its consoles (panels.ts, survey.ts) and its scope;
               the ground (terrain.ts, its tiles built in terrainworker.ts and chosen in tiles.ts; ground.ts draws it with its sky and
               what stands on it), real mountains (peaks.ts), arches and caves (landforms.ts), interiors (interior.ts) and being in
               them (visit.ts), choosing where to build (placer.ts), the suit and vehicles (suit.ts), animals (fauna.ts), giant
               interiors (giant.ts), the craft (fleet.ts, craftmesh.ts), what the instruments read (science.ts), real sites (sites.ts),
               the stars (star.ts), black holes (hole.ts), nebulae, pulsars and dusty discs (exotic.ts) and the lights you bring (lights.ts)
src/physics/data/moons.ts   generated from JPL by tools/fetch-moons.py
src/ui/        input and tools, HUD, the body builder, the belt histogram
tests/         physics, landing and mars tests (vitest); browser.mjs (Playwright smoke test in parts, run side by side in CI);
               shot.mjs, surface-shot.mjs and special-shot.mjs take pictures of the 3D view and the map to look at
```
