import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DesignSchema, recolor, type Design } from '../shared/design';
import { exampleDesign } from '../shared/example';
import { DesignMergeConflict, DesignScopeError, PlanSchema, mergeDesignProposal, readyTasks, validatePlan, type CollaborationPlan, type PlannedTask } from '../shared/collaboration';

function task(id: string, kind: PlannedTask['kind'], dependencies: string[] = []): PlannedTask {
  return { id, kind, agent: kind === 'architecture' ? 'architect' : kind === 'review' ? 'critic' : 'designer', title: id, objective: `Complete ${id}.`, dependencies, deliverables: [`${id} artifact`] };
}
const freshPlan = (): CollaborationPlan => ({ summary: 'Explore a visual direction while architecture develops; combine and review.', tasks: [task('structure', 'architecture'), task('palette', 'visual_direction'), task('furnish', 'interior', ['structure', 'palette']), task('final-review', 'review', ['furnish'])] });
const existingPlan = (): CollaborationPlan => ({ summary: 'Refine architecture and interior independently, then review the merged design.', tasks: [task('structure', 'architecture'), task('furnish', 'interior'), task('final-review', 'review', ['structure', 'furnish'])] });

describe('collaboration task graphs', () => {
  it('makes independent tasks ready together and waits for every dependency', () => {
    const plan = validatePlan(freshPlan(), false);
    expect(readyTasks(plan.tasks, []).map(t => t.id)).toEqual(['structure', 'palette']);
    expect(readyTasks(plan.tasks, ['structure']).map(t => t.id)).toEqual(['palette']);
    expect(readyTasks(plan.tasks, new Set(['structure', 'palette'])).map(t => t.id)).toEqual(['furnish']);
    expect(readyTasks(plan.tasks, ['structure', 'palette', 'furnish']).map(t => t.id)).toEqual(['final-review']);
    expect(readyTasks(plan.tasks, plan.tasks.map(t => t.id))).toEqual([]);
  });

  it('allows canonical writers in the same wave when a design already exists', () => {
    const plan = validatePlan(existingPlan(), true);
    expect(readyTasks(plan.tasks, []).map(t => t.agent)).toEqual(['architect', 'designer']);
    expect(() => validatePlan(plan, false)).toThrow(/depend transitively on architecture/);
  });

  it('accepts transitive architecture dependencies and consumes preliminary reviews', () => {
    const plan = freshPlan();
    plan.tasks.splice(2, 0, task('spatial-review', 'review', ['structure']));
    plan.tasks.find(t => t.kind === 'interior')!.dependencies = ['spatial-review', 'palette'];
    expect(validatePlan(plan, false)).toEqual(plan);
  });

  it.each([
    { name: 'duplicate task IDs', mutate: (p: CollaborationPlan) => { p.tasks[1].id = p.tasks[0].id; } },
    { name: 'unknown dependencies', mutate: (p: CollaborationPlan) => { p.tasks[2].dependencies.push('missing'); } },
    { name: 'self dependencies', mutate: (p: CollaborationPlan) => { p.tasks[0].dependencies.push('structure'); } },
    { name: 'cycles', mutate: (p: CollaborationPlan) => { p.tasks[0].dependencies.push('furnish'); } },
    { name: 'incorrect ownership', mutate: (p: CollaborationPlan) => { p.tasks[0].agent = 'designer'; } },
    { name: 'unsafe step names', mutate: (p: CollaborationPlan) => { p.tasks[0].id = '../outside'; } },
    { name: 'duplicate dependencies', mutate: (p: CollaborationPlan) => { p.tasks[2].dependencies.push('structure'); } },
    { name: 'a missing final review', mutate: (p: CollaborationPlan) => { p.tasks.pop(); } },
    { name: 'an orphan visual study', mutate: (p: CollaborationPlan) => { p.tasks[2].dependencies = ['structure']; } },
    { name: 'an orphan preliminary review', mutate: (p: CollaborationPlan) => { p.tasks.push(task('early-review', 'review', ['structure'])); } },
    { name: 'too many tasks', mutate: (p: CollaborationPlan) => { for (let i = 0; i < 5; i++) p.tasks.push(task(`extra-${i}`, 'visual_direction')); } },
  ])('rejects $name', ({ mutate }) => {
    const plan = freshPlan(); mutate(plan);
    expect(() => validatePlan(plan, false)).toThrow(z.ZodError);
  });

  it('requires canonical work, and both architecture and interior for fresh designs', () => {
    expect(PlanSchema.safeParse({ summary: 'Only discuss.', tasks: [task('palette', 'visual_direction'), task('review', 'review', ['palette'])] }).success).toBe(false);
    for (const kind of ['architecture', 'interior'] as const) {
      const plan = { summary: 'A focused existing-design change.', tasks: [task('work', kind), task('review', 'review', ['work'])] };
      expect(validatePlan(plan, true)).toEqual(plan);
      expect(() => validatePlan(plan, false)).toThrow(z.ZodError);
    }
  });
});

function conflict(work: () => unknown, paths: string[]) {
  try { work(); throw new Error('Expected a merge conflict.'); }
  catch (error) { expect(error).toBeInstanceOf(DesignMergeConflict); expect((error as DesignMergeConflict).paths).toEqual([...paths].sort()); }
}

describe('canonical three-way design merging', () => {
  it('preserves concurrent roof geometry, space planning and roof material edits', () => {
    const base = exampleDesign(), latest = structuredClone(base), proposal = recolor(base, 'roof', '#bb3344');
    latest.elements.find(e => e.id === 'roof')!.position[1] += .8;
    latest.spaces[0].size[0] += .5;
    const originals = structuredClone({ base, latest, proposal });
    const merged = mergeDesignProposal(base, latest, proposal, 'designer');
    expect(merged.elements.find(e => e.id === 'roof')).toEqual({ ...latest.elements.find(e => e.id === 'roof'), materialId: 'custom_roof' });
    expect(merged.materials.find(m => m.id === 'custom_roof')?.color).toBe('#bb3344');
    expect(merged.spaces).toEqual(latest.spaces);
    expect(merged.elements.filter(e => e.id !== 'roof')).toEqual(latest.elements.filter(e => e.id !== 'roof'));
    expect({ base, latest, proposal }).toEqual(originals);
    expect(DesignSchema.safeParse(merged).success).toBe(true);
    // Commit order does not drop a specialist's work.
    expect(mergeDesignProposal(base, proposal, latest, 'architect')).toEqual(merged);
  });

  it('merges different fields of one material and compatible identical changes', () => {
    const base = exampleDesign(), latest = structuredClone(base), proposal = structuredClone(base);
    latest.materials[0].roughness = .4;
    proposal.materials[0].color = '#bb3344';
    expect(mergeDesignProposal(base, latest, proposal, 'designer').materials[0]).toEqual({ ...base.materials[0], roughness: .4, color: '#bb3344' });
    latest.materials[0].color = '#bb3344';
    expect(mergeDesignProposal(base, latest, proposal, 'designer').materials[0]).toEqual(latest.materials[0]);
  });

  it('reports all overlapping fields by stable ID rather than choosing a winner', () => {
    const base = exampleDesign(), latest = structuredClone(base), proposal = structuredClone(base);
    latest.materials[0].color = '#aa1122'; proposal.materials[0].color = '#bb3344';
    latest.elements.find(e => e.id === 'sofa')!.rotation = .2;
    proposal.elements.find(e => e.id === 'sofa')!.rotation = .4;
    conflict(() => mergeDesignProposal(base, latest, proposal, 'designer'), ['/materials/exterior/color', '/elements/sofa/rotation']);
  });

  it('keeps disjoint additions and deletions while preserving current ordering', () => {
    const base = exampleDesign(), latest = structuredClone(base), proposal = structuredClone(base);
    latest.elements.reverse();
    latest.elements = latest.elements.filter(e => e.id !== 'coffee-table');
    latest.elements.push({ ...base.elements.find(e => e.id === 'roof')!, id: 'canopy' });
    proposal.elements.push({ ...base.elements.find(e => e.id === 'sofa')!, id: 'reading-chair', name: 'Reading chair' });
    const merged = mergeDesignProposal(base, latest, proposal, 'designer');
    expect(merged.elements.map(e => e.id)).toEqual([...latest.elements.map(e => e.id), 'reading-chair']);
    expect(merged.elements.find(e => e.id === 'coffee-table')).toBeUndefined();
  });

  it('detects deletion versus change in either commit order', () => {
    const base = exampleDesign(), removed = structuredClone(base), recolored = recolor(base, 'roof', '#cc4455');
    removed.elements = removed.elements.filter(e => e.id !== 'roof');
    conflict(() => mergeDesignProposal(base, removed, recolored, 'designer'), ['/elements/roof']);
    conflict(() => mergeDesignProposal(base, recolored, removed, 'architect'), ['/elements/roof']);
    const twice = mergeDesignProposal(base, removed, removed, 'architect');
    expect(twice.elements.find(e => e.id === 'roof')).toBeUndefined();
  });

  it('rejects different concurrent additions with the same stable ID', () => {
    const base = exampleDesign(), latest = structuredClone(base), proposal = structuredClone(base);
    const furniture = base.elements.find(e => e.id === 'sofa')!;
    latest.elements.push({ ...furniture, id: 'new-chair', name: 'Architect chair' });
    proposal.elements.push({ ...furniture, id: 'new-chair', name: 'Designer chair' });
    conflict(() => mergeDesignProposal(base, latest, proposal, 'designer'), ['/elements/new-chair']);
    proposal.elements[proposal.elements.length - 1] = structuredClone(latest.elements.at(-1)!);
    expect(mergeDesignProposal(base, latest, proposal, 'designer').elements.filter(e => e.id === 'new-chair')).toHaveLength(1);
  });

  it('catches references invalidated by a concurrent material deletion', () => {
    const base = exampleDesign(), latest = structuredClone(base), proposal = structuredClone(base);
    latest.materials = latest.materials.filter(m => m.id !== 'oak');
    for (const element of latest.elements) if (element.materialId === 'oak') element.materialId = 'concrete';
    proposal.elements.push({ ...base.elements.find(e => e.id === 'sofa')!, id: 'new-chair', materialId: 'oak' });
    expect(DesignSchema.safeParse(latest).success).toBe(true);
    expect(DesignSchema.safeParse(proposal).success).toBe(true);
    conflict(() => mergeDesignProposal(base, latest, proposal, 'designer'), ['/elements/new-chair/materialId']);
    proposal.elements.at(-1)!.materialId = 'missing';
    expect(() => mergeDesignProposal(base, latest, proposal, 'designer')).toThrow(z.ZodError);
  });

  it('validates cross-collection ID uniqueness and combined schema limits', () => {
    const base = exampleDesign(), latest = structuredClone(base), proposal = structuredClone(base);
    latest.spaces.push({ ...base.spaces[0], id: 'new-feature' });
    proposal.materials.push({ ...base.materials[0], id: 'new-feature' });
    conflict(() => mergeDesignProposal(base, latest, proposal, 'designer'), ['/spaces/new-feature', '/materials/new-feature']);
    const crowded = exampleDesign();
    while (crowded.materials.length < 79) crowded.materials.push({ ...crowded.materials[0], id: `extra-${crowded.materials.length}` });
    const a = structuredClone(crowded), b = structuredClone(crowded);
    a.materials.push({ ...a.materials[0], id: 'architect-material' });
    b.materials.push({ ...b.materials[0], id: 'designer-material' });
    conflict(() => mergeDesignProposal(crowded, a, b, 'designer'), ['/materials']);
  });

  it('allows only the architect to create the first design and rejects stale initial replacements', () => {
    const first = exampleDesign();
    expect(mergeDesignProposal(null, null, first, 'architect')).toEqual(first);
    expect(mergeDesignProposal(null, first, first, 'architect')).toEqual(first);
    expect(() => mergeDesignProposal(null, null, first, 'designer')).toThrow(DesignScopeError);
    const different = structuredClone(first); different.title = 'Another house';
    conflict(() => mergeDesignProposal(null, first, different, 'architect'), ['/']);
    conflict(() => mergeDesignProposal(first, null, first, 'architect'), ['/']);
    for (const agent of ['principal', 'critic'] as const) expect(() => mergeDesignProposal(first, first, first, agent)).toThrow(DesignScopeError);
  });

  it('requires reconciliation if a furniture element became architecture while the designer worked', () => {
    const base = exampleDesign(), latest = structuredClone(base), proposal = structuredClone(base);
    latest.elements.find(e => e.id === 'sofa')!.kind = 'wall';
    proposal.elements.find(e => e.id === 'sofa')!.position[0] += 1;
    conflict(() => mergeDesignProposal(base, latest, proposal, 'designer'), ['/elements/sofa/position']);
  });
});

describe('designer ownership', () => {
  it('permits materials, structural finishes, furniture and lights', () => {
    const base = exampleDesign(), proposal = recolor(base, 'roof', '#aa4455');
    proposal.elements.find(e => e.id === 'sofa')!.position[0] += 1;
    proposal.elements = proposal.elements.filter(e => e.id !== 'coffee-table');
    proposal.elements.push({ ...base.elements.find(e => e.id === 'sofa')!, id: 'reading-light', kind: 'light', name: 'Reading light' });
    expect(mergeDesignProposal(base, base, proposal, 'designer')).toEqual(proposal);
  });

  it.each([
    { path: '/elements/roof/position', mutate: (d: Design) => { d.elements.find(e => e.id === 'roof')!.position[1] += .5; } },
    { path: '/elements/roof/kind', mutate: (d: Design) => { d.elements.find(e => e.id === 'roof')!.kind = 'furniture'; } },
    { path: '/elements/roof', mutate: (d: Design) => { d.elements = d.elements.filter(e => e.id !== 'roof'); } },
    { path: '/elements/new-wall', mutate: (d: Design) => { d.elements.push({ ...d.elements.find(e => e.kind === 'wall')!, id: 'new-wall' }); } },
    { path: '/elements/sofa/kind', mutate: (d: Design) => { d.elements.find(e => e.id === 'sofa')!.kind = 'wall'; } },
    { path: '/spaces', mutate: (d: Design) => { d.spaces[0].size[0] += 1; } },
    { path: '/floors', mutate: (d: Design) => {
      d.floors = 2;
      d.spaces.push({ id: 'upper-lounge', name: 'Upper lounge', floor: 1, position: [-3.5, 4.5, 0], size: [6.5, 3, 9] });
    } },
    { path: '/spawn', mutate: (d: Design) => { d.spawn[0] += 1; } },
    { path: '/notes', mutate: (d: Design) => { d.notes.push('A different architectural direction.'); } },
  ])('rejects an out-of-role edit at $path', ({ path, mutate }) => {
    const base = exampleDesign(), proposal = structuredClone(base); mutate(proposal);
    expect(() => DesignSchema.parse(proposal)).not.toThrow();
    try { mergeDesignProposal(base, base, proposal, 'designer'); throw new Error('Expected ownership enforcement.'); }
    catch (error) {
      expect(error).toBeInstanceOf(DesignScopeError);
      expect((error as DesignScopeError).paths).toContain(path);
      if (path === '/floors') expect((error as DesignScopeError).paths).toContain('/spaces');
    }
  });
});
