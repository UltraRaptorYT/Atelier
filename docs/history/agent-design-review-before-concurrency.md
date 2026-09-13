# Historical agent review: before concurrent orchestration

> **Historical snapshot — not the current implementation or an open-issues checklist.**
> This preserves the original 2026-09-13 audit of the earlier fixed specialist sequence. Several findings, including reservation accounting, dynamic delegation, correction planning, dispatch recovery and cancellation handling, have since been addressed. The old source anchors describe that earlier snapshot.
> Read the [current agent workflow readiness review](../agent-design-review.md) and [current collaboration contract](../concurrent-agents.md) for present behavior.

The numbered findings below are retained for engineering history. Transitional implementation-update notices from the former document were omitted so this archive remains clearly separated from the current review.

## Feasibility

The four-role design is reasonable for a hackathon MVP. Principal → Architect → Interior Designer → Critic is a useful division of responsibility, and a serialized workflow is a sensible way to avoid competing scene edits. Cloudflare Workflows, D1 project state, immutable R2 design revisions, real E2B tools, and a JSON-to-Three.js compiler already form a credible foundation.

The current implementation is a fixed sequence of specialist invocations, rather than a Principal that dynamically manages a task graph. That is an acceptable MVP simplification if the interface describes it accurately. It does not need more agents to become useful. It needs a reliable brief → generation → steering → review → presentation loop.

The complete advertised loop is not yet reliable: the default computer allowance cannot cover initial generation followed by even the smallest reviewed color change, ordinary typed questions start mutation workflows, accepted changes are absent from the critic's effective requirements, and review findings never cause an automatic correction.

## What is already solid

- **One authoritative design.** Workstation files are proposals; the coordinator validates and publishes an immutable object, revision record, project pointer, and event. Stale proposals and cancelled-run commits are fenced. See [coordinator.ts:110](../../worker/src/coordinator.ts#L110) and the concurrency/cancellation integration checks in [backend.test.ts:61](../../tests/backend.test.ts#L61).
- **Real execution and persistent outputs.** Specialists can read files, execute bounded Python, and inspect an actual remote desktop. Design snapshots, reviews, and render outputs are saved. See [ai.ts:12](../../worker/src/ai.ts#L12), [desktop.ts:39](../../worker/src/desktop.ts#L39), and [store.ts:27](../../worker/src/store.ts#L27).
- **Useful role separation.** The Designer's candidate is checked against the existing structure before commit, and the Critic returns findings rather than committing geometry. See [workflow.ts:109](../../worker/src/workflow.ts#L109).
- **Prompt adaptation is active.** [prompts.ts:1](../../worker/src/prompts.ts#L1) loads the repository's active Markdown prompts. [shared.md:12](../../prompts/shared.md#L12) explicitly requires the supplied runtime schema, treats tool outputs as data, distinguishes proposals from commits, and rejects invented tool activity. These are useful safeguards against the older reference material's broader assumptions.

## Prioritized findings

P1 means a correctness issue or blocker in the normal demo path. P2 means an important refinement to meet the intended experience.

### 1. P1 — The daily computer allowance prevents generation followed by reviewed steering

**Trigger:** From a fresh daily allowance, generate a design, then change one existing element's color.

[shared/budget.ts:1](../../shared/budget.ts#L1) allows 3,600 reserved seconds per user per day. Every specialist workstation reserves 900 seconds in [desktop.ts:21](../../worker/src/desktop.ts#L21). Reservations remain charged after release because [budget.ts:16](../../worker/src/budget.ts#L16) sums every lease for the day, while release only changes its status.

Initial generation allocates Architect, Designer, and Critic workstations. A single-element recolor allocates another Designer workstation and another Critic workstation. See [workflow.ts:84](../../worker/src/workflow.ts#L84), [workflow.ts:104](../../worker/src/workflow.ts#L104), and [workflow.ts:119](../../worker/src/workflow.ts#L119).

| Stage | Reserved seconds after admission | Result |
| --- | ---: | --- |
| Generate: Architect | 900 | Admitted |
| Generate: Designer | 1,800 | Admitted |
| Generate: Critic | 2,700 | Admitted |
| Recolor: Designer | 3,600 | Admitted |
| Recolor: Critic | 3,600 | Rejected: daily allowance reached |

This result was reproduced by executing the actual `admission()` helper with zero active machines between stages. Fast completion does not help. The recolor may commit, but the run then fails before review. Recoloring an entire exterior follows the more expensive global route.

**Refinement:** Make the target demo fit a deliberate end-to-end budget. A deterministic material patch need not allocate a fresh computer; reuse a bounded project workstation where safe, or reconcile reserved usage against actual usage while retaining an upper spending bound. Adjusting the limit alone should use the measured total for generation, steering, review, and final render. Add a workflow-level test for that complete sequence.

### 2. P1 — Typed questions and clarification answers are treated as design changes

**Trigger:** Ask the Critic “Why is this roof sloped?” or answer a Principal clarification in the normal message composer.

The composer always posts a change request in [Studio.tsx:69](../../components/Studio.tsx#L69), and `/messages` always calls `queueChange` in [index.ts:108](../../worker/src/index.ts#L108). There is no read-only conversational intent. The routing prompt treats everything except a one-element color edit as global, leading to an Architect design proposal.

When generation produces questions, [workflow.ts:70](../../worker/src/workflow.ts#L70) completes the run and leaves a blocked Principal task. A normal typed answer creates a separate change run; it does not merge the answer into the brief or resume the clarification state. Manually editing the complete brief and starting generation again is available, but is a different interaction.

**Impact:** A question can allocate computers and alter the design. A clarification answer has no explicit relationship to the outstanding question.

**Refinement:** Introduce a shared text/voice intent boundary: `ask`, `answer_clarification`, `change`, and `start_work`. Read-only questions should use a current project snapshot. Clarification answers should update an identified question and effective brief, then resume the dependent work. Neither path should silently become a redesign.

### 3. P1 — Accepted steering is not included in the critic's effective requirements

**Trigger:** The brief says “yellow exterior”; the user later requests red.

The change run keeps the original brief in [workflow.ts:62](../../worker/src/workflow.ts#L62). Architect and Designer prompts receive the current instruction, but the Critic receives only the original brief and resulting design in [workflow.ts:124](../../worker/src/workflow.ts#L124). The accepted change is persisted in `changes`, but the workflow never builds an effective requirements state from that history. Later generation also prepares its brief from the original request.

**Impact:** The Critic is asked to evaluate red against an obsolete yellow requirement. Later work lacks an authoritative record that red supersedes yellow; preserving the current color is left to inference from the scene and general preservation instructions.

**Refinement:** Preserve the original request, and separately maintain versioned effective requirements with accepted amendments and superseded values. Pass the same effective brief, relevant changes, and design revision to every specialist and review. Record which change a review verifies. This is a state-model change, not a prompt-only fix.

### 4. P1 — A failed workflow dispatch can strand a change indefinitely

**Trigger:** A pending change reaches `begin()`, but `JOBS.create()` fails transiently.

[coordinator.ts:139](../../worker/src/coordinator.ts#L139) marks the inserted run `failed` and returns an error; the change remains `pending`. On a later alarm retry, [coordinator.ts:131](../../worker/src/coordinator.ts#L131) treats any existing run ID as an idempotent success, including that failed, never-started run. [steering.ts:24](../../worker/src/steering.ts#L24) then changes the pending request to `in_progress`, without launching another workflow.

**Impact:** A saved user instruction can appear to be running forever, with no job capable of completing it.

**Refinement:** Make dispatch recovery status-aware. Distinguish an inserted run from a successfully dispatched workflow; reconcile the workflow instance before declaring success. Retry an undispatched operation safely or expose an explicit failed/retryable change. Add fault-injection coverage for a failed first `JOBS.create()` and a subsequent alarm retry.

### 5. P1 — “Ready” lacks an evidence gate, and findings do not trigger corrections

**Trigger:** A generated model contains a disconnected entrance, unusable spawn, inaccessible room, or broken stair junction.

[reviewDesign():78](../../shared/design.ts#L78) only checks whether any door, window, or staircase exists, plus very narrow spaces. It does not verify connectivity, opening placement, enclosure, floor support, stair headroom, or spawn safety. Executing the helper on the sample with its door moved to `[400, 1, 400]` and spawn moved to `[400, 40, 400]` produced a schema-valid design and **zero deterministic findings**. This demonstrates missing validation, not that the model reviewer would necessarily overlook the problem.

The review schema is only `{ findings: string[], summary: string }`, and [workflow.ts:125](../../worker/src/workflow.ts#L125) chooses `ready` whenever the combined findings array is empty. There is no required evidence coverage or structured `unknown`/blocking verdict. If findings do exist, the workflow saves them, sets `review`, and completes; it never calls the Principal again to assign a bounded correction. Interior detail also happens before this review.

**Impact:** Completion depends on a model choosing to mention every missing check. Detected defects become reports for the user to act on, rather than work the team resolves internally.

**Refinement:** Introduce a small, enforceable concept review contract: checked revision, severity, affected IDs, evidence, acceptance condition, and `pass`/`revise`/`needs_evidence`. Add deterministic supported-spawn and reachable-route checks first, then key stair/opening/enclosure checks. Run a shell gate before detailed interiors. Give the Principal one bounded correction pass, followed by review of affected checks. Preserve useful previews while clearly recording unresolved blockers.

### 6. P2 — Local steering is narrower than the demo, and the selected specialist does not control routing

**Trigger:** In the Designer room, request “Make the exterior red” when the exterior contains several wall elements, or “Move this sofa slightly left.”

[workflow.ts:78](../../worker/src/workflow.ts#L78) defines local as color-only on exactly one existing element. All other requests involve a Principal meeting, a complete Architect design response, and a complete Designer response. [workflow.ts:84](../../worker/src/workflow.ts#L84) chooses Designer or Architect from this binary rule; the selected `p.agent` does not determine the worker performing the edit. Unrelated architecture is protected by prompting for global changes, not by a patch scope check.

**Impact:** A routine material or furniture edit becomes a broad, expensive workflow. The office specialist selection mostly changes attribution. The default whole-exterior yellow-to-red demo does not use the precise local path unless the exterior is represented by one element.

**Refinement:** Resolve semantic selections to explicit affected IDs. Let Designer-owned changes cover finishes, furniture, and lights, including multiple elements, using validated operations. Let Architect own bounded geometry operations. Escalate changes based on domain/dependency impact. Enforce unchanged fields and accepted scope at commit; keep full-model replacement for initial generation or explicitly broad redesigns.

### 7. P2 — The automatic workstation checkpoint shows JSON, not the generated building

**Trigger:** Open a normal generation/review workstation or inspect its automatically saved desktop preview.

[desktop.ts:33](../../worker/src/desktop.ts#L33) opens an HTML room table and JSON source. [desktop.ts:39](../../worker/src/desktop.ts#L39) screenshots that desktop. The model has tools that could generate other evidence, but the normal pipeline does not automatically compile and provide floor plans, elevations, or a stair section before the Critic reviews. Blender compilation/rendering is a separate requested render workflow in [workflow.ts:39](../../worker/src/workflow.ts#L39).

**Impact:** The execution is real, but the default visible evidence does not substantiate the visual review requested by the prompts. A screenshot of a JSON table is not evidence of building assembly.

**Refinement:** Serve a model viewport derived from the same canonical revision inside the workstation. Automatically capture a small relevant view set and store its revision and view type. Feed those images to the Critic. Use quick procedural renders or browser captures before allocating expensive presentation renders.

### 8. P2 — The Presentation room does not present the saved design

**Trigger:** Generate a model, then select or walk into the Presentation room.

The room's exhibit consists of fixed boxes in [World.tsx:67](../../components/World.tsx#L67). The `Office` component does not receive design data. The generated building is rendered only in the separate `model` mode at [World.tsx:169](../../components/World.tsx#L169). Room-strip navigation explicitly selects `office` mode in [Studio.tsx:92](../../components/Studio.tsx#L92).

**Impact:** The final building is explorable through the Design view, but the spatial interaction “enter the presentation room to inspect the result” is not connected.

**Refinement:** Put the current revision's scaled model on the presentation table and provide an in-world action to enter its full-scale walkthrough. Associate previous/current comparisons and the selected review with that exhibit.

### 9. P2 — Cancellation and observable state need a consistent run lifecycle

[index.ts:100](../../worker/src/index.ts#L100) cancels runs and tasks, then terminates the workflow, but does not cancel the associated `changes` row. A terminated workflow cannot be relied on to run its catch/finally handlers, so an in-progress change may stay in that state. The cancellation endpoint also releases every project desktop even when the requested run was already completed; a delayed cancellation for an old run can interfere with a newer run's workstations.

The snapshot in [store.ts:14](../../worker/src/store.ts#L14) omits runs, changes, and decisions. The UI infers active work from tasks; during a queued workstation wait after the Principal completes, it may show no active specialist and no Stop work button. In addition, every commit event is attributed to `architect` at [coordinator.ts:121](../../worker/src/coordinator.ts#L121), including Designer changes.

**Refinement:** Cancel a run and its active change atomically; release only workstations leased to that run. Return current run, queue state, change status, and decision references in the snapshot. Keep Stop work available for queued and running jobs. Pass the actual owner/task into commit events.

## Prompt refinements

The strongest parts of the prompts are the canonical-state rule, role ownership, short clarification policy, evidence discipline, and explicit warning against invented tool activity. Keep those.

The active instructions have already qualified older Draftroom concepts as optional when unsupported, so unavailable Spline APIs or an Analyst worker are not mandatory runtime dependencies. Nevertheless, the role documents still spend substantial space discussing Analyst handoffs, protected requirement records, concurrent reviews, and pre-detail gates that this runtime does not dispatch. See [director.md:16](../../prompts/agents/director.md#L16), [director.md:25](../../prompts/agents/director.md#L25), and [interior-designer.md:37](../../prompts/agents/interior-designer.md#L37).

Refine each active invocation around what it can actually accomplish: exact inputs, owned fields, available tools, deliverable schema, verification required, and supported escalation result. Retain richer architectural methods in reference guidance. Add runtime fields and behavior before asking models to maintain records that cannot be represented. Fix the small copied-text typo “Kai Chenpt” in [interior-designer.md:25](../../prompts/agents/interior-designer.md#L25).

Do not try to implement workflow gates, durable amendments, or patch ownership through longer instructions alone. The current prompts already ask for these behaviors; the missing enforcement belongs in schemas and orchestration.

## Geometry and model limits

The supported output is a useful conceptual massing and layout model: 1–4 floors, up to 40 spaces, materials, rectangular elements, Y-axis rotations, and procedural stairs. See [DesignSchema:23](../../shared/design.ts#L23) and [geometry.ts:4](../../shared/geometry.ts#L4).

Door/window boxes do not cut holes in walls. All non-stair elements compile to boxes; `assetId` is present in the schema but is not loaded by these geometry renderers. Lights are represented as boxes in the browser; Blender additionally creates fixed area lights. These limitations matter for the requested futuristic or character-inspired architecture: the agents can compose supported forms, but the schema does not yet support arbitrary meshes, curved forms, pitched rotations, material textures, or detailed controllable lighting.

Keep the MVP promise at conceptual architecture and incremental styling. Extend the geometry contract only when a demonstrated design needs it, and update browser rendering, Blender export, validation, and navigation together.

One smaller correctness issue: `recolor()` derives a material ID by prepending `custom_` to a permitted 80-character element ID. The resulting ID exceeds the same 80-character schema limit, so a valid design can reject a legitimate recolor. This was reproduced with the actual helper. Use a bounded collision-safe ID and test boundary-length IDs; see [design.ts:65](../../shared/design.ts#L65).

## Recommended implementation order

1. Make the fresh-project generation → whole-exterior recolor → review → optional render sequence fit the budget; add integration coverage with mocked paid services.
2. Unify text and voice intent handling, clarification resume, and effective requirement amendments. Keep accepted language and selected element/domain context.
3. Implement validated local changes and affected-scope checks. Repair dispatch retries and cancellation lifecycle in the same state path.
4. Add a small evidence-backed review gate and one bounded correction pass; make the real model visible on workstations.
5. Connect the Presentation room to the current canonical revision and its walkthrough.

The existing integration suite verifies owner isolation, revision races, cancellation commit fencing, and budget admission. Its Worker is configured with generation disabled, so it does not exercise live design/steering workflows; see [backend.test.ts:30](../../tests/backend.test.ts#L30). This audit ran the pure budget and geometry helpers described above and reviewed source paths. It did not run paid OpenAI/E2B generation or establish the latency, visual quality, or success rate of a live demo.
