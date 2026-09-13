import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Sandbox } from '@e2b/desktop';
import { ComputeBudget, dailyComputerAllowance } from '../worker/src/budget';
import { createDesktop, releaseDesktop } from '../worker/src/desktop';
import { admission, limits } from '../shared/budget';
import type { Bindings } from '../worker/src/types';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('@e2b/desktop', () => ({ Sandbox: { create: vi.fn(), connect: vi.fn(), kill: vi.fn() } }));
vi.mock('../scripts/blender_compile.py', () => ({ default: '# Test compiler' }));
vi.mock('../scripts/blender_asset.py', () => ({ default: '# Test asset compiler' }));
vi.mock('../worker/src/store', () => ({ emit: vi.fn().mockResolvedValue(undefined), artifact: vi.fn() }));

// Execute production SQL against actual SQLite. Only provider calls, the DO
// wrapper/alarm scheduler, and unrelated event publication are replaced.
const databases: DatabaseSync[] = [];
function fixture(legacy = false) {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  if (legacy) db.exec('CREATE TABLE leases(id TEXT PRIMARY KEY, owner TEXT NOT NULL, day TEXT NOT NULL, month TEXT NOT NULL, seconds INTEGER NOT NULL, expires INTEGER NOT NULL, sandbox TEXT, idle_since INTEGER NOT NULL, busy INTEGER NOT NULL DEFAULT 1, released INTEGER NOT NULL DEFAULT 0)');
  db.exec('CREATE TABLE desktop_sessions(project_id TEXT NOT NULL, agent TEXT NOT NULL, sandbox_id TEXT NOT NULL, lease_id TEXT NOT NULL, expires_at INTEGER NOT NULL, viewed_at INTEGER NOT NULL, PRIMARY KEY(project_id,agent))');
  const setAlarm = vi.fn().mockResolvedValue(undefined);
  const ctx = { storage: { setAlarm, sql: { exec: (statement: string, ...args: (string | number | null)[]) => {
    const rows = db.prepare(statement).all(...args);
    return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('Expected one SQL row'); return rows[0]; } };
  } } } };
  const prepare = (statement: string, args: (string | number | null)[] = []) => ({
    bind: (...values: (string | number | null)[]) => prepare(statement, values),
    first: async () => db.prepare(statement).get(...args) ?? null,
    run: async () => ({ meta: { changes: db.prepare(statement).run(...args).changes } }),
  });
  const env = { GENERATION_ENABLED: 'true', E2B_API_KEY: 'test-key', E2B_TEMPLATE: 'test-desktop', DB: { prepare } } as unknown as Bindings;
  const budget = new ComputeBudget(ctx as unknown as DurableObjectState, env);
  env.BUDGET = { getByName: () => budget } as unknown as Bindings['BUDGET'];
  const lease = (id: string) => db.prepare('SELECT * FROM leases WHERE id = ?').get(id)!;
  const session = (agent = 'architect') => db.prepare('SELECT * FROM desktop_sessions WHERE project_id = ? AND agent = ?').get('project', agent);
  return { db, ctx, env, budget, lease, session, setAlarm };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13T10:00:00Z'));
  vi.mocked(Sandbox.kill).mockResolvedValue(true);
  let next = 0;
  vi.mocked(Sandbox.create).mockImplementation(async () => ({ sandboxId: `sandbox-${++next}`, commands: { run: vi.fn().mockResolvedValue({ exitCode: 0, disconnect: vi.fn().mockResolvedValue(undefined) }) }, files: { write: vi.fn().mockResolvedValue(undefined) } }) as never);
});
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers(); vi.restoreAllMocks(); });
const advance = (seconds: number) => vi.setSystemTime(Date.now() + seconds * 1000);

describe('one-run local verification allowance', () => {
  const runId = '57c78f5b-5a2f-4efa-8e4d-afb9fce67618';
  const day = '2026-09-13';
  const grant = { day, runId, additionalSeconds: 1800 };
  function usedDaily(f: ReturnType<typeof fixture>, owner = 'local-developer') {
    f.db.prepare('INSERT INTO leases(id,owner,day,month,seconds,expires,idle_since,started_at,released) VALUES(?,?,?,?,?,?,?,?,1)')
      .run(`previous-${owner}`, owner, day, day.slice(0,7), 3600, Date.now()-1, Date.now()-3600000, Date.now()-3600000);
  }
  it('admits only the bounded extra 30 minutes after the normal hour is charged, retaining the ledger and lease bounds', async () => {
    const f=fixture();f.env.ENVIRONMENT='local';f.env.LOCAL_VERIFICATION_ALLOWANCE=JSON.stringify(grant);usedDaily(f);
    expect(await f.budget.reserve(`${runId}-architect`, 'local-developer')).toEqual({allowed:true});
    expect(await f.budget.reserve(`${runId}-designer`, 'local-developer')).toEqual({allowed:true});
    expect(await f.budget.reserve(`${runId}-third`, 'local-developer')).toEqual({allowed:false,reason:'queue'});
    expect(f.lease(`${runId}-architect`).seconds).toBe(900);
    advance(901);
    await f.budget.release(`${runId}-architect`);await f.budget.release(`${runId}-designer`);
    expect((await f.budget.reserve(`${runId}-critic`, 'local-developer')).reason).toMatch(/daily/);
    expect(f.db.prepare('SELECT SUM(seconds) AS charged FROM leases').get()!.charged).toBe(5400);
    expect(f.lease('previous-local-developer')).toMatchObject({seconds:3600,released:1});
    expect(limits.userDailySeconds).toBe(3600);expect(limits.leaseSeconds).toBe(900);expect(limits.globalDesktops).toBe(2);
  });
  it.each([
    {name:'missing override',value:undefined},
    {name:'malformed JSON',value:'{"day":'},
    {name:'expired day',value:JSON.stringify({...grant,day:'2026-09-12'})},
    {name:'future day',value:JSON.stringify({...grant,day:'2026-09-14'})},
    {name:'wrong run',value:JSON.stringify({...grant,runId:'aa7c5696-5268-423a-980c-d1183d4c28fb'})},
    {name:'invalid UUID',value:JSON.stringify({...grant,runId:'all'})},
    {name:'oversized grant',value:JSON.stringify({...grant,additionalSeconds:1801})},
    {name:'zero grant',value:JSON.stringify({...grant,additionalSeconds:0})},
    {name:'fractional grant',value:JSON.stringify({...grant,additionalSeconds:1.5})},
    {name:'string grant',value:JSON.stringify({...grant,additionalSeconds:'1800'})},
    {name:'unknown property',value:JSON.stringify({...grant,unlimited:true})},
  ])('retains the normal cap for $name',async({value})=>{
    const f=fixture();f.env.ENVIRONMENT='local';f.env.LOCAL_VERIFICATION_ALLOWANCE=value;usedDaily(f);
    expect((await f.budget.reserve(`${runId}-architect`,'local-developer')).reason).toMatch(/daily/);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM leases').get()!.n).toBe(1);
  });
  it.each(['production','staging'])('has no effect in %s',async environment=>{
    const f=fixture();f.env.ENVIRONMENT=environment;f.env.LOCAL_VERIFICATION_ALLOWANCE=JSON.stringify(grant);usedDaily(f);
    expect((await f.budget.reserve(`${runId}-architect`,'local-developer')).reason).toMatch(/daily/);
  });
  it('does not grant other owners or leases that only contain a similar run prefix',async()=>{
    const f=fixture();f.env.ENVIRONMENT='local';f.env.LOCAL_VERIFICATION_ALLOWANCE=JSON.stringify(grant);usedDaily(f,'another-owner');usedDaily(f);
    expect((await f.budget.reserve(`${runId}-architect`,'another-owner')).reason).toMatch(/daily/);
    for(const lease of [runId,`${runId}extra-architect`,`prefix-${runId}-architect`])expect((await f.budget.reserve(lease,'local-developer')).reason).toMatch(/daily/);
  });
  it('expires at UTC midnight and still enforces smaller grants, monthly accounting and invalid reservation bounds',async()=>{
    const f=fixture();f.env.ENVIRONMENT='local';f.env.LOCAL_VERIFICATION_ALLOWANCE=JSON.stringify({...grant,additionalSeconds:60});usedDaily(f);
    expect((await f.budget.reserve(`${runId}-too-large`,'local-developer',61)).reason).toMatch(/daily/);
    expect(await f.budget.reserve(`${runId}-short`,'local-developer',60)).toEqual({allowed:true});
    expect(dailyComputerAllowance(f.env,'local-developer',`${runId}-next`,'2026-09-14')).toBe(3600);
    f.env.LOCAL_VERIFICATION_ALLOWANCE=JSON.stringify(grant);
    f.db.prepare('INSERT INTO leases(id,owner,day,month,seconds,expires,idle_since,released) VALUES(?,?,?,?,?,?,?,1)')
      .run('monthly-usage','another-owner',day,day.slice(0,7),limits.globalMonthlySeconds,Date.now()-1,Date.now()-1);
    expect((await f.budget.reserve(`${runId}-monthly`,'local-developer')).reason).toMatch(/monthly/);
    expect((await f.budget.reserve(`${runId}-invalid`,'local-developer',901)).reason).toMatch(/Invalid/);
    expect(admission({active:0,dailySeconds:3600,monthlySeconds:3600},900)).toMatch(/daily/);
    for(const limit of [Infinity,5401,NaN])expect(admission({active:0,dailySeconds:3600,monthlySeconds:3600},900,limit)).toMatch(/Invalid/);
  });
});

describe('desktop budget reservation and confirmed usage', () => {
  it('reserves two computers atomically, including the full allowance until shutdown', async () => {
    const f = fixture();
    const results = await Promise.all(['one', 'two', 'three'].map(id => f.budget.reserve(id, 'owner')));
    expect(results.filter(result => result.allowed)).toHaveLength(limits.globalDesktops);
    expect(results[2]).toEqual({ allowed: false, reason: 'queue' });
    expect(f.lease('one').seconds).toBe(900);
    expect(f.lease('two').seconds).toBe(900);
  });

  it('fits generation, reviewed recolor and render when six workstations finish within their actual daily allowance', async () => {
    const f = fixture();
    for (const id of ['generate-architect', 'generate-designer', 'generate-critic', 'recolor-designer', 'recolor-critic', 'render']) {
      expect(await f.budget.reserve(id, 'owner')).toEqual({ allowed: true });
      expect(f.budget.attach(id, `sandbox-${id}`)).toBe(true);
      advance(60.2);
      expect(await f.budget.release(id)).toBe(true);
      expect(f.lease(id)).toMatchObject({ seconds: 61, released: 1 });
    }
    expect(f.db.prepare('SELECT SUM(seconds) AS charged FROM leases').get()!.charged).toBe(366);
    expect(limits.userDailySeconds).toBe(3600);
    expect(limits.globalDesktops).toBe(2);
  });

  it('still rejects a fifth full-duration lease and charges expired machines conservatively', async () => {
    const f = fixture();
    for (let index = 0; index < 4; index++) {
      const id = `full-${index}`;
      expect((await f.budget.reserve(id, 'owner')).allowed).toBe(true);
      f.budget.attach(id, id); advance(901);
      expect(await f.budget.release(id)).toBe(true);
      expect(f.lease(id).seconds).toBe(900);
    }
    expect((await f.budget.reserve('fifth', 'owner')).reason).toMatch(/daily/);
    expect(Sandbox.kill).not.toHaveBeenCalled();
  });

  it('retains both the reservation and the slot when shutdown fails, then reconciles a confirmed retry', async () => {
    const f = fixture();
    await f.budget.reserve('one', 'owner'); f.budget.attach('one', 'machine-one');
    await f.budget.reserve('two', 'owner'); f.budget.attach('two', 'machine-two');
    advance(20.1); vi.mocked(Sandbox.kill).mockRejectedValueOnce(new Error('Provider unavailable'));
    expect(await f.budget.release('one')).toBe(false);
    expect(f.lease('one')).toMatchObject({ seconds: 900, released: 0 });
    expect((await f.budget.reserve('three', 'another-owner')).reason).toBe('queue');
    expect(f.setAlarm).toHaveBeenLastCalledWith(Date.now() + 60000);
    // Installed E2B SDK returns false for a confirmed 404/already-gone machine.
    vi.mocked(Sandbox.kill).mockResolvedValueOnce(false);
    expect(await f.budget.release('one')).toBe(true);
    expect(f.lease('one')).toMatchObject({ seconds: 21, released: 1 });
    expect((await f.budget.reserve('three', 'another-owner')).allowed).toBe(true);
  });

  it('coalesces concurrent releases and cannot refund or kill twice after completion', async () => {
    const f = fixture(); await f.budget.reserve('one', 'owner'); f.budget.attach('one', 'machine'); advance(9.1);
    let stop!: (value: boolean) => void;
    vi.mocked(Sandbox.kill).mockImplementationOnce(() => new Promise(resolve => { stop = resolve; }));
    const first = f.budget.release('one'), second = f.budget.release('one');
    stop(true); expect(await Promise.all([first, second])).toEqual([true, true]);
    advance(100); expect(await f.budget.release('one')).toBe(true);
    expect(f.lease('one').seconds).toBe(10);
    expect(Sandbox.kill).toHaveBeenCalledTimes(1);
  });

  it('retries failed task cleanup at the next alarm before lease expiry, preserving the slot until confirmed', async () => {
    const f = fixture();
    for (const id of ['cleanup', 'busy']) { await f.budget.reserve(id, 'owner'); f.budget.attach(id, `machine-${id}`); }
    advance(20.1); vi.mocked(Sandbox.kill).mockRejectedValueOnce(new Error('Temporary provider outage'));
    expect(await f.budget.release('cleanup')).toBe(false);
    expect(f.lease('cleanup')).toMatchObject({ seconds: 900, released: 0, busy: 0 });
    expect((await f.budget.reserve('waiting', 'another-owner')).reason).toBe('queue');
    advance(60); await f.budget.alarm();
    expect(f.lease('cleanup')).toMatchObject({ seconds: 81, released: 1 });
    expect(f.lease('busy')).toMatchObject({ seconds: 900, released: 0, busy: 1 });
    expect(Sandbox.kill).toHaveBeenCalledTimes(2);
    expect((await f.budget.reserve('waiting', 'another-owner')).allowed).toBe(true);
  });

  it('rejects owner and allowance collisions, never renews a duplicate lease and never reopens a released one', async () => {
    const f = fixture(); await f.budget.reserve('one', 'owner'); f.budget.attach('one', 'machine');
    const expires = f.lease('one').expires; advance(30);
    expect(await f.budget.reserve('one', 'owner')).toEqual({ allowed: true });
    expect((await f.budget.reserve('one', 'other-owner')).reason).toMatch(/another owner/);
    expect((await f.budget.reserve('one', 'owner', 60)).reason).toMatch(/different allowance/);
    expect(f.budget.attach('one', 'machine')).toBe(true);
    expect(f.budget.attach('one', 'other-machine')).toBe(false);
    expect(f.lease('one').expires).toBe(expires);
    await f.budget.release('one');
    expect((await f.budget.reserve('one', 'owner')).reason).toMatch(/expired/);
    expect(f.budget.attach('one', 'new-machine')).toBe(false);
  });

  it('releases idle workstations through alarms and leaves busy machines reserved until expiry', async () => {
    const f = fixture();
    for (const id of ['idle', 'busy']) { await f.budget.reserve(id, 'owner'); f.budget.attach(id, `machine-${id}`); }
    advance(30); f.budget.touch('idle', false); advance(121); await f.budget.alarm();
    expect(f.lease('idle')).toMatchObject({ released: 1, seconds: 151 });
    expect(f.lease('busy')).toMatchObject({ released: 0, seconds: 900 });
    advance(750); await f.budget.alarm();
    expect(f.lease('busy')).toMatchObject({ released: 1, seconds: 900 });
    expect(Sandbox.kill).toHaveBeenCalledTimes(1);
  });

  it('migrates existing SQLite leases once without inventing an elapsed-time refund', async () => {
    const f = fixture(true);
    f.db.prepare('INSERT INTO leases(id,owner,day,month,seconds,expires,sandbox,idle_since) VALUES(?,?,?,?,?,?,?,?)').run('legacy', 'owner', '2026-09-13', '2026-09', 900, Date.now() + 900000, 'old-machine', Date.now());
    const reloaded = new ComputeBudget(f.ctx as unknown as DurableObjectState, f.env);
    expect(await reloaded.release('legacy')).toBe(true);
    expect(f.lease('legacy')).toMatchObject({ started_at: null, seconds: 900, released: 1 });
    expect(f.db.prepare('PRAGMA table_info(leases)').all().filter(column => column.name === 'started_at')).toHaveLength(1);
  });
});

describe('task-owned desktop cleanup', () => {
  it('creates a workstation and releases just the matching task prefix immediately', async () => {
    const f = fixture(); await createDesktop(f.env, 'project', 'owner', 'architect', 'run-task-0'); advance(42.4);
    expect(await releaseDesktop(f.env, 'project', 'architect', 'another-task')).toBe(true);
    expect(f.session()).toBeTruthy(); expect(Sandbox.kill).not.toHaveBeenCalled();
    expect(await releaseDesktop(f.env, 'project', 'architect', 'run-task-')).toBe(true);
    expect(f.session()).toBeUndefined(); expect(f.lease('run-task-0')).toMatchObject({ seconds: 43, released: 1 });
    expect(await releaseDesktop(f.env, 'project', 'architect', 'run-task')).toBe(true);
    expect(Sandbox.kill).toHaveBeenCalledTimes(1);
  });

  it('preserves a newer session installed while an older workstation is shutting down', async () => {
    const f = fixture(); await createDesktop(f.env, 'project', 'owner', 'architect', 'old-task-0');
    let stop!: (value: boolean) => void;
    vi.mocked(Sandbox.kill).mockImplementationOnce(() => new Promise(resolve => { stop = resolve; }));
    const release = releaseDesktop(f.env, 'project', 'architect', 'old-task');
    await Promise.resolve(); await Promise.resolve();
    f.db.prepare('UPDATE desktop_sessions SET lease_id = ?, sandbox_id = ? WHERE project_id = ? AND agent = ?').run('new-task-0', 'new-machine', 'project', 'architect');
    stop(true); expect(await release).toBe(true);
    expect(f.session()).toMatchObject({ lease_id: 'new-task-0', sandbox_id: 'new-machine' });
  });

  it('retains the session and prevents replacement if its old machine cannot be stopped', async () => {
    const f = fixture(); await createDesktop(f.env, 'project', 'owner', 'architect', 'old-task');
    vi.mocked(Sandbox.kill).mockRejectedValue(new Error('Unavailable'));
    expect(await releaseDesktop(f.env, 'project', 'architect', 'old-task')).toBe(false);
    await expect(createDesktop(f.env, 'project', 'owner', 'architect', 'new-task')).rejects.toMatchObject({ status: 425 });
    expect(f.session()).toMatchObject({ lease_id: 'old-task' });
    expect(f.lease('old-task')).toMatchObject({ seconds: 900, released: 0 });
    expect(Sandbox.create).toHaveBeenCalledTimes(1);
  });

  it('refunds an allocation that fails before a sandbox is returned', async () => {
    const f = fixture(); vi.mocked(Sandbox.create).mockRejectedValueOnce(new Error('Template unavailable'));
    await expect(createDesktop(f.env, 'project', 'owner', 'architect', 'failed-task')).rejects.toThrow('Template unavailable');
    expect(f.lease('failed-task')).toMatchObject({ seconds: 0, released: 1 });
    expect(f.session()).toBeUndefined(); expect(Sandbox.kill).not.toHaveBeenCalled();
  });

  it('stops the locally-created machine when attaching its lease fails', async () => {
    const f = fixture(); vi.spyOn(f.budget, 'attach').mockImplementationOnce(() => { throw new Error('Attach unavailable'); });
    await expect(createDesktop(f.env, 'project', 'owner', 'architect', 'attach-task')).rejects.toThrow('Attach unavailable');
    expect(Sandbox.kill).toHaveBeenCalledWith('sandbox-1', { apiKey: 'test-key' });
    expect(f.lease('attach-task')).toMatchObject({ sandbox: 'sandbox-1', released: 1, seconds: 0 });
    expect(f.session()).toBeUndefined();
  });

  it('still attempts local shutdown without refunding if both attachment and budget cleanup are unavailable', async () => {
    const f = fixture();
    vi.spyOn(f.budget, 'attach').mockImplementationOnce(() => { throw new Error('Attach unavailable'); });
    vi.spyOn(f.budget, 'release').mockRejectedValue(new Error('Budget unavailable'));
    await expect(createDesktop(f.env, 'project', 'owner', 'architect', 'unavailable-task')).rejects.toThrow('Attach unavailable');
    expect(Sandbox.kill).toHaveBeenCalledWith('sandbox-1', { apiKey: 'test-key' });
    expect(f.lease('unavailable-task')).toMatchObject({ seconds: 900, released: 0 });
    expect(f.session()).toBeUndefined();
    vi.mocked(f.budget.release).mockRestore(); advance(901); await f.budget.alarm();
    expect(f.lease('unavailable-task')).toMatchObject({ seconds: 900, released: 1 });
  });

  it('keeps failed attachment cleanup charged and discoverable for the alarm when provider shutdown fails', async () => {
    const f = fixture(); vi.spyOn(f.budget, 'attach').mockImplementationOnce(() => { throw new Error('Attach unavailable'); });
    vi.mocked(Sandbox.kill).mockRejectedValue(new Error('Kill unavailable'));
    await expect(createDesktop(f.env, 'project', 'owner', 'architect', 'orphan-task')).rejects.toThrow('Attach unavailable');
    expect(f.lease('orphan-task')).toMatchObject({ sandbox: 'sandbox-1', released: 0, seconds: 900 });
    advance(901); await f.budget.alarm();
    expect(f.lease('orphan-task')).toMatchObject({ released: 1, seconds: 900 });
  });
});
