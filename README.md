# Atelier

An AI architecture studio with four specialists, observable tool work, persistent design revisions and an explorable 3D office and building. The Principal plans tasks and dependencies; independent specialists can work concurrently. The Architect develops layout and structure, the Interior Designer handles materials, furniture and lighting, and the Critic reviews the combined result.

The canonical design is `project/design.json`. Three.js renders it in the browser; isolated E2B workstations compile Blender and GLB artifacts. Steering updates the existing project rather than creating an unrelated design.

The [collaboration guide](docs/concurrent-agents.md) explains concurrent tasks, proposal merging, coordination meetings and bounded correction rounds. Apply the new task-dependency migration with `npm run db:local` when updating an existing local checkout. Activity now shows the current task graph, dependencies and actual active specialists.

## Run the local preview

Install the locked dependencies and start Next.js:

```sh
npm ci
npm run dev
```

Open [127.0.0.1:3000](http://127.0.0.1:3000). The sample office/building can be explored without provider credentials. Sample geometry is illustrative; it does not represent live agent activity.

For local saved projects and backend routes, initialize local storage and start the Worker in another terminal:

```sh
npm run setup:local
npm run worker:dev
```

`setup:local` creates a local credential-encryption key in `worker/.dev.vars.local` only if that file does not exist, generates Worker types, and applies local database migrations. It does not supply external service credentials. The development frontend defaults to the Worker at `http://127.0.0.1:8787`. See [.env.local.example](.env.local.example) for frontend settings and [worker/.dev.vars.example](worker/.dev.vars.example) for Worker secrets; preserve existing local files when adding values.

## Explore and steer

- **Studio / Design** switches between the office and the current building.
- **Orbit** lets you drag to rotate and scroll to zoom.
- **Click to walk** shows a visitor in both views. Click/tap a clear floor to follow a path around obstacles; another click replaces the route. Drag to orbit, and press Escape to stop. Routes follow connected rendered slab/stair surfaces with enough clearance; unreachable targets display a message. Use Cutaway to expose interior floors.
- **Walk inside** explores at eye level using WASD and mouse look; Escape releases the mouse. The help dialog describes controls.
- Choose a room or specialist to inspect their task, send a contextual change, or open an available live workstation. Room controls select the workspace and reset the walking start; they do not automatically walk the visitor there.
- In the design view, select an element to give steering a precise target. **Cutaway** exposes the interior for inspection.
- **Files** provides canonical JSON, GLB export, floor plans, saved artifacts and comparison with the previous saved revision when available.

WASD and E interaction belong to **Walk inside**. Click walking stops for dialogs/workstations or when the window loses focus; click a new destination to continue. Geometry or cutaway changes reset its starting point safely. Routes allow steps up/down of at most 0.2 m, so a raised floor needs a connected step or staircase to reach lower ground.

Start with a brief such as “Design a futuristic Pokémon-inspired home for four people, with two floors, a generous living room and a yellow exterior.” Then select an exterior element and ask the Designer to make it red. The sample and your saved project are distinct; actual generation and steering require the live services below.

## Live services

The code contains a Cloudflare Worker backend with D1 metadata, R2 artifacts, Durable Object coordination and Workflow execution. Clerk provides deployed authentication. OpenAI calls use a personal key saved through Settings, falling back to the server's `OPENAI_API_KEY`. Agent desktops use E2B, and Blender rendering runs on those desktops.

### GPT-Live 1 voice input

After `npm run setup:local`, add `OPENAI_API_KEY=...` to **`worker/.dev.vars.local`**, preserving the existing encryption key. Restart `npm run worker:dev`. The Next.js root `.env.local` does not configure Worker secrets. For a deployed Worker, set the secret with `npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.jsonc --env staging` (or `production`) and enable `VOICE_ENABLED` for that environment. An environment key pays for users who have no personal key saved; removing a personal key restores that fallback.

Local voice is enabled independently of design generation. You can save a spoken brief and discuss a project while `GENERATION_ENABLED=false`; generating or applying changes still requires generation and E2B to be configured. Apply the database migrations when upgrading (`npm run db:local` locally).

Create a project (or choose **Use voice to brief**), select a specialist, and click **Live voice**. Allow the microphone on HTTPS or localhost. Select a model element before calling to include its context. Changing specialist, project or selected element ends the call; reconnect for the new context. End call stops the microphone; design work continues separately.

The browser exchanges SDP through the authenticated backend. GPT-Live 1 handles speech; a Responses backend routes brief details, project questions and change requests into the existing persisted project system. Server controls validate every action and revision, and the browser receives only voice status and transcripts. Calls close after 15 minutes. [Official WebRTC setup](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [GPT-Live delegation](https://developers.openai.com/api/docs/guides/live-delegation).

Provider access, real microphone/audio behavior and a full paid design run still need a live smoke test after the key is added. Protocol and persistence tests use mocked provider responses/local storage.

Generation and rendering are disabled in the checked-in [Worker configuration](worker/wrangler.jsonc). Configure the appropriate deployment's bindings, authentication, encryption secrets and E2B template before enabling its `GENERATION_ENABLED` and `RENDER_ENABLED` settings. `npm run desktop:build` builds the `atelier-desktop` template when `E2B_API_KEY` is supplied. Local previews do not establish that provider calls, desktop execution or rendering have been verified.

Current canonical schema limits are four floors, 40 spaces and 1,200 elements. [shared/design.ts](shared/design.ts) defines these limits and the brief/change contracts. Simple review helpers do not establish complete traversability, engineering or regulatory compliance.

## Image concepts and edits

Add `OPENAI_API_KEY` to `worker/.dev.vars.local`, apply `npm run db:local`, and restart the Worker. Local image generation is enabled by default and works without E2B. In a saved project, open **Files → Visual concepts** to generate a Flare concept, edit the current model view or a generated reference with Sunburst, and choose a direction. Applying an image direction to an existing model also requires the 3D generation/E2B setup.

The first design run creates one concept automatically when enabled and none is selected. The Architect, Designer and Critic receive the saved reference as an actual image input; canonical JSON still drives the walkthrough. Calls produce one medium-quality PNG, save provenance and usage, and have a separate allowance of 12 attempts per account per UTC day. See the [integration guide](docs/image-generation-integration.md) for flags, persistence, cancellation and current geometry limits. No paid image call has been run during implementation.

## Prompts and documentation

The [active prompt library](prompts/README.md) contains shared instructions and the five imported role files, adapted to Atelier's four active roles. Director maps to Principal; Analyst is reference-only. [worker/src/prompts.ts](worker/src/prompts.ts) composes the active Markdown into model instructions while keeping briefs and tool evidence as separate runtime input.

Five detailed hypothetical-site briefs are available for the [AI startup office](prompts/projects/01-ai-startup-office.md), [courtyard library](prompts/projects/02-courtyard-library.md), [Pikachu house](prompts/projects/03-pikachu-house.md), [waterfront cultural centre](prompts/projects/04-waterfront-culture.md) and [sky garden tower](prompts/projects/05-sky-garden-tower.md). Copy the brief text into the New project form. The 40-floor tower exceeds the current four-floor schema and needs an agreed smaller scope; its original requirements are preserved for future development.

The [Draftroom migration index](docs/draftroom/index.md) links the original vision, README, prompts, presentation direction, decisions and evidence. Historical Spline/Supabase architecture and test results remain clearly identified as Draftroom references. [AGENTS.md](AGENTS.md) remains Atelier's current project guidance.

The [agent design review](docs/agent-design-review.md) records current correctness gaps and refinement priorities. The [GPT Image 2.5 integration guide](docs/image-generation-integration.md) documents saved concepts, reference-image edits and applying a chosen direction to the canonical model.

## Code and checks

- [components/Studio.tsx](components/Studio.tsx): studio interface, brief, steering and navigation controls.
- [components/World.tsx](components/World.tsx): office, design renderer and first-person exploration.
- [shared/design.ts](shared/design.ts) and [shared/geometry.ts](shared/geometry.ts): canonical schema and derived geometry.
- [worker/src/ai.ts](worker/src/ai.ts) and [worker/src/workflow.ts](worker/src/workflow.ts): model invocation, real tools and task sequence.
- [scripts/blender_compile.py](scripts/blender_compile.py): canonical design to Blender/GLB compilation.

```sh
npm run worker:types
npm run typecheck
npm test
npm run build
npm run worker:check
```

These are the available verification commands, not a record that this checkout or a live deployment has passed them.
