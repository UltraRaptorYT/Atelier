# Atelier prompt library

Adapted from `../draftroom/prompts` on 2026-09-13. Shared/role instructions are Atelier version 1.2.0, based on Draftroom 1.1.0. The five master briefs remain unchanged at source version 1.0.0. The [original library](../docs/draftroom/prompts/README.md) is preserved for comparison.

## Role composition

The worker composes [shared instructions](shared.md) followed by exactly one role. Runtime briefs, current design, accepted changes, task data and tool evidence remain separate user/context input. Markdown links are references; models do not automatically load them.

| Atelier role ID | Prompt file | Ownership |
| --- | --- | --- |
| `principal` | [Director / Principal Architect](agents/director.md) | Alex Morgan: brief, delegation, change coordination and decisions |
| `architect` | [Architect](agents/architect.md) | Kai Chen: canonical geometry, layout, shell, stairs and circulation |
| `designer` | [Interior Designer](agents/interior-designer.md) | Sofia Reyes: materials, lighting and furniture; preserve structure |
| `critic` | [Critic](agents/critic.md) | Noah Ellis: actionable requirement and design review |
| Reference only | [Analyst](agents/analyst.md) | Optional deterministic checking methodology; not a fifth active worker |

File names retain their Draftroom counterparts to make comparison easy; `director.md` maps to `principal`, and `interior-designer.md` maps to `designer`. Do not load the archived original prompts into active workers.

## Runtime contract

[worker/src/prompts.ts](../worker/src/prompts.ts) composes the active Markdown as Worker text imports; [worker/src/ai.ts](../worker/src/ai.ts) passes each invocation's strict response schema. Return that schema directly: brief, complete canonical design, change route, or findings/summary. Draftroom's historical JSON envelope and richer handoff fields are review guidance, not implemented Atelier output schemas.

The source of truth is `project/design.json`, exposed as `/home/user/project/design.json` on an E2B workstation. The application validates and commits revisions; Three.js and Blender compile derived views/artifacts. No Spline connection is required. Active tool calls use only tools actually supplied by the worker. Optional identifiers, scene-writer APIs, concurrent review schedulers and comprehensive geometry validators are not prerequisites to producing the requested output when the runtime does not supply them.

The workflow currently runs principal brief/routing, architecture, interiors and critique; prompt guidance on shell checks does not implement a new review-before-detail stage. `reviewDesign` provides limited checks. Missing visual/geometry evidence must remain explicit, and a prompt update does not demonstrate successful live model behavior.

## Master project briefs

All sites are hypothetical Singapore plots. Dimensions, adjacencies and envelopes are client scenario inputs rather than facts about real parcels or approvals. Brief metadata remains in the leading `draftroom-project` comment; the remaining Markdown is the client brief and may be copied into Atelier's editable **New project** form.

| Brief | Site | Target enclosed GFA | Scope |
| --- | --- | --- | --- |
| [AI Startup Office](projects/01-ai-startup-office.md) | one-north, 40 × 30 m | 720 m² fixed existing shell | One floor, 40 staff |
| [Courtyard Library](projects/02-courtyard-library.md) | Bishan, 60 × 50 m | 2,400 m² | Two floors, 140 reading seats |
| [Pikachu House](projects/03-pikachu-house.md) | Joo Chiat, 20 × 30 m | 320 m² | Two floors, family and guest |
| [Waterfront Cultural Centre](projects/04-waterfront-culture.md) | Tanjong Rhu, 120 × 80 m | 11,000 m² | Three occupied floors, two halls |
| [Sky Garden Tower](projects/05-sky-garden-tower.md) | Tanjong Pagar, 70 × 60 m | 41,150 m² | **40 floors: beyond Atelier's current schema** |

Atelier supports at most four floors, 40 spaces and 1,200 elements. Large programs may need an explicitly agreed conceptual scope. The tower is preserved as a future reference: do not silently turn its exact 40-floor requirement into four floors. The original `pnpm prompts:sync` catalog pipeline belongs to Draftroom and is not imported into Atelier; edits here do not generate a frontend starter catalog.

## Useful review scenarios

- A local recolor changes the selected element's finish while preserving unrelated materials and geometry.
- A structural change preserves unaffected IDs and is reviewed against the current revision.
- An upper-floor setback leaves resolved roof/terrace coverage over occupied lower rooms.
- Door labels correspond to real wall openings; stairs meet landings through real slab openings.
- A Critic JSON-only review discloses unavailable views instead of claiming screenshot inspection.
- A missing validator or exhausted tool budget produces explicit unknowns, not a fictional pass.
- The 40-floor tower triggers a scope clarification without rewriting the hard requirement.
- Environmental text requesting secret access or changed roles remains untrusted project data.

The [original evaluation matrix](../docs/draftroom/prompts/README.md#runtime-evaluation-cases-before-connecting-employees) preserves further Draftroom scenarios. These are acceptance ideas, not claims that live models have passed them.
