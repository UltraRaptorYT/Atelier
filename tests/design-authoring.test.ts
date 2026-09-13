import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DesignSchema, type DesignElement } from '../shared/design';
import { DesignEditsSchema, applyDesignEdits } from '../shared/design-edits';
import { geometryParts } from '../shared/geometry';

function python<T = any>(body: string): T {
  return JSON.parse(execFileSync('python3', ['-c', `import json, math\nfrom scripts.design_authoring import *\n${body}`], { encoding: 'utf8' }));
}
function bounds(element: DesignElement, axis: number) {
  return [element.position[axis] - element.size[axis] / 2, element.position[axis] + element.size[axis] / 2];
}
function overlap(a: number[], b: number[]) { return Math.min(a[1], b[1]) - Math.max(a[0], b[0]); }
function documentedCandidate() {
  const guide = readFileSync('prompts/proposal-guide.md', 'utf8');
  const program = [...guide.matchAll(/```python\n([\s\S]*?)```/g)][0][1]
    .replace('from design_authoring import *', 'from scripts.design_authoring import *')
    .replace('write_proposal(proposal)', 'print(json.dumps(proposal))');
  return python(program);
}

describe('canonical construction helpers', () => {
  it('builds actual wall holes with continuous headers, sills and end piers', () => {
    const elements = python<DesignElement[]>(`print(json.dumps(wall_with_openings('front', [-4,-3], [4,-3], 0, 3, .2, 'wall', [dict(id='door',offset=1,width=1.2,bottom=0,height=2.2),dict(id='window',offset=4,width=2,bottom=.8,height=1.5)])))`);
    const occupied = (x: number, y: number) => elements.some(e => x > bounds(e, 0)[0] && x < bounds(e, 0)[1] && y > bounds(e, 1)[0] && y < bounds(e, 1)[1]);
    expect(occupied(-2.4, 1)).toBe(false); // Real entrance hole.
    expect(occupied(1, 1.6)).toBe(false); // Real glazing hole.
    expect(occupied(-2.4, 2.6)).toBe(true); // Door header retained.
    expect(occupied(1, .4)).toBe(true); // Window sill retained.
    expect(occupied(-3.5, 1.5)).toBe(true); // Left pier retained.
    expect(occupied(3, 1.5)).toBe(true); // Right pier retained.
    expect(elements.reduce((sum, e) => sum + e.size[0] * e.size[1] * e.size[2], 0)).toBeCloseTo((8 * 3 - 1.2 * 2.2 - 2 * 1.5) * .2);
  });

  it('places diagonal walls in the same yaw convention as the canonical renderer', () => {
    const elements = python<DesignElement[]>(`print(json.dumps(wall_with_openings('diagonal', [1,2], [5,6], 0, 3, .2, 'wall', [dict(id='door',offset=1,width=1,bottom=0,height=2.2)])))`);
    for (const e of elements) {
      expect(e.rotation).toBeCloseTo(-Math.PI / 4);
      expect(e.position[0] - 1).toBeCloseTo(e.position[2] - 2);
    }
    const [solid] = elements;
    expect(solid.position[0] - Math.cos(solid.rotation) * solid.size[0] / 2).toBeCloseTo(1);
    expect(solid.position[2] + Math.sin(solid.rotation) * solid.size[0] / 2).toBeCloseTo(2);
  });

  it('rejects overlapping, oversized, headerless and sub-centimetre wall apertures', () => {
    const outcomes = python<string[]>(`cases = [
 [dict(id='a',offset=1,width=2,bottom=0,height=2),dict(id='b',offset=2,width=2,bottom=.5,height=2)],
 [dict(id='a',offset=7,width=2,bottom=0,height=2)],
 [dict(id='a',offset=1,width=2,bottom=1,height=2)],
 [dict(id='a',offset=.005,width=2,bottom=0,height=2)],
 [dict(id='a',offset=1,width=-1,bottom=0,height=2)]]
results=[]
for openings in cases:
 try:
  wall_with_openings('wall',[0,0],[8,0],0,3,.2,'mat',openings)
  results.append('unexpected success')
 except ValueError as error: results.append(str(error))
print(json.dumps(results))`);
    expect(outcomes).toHaveLength(5);
    expect(outcomes.every(value => value !== 'unexpected success')).toBe(true);
    expect(outcomes[0]).toMatch(/overlap/);
    expect(outcomes[2]).toMatch(/header/);
  });

  it('keeps window frames opaque and separates glazing from the clear frame members', () => {
    const elements = python<DesignElement[]>(`print(json.dumps(window_assembly('window',[0,0],[8,0],0,3,dict(id='window',offset=2,width=2,bottom=.8,height=1.5),'timber','glass',mullions=2)))`);
    const panes = elements.filter(e => e.kind === 'window'), frames = elements.filter(e => e.kind === 'wall');
    expect(panes).toHaveLength(3);
    expect(frames).toHaveLength(6);
    expect(frames.every(e => e.materialId === 'timber')).toBe(true);
    for (const pane of panes) for (const frame of frames) {
      expect(Math.min(overlap(bounds(pane, 0), bounds(frame, 0)), overlap(bounds(pane, 1), bounds(frame, 1)))).toBeLessThanOrEqual(1e-8);
    }
    expect(elements.every(e => bounds(e, 0)[0] >= 2 - 1e-8 && bounds(e, 0)[1] <= 4 + 1e-8)).toBe(true);
  });

  it('opens the door leaf around its jamb instead of rotating it across the entrance', () => {
    const elements = python<DesignElement[]>(`print(json.dumps(door_assembly('entry',[0,0],[8,0],0,3,dict(id='entry',offset=1,width=1.2,bottom=0,height=2.2),'timber','timber'))) `);
    const leaf = elements.find(e => e.kind === 'door')!;
    expect(leaf.rotation).toBeCloseTo(Math.PI / 2);
    expect(leaf.position[0]).toBeCloseTo(1.05);
    expect(leaf.position[2]).toBeCloseTo(-.55);
    expect(leaf.size[0]).toBeCloseTo(1.1);
    expect(bounds(leaf, 1)[0]).toBeCloseTo(0);
  });

  it('cuts upper slabs around the entire stair flight and its independently authored landing', () => {
    const result = python<{ stairs: { elements: DesignElement[]; risers: number; upper_y: number; upper_void: { size: number[] } }; slabs: DesignElement[] }>(`stairs=staircase_with_landing('stair',[-2,-4],0,3.06,1.1,'timber')
slabs=slab_with_voids('upper',[0,0],[10,14],stairs['upper_y'],.2,'stone',[stairs['upper_void'],stairs['landing_void']],floor=1)
print(json.dumps(dict(stairs=stairs,slabs=slabs)))`);
    const [flight, landing] = result.stairs.elements;
    expect(result.stairs.elements.filter(e => e.kind === 'stair')).toHaveLength(1);
    expect(geometryParts(flight)).toHaveLength(result.stairs.risers);
    expect(bounds(flight, 2)[1]).toBeCloseTo(bounds(landing, 2)[0]);
    expect(bounds(landing, 1)[1]).toBeCloseTo(result.stairs.upper_y);
    for (const slab of result.slabs) for (const stair of [flight, landing]) {
      expect(Math.min(overlap(bounds(slab, 0), bounds(stair, 0)), overlap(bounds(slab, 2), bounds(stair, 2)))).toBeLessThanOrEqual(1e-8);
    }
    const coveredArea = [...result.slabs, landing].reduce((sum, e) => sum + e.size[0] * e.size[2], 0);
    expect(coveredArea).toBeCloseTo(140 - flight.size[0] * flight.size[2]);
  });

  it('rejects overlapping/out-of-bounds slab voids and unusably steep stairs', () => {
    const failures = python<string[]>(`cases = [
 lambda: slab_with_voids('slab',[0,0],[8,8],3,.2,'stone',[dict(id='a',position=[0,0],size=[2,2]),dict(id='b',position=[1,0],size=[2,2])]),
 lambda: slab_with_voids('slab',[0,0],[8,8],3,.2,'stone',[dict(id='a',position=[4,0],size=[2,2])]),
 lambda: slab_with_voids('slab',[0,0],[8,8],3,.2,'stone',[dict(id='a',position=[0,0],size=[8,8])]),
 lambda: staircase_with_landing('stair',[0,0],0,3,1.1,'wood',run=2),
 lambda: staircase_with_landing('stair',[0,0],0,3,.4,'wood')]
results=[]
for build in cases:
 try: build(); results.append('unexpected success')
 except ValueError as error: results.append(str(error))
print(json.dumps(results))`);
    expect(failures.every(message => message !== 'unexpected success')).toBe(true);
    expect(failures[0]).toMatch(/overlap/);
    expect(failures[1]).toMatch(/outside/);
    expect(failures[2]).toMatch(/entire/);
  });

  it('keeps expressive roofs as thin, closed meshes with outward-facing triangles', () => {
    const elements = python<DesignElement[]>(`print(json.dumps(pitched_roof('roof',[0,0],[8,6],3.12,4.32,'metal',ridge_offset=1)))`);
    expect(elements).toHaveLength(2);
    const vertexSets: number[][][] = [];
    for (const element of elements) {
      const g = element.geometry!;
      expect(g.type).toBe('mesh');
      expect(g.vertices.every(v => v.every(n => n >= -.5 - 1e-8 && n <= .5 + 1e-8))).toBe(true);
      const vertices = g.vertices.map(v => v.map((n, i) => n * element.size[i] + element.position[i]));
      vertexSets.push(vertices);
      const volume = g.triangles.reduce((sum, face) => {
        const [a, b, c] = face.map(index => vertices[index]);
        return sum + (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      }, 0);
      expect(volume).toBeCloseTo(element.size[0] * 6 * .12);
      expect(volume).toBeLessThan(element.size[0] * element.size[1] * element.size[2] / 5);
    }
    for (const vertices of vertexSets) expect(vertices.some(v => Math.abs(v[0] - 1) < 1e-8 && Math.abs(v[1] - 4.32) < 1e-8)).toBe(true);
  });

  it('validates the documented complete example without stripping authored geometry or materials', () => {
    const raw = documentedCandidate(), parsed = DesignSchema.parse(raw);
    expect(parsed).toEqual(raw);
    expect(parsed.elements.filter(e => e.geometry).length).toBeGreaterThanOrEqual(4);
    expect(parsed.materials.find(m => m.id === 'timber')?.opacity).toBe(1);
    expect(parsed.materials.find(m => m.id === 'glass')?.transmission).toBe(.6);
    expect(parsed.elements.find(e => e.id === 'entry_leaf')?.kind).toBe('door');
  });

  it('produces an explicit finish edit that preserves all unrelated geometry, IDs and notes', () => {
    const base = DesignSchema.parse(documentedCandidate());
    const proposal = python(`proposal=empty_edits()\nproposal['materials']['upsert']=[material('timber','#a6352f')]\nprint(json.dumps(proposal))`);
    const result = applyDesignEdits(base, DesignEditsSchema.parse(proposal));
    expect(result.elements).toEqual(base.elements);
    expect(result.spaces).toEqual(base.spaces);
    expect(result.notes).toEqual(base.notes);
    expect(result.materials.find(m => m.id === 'timber')?.color).toBe('#a6352f');
    expect(result.materials.filter(m => m.id !== 'timber')).toEqual(base.materials.filter(m => m.id !== 'timber'));
  });
});
