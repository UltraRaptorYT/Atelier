# Demo results — 13 September 2026

The latest attempt generates an editable building directly from the text brief. It uses no image-generation calls or image reference.

## Latest direct 3D result

- [Full Blender render](08-direct-3d-render.png)
- [GLB model](09-direct-3d-model.glb)
- [Blender source](10-direct-3d-source.blend)
- [Browser view](11-direct-3d-browser.png)
- [Walkthrough screenshot](06-direct-3d-walkthrough.png)
- [Canonical design](05-direct-design-revision-3.json)
- [Input brief](03-direct-3d-brief.json)
- [Detailed run record](demo-run.json)

Project `801c6eaf-2371-499c-89f7-1136a3a4f675` — **Live demo · Direct 3D home**, revision 3, “Yellow Aperture House”: 125 elements, two floors and 13 named spaces. Select this saved project in the local app at http://127.0.0.1:3100.

The full render/export completed. Basic browser walking, mouse capture and Escape passed. All furniture and lights survived the incremental correction unchanged.

**This is a rough prototype, not an approved final design.** Enclosure, opening details and visual quality still need refinement. The last Critic request stalled and was stopped after the corrected model and review previews were saved; the project remains in review. No exterior-red steering run was performed in this direct-generation attempt.

## Earlier image-guided attempt

- [GPT Image 2.5 concept](01-gpt-image-2.5-concept.png)
- [Rejected intermediate 3D render](02-3d-preview-revision-2.png)

Those earlier pictures belong to project `f4056b18-9706-452c-b273-a535b27bb7dd`. Its model did not reproduce the concept adequately. The user then chose direct generation, so the latest result should not be presented as a reconstruction of that image.

Files beginning `04-` and `05-` retain first-pass and corrected actual model previews for comparison. The generated concept is a separate earlier artifact; none of the direct 3D screenshots are generated illustrations.
