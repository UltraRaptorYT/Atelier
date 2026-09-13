import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCurrentSnapshot, subscribeToProject } from '../lib/project-feed';
import type { Snapshot } from '../shared/design';

const snapshot = (revision = 1, event = 1): Snapshot => ({
  project: { id: 'p', revision, name: 'Home', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01', brief: { request: 'Home', summary: 'Home', goals: [], constraints: [], questions: [] } },
  design: null, tasks: [], artifacts: [], events: [{ id: event, projectId: 'p', revision, type: 'task_started', agent: 'architect', taskId: 't', message: 'Working', createdAt: '2026-01-01' }],
});
class Source {
  static latest: Source;
  onopen?: () => void;
  onerror?: () => void;
  onmessage?: () => void;
  close = vi.fn();
  constructor(public url: string) { Source.latest = this; }
}
const cleanups: (() => void)[] = [];
function setup(read = vi.fn(async (_signal: AbortSignal) => snapshot())) {
  const onSnapshot = vi.fn(), onConnection = vi.fn();
  const stop = subscribeToProject({ projectId: 'p', after: 4, read, onSnapshot, onConnection });
  cleanups.push(stop);
  return { source: Source.latest, read, onSnapshot, onConnection, stop };
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('EventSource', Source); vi.stubGlobal('window', new EventTarget()); });
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('saved project updates', () => {
  it('coalesces a burst of events into one snapshot request', async () => {
    const f = setup(); f.source.onopen?.();
    for (let i = 0; i < 20; i++) f.source.onmessage?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.source.url).toBe('/api/studio/projects/p/events?after=4');
    expect(f.onConnection).toHaveBeenLastCalledWith('live');
  });

  it('keeps fetching revisions when the event stream is unavailable and recovers after failure', async () => {
    const f = setup(); f.read.mockRejectedValueOnce(new Error('offline'));
    f.source.onerror?.(); await vi.advanceTimersByTimeAsync(150);
    expect(f.onConnection).toHaveBeenLastCalledWith('offline');
    f.read.mockResolvedValue(snapshot(2, 9));
    await vi.advanceTimersByTimeAsync(15000);
    expect(f.onSnapshot).toHaveBeenLastCalledWith(snapshot(2, 9));
    expect(f.onConnection).toHaveBeenLastCalledWith('polling');
  });

  it('serializes slow reads and checks again for events received in flight', async () => {
    let resolve!: (value: Snapshot) => void;
    const read = vi.fn((_signal: AbortSignal) => new Promise<Snapshot>(done => { resolve = done; }));
    const f = setup(read); await vi.advanceTimersByTimeAsync(150);
    f.source.onmessage?.(); await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledOnce();
    resolve(snapshot()); await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledTimes(2);
    resolve(snapshot(2, 2)); await vi.advanceTimersByTimeAsync(0);
    expect(f.onSnapshot.mock.calls.map(([s]) => s.project.revision)).toEqual([1, 2]);
  });

  it('aborts stalled reads and ignores results after switching projects', async () => {
    const read = vi.fn((signal: AbortSignal) => new Promise<Snapshot>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const f = setup(read); await vi.advanceTimersByTimeAsync(10150);
    expect(read.mock.calls[0][0].aborted).toBe(true);
    expect(f.onConnection).toHaveBeenLastCalledWith('offline');
    await vi.advanceTimersByTimeAsync(5000);
    f.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(f.onSnapshot).not.toHaveBeenCalled();
    expect(f.source.close).toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('rejects stale revisions, activity, and other projects', () => {
    const current = snapshot(3, 10);
    expect(isCurrentSnapshot(snapshot(2, 11), current)).toBe(false);
    expect(isCurrentSnapshot(snapshot(3, 9), current)).toBe(false);
    expect(isCurrentSnapshot({ ...snapshot(3, 10), project: { ...current.project, id: 'other' } }, current)).toBe(false);
    expect(isCurrentSnapshot(snapshot(3, 10), current)).toBe(true);
    expect(isCurrentSnapshot(snapshot(4, 11), current)).toBe(true);
  });
});
