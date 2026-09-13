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

For deployment, apply `0003_image_studies.sql` through the normal D1 migration command, configure the server secret and enable the image flag in the target environment. Image generation itself does not enable 3D generation or Blender rendering.

The documented model IDs are Flare and Sunburst, including dated `-2026-09-08` snapshots. There is no configured bare `gpt-image-2.5` alias. [Flare model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare), [Sunburst model](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst).

## Agent workflow and persistence

The four-agent team remains unchanged. The Designer's image tool produces one medium-quality 1536 × 1024 PNG per request. The first design run automatically creates one concept after the Principal prepares the brief, if image generation is enabled and no current concept is selected. Later ordinary steering does not regenerate images automatically.

The selected artifact is frozen for the run and supplied as actual `input_image` content to the Architect, Designer and Critic. The Architect translates feasible visual intent into the canonical design. The Designer interprets finishes while the existing structural-preservation check protects the shell. The Critic receives the same visual reference and the current change instruction, with explicit guidance to distinguish visual correspondence from model correctness.

`project/design.json` remains authoritative. Generating, editing or selecting an image alone does not modify geometry, revision or design-review status. Applying a direction to an existing model uses the persistent change-request queue. The image's original revision is retained; a queued visual change fails with a refresh explanation if the design advances before it starts.

New persistence includes:

- `image_studies`: saved image, model, source revision/reference, and companion metadata artifact.
- PNG and JSON artifacts in authenticated R2 storage, with immutable object paths.
- Metadata: source brief snapshot, raw direction, full provider prompt, model, quality, size, usage, revised prompt, source artifact, revision and timestamp.
- `image_attempts`: one reserved provider attempt per run stage; a separate allowance of 12 requests per account per UTC day, including failed or interrupted attempts.
- Project selection and per-run/per-change reference IDs; selection events and an initial Principal decision.
- Real image-tool task and progress events. Image runs have no E2B leases or desktop cleanup.

## Failure handling and limits

Image output and metadata publish together only while the run is active and its source revision is still current. Cancelled or stale output cannot become a new successful study. Completed work is reusable without another provider request. Provider and workflow retries are disabled for image generation, and a reservation prevents automatic reissue after an ambiguous interruption. An interrupted provider request can still have incurred usage; an explicit new request is required to retry.

References must be saved PNG artifacts from the same project and current source revision. Browser captures are bounded to 8 MB, and provider/reference images to 12 MB, with PNG-header and dimension checks. Project artifacts share the existing 250 MB allowance. Large design data is summarized for image prompting; requests beyond the prompt limit fail before a paid call.

The UI refuses to capture the office, sample design or previous revision. Captures retain revision, dimensions and a user-supplied viewport label. They include the current cutaway appearance; full camera transforms and cutaway metadata are not yet persisted. Earlier concepts remain viewable as history, but the current UI requires a fresh image to edit or apply against a newer revision.

The API returns base64 image data; the Worker saves it before returning artifact identity. No client key, arbitrary remote reference URL, desktop credential or ephemeral provider image URL is exposed. [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation).

## Creative boundary

The current canonical schema and both renderers support positioned boxes with yaw rotation, simple materials, four floors and forty spaces, plus procedural stairs. They do not yet reconstruct arbitrary 3D geometry from images or support curved forms, pitched/folded roof primitives, image textures or UV mapping.

Concept prompts therefore emphasize expressive but translatable courtyards, setbacks, stepped masses, terraces and material colors. The model may approximate image features, and the agents must disclose material omissions. Generated imagery is visual exploration, never evidence of actual enclosure, accessibility, dimensions or buildability.

A future geometry extension must update the schema, Three.js and Blender compilers, exports and navigation together. Image textures additionally need validated asset references and UV mapping. The Designer's board currently lives in Files; placing it on an interactive board inside the 3D office is a separate UI refinement.
