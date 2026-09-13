# Generated model quality diagnosis

Investigation date: 2026-09-13. Compared the current application code, saved local
D1/R2 projects, saved application renders, and the locally authored Pikachu house.
This investigation did not start Chrome, Blender, new model requests, or remote
workstations. The findings below record the state before the subsequent fixes.

## Implementation update

A later check of the running local process found an additional mismatch: it
served `/tmp/atelier-demo-worker-v8/index.js` with `--no-bundle` and an explicit
`OPENAI_MODEL:gpt-5.6-terra` override, even though the repository configured Astra.
That bundle omitted `reasoning.effort` on design requests. The stale process was
replaced with the current source Worker on the same port and local data. Both
its health endpoint and the app proxy now report `gpt-6-astra` with design effort
`max`. This establishes the active local configuration; it does not prove which
model produced every historical saved project. The public Worker still needs
the current code/config deployment.

All design-team planning, authoring, review and conflict calls now explicitly use
the configured effort. Astra's highest documented API effort is `max`; `ultra`
is not a supported API value. Initial clarification/brief normalization keep the
existing API-default behavior and delegated voice stays at `low`.
Runtime fingerprints and per-run `generation-profile.json` records make future
model/prompt/compiler differences inspectable without exposing credentials.

The subsequent implementation adds validated 1 MiB file proposals, a small final
summary response contract, hash-bound proposal previews and submission in a later
model turn. Once the file is submitted, its validated receipt completes the task
without another paid summary call. Model, Python and preview work share a
twelve-minute time allowance inside the thirteen-minute task checkpoint; optional
workstation screenshots use a separate bounded checkpoint after result storage.
It adds reusable wall/opening, stair/void, roof/gable and rod helpers;
bounded canonical meshes with browser/Blender/navigation support; explicit
material opacity/transmission; and preservation of registered asset UVs and
materials unless an appearance override is requested. Canonical Critic evidence
now includes exterior views, ground/first-upper-floor plans and an interior view.
See [proposal service](../worker/src/proposals.ts),
[authoring guide](../prompts/proposal-guide.md) and
[geometry contract](../shared/design.ts).

These changes do not rebuild existing saved projects or establish that a live AI
run now matches the hand-refined local house. A controlled live comparison remains
necessary. Plans above the first upper floor, exhaustive interior views, automatic
circulation acceptance and a full authored lighting rig remain limitations.

Verification after the implementation: `npm test` passed all 479 tests across
37 files; `npm run typecheck` and `npm run build` passed. A headless local Blender
fixture built with the new helpers (115 elements, seven meshes, two floors)
produced five inspected previews and successful BLEND/GLB exports. The previews
matched the saved design hash/revision and showed complete pitched roofs/gables,
framed openings and a stair flight through its slab void. A separate real Blender
asset check preserved distinct materials and UVs, including explicit override
behavior. Camera framing, structural bevel seams and the plan/interior metadata
contract were corrected from those actual outputs. No paid AI/E2B run or Chrome
session was started for this verification.

The later runtime/UX update ran 562 tests across 44 files: 561 passed initially;
the remaining clarification test expected no artifacts before design work and
needed to account for the new diagnostic profile artifact. After correcting that
expectation, all 13 clarification tests passed. The final Next build, TypeScript
checks and whitespace checks passed. Local migration 0008 was applied, and both
local health and app-proxy capability checks confirmed Astra/max. No fresh paid
design run or production deployment was used to validate this update.

### Live Astra verification: stopped before delegation

The subsequently authorized local verification on 2026-09-13 preserved the full
original brief in project `49d90528-0ca7-4b8b-b08d-63ceef20bf4b`, run
`8403f4e6-e1bc-4f8d-b9f7-0bd36a8ccd29`. Its saved generation profile confirmed
`gpt-6-astra` and design effort `max`. The three specialists returned their
initial understanding concurrently. Principal brief normalization needed a
retry, then reached dependency planning. The run failed at 11:31:31 UTC before
any specialist tasks were created or geometry was saved; revision remained zero.
The Worker reported aborted OpenAI requests, and the planning phase lasted
approximately the configured 120-second request deadline. This is evidence of
a planning/deadline failure, not a completed model-quality comparison.

The scene also exposed a separate presentation defect: it derived meeting
attendance from the most recent meeting event without clearing a meeting when
its run failed. Thus everyone remained at the table even after work stopped.
Terminal run status and current tasks must govern the scene as well as the
activity panel.

The subsequent local fix scopes meeting attendance and task indicators to the
current run, closes meetings after failure/cancellation/completion, and displays
the failed briefing consistently in the panel and footer. The actual browser
check showed the empty meeting table, all agents at their desks and the explicit
failure state.

Bounded design requests now allow up to eight minutes, clipped to the same
twelve-minute task clock inside a thirteen-minute Workflow checkpoint. Interactive
questions keep their two-minute policy. Bounded design requests do not retry
automatically; Astra/max and the full brief are preserved. Trusted application
errors cross checkpoints as tagged results, preserving actionable timeout
messages without exposing provider errors. Historical successful checkpoints
remain readable, and cancellation takes precedence over a late timeout.
These changes passed focused SDK and Workflow regression tests; a successful
live generation is still required to assess output quality.

No workstation leases were created by this run. The temporary local allowance
was removed after confirming the terminal state and zero active leases; the
daily recorded workstation use remained 2,504 seconds. OpenAI requests did run;
their exact billed cost has not been retrieved. Local observation files are in
`/tmp/atelier-astra-e2e/` and are diagnostic records, not repository fixtures.

## Finding

The local authoring session and the application do not have equivalent modeling
capabilities or refinement loops. The application can coordinate work and persist
revisions, but its ordinary geometry representation and proposal submission path
favor coarse models. The saved Blender renders show the same geometry problems
as the browser; lighting alone does not explain the gap.

## Saved results inspected

| Result | Elements | Materials | Registered custom assets | Observation |
| --- | ---: | ---: | ---: | --- |
| Local `project/design.json`, Folded Light | 827 | 21 | 0 | Dedicated Blender extensions provide detailed shapes and materials. |
| App demo, Yellow Aperture House, revision 3 | 125 | 11 | 0 | Shorter/different brief; coarse model; final review was cancelled. |
| App, Pikachu House · original two-storey brief, revision 3 | 77 | 11 | 0 | The full 3,080-character original brief was saved, but the render still uses coarse rectangular masses and roof plates. |
| App, Cozy HDB, revision 3 | 40 | 10 | 0 | Generated while the saved request was still the spoken-brief placeholder. |
| App, A new HDB!, revision 4 | 77 | 12 | 0 | Actual HDB request saved; opening repairs completed, interior experience still unverified. |

Element count is evidence of different authoring granularity, not a quality
target. The original-brief app run is particularly useful: prompt length alone
cannot explain the difference from the local result.

Tracked evidence: [local project](../project/README.md),
[local street view](../project/output/street-perspective.png),
[saved demo](../demo-results/2026-09-13/README.md),
[demo Blender render](../demo-results/2026-09-13/08-direct-3d-render.png), and
[demo review before correction](../demo-results/2026-09-13/12-review-before-correction.json).
The additional app runs were inspected read-only in local D1 and R2; these local
records are not portable repository fixtures. Their project IDs are
`a3130a00-4ac3-4f58-973f-d5fbaae81a8a`,
`f1748ee0-0f35-4b69-a278-64ad78b0dcdd`, and
`b929b919-f36f-4edf-ba65-7cf9a782ef39`, respectively.

## 1. Local geometry cannot round-trip through the live schema

[Local authoring](../scripts/author_pikachu_house.py) uses reusable wall/opening
assemblies, custom roof meshes, rods, cylinders, ellipsoids, vegetation and
material metadata. [Its renderer](../scripts/render_pikachu_house.py) understands
the `blender` extensions. This difference is already noted in
[project/README.md](../project/README.md#editing-and-rebuilding).

[ElementSchema](../shared/design.ts) exposes kind, position, box dimensions, one
yaw rotation, material and optional asset ID. The ordinary
[browser geometry](../shared/geometry.ts) and
[Blender compiler](../scripts/blender_compile.py) use boxes, stair flights and
stock furniture. Registered GLB assets allow richer shapes, but none of the
inspected app designs used them.

A read-only `DesignSchema.safeParse` of the actual local file succeeded while
discarding all 827 per-element Blender extensions and the material/top-level
extensions. Of those elements, 278 have non-box shapes: 29 meshes, 175 rods,
18 ellipsoids, eight cylinders and 48 vegetation objects. For example, the folded
roof element `ph_0330` would become a solid 4.7 × 1.26 × 9 m box. This reproduces
an incompatible round-trip; it does **not** establish that the application
imported and damaged this particular file during generation.

There are additional semantic mismatches: local individual stair treads tagged
`stair` expand into full stair flights in the application, and opaque frame
components tagged `window` receive glass treatment. Simply accepting unknown
Blender fields would not provide rendering or collision support.

## 2. Tool-authored files are not the submitted proposal

[team.ts](../worker/src/team.ts) requires the initial architecture call to return
the complete `DesignSchema` as its final model response. Later edits return
explicit incremental JSON records. The returned proposal is then written back
to the workstation, and `python3 -m json.tool` checks its JSON syntax.

Consequently, writing a detailed file with Python does not itself submit that
file: all initial geometry still has to be repeated in the final response.
[ai.ts](../worker/src/ai.ts) allows 18,000 output tokens per response and at most
11 tool rounds. Local Python helpers can generate hundreds of components through
loops without serializing them in a final assistant response.

This creates pressure toward smaller proposals. There is no evidence that these
runs actually hit the output-token limit; incomplete responses fail rather than
silently truncate the design.

## 3. Visual feedback arrives late and covers too few views

Architecture and interior tasks have no automatic proposal-render/inspect/refine
cycle before completing. The normal workstation display shows a room table and
JSON, so taking its screenshot does not inspect the building.

The Critic does receive actual canonical front/rear renders in
[team.ts](../worker/src/team.ts), after proposals have been published. The saved
demo's tool events confirm this pattern: authoring used design reads and Python;
canonical previews were produced for review. The workflow permits one automatic
correction round.

The saved reviews found specific defects: openings overlapping walls, missing
headers/sills, a stair intersecting its landing/slab, and missing interior/plan
evidence. The original-brief Pikachu run and latest HDB run still requested plans,
cutaways or interior views after the final review, while the automatic evidence
path continued to supply only exterior views. Repairing defects and refining
design quality need task-appropriate visual feedback.

## 4. A saved run started without its actual brief

The `Cozy HDB` project's saved request was literally
`Awaiting your spoken project brief.` Its model was titled
`Compact Courtyard-Free Starter House`, consistent with generic house generation.

The current working tree already contains
[hasMeaningfulBrief](../shared/brief-validation.ts), a generation guard in
[coordinator.ts](../worker/src/coordinator.ts), and start-only conversation
handling in [conversation.ts](../worker/src/conversation.ts). Those changes
address the placeholder-start path; they do not repair the existing model.
This investigation did not modify or re-test those concurrent changes.

## 5. Materials and presentation amplify the difference

The local renderer adds procedural textures, authored lighting and curated
views. The application has simpler materials and generic lighting. Its custom
asset path also loses detail: [blender_asset.py](../scripts/blender_asset.py)
rebuilds a single mesh without preserving the original material assignments/UVs,
while [World.tsx](../components/World.tsx) and the Blender compiler replace
imported mesh materials with one canonical material.

The local views use 1600 × 1100 at 48 samples; application critic previews use
640 × 480 at eight samples. Better lighting and sampling can improve presentation,
but cannot reconstruct missing roof shapes, wall assemblies or furniture detail.

## Implementation priorities

1. Submit validated candidate files from the workstation for complete designs
   and incremental edits. Keep ownership checks, asset validation, revision
   conflict handling and canonical publication intact; return a small receipt
   instead of repeating the entire scene in the final model response.
2. Provide reusable construction helpers for walls with hosted openings, slabs
   with stair voids, stairs/landings and pitched roofs. Add supported shapes to
   the canonical contract with browser, Blender, export and collision parity.
3. Give Architect and Designer a bounded proposal-render tool returning actual
   images before completion. Choose floor plans, sections and interior views
   when the task requires them, and pass those findings into targeted repairs.
   Independent specialist tasks can continue concurrently.
4. Preserve custom component material slots and UVs, with explicit editable
   overrides. Make transparency a material property rather than a window/door
   label side effect. Improve lighting after geometry is preserved.
5. Compare the same brief, actual runtime model, tool budget and views. The saved
   direct demo records `gpt-5.6-terra`; the current Wrangler file specifies
   `gpt-6-astra`, which does not establish what every running deployment used.
   Model choice may contribute, but this audit does not isolate that variable.

No evidence found that concurrency or Cloudflare itself explains the quality
gap. The strongest confirmed causes are the different geometry contract,
file-to-proposal disconnect and limited visual refinement path.
