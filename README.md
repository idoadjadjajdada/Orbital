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
