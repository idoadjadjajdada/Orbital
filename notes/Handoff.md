# Handoff: the bugfix pass

Where the bugfix pass of 11 October stands, so another Claude session (or account) can pick it up. The workflow is in [AGENTS.md](../AGENTS.md) ("Bugfix passes with subagents"); the agents are in `.claude/agents/`.

## Shipped to main
- Notes app: 4 bugs, verified SHIP (57282c6, 6c8f5c8, a757484, 6a6c653).
- Phone 3D: the rail and pause, verified SHIP (7aab695, 16941d1). See [Bugs](Bugs.md), Fixed.

## Fixed on a branch, not verified yet
Each branch is based on an older main; rebase or cherry-pick onto main after it passes.
| Branch | Bugs | Commits |
|---|---|---|
| `fix/ship` | Use runs twice on touch; T/J while docked; wormhole/spacewalk inside a black hole's fall | 0ed7a2c, c06caa1, bd8e5aa |
| `fix/fleet` | Retire strands a rocket; a rover flown to a station vanishes | d10c2bf, 81964e0 |

Both are finished. `fix/fleet`: tsc, vitest (96) and the rocket part passed; the base part didn't finish. `fix/ship`: the ship part passed; vitest, the build and the rocket and touch parts didn't run. The verifier should run them all.

## Not started
- Sleeping while paused passes no time (desktop only now; the fix is in `goToSleep`, src/three/view3d.ts).
- The rest of Open in [Bugs](Bugs.md).
- 4 `[map]` bugs from the map hunter, in [Bugs](Bugs.md). The ground hunter found nothing it could reproduce; its suspicions: the base terrace's corners have no walkable platform, animals wander into the sea, cliffs are climbed instantly with no fall, and the builder's flood fill ignores mirror.

## To carry on
Open a Claude Code session on this repository and say:

> Read notes/Handoff.md and AGENTS.md. Run one verifier over all the branches under "Fixed on a branch, not verified yet". Merge only what it says SHIP onto main, push, tick those bugs off in notes/Bugs.md with the new hashes, and update this file.

If your plan has no Opus, change `model: opus` to `model: sonnet` in `.claude/agents/bug-fixer.md` and `verifier.md`.
