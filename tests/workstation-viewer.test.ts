import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WorkstationViewer from '../components/WorkstationViewer';
import type { Snapshot, Task } from '../shared/design';

function snapshot(status = 'in_progress'): Snapshot {
  return {
    project: { id: 'project', name: 'Quiet courtyard', brief: { request: 'A generous family house.', summary: 'A house around a planted courtyard.', goals: [], constraints: [], questions: [] }, revision: 0, status: 'draft', createdAt: '', updatedAt: '' },
    design: null, tasks: [{ id: 'run-architecture', runId: 'run', agent: 'architect', title: 'Develop the house', detail: 'Planning the courtyard.', status: 'in_progress', kind: 'architecture' } as Task],
    runs: [{ id: 'run', projectId: 'project', kind: 'generate', status, baseRevision: 0, createdAt: '' } as NonNullable<Snapshot['runs']>[number]],
    events: [], artifacts: [],
  };
}

describe('workstation first paint', () => {
  it('opens a complete loading workspace before the connection request settles', () => {
    const html = renderToStaticMarkup(createElement(WorkstationViewer, { snapshot: snapshot(), agent: 'architect', onAgent: vi.fn(), onClose: vi.fn(), onStop: vi.fn() }));
    expect(html).toContain('Opening Kai');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Develop the house');
    expect(html).toContain('Stop work');
    expect(html).toContain('aria-label="Team workspaces"');
    expect(html).toContain('role="tablist"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('Retry connection');
  });
  it('does not offer reconnect for a failed briefing where a specialist never started', () => {
    const saved = snapshot('failed');
    saved.tasks = [{ ...saved.tasks[0], id: 'run-principal', agent: 'principal', status: 'failed', title: 'Prepare the brief' }];
    const html = renderToStaticMarkup(createElement(WorkstationViewer, { snapshot: saved, agent: 'architect', onAgent: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain('This computer never started');
    expect(html).toContain('Not started');
    expect(html).toContain('Review team activity');
    expect(html).toContain('Briefing stopped before Kai received a design task.');
    expect(html).not.toContain('Reconnect');
    expect(html).not.toContain('aria-busy="true"');
  });
  it('keeps a closed workspace out of modal focus handling', () => {
    const html = renderToStaticMarkup(createElement(WorkstationViewer, { snapshot: null, agent: null, onAgent: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain('hidden=""');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal="true"');
  });
});
