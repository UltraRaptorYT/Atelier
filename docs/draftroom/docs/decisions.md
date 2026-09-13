# Implementation decisions

## Creative design with checked assembly — 2026-09-12

The user requested role-prompt changes after the Spline Pikachu House experiment exposed unresolved floor coverage, bathroom access and stairs. Preserve creative massing and spatial invention while reusing assembly logic; do not constrain the Architect to fixed house templates. Shared instructions and all five roles are now version 1.1.0; the master briefs/catalog remain 1.0.0.

The proposed workflow establishes one versioned spatial model, builds the simple shell, checks actual enclosure/connectivity and plan/elevation/section evidence, combines Analyst and Critic findings, and only then advances to detail. Independent reviews may run concurrently against the same immutable checkpoint; only one scene writer applies the bounded revision. Unknown checks remain unknown, and intentional voids require evidenced purpose rather than a label that conceals an error. Client checkpoints address design choices, not approval of routine correction steps.

The user also authorized MCP authoring as the efficient modeling path. Role prompts now allow supplied, authorized MCP tools with scene reads and visual verification; UI is used where needed or explicitly required. This changes the former UI-only Architect prompt but does not relabel programmatic modeling as computer use or claim that the application's live computer-use gate has shipped.

This is a prompt/contract update, not implementation of a spatial-model compiler, geometry validator, worker, concurrency scheduler or active agent team. Behavioral evaluation remains pending; regression scenarios are recorded in [the prompt library](../prompts/README.md#runtime-evaluation-cases-before-connecting-employees). Existing Spline geometry is not revised by this change.

## Customer presentation direction — 2026-09-12

The user supplied [this Spline video](https://x.com/parazar/status/2098051231323205993) as the desired design-presentation effect. Use a dominant 3D model, adjacent floor plans, a staged floor/interior/roof reveal, camera choreography, a replayable timeline, and inspection views in Meeting & Presentation. See [presentation-experience.md](presentation-experience.md) for observed details, project-specific adaptation, and acceptance criteria. The reference has been inspected; implementation is pending.

## Frontend first — 2026-09-12

The user requested characters and a walkable frontend before integrations. This overrides the default M0-first sequence for this task. Build a labelled rehearsal without providers, credentials, or containers.

## Visual direction

Warm isometric diorama with a visible character, cutaway walls, glass, timber, plants, and cream/coral/sage UI. All geometry is code-native; fonts are locally bundled. Click-to-walk and keyboard movement coexist with accessible DOM room controls.

## State and navigation

Use Zod-validated, versioned localStorage for brief, notes, avatar, and sample iteration. Live mode will require authoritative server state. A* and collision checks share obstacle definitions with the scene. Preserve project data during navigation and refresh.

## Rendering

Use directional shadows; optional ContactShadows produced incorrect coverage in the tested Three.js/drei combination and was removed. Pause continuous rendering behind dialogs/journal and honor reduced-motion preferences.

## Tooling

Next.js 16.3.5, React 19.2.8, Fiber 9.7.0, Drei 10.7.8. TypeScript 5.9.3 and ESLint 9.39.4 match lint-plugin compatibility; the installed plugins rejected TypeScript 7 and ESLint 10. Keep the lockfile and review peers when upgrading. Disable Next.js automatic AGENTS generation to preserve the authored guide.

## Room layout and navigation correction — 2026-09-12

User clarification supersedes the original separate presentation/critic rooms: Architect, Interior Design, shared Analyst/Critic, and shared Meeting/Presentation, connected by reception. Include five labelled sample employees. Interior has a workstation, material swatches, and sofa mockup; Analyst/Critic has a dual workstation and evidence board; Meeting has a table model and presentation screen.

A valid player position could round into furniture and make A* reject further travel. Seed all locally visible grid cells; keep every segment collision-safe. Furniture clicks resolve to a nearby reachable approach. Partition rendering and collision footprints share one definition; leave enough clearance around the reception desk for the navigation grid.

Fiber mounts its canvas fallback children even when WebGL works. An effect in those children incorrectly marked the office unavailable, bypassing walking for room navigation. Detect WebGL support before mounting Canvas; use passive canvas fallback content. Browser regressions assert arrival after repeated floor clicks and real walking to room labels.

## Prompt library and concrete master briefs — 2026-09-12

Added version 1.0.0 shared instructions and five role system prompts. Composition is shared instructions followed by one role; project/context data stays separate. Public output contracts are documented proposals until runtime validation exists. No AI workers were activated.

Five master briefs use hypothetical plots in Singapore neighborhoods, with explicit land dimensions, GFA accounting, reconciled program allocations, hard limits, intended experience, and evidence requirements. Fictional scenario inputs are distinguished from real parcel/regulatory facts. The office brief distinguishes the 1,200 m² plot from the fixed 720 m² fit-out; the tower includes both sky gardens in its 40 floors.

Markdown project files are the source of truth. A small sync script generates the frontend catalog, checks dimensions/budgets and the 3,000-character limit, and fails the production build if the catalog is stale. Existing local project data is preserved. The DRAFTROOM vision links to the detailed briefs instead of maintaining generic duplicate prompts.
