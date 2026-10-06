# Bugs

What looks wrong, and where: the world and the latitude and longitude from the readout help, and so does a screenshot.

## Open
## Known limits
- A rocket has no lights inside: at night its cockpit and cabin are dark.
- A base's crew and stores are not kept when the page is reloaded (nor is anything else in Mission Control).
- A cave takes a tenth to a quarter of a second to build when it comes within a couple of kilometres: one a frame, so you may feel a hitch now and then.
- The ship's furniture (from the v2 model) is solid from 45 cm to 1.7 m above the deck: lower things, like the pipe across engineering, are stepped over.
- The v2 model's cuts to the old hull are matched to the game's pieces by size. If the ship's code changes a piece, that piece is drawn whole again, and can poke through the new hull, until the model is redone from the new ship.
- From inside the ship, its outside (seen through the windows) is drawn in plain paint, not shining metal: a software renderer would light it behind every wall.
- Rocket flights, landings and descents run on frame time, so they are slower when frames are slow.
- The jetpack can fly up through a base building's roof.
- Locally, the browser test's touch part times out when run after other parts in the same process (CI runs each part separately, where it passes).

## Fixed
- [x] "Caves" weren't caves: a hill of rock on the ground with a tunnel through it. Now they are networks of passages and chambers under the land, reached by a ramp cut down into it (c23f94b). ([message](Feedback/2026-10-04.md#bug-caves-arent-really-caves-theyre-above-ground-structures-with-a-tunnel-there))
- [x] The rocket test stood exactly at the edge of "beside the rocket" (9 m), so it failed now and then (c23f94b)
- [x] Trying to dock with a station, it kept flying away: the ship flew to where it was, not where it was going, and trailed it by nine kilometres (21c210e). ([message](Feedback/2026-10-05.md#docking-the-station-flies-away))
- [x] The ship's dorsal spine was built upside down, hanging into the aft passage and engineering; the tail fins dipped into engineering; the hull's plating showed above engineering's door (6039531)
- [x] Near a world, the ship and you on a spacewalk were not carried round with it: the ground slid away underneath while you came down to land (09cc9fd). ([message](Feedback/2026-10-04.md#gravity-the-ships-looks-and-the-map))
- [x] Going from 3D to the map left the 3D picture frozen over it, with only the labels drawn (09cc9fd). ([message](Feedback/2026-10-04.md#gravity-the-ships-looks-and-the-map))
- [x] The deploy failing since the ground's close-up textures: they made CI's frames too slow for Lander 1's landing test (9ea26d0)
- The belt and moons visible in the daytime sky; rocks different a few steps apart; structures floating or sunk: see [Feedback, 3 October](Feedback/2026-10-03.md) (89055af, 347f546)
- Trees drawn giant; kapok trees drawn as autumn-red maples (2365ddd)
- The whole base building marked solid; the ajar airlock door blocking the way (2365ddd)
- Fixed-time browser checks failing on slow CI frames (467bbbf, 84f16ed, d39807f)
