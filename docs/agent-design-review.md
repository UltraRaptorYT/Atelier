# Agent workflow readiness review

Updated 2026-09-13 from the current implementation. Atelier now runs a Principal-authored dependency graph with concurrent specialist work, persistent outputs and coordinated canonical commits. Steering has a dedicated progress tracker and a durable record of applied requirement amendments. Text and voice share conversation routing and persistent clarification continuation. The remaining gaps concern live interaction acceptance, requirement interpretation and design evidence.

This review describes code and automated coverage. This documentation update did not run paid OpenAI/E2B generation, measure live latency or establish a live demo success rate. See the [collaboration contract](concurrent-agents.md), [image integration](image-generation-integration.md) and [walkthrough](walkthrough.md). The [original audit is archived](history/agent-design-review-before-concurrency.md); its fixed findings are historical.

## Current execution model

The Principal produces a validated plan of **2–8 tasks**. IDs, ownership, dependencies and cycles are checked before execution. Every plan includes canonical design work and a final Critic review that transitively depends on **every other task**, including visual studies and preliminary reviews. A first design requires architecture and interior tasks, with interior work depending transitively on architecture.

| Task kind | Owner | Persistent output |
| --- | --- | --- |
| `architecture` | Architect | Complete design proposal against an identified base revision |
| `interior` | Designer | Complete proposal limited to owned materials, finishes, furniture and lights |
| `visual_direction` | Designer | Recommendations and coordination messages; no canonical mutation |
| `review` | Critic | Findings and summary for the supplied brief, instruction, design and dependencies |

Ready tasks execute in batches of at most **two different specialists**, with one task per specialist at a time. Each batch reads the same immutable base revision. A new-house plan can develop architecture and visual direction together, then furnish the resulting shell. An existing-design plan can develop independent structural and finish proposals in the same batch. A finishes-only request can use Designer and Critic tasks without an Architect task.

This is bounded dependency scheduling. The plan determines which work may overlap; the scheduler waits for the current batch to settle before integrating its results and starting another batch. See [team.ts](../worker/src/team.ts) and [collaboration.ts](../shared/collaboration.ts).

## Canonical publication and coordination

Workstation files and task outputs are proposals. The project’s canonical design is published through immutable revision objects and the coordinator; the Three.js viewer reads the accepted project snapshot. A task does not own the live scene.

For each proposal, the coordinator merges **base → current → proposed** values by stable material, space and element IDs, then validates the complete result. Disjoint field changes survive, including an Architect’s roof geometry and a Designer’s roof material. Identical changes are compatible. Competing values, deletion-versus-edit, invalid combined references and other incompatible results produce explicit conflict paths.

Designer enforcement protects metadata, notes, spaces, floors, spawn and structural element fields other than `materialId`. The Designer may change materials and add, edit or remove furniture and light elements. The Architect establishes a first design; Principal and Critic tasks cannot publish geometry. See [merge and ownership checks](../shared/collaboration.ts) and [coordinator.ts](../worker/src/coordinator.ts).

A publication conflict creates a saved Principal decision and **one targeted retry** of the affected task against the decision’s current design base. It does not restart successful sibling work. If that retry still conflicts, the run stops with saved work available for review.

If any task execution in a batch fails, all sibling executions settle and none of that batch’s proposals are published. Publication itself proceeds serially: a later integration failure can leave an earlier successful commit saved. Completed revisions remain available in both cases.

Saved dependency results reach downstream tasks. Workstation agents can use `report_coordination` to record a concrete handoff or cross-domain issue; successful notes appear in activity and the saved result supplied downstream. Visual-direction tasks use their structured coordination field. These notes do not independently launch another task or expand field ownership. The Principal coordinates through the plan and the bounded conflict/review decisions. See [ai.ts](../worker/src/ai.ts).

The final review can trigger **one correction plan**, followed by another final review. Empty final findings permit `ready`; remaining findings after the correction allowance leave the project in `review`. This correction loop exists, but its review schema is not yet an evidence-completeness gate.

## Persistence, visibility and resource bounds

Plans, proposals, reviews, visual directions, conflict decisions and workstation checkpoints are persistent artifacts. Task rows record their owner, kind, objective, prerequisites, deliverables, base revision and output references. Activity’s [TaskBoard](../components/TaskBoard.tsx) shows real task metadata, dependency waiting, computer waiting and completed work. Commit events identify the publishing specialist. Snapshots include recent runs, which keep Stop work available during queued work. See [store.ts](../worker/src/store.ts) and [Studio.tsx](../components/Studio.tsx).

Snapshots also expose complete structured change history. Activity's [ChangeTracker](../components/ChangeTracker.tsx) shows **Queued → Working → Applied → Reviewed** from persisted milestone timestamps, rather than inferring progress from the latest event. Each request retains its scope, revision references, review findings and failure details. Review with findings needs attention; reaching “Applied” is not proof of a clean review. A stopped or failed run retains evidence of milestones already reached. See [change lifecycle](../worker/src/changes.ts) and [0006_change_tracking.sql](../worker/migrations/0006_change_tracking.sql).

Replay uses durable steps and saved plans, task results and conflict resolutions. Indexed runtime task identities keep model-supplied names separate from retry identities. Within `runTeam`, cancellation fences prevent stopped runs from reviving graph-task statuses or publishing canonical revisions. Final readiness has a run/revision fence, and workstation release is scoped to the stopped run. Principal brief saves and clarification continuation also check the authoritative run state. Dispatch reconciliation exposes failed requests instead of treating failed workflow creation as successful work. See [workflow.ts](../worker/src/workflow.ts), [team.ts](../worker/src/team.ts), [steering.ts](../worker/src/steering.ts) and [index.ts](../worker/src/index.ts).

Computer caps remain unchanged: two global desktops, 900 seconds per lease, 3,600 user seconds per day, and the configured global monthly allowance. Unused reserved time is refunded only after confirmed shutdown; uncertain or legacy usage retains its conservative charge. A deterministic single-element color patch needs no editing desktop, while its model review still uses the Critic workstation. Long work or retries can still exhaust the allowance. Image requests have a separate allowance and do not reserve desktops. See [budget limits](../shared/budget.ts), [budget accounting](../worker/src/budget.ts) and [desktop lifecycle](../worker/src/desktop.ts).

Specialist artifact saves through `store.artifact()` atomically check the shared 250 MB project allowance. Duplicate saves preserve the registered artifact, and rejected concurrent uploads remove their own unregistered object. The per-artifact limit remains 25 MB. Image and capture saves use a separate precheck path that still has a concurrent-cap gap. These controls do not establish the duration or cost of a live end-to-end demo.

## Effective requirements across future runs

The project exposes a structured requirements record containing the stored brief and ordered applied user amendments. Each amendment preserves its instruction, specialist/element scope, optional reference image, and applied revision/time. Each team run freezes that historical record in an `effective-requirements.json` artifact and supplies it alongside the persisted current instruction to Principal planning, specialists, visual-requirement analysis, conflict decisions, corrections and Critic review. Project and voice context expose the record as well. Requested image concepts receive the requirements and save them in artifact metadata. See [shared requirements](../shared/requirements.ts) and [run requirements](../worker/src/requirements.ts).

Later amendments supersede earlier wording only where their subject and scope overlap; the current instruction has priority within its scope. A red-exterior amendment therefore remains part of a later balcony task even when the original brief requested yellow. A selected-element amendment remains limited to that target. Unapplied queued, failed and cancelled requests are excluded, while a request that reached the applied milestone remains recorded if its run later fails or is stopped.

This closes the missing-history/context gap without creating an extracted semantic property map. The record preserves original client wording, scope and application evidence. Models still interpret overlapping natural-language requirements, and an applied amendment is not proof of complete compliance. Failed review, partial-work evidence and unknown geometry conditions must remain visible.

## Remaining work

### Conversation routing and clarification continuation

The normal text composer now routes messages through the shared conversation service: read-only questions, initial brief details, answers to pending questions, and explicit design changes. Read-only answers receive no computer tools and do not enqueue design tasks. Room and element selection supply context; only an explicit change reaches the existing steering queue.

A generation clarification persists versioned question IDs and leaves the run `awaiting_input`. Text question cards and the voice answer tool save partial answers without losing prior requirements. Once all questions are answered, a durable dispatch record starts one linked continuation of the requested generation. Initial work still starts through the project controls or an explicitly confirmed voice meeting. Stale answers, cancelled briefings and replaced briefs cannot revive old work. Conversation replies and accepted answers survive refreshes. Apply [migration 0007](../worker/migrations/0007_conversations.sql) before using this Worker. See [conversation.ts](../worker/src/conversation.ts), [clarifications.ts](../worker/src/clarifications.ts) and [ClarificationCard.tsx](../components/ClarificationCard.tsx).

### Required geometry evidence

[reviewDesign()](../shared/design.ts) checks a small set of omissions and narrow spaces. It does not establish supported spawn, room reachability, actual door openings, enclosure, stair headroom or image-to-model correspondence. The final review still returns string findings and a summary, without mandatory evidence coverage, severity, affected IDs or an explicit unknown verdict.

The walking controllers check real collision and floor support for navigation, but those runtime checks are not automatically used as a generation acceptance gate. Add revision-bound deterministic geometry checks and a small structured review contract. The existing correction loop can then act on supported failures and missing evidence. See [first-person.ts](../shared/first-person.ts), [navigation.ts](../shared/navigation.ts) and [team.ts](../worker/src/team.ts).

### Workstation views and presentation

The standard workstation opens a room table and JSON source. Its automatic screenshot shows that interface; it does not automatically provide floor plans, elevations, a stair section or a building viewport. Agents have real tools, but a source-table screenshot cannot substantiate an observed assembly review. Blender compilation and presentation rendering remain a separate requested workflow. See [desktop.ts](../worker/src/desktop.ts) and [workflow.ts](../worker/src/workflow.ts).

The Presentation room still contains a fixed exhibit. The accepted building is explorable through **Design → Walk inside** or **Click to walk**; entering the office’s Presentation room does not yet open that design. Connect a revision-aware exhibit and an in-world walkthrough entry to complete the spatial handoff. Spline scenes and imported assets also need explicit viewer and collider integration; the local Blender/Spline authoring tools do not provide this automatically.

### Smaller state and schema gaps

- Principal brief saves and clarification creation now check the active run. Cancelling a pending briefing also fences its linked continuation, including dispatch retries. Live cancellation and reconnect behavior still belongs in deployment acceptance.
- Image and browser-capture storage check the project allowance before insertion, without an atomic SQL capacity condition. Concurrent saves can therefore exceed the shared cap even though specialist artifact admission is atomic.
- Decisions remain exposed through events/artifacts rather than a complete dedicated decision-history view. Changes now have full structured snapshot history and their own tracker.
- Semantic target selection still relies on planning a proposal. A typed set of affected IDs and scoped change operations would make multi-element steering more explicit.
- `recolor()` prefixes an element ID with `custom_`; a permitted 80-character element ID therefore exceeds the material ID length bound. A bounded collision-safe identifier remains needed for that edge case.

## Geometry contract

The application schema supports 1–4 floors, up to 40 spaces and 1,200 elements, basic materials, yaw-rotated boxes and procedural stairs. Door/window elements do not subtract openings from walls. `asset` elements currently remain boxes, and the browser’s light elements do not provide an independently authored lighting rig. The Worker’s Blender compiler uses the same elementary geometry and adds its presentation lighting.

Project-specific local Blender/Spline scripts may interpret extra authoring metadata. Those extensions are not part of the application’s validated geometry or its walkable scene. Any general extension needs coordinated schema, browser, export, validation and navigation changes. See [geometry.ts](../shared/geometry.ts), [blender_compile.py](../scripts/blender_compile.py), [Blender tooling](blender-mcp.md) and [walkthrough requirements](walkthrough.md).

## Verification and next checks

Relevant automated suites are:

- [collaboration.test.ts](../tests/collaboration.test.ts): graph validity, readiness, merge conflicts and ownership.
- [image-workflow.test.ts](../tests/image-workflow.test.ts): concurrent execution, shared references, dependencies, conflict retries, review corrections, replay and cancellation with mocked paid services and real D1/R2 storage.
- [backend.test.ts](../tests/backend.test.ts), [desktop-budget.test.ts](../tests/desktop-budget.test.ts) and [artifact-storage.test.ts](../tests/artifact-storage.test.ts): revision/cancellation fences, resource accounting and concurrent storage admission.
- [agent-tools.test.ts](../tests/agent-tools.test.ts): recorded coordination messages and tool argument validation.
- [change-tracking.test.ts](../tests/change-tracking.test.ts) and [change-tracker.test.ts](../tests/change-tracker.test.ts): saved change milestones, history and rendered tracker states, with mocked provider calls where execution is involved.
- [first-person.test.ts](../tests/first-person.test.ts) and [navigation.test.ts](../tests/navigation.test.ts): actual Rapier movement and geometry-based click navigation.

Run `npm test` and `npm run typecheck` for the repository’s current checks. Automated storage, scheduling and physics coverage does not verify live provider availability, architectural quality, complete evidence capture or the final Presentation-room experience.

The next product priorities are live acceptance of the shared conversation path, an evidence-backed geometry review contract, and the workstation-to-presentation handoff. A paid demo should measure generation, repeated scoped steering against the saved requirements record, review and optional rendering within the unchanged allowances. Mocked execution tests can verify persistence and context propagation; they do not establish that live models consistently preserve every prior requirement.
