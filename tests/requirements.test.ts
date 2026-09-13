import { describe, expect, it } from 'vitest';
import type { Brief, ChangeRecord } from '../shared/design';
import { buildEffectiveRequirements, requirementsPrompt } from '../shared/requirements';

const brief: Brief = { request: 'A yellow house for four people.', summary: 'Yellow house', goals: ['Yellow exterior'], constraints: ['Four occupants'], questions: [] };
const change = (id: string, instruction: string, revision: number | null, status: ChangeRecord['status'] = 'applied'): ChangeRecord => ({
  id, instruction, agent: 'designer', elementId: null, baseRevision: 0, referenceArtifactId: null,
  status, createdAt: '2026-09-13T00:00:00Z', startedAt: null,
  appliedRevision: revision, appliedAt: revision === null ? null : `2026-09-13T00:0${revision}:00Z`,
  reviewedAt: null, reviewedRevision: null, reviewSummary: null, reviewFindings: [], reviewArtifactId: null, failureDetail: null,
});

describe('authoritative requirements history', () => {
  it('preserves the original brief and orders applied feedback without losing older requirements', () => {
    const records = Array.from({ length: 105 }, (_, i) => change(`change-${i}`, i === 0 ? 'Make the exterior red instead of yellow.' : `Keep feature ${i}.`, i + 1));
    const result = buildEffectiveRequirements(brief, 105, records.reverse());
    expect(result.amendments).toHaveLength(105);
    expect(result.amendments[0].instruction).toBe('Make the exterior red instead of yellow.');
    expect(result.brief).toEqual(brief);
    result.brief.goals.push('An unrelated caller edit');
    expect(brief.goals).toEqual(['Yellow exterior']);
  });

  it('excludes unapplied, future and current-run feedback while retaining work applied before stopping', () => {
    const result = buildEffectiveRequirements(brief, 4, [
      change('queued', 'Add a pool.', null, 'pending'),
      change('failed', 'Add a tower.', null, 'failed'),
      change('cancelled', 'Remove all rooms.', null, 'cancelled'),
      change('applied-before-stop', 'Make the roof red.', 2, 'cancelled'),
      change('review-failed', 'Make the sofa blue.', 3, 'failed'),
      change('current', 'Add a balcony.', 4),
      change('future', 'Make the roof green.', 5),
    ], 'current');
    expect(result.amendments.map(item => item.id)).toEqual(['applied-before-stop', 'review-failed']);
  });

  it('carries target IDs and defines scoped precedence over the original brief and older images', () => {
    const red = { ...change('red', 'Make this red.', 1), elementId: 'roof', referenceArtifactId: 'red-reference.png' };
    const requirements = buildEffectiveRequirements(brief, 1, [red]);
    const prompt = requirementsPrompt(requirements, { instruction: 'Add a balcony.', elementId: null });
    expect(requirements.amendments[0]).toMatchObject({ elementId: 'roof', referenceArtifactId: 'red-reference.png' });
    expect(prompt).toContain('only where their subject and scope overlap');
    expect(prompt).toContain('preserve all unrelated requirements');
    expect(prompt).toContain('Never restore a superseded requirement');
    expect(prompt).toContain('Add a balcony.');
    expect(prompt).toContain('Make this red.');
  });
});
