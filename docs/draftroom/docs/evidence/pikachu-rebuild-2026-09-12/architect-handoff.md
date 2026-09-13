# Architect shell checkpoint — Folded Lantern House

Status: ready for a critical review; **assembly has one known failure and is not ready for detail**. Employee prompts 1.1.0. This is a standalone live MCP experiment with manual single-writer coordination, not an implemented application worker run.

Scene: https://app.spline.design/file/f2161163-3018-412c-8dfe-814898e9913d

The original house remains in its original file. A temporary archive operation changed its names/visibility unexpectedly; root undid it, and the 120 listed geometry rows matched the pre-operation snapshot exactly. No original geometry was removed. File-account cleanup and new-tab focus recovery were handled separately by root.

## Architectural proposal

A broad asymmetrical folded roof shelters a family home with a recessed garden room. The yellow entrance reveal creates a short compression before the open living/garden sequence. The roof silhouette, the surprising arrival sequence and selective warmth in shared surfaces are the three translations of the character reference. Bedrooms use neutral surfaces; solid side walls prioritize privacy from neighbors. There are no mascot figures or pasted-on ears.

The upper enclosure steps back from the east ground-floor boundary. A continuous 21 m² terrace slab closes the exposed lower-floor strip. The 12 m² garden threshold sits under the upper floor, within the covered footprint. These are declared design exceptions, not gaps relabeled after construction.

## Built geometry and checks

Critical dimensions come from actual Spline world-space geometry reads in `actual-geometry-bounds.json` and `geometry-readback.txt`. The accounting script calculated:

| Measure | Actual concept geometry | Brief |
| --- | ---: | ---: |
| Ground enclosed floor plates | 168.00 m² | approximately 180 m² |
| Upper enclosed plates, stair void excluded | 151.86 m² | approximately 140 m² |
| Total concept GFA | 319.86 m² | target 320; cap 340 m² |
| Covered footprint, threshold included | 180.00 m² | cap 180 m² |
| Intended planted site remainder | 392.40 m² | at least 240 m² |
| Bedrooms | 3 | 3 |

The gross bedroom planning zones are 18, 20 and 28 m²; these are not measured net usable areas. The planted remainder represents unpaved site surface, not detailed planting. Room allocations may shift under the brief.

The stair has 18 rises of approximately 177.8 mm, 17 treads of 280 mm, 1.2 m width, and an actual 1.5 × 4.76 m slab opening. The last tread meets the upper north floor plate at the same z-coordinate, with the final rise to 3.2 m. Upper floor plates and terrace span y=3.0–3.2 m; ground walls end at 3.0 m and upper walls start at 3.2 m. The old open storey-junction band is absent in the four exterior views.

**Known failure:** internal bedroom partitions stop at 6.2 m while the folded roof rises above them, up to 7.3 m. No ceiling or wall infill closes these bands. Bedroom air volumes remain connected above the partitions. Acoustic performance has not been tested. This requires a revision before detailed fit-out; it must not be described as a passed shell.

**Other unresolved items:** full route-clearance verification, continuous stair handrails, detailed opening closures/hardware, terrace weathering/drainage, environmental performance, and neighbor sightlines. No structural, statutory or accessibility compliance is claimed. See `assembly-checks.json` for pass/fail/unknown results and methods.

Preparation caught and corrected ground service doors facing the stair body and an upper bathroom door facing the stair opening. During construction, the tool identified an overlapping guard/bath wall; the redundant guard was shortened and read back. These are Architect self-corrections before the independent Critic decision.

## Review evidence

Actual rendered exterior views: `south-elevation.png`, `east-elevation.png`, `north-elevation.png`, `west-elevation.png`. The north elevation also shows the living-to-covered-garden relationship. `upper-plan-ui.png`, `ground-plan-ui.png` and `stair-section-west-ui.png` are native screenshots of the actual editor. The stair image is an oblique cutaway rather than an orthographic section. `stair-section-ui.png` shows the exposed partition/roof relationship but is not a clear stair view. `final-street-perspective.png` is the final actual MCP live capture, with framing and hero gates passed. A dedicated site plan and interior family-room-to-garden view remain missing; the north elevation is only a limited garden-connection fallback.

MCP's screenshot budget refused both plan captures after the exterior set, so native application screenshots are the capture fallback. Refused images were not substituted with stale captures. Plan views temporarily hide roofs, the other storey, and lintels/heads; the stair void therefore may show the site while the lower floor is hidden. These are view settings, not deleted geometry. The first cutaway removes the west exterior wall, west upper slab segment and west roof sheet. The revised stair cutaway hides the whole roof. All model geometry was restored afterward; final readback confirms no model parts remain hidden. Plan annotations and the unused default light remain hidden intentionally.

## Timing and handoff

The nine bounded geometry creation calls took approximately 33 seconds, from 15:32:58 to 15:33:31 UTC. The first perspective, guard correction and geometry readback finished at 15:34:16 UTC, approximately 78 seconds after construction began. This excludes design preparation, account/file recovery and subsequent evidence collection; it is not an end-to-end completion time.

The design is deliberately a shell with simple program proxies, not a polished presentation. The independent Critic should review this unchanged checkpoint and propose a bounded revision that preserves the roof/entry idea and garden connection. The writer has been released to root for scene naming, export and save/reopen verification. Those persistence operations are not yet verified in this Architect handoff.
