import { describe, expect, it } from 'vitest';
import { DesignSchema, type Design } from '../shared/design';
import { applyDesignEdits, DesignEditsSchema, type DesignEdits } from '../shared/design-edits';
import { DesignMergeConflict, DesignScopeError, mergeDesignProposal } from '../shared/collaboration';
import { exampleDesign } from '../shared/example';
import { modelResponseSchema } from '../worker/src/model-schema';
import { toStrictJsonSchema } from 'openai/lib/transform';

const empty = (): DesignEdits => ({ elements: { upsert: [], remove: [] }, materials: { upsert: [], remove: [] }, spaces: { upsert: [], remove: [] }, metadata: { title: null, buildingType: null, floors: null, spawn: null, notes: null } });
function house(): Design {
  const base = exampleDesign();
  base.elements.push({ ...base.elements[1], id: 'bath-wall', name: 'Bathroom partition', position: [2, 1.5, 2], size: [.18, 3, 2] });
  base.elements.push({ ...base.elements[1], id: 'ceiling-light', kind: 'light', name: 'Ceiling light', position: [0, 2.8, 0], size: [.5, .1, .5] });
  return DesignSchema.parse(base);
}
const registered = { id: 'registered-lamp', name: 'Original lamp', artifactId: 'task-lamp.glb', author: 'Project specialist', license: 'Original project geometry' };

describe('explicit canonical design edits', () => {
  it('repairs a bathroom wall while preserving every unmentioned facade, window, furniture and light exactly', () => {
    const base = house(), snapshot = structuredClone(base), edits = empty();
    edits.elements.upsert = [{ ...base.elements.find(element => element.id === 'bath-wall')!, size: [.18, 3, 1.2] }];
    const proposal = applyDesignEdits(base, edits);
    expect(proposal.elements).toHaveLength(base.elements.length);
    expect(proposal.elements.find(element => element.id === 'bath-wall')!.size).toEqual([.18, 3, 1.2]);
    for (const element of base.elements.filter(element => element.id !== 'bath-wall')) expect(proposal.elements.find(item => item.id === element.id)).toEqual(element);
    expect(proposal).toEqual({ ...base, elements: base.elements.map(element => element.id === 'bath-wall' ? edits.elements.upsert[0] : element) });
    expect(base).toEqual(snapshot);
    expect(mergeDesignProposal(base, base, proposal, 'architect')).toEqual(proposal);
  });

  it('deletes only explicitly named entries and appends new records without reordering untouched IDs', () => {
    const base = house(), edits = empty();
    base.materials.push({ ...base.materials[0], id: 'unused-finish' });
    edits.elements.remove = ['bath-wall']; edits.materials.remove = ['unused-finish']; edits.spaces.remove = ['dining'];
    edits.elements.upsert = [{ ...base.elements[1], id: 'new-partition' }];
    const result = applyDesignEdits(base, edits);
    expect(result.elements.map(element => element.id)).toEqual([...base.elements.filter(element => element.id !== 'bath-wall').map(element => element.id), 'new-partition']);
    expect(result.materials).toEqual(base.materials.filter(material => material.id !== 'unused-finish'));
    expect(result.spaces).toEqual(base.spaces.filter(space => space.id !== 'dining'));
  });

  it.each(['elements', 'materials', 'spaces'] as const)('rejects unknown or ambiguous deletes in %s', collection => {
    const edits = empty(); edits[collection].remove = ['missing'];
    expect(() => applyDesignEdits(house(), edits)).toThrow(/unknown/);
    edits[collection].remove = ['missing', 'missing'];
    expect(DesignEditsSchema.safeParse(edits).success).toBe(false);
    const base = house(); edits[collection].remove = [base[collection][0].id];
    (edits[collection].upsert as Array<{ id: string }>).push(base[collection][0]);
    expect(DesignEditsSchema.safeParse(edits).success).toBe(false);
  });

  it('rejects duplicate upserts and bounded batch overflow', () => {
    const edits = empty(), wall = house().elements[1];
    edits.elements.upsert = [wall, wall];
    expect(DesignEditsSchema.safeParse(edits).success).toBe(false);
    edits.elements.upsert = Array.from({ length: 201 }, (_, index) => ({ ...wall, id: `wall-${index}` }));
    expect(DesignEditsSchema.safeParse(edits).success).toBe(false);
  });

  it('retains canonical cross-record, tuple and floor validation after applying edits', () => {
    const base = house(), edits = empty();
    edits.materials.remove = ['exterior'];
    expect(() => applyDesignEdits(base, edits)).toThrow(/Unknown material/);
    edits.materials.remove = []; edits.spaces.remove = base.spaces.map(space => space.id);
    expect(() => applyDesignEdits(base, edits)).toThrow();
    edits.spaces.remove = []; edits.metadata.floors = 2;
    expect(() => applyDesignEdits(base, edits)).toThrow(/Each declared floor/);
    edits.metadata.floors = null; edits.elements.upsert = [{ ...base.elements[1], position: [0, 51, 0] }];
    expect(() => applyDesignEdits(base, edits)).toThrow();
    expect(DesignSchema.parse(base)).toEqual(base);
  });

  it('preserves null metadata and applies explicit values, including empty notes', () => {
    const base = house(), edits = empty();
    expect(applyDesignEdits(base, edits)).toEqual(base);
    edits.metadata.title = 'Revised bathroom'; edits.metadata.notes = [];
    expect(applyDesignEdits(base, edits)).toEqual({ ...base, title: 'Revised bathroom', notes: [] });
  });

  it('keeps unrelated concurrent changes and still detects overlapping modifications', () => {
    const base = house(), edits = empty(), latest = structuredClone(base);
    edits.elements.upsert = [{ ...base.elements.find(element => element.id === 'bath-wall')!, size: [.18, 3, 1.2] }];
    latest.elements.find(element => element.id === 'sofa')!.position = [-2, .45, 0];
    const proposal = applyDesignEdits(base, edits), merged = mergeDesignProposal(base, latest, proposal, 'architect');
    expect(merged.elements.find(element => element.id === 'sofa')).toEqual(latest.elements.find(element => element.id === 'sofa'));
    latest.elements.find(element => element.id === 'bath-wall')!.size = [.18, 3, 1.8];
    expect(() => mergeDesignProposal(base, latest, proposal, 'architect')).toThrow(DesignMergeConflict);
  });
});

describe('edit ownership and trusted assets', () => {
  it('allows a Designer furniture edit but rejects structural edits, deletes and metadata changes', () => {
    const base = house(), edits = empty();
    edits.elements.upsert = [{ ...base.elements.find(element => element.id === 'sofa')!, position: [-2, .45, 0] }];
    expect(() => mergeDesignProposal(base, base, applyDesignEdits(base, edits), 'designer')).not.toThrow();
    edits.elements.upsert = [{ ...base.elements.find(element => element.id === 'bath-wall')!, size: [.18, 3, 1.2] }];
    expect(() => mergeDesignProposal(base, base, applyDesignEdits(base, edits), 'designer')).toThrow(DesignScopeError);
    edits.elements.upsert = []; edits.elements.remove = ['bath-wall'];
    expect(() => mergeDesignProposal(base, base, applyDesignEdits(base, edits), 'designer')).toThrow(DesignScopeError);
    edits.elements.remove = []; edits.metadata.title = 'Unauthorized title';
    expect(() => mergeDesignProposal(base, base, applyDesignEdits(base, edits), 'designer')).toThrow(DesignScopeError);
  });

  it('rejects a model-supplied asset registry and unknown asset references', () => {
    const base = house(), edits = empty();
    expect(DesignEditsSchema.safeParse({ ...edits, assets: [registered] }).success).toBe(false);
    edits.elements.upsert = [{ ...base.elements.find(element => element.id === 'ceiling-light')!, assetId: registered.id }];
    expect(() => applyDesignEdits(base, edits)).toThrow(/Unknown asset/);
    const valid = applyDesignEdits(base, edits, [registered]);
    expect(valid.assets).toEqual([registered]);
    expect(() => mergeDesignProposal(base, base, valid, 'designer')).not.toThrow();
  });

  it('allows only append-only Designer registry entries referenced by owned furniture or lights', () => {
    const base = house(); base.assets = [{ ...registered, id: 'previous-asset' }];
    const edits = empty(); edits.elements.upsert = [{ ...base.elements.find(element => element.id === 'sofa')!, assetId: registered.id }];
    const valid = applyDesignEdits(base, edits, [registered]);
    expect(valid.assets).toEqual([...base.assets, registered]);
    expect(() => mergeDesignProposal(base, base, valid, 'designer')).not.toThrow();
    const rewritten = structuredClone(valid); rewritten.assets[0].artifactId = 'untrusted-replacement.glb';
    expect(() => mergeDesignProposal(base, base, rewritten, 'designer')).toThrow(DesignScopeError);
    const removed = structuredClone(valid); removed.assets.shift();
    expect(() => mergeDesignProposal(base, base, removed, 'designer')).toThrow(DesignScopeError);
    expect(() => mergeDesignProposal(base, base, applyDesignEdits(base, empty(), [registered]), 'designer')).toThrow(DesignScopeError);
    const structural = empty(); structural.elements.upsert = [{ ...base.elements[1], assetId: registered.id }];
    expect(() => mergeDesignProposal(base, base, applyDesignEdits(base, structural, [registered]), 'designer')).toThrow(DesignScopeError);
    expect(() => applyDesignEdits(base, empty(), [{ ...base.assets[0], artifactId: 'replacement.glb' }])).toThrow(/Duplicate ID/);
  });

  it('produces a strict OpenAI-compatible edit schema including nullable XYZ metadata', () => {
    const wire = modelResponseSchema(DesignEditsSchema);
    expect(() => toStrictJsonSchema(wire)).not.toThrow();
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(visit);
      const record = value as Record<string, unknown>;
      expect(record).not.toHaveProperty('prefixItems'); expect(record).not.toHaveProperty('additionalItems');
      if (record.type === 'array') { expect(typeof record.items).toBe('object'); expect(Array.isArray(record.items)).toBe(false); }
      if (record.type === 'object') expect(record.additionalProperties).toBe(false);
      Object.values(record).forEach(visit);
    };
    visit(wire);
    expect(wire).not.toHaveProperty('properties.assets');
    expect(DesignEditsSchema.safeParse(empty()).success).toBe(true);
  });
});
