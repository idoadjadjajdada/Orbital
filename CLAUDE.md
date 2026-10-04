# Orbital: how to work here

## Commits
- Everything goes to `main`. Commit, then `git push origin HEAD:main` (check `origin/main` is an ancestor first; never force).
- If the session's own branch still exists on the remote, push the same commit there too, so it never falls behind `main`.
- No model names or identifiers in commits, code or notes.

## The notebook: `notes/`
The owner works from an iPhone, often with no computer, and reads `notes/` in the GitHub app (or in Obsidian through Working Copy). Keep it up as part of every task, not afterwards.

When the owner sends feedback, a bug, a feature request, an idea or a picture:
1. **Their message, word for word**, goes in `notes/Feedback/YYYY-MM-DD.md` (their date), under a short heading, as a `>` quote. Never paraphrase it there. Say which files came with it.
2. **Pictures** they send are saved to `notes/attachments/YYYY-MM-DD-short-name.jpg` (JPEG, at most 1600 px, quality 85) and shown under the message: `![what it shows](../attachments/…)`. Reference pictures (what something should look like) are also listed in `notes/References.md`.
3. **Each bug** goes in `notes/Bugs.md` under Open, as a checkbox: what is wrong, where (world, coordinates, mode) and a link to the message. **Each feature** goes in `notes/Roadmap.md` (or `notes/Ideas.md` if it's only a thought).
4. **When something is done**, tick it, add the commit hash, move the bug to Fixed, add the feature to `notes/Built.md`, and under the message in `Feedback/` write "Done: … (hash)".
5. Model packs they send: originals in `tools/data/models/`, packed with `python3 tools/pack-models.py`, listed in `notes/Assets.md`.

Use ordinary Markdown links (`[Bugs](Bugs.md)`), not `[[wikilinks]]`: they work in both the GitHub app and Obsidian.

## Checks before pushing
- `npx tsc --noEmit -p .`, `npx vitest run`, `npm run build`.
- The browser suite in parts: `PARTS=map|ship|land|base|rocket|giant|touch node tests/browser.mjs` (`CHROMIUM_PATH` for the browser). Run each part in its own process; run them one at a time, since a busy machine makes them time out.
- In browser checks, wait for the condition (`until`, `waitForFunction`) and hold keys or buttons until their effect shows. Never wait a fixed time: CI's software renderer is slow.
- After pushing, watch the "Test and deploy" run on `main` and fix whatever fails.
- To see a change working, use `tests/surface-shot.mjs` (a picture from the ground at a latitude and longitude) or a short Playwright script, and look at the picture.
