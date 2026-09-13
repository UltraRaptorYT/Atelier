import { describe, expect, it } from 'vitest';
import { DesignSchema } from '../shared/design';
import { exampleDesign } from '../shared/example';
import { designContext } from '../worker/src/design-context';

describe('compact agent planning context', () => {
  it('preserves every bounded room, material and design note with targeting IDs', () => {
    const design = exampleDesign();
    design.notes = ['Keep the ARCHITECT_COURTYARD connection.', 'The accepted red finish overrides the original yellow palette.'];
    const summary = designContext(design, 'front-left')!;
    expect(summary.spaces).toEqual(design.spaces);
    expect(summary.materials).toEqual(design.materials);
    expect(summary.notes).toEqual(design.notes);
    expect(summary.spawn).toEqual(design.spawn);
    expect(summary).toMatchObject({ schemaVersion: 1, units: 'meters', title: design.title, buildingType: design.buildingType, floors: design.floors, selectedElementId: 'front-left' });
    const selected = design.elements.find(element => element.id === 'front-left')!;
    expect(summary.selectedElement).toEqual({ ...selected, geometry: null });
    expect(summary.counts.elements).toBe(design.elements.length);
    expect(summary.counts.byKind.wall).toBe(design.elements.filter(element => element.kind === 'wall').length);
    expect(summary).not.toHaveProperty('elements');
  });

  it('keeps detailed mesh arrays out of prompts while retaining accurate geometry counts', () => {
    const design = exampleDesign();
    const vertices = Array.from({ length: 300 }, (_, index) => [index % 3 === 1 ? .5 : -.5, index % 3 === 2 ? .5 : -.5, 0] as [number, number, number]);
    const triangles = Array.from({ length: 100 }, (_, index) => [index * 3, index * 3 + 1, index * 3 + 2]);
    design.elements = Array.from({ length: 100 }, (_, index) => ({ ...design.elements[0], id: `mesh_${index}`, geometry: { type: 'mesh', vertices, triangles } }));
    DesignSchema.parse(design);
    const summary = designContext(design, 'mesh_50')!;
    expect(summary.counts).toMatchObject({ elements: 100, meshes: 100, vertices: 30000, triangles: 10000 });
    expect(summary.selectedElement).toMatchObject({ id: 'mesh_50', geometry: { type: 'mesh', vertexCount: 300, triangleCount: 100 } });
    expect(summary.selectedElement?.geometry).not.toHaveProperty('vertices');
    expect(summary.selectedElement?.geometry).not.toHaveProperty('triangles');
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(design).length / 20);
    expect(JSON.stringify(summary).length).toBeLessThan(12000);
  });

  it('never mutates canonical data or exposes mutable aliases', () => {
    const design = exampleDesign(), original = structuredClone(design);
    const summary = designContext(design, design.elements[0].id)!;
    summary.spaces[0].position[0] = 99;
    summary.materials[0].color = '#123456';
    summary.notes.push('Only this prompt copy changes.');
    summary.spawn[1] = 5;
    summary.selectedElement!.size[0] = 10;
    expect(design).toEqual(original);
  });

  it('handles a new project and missing selections without inventing geometry', () => {
    expect(designContext(null, 'not-created')).toBeNull();
    const design = exampleDesign();
    expect(designContext(design)).toMatchObject({ selectedElementId: null, selectedElement: null });
    expect(designContext(design, 'missing')).toMatchObject({ selectedElementId: 'missing', selectedElement: null });
  });
});
