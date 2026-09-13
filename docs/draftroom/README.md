> **Historical Draftroom reference, imported 2026-09-13.** This describes the sibling repository at import time, not Atelier’s current implementation or engineering instructions. See the [migration index](index.md) and [current Atelier README](../../README.md).

# Draftroom

A walkable architecture studio for ideas that deserve a little space.

This build is a **frontend rehearsal**: a furnished 3D office, customizable character, five sample employees, room interactions, and a locally saved journal. AI workers, Spline, voice, and Supabase are not connected.

## Run

Use Node.js 24.13.0 (`.nvmrc`) and pnpm 12.4.1:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [localhost:3000](http://localhost:3000). Without pnpm, use `npx --yes pnpm@12.4.1 install --frozen-lockfile`, then `npm run dev`. No keys or environment variables are needed.

## Explore

- **WASD / arrows:** walk relative to the camera; Shift moves faster.
- **Click the floor:** find a path around furniture and glass. Clicking furniture walks to a nearby clear spot.
- **Choose a room:** walk there and open its workspace.
- **E near a room:** interact. Escape closes dialogs or stops walking.
- **Drag:** orbit. Use + / − and reset for camera controls.
- **Sun/moon and eye:** evening/daylight and room labels.
- **Your studio self:** customize name and jumper color.
- **Shape your idea:** edit the brief or select a starter.
- **Project journal:** saved brief, sample history, and room notes.

Reception connects four work rooms: Architect, Interior Design, Analyst & Critic (shared), and Meeting & Presentation (shared). The Architect has a massing workstation; Interior Design has material samples and furniture; Analyst & Critic share evidence checks and critique; the meeting room contains team review and V1/V2 comparison. Models are illustrative, not generated from your brief. Room navigation works without WebGL; mobile has tap-to-walk and a drawer.

Project and character preferences persist in this browser under `localStorage` key `draftroom.studio.v1`. They are not synced between devices. No data is sent to an AI provider. Clearing that key resets the rehearsal and removes local notes.

## Verify

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm start
```

Browser tests run an isolated headless Google Chrome against the local app; screenshots are saved in `test-results/`. Install Chrome or adapt the Playwright `channel` on other machines. Software rendering makes these functional checks reproducible; it is not a hardware-performance benchmark.

TypeScript/ESLint are pinned to versions supported by the current Next.js lint plugins. React is within Fiber's supported peer range. Fonts are bundled locally.

## Agent and project prompts

The [prompt library](prompts/README.md) contains shared instructions plus system prompts for the Director, Architect, Interior Designer, Analyst, and Critic. It also contains the five master project briefs, with named hypothetical sites, land dimensions, area budgets, design intent, and review requirements.

Project Markdown files are canonical. Run `npm run prompts:sync` after editing them; `npm run prompts:check` verifies the frontend catalog and area arithmetic. The production build includes this check. Existing saved briefs remain unchanged until you select and save a starter. Agent prompts are ready for integration; AI workers are not connected.

## Code map

- `components/office/`: geometry, furniture, characters, camera, movement.
- `lib/domain/office.ts`: room and obstacle definitions.
- `lib/domain/navigation.ts`: collision checks and A* with path smoothing.
- `components/studio/`: shell, dialogs, project and employee panels.
- `lib/client/use-project.ts`: validated local persistence and cross-tab updates.
- `tests/`: navigation and browser checks.

See [DRAFTROOM.md](DRAFTROOM.md), [AGENTS.md](engineering-reference.md), and [docs/progress.md](docs/progress.md) for vision, engineering instructions, and status.
