# Handoff: the bugfix pass

Where the bugfix pass of 11 October stands, so another Claude session (or account) can pick it up. The workflow is in [AGENTS.md](../AGENTS.md) ("Bugfix passes with subagents"); the agents are in `.claude/agents/`.

## Shipped to main
- Notes app: 4 bugs, verified SHIP (57282c6, 6c8f5c8, a757484, 6a6c653). See [Bugs](Bugs.md), Fixed.

## Fixed on a branch, not verified yet
Each branch is based on an older main; rebase or cherry-pick onto main after it passes.
| Branch | Bugs | Commits |
|---|---|---|
| `fix/phone-3d` | 3D button rail off the top of a phone; paused then 3D stays frozen | 3dd9b22, 8cf733d |
| `fix/ship` | Use runs twice on touch; T/J while docked; wormhole/spacewalk inside a black hole's fall | 0ed7a2c, c06caa1, bd8e5aa |
| `fix/fleet` | Retire strands a rocket; a rover flown to a station vanishes | d10c2bf, 81964e0 |

The ship and fleet fixers were stopped mid-pass to save usage: their branches hold what was committed, and their checks may not all have run.

## Not started
- Sleeping while paused passes no time (wait for `fix/phone-3d`: it changes how pause works in 3D).
- The rest of Open in [Bugs](Bugs.md).
- The map and ground hunters were stopped early: anything they logged is in [Bugs](Bugs.md) under `[map]` and `[land]`.

## To carry on
Open a Claude Code session on this repository and say:

> Read notes/Handoff.md and AGENTS.md. For each branch under "Fixed on a branch, not verified yet", run the verifier agent on it. Merge only the ones it says SHIP onto main, push, tick them off in notes/Bugs.md with the new hashes, and update this file.

Cheaper: give one verifier all three branches at once. If your plan has no Opus, change `model: opus` to `model: sonnet` in `.claude/agents/bug-fixer.md` and `verifier.md`.
