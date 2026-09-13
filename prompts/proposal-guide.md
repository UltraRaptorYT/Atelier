# Author, inspect and submit a canonical proposal

This guide is installed at `/home/user/project/proposal-guide.md`; the exact invocation schema is `proposal-schema.json` beside it. Import `design_authoring` from that directory. All dimensions are metres, +Y is up, element positions are centres, and floor indices start at zero. Helpers return ordinary canonical dictionaries/lists, with stable IDs derived from your chosen assembly prefixes. Reuse those prefixes and opening layouts when making bounded revisions. Do not import the historical Pikachu authoring script or use Blender-only geometry fields.

1. Read the task's `design.json`, effective requirements and dependency outputs. Initial Architecture builds the full candidate; existing-design Architecture and Interior write only explicit edits. The file contract is identified by the supplied schema.
2. Use Python loops and helpers to write `/home/user/project/proposal.json`. Its size is independent of the final response token budget. Never overwrite `design.json` to submit work.
3. Call `inspect_proposal`. Read the actual images and assembly findings, then correct defects within your role. At most two inspections are available; use task-appropriate views. A desktop screenshot of the JSON table is not a model inspection.
4. In a later tool turn, call `submit_proposal` for the same inspected bytes. If you change the file, inspect it again before submission. Submission validates against the assigned base and role, and captures the proposal; the coordinator later commits it with revision/cancellation checks.
5. Return the invocation's small `{ "summary": "..." }` result after successful submission. Mention concrete work and unresolved limits. Do not repeat the complete design in that response or claim the proposal is already a canonical revision.

Helpers enforce their own assembly preconditions. Server schema and ownership validation remain authoritative; no helper establishes complete room connectivity, clearance or code compliance.

Authoring has 24 tool turns and a shared 12-minute work clock. Each Python call accepts at most 12,000 code characters; split larger scripts into saved files or smaller calls. Save `proposal.json` incrementally, finish essential geometry first, and begin inspection with at least 180 seconds and three tool turns left. Inspection, image review and submission are part of the work allowance. If authoring fails, the runtime attempts to preserve the bounded file as an explicitly unpublished draft; that artifact is not an accepted design revision.

## Construction helpers

`from design_authoring import ...` exposes these functions (keyword arguments are recommended):

- `material(id, color, name=None, roughness=.65, metalness=0, opacity=1, transmission=0)` creates an explicit material. Use opaque frames and doors; use a separate glazing material, for example `opacity=.3, transmission=.6`.
- `box(id, kind, center, size, material, floor=0, name=None, rotation=0, asset_id=None)` creates a centre-based box or supported built-in furniture instance. `rotation` is yaw in radians. A `stair` is a whole flight, never a single tread.
- `wall_with_openings(id, start, end, base_y, height, thickness, material, openings=(), floor=0)` returns solid wall pieces with real apertures. `start`/`end` are XZ points. Each opening is `{id, offset, width, bottom, height}`; offset is measured along the wall from its start, not from its centre. Openings must fit, not overlap, and leave a header. Nonzero residual strips must be at least 0.01 m.
- `window_assembly(id, start, end, base_y, wall_height, opening, frame_material, glass_material, floor=0, frame=.05, depth=.12, mullions=0)` returns opaque frame parts and separate glazing. Pass the **same opening record** to its host wall. A window box by itself cuts no hole.
- `door_assembly(id, start, end, base_y, wall_height, opening, frame_material, door_material, floor=0, frame=.05, depth=.12, open_angle=pi/2)` returns a frame and hinged leaf. Door bottom must be zero. Default opening angle leaves an entrance; reserve its swing and approach. Use an opening wider than the required clear route because jambs occupy part of it.
- `slab_with_voids(id, center, size, top_y, thickness, material, voids=(), floor=0)` returns an axis-aligned XZ slab split around `{id, position:[x,z], size:[width,depth]}` voids. Voids must fit and not overlap. `top_y` is the walking surface.
- `staircase_with_landing(id, start, base_y, rise, width, material, floor=0, run=None, landing_depth=None, slab_thickness=.2)` returns `{elements, upper_void, landing_void, risers, riser_height, tread_depth, upper_y}`. `start=[centre_x, low_end_z]`; the flight rises along +Z. Default treads are 0.28 m and risers at most 0.18 m. Subtract **both** returned voids from the upper slab before adding the returned flight and landing. Keep the low approach and space above the entire flight clear; this helper does not check surrounding walls or roof.
- `pitched_roof(id, center, size, eave_y, ridge_y, material, floor=0, thickness=.12, ridge_offset=0)` returns two true mesh panels. `folded_roof(id, profile, z_min, z_max, thickness, material, floor=0)` accepts an ordered `[(world_x, top_y), ...]` profile for asymmetric or multi-fold forms. Heights are roof **top** surfaces; thickness is vertical. Close the shell underneath instead of covering gaps with fascia.
- `gable_wall(id, left_x, right_x, ridge_x, eave_y, ridge_y, z, thickness, material, floor=0)` creates a triangular end-wall infill. Give it the roof **underside** elevations and align it with the wall below.
- `mesh(id, kind, vertices, triangles, material, floor=0, name=None)` converts world-coordinate vertices and triangle indices into `geometry: {type:'mesh', vertices, triangles}` normalized inside the element bounds. Limit each mesh to 2,048 vertices/4,096 triangles and the whole design to 60,000/100,000. `rod(id, start, end, radius, material, floor=0, kind='furniture', sides=10)` builds a capped mesh cylinder. Preserve the existing mesh when changing only its finish. Registered Blender assets retain their authored UVs/materials/shading by default; use `assetMaterialOverride: true` only for an intentional replacement of every material on that one asset element.
- `empty_edits()` initializes all collection upserts/removals empty and all metadata null. `write_proposal(proposal)` writes the fixed submission path, without committing anything.

## Minimal complete candidate

This small one-room example demonstrates connected construction, not a prescribed floor plan or detail target. Adapt the program, orientation, heights and spaces to the accepted brief. Add room partitions and their real openings before furnishing a larger program.

```python
from design_authoring import *

wall_start, wall_end = [-4, -3], [4, -3]
entry = dict(id="entry", offset=1, width=1.2, bottom=0, height=2.2)
window = dict(id="front_window", offset=4, width=2, bottom=.8, height=1.5)
elements = slab_with_voids("ground", [0, 0], [8.2, 6.2], 0, .2, "stone")
elements += wall_with_openings("front", wall_start, wall_end, 0, 3, .2, "plaster", [entry, window])
elements += door_assembly("entry", wall_start, wall_end, 0, 3, entry, "timber", "timber")
elements += window_assembly("front_window", wall_start, wall_end, 0, 3, window, "timber", "glass", mullions=1)
for wall_id, start, end in [
    ("back", [-4, 3], [4, 3]),
    ("left", [-4, -3], [-4, 3]),
    ("right", [4, -3], [4, 3]),
]:
    elements += wall_with_openings(wall_id, start, end, 0, 3, .2, "plaster")
# Flat eave strips meet the full side-wall thickness; slopes meet gable infill.
elements += folded_roof("roof", [(-4.1,3.12),(-3.9,3.12),(0,4.32),(3.9,3.12),(4.1,3.12)], -3.2, 3.2, .12, "metal")
for side, z in [("front", -3), ("back", 3)]:
    elements.append(gable_wall(side+"_gable", -3.9, 3.9, 0, 3, 4.2, z, .2, "plaster"))
proposal = dict(
    schemaVersion=1, units="meters", title="Light-filled studio", buildingType="studio", floors=1,
    materials=[material("stone", "#b4aca0"), material("plaster", "#eee7d9"),
               material("timber", "#865a3e"), material("metal", "#363b40", metalness=.7),
               material("glass", "#b7d7de", opacity=.3, transmission=.6)],
    assets=[], spaces=[dict(id="main_space", name="Studio", floor=0, position=[0, 1.5, 0], size=[7.8, 3, 5.8])],
    elements=elements, spawn=[-2.4, 1.7, -2], notes=["One-room construction example; no regulatory review."])
write_proposal(proposal)
```

For a two-floor task, build upper slabs and stairs together; do not add an uncut slab over the flight:

```python
stairs = staircase_with_landing("main_stair", [-2, -4], 0, 3.06, 1.1, "timber")
upper_elements = slab_with_voids("upper", [0, 0], [10, 14], stairs["upper_y"], .2, "stone",
    voids=[stairs["upper_void"], stairs["landing_void"]], floor=1) + stairs["elements"]
```

## Incremental finish proposal

The Designer may change materials, material assignments, furniture and lights. Preserve structural geometry (including `geometry`), spaces, notes and other metadata. Read a whole existing element, change only `materialId`, and upsert that complete record. Keep changes scoped to the actual requested IDs. Architect edits use the same envelope and may change their owned records/metadata. Explicitly remove obsolete assembly pieces only when necessary; never delete unmentioned geometry.

```python
import json
from copy import deepcopy
from design_authoring import empty_edits, material, write_proposal

base = json.load(open("/home/user/project/design.json"))
proposal = empty_edits()
# Replace this ID with the actual selected element from the task.
selected_id = "entry_leaf"
selected = deepcopy(next(element for element in base["elements"] if element["id"] == selected_id))
selected["materialId"] = "entry_red_finish"
if selected.get("assetId") and not selected["assetId"].startswith("atelier-"):
    selected["assetMaterialOverride"] = True
proposal["materials"]["upsert"] = [material("entry_red_finish", "#a6352f", name="Warm red entry")]
proposal["elements"]["upsert"] = [selected]
write_proposal(proposal)
```

Inspect the saved candidate and submit only after reading that result. A materially unresolved collision, missing enclosure or missing view belongs in the summary and coordination notes, not a claim that the design passed review.
