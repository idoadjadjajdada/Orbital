# Orbital: a brief for anyone working here

Read this before you start: Claude, Codex, Copilot, or a person.

## The notebook comes first
The owner works from an iPhone, often with no computer. Their notebook is `notes/` in this repository; they read and write it in the **notes app** (`public/notes/index.html`, live at https://idoadjadjajdada.github.io/Orbital/notes/), on GitHub, or in Obsidian. It is how they see what is going on, so keeping it is part of every task, not something for the end.

Start each task by reading `notes/README.md`, `notes/Roadmap.md` and `notes/Bugs.md`, and the newest file in `notes/Feedback/`. Entries that say "Added in the notes app" are the owner's own words, typed on their phone: treat them like a message in chat.

### When the owner tells you something
A bug, a feature, an idea, a picture, an opinion:
1. **Their message, word for word**, goes in `notes/Feedback/YYYY-MM-DD.md` (their date), under a short `## ` heading, as a `>` quote. Never paraphrase it there. Say which files came with it.
2. **Pictures** they send are saved to `notes/attachments/YYYY-MM-DD-short-name.jpg` (JPEG, at most 1600 px, quality 85) and shown under the message: `![what it shows](../attachments/…)`. Reference pictures (what something should look like) are listed in `notes/References.md` too.
3. **Each bug** goes in `notes/Bugs.md` under Open as a checkbox: what is wrong, where (world, coordinates, mode), and a link to the message. **Each feature** goes in `notes/Roadmap.md`; a passing thought goes in `notes/Ideas.md`.
4. **When it is done**, tick it and add the commit hash. Move a bug to Fixed, add a feature to `notes/Built.md`, and write "Done: … (hash)" under the message in `Feedback/`.

### What you add on your own
- **Bugs you find** and don't fix now: in `notes/Bugs.md` under Open, with how to see them.
- **Limits you leave in**: in `notes/Bugs.md` under Known limits.
- **Reference pictures you use** (a photograph, a NASA map, a diagram): in `notes/attachments/`, listed in `notes/References.md` with where they came from and what they were used for.
- **Model packs or other assets**: originals in `tools/data/models/`, packed with `python3 tools/pack-models.py`, listed in `notes/Assets.md`.
- **What you built**: a line in `notes/Built.md` with the commit; for something you can see, a small screenshot in `notes/attachments/` if it helps.
- **Ideas you had but didn't do**: in `notes/Ideas.md`, marked as yours.

Use ordinary Markdown links (`[Bugs](Bugs.md)`), not `[[wikilinks]]`: they work in the notes app, on GitHub and in Obsidian. The notes app writes in this same format, and pushes straight to `main`; pull before you edit the notes, and don't rewrite what it wrote.

## Commits
- Everything goes to `main`. Commit, then `git push origin HEAD:main` (check `origin/main` is an ancestor first; never force).
- If your session's own branch exists on the remote, push the same commit there too, so it never falls behind `main`.
- No model names or identifiers in commits, code or notes.
- Pushes that only touch `notes/` don't run CI.

## Checks before pushing
- `npx tsc --noEmit -p .`, `npx vitest run`, `npm run build`.
- The browser suite in parts: `PARTS=map|ship|land|base|rocket|giant|touch node tests/browser.mjs` (`CHROMIUM_PATH` for the browser). Run each part in its own process, one at a time: a busy machine makes them time out.
- In browser checks, wait for the condition (`until`, `waitForFunction`) and hold keys or buttons until their effect shows. Never wait a fixed time: CI's software renderer is slow.
- After pushing, watch the "Test and deploy" run on `main` and fix whatever fails.
- To see a change working, use `tests/surface-shot.mjs` (a picture from the ground at a latitude and longitude) or a short Playwright script, and look at the picture.
