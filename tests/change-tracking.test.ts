import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { exampleDesign } from '../shared/example';
import type { ChangeRecord } from '../shared/design';
import { changeAppliedStatement, changeFailedStatement, changeReviewedStatement, changeStartedStatement } from '../worker/src/changes';
import { artifact, snapshot } from '../worker/src/store';
import { ownedProject } from '../worker/src/security';
import { dispatchPending, queueChange } from '../worker/src/steering';
import type { Bindings, RunParams } from '../worker/src/types';

let mf: Miniflare, env: Bindings;
const brief = { request: 'A yellow courtyard house for four people.', summary: 'Courtyard house', goals: ['Yellow exterior'], constraints: ['Four occupants'], questions: [] };
const now = '2026-09-13T00:00:00.000Z';
let knownHistory: RunParams, unknownHistory: RunParams;

async function project(): Promise<RunParams> {
  const p: RunParams = { projectId: crypto.randomUUID(), userId: crypto.randomUUID(), runId: crypto.randomUUID(), kind: 'change', baseRevision: 0, agent: 'designer', instruction: 'Make the exterior red.', elementId: null };
  await env.DB.prepare('INSERT INTO projects(id,owner_id,name,brief,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(p.projectId, p.userId, 'Tracked house', JSON.stringify(brief), now, now).run();
  return p;
}

async function change(p: RunParams, status = 'pending') {
  await env.DB.prepare('INSERT INTO changes(id,project_id,agent,instruction,element_id,base_revision,status,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(p.runId, p.projectId, p.agent!, p.instruction!, p.elementId || null, p.baseRevision, status, now).run();
}

async function run(p: RunParams, status = 'queued') {
  await env.DB.prepare('INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,instruction,agent,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(p.runId, p.projectId, p.userId, p.kind, status, p.baseRevision, p.instruction!, p.agent!, now).run();
}

async function revision(p: RunParams, revision = 1, operationId = `${p.runId}-initial-task-0`) {
  const key = `${p.projectId}/revisions/${revision}/design.json`;
  await env.FILES.put(key, JSON.stringify(exampleDesign()));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO revisions(project_id,revision,artifact_key,operation_id,created_at) VALUES(?,?,?,?,?)').bind(p.projectId, revision, key, operationId, now),
    env.DB.prepare('UPDATE projects SET revision = ?, design_key = ? WHERE id = ?').bind(revision, key, p.projectId),
  ]);
}

async function record(p: RunParams): Promise<ChangeRecord> {
  return (await snapshot(env, await ownedProject(env, p.projectId, p.userId))).changes!.find(item => item.id === p.runId)!;
}

async function apply(p: RunParams) {
  await change(p); await run(p, 'in_progress'); await changeStartedStatement(env, p).run();
  await revision(p); await changeAppliedStatement(env, p, 1).run();
}

beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("changes"); } };', compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], r2Buckets: ['FILES'] }));
  env = await mf.getBindings() as unknown as Bindings;
  const migrate = async (name: string) => {
    for (const sql of readFileSync(`worker/migrations/${name}`, 'utf8').split(';').filter(value => value.trim())) await env.DB.prepare(sql).run();
  };
  for (const name of readdirSync('worker/migrations').filter(name => name.endsWith('.sql') && name < '0006').sort()) await migrate(name);
  knownHistory = await project(); unknownHistory = await project();
  for (const p of [knownHistory, unknownHistory]) { await change(p, 'applied'); await run(p, 'completed'); }
  await revision(knownHistory);
  await artifact(env, knownHistory.projectId, knownHistory.runId, 'review.json', 'review', 1, '{}', 'application/json');
  await env.DB.prepare("INSERT INTO events(project_id,type,agent,revision,message,created_at,operation_id) VALUES(?,'final_design_ready','principal',1,'Ready',?,?)").bind(knownHistory.projectId, now, `${knownHistory.runId}-review-outcome`).run();
  await migrate('0006_change_tracking.sql');
});
afterAll(async () => { await mf?.dispose(); });

describe('persistent steering lifecycle with real D1 and R2', () => {
  it('backfills only historical application with matching revision and final outcome evidence', async () => {
    expect(await record(knownHistory)).toMatchObject({ status: 'applied', appliedRevision: 1, appliedAt: now, reviewedAt: null });
    expect(await record(unknownHistory)).toMatchObject({ status: 'applied', appliedRevision: null, appliedAt: null, reviewedAt: null });
  });

  it('returns complete, project-scoped history and rejects another owner before reading or dispatching it', async () => {
    const p = await project(), other = await project();
    await change(other);
    await env.DB.batch(Array.from({ length: 105 }, (_, index) => env.DB.prepare("INSERT INTO changes(id,project_id,agent,instruction,base_revision,status,created_at) VALUES(?,?,'designer',?,0,'pending',?)").bind(`${p.runId}-${index}`, p.projectId, `Request ${index}`, now)));
    const result = await snapshot(env, await ownedProject(env, p.projectId, p.userId));
    expect(result.changes).toHaveLength(105);
    expect(result.changes!.every(item => item.id.startsWith(p.runId))).toBe(true);
    expect(result.requirements!.amendments).toEqual([]);
    await expect(ownedProject(env, p.projectId, other.userId)).rejects.toMatchObject({ status: 404 });
    await expect(dispatchPending({ ...env, GENERATION_ENABLED: 'true' }, p.projectId, other.userId, vi.fn())).rejects.toMatchObject({ status: 404 });
  });

  it('saves duplicate requests once and rejects reuse for changed instructions or another owner', async () => {
    const p = await project(), scheduleChanges = vi.fn();
    const connected = { ...env, PROJECTS: { getByName: () => ({ scheduleChanges }) } } as unknown as Bindings;
    const request = { operationId: p.runId, instruction: p.instruction!, agent: p.agent!, elementId: null, baseRevision: 0 };
    await queueChange(connected, p.projectId, p.userId, request);
    await queueChange(connected, p.projectId, p.userId, request);
    expect((await snapshot(env, await ownedProject(env, p.projectId, p.userId))).changes).toHaveLength(1);
    expect(await record(p)).toMatchObject({ status: 'pending', startedAt: null, appliedAt: null, reviewedAt: null });
    await expect(queueChange(connected, p.projectId, p.userId, { ...request, instruction: 'Make it blue.' })).rejects.toMatchObject({ status: 409 });
    await expect(queueChange(connected, p.projectId, 'other-owner', request)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps accepted queued work queued and starts exactly when its run starts', async () => {
    const p = await project(); await change(p); await run(p);
    await changeStartedStatement(env, p).run();
    await dispatchPending({ ...env, GENERATION_ENABLED: 'true' }, p.projectId, p.userId, vi.fn());
    expect(await record(p)).toMatchObject({ status: 'pending', startedAt: null });
    await env.DB.prepare("UPDATE runs SET status = 'in_progress' WHERE id = ?").bind(p.runId).run();
    await changeStartedStatement(env, p).run();
    const started = await record(p);
    await changeStartedStatement(env, p).run();
    expect(await record(p)).toMatchObject({ status: 'in_progress', startedAt: started.startedAt, appliedAt: null, reviewedAt: null });
    expect(started.startedAt).not.toBeNull();
  });

  it('records application separately from review and preserves the first application timestamp through corrections', async () => {
    const p = await project(); await apply(p);
    const applied = await record(p);
    expect(applied).toMatchObject({ status: 'applied', appliedRevision: 1, reviewedAt: null });
    await revision(p, 2, `${p.runId}-correction-task-0`);
    expect((await changeAppliedStatement(env, p, 1).run()).meta.changes).toBe(0);
    await changeAppliedStatement(env, p, 2).run();
    expect(await record(p)).toMatchObject({ appliedAt: applied.appliedAt, appliedRevision: 2, reviewedAt: null });
    const id = await artifact(env, p.projectId, p.runId, 'review.json', 'review', 2, JSON.stringify({ findings: ['Add a usable entrance.'] }), 'application/json');
    expect((await changeReviewedStatement(env, p, 1, 'Stale review', [], id).run()).meta.changes).toBe(0);
    await changeReviewedStatement(env, p, 2, 'One issue remains.', ['Add a usable entrance.'], id).run();
    const reviewed = await record(p);
    expect(reviewed).toMatchObject({ appliedRevision: 2, reviewedRevision: 2, reviewSummary: 'One issue remains.', reviewFindings: ['Add a usable entrance.'], reviewArtifactId: id });
    expect(reviewed.reviewedAt).not.toBeNull();
    await changeReviewedStatement(env, p, 2, 'Retry must not rewrite the saved review.', [], id).run();
    expect(await record(p)).toEqual(reviewed);
  });

  it('fences application by run-owned revision and review by project-owned saved artifact', async () => {
    const p = await project(), other = await project(); await change(p); await run(p, 'in_progress'); await changeStartedStatement(env, p).run();
    await revision(p, 1, 'someone-elses-edit');
    expect((await changeAppliedStatement(env, p, 1).run()).meta.changes).toBe(0);
    await revision(p, 2);
    expect((await changeAppliedStatement(env, { ...p, userId: other.userId }, 2).run()).meta.changes).toBe(0);
    await changeAppliedStatement(env, p, 2).run();
    const wrongArtifact = await artifact(env, other.projectId, other.runId, 'review.json', 'review', 2, '{}', 'application/json');
    expect((await changeReviewedStatement(env, p, 2, 'Wrong project', [], wrongArtifact).run()).meta.changes).toBe(0);
    expect((await changeReviewedStatement(env, p, 2, 'Missing artifact', [], 'missing').run()).meta.changes).toBe(0);
    expect(await record(p)).toMatchObject({ appliedRevision: 2, reviewedAt: null });
  });

  it.each(['failed', 'cancelled'] as const)('preserves applied and reviewed evidence after a later %s run and fences late milestones', async status => {
    const p = await project(); await apply(p);
    const id = await artifact(env, p.projectId, p.runId, 'review.json', 'review', 1, '{}', 'application/json');
    await changeReviewedStatement(env, p, 1, 'Needs review', ['Doorway needs work.'], id).run();
    const previous = await record(p);
    await env.DB.batch([
      env.DB.prepare('UPDATE runs SET status = ? WHERE id = ?').bind(status, p.runId),
      changeFailedStatement(env, p, status, 'Saved work remains available.'),
    ]);
    expect(await record(p)).toEqual({ ...previous, status, failureDetail: 'Saved work remains available.' });
    expect((await changeStartedStatement(env, p).run()).meta.changes).toBe(0);
    expect((await changeAppliedStatement(env, p, 1).run()).meta.changes).toBe(0);
    expect((await changeReviewedStatement(env, p, 1, 'Late success', [], id).run()).meta.changes).toBe(0);
    const saved = await snapshot(env, await ownedProject(env, p.projectId, p.userId));
    expect(saved.requirements!.amendments.map(item => item.instruction)).toEqual([p.instruction]);
  });

  it('does not treat a completed run without application evidence as an applied request', async () => {
    const p = await project(); await change(p); await run(p, 'completed');
    const begin = vi.fn();
    await dispatchPending({ ...env, GENERATION_ENABLED: 'true' }, p.projectId, p.userId, begin);
    await dispatchPending({ ...env, GENERATION_ENABLED: 'true' }, p.projectId, p.userId, begin);
    expect(begin).not.toHaveBeenCalled();
    expect(await record(p)).toMatchObject({ status: 'failed', appliedAt: null, appliedRevision: null, reviewedAt: null, failureDetail: expect.stringContaining('without a recorded application') });
  });
});
