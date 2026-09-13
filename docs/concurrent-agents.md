# Dependency-based agent collaboration

Generation and change runs execute a persisted task graph. The Principal selects the needed specialists, their objectives, deliverables and dependencies. A selected single-element colour edit uses a predefined Designer/Critic graph with a deterministic patch. Independent work can branch and rejoin; there is no mandatory four-agent sequence.

For the complete user-facing flow from opening the website to exploring a generated building, see [From entering Atelier to a generated design](user-journey.md).

## From brief to task graph

The user saves a brief and starts the team briefing. The Principal normalizes it into `BriefSchema`, asking at most three high-impact questions when necessary. A clarification ends that run with a blocked Principal task; answering and resuming automatically is not implemented.

When enabled, an initial concept is generated if no reference is selected. The selected reference is frozen for the run and supplied to every dispatched specialist, including visual-direction and review tasks. Image generation/editing and Blender rendering also have separate requested workflows; their artifacts do not replace the canonical design.

For example, a new house can use:

```mermaid
flowchart TD
  P[Principal: brief and task plan] --> A[Architect: shell and room layout]
  P --> V[Designer: visual direction]
  A --> I[Designer: interior placement]
  V --> I
  I --> R[Critic: combined design review]
  R -->|Actionable findings| C[Principal: correction plan]
  R -->|No findings| F[Saved design ready to explore]
  C --> T[Targeted correction tasks]
  T --> R2[Critic: final re-review]
  R2 -->|No findings| F
  R2 -->|Still unresolved| H[Project remains in review]
```

For an existing house, independent structure and finish tasks may start from the same saved revision and run together. A finishes-only change can use the Designer and Critic without regenerating architecture. A selected single-element colour change retains its deterministic material patch and does not allocate a Designer workstation.

The example above is one valid plan. An early Critic review can be added as a dependency when useful; the scheduler does not enforce a separate shell-review stage.

| Task kind | Owner | Output |
| --- | --- | --- |
| `architecture` | Architect | Canonical design proposal for layout, geometry and spatial changes |
| `visual_direction` | Designer | Structured palette, materials, lighting, furnishing direction and coordination artifact |
| `interior` | Designer | Canonical design proposal for materials, material assignments, furniture and lights |
| `review` | Critic | Findings about the saved design and task context |

## Scheduling and shared state

- Plans contain 2–8 validated tasks, including at least one architecture or interior task. Invalid owners, duplicate IDs, missing dependencies and cycles are rejected. A final Critic review must depend transitively on every other task. New-house plans require architecture and interior work, with interior placement depending on architecture.
- Ready work runs in batches of up to two distinct specialists. Tasks from the same specialist serialize because each room has one workstation. A batch settles before publication and before its downstream tasks start.
- Each batch reads one saved starting revision. Specialists produce separate proposal/result artifacts, not competing copies of the authoritative scene.
- The coordinator merges proposals by stable element/material/space IDs and changed fields against their common ancestor. Non-overlapping changes survive. Conflicting fields, deletion-versus-edit conflicts, schema-invalid combined designs and ownership changes do not silently overwrite another specialist's work. Schema validation does not establish geometric usability.
- Designer proposals can change materials, material assignments, furniture and lights. Structural geometry, spaces, floor count, spawn and metadata remain protected.
- Task results, dependency references, coordination messages, Principal decisions and canonical revisions persist in D1/R2. Downstream tasks receive the actual saved outputs of their prerequisites. Activity shows task owners, status, prerequisites and deliverables.

Agents with workstations can use `report_coordination` to record a concrete handoff or cross-domain concern. Its successful result records a message and includes it in the saved task result supplied downstream. It does not independently launch another task or grant permission to modify another role's fields. Visual-direction tasks have a structured coordination field for the same purpose.

## Meetings, review and failure

Overlapping proposals trigger a Principal decision with the conflicting paths, latest accepted design and pending proposal as context. The affected task is rerun once against that saved current design, with the decision. A repeated conflict stops the run with its proposals preserved.

The final Critic evaluates the combined saved revision. Findings can trigger one new dependency plan for bounded corrections and another final review. Unresolved findings leave the project in `review`; the system does not run an unlimited correction loop or declare the model ready anyway.

If a task execution fails, sibling executions settle before the failure is handled, and no proposals from that batch are published. Proposal integration is sequential rather than one atomic batch transaction: if a later proposal still conflicts after its retry, earlier successful commits remain saved. Within the task graph, cancellation fences task status updates, design publication and final readiness. Checkpointed steps and persisted plans/decisions/results are reused after interruption; internal task/attempt identifiers cannot collide with model-chosen task names.

The scheduler uses awaited parallel workflow steps and persisted results, following [Cloudflare's workflow and idempotency rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).

## Steering progress and effective requirements

The project snapshot exposes the full saved change-request history, independently of the recent event feed. Activity's [ChangeTracker](../components/ChangeTracker.tsx) shows **Queued → Working → Applied → Reviewed** using persisted milestone evidence, with the submitted instruction, selected specialist/element, base and saved revisions, review findings and errors. A change reaches “Applied” after all planned canonical writes have integrated, before final Critic review. Review is a separate outcome and can report unresolved findings. Stopping or failing a run does not erase milestones or revisions already reached.

Feedback submitted during active work still queues for the next run. It does not interrupt an in-flight task or change that run's plan. Once a subsequent run starts, it freezes a persistent `effective-requirements.json` artifact from the stored brief and ordered previously applied user amendments. The same record, alongside the persisted current run instruction, reaches Principal planning, specialists, visual-requirement analysis, conflict decisions, correction plans and Critic review. Project and voice context also expose the effective requirements. Requested image concepts receive the requirements too and preserve them in artifact metadata.

Apply amendments in order: later instructions supersede earlier instructions or the stored brief only where their subject and scope overlap. A selected-element request remains scoped to that element; it does not recolor every element with a similar material. The current run instruction has priority within its scope, and unrelated requirements remain in force. For example, after “make the exterior red” is applied, “add a balcony” retains the red-exterior amendment even if the original brief requested yellow.

Queued changes and requests that fail or are cancelled before reaching the applied milestone are excluded from the applied amendment history. An applied amendment and its revision evidence remain recorded if review subsequently fails or the run is stopped. An earlier commit can survive a later integration failure without the request reaching “Applied”; inspect task revision artifacts for that partial work. The record preserves client wording and scope; it is not a semantic property map or a guarantee that every requested detail was implemented. Critic findings and partial-work status remain necessary evidence.

## Compute limits

The global limit is two computers. Existing daily/monthly caps remain in force, including 3,600 desktop seconds per user per UTC day and a maximum 900-second lease. Each workstation reserves its maximum lease up front. After confirmed shutdown, unused reservation time is returned and elapsed time is rounded up to whole seconds for charging. Failed shutdown retains its reservation and slot while cleanup retries. Legacy leases without a trustworthy start time retain the conservative full charge.

Tasks release their own workstation when done instead of leaving completed machines occupying the next specialist's slot. Saved workstation artifacts remain available in Files. Actual long-running work can still exhaust the configured allowance; this change does not increase spending limits or enable paid generation.

## Setup and verification

Apply all pending migrations, including [0004_task_dependencies.sql](../worker/migrations/0004_task_dependencies.sql) and [0006_change_tracking.sql](../worker/migrations/0006_change_tracking.sql), with the existing migration command (`npm run db:local` for local development). Deployments must apply them before running this Worker version. No new external service is required. Generation and rendering remain disabled in the checked-in [Worker configuration](../worker/wrangler.jsonc).

Run `npm run typecheck`, `npm test`, `npm run build` and `npm run worker:check`. Targeted suites include `collaboration.test.ts`, `image-workflow.test.ts`, `backend.test.ts`, `desktop-budget.test.ts`, `artifact-storage.test.ts` and `agent-tools.test.ts` in [tests](../tests/).

Tests exercise overlapping task execution, dependency handoffs, same-base merges, conflicts and targeted retries, sibling failure/cancellation, bounded correction, replay, coordinator commit fences, resource accounting and persisted coordination tools. Provider calls are mocked. These checks do not establish live model quality, paid-service access or end-to-end deployment latency.

## Current boundaries

This is a bounded task graph within a design run. At most one queued or in-progress run per user is allowed across projects. Steering received during work remains queued for the next run; tasks are not interrupted and dynamically replaced midway through a model call. Meetings currently occur for conflicting proposals and final-review corrections. A coordination message alone does not rewrite the running graph.

Effective requirements preserve the stored brief and applied amendments across runs, with a frozen record for each team run. Interpreting overlapping natural-language requirements still depends on the model; the application does not extract a semantic ontology or prove complete compliance. Typed messages currently enter the change queue even when they are questions or clarification answers. These routing gaps and automatic clarification resume remain separate work.

Saved canonical models are walkable through **Design → Walk inside**. The final presentation-room exhibit, Spline/imported-model integration and comprehensive geometric review remain unfinished. See the [readiness review](agent-design-review.md) and [walkthrough guide](walkthrough.md).

## Implementation map

- [shared/collaboration.ts](../shared/collaboration.ts): task schemas, dependency validation, field ownership and proposal merging.
- [worker/src/team.ts](../worker/src/team.ts): scheduling, persisted dependency results, meetings, retries and correction plans.
- [worker/src/workflow.ts](../worker/src/workflow.ts): briefing, reference selection, change routing and run orchestration.
- [worker/src/coordinator.ts](../worker/src/coordinator.ts): canonical revision commits and cancellation fences.
- [shared/requirements.ts](../shared/requirements.ts) and [worker/src/requirements.ts](../worker/src/requirements.ts): ordered scoped amendments and frozen run requirements.
- [worker/src/changes.ts](../worker/src/changes.ts) and [components/ChangeTracker.tsx](../components/ChangeTracker.tsx): persisted change milestones and their Activity presentation.
- [worker/src/budget.ts](../worker/src/budget.ts), [shared/budget.ts](../shared/budget.ts) and [worker/src/desktop.ts](../worker/src/desktop.ts): resource limits, lease accounting and workstation lifecycle.
- [components/TaskBoard.tsx](../components/TaskBoard.tsx): visible task dependencies and current specialist activity.
- [prompts/README.md](../prompts/README.md): active Markdown role instructions and runtime output contracts.
