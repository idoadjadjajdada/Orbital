# Orbital

An n-body gravity sandbox that runs in one HTML file. Fling worlds into orbit
and let the maths do the rest — slingshots, capture, decaying orbits,
collisions that merge. No goals, no progression, nothing to grind.

Open `index.html`. That's the whole install.

## Playing

| | |
|---|---|
| Drag from empty space | fling a new body; the dotted line is where it will actually go |
| Tap empty space | with **Auto-orbit** on, drops the body straight into a circular orbit |
| Tap a body | select it — see its mass, speed, what it orbits and its period |
| **Drag** on, then drag a body | pick it up and move it; let go and it carries the speed your hand had |
| Tap a body again, `Esc`, or the panel's ✕ | put it down — three ways out of a selection |
| Tap nothing with something selected | also puts it down, instead of dropping a world |
| Scroll / pinch | zoom |
| Two-finger drag, middle-drag, or space+drag | pan |
| Tap the lit world in the picker | put it out. With nothing lit, an empty press places nothing |
| `1`–`9` | pick a body class, or the same one again to put it out |
| `Space` `C` `T` `D` `F` `G` | pause · clear · trails · drag · fit · forge |

Built for desktop and iPad: one finger draws and flings, two fingers pinch and
pan, and a mouse wheel zooms about the cursor.

## What it does

**Solar system** loads ours. Distances are to scale — every orbit is the real
semi-major axis, started at its own perihelion with the perihelion speed, so
the eccentricities are real too and Mercury's 0.21 is plainly visible. The
eight planets carry their true masses and true sizes *relative to each other*
(Jupiter is 11.2 Earths across because it is, and 318 Earths heavy because it
is), the main belt sits between Mars and Jupiter where Jupiter never let a
planet finish forming, and thirteen moons go round in the real order and the
real directions. Triton still goes backwards. Saturn, Uranus, Jupiter and
Neptune all have their rings, made of debris inside the Roche distance, which
is the whole reason they are rings and not moons.

Three things are not to scale and cannot be, so they are at least honest about
which way they are wrong. **Sizes**: to scale, Earth would be a sixtieth of a
world unit — smaller than one pixel at any zoom on offer — so bodies are drawn
about eighty times too large, every ratio between them intact. **The Sun's
mass**: ours is 333,000 Earths and anything past 4,200 units collapses under
itself here, so the Sun is 3,000 and the planets are lifted twenty-fold against
it. The price is that Jupiter pulls the Sun round a circle about a quarter the
width of Mercury's orbit rather than a hundredth, which you can sit and watch
it do. **Moon orbits**: a moon has to sit well inside its planet's Hill sphere,
and the Hill sphere is set by the real distances while the planet is drawn
eighty times too wide — so where our Moon sits sixty Earths out, this one sits
at two, at the same fraction of the Hill radius.

Seventeen kinds of thing, from an asteroid up: rocky and icy and molten
worlds, gas and ice giants, a brown dwarf that never quite lit, dwarf stars and
stars, a red giant puffed to a hundred times its width at a thousandth of its
density, a white dwarf carrying most of a star inside an Earth, neutron stars,
pulsars and black holes.

Worlds are pixel art, generated rather than drawn: every body gets a sprite
baked from value noise, shaded against a sphere normal, coloured from a ramp.
Rocky worlds grow continents and craters; gas giants get latitude bands warped
by turbulence and the odd storm; stars granulate and darken toward the limb.
The **Forge** panel puts that under your control — composition, palette, size
and density, with a live preview. Density and size decide mass, and mass is the
only thing gravity actually reads.

Two worlds meeting mostly do not merge and mostly do not explode. Past about
thirty degrees off centre they **clip** each other: the pixels that overlapped
are scraped off, both survive, both get deflected, and the bigger one picks up
most of what it tore loose on the way past.

**Two worlds meeting is never resolved in one frame**, however gently they
arrive. Both **go liquid** —
every pixel of both worlds, molten, still carrying the speed it came in with —
and from there it is only motes: the two of them drive through each other, mix,
knock about, lose the motion to those collisions, and their own gravity gathers
what is left.

It does not become a world again for a long while, and not because anything is
waiting on a clock. Three things have to be true at once: the sloshing has to
have died down, gravity has to have pulled the thing round, and it has to have
gone **cold enough to be solid**. Magma is not a planet. So what you watch is a
lopsided glowing cloud being drawn in, rounding off, darkening from the skin
inward — and only then does a world appear, wearing a colour that is neither of
the two that went in and still faintly warm.

Hit it off centre and the melt comes out spinning: it goes cold while it is
still a two-to-one lozenge, and it is held there as particles until gravity has
finished the job. Two gas giants do the same but skip the cooling — gas has no
melting point, so a gas world re-forms as soon as gravity has gathered it.

How much of it goes liquid is the impact energy against what binding the pair
together is worth — but there is a floor under that, and the floor is not
padding. Assembling one body out of two releases gravitational energy whether
they were moving to begin with or not, and rock is a poor place to put it. So
even a slow touch leaves a magma ocean rather than a seam, and whatever ends up
moving faster than the pair can hold on to is simply gone.

Only a stone is caught rather than mixed: below about a twenty-fifth of what it
hits, an impactor is accretion, and at speed it breaks up against the surface
instead. And a star swallows anything much smaller without ceasing to be one.

Below that it just merges, and a small fast projectile against a big world
still shatters and throws molten debris.

**Gas is drawn as a density field**, not as a heap of translucent squares.
Every mote lays down a soft puff of optical depth, and what you see is how much
of it is stacked along the line of sight — thin edges wispy, deep cores solid.
Nothing about the shading is drawn; it is where the gas actually is.

Nothing holds itself up forever. Feed a star past about 4,200 and it goes
**supernova** — a blast front, a shell thrown off that becomes the nebula, and
a neutron star left behind. Every nebula gets its own colour, rolled once per
collapse, and it is still hanging there minutes later. Its shape is not rolled
at all: it comes out of where the shell happened to be thrown and what gravity
does to it afterwards. Feed anything past about 13,000 and it collapses
into a **black hole**. The Forge sliders reach far enough to build something
that collapses the moment you place it.

**Anything heavy raises a tide.** A star pulls a close planet out of round, a
gas giant does it to something passing, and a dense enough thing close enough
takes a world apart entirely. What makes black holes look special is only that
they pack the mass into no radius, so you can get near enough for it to matter.
A body sitting in a tidal field is drawn into a prolate figure pointed at
whatever is pulling on it, and how far from round it gets is the same number
that decides whether it survives at all.

Two things decide whether it survives. Small bodies have **strength** —
cohesion falls off against surface gravity as 1/r², so a moon holds together
where a world would not, which is why there is rubble sitting inside limits
that would shred a fluid body. And coming apart **takes time**: about the
body's own free-fall time, so a world parked inside the limit comes apart while
one that only passes through the same depth is gone before it can flow.

A black hole is not a black circle. It has an **event horizon** — a real edge,
past which the picture simply stops — and around it the sky is visibly wrong.
Light that would have gone past is pulled around, so what you see beside one is
the view from somewhere else, stretched: a world behind it appears about half
again further out than it is, and the patch directly behind is smeared all the
way round into a **photon ring**, which is the brightest thing in the frame.
None of that is painted on. The pass reads the picture that has already been
drawn and resamples it, so whatever is really behind the hole is what gets
bent — a star field, a nebula, or a world in mid-collision.

Feed one and it **lights up and answers back**. Material that finds a close
orbit grinds into a disc, and a disc is the brightest thing in a galaxy for a
reason: material at one radius goes round faster than material just outside it,
and rubbing the two together is what takes the orbit apart. The heat is what it
pays with, so the disc glows *and* drains inward, which is the only reason
anything in one ever reaches the middle. And not all of what arrives goes in —
a share of it is flung back out along the axis as a pair of narrow **jets**,
taken out of what the hole just swallowed, so the books still balance.

A star that collapses keeps its angular momentum, and the core it lands on is a
fraction of the width the star was. Whatever slow turn it had comes out
enormously faster: a **pulsar**, sweeping a beam from each pole.

Get too close and you are **spaghettified**. Past the Roche limit a
world stops being a body at all: it is replaced, once, by rubble sampled
straight out of its own sprite — one mote per pixel, in place, at the speed it
was going — so the instant it happens looks like nothing happened. From then
on it is only motes, with their own gravity pulling them together, their own
contacts holding them apart, and the hole pulling harder on the near side than
the far one.

Nothing about the shape it takes is drawn. Whether it ends up a teardrop, a
bar that pinches in the middle, one lump trailing a tail, or a string of beads
that each settle back into little worlds is not a case anybody handles — it is
what those three forces do to a few thousand particles.

Heavy impacts and collapses send out a **shockwave** that shoves whatever it
overtakes, debris and worlds alike.

That debris then has to end up somewhere:

- **Inside the Roche distance** tides never let it clump, so it grinds itself
  circular and stays a **ring**.
- **Outside it**, fragments sharing a patch of sky and a velocity pull together
  into a real body — an **asteroid**, a **moon** or a **dwarf planet**,
  depending on how much rubble found each other.
- Or it falls back in, adding its mass to whatever swept it up.

## How it works

- **Integrator.** Velocity Verlet, which is symplectic — orbits keep their
  shape over long runs instead of spiralling the way plain Euler makes them.
  Accelerations carry between steps, so gravity is evaluated once per step.
- **Softening.** Forces use `1/(r² + ε²)^1.5`, so a close pass produces a
  slingshot rather than a division by zero.
- **Collisions** merge, conserving momentum and mass. Radius follows from the
  combined mass, so a star that eats a hundred moons visibly grows.
- **Prediction.** While you aim, a massless probe is integrated through the
  frozen field a few hundred steps ahead and drawn. It is the difference
  between a gravity toy and a gravity guessing game.
- **Trails** are sampled by distance travelled, not per frame, so they look the
  same at every speed setting instead of vanishing when you slow down.
- **Pixels.** The whole sim is drawn into a buffer a few times smaller than the
  window and blown up with nearest-neighbour. That is what makes it pixel art,
  and it is also why debris is cheap to draw.
- **Debris**, up to 200,000 motes, set by the Debris slider. Getting there was
  mostly a rendering problem rather than a physics one: a `fillRect` per mote
  cost more than the entire gravity step, so the motes are now accumulated by
  hand into a `Uint8ClampedArray` — which saturates at 255, so additive
  blending falls out for free — and blitted in one `drawImage`. Drawing
  200,000 of them now costs about a millisecond. Gravity on debris is the
  remaining cost, and it is capped: below the top handful of bodies by mass,
  nothing measurably pulls on a mote, so a busy sky only ever evaluates six
  sources per particle.
- **Opacity** is `1-exp(-kd)` on the column density — Beer-Lambert, the same
  law that decides how thick a real cloud looks. Depth is then banded into a
  handful of steps: rendered continuously a cloud comes out as soft round
  blobs, which is the one thing this is not allowed to look like, and stepping
  it gives the flat shaded bands that read as pixel art. It is the density
  doing the shading either way.
- **Hit-and-run.** The impact parameter — how far the line one body is
  travelling along misses the other's centre by — decides the whole outcome,
  and it is measured off the approach rather than off the overlap, which is
  nearly zero at the instant they first touch. What gets scraped off is the
  sprite pixels that would have been inside the other body at closest
  approach. They leave at the speed their own world was going, so momentum
  takes care of itself, and they are ordinary debris afterwards — which is why
  the other body sweeps up so much of it.
- **Light bending** is done on the frame rather than to the objects in it. Each
  hole resamples a disc of the already-drawn buffer, sampling from further in
  than it writes, with a deflection going as 1/r — the real weak-field falloff.
  Sampling the other way pulls images inward, which is the wrong sign and looks
  like a drain rather than a lens. Nearest-neighbour, so the bend stays as
  chunky as everything else.
- **Nothing pops.** A world turning to rubble leaves its own sprite behind for a
  third of a second, drifting with what it became; a cloud turning back into a
  world keeps its motes, weightless and no longer part of anything, to fall the
  last of the way in. Both are cross-fades over things that were never
  instantaneous underneath.
- **A body's class and colour are inherited, not guessed.** What a settled cloud
  becomes is read off the roster's own masses, so a world that gains a moon is
  not demoted a class for having grown. Its palette is scored by matching every
  mote against each candidate ramp — in chromaticity, because shading drags half
  of any world's pixels toward grey and matching raw colour made Barren a trap
  that swallowed everything — weighted by mass, and fenced by composition, so a
  dwarf planet can no longer come back wearing a star's colours.
- **Mass is conserved exactly**, through every collision, collapse and
  crumble. Motes carry their own mass, so a mote count chosen for how it looks
  no longer decides how much matter exists — which is what the shatter and the
  supernova shell were both quietly doing, one creating 10% and the other
  losing most of a star.
- **Momentum is conserved too**, which took finding four places it was not.
  A body swallowing a mote took its mass and left its motion behind. A clump
  formed from rubble took the mean velocity of its pieces rather than the
  mass-weighted one, and pieces do not all weigh the same. A ring grinding
  itself circular traded momentum with nobody. And cohesion is a field, so a
  cloud that is not round pushes on itself — the net of it is measured each step
  and handed back, which is the statement that nothing pulls on itself. A
  collision no longer throws a blast front either: the pieces it throws *are*
  the blast, and a wave shoving things as well counted it twice. Exact without
  rubble in play; about a part in a thousand with a cloud sloshing.
- **Contacts are inelastic**, and that is what makes a collision a merge. A
  positional pass that only separates overlapping motes stores no energy and
  loses none, so two clouds driven together slide straight through and out the
  far side. Rock arriving at rock keeps almost none of its approach; the
  impulse can only ever reduce one, never create one, so no timestep can make
  it blow up.
- **Settling** is what turns a cloud back into a world, and it has three
  conditions, none of them timed. Its own gravity has to beat the motion inside
  it; spin does not count — a cloud turning as a whole is already a body, and
  taking the bulk rotation out first is the difference between an off-centre
  hit re-forming and never settling at all, and it keeps the turn it gathered
  with. Its rock has to be **below the melting point**, measured over the rock
  only, since gas has no melting point and a gas world is not waiting on one.
  And it has to be **round**, measured as the ratio of the principal axes of
  the mass it is made of — but only where gravity is the thing deciding its
  shape. Under a real tide the equilibrium figure is prolate, not a sphere, so
  holding out for one would mean nothing near a hole ever pulled itself back
  together.
- **Heat leaves through the surface.** A mote packed in among five or six
  others is not the surface, and holds its heat about twice as long as one out
  on the skin — so a melt darkens from the outside in with the glow still
  showing through it, and the middle is the last part to go solid. The
  neighbour count falls out of the contact pass, which is already visiting
  every touching pair.
- **A held world is out of the integrator's hands, not out of the sim.** While
  you are dragging one it is skipped by the position and velocity update, so it
  stops falling — but it still pulls on everything else from wherever you are
  holding it, and it still collides. What it carries away is put on the same
  scale a fling is: the clock does not run at hand speed, so a cursor's true
  world velocity is nonsense as an orbital one, and a lazy sweep across the
  screen would otherwise be a thousand units a second.
- **The picker can hold nothing.** It always had one of its worlds lit, which
  meant every press on empty sky put a world there whether you wanted one or
  not — and with a tool in hand, that is precisely the press you were trying to
  make. Tapping the lit one puts it out, and with nothing lit an empty press
  does nothing at all. Opening the forge lights it again, since opening the
  forge is asking to build something.
- **A tool press is not a selection.** With Drag on, pressing a world picks it
  up and leaves the inspector exactly as it was: selecting is its own thing, and
  a tool reaching for a world does not also get to decide what you are looking
  at. Anything added later gets the same deal — and nothing selected is ever a
  state you are stuck in, since a second tap, `Esc`, the ✕, or a tap on empty
  sky all put it down.
- **Nothing is drawn smaller than two buffer pixels.** A planet is a very small
  thing a very long way from the next one: pull back far enough to see two
  orbits at once and every world in the sky is a hundredth of a pixel, which is
  true and useless. Below the floor the picture stops being to scale rather than
  the sim stopping being right — which is what every planetarium ever written
  does.
- **Circular velocity accounts for the softening.** The force law is
  `1/(r²+ε²)^1.5`, so the speed that balances it is `√(GM)·r/(r²+ε²)^0.75`, not
  `√(GM/r)`. Far out the two agree to nothing; close in they do not, and the
  textbook one launches a moon a quarter too fast — enough to strip it off its
  planet inside two years.
- **Both forge sliders are logarithmic.** A linear density track spends nine
  tenths of itself between rock and slightly denser rock and still cannot reach
  a neutron star; on a log track every doubling costs the same distance, so one
  sweep covers a snowball to degenerate matter.
- **Melting** is decided by energy, not speed: the impact carries this much per
  unit mass, holding the pair together costs about this much. Two equal worlds
  meeting at the speed they would fall together at come in at a quarter of the
  threshold, so a touch merges; it takes about two and a half times that to
  liquefy them.
- **Molten rock takes its hue from its temperature** and shows what it is made
  of as light and dark, rather than being tinted towards orange — rock and
  orange have nearly the same green in them, so tinting turns everything to
  sand and you lose the two worlds folded into the melt. Rubble draws opaque;
  only loose debris is additive, or a packed melt saturates to a white smear.
- **Rubble** holds itself together with the monopole term — every mote toward
  its own cloud's centre of mass — which is what dominates for a roughly round
  blob and costs one pass instead of the n² every pair would. The clouds are
  re-split by spatial connectivity a few times a second, so when one pulls
  into two, each half starts holding itself together separately. That is what
  lets a stretched world pinch off a bead instead of smearing into one endless
  string.
- **Contacts**, because gravity alone is not enough: a cold self-gravitating
  cloud falls straight in on itself. That is real physics and completely wrong
  for a pile of rock, which is held up by its pieces touching. So overlapping
  motes are pushed apart — by moving them rather than by applying a force. A
  spring stiff enough to hold a world up would explode the first time the clock
  ran at sixty times; a positional pass cannot, whatever dt is. It loses energy
  doing it, which is also what a pile of gravel does. A body is always drawn
  round, because anything being pulled out of shape is not a body any more.
- **Ring damping** eases a fragment's whole velocity toward the circular one for
  its radius. Damping only the radial part looks right and is not: it just makes
  the current radius an apsis and leaves the speed mismatch that made the orbit
  elliptical in the first place. The test measures eccentricity, and caught it.

## Tests

```sh
npm install
npx playwright install chromium
npm test
```

Drives the real page in Chromium. The two that matter most are physical rather
than behavioural: a circular orbit must stay circular over a simulated minute,
and total energy must not drift. Both would catch an integrator regression that
no amount of clicking around would reveal.

`window.orbital` is a small scripting hook — `list()`, `add()`, `step(dt)`,
`energy()`, `preset()`. The tests drive the sim through it with an exact `dt`
so results do not depend on machine speed. The ones about picking a world up go
the other way and put a real cursor on the real canvas, because what is under
test there is what a hand does.
