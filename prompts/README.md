# Atelier prompt library

Adapted from `../draftroom/prompts` on 2026-09-13. Shared instructions are Atelier version 1.4.0, based on Draftroom 1.1.0 and updated for dependency-driven collaboration, inspected file proposals, canonical mesh geometry and persistent steering requirements; active role files retain their individual version labels. The five master briefs remain unchanged at source version 1.0.0. The [original library](../docs/draftroom/prompts/README.md) is preserved for comparison.

## Role composition

The worker composes [shared instructions](shared.md) followed by exactly one role. Runtime briefs, effective requirements, current design, accepted changes, task data and tool evidence remain separate user/context input. Markdown links are references; models do not automatically load them.

| Atelier role ID | Prompt file | Ownership |
| --- | --- | --- |
| `principal` | [Director / Principal Architect](agents/director.md) | Alex Morgan: brief, delegation, change coordination and decisions |
| `architect` | [Architect](agents/architect.md) | Kai Chen: canonical geometry, layout, shell, stairs and circulation |
| `designer` | [Interior Designer](agents/interior-designer.md) | Sofia Reyes: materials, lighting and furniture; preserve structure |
| `critic` | [Critic](agents/critic.md) | Noah Ellis: actionable requirement and design review |
| Reference only | [Analyst](agents/analyst.md) | Optional deterministic checking methodology; not a fifth active worker |

File names retain their Draftroom counterparts to make comparison easy; `director.md` maps to `principal`, and `interior-designer.md` maps to `designer`. Do not load the archived original prompts into active workers.

## Runtime contract

The complete shared and role instructions are retained with a 64,000-token allowance per structured agent response, including reasoning. Reasoning settings remain unchanged. Task work has 12 minutes within a 13-minute checkpoint, and proposal authoring has 24 tool turns with submission available on the last turn. The output limit lives in [model-settings.ts](../worker/src/model-settings.ts), task limits in [task-time.ts](../worker/src/task-time.ts), and each new run's generation profile records both.

[worker/src/prompts.ts](../worker/src/prompts.ts) composes the active Markdown as Worker text imports; [worker/src/ai.ts](../worker/src/ai.ts) supplies the strict response schema for each invocation. Return that schema directly. Draftroom's historical JSON envelope and richer handoff fields are review guidance, not additional output fields.

| Invocation | Response contract |
| --- | --- |
| Principal brief | `request`, `summary`, `goals`, `constraints`, `questions` |
| Principal plan | `summary`, `tasks`; each task has `id`, `title`, `objective`, `kind`, `agent`, `dependencies`, `deliverables` |
| Principal selected-color routing | `scope`, `color`, `elementId`, `explanation` |
| Principal overlap decision | `decision`, `instruction` |
| Initial Architecture without an existing design | `proposal.json`: complete `DesignSchema`; final response: `{ summary }` after inspected file submission |
| Architecture / Interior with an existing design | `proposal.json`: `DesignEditsSchema` upserts/removals and nullable metadata; final response: `{ summary }` after inspected file submission |
| Designer visual direction | `summary`, `recommendations`, `coordination`; each coordination entry has `target`, `message` |
| Critic | `summary` as a string, `findings` as a string array |

The source of truth is the versioned canonical design, represented as `project/design.json`. An E2B workstation receives `/home/user/project/design.json` as the task's working copy. Architecture and Interior write a separate `/home/user/project/proposal.json`, inspect its rendered candidate using `inspect_proposal`, and call `submit_proposal` in a later turn for the inspected bytes. A changed file requires a fresh inspection, with at most two inspections per task. Final responses contain a short summary instead of repeating the entire design. Working-copy files and tool submissions remain proposals until the coordinator validates and commits them. The installed [proposal guide](proposal-guide.md) documents the file contract and tested construction examples; [design_authoring.py](../scripts/design_authoring.py) supplies reusable wall/opening, window/door, slab/void, stair/landing, roof/gable and mesh helpers. [DesignEditsSchema](../shared/design-edits.ts) preserves every unmentioned record; the server applies explicit edits and validates the complete result with the canonical schema. The read-only `read_design_revision` tool can retrieve a saved revision of the same project for selective recovery while retaining newer accepted repairs. Three.js and Blender compile derived views/artifacts. No Spline connection is required.

[team.ts](../worker/src/team.ts) executes the Principal's plan using [collaboration.ts](../shared/collaboration.ts): 2–8 tasks in an acyclic dependency graph, up to two different specialists per batch, one task per specialist at a time. A final Critic task must depend transitively on every other task. A new design requires Architecture and Interior tasks, with Interior depending on Architecture. The Principal can start architecture and a Designer visual study together, then make interior placement depend on both. Existing-design architecture and finish proposals can run together when independent. This is a supported example, not a fixed sequence.

Each batch works from a common saved revision. Tasks persist their outputs and coordination notes; dependents receive their declared predecessors' saved results. The scheduler waits for every execution in the batch to settle; an execution failure prevents that batch's proposals from being published. Canonical commits then serialize: disjoint, role-permitted changes merge against the latest design, while overlapping edits require a persisted Principal decision and at most one retry of the affected task. If a later publication or conflict retry fails, earlier successful commits remain saved. Designer proposals may change materials, material assignments, furniture and lights; they preserve metadata, `notes`, structural geometry, spaces, floors and spawn.

Specialist candidate inspection/refinement runs inside each assigned task and preserves the dependency graph’s concurrency. Final findings still trigger at most one additional Principal correction plan and review. Remaining findings leave the project in `review`; an empty combined finding list permits `ready`, subject to revision and cancellation fences. This does not establish comprehensive geometry verification or a universal review-before-detail gate. `reviewDesign` still provides limited checks. Actual candidate inspections supplement the normal workstation view, which shows JSON and a room table; neither the schema nor the helpers establish complete geometric correctness. Required missing evidence belongs in Critic findings.

Specialists with workstations can read the design, execute bounded Python, inspect/click/type on the real desktop, and use `report_coordination`. Architecture and Interior additionally inspect and submit candidate files. The canonical schema supports bounded normalized triangle meshes and explicit opacity/transmission, which are preserved by the browser and Blender; do not send historical Blender-only metadata. That tool records a public note and includes it in the task's saved handoff; it does not spawn an agent, change dependencies, replan, pause a task or interrupt a running sibling. Visual-direction tasks have no workstation tools and return their notes in `coordination`. The image concept and the Designer's visual-direction report are separate artifacts.

Each team run freezes an `effective-requirements.json` artifact containing the stored brief and ordered applied user amendments. The same record is supplied alongside the persisted current instruction to Principal planning, specialists, visual-requirement analysis, conflict resolution, correction plans and Critic review. Requested image concepts also receive the requirements and save them in artifact metadata. Apply amendments in order and let later instructions supersede earlier wording only for the same subject and scope; retain unrelated requirements. A selected-element instruction must not silently expand to a whole-building change. The current run instruction takes priority within its scope. This preserves client wording and application evidence rather than generating a semantic property map.

Activity's change tracker uses persisted **Queued → Working → Applied → Reviewed** milestones and exposes revision references, findings and failures. The snapshot carries complete change history and the project requirements record; voice/project context also receive the requirements. Exclude requests that never reached application from the applied amendment history. Preserve an applied amendment if a later review fails or the run is stopped, without claiming that incomplete work passed review.

## Current interaction limits

- Steering submitted during a run is saved and queued for a subsequent run; it is not injected into an in-flight specialist call or used to replan the current graph.
- One owner can have one active run across projects; concurrency is between eligible specialist tasks within that run.
- Selected single-element color changes can use a deterministic Designer edit followed by Critic review. Other changes receive a scoped Principal plan; they do not inherently require every role.
- Clarification questions end the generation run with a blocked Principal task. A saved brief update and another **Start team briefing** are needed; there is no automatic clarification resume. Voice can append pre-design clarification details, while the typed message composer currently submits change requests.
- The saved requirements record makes applied amendments available across runs, but interpreting natural-language overlap still depends on the model. It does not prove that every requested detail was implemented or verified.
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
- A yellow-exterior brief followed by an applied red-exterior change and then a balcony request supplies the red amendment to planning, specialists and review; a selected-element recolor stays scoped to that element.
- Queued and never-applied failed/cancelled requests do not become applied requirements. A request applied before a failed review or Stop work retains its amendment and reached milestones.
- The tracker distinguishes a saved revision from review with findings, and reloading the project preserves each request's history.
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
