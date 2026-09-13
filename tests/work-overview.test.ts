import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { summarizeWork } from '../lib/work-overview';
import WorkOverview from '../components/WorkOverview';
import { exampleDesign } from '../shared/example';
import type { Snapshot } from '../shared/design';

function failedBrief(): Snapshot {
  return { project: { id: 'project', name: 'Home', revision: 0, status: 'draft', createdAt: '2026-09-13', updatedAt: '2026-09-13', brief: { request: 'A tropical family home.', summary: 'A tropical family home.', goals: [], constraints: [], questions: [] } }, design: null,
    runs: [{ id: 'briefing', kind: 'generate', status: 'failed' }], tasks: [{ id: 'briefing-principal', runId: 'briefing', agent: 'principal', status: 'failed', title: 'Prepare the project brief', detail: 'Planning dependencies and independent specialist work.' }], events: [], artifacts: [] };
}
const render = (snapshot: Snapshot, connection: 'live' | 'offline' = 'live') => renderToStaticMarkup(createElement(WorkOverview, { snapshot, connection, viewingLatest: false, onViewDesign: () => {}, onActivity: () => {} }));

describe('visible saved run outcomes', () => {
  it('explains the observed Principal-only failure without claiming specialists worked or a model exists', () => {
    const snapshot = failedBrief(), summary = summarizeWork(snapshot);
    expect(summary).toMatchObject({ state: 'stopped', title: 'Briefing failed before design work', tasks: [] });
    expect(summary.description).toContain('No specialist tasks started.');
    expect(summary.description).toContain('No model was saved.');
    expect(summary.description).toContain('Your brief is saved.');
    const output = render(snapshot);
    expect(output).toContain('Briefing failed before design work'); expect(output).toContain('Review activity');
    expect(output).not.toContain('Planning dependencies'); expect(output).not.toContain('View latest design');
  });

  it('retains the failure explanation while updates reconnect', () => {
    const output = render(failedBrief(), 'offline');
    expect(output).toContain('Briefing failed before design work');
    expect(output).toContain('Updates paused');
  });

  it('shows a later failed specialist run above an older review status and preserves the model', () => {
    const snapshot = failedBrief(); snapshot.design = exampleDesign(); snapshot.project.status = 'review'; snapshot.project.revision = 3;
    snapshot.tasks.push({ ...snapshot.tasks[0], id: 'briefing-architect', agent: 'architect', title: 'Develop geometry', status: 'in_progress' });
    expect(summarizeWork(snapshot)).toMatchObject({ state: 'stopped', title: 'Design work failed', tasks: [] });
    const output = render(snapshot);
    expect(output).toContain('Your last saved model is preserved.'); expect(output).toContain('View latest design');
    expect(output).not.toContain('No specialist tasks started');
  });

  it('does not let stale clarification or old failed work replace the current run', () => {
    const snapshot = failedBrief();
    snapshot.clarification = { id: 'old-questions', runId: 'old', status: 'awaiting_input', version: 1, questions: [], continuationRunId: null, detail: null };
    expect(summarizeWork(snapshot).state).toBe('stopped');
    snapshot.runs!.unshift({ id: 'retry', kind: 'generate', status: 'in_progress' });
    snapshot.tasks.unshift({ ...snapshot.tasks[0], id: 'retry-principal', runId: 'retry', status: 'in_progress' });
    expect(summarizeWork(snapshot)).toMatchObject({ state: 'working', title: 'Current work' });
    expect(summarizeWork(snapshot).tasks.map(task => task.runId)).toEqual(['retry']);
    expect(render(snapshot)).not.toContain('Briefing failed before design work');
  });

  it('distinguishes a stopped request and a ready design from ongoing work', () => {
    const snapshot = failedBrief(); snapshot.runs![0].status = 'cancelled'; snapshot.tasks[0].status = 'in_progress';
    expect(summarizeWork(snapshot)).toMatchObject({ state: 'stopped', title: 'Work stopped', tasks: [] });
    snapshot.runs![0].status = 'completed'; snapshot.project.status = 'ready'; snapshot.design = exampleDesign();
    expect(summarizeWork(snapshot)).toMatchObject({ state: 'idle', title: 'Saved design ready to explore', tasks: [] });
  });
});
