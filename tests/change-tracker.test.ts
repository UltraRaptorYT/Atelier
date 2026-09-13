import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ChangeTracker, { RequirementsHistory } from '../components/ChangeTracker';
import type { ChangeRecord } from '../shared/design';
import { buildEffectiveRequirements } from '../shared/requirements';

const queued: ChangeRecord = {
  id: 'change-1', instruction: 'Make the roof red.', agent: 'designer', elementId: 'roof', baseRevision: 2,
  referenceArtifactId: null, status: 'pending', createdAt: '2026-09-13T01:00:00.000Z', startedAt: null,
  appliedAt: null, appliedRevision: null, reviewedAt: null, reviewedRevision: null, reviewSummary: null,
  reviewFindings: [], reviewArtifactId: null, failureDetail: null,
};
const applied: ChangeRecord = { ...queued, status: 'applied', startedAt: '2026-09-13T01:01:00.000Z', appliedAt: '2026-09-13T01:02:00.000Z', appliedRevision: 3 };
const render = (changes: ChangeRecord[], activeRunId: string | null = null) => renderToStaticMarkup(createElement(ChangeTracker, { projectId: 'project-1', changes, design: null, activeRunId }));

describe('change tracker evidence', () => {
  it('shows durable request scope and explicitly queues feedback behind existing work', () => {
    const output = render([queued], 'earlier-run');
    expect(output).toContain('Make the roof red.');
    expect(output).toContain('(roof)');
    expect(output).toContain('after the current run finishes');
    expect(output).not.toContain('Download revision');
    expect(output).not.toContain('Critic review recorded');
  });

  it('does not claim a request is waiting behind its own run', () => {
    expect(render([queued], queued.id)).toContain('waiting for work to start');
    expect(render([queued], queued.id)).not.toContain('after the current run finishes');
  });

  it('does not turn application into a completed review', () => {
    const output = render([applied]);
    expect(output).toContain('Applied · awaiting review');
    expect(output).toContain('A completed Critic review has not been recorded yet.');
    expect(output).toContain('/api/studio/projects/project-1/revisions/3');
    expect(output).not.toContain('No findings were recorded');
    expect(output).not.toContain('Read saved review');
  });

  it('does not present an unsupported historical applied status as a verified milestone', () => {
    const output = render([{ ...queued, status: 'applied' }]);
    expect(output).toContain('History incomplete');
    expect(output).toContain('Its saved revision cannot be verified from this history.');
    expect(output).not.toContain('Applied · awaiting review');
    expect(output).not.toContain('The change is saved.');
    expect(output).not.toContain('Download revision');
    expect((output.match(/data-reached="true"/g) || [])).toHaveLength(1);
  });

  it('shows unresolved findings and the exact saved review instead of claiming approval', () => {
    const output = render([{ ...applied, reviewedAt: '2026-09-13T01:03:00.000Z', reviewedRevision: 3, reviewArtifactId: 'critic-result.json', reviewSummary: 'The requested colour is applied.', reviewFindings: ['The upper floor still has no clear stair access.'] }]);
    expect(output).toContain('Reviewed · findings');
    expect(output).toContain('1 finding needs attention');
    expect(output).toContain('The upper floor still has no clear stair access.');
    expect(output).toContain('/api/studio/projects/project-1/artifacts/critic-result.json');
    expect(output).not.toContain('No findings were recorded');
  });

  it.each(['failed', 'cancelled'] as const)('preserves applied evidence when a request is later %s', status => {
    const output = render([{ ...applied, status, failureDetail: 'Review did not finish.' }]);
    expect(output).toContain(status === 'failed' ? 'Failed' : 'Cancelled');
    expect(output).toContain('Review did not finish.');
    expect(output).toContain('The recorded design revision remains saved.');
    expect(output).toContain('/revisions/3');
    expect(output).not.toContain('Critic review recorded');
  });

  it('escapes request text and keeps absent history empty', () => {
    expect(render([{ ...queued, instruction: '<script>alert("x")</script>' }])).not.toContain('<script>');
    expect(render([])).toBe('');
  });

  it('shows applied requirements in precedence order and leaves queued feedback out', () => {
    const later = { ...applied, id: 'change-2', instruction: 'Make the roof blue.', appliedRevision: 4, appliedAt: '2026-09-13T02:00:00.000Z' };
    const requirements = buildEffectiveRequirements({ request: 'A home with a yellow roof.', summary: 'Home', goals: [], constraints: [], questions: [] }, 4, [later, { ...queued, id: 'pending', instruction: 'Add a pool.' }, applied]);
    const output = renderToStaticMarkup(createElement(RequirementsHistory, { requirements }));
    expect(output).toContain('A home with a yellow roof.');
    expect(output.indexOf('Make the roof red.')).toBeLessThan(output.indexOf('Make the roof blue.'));
    expect(output).toContain('Unrelated requirements remain in effect.');
    expect(output).not.toContain('Add a pool.');
  });
});
