# Walking through generated designs

Open **Design → Walk inside** to explore the current saved house at eye level. This uses the same first-person controller as the studio. **Click to walk** is also available in the design viewer.

## Controls

- **WASD / arrow keys:** move relative to the direction you are looking.
- **Mouse:** look around. If the browser cannot capture the mouse, hold the left button and drag the scene.
- **Escape:** return to Orbit, including when mouse capture is unavailable.
- **E:** open a nearby studio room when its interaction hint appears. This applies only in the office.

Opening a dialog or workstation pauses movement input and looking. Typing in an input does not move the visitor. Losing focus clears held movement keys.

The standing eye height is **1.7 m above the floor**. The visitor has a full-height capsule, slides along walls, climbs ordinary steps, and descends stairs with ground snapping. There is no jump or crouch control.

## Requirements for a generated house

The renderer consumes the canonical `project/design.json` through the existing project snapshot/revision flow. `World.tsx` renders the design elements and builds their Rapier colliders from `shared/geometry.ts`; the camera starts at `design.spawn`. The walkthrough does not maintain another copy of the design.

Use metres and Y-up coordinates. Set `spawn` to an eye position over an accessible floor, for example `[0, 1.7, 3]` when the floor surface is at Y=0. On an upper floor at Y=3, use an eye Y of 4.7. Keep the spawn clear of furniture and walls.

The house needs actual interior geometry:

- Floor slabs must support the rooms and connect to landings.
- Walls need real door openings made from separate wall pieces. A `door` element placed inside a solid wall does not cut a hole.
- Stair elements rise along local +Z and can be rotated around Y. The compiler subdivides the rise into steps no higher than 0.18 m; provide adequate tread depth and landing space. A 3 m rise over a 5 m run is covered by the physics tests.
- Upper slabs must leave an opening above the stairs. Split slabs around the stairwell; a single slab across it blocks the visitor's head.
- Leave standing clearance around furniture, doors, stairs, and ceilings. The collision capsule is 1.8 m tall and 0.48 m wide, plus a small collision margin. A 0.9 m wide, 2.1 m high doorway gives comfortable room for this controller.

Slabs, walls, roofs, stairs, furniture, and asset boxes currently collide. Door, window, and light elements do not. Windows are therefore not physical barriers in this MVP. Cutaway removes roofs from both rendering and collision.

After a design revision or cutaway change, the controller checks the visitor's current position for support and standing clearance. If obstructed, it searches around the supplied spawn within 2 m. Falling below the scene also triggers recovery. When no clear location is found, movement stops with an on-screen message; Escape still returns to Orbit.

## Spline / imported models

The current walkable house is the canonical design rendered in Three.js. A Spline scene, external embed, GLB preview, or generated image is not automatically part of this physics world.

To connect an imported model, keep its placement and scale in the canonical design, load its geometry into the viewer, and provide matching floor, wall, stair, and furniture collision geometry in the same Rapier world. Interior openings and a clear spawn must remain accessible. Simple collision proxies are appropriate when the visual model is detailed. Existing `asset` elements currently render as boxes; this walkthrough change does not add an asset loader or Spline integration.

## Verification

Run `npx vitest run tests/first-person.test.ts tests/navigation.test.ts` and `npm run typecheck`.

The physics tests use the actual Rapier WASM version resolved by `@react-three/rapier`. They cover eye height, climbing and descending a rotated 17-step staircase, thin walls, sliding, headroom, excessive step heights, diagonal speed, stalled frames, falling, sensors, and clear entry positions on ground and upper floors, including the sample house geometry.

Browser checks cover office and house entry, drag-to-look fallback, Escape, dialog handling, and the nearby-room E interaction. These checks use the sample design; live model generation and Spline integration are separate workflows.
