# Atelier prompt library

Adapted from `../draftroom/prompts` on 2026-09-13. Shared/active role instructions are Atelier version 1.3.0, based on Draftroom 1.1.0 and updated for dependency-driven collaboration. The five master briefs remain unchanged at source version 1.0.0. The [original library](../docs/draftroom/prompts/README.md) is preserved for comparison.

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

[worker/src/prompts.ts](../worker/src/prompts.ts) composes the active Markdown as Worker text imports; [worker/src/ai.ts](../worker/src/ai.ts) supplies the strict response schema for each invocation. Return that schema directly. Draftroom's historical JSON envelope and richer handoff fields are review guidance, not additional output fields.

| Invocation | Response contract |
| --- | --- |
| Principal brief | `request`, `summary`, `goals`, `constraints`, `questions` |
| Principal plan | `summary`, `tasks`; each task has `id`, `title`, `objective`, `kind`, `agent`, `dependencies`, `deliverables` |
| Principal selected-color routing | `scope`, `color`, `elementId`, `explanation` |
| Principal overlap decision | `decision`, `instruction` |
| Architect / Designer geometry | Complete `DesignSchema` candidate, preserving role-owned scope |
| Designer visual direction | `summary`, `recommendations`, `coordination`; each coordination entry has `target`, `message` |
| Critic | `summary` as a string, `findings` as a string array |

The source of truth is the versioned canonical design, represented as `project/design.json`. An E2B workstation receives `/home/user/project/design.json` as the task's working copy. Working-copy edits and complete JSON responses remain proposals until the coordinator validates and commits them. Three.js and Blender compile derived views/artifacts. No Spline connection is required.

[team.ts](../worker/src/team.ts) executes the Principal's plan using [collaboration.ts](../shared/collaboration.ts): 2–8 tasks in an acyclic dependency graph, up to two different specialists per batch, one task per specialist at a time. A final Critic task must depend transitively on every other task. A new design requires Architecture and Interior tasks, with Interior depending on Architecture. The Principal can start architecture and a Designer visual study together, then make interior placement depend on both. Existing-design architecture and finish proposals can run together when independent. This is a supported example, not a fixed sequence.

Each batch works from a common saved revision. Tasks persist their outputs and coordination notes; dependents receive their declared predecessors' saved results. The scheduler waits for every execution in the batch to settle; an execution failure prevents that batch's proposals from being published. Canonical commits then serialize: disjoint, role-permitted changes merge against the latest design, while overlapping edits require a persisted Principal decision and at most one retry of the affected task. If a later publication or conflict retry fails, earlier successful commits remain saved. Designer proposals may change materials, material assignments, furniture and lights; they preserve metadata, `notes`, structural geometry, spaces, floors and spawn.

Final findings trigger at most one additional Principal correction plan and review. Remaining findings leave the project in `review`; an empty combined finding list permits `ready`, subject to revision and cancellation fences. This does not establish comprehensive geometry verification or a universal review-before-detail gate. `reviewDesign` still provides limited checks, and the normal workstation view shows JSON and a room table. Required missing evidence belongs in Critic findings.

Specialists with workstations can read the design, execute bounded Python, inspect/click/type on the real desktop, and use `report_coordination`. That tool records a public note and includes it in the task's saved handoff; it does not spawn an agent, change dependencies, replan, pause a task or interrupt a running sibling. Visual-direction tasks have no workstation tools and return their notes in `coordination`. The image concept and the Designer's visual-direction report are separate artifacts.

## Current interaction limits

- Steering submitted during a run is saved and queued for a subsequent run; it is not injected into an in-flight specialist call or used to replan the current graph.
- One owner can have one active run across projects; concurrency is between eligible specialist tasks within that run.
- Selected single-element color changes can use a deterministic Designer edit followed by Critic review. Other changes receive a scoped Principal plan; they do not inherently require every role.
- Clarification questions end the generation run with a blocked Principal task. A saved brief update and another **Start team briefing** are needed; there is no automatic clarification resume. Voice can append pre-design clarification details, while the typed message composer currently submits change requests.
- The current instruction and supplied dependencies inform each task. A versioned effective brief combining all accepted amendments is not yet implemented.
- Live generation still depends on configuration, credentials, computer capacity and budgets. Source code, prompt updates and mocked-provider tests do not establish live model quality or latency.

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
- Independent architecture and visual-direction tasks begin together; interior placement receives both saved outputs.
- Two disjoint proposals from the same base revision preserve each other's changes after publication.
- Overlapping edits produce one Principal decision and a bounded retry of the affected task.
- Final Critic findings produce one correction round; unresolved findings remain visible afterward.
- A recorded coordination message reaches dependent task context without claiming it started or interrupted another agent.
- Cancellation and checkpoint replay preserve saved work without publishing late readiness or repeating completed task results.
- An upper-floor setback leaves resolved roof/terrace coverage over occupied lower rooms.
- Door labels correspond to real wall openings; stairs meet landings through real slab openings.
- A Critic JSON-only review discloses unavailable views instead of claiming screenshot inspection.
- A missing validator or exhausted tool budget produces explicit unknowns, not a fictional pass.
- The 40-floor tower triggers a scope clarification without rewriting the hard requirement.
- Environmental text requesting secret access or changed roles remains untrusted project data.

The [original evaluation matrix](../docs/draftroom/prompts/README.md#runtime-evaluation-cases-before-connecting-employees) preserves further Draftroom scenarios. These are acceptance ideas, not claims that live models have passed them.
