# Customer presentation reference

Recorded 2026-09-12 from the user's requested visual reference: [Joseph Azar's Spline architectural presentation](https://x.com/parazar/status/2098051231323205993).

The public 54-second clip was retrieved and inspected through sampled frames, including a closer sequence of the initial reveal and a full-resolution presentation frame. This document records the intended experience; it does not claim that Draftroom already implements it. Reference media was inspected in a temporary directory and is not bundled as a project asset.

## Observed in the reference

- A floor-plan panel sits beside a much larger 3D presentation of the same house. The panel has ground/upper-floor selection, dimension controls, and area/storey information.
- A staged animation reveals the base, ground-floor shell and interior, upper-floor plate and rooms, and final roof/envelope. The camera changes framing and angle as the building develops.
- Removing the roof and upper layers makes interiors readable. The sequence can be revisited through a bottom timeline, with playback, restart, and speed controls.
- View controls include a complete perspective, roof removal, ground-floor inspection, and a cinematic sequence.
- The final scene includes a bounded plot, landscape, street edge, materials, shadows, and a human figure for scale. The presentation feels like a finished miniature architectural model.
- The later part of the clip shows the scene in the Spline editor. The post describes it as an interactive presentation created there. Its exact event setup and implementation are not available from the video alone.

## Draftroom experience to build

Enter Meeting & Presentation and open a dedicated, large customer presentation view. The selected project model should dominate the screen. Keep a compact source-plan/brief panel alongside it and a discreet presentation timeline below it. The current static sample preview is only an early placeholder for this experience.

1. Establish the site: plot outline, north, arrival, landscape, and the design's relationship to its surroundings.
2. Reveal the spatial idea: ground slab, rooms, main circulation, furniture, and protected design features.
3. Reveal additional levels where the actual project has them. Show useful intermediate cutaways, with the plan panel indicating the current floor.
4. Complete the envelope: roof/façade and material composition, followed by a composed final camera view.
5. Let the customer pause, replay, move through stages, orbit the model, and inspect selected floors or a roof-off view.

The reveal explains the design. It is not a simulated live AI work session or a verified physical construction sequence. Treat animation stages and design iterations as distinct controls: a timeline reveals one selected version; V1/V2 comparison switches between actual saved design versions with equivalent camera framing.

Adapt the sequence to each project. A single-storey office reveals zones, furniture, and the interior experience; a tower groups floors into meaningful podium/office/sky-garden stages instead of making the customer watch forty identical floor animations. The cultural centre should expose hall volumes and the shared roof; the library should make courtyard and quiet/active relationships readable.

## Design artifact requirements

- Plan and model must refer to the same committed iteration and scale. Rendered labels, dimensions, floor counts, and areas need real scene data or clearly identified assumptions.
- Preserve meaningful groups for site, floors, cores, partitions, furniture, envelope, roof, and landscape. Stable element names allow presentation stages to target the intended parts.
- Keep stage transitions reversible and isolated from the saved source design. Hiding a roof for inspection must not become a destructive edit to the design artifact.
- The Architect owns coherent shell/floor grouping; the Interior Designer supplies spatial/furniture groups; the Analyst supplies verified metrics and unknowns; the Critic checks the customer experience; the Director selects the version and supplies the brief design narrative.
- Prefer presenting the actual Spline design artifact when the integration supports the required controls. Validate export/runtime control of camera, visibility, and animation before selecting the implementation. Do not replace it with an unrelated generated illustration while labelling it the final design.

## Acceptance checks

- The selected version opens in a large presentation view from Meeting & Presentation.
- Stage controls visibly reveal the correct geometry and remain usable during pause/replay/scrubbing.
- Plan selection, visible floor, stage title, and model agree.
- Camera motion is smooth and can be interrupted by the customer; reduced-motion mode uses immediate stage changes and a stable camera.
- Roof-off and floor-only inspection preserve access to the complete building view.
- V1/V2 comparison preserves equivalent views and displays the correct evidence and design changes.
- The experience works on narrow screens, with keyboard-operable controls and a usable fallback when 3D cannot render.
- No animation implies live editing, completed engineering checks, or a different design artifact than the one actually presented.
