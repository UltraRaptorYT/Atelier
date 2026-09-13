# Draftroom progress

## Implemented

- Next.js/React/TypeScript frontend, locally bundled fonts.
- Reception plus Architect, Interior Design, shared Analyst/Critic, and shared Meeting/Presentation rooms, with visible entrances and role-specific furnishings.
- Animated customizable player and five sample employees; Director Theo is based at reception and leads the sample meeting conversation.
- Keyboard/click navigation, collision-safe paths, room visits, orbit/zoom/reset, minimap, daylight/evening.
- Responsive navigation, accessible dialogs, help, brief starters, sample V1/V2, saved notes/journal.
- Validated local project storage, cross-tab updates, and WebGL fallback.
- Version 1.1.0 shared and five employee system prompts: creative form, shared spatial model, assembly/layout gates before detail, and concurrent review with one scene writer. Five master project briefs remain version 1.0.0.
- Frontend starters generated from canonical project Markdown, with location/site-area labels and build-time synchronization checks. Existing saved briefs remain intact.

## Verification

Role workflow update: prompt contracts and handoffs reviewed for creative freedom, enclosure/connectivity checks, mandatory multi-view evidence, stale-review handling and truthful MCP provenance. Evaluation scenarios are in `prompts/README.md`; automated geometry checking and model-based behavioral evaluation remain unimplemented.

Office baseline verified on 2026-09-12: six navigation tests and seven office browser tests pass, including actual arrival after repeated floor clicks beside reception and walking to labels after camera rotation. A separate sweep found routes from all 1,048 sampled legal positions around reception.

Earlier starter-brief/frontend update verified: catalog/source synchronization, site and program arithmetic, character limits, lint, TypeScript, production build, and two focused browser tests pass. The browser checks cover all five starter texts, mobile presentation, edits, and saved-project preservation; screenshots are `test-results/project-briefs-desktop.png` and `test-results/project-briefs-mobile.png`. These frontend results do not establish employee prompt behavior; model-based behavioral evaluation remains pending.

Navigation tests cover room-to-room reachability, collision-safe paths, invalid destinations, and manual collisions. Browser tests cover rendering, movement, rooms, persistence, mobile, controls, and fallback. Desktop and 390px mobile screenshots were inspected; screenshots are in `test-results/`. These are functional software-rendered checks, not a hardware-performance benchmark.

## Remaining

Frontend rehearsal only. No AI/Spline worker, Docker, Supabase, voice, or real design review is connected. Models and employee activity are illustrative.

Next: get frontend feedback, then prove real Spline screenshot/action/streaming integration behind the Architect panel. Employee travel into meetings remains an integration task; current employee avatars are illustrative.
