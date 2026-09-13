# Draftroom import and provenance

Imported from the sibling `../draftroom` repository on **2026-09-13**, at commit `48e8cea6840404882494d3fbe8e500148ae4f501` (clean working tree at import). The source repository was read only.

This directory preserves Draftroom's original product thinking, prompts, implementation notes and design experiments. Historical statements about Spline, Supabase, five employees, localStorage, pnpm commands and completed checks describe Draftroom at the recorded time. They are **not Atelier architecture, active engineering instructions, current test results or evidence of a live Atelier run**. Use the [Atelier README](../../README.md), root [AGENTS.md](../../AGENTS.md) and [active prompt library](../../prompts/README.md) for current behavior.

## What to read

| Reference | Purpose |
| --- | --- |
| [Original product vision](DRAFTROOM.md) | Studio experience, roles, reviews and demonstration ideas |
| [Original README](README.md) | Historical Draftroom setup, navigation and implementation scope |
| [Engineering reference](engineering-reference.md) | Archived source `AGENTS.md`; renamed so it cannot become active directory instructions |
| [Presentation experience](docs/presentation-experience.md) | Large model, plan panel, staged reveal and iteration comparison direction; future reference, not a shipped Atelier feature |
| [Implementation decisions](docs/decisions.md) | Design rationale, navigation lessons and assembly-check methodology |
| [Progress record](docs/progress.md) | Source implementation/review history as recorded in Draftroom |
| [Original prompt library](prompts/README.md) | Unmodified shared/role/master-brief source for comparison with the Atelier adaptation |
| [First Pikachu experiment](docs/evidence/pikachu-mcp-2026-09-12/) | Original screenshots, measurements, tool result records and `.spline` artifact |
| [Rebuilt shell and review](docs/evidence/pikachu-rebuild-2026-09-12/architect-handoff.md) | Geometry, assembly calculations, views and [independent critique](docs/evidence/pikachu-rebuild-2026-09-12/critic-review.md) |
| [Import manifest](import-manifest.json) | Source/destination paths, original SHA-256 checksums and transformations |

All source `docs/` and `prompts/` files retain their relative directory structure. Their contents are preserved byte-for-byte, including approximately 2.6 MB of evidence and the original Spline file. Source root documents have a historical-reference banner; the original README's `AGENTS.md` link targets its renamed archive. Source-only code/catalog paths mentioned by archived documentation are historical references: the original application code and frontend catalog are not copied into this archive. Evidence scripts are stored for traceability and are not executed by Atelier.

## Active adaptation in Atelier

The active library lives at [`prompts/`](../../prompts/README.md). Shared/role instructions are version 1.2.0 and map Director to `principal`, Interior Designer to `designer`, and personas to Atelier's existing four employees. Analyst remains optional reference methodology.

The active instructions use canonical `project/design.json`, E2B tool execution and derived Three.js/Blender output. They honor the worker's actual strict response schemas instead of Draftroom's proposed response envelope. Review checklists do not create unimplemented workers, validators, writer-lease tools or additional workflow phases. Current generation proceeds through principal, architect, designer and critic; richer pre-detail review is methodology rather than a new scheduler.

All five master briefs are unchanged in the active library. Their metadata and area budgets remain intact. The 40-storey tower deliberately remains a future reference because Atelier currently supports four floors; a client must accept a smaller scope before it can be generated. Atelier does not import Draftroom's frontend starter-catalog synchronization script.

Atelier's optional **Click to walk** mode adapts the navigation idea to the existing canonical model and office. The archive's avatar customization, shared rooms, starter selector, rehearsal journal and other frontend features are not implied to have been ported.
