import type { Design } from '../../shared/design';

/** Planning context, not an editable scene or a substitute for read_design. */
export function designContext(design: Design | null, selectedElementId?: string | null) {
  if (!design) return null;
  const byKind: Record<string, number> = {};
  let meshes = 0, vertices = 0, triangles = 0;
  for (const element of design.elements) {
    byKind[element.kind] = (byKind[element.kind] || 0) + 1;
    if (element.geometry) {
      meshes++;
      vertices += element.geometry.vertices.length;
      triangles += element.geometry.triangles.length;
    }
  }
  const selected = selectedElementId ? design.elements.find(element => element.id === selectedElementId) : undefined;
  let selectedElement = null;
  if (selected) {
    const { geometry, ...properties } = selected;
    selectedElement = {
      ...properties,
      geometry: geometry ? { type: geometry.type, vertexCount: geometry.vertices.length, triangleCount: geometry.triangles.length } : null,
    };
  }
  // These registries are schema-bounded (40 rooms, 80 materials, 30 notes).
  // Element meshes can be large; only counts and the requested element's
  // ordinary properties belong in this prompt. The exact geometry stays in
  // the assigned canonical file and persistent dependency artifacts.
  return structuredClone({
    schemaVersion: design.schemaVersion, units: design.units,
    title: design.title, buildingType: design.buildingType, floors: design.floors,
    spaces: design.spaces, materials: design.materials, notes: design.notes, spawn: design.spawn,
    counts: { elements: design.elements.length, assets: design.assets.length, byKind, meshes, vertices, triangles },
    selectedElementId: selectedElementId || null, selectedElement,
  });
}
