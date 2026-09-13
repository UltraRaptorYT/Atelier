import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkstationSessions, workstationKey, WORKSTATION_CONNECT_MS, WORKSTATION_REUSE_MS,
  type WorkstationSpec,
} from '../lib/workstation-session';

const architect: WorkstationSpec = { projectId: 'project-a', agent: 'architect', identity: 'run-a/task-architecture' };
const designer: WorkstationSpec = { projectId: 'project-a', agent: 'designer', identity: 'run-a/task-interior' };
const otherProject: WorkstationSpec = { projectId: 'project-b', agent: 'architect', identity: 'run-b/task-architecture' };
const stream = (name: string) => ({ url: `https://viewer.example/${name}?token=private-${name}` });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const requests: Array<ReturnType<typeof deferred<{ url: string }>> & { projectId: string; agent: string; signal: AbortSignal }> = [];
  const connect = vi.fn((projectId: string, agent: string, signal: AbortSignal) => {
    const request = { ...deferred<{ url: string }>(), projectId, agent, signal };
    requests.push(request);
    return request.promise;
  });
  const onChange = vi.fn();
  const manager = createWorkstationSessions({ connect, onChange });
  const session = (spec = architect) => manager.getSnapshot().find(item => item.key === workstationKey(spec));
  return { manager, requests, connect, onChange, session };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13T12:00:00Z')); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('workstation session identity and request races', () => {
  it('deduplicates concurrent opens and publishes stable immutable snapshots', async () => {
    const f = fixture(), listener = vi.fn(), unsubscribe = f.manager.subscribe(listener);
    const empty = f.manager.getSnapshot();
    expect(f.manager.getSnapshot()).toBe(empty);
    f.manager.ensure(architect);
    const connecting = f.manager.getSnapshot();
    f.manager.ensure({ ...architect });
    await flush();
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.manager.getSnapshot()).toBe(connecting);
    expect(listener).toHaveBeenCalledOnce();
    f.requests[0].resolve(stream('architect'));
    await flush();
    expect(f.session()).toMatchObject({ status: 'ready', ...stream('architect'), generation: 1 });
    expect(connecting[0].status).toBe('connecting');
    expect(empty).toEqual([]);
    expect(Object.isFrozen(connecting)).toBe(true);
    expect(Object.isFrozen(connecting[0])).toBe(true);
    expect(f.manager.getSnapshot()).toBe(f.onChange.mock.calls.at(-1)![0]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    f.manager.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps A and B replies associated with their own agent when B resolves first', async () => {
    const f = fixture();
    f.manager.ensure(architect); f.manager.ensure(designer);
    await flush();
    f.requests[1].resolve(stream('designer')); await flush();
    const designerSession = f.session(designer);
    expect(designerSession).toMatchObject({ agent: 'designer', status: 'ready', ...stream('designer') });
    expect(f.session()).toMatchObject({ agent: 'architect', status: 'connecting' });
    f.requests[0].resolve(stream('architect')); await flush();
    expect(f.session()).toMatchObject({ agent: 'architect', status: 'ready', ...stream('architect') });
    expect(f.session(designer)).toBe(designerSession);
  });

  it('force retry aborts only the targeted agent and ignores its stale response', async () => {
    const f = fixture();
    f.manager.ensure(architect); f.manager.ensure(designer); await flush();
    f.requests[1].resolve(stream('designer')); await flush();
    const designerSession = f.session(designer), firstGeneration = f.session()!.generation;
    f.manager.ensure(architect, true); await flush();
    expect(f.requests[0].signal.aborted).toBe(true);
    expect(f.requests[1].signal.aborted).toBe(false);
    expect(f.session()!.generation).toBeGreaterThan(firstGeneration);
    f.requests[2].resolve(stream('new-architect')); await flush();
    const latest = f.manager.getSnapshot();
    f.requests[0].resolve(stream('stale-architect')); await flush();
    expect(f.manager.getSnapshot()).toBe(latest);
    expect(f.session()).toMatchObject(stream('new-architect'));
    expect(f.session(designer)).toBe(designerSession);
    expect(JSON.stringify(f.onChange.mock.calls)).not.toContain('stale-architect');
  });

  it('replaces a task identity and ignores a late rejection from the earlier task', async () => {
    const f = fixture(), next = { ...architect, identity: 'run-b/task-architecture' };
    f.manager.ensure(architect); await flush();
    f.manager.ensure(next); await flush();
    expect(f.requests[0].signal.aborted).toBe(true);
    expect(f.manager.getSnapshot()).toHaveLength(1);
    expect(f.session()).toMatchObject({ identity: next.identity, status: 'connecting' });
    f.requests[0].reject(new Error('old task secret')); await flush();
    expect(f.session()).toMatchObject({ identity: next.identity, status: 'connecting' });
    f.requests[1].resolve(stream('next-task')); await flush();
    expect(f.session()).toMatchObject({ identity: next.identity, status: 'ready', ...stream('next-task') });
  });

  it('removes a ready URL immediately when its task changes', async () => {
    const f = fixture(); f.manager.ensure(architect); await flush();
    f.requests[0].resolve(stream('old-task')); await flush();
    f.manager.ensure({ ...architect, identity: 'new-task' });
    expect(f.session()).toMatchObject({ status: 'connecting', identity: 'new-task' });
    expect(f.session()).not.toHaveProperty('url');
  });

  it('clears one project without dropping another project or resurrecting a late response', async () => {
    const f = fixture();
    f.manager.ensure(architect); f.manager.ensure(otherProject); await flush();
    f.requests[1].resolve(stream('other-project')); await flush();
    const other = f.session(otherProject), previousGeneration = f.session()!.generation;
    f.manager.clear(architect.projectId);
    expect(f.requests[0].signal.aborted).toBe(true);
    expect(f.manager.getSnapshot()).toEqual([other]);
    f.requests[0].resolve(stream('cleared-project')); await flush();
    expect(f.manager.getSnapshot()).toEqual([other]);
    f.manager.ensure(architect); await flush();
    expect(f.session()!.generation).toBeGreaterThan(previousGeneration);
    f.manager.clear();
    expect(f.requests[2].signal.aborted).toBe(true);
    f.requests[2].resolve(stream('cleared-again')); await flush();
    expect(f.manager.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closing cancels pending work, keeps healthy URLs, and cannot poison a reopened request', async () => {
    const f = fixture();
    f.manager.ensure(architect); f.manager.ensure(designer); await flush();
    f.requests[1].resolve(stream('designer')); await flush();
    const ready = f.session(designer), generation = f.session()!.generation;
    f.manager.cancelPending();
    expect(f.requests[0].signal.aborted).toBe(true);
    expect(f.session()).toBeUndefined();
    expect(f.session(designer)).toBe(ready);
    f.manager.ensure(architect); f.manager.ensure(designer); await flush();
    expect(f.connect).toHaveBeenCalledTimes(3);
    expect(f.session()!.generation).toBeGreaterThan(generation);
    f.requests[0].resolve(stream('closed-request')); await flush();
    expect(f.session()?.status).toBe('connecting');
    f.requests[2].resolve(stream('reopened-request')); await flush();
    expect(f.session()).toMatchObject(stream('reopened-request'));
  });

  it('does not send a stream POST if the viewer closes before dispatch', async () => {
    const f = fixture(); f.manager.ensure(architect); f.manager.cancelPending();
    await flush();
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.manager.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores stale iframe or heartbeat failures using captured identity and generation', async () => {
    const f = fixture(); f.manager.ensure(architect); await flush();
    f.requests[0].resolve(stream('first')); await flush();
    const first = f.session()!;
    f.manager.ensure(architect, true); await flush();
    f.requests[1].resolve(stream('second')); await flush();
    const second = f.session()!;
    f.manager.invalidate(first.key, 'Old frame failed.', first.generation);
    f.manager.invalidate({ ...architect, identity: 'old-task' });
    expect(f.session()).toBe(second);
    f.manager.invalidate(second.key, 'The live view is unavailable. Retry to reconnect.', second.generation);
    expect(f.session()).toMatchObject({ status: 'error', message: 'The live view is unavailable. Retry to reconnect.' });
    expect(f.session()).not.toHaveProperty('url');
    f.manager.clear();
    f.manager.invalidate(second.key, 'Late failure.', second.generation);
    expect(f.manager.getSnapshot()).toEqual([]);
  });

  it('invalidation aborts a pending request and prevents its later response from restoring a URL', async () => {
    const f = fixture(); f.manager.ensure(architect); await flush();
    const pending = f.session()!;
    f.manager.invalidate(architect, 'This task no longer has a live workstation.', pending.generation);
    expect(f.requests[0].signal.aborted).toBe(true);
    expect(f.session()).toMatchObject({ status: 'error', message: 'This task no longer has a live workstation.' });
    const invalidated = f.manager.getSnapshot();
    f.requests[0].resolve(stream('invalidated')); await flush();
    expect(f.manager.getSnapshot()).toBe(invalidated);
    expect(f.session()).not.toHaveProperty('url');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards an inactive frame without letting a stale disposal timer remove a newer generation', async () => {
    const f = fixture(); f.manager.ensure(architect); f.manager.ensure(designer); await flush();
    f.requests[0].resolve(stream('first')); f.requests[1].resolve(stream('designer')); await flush();
    const first = f.session()!, unaffected = f.session(designer);
    f.manager.ensure(architect, true); await flush();
    f.requests[2].resolve(stream('replacement')); await flush();
    const replacement = f.session()!, snapshot = f.manager.getSnapshot();
    f.manager.discard(first.key, first.generation);
    f.manager.discard({ ...architect, identity: 'obsolete-task' });
    expect(f.manager.getSnapshot()).toBe(snapshot);
    f.manager.discard(architect, replacement.generation);
    expect(f.session()).toBeUndefined();
    expect(f.session(designer)).toBe(unaffected);
    f.manager.ensure(architect); await flush();
    expect(f.connect).toHaveBeenCalledTimes(4);
    expect(f.session()).toMatchObject({ status: 'connecting' });
    expect(f.session()!.generation).toBeGreaterThan(replacement.generation);
  });

  it('discard aborts a pending connection and never resurrects a late discarded URL', async () => {
    const f = fixture(); f.manager.ensure(architect); await flush();
    const pending = f.session()!;
    f.manager.discard(pending.key, pending.generation);
    expect(f.requests[0].signal.aborted).toBe(true);
    const discarded = f.manager.getSnapshot();
    f.requests[0].resolve(stream('discarded')); await flush();
    expect(f.manager.getSnapshot()).toBe(discarded);
    expect(discarded).toEqual([]);
    f.manager.discard(pending.key, pending.generation);
    expect(f.manager.getSnapshot()).toBe(discarded);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('workstation reuse, deadline and safe errors', () => {
  it('reuses URLs for two minutes from connection and refreshes only on a later explicit open', async () => {
    const f = fixture(); f.manager.ensure(architect); await flush();
    await vi.advanceTimersByTimeAsync(15_000);
    f.requests[0].resolve(stream('first')); await flush();
    const ready = f.session()!;
    await vi.advanceTimersByTimeAsync(WORKSTATION_REUSE_MS - 1);
    f.manager.ensure(architect); await flush();
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.session()).toBe(ready);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.session()).toBe(ready);
    f.manager.ensure(architect); await flush();
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.session()).toMatchObject({ status: 'connecting' });
    expect(f.session()).not.toHaveProperty('url');
    f.requests[1].resolve(stream('refreshed')); await flush();
    expect(f.session()).toMatchObject(stream('refreshed'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the injected clock for URL age and expires a URL after a clock rollback', async () => {
    let now = 10_000;
    const connect = vi.fn(async () => stream('clock'));
    const manager = createWorkstationSessions({ connect, now: () => now });
    manager.ensure(architect); await flush();
    expect(manager.getSnapshot()[0].connectedAt).toBe(now);
    now -= 1;
    manager.ensure(architect); await flush();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('ends a non-cooperative connection at 20 seconds without retrying or accepting a late URL', async () => {
    const f = fixture(); f.manager.ensure(architect); await flush();
    await vi.advanceTimersByTimeAsync(WORKSTATION_CONNECT_MS - 1);
    expect(f.session()?.status).toBe('connecting'); expect(f.requests[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.requests[0].signal.aborted).toBe(true);
    expect(f.session()).toMatchObject({ status: 'error', message: expect.stringContaining('20 seconds') });
    expect(f.session()).not.toHaveProperty('url');
    const failed = f.manager.getSnapshot();
    f.requests[0].resolve(stream('late')); await flush();
    expect(f.manager.getSnapshot()).toBe(failed);
    f.manager.ensure(architect);
    await vi.advanceTimersByTimeAsync(150_000);
    expect(f.connect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    f.manager.ensure(architect, true); await flush();
    expect(f.connect).toHaveBeenCalledTimes(2);
  });

  it('sanitizes connection errors, clears timers and waits for an explicit retry', async () => {
    const f = fixture(); f.manager.ensure(architect); await flush();
    f.requests[0].reject(new Error('Authorization: secret; https://viewer.example/?token=private'));
    await flush();
    expect(f.session()).toMatchObject({ status: 'error', message: expect.stringContaining('Retry') });
    expect(JSON.stringify(f.onChange.mock.calls)).not.toMatch(/Authorization|secret|token=private/);
    expect(vi.getTimerCount()).toBe(0);
    f.manager.ensure(architect); await flush();
    expect(f.connect).toHaveBeenCalledOnce();
    f.manager.ensure(architect, true); await flush();
    f.requests[1].resolve(stream('retry')); await flush();
    expect(f.session()).toMatchObject({ status: 'ready', ...stream('retry') });
  });

  it.each(['', '   ', '/relative/viewer', 'not-a-url', 'javascript:alert(1)', 'data:text/html,hello', 'http://viewer.example/', 'https://user:password@viewer.example/'])('rejects invalid or unsafe viewer address %j', async url => {
    const connect = vi.fn(async () => ({ url })), manager = createWorkstationSessions({ connect });
    manager.ensure(architect); await flush();
    expect(manager.getSnapshot()[0]).toMatchObject({ status: 'error', message: expect.stringContaining('invalid viewer address') });
    expect(manager.getSnapshot()[0]).not.toHaveProperty('url');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns a synchronous adapter error into safe session state', async () => {
    const manager = createWorkstationSessions({ connect: () => { throw new Error('private setup failure'); } });
    manager.ensure(architect); await flush();
    expect(manager.getSnapshot()[0]).toMatchObject({ status: 'error', message: expect.stringContaining('Retry') });
    expect(manager.getSnapshot()[0].message).not.toContain('private');
    expect(vi.getTimerCount()).toBe(0);
  });
});
