# Bugs

What looks wrong, and where: the world and the latitude and longitude from the readout help, and so does a screenshot.

## Open
- [ ] 

## Known limits
- Rocket flights, landings and descents run on frame time, so they are slower when frames are slow.
- The jetpack can fly up through a base building's roof.
- Locally, the browser test's touch part times out when run after other parts in the same process (CI runs each part separately, where it passes).

## Fixed
- Trees drawn giant; kapok trees drawn as autumn-red maples (2365ddd)
- The whole base building marked solid; the ajar airlock door blocking the way (2365ddd)
- Fixed-time browser checks failing on slow CI frames (467bbbf, 84f16ed, d39807f)
