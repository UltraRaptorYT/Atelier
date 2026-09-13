# GPT Image 2.5 in Atelier

Implemented 2026-09-13. Provider requests are tested with mocks; account access and image quality still require a live check after a key is configured.

## Setup and use

1. Apply migrations with `npm run db:local` (or `npm run setup:local` for a new checkout).
2. Add `OPENAI_API_KEY` to `worker/.dev.vars.local`, preserving existing values. Restart the Worker. A personal key saved in Settings takes precedence.
3. Create a project, open **Files → Visual concepts**, enter a creative direction, and generate a concept. Image work runs independently of E2B and `GENERATION_ENABLED`.
4. Choose **Use this direction** before the first design run. Once a model exists, the same action queues an explicit model change and requires design generation plus E2B.
5. To explore finishes, open the current model, position the camera, and choose **Edit current model view**. Alternatively edit a generated image from the current revision. Review the resulting image before applying it.

Configuration lives in `worker/wrangler.jsonc` and can be overridden by local Worker variables:

| Variable | Default |
| --- | --- |
| `IMAGE_GENERATION_ENABLED` | `true` locally; `false` in staging/production |
| `OPENAI_IMAGE_CONCEPT_MODEL` | `gpt-image-2.5-flare` |
| `OPENAI_IMAGE_EDIT_MODEL` | `gpt-image-2.5-sunburst` |

For deployment, apply pending D1 migrations through the normal migration command, including `0003_image_studies.sql` for image state and `0004_task_dependencies.sql` for the current team workflow. Configure the server secret and enable the image flag in the target environment. Image generation itself does not enable 3D generation or Blender rendering.

The documented model IDs are Flare and Sunburst, including dated `-2026-09-08` snapshots. There is no configured bare `gpt-image-2.5` alias. [Flare model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare), [Sunburst model](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst).

## Agent workflow and persistence

The four primary roles remain Principal, Architect, Designer and Critic. The image-study workflow is attributed to the Designer and produces one medium-quality 1536 × 1024 PNG per request. The first design run automatically creates one concept after the Principal prepares the brief, if image generation is enabled and no current concept is selected. Later ordinary steering does not regenerate images automatically.

Design work follows the [Principal's dependency graph](concurrent-agents.md). Plans contain 2–8 tasks, with up to two different specialists executing together. A new house can develop architecture and a visual-direction specification in parallel, then apply the specification to its committed shell. For an existing model, the Principal selects only the needed owners: a finish-focused image change can use Designer and Critic tasks, while a structural change needs the Architect. Selecting an image does not impose a fixed Architect → Designer → Critic sequence.

The selected artifact is frozen for the run and supplied as actual `input_image` content to every model-backed specialist task that is dispatched, including visual direction, design proposals, reviews, a conflict retry or the bounded correction round. The Principal's planning/decision calls receive their supplied project context; they are not described as having inspected an image unless that evidence was actually supplied. Dependent tasks also receive saved outputs and coordination notes from their prerequisites.

Each parallel batch reads one immutable canonical revision. The coordinator merges compatible proposals by stable IDs and fields before publication. The Designer may change materials, assignments, furniture and lights while preserving metadata, notes, spaces, floors, spawn and structural geometry. Overlapping changes require a saved Principal decision and one targeted task retry. The final Critic reviews the combined design, the same frozen reference and the accepted instruction, distinguishing visual correspondence from model correctness. Findings can trigger one correction plan and a further review; unresolved findings leave the model in `review`.

`project/design.json` remains authoritative. Generating, editing or selecting an image alone does not modify geometry, revision or design-review status. Applying a direction to an existing model uses the persistent change-request queue. The image's original revision is retained; a queued visual change fails with a refresh explanation if the design advances before it starts.

New persistence includes:

- `image_studies`: saved image, model, source revision/reference, and companion metadata artifact.
- PNG and JSON artifacts in authenticated R2 storage, with immutable object paths.
- Metadata: source brief snapshot, raw direction, full provider prompt, model, quality, size, usage, revised prompt, source artifact, revision and timestamp.
- `image_attempts`: one reserved provider attempt per run stage; a separate allowance of 12 requests per account per UTC day, including failed or interrupted attempts.
- Project selection and per-run/per-change reference IDs; selection events and an initial Principal decision.
- Real image-tool task and progress events. Image runs have no E2B leases or desktop cleanup.
- The specialist plan, dependency links, proposal bases, output references and coordination notes used when a visual direction is translated into the editable model. Activity shows this real task state.

## Failure handling and limits

Image output and metadata publish together only while the run is active and its source revision is still current. Cancelled or stale output cannot become a new successful study. Completed work is reusable without another provider request. Provider and workflow retries are disabled for image generation, and a reservation prevents automatic reissue after an ambiguous interruption. An interrupted provider request can still have incurred usage; an explicit new request is required to retry.

References must be saved PNG artifacts from the same project and current source revision. Browser captures are bounded to 8 MB, and provider/reference images to 12 MB, with PNG-header and dimension checks. Project artifacts share the existing 250 MB allowance. Specialist artifact admission is checked atomically, but image and capture inserts still rely on a precheck and can exceed that cap under concurrent saves. Large design data is summarized for image prompting; requests beyond the prompt limit fail before a paid call.

The UI refuses to capture the office, sample design or previous revision. Captures retain a fixed purpose, revision and dimensions. They include the current cutaway appearance; full camera transforms and cutaway metadata are not yet persisted. Earlier concepts remain viewable as history, but the current UI requires a fresh image to edit or apply against a newer revision.

The API returns base64 image data; the Worker saves it before returning artifact identity. No client key, arbitrary remote reference URL, desktop credential or ephemeral provider image URL is exposed. [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation).

The [image-workflow tests](../tests/image-workflow.test.ts) exercise frozen references across concurrent tasks, dependency handoffs, conflict retry and review correction using mocked paid providers and real D1/R2 storage. [Image storage tests](../tests/images.test.ts) cover image-specific persistence, limits and cancellation. This documentation update did not rerun live image or workstation generation.

## Creative boundary

The current canonical schema and both renderers support positioned boxes with yaw rotation, simple materials, four floors and forty spaces, plus procedural stairs. They do not yet reconstruct arbitrary 3D geometry from images or support curved forms, pitched/folded roof primitives, image textures or UV mapping.

Concept prompts therefore emphasize expressive but translatable courtyards, setbacks, stepped masses, terraces and material colors. The model may approximate image features, and the agents must disclose material omissions. Generated imagery is visual exploration, never evidence of actual enclosure, accessibility, dimensions or buildability.

A future geometry extension must update the schema, Three.js and Blender compilers, exports and navigation together. Image textures additionally need validated asset references and UV mapping. The Designer's board currently lives in Files; placing it on an interactive board inside the 3D office is a separate UI refinement.
