# Bugs

What looks wrong, and where: the world and the latitude and longitude from the readout help, and so does a screenshot.

## Open
- [ ] 

## Known limits
- Rocket flights, landings and descents run on frame time, so they are slower when frames are slow.
- The jetpack can fly up through a base building's roof.
- Locally, the browser test's touch part times out when run after other parts in the same process (CI runs each part separately, where it passes).

## Fixed
- [x] Near a world, the ship and you on a spacewalk were not carried round with it: the ground slid away underneath while you came down to land (09cc9fd). ([message](Feedback/2026-10-04.md#gravity-the-ships-looks-and-the-map))
- [x] Going from 3D to the map left the 3D picture frozen over it, with only the labels drawn (09cc9fd). ([message](Feedback/2026-10-04.md#gravity-the-ships-looks-and-the-map))
- [x] The deploy failing since the ground's close-up textures: they made CI's frames too slow for Lander 1's landing test (9ea26d0)
- The belt and moons visible in the daytime sky; rocks different a few steps apart; structures floating or sunk: see [Feedback, 3 October](Feedback/2026-10-03.md) (89055af, 347f546)
- Trees drawn giant; kapok trees drawn as autumn-red maples (2365ddd)
- The whole base building marked solid; the ajar airlock door blocking the way (2365ddd)
- Fixed-time browser checks failing on slow CI frames (467bbbf, 84f16ed, d39807f)
