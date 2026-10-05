# Assets

Model packs, where they are used, and how they're packed. Originals are in `tools/data/models/`; `python3 tools/pack-models.py` writes the game's copies to `src/three/models/` (textures cut to 512 px, the rockets' to 1024).

| Pack | Models | Used for |
|---|---|---|
| Low-poly space bases | modular-outpost, dome-habitat, vault-hangar | The bases (`src/three/basecamp.ts`): walk-in, with consoles, monitors and the growth lab |
| Low-poly trees | oak, birch, maple, palm, pine | Trees within 110 m (`src/three/flora.ts`), each species drawn by the nearest model, sized and varied per tree |
| Low-poly ruins | ruin-arch, -columns, -obelisk, -shrine, -tower, -wall | Rare ruins on solid worlds (`src/three/ruins.ts`), tinted to the ground |
| Modular Rocket Fleet | rocket-courier, -wayfarer, -mammoth | Rockets flying crew and cargo between pads, bases and stations (`src/three/rocketry.ts`, `fleet.ts`) |

Unused so far from the rocket pack: the door and hatch animations, the seat and cockpit camera sockets, the exhaust sockets.

## Made here

| What | Where | How |
|---|---|---|
| The ship's 3D model, outside and in | `public/ship/orbital-ship.glb` and `.usdz`, on the site at https://idoadjadjajdada.github.io/Orbital/ship/ | `node tools/export-ship.mjs` writes both from the game's own ship; run it again after changing the ship |
| The Earth's surface classes (ocean, land, ice, desert, lake, mountains, tundra) | `src/pixel/data/earth.ts`, 4096 × 2048 | `python3 tools/fetch-earth.py` bakes them from Natural Earth's 1:50 million land, lakes, glaciers and regions (public domain) |
