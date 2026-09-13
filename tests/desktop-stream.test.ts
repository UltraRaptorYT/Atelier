import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Sandbox } from '@e2b/desktop';
import { ProjectCoordinator } from '../worker/src/coordinator';
import type { Bindings } from '../worker/src/types';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('@e2b/desktop', () => ({ Sandbox: { connect: vi.fn() } }));
const databases: DatabaseSync[] = [];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let round = 0; round < 15; round++) await Promise.resolve(); };

function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT); INSERT INTO projects VALUES('project','owner'); CREATE TABLE desktop_sessions(project_id TEXT,agent TEXT,sandbox_id TEXT,lease_id TEXT,expires_at INTEGER,PRIMARY KEY(project_id,agent))");
  const lease = (agent: string, id: string) => db.prepare('INSERT OR REPLACE INTO desktop_sessions VALUES(?,?,?,?,?)').run('project', agent, `sandbox-${id}`, id, Date.now() + 900000);
  lease('architect', 'lease-a'); lease('designer', 'lease-d');
  const prepare = (sql: string, args: (string | number)[] = []) => ({
    bind: (...values: (string | number)[]) => prepare(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
  });
  const env = { DB: { prepare }, E2B_API_KEY: 'test-key' } as unknown as Bindings;
  const ctx = { waitUntil: vi.fn() };
  const coordinator = new ProjectCoordinator(ctx as unknown as DurableObjectState, env);
  const streams = new Map<string, ReturnType<typeof createStream>>();
  function createStream() {
    let token = 0;
    const stream = {
      stop: vi.fn(async () => { token++; }),
      start: vi.fn(async (_options: unknown) => { token++; }),
      getAuthKey: () => String(token),
      getUrl: vi.fn(({ authKey }: { authKey: string }) => `https://viewer.example/?token=${authKey}`),
    };
    return { stream, currentUrl: () => `https://viewer.example/?token=${token}` };
  }
  vi.mocked(Sandbox.connect).mockImplementation(async id => {
    if (!streams.has(id)) streams.set(id, createStream());
    return { stream: streams.get(id)!.stream } as never;
  });
  const open = (agent: 'architect' | 'designer' = 'architect', id = agent === 'architect' ? 'lease-a' : 'lease-d', owner = 'owner') => coordinator.desktopStream('project', owner, agent, id);
  return { db, lease, env, ctx, coordinator, streams, open };
}
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe('coordinator-owned desktop stream rotations', () => {
  it('coalesces an abandoned open and its overlapping retry so neither can invalidate the returned credentials', async () => {
    const f = fixture(), pause = deferred();
    await Sandbox.connect('sandbox-lease-a');
    const machine = f.streams.get('sandbox-lease-a')!;
    machine.stream.start.mockImplementationOnce(async () => { await pause.promise; });
    const abandoned = f.open(); await flush();
    const retry = f.open(); await flush();
    expect(machine.stream.stop).toHaveBeenCalledTimes(1);
    expect(machine.stream.start).toHaveBeenCalledExactlyOnceWith({ requireAuth: true });
    expect(f.ctx.waitUntil).toHaveBeenCalledTimes(1);
    pause.resolve();
    const [first, second] = await Promise.all([abandoned, retry]);
    expect(first).toEqual(second);
    expect(second).toEqual({ ok: true, url: machine.currentUrl() });
    expect(machine.stream.getUrl).toHaveBeenCalledExactlyOnceWith({ authKey: machine.stream.getAuthKey(), viewOnly: true, resize: 'scale' });
    // A later intentional open still rotates access; only overlapping calls coalesce.
    const fresh = await f.open();
    expect(machine.stream.stop).toHaveBeenCalledTimes(2);
    expect(fresh).toEqual({ ok: true, url: machine.currentUrl() });
    expect(fresh).not.toEqual(second);
  });

  it('allows another specialist to open while one provider stream is stalled', async () => {
    const f = fixture(), pause = deferred();
    await Sandbox.connect('sandbox-lease-a');
    f.streams.get('sandbox-lease-a')!.stream.start.mockImplementationOnce(() => pause.promise);
    const first = f.open(); await flush();
    expect(await f.open('designer')).toMatchObject({ ok: true });
    pause.resolve(); expect(await first).toMatchObject({ ok: true });
  });

  it('does not return or reuse the old lease when the task replaces its computer during connection', async () => {
    const f = fixture(), pause = deferred();
    await Sandbox.connect('sandbox-lease-a');
    const old = f.streams.get('sandbox-lease-a')!;
    old.stream.start.mockImplementationOnce(() => pause.promise);
    const pending = f.open(); await flush();
    f.lease('architect', 'lease-next');
    const next = await f.open('architect', 'lease-next');
    expect(next).toEqual({ ok: true, url: f.streams.get('sandbox-lease-next')!.currentUrl() });
    pause.resolve();
    expect(await pending).toMatchObject({ ok: false, status: 409 });
    expect(old.stream.getUrl).not.toHaveBeenCalled();
    expect(next).toEqual({ ok: true, url: f.streams.get('sandbox-lease-next')!.currentUrl() });
  });

  it('rejects stale lease identities and other owners before any stream mutation', async () => {
    const f = fixture();
    expect(await f.open('architect', 'lease-old')).toMatchObject({ ok: false, status: 409 });
    expect(await f.open('architect', 'lease-a', 'another-owner')).toMatchObject({ ok: false, status: 404 });
    expect(Sandbox.connect).not.toHaveBeenCalled();
  });

  it('shares a safe provider failure without retrying, and releases the entry for a later explicit retry', async () => {
    const f = fixture(), pause = deferred();
    await Sandbox.connect('sandbox-lease-a');
    const machine = f.streams.get('sandbox-lease-a')!;
    machine.stream.start.mockImplementationOnce(async () => { await pause.promise; throw new Error('secret provider credential'); });
    const first = f.open(), second = f.open(); await flush(); pause.resolve();
    const failed = await Promise.all([first, second]);
    expect(failed[0]).toEqual(failed[1]);
    expect(failed[0]).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(failed)).not.toContain('secret');
    expect(machine.stream.start).toHaveBeenCalledTimes(1);
    expect(await f.open()).toMatchObject({ ok: true });
    expect(machine.stream.start).toHaveBeenCalledTimes(2);
  });
});
