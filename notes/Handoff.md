# Handoff

Where the work stands, so any Claude session (or account) can pick it up. The workflows are in [AGENTS.md](../AGENTS.md) (bugfixes, features, handing off); the agents are in `.claude/agents/`.

## Features
- No plans waiting for approval, nothing being built. See [Plans](Plans/README.md) and the [Roadmap](Roadmap.md).

## Bugfixes: shipped to main
- Notes app: 4 bugs, verified SHIP (57282c6, 6c8f5c8, a757484, 6a6c653).
- Phone 3D: the rail and pause, verified SHIP (7aab695, 16941d1).
- c5990e2: the audit's fixes, including everything `fix/ship` and `fix/fleet` held (written again on main, so those two branches are no longer needed), sleeping while paused, the 4 `[map]` bugs and three of the owner's 10 October photos. See [Bugs](Bugs.md), Fixed.

## Shipped
- Measured ground on the Moon (c5990e2), Venus, Mercury and Mars (77b3894), baked by `tools/bake-heights.mjs`.

## Waiting for the owner
- More moons with real terrain: only when the owner says so (see the [Roadmap](Roadmap.md)).

## Bugfixes: not started
- The rest of Open in [Bugs](Bugs.md): the ship going dark inside, the notes app's draft bugs, two flaky browser checks (`[tests]`), the iPhone SE rail.

## To carry on
Open a Claude Code session on this repository and say:

> Read notes/Handoff.md and AGENTS.md, then carry on.

Right now that means: the rest of Open in Bugs.md, or more moons once the owner says so.

If your plan has no Opus, change `model: opus` to `model: sonnet` in `.claude/agents/bug-fixer.md` and `verifier.md`.
