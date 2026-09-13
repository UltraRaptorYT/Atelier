# Pikachu House — Spline study

[Open the editable Spline file](https://app.spline.design/file/ef8ae053-66b7-4c9a-bda7-0f41f999bc66) · [View the local presentation](index.html)

Built with native Spline primitives, custom roof/floor meshes, shared materials, and procedural planting, using `project/design.json` as the canonical source. No Blender process or tool was used for this Spline build.

The folded roof translates the character's angular energy into a continuous architectural silhouette. The warm-yellow entry recess creates a bright arrival followed by a quieter neutral interior. A direct living/dining → covered garden room → rear garden sequence expresses movement and surprise. Bedrooms use restrained timber, ivory, and sage; V2 adds angled timber screens for side privacy and a yellow gallery screen. The roof, entry, room areas, and garden connection remain the same between V1 and V2.

| Check | Concept result |
|---|---:|
| Bedrooms / storeys | 3 / 2 |
| Ground / upper enclosed | 164.4 / 155.6 m² |
| Total enclosed / cap | 320 / 340 m² |
| Covered footprint / cap | 180 / 180 m² |
| Coverage | 30% |
| Conservative planted garden / minimum | 319.56 / 240 m² |
| Setbacks south / north / east / west | 7 / 11 / 2.5 / 2.5 m |

Guest bedroom (18 m²) and a nearby shower are at entry level. Primary (28 m²) and child (20 m²) bedrooms are upstairs. Ground living/dining opens to a 12 m² covered garden room. Side walls, high service windows, and angled fins establish privacy intent; no measured privacy, environmental, structural, accessibility, or regulatory performance is claimed.

## Views and editing

- `v1-street.jpg` and `v2-street.jpg`: matching street perspectives comparing the privacy refinement.
- `ground-floor.jpg` and `upper-floor.jpg`: actual Spline floor views with the roof/ceilings temporarily hidden. The full enclosure is restored in the saved file.
- `site-plan.svg`: labeled site drawing generated from the canonical dimensions; `area-checks.json` records the arithmetic.
- Saved camera **02 Family room to garden**: an eye-level view from inside the living space toward the rear garden. Select it from Spline's camera menu. The saved street camera is **01 Street overview**.
- Spline's working screenshot limit prevented a separate capture of the family-to-garden camera. It is available in the editable file; no uncaptured image is represented as a render.

The `PH26 House` group contains separate ground/upper shells, interiors, roof, privacy screens, and lighting. Site and planting remain separately editable. Use the `PH26 yellow` material asset for a coordinated recolor. Individual elements retain canonical `ph_…` IDs in their names.

`scripts/compile_pikachu_spline.py` emits bounded DSL batches and a manifest. The `90`–`94` files record finishing, camera, and placement steps; foliage placement repairs contain this file's object IDs because the Spline generator initially left its child meshes unparented. Do not replay creation batches into the completed file. Two side trees were narrowed to keep foliage out of bedroom windows. The rendered views are concept illustrations, not construction drawings.

## Review after user feedback

No separate Critic agent reviewed V2. V2 was an authored privacy variant followed by geometry and framing checks. The added street-facing fins clutter the composition and compete with the roof and entry. V1 is the preferred visual baseline; a future revision should target demonstrated side-neighbor sightlines.

The final live editor view passed framing checks, and glazing was changed to simple translucency after the live renderer showed refractive glass as black. See `final-overview.jpg` and `95-live-presentation.js`.
