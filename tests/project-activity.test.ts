import { describe, expect, it } from 'vitest';
import { projectActivity } from '../lib/project-activity';
import type { Artifact, Snapshot, StudioEvent, Task } from '../shared/design';
import type { StudioRun } from '../shared/images';

const time = (second: number) => `2026-09-13T10:00:${String(second).padStart(2, '0')}.000Z`;
const run = (id = 'current', status = 'in_progress'): StudioRun => ({ id, kind: 'generate', status });
const task = (id: string, agent: Task['agent'], status: Task['status'] = 'in_progress', runId = 'current'): Task => ({
  id, agent, status, runId, title: `${agent} work`, detail: '',
});
const event = (id: number, type: string, taskId: string | null = null): StudioEvent => ({
  id, type, taskId, agent: 'principal', projectId: 'project', revision: 0,
  message: type === 'task_created' && !taskId ? 'Design work queued.' : type, createdAt: time(id),
});
const profile = (runId = 'current', second = 20): Artifact => ({
  id: `${runId}-generation-profile.json`, name: 'generation-profile.json', kind: 'generation-profile',
  revision: 0, createdAt: time(second), size: 100,
});
const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  project: {
    id: 'project', name: 'Home', revision: 0, status: 'active', createdAt: time(1), updatedAt: time(30),
    brief: { request: 'Design a playful home.', summary: 'A playful home.', goals: [], constraints: [], questions: [] },
  },
  design: null, runs: [run()], tasks: [], events: [], artifacts: [profile()],
  ...overrides,
});
const clarification = (runId = 'current'): NonNullable<Snapshot['clarification']> => ({
  id: 'clarification', runId, version: 1, status: 'awaiting_input', continuationRunId: null, detail: null,
  questions: [{ id: 'floors', question: 'How many floors?', answer: null }],
});

describe('current project activity', () => {
  it('does not invent a meeting or working avatars before a project exists', () => {
    const activity = projectActivity(null);
    expect(activity.currentRun).toBeFalsy();
    expect(activity.activeRuns).toEqual([]);
    expect(activity.activeTasks).toEqual([]);
    expect(activity.officeTasks).toEqual([]);
    expect(activity.events).toEqual([]);
    expect(activity.meeting).toBe(false);
  });

  it('prefers an in-progress run over a newer queued run and historical tasks', () => {
    const working = task('architecture', 'architect');
    const activity = projectActivity(snapshot({
      runs: [run('next', 'queued'), run(), run('old', 'failed')],
      tasks: [task('old-task', 'designer', 'in_progress', 'old'), task('next-task', 'critic', 'queued', 'next'), working],
    }));
    expect(activity.currentRun?.id).toBe('current');
    expect(activity.activeRuns.map(item => item.id)).toEqual(['next', 'current']);
    expect(activity.tasks).toEqual([working]);
    expect(activity.activeTasks).toEqual([working]);
    expect(activity.officeTasks).toEqual([working]);
  });

  it('keeps the latest finished run available for inspection without animating its tasks', () => {
    const finished = task('last-task', 'principal', 'failed');
    const activity = projectActivity(snapshot({
      runs: [run('current', 'failed'), run('old', 'completed')],
      tasks: [task('old-task', 'architect', 'completed', 'old'), finished],
    }));
    expect(activity.currentRun?.id).toBe('current');
    expect(activity.tasks).toEqual([finished]);
    expect(activity.activeTasks).toEqual([]);
    expect(activity.officeTasks).toEqual([]);
  });

  it.each(['failed', 'cancelled', 'completed'])('closes an orphan briefing when its run is %s', status => {
    // A provider failure can leave meeting_started as the last meeting event.
    const activity = projectActivity(snapshot({
      runs: [run('current', status)],
      tasks: [task('principal', 'principal', status === 'failed' ? 'failed' : 'in_progress')],
      events: [event(21, 'meeting_started'), event(22, 'task_started', 'principal'), event(23, 'error', 'principal')],
    }));
    expect(activity.meeting).toBe(false);
    expect(activity.activeRuns).toEqual([]);
    expect(activity.activeTasks).toEqual([]);
    expect(activity.officeTasks).toEqual([]);
  });

  it('uses the current generation profile to exclude meetings from before this run', () => {
    const activity = projectActivity(snapshot({
      tasks: [task('principal', 'principal')],
      artifacts: [profile('old', 5), profile()],
      events: [event(10, 'task_created'), event(15, 'meeting_started'), event(21, 'task_started', 'principal')],
    }));
    expect(activity.events.map(item => item.id)).toEqual([21]);
    expect(activity.meeting).toBe(false);
  });

  it('uses the latest unscoped queue marker when a new queued run has no profile yet', () => {
    const activity = projectActivity(snapshot({
      runs: [run('current', 'queued'), run('old', 'failed')],
      tasks: [task('old-task', 'principal', 'failed', 'old')],
      artifacts: [profile('old', 5)],
      events: [event(10, 'task_created'), event(15, 'meeting_started'), event(20, 'task_created')],
    }));
    expect(activity.currentRun?.id).toBe('current');
    expect(activity.events.map(item => item.id)).toEqual([20]);
    expect(activity.tasks).toEqual([]);
    expect(activity.officeTasks).toEqual([]);
    expect(activity.meeting).toBe(false);
  });

  it('does not treat a scoped specialist task-created event as a new run boundary', () => {
    const activity = projectActivity(snapshot({
      artifacts: [],
      tasks: [task('principal', 'principal', 'completed'), task('architecture', 'architect', 'queued')],
      events: [event(20, 'task_created'), event(21, 'meeting_started'), event(22, 'task_created', 'architecture')],
    }));
    expect(activity.events.map(item => item.id)).toEqual([20, 21, 22]);
  });

  it('does not reuse an ambiguous old queue and meeting without evidence from the new run', () => {
    const activity = projectActivity(snapshot({
      runs: [run(), run('old', 'failed')],
      tasks: [task('old-principal', 'principal', 'failed', 'old')],
      artifacts: [profile('old', 12)],
      events: [
        event(10, 'task_created'), event(15, 'meeting_started'),
        event(16, 'task_started', 'old-principal'), event(17, 'error', 'old-principal'),
      ],
    }));
    expect(activity.currentRun?.id).toBe('current');
    expect(activity.meeting).toBe(false);
    expect(activity.activeTasks).toEqual([]);
  });

  it('filters late events owned by an old run so they cannot close a current briefing', () => {
    const activity = projectActivity(snapshot({
      runs: [run(), run('old', 'completed')],
      tasks: [task('principal', 'principal'), task('old-task', 'architect', 'completed', 'old')],
      events: [
        event(21, 'meeting_started'), event(22, 'task_started', 'principal'),
        event(23, 'task_started', 'old-task'), event(24, 'meeting_ended', 'old-task'),
      ],
    }));
    expect(activity.events.map(item => item.id)).toEqual([21, 22]);
    expect(activity.meeting).toBe(true);
  });

  it('shows the real current initial briefing while the Principal is working', () => {
    const principal = task('principal', 'principal');
    const activity = projectActivity(snapshot({
      tasks: [principal],
      events: [event(21, 'meeting_started'), event(22, 'task_started', 'principal')],
    }));
    expect(activity.meeting).toBe(true);
    expect(activity.activeTasks).toEqual([principal]);
    expect(activity.officeTasks).toEqual([principal]);
  });

  it('keeps concurrent specialists working when a meeting-start event was left open', () => {
    const specialists = [task('architecture', 'architect'), task('interior', 'designer')];
    const activity = projectActivity(snapshot({
      tasks: [task('principal', 'principal', 'completed'), ...specialists],
      events: [
        event(21, 'meeting_started'), event(22, 'task_started', 'architecture'),
        event(23, 'task_started', 'interior'), event(24, 'meeting_started'),
      ],
    }));
    expect(activity.activeTasks).toEqual(specialists);
    expect(activity.officeTasks.filter(item => item.status === 'in_progress')).toEqual(specialists);
    expect(activity.meeting).toBe(false);
  });

  it('allows a current scoped coordination meeting after Principal-only work', () => {
    const activity = projectActivity(snapshot({
      tasks: [task('principal', 'principal')],
      events: [event(21, 'task_started', 'principal'), event(22, 'meeting_started', 'principal')],
    }));
    expect(activity.meeting).toBe(true);
  });

  it('ends a current meeting when its matching event is saved', () => {
    const activity = projectActivity(snapshot({
      tasks: [task('principal', 'principal')],
      events: [event(21, 'meeting_started'), event(22, 'meeting_ended')],
    }));
    expect(activity.meeting).toBe(false);
  });

  it('shows clarification waiting only for the associated awaiting-input run', () => {
    const activity = projectActivity(snapshot({
      runs: [run('current', 'awaiting_input')],
      tasks: [task('principal', 'principal', 'blocked')],
      clarification: clarification(),
      events: [event(21, 'meeting_started'), event(22, 'clarification_requested', 'principal')],
    }));
    expect(activity.meeting).toBe(true);
    expect(activity.activeTasks).toEqual([]);
    expect(activity.officeTasks).toEqual([]);
  });

  it.each(['failed', 'cancelled', 'completed'])('ignores stale clarification waiting after its run is %s', status => {
    const activity = projectActivity(snapshot({
      runs: [run('current', status)],
      tasks: [task('principal', 'principal', 'blocked')],
      clarification: clarification(),
      events: [event(21, 'clarification_requested', 'principal')],
    }));
    expect(activity.meeting).toBe(false);
    expect(activity.activeTasks).toEqual([]);
    expect(activity.officeTasks).toEqual([]);
  });

  it('does not carry an older clarification into a new queued run', () => {
    const activity = projectActivity(snapshot({
      runs: [run('current', 'queued'), run('old', 'awaiting_input')],
      tasks: [task('old-principal', 'principal', 'blocked', 'old')],
      artifacts: [profile('old', 5)], clarification: clarification('old'),
      events: [event(15, 'clarification_requested', 'old-principal'), event(20, 'task_created')],
    }));
    expect(activity.currentRun?.id).toBe('current');
    expect(activity.meeting).toBe(false);
    expect(activity.officeTasks).toEqual([]);
  });
});
