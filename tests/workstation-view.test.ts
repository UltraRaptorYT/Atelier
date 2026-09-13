import { describe, expect, it } from 'vitest';
import { inspectionAgentForRoom, workstationView } from '../lib/workstation-view';
import type { Artifact, Snapshot, Task } from '../shared/design';
import type { StudioRun } from '../shared/images';

const time = (second: number) => `2026-09-13T12:00:${String(second).padStart(2, '0')}.000Z`;
const run = (id = 'current', status = 'in_progress', kind: StudioRun['kind'] = 'generate'): StudioRun => ({ id, status, kind });
const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'current-architecture', runId: 'current', agent: 'architect', kind: 'architecture',
  status: 'in_progress', title: 'Develop the architecture', detail: 'Constructing the roof and floor plan.', ...overrides,
});
const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  project: {
    id: 'project-a', name: 'Courtyard home', revision: 0, status: 'active', createdAt: time(1), updatedAt: time(30),
    brief: { request: 'A courtyard home for four.', summary: 'A courtyard home.', goals: [], constraints: [], questions: [] },
  },
  design: null, runs: [run()], tasks: [task()], events: [], artifacts: [], ...overrides,
});
const preview = (name: string, second: number, kind = 'desktop-preview'): Artifact => ({
  id: `${name}-${second}`, name, kind, revision: 1, size: 100, createdAt: time(second),
});

describe('workstation task context', () => {
  it('keeps the selected architecture workspace independent of voice proximity', () => {
    const selectedRoom = 'architect';
    for (const nearbyRoom of [null, 'principal', 'designer']) {
      expect(inspectionAgentForRoom(selectedRoom)).toBe('architect');
      expect(nearbyRoom).not.toBe(selectedRoom);
    }
    expect(inspectionAgentForRoom('reception')).toBe('principal');
  });

  it('preserves completed specialist work when the team fails later', () => {
    const state = snapshot({ runs: [run('current', 'failed')], tasks: [task({ status: 'completed' }), task({ id: 'current-interior', agent: 'designer', status: 'failed' })] });
    expect(workstationView(state, 'architect')).toMatchObject({ live: false, status: 'completed', title: 'The work is saved' });
    expect(workstationView(state, 'architect').description).toContain('team stopped during later work');
  });

  it('exposes an active architecture task with a stable identity across saved revisions and progress updates', () => {
    const state = snapshot(), original = workstationView(state, 'architect');
    expect(original).toMatchObject({ live: true, identity: 'current:current-architecture', status: 'in progress' });
    expect(original.task).toBe(state.tasks[0]);
    const refreshed = snapshot({ project: { ...state.project, revision: 2 }, tasks: [task({ detail: 'Inspecting the saved previews.' })] });
    expect(workstationView(refreshed, 'architect').identity).toBe(original.identity);
    expect(workstationView(snapshot({ tasks: [task({ id: 'current-correction' })] }), 'architect').identity).not.toBe(original.identity);
  });

  it('ignores an old run computer while the new run waits for a specialist task', () => {
    const old = task({ id: 'old-architecture', runId: 'old', status: 'in_progress' });
    const view = workstationView(snapshot({ runs: [run(), run('old', 'failed')], tasks: [old] }), 'architect');
    expect(view).toMatchObject({ live: false, identity: '', status: 'Waiting for a task', tasks: [] });
    expect(view.task).toBeUndefined();
  });

  it('follows the currently working run even if another run is more recently queued', () => {
    const current = task(), next = task({ id: 'next-architecture', runId: 'next', status: 'queued' });
    const view = workstationView(snapshot({ runs: [run('next', 'queued'), run()], tasks: [next, current] }), 'architect');
    expect(view).toMatchObject({ live: true, identity: 'current:current-architecture' });
    expect(view.tasks).toEqual([current]);
  });

  it.each(['failed', 'cancelled', 'completed'])('never exposes a computer when the run is %s despite stale active task state', status => {
    const view = workstationView(snapshot({ runs: [run('current', status)] }), 'architect');
    expect(view.live).toBe(false);
    expect(view.status).not.toBe('in progress');
  });

  it('does not expose the Principal as a tool workstation', () => {
    const view = workstationView(snapshot({ tasks: [task({ agent: 'principal', kind: undefined, id: 'current-principal' })] }), 'principal');
    expect(view.live).toBe(false);
    expect(view.title).toContain('coordinates the team');
    expect(view.description).toContain('Activity');
  });

  it('keeps visual-direction work visible without claiming a live computer', () => {
    const visual = task({ id: 'current-palette', agent: 'designer', kind: 'visual_direction' });
    const view = workstationView(snapshot({ tasks: [visual] }), 'designer');
    expect(view).toMatchObject({ live: false, status: 'in progress', title: 'Developing the visual direction' });
    expect(view.description).toContain('without opening a computer');
  });

  it('shows the active interior task when an earlier visual-direction task has completed', () => {
    const visual = task({ id: 'current-palette', agent: 'designer', kind: 'visual_direction', status: 'completed' });
    const interior = task({ id: 'current-interior', agent: 'designer', kind: 'interior' });
    const view = workstationView(snapshot({ tasks: [visual, interior] }), 'designer');
    expect(view).toMatchObject({ live: true, identity: 'current:current-interior' });
    expect(view.task).toBe(interior);
  });

  it.each(['queued', 'blocked'] as const)('explains a %s specialist task without connecting to a computer', status => {
    const detail = 'Waiting for the architecture proposal to be saved.';
    const view = workstationView(snapshot({ tasks: [task({ status, detail })] }), 'architect');
    expect(view).toMatchObject({ live: false, status, title: 'Waiting for this task to begin', description: detail });
  });

  it('distinguishes the failed Principal from specialists whose tasks never started', () => {
    const state = snapshot({ runs: [run('current', 'failed')], tasks: [task({ id: 'current-principal', agent: 'principal', kind: undefined, status: 'failed' })] });
    expect(workstationView(state, 'principal')).toMatchObject({ live: false, status: 'failed', title: 'This work stopped' });
    for (const agent of ['architect', 'designer', 'critic'] as const) {
      expect(workstationView(state, agent)).toMatchObject({ live: false, status: 'Not started', title: 'This computer never started', identity: '' });
    }
  });

  it('does not offer a live screen for an image request', () => {
    const view = workstationView(snapshot({ runs: [run('current', 'in_progress', 'image')], tasks: [task({ agent: 'designer' })] }), 'designer');
    expect(view.live).toBe(false);
  });

  it('does not offer a live screen before a connected project exists', () => {
    expect(workstationView(null, 'architect')).toMatchObject({ live: false, title: 'A workspace for your ideas', identity: '' });
    const state = snapshot(); state.project.id = 'local_draft';
    expect(workstationView(state, 'architect')).toMatchObject({ live: false, title: 'A workspace for your ideas' });
  });

  it('selects the latest saved preview for this agent without reordering shared artifacts', () => {
    const earlier = preview('architect-desktop.png', 10), newer = preview('architect-desktop.png', 25);
    const artifacts = [earlier, preview('designer-desktop.png', 29), newer, preview('architect-design.png', 30, 'render')];
    const state = snapshot({ artifacts }), originalOrder = [...artifacts];
    expect(workstationView(state, 'architect').preview).toBe(newer);
    expect(workstationView(state, 'critic').preview).toBeUndefined();
    expect(state.artifacts).toEqual(originalOrder);
  });
});
