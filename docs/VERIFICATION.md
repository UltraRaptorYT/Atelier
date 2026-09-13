# Verification and release gates

This file distinguishes local evidence from live service acceptance. No real AI-generated building, authenticated E2B playback, voice interruption, remote Blender rendering or production deployment is claimed yet.

## Local checks

- Next.js production build passed during implementation; rerun after source changes.
- Frontend and Worker strict TypeScript checks passed.
- Local D1 migration applied successfully.
- Automated suite: **24 tests passed**. It covers canonical size limits, references, isolated recoloring, Python/TypeScript furniture and stair equivalence, owner-bound AES-GCM encryption, bounded request bodies, signed JWT ownership, concurrent commits, idempotency, cancellation fences, compute quotas, saved access while generation is disabled, and the Live protocol checks described below.
- Browser: opened the office, entered walking mode, navigated the project panel, created a persistent local project, restored it after refresh, checked that a new project exposes no sample downloads, and opened the furnished sample model. A same-origin proxy mismatch found in this check was fixed.
- Initial desktop layout was visually inspected. Subsequent in-app screenshot capture was unavailable. No measured 30 FPS result is claimed. Upstream Three/Rapier deprecation warnings remain. A transient Fast Refresh error occurred while new monitor props were being wired across files; the completed application was rebuilt and reloaded afterward.
- Available test host: Windows, Intel Core i9-14900HX, 32 GB RAM, RTX 4070 Laptop GPU plus Intel UHD Graphics. The Codex in-app browser reported **1 FPS** for office and sample views, with its document marked visible; screenshot capture was unavailable. This is a failed performance observation, not a passed benchmark. The active rendering adapter and cause of throttling were not established. Repeat and profile in a foreground desktop browser before release; keep the performance gate open.

## Live staging scenarios — pending

| Scenario | Required evidence |
|---|---|
| Clerk public signup and two owners | Two actual accounts; every project/artifact/desktop/voice operation denied across owners |
| Themed home | Brief → principal → architect → designer → critic → saved walkable model, actual tool events/screens |
| Yellow to red | Local finish changes only the addressed element; later specialist result cannot revert it |
| Building diversity | Home, café, office, unconventional brief; usable entrances/circulation and <=4 floors/40 spaces |
| Oversized brief | Principal requests a smaller building/section before remote generation |
| Remote workstation | Authenticated live playback, viewer URL rotation, no cross-owner access, only inspected stream active |
| Realtime voice | Explicit mic start, transcript, interruption during response, agent switch while connecting, stop/hangup |
| Resume/recovery | Close browser, restart desktop, retry failed step; all committed revisions/artifacts remain available |
| Custom geometry | Create original mesh in Blender, register immutable GLB, inspect it in browser, recompile same asset in Blender |
| Rendering | Default E2B machine, successful GLB/.blend/PNG; revision extras match; partial successful files retained on timeout |
| Quotas | Two active machines globally, one run/user, daily and account allowances, idle shutdown and provider kill failure |
| Presentation | Download JSON, GLB, plans, Blender source, geometry assets and renders; compare revisions and mark stale renders |
| Performance | >=30 FPS for office and representative furnished building on a documented desktop; quality reduction checked |

Record the actual model IDs, timestamp, browser/OS/GPU/CPU/RAM, viewport, project revision, E2B template/version, runtime and measured provider cost. Do not use sample geometry as proof of an AI design run.

## Desktop benchmark

`npm run desktop:benchmark` uses the default machine and a maximum 15-minute session. It saves actual machine information, Blender version, startup/render time, estimated compute cost and completed files to `.atelier/benchmark/`. The authenticated stream server starting is **not** proof that playback works; inspect it with a real user session. Inspect the rendered image and model visually before enabling public rendering.

The command runs one test camera. A timeout/failure is a failed gate, even when the compiler produced a useful `.blend` or GLB. The tier is not upgraded automatically.

## Remaining practical limits

- This is architectural concept software. Geometry validation and critic review do not establish structural engineering, building-code or permit compliance.
- Browser previews use procedural solids and a small original furniture library. Custom Blender assets are limited to 30 assets/project, 30,000 vertices/50,000 triangles per published mesh, and the 25 MB artifact limit. Materials on imported mesh instances use the canonical element finish.
- Storage admission allows 10 projects/account, 100 revisions/project and 250 MB of recorded artifacts/project. Request burst protection is approximate per Cloudflare location; the compute coordinator is the authoritative allocation gate.
- Design work runs through bounded specialist stages. A failed uncommitted tool stage may need a retry; the canonical committed design is the recovery source. Raw ephemeral desktop state is not a second source of truth.
- Spline authoring is optional. Its exported interactions/lighting/physics are not imported. GLB assets need the same normalized, private, versioned asset contract.
- Global budget enforcement assumes one admitting deployment at a time. A second active environment or manual E2B sessions must be accounted for before public launch.

**Public generation must remain disabled until these live checks pass.**
# Model and voice migration — 2026-09-13

Defaults now use GPT-6 Astra and GPT-LIVE-1, after checking the official model, migration, WebRTC, delegation, and lifecycle documentation linked in [ENVIRONMENT.md](ENVIRONMENT.md). The Live integration uses JSON session creation, an authenticated sideband, server-only Responses tools, native transcript deltas, and graceful close/final-usage handling. User credentials remain encrypted and generation remains off.

Validation: 24 tests passed, including mocked SDK request/response verification, frontend event permissions, complete delegated function batches with original revision retention, and overlapping/late captions. Frontend and Worker TypeScript checks and the Next.js production build passed. These are local protocol and regression checks: live model access, audio interruption, sideband streaming, and final usage with a real OpenAI project remain unverified. Earlier E2B and frame-rate release gates below still apply.
