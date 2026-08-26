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
| Scroll / pinch | zoom |
| Two-finger drag, middle-drag, or space+drag | pan |
| `1`–`6` | pick a body class |
| `Space` `C` `T` `F` | pause · clear · trails · fit |

Built for desktop and iPad: one finger draws and flings, two fingers pinch and
pan, and a mouse wheel zooms about the cursor.

## What it does

Worlds are pixel art, generated rather than drawn: every body gets a sprite
baked from value noise, shaded against a sphere normal, coloured from a ramp.
Rocky worlds grow continents and craters; gas giants get latitude bands warped
by turbulence and the odd storm; stars granulate and darken toward the limb.
The **Forge** panel puts that under your control — composition, palette, size
and density, with a live preview. Density and size decide mass, and mass is the
only thing gravity actually reads.

Hit two worlds together hard enough and they do not politely merge. The smaller
one is destroyed and thrown out as molten debris that cools from white through
orange to plain rock while it flies. A gas world throws a coloured plume
instead, strung out by whatever gravity is nearby.

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
  and it is also why a few thousand debris motes cost nothing to draw.
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
so results do not depend on machine speed.
