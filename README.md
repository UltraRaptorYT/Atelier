# Atelier

An AI architecture studio with four specialists, observable tool work, persistent design revisions and an explorable 3D office and building. The Principal plans tasks and dependencies; independent specialists can work concurrently. The Architect develops layout and structure, the Interior Designer handles materials, furniture and lighting, and the Critic reviews the combined result.

The local preview needs no external keys. Live generation uses the configured OpenAI account and an E2B sandbox; see [the setup and cost guide](docs/FREE-MODE.md).

A Next.js architecture studio with a walkable Three.js office, four specialist roles, persistent Cloudflare project state, E2B workstations, and OpenAI conversation/design integrations.

The [collaboration guide](docs/concurrent-agents.md) explains concurrent tasks, proposal merging, coordination meetings and bounded correction rounds. Apply the new task-dependency migration with `npm run db:local` when updating an existing local checkout. Activity now shows the current task graph, dependencies and actual active specialists.

## Run the local preview

## Run locally

Requires Node.js 22+ and Python 3 for compiler-contract tests.

```sh
npm ci
npm run setup:local
```

In separate terminals:

```sh
npm run worker:dev
```

```sh
npm run dev
```

Open **http://127.0.0.1:3000**. Without Clerk configuration, loopback development uses one local owner. This bypass is disabled in production. Projects are saved in the local Wrangler database; the initial courtyard model is clearly marked as a sample. Create a project, edit its brief, and reconnect without losing it.

WASD moves, mouse capture or dragging changes view, E selects the nearby room, and Escape releases capture. Room shortcuts and the project panel provide a conventional interface. Mobile uses orbit inspection and the project/conversation panel.

## Connect live services

Copy `.env.local.example` to `.env.local` and configure Clerk. Keep Worker secrets in the ignored `worker/.dev.vars.local`; `setup:local` generates its local AES key without printing it. Configure the Clerk verification key/secret and E2B API key there. Users connect their own OpenAI key through Settings; do not place user OpenAI keys in E2B.

The application defaults to `gpt-6-astra` for the design specialists and `gpt-live-1` for native speech, with Astra handling delegated voice tools. It uses the Live JSON/WebRTC protocol and native captions, with no separate Whisper or transcription model. Actual account access and live audio still require verification. See [the exact env files and setup instructions](docs/ENVIRONMENT.md).

The code contains a Cloudflare Worker backend with D1 metadata, R2 artifacts, Durable Object coordination and Workflow execution. Clerk provides deployed authentication. OpenAI calls use a personal key saved through Settings, falling back to the server's `OPENAI_API_KEY`. Agent desktops use E2B, and Blender rendering runs on those desktops.

### GPT-Live 1 voice input

After `npm run setup:local`, add `OPENAI_API_KEY=...` to **`worker/.dev.vars.local`**, preserving the existing encryption key. Restart `npm run worker:dev`. The Next.js root `.env.local` does not configure Worker secrets. For a deployed Worker, set the secret with `npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.jsonc --env staging` (or `production`) and enable `VOICE_ENABLED` for that environment. An environment key pays for users who have no personal key saved; removing a personal key restores that fallback.

Local voice is enabled independently of design generation. You can save a spoken brief and discuss a project while `GENERATION_ENABLED=false`; generating or applying changes still requires generation and E2B to be configured. Apply the database migrations when upgrading (`npm run db:local` locally).

Create a project (or choose **Use voice to brief**), select a specialist, and click **Live voice**. Allow the microphone on HTTPS or localhost. Select a model element before calling to include its context. Changing specialist, project or selected element ends the call; reconnect for the new context. End call stops the microphone; design work continues separately.

The browser exchanges SDP through the authenticated backend. GPT-Live 1 handles speech; a Responses backend routes brief details, project questions and change requests into the existing persisted project system. Server controls validate every action and revision, and the browser receives only voice status and transcripts. Calls close after 15 minutes. [Official WebRTC setup](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [GPT-Live delegation](https://developers.openai.com/api/docs/guides/live-delegation).

Provider access, real microphone/audio behavior and a full paid design run still need a live smoke test after the key is added. Protocol and persistence tests use mocked provider responses/local storage.

```sh
npm run desktop:build
npm run desktop:benchmark
```

These commands consume remote resources. The benchmark writes actual outputs and timing data to `.atelier/benchmark/`; it never fabricates successful renders. Keep production generation OFF until the release checks pass.

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
```

Tests run real local D1, R2 and Durable Objects through Miniflare, verify signed Clerk-style JWT ownership, concurrent commits, cancellation fences, budget admission, credential encryption, and shared browser/Python geometry. They do not make paid AI or E2B calls.

## Code map

| Location | Responsibility |
|---|---|
| `components/Studio.tsx`, `World.tsx`, `Voice.tsx` | Project UI, walking world, explicit voice controls |
| `app/api/studio/[...path]/route.ts` | Same-origin authenticated streaming proxy |
| `shared/` | Canonical schema, geometry, furniture and budget limits |
| `worker/src/index.ts` | Authenticated public operations |
| `worker/src/coordinator.ts` | Revision publication and voice sideband control |
| `worker/src/workflow.ts`, `ai.ts` | Persistent specialist jobs and real tools |
| `worker/src/budget.ts`, `desktop.ts` | Compute admission, leases and private desktops |
| `scripts/blender_compile.py`, `blender_asset.py` | Canonical compilation and custom mesh publication |

Spline remains optional asset authoring. The walking world is implemented directly in React Three Fiber/Rapier; no Spline subscription or exported interaction runtime is required.
