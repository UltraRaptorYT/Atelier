import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { exampleDesign } from '../shared/example';
import { dispatchPending } from '../worker/src/steering';
import { HttpError } from '../worker/src/security';

let mf: Miniflare, env: any;
const owner = 'local-developer';
const brief = { request: 'A colorful courtyard home for four people.', summary: 'Courtyard home', goals: [], constraints: [], questions: [] };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => mf.dispatchFetch(`http://localhost${path}`, {
  method, headers: { 'X-Atelier-Local': 'true', 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
});
async function project(revision = 0, projectOwner = owner) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  if (revision) await env.FILES.put(`${id}/design.json`, JSON.stringify(exampleDesign()));
  await env.DB.prepare('INSERT INTO projects(id,owner_id,name,brief,revision,design_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, projectOwner, 'Image test', JSON.stringify(brief), revision, revision ? `${id}/design.json` : null, now, now).run();
  return id;
}
async function study(projectId: string, revision = 0) {
  const runId = crypto.randomUUID(), id = `${runId}-concept.png`, metaId = `${runId}-concept.json`, now = new Date().toISOString();
  await env.FILES.put(id, png);
  await env.FILES.put(metaId, '{}');
  await env.DB.prepare("INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,created_at) VALUES(?,?,?,'image','completed',?,?)").bind(runId, projectId, owner, revision, now).run();
  for (const [artifactId, kind, mime, size] of [[id, 'concept_image', 'image/png', png.length], [metaId, 'image_metadata', 'application/json', 2]]) {
    await env.DB.prepare('INSERT INTO artifacts(id,project_id,name,kind,revision,object_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(artifactId, projectId, artifactId, kind, revision, artifactId, mime, size, now).run();
  }
  await env.DB.prepare('INSERT INTO image_studies(id,project_id,run_id,name,prompt,model,revision,metadata_artifact_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id, projectId, runId, 'Courtyard concept', 'Explore a warm palette', 'gpt-image-2.5-flare', revision, metaId, now).run();
  return id;
}
beforeAll(async () => {
  const root = resolve('worker/.atelier/test-worker');
  const wrapper = `import app, { ProjectCoordinator, ComputeBudget } from './index.js';
    import { WorkflowEntrypoint } from 'cloudflare:workers';
    export { ProjectCoordinator, ComputeBudget };
    export class TestWorkflow extends WorkflowEntrypoint { async run() { return { fake: true }; } }
    export default { async fetch(request, env) {
      if (new URL(request.url).pathname === '/test/begin') {
        const params = await request.json();
        try { return Response.json(await env.PROJECTS.getByName(params.projectId).begin(params)); }
        catch (error) { return Response.json({ error: error.message }, { status: 409 }); }
      }
      if (request.headers.get('X-Test-Generation') === 'true') env = { ...env, GENERATION_ENABLED: 'true', E2B_API_KEY: 'fake-no-provider' };
      if (request.headers.get('X-Test-Images') === 'false') env = { ...env, IMAGE_GENERATION_ENABLED: 'false' };
      return app.fetch(request, env);
    } };`;
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'image-routes-test', modules: [{ type: 'ESModule', path: resolve(root, 'image-test-wrapper.js'), contents: wrapper }, { type: 'ESModule', path: resolve(root, 'index.js') }, ...readdirSync(root).filter(name => /\.(py|md)$/.test(name)).map(name => ({ type: 'Text' as const, path: resolve(root, name) }))],
    compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], r2Buckets: ['FILES'],
    durableObjects: { PROJECTS: { className: 'ProjectCoordinator', useSQLite: true }, BUDGET: { className: 'ComputeBudget', useSQLite: true } },
    workflows: { JOBS: { name: 'image-routes-jobs', className: 'TestWorkflow' } },
    outboundService: () => new Response('External provider calls are disabled in route tests.', { status: 502 }),
    bindings: { ENVIRONMENT: 'local', APP_ORIGIN: 'http://localhost', GENERATION_ENABLED: 'false', IMAGE_GENERATION_ENABLED: 'true', RENDER_ENABLED: 'false', OPENAI_API_KEY: 'private-test-key', OPENAI_IMAGE_CONCEPT_MODEL: 'gpt-image-2.5-flare', OPENAI_IMAGE_EDIT_MODEL: 'gpt-image-2.5-sunburst', OPENAI_MODEL: 'gpt-5.6-terra', VOICE_MODEL: 'gpt-live-1', VOICE_ENABLED: 'true', KEY_VERSION: 'v1', E2B_TEMPLATE: 'unused' },
  }] }));
  env = await mf.getBindings('image-routes-test');
  for (const migration of readdirSync('worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(`worker/migrations/${migration}`, 'utf8').split(';').filter(statement => statement.trim())) await env.DB.prepare(sql).run();
  }
});
beforeEach(async () => {
  await env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE status IN ('queued','in_progress')").run();
  await env.DB.prepare("UPDATE changes SET status = 'cancelled' WHERE status = 'pending'").run();
});
afterAll(async () => { await mf?.dispose(); });

describe('image routes with real Worker, D1 and R2 and an inert workflow', () => {
  it('exposes image access independently of desktop generation without exposing credentials', async () => {
    const raw = await (await call('/capabilities')).text();
    expect(JSON.parse(raw)).toMatchObject({ images: true, generation: false, imageModel: 'gpt-image-2.5-flare', imageEditModel: 'gpt-image-2.5-sunburst' });
    expect(raw).not.toContain('private-test-key');
  });

  it('queues a concept before a design exists without requiring E2B or desktop generation', async () => {
    const id = await project(), operationId = crypto.randomUUID();
    const request = { operationId, baseRevision: 0, instruction: 'Explore red courtyard facades', sourceArtifactId: null };
    expect((await call(`/projects/${id}/images`, 'POST', request)).status).toBe(202);
    expect((await call(`/projects/${id}/images`, 'POST', request)).status).toBe(202);
    const snapshot = await (await call(`/projects/${id}`)).json() as any;
    expect(snapshot.runs).toEqual([{ id: operationId, kind: 'image', status: 'queued' }]);
    expect(snapshot.images).toEqual([]);
    expect(snapshot.design).toBeNull();
    expect((await call(`/projects/${id}/images`, 'POST', { ...request, operationId: crypto.randomUUID() }, { 'X-Test-Images': 'false' })).status).toBe(503);
    expect((await call(`/projects/${id}/images`, 'POST', { ...request, instruction: '' })).status).toBe(400);
  });

  it('persists a model capture and its provenance once while preserving the canonical design', async () => {
    const id = await project(2), operationId = crypto.randomUUID();
    const request = { operationId, baseRevision: 2, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
    const first = await call(`/projects/${id}/captures`, 'POST', request);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ artifactId: `${operationId}-capture.png` });
    expect((await call(`/projects/${id}/captures`, 'POST', request)).status).toBe(201);
    const snapshot = await (await call(`/projects/${id}`)).json() as any;
    expect(snapshot.design).toEqual(exampleDesign());
    expect(snapshot.project.revision).toBe(2);
    expect(snapshot.artifacts.map((artifact: any) => artifact.kind).sort()).toEqual(['image_metadata', 'model_capture']);
    expect(snapshot.events.filter((event: any) => event.type === 'artifact_created')).toHaveLength(1);
    expect((await call(`/projects/${id}/captures`, 'POST', { ...request, baseRevision: 1 })).status).toBe(409);
    expect((await call(`/projects/${id}/captures`, 'POST', { ...request, operationId: crypto.randomUUID(), dataUrl: 'data:image/svg+xml,<svg/>' })).status).toBe(413);
  });

  it('rejects foreign or stale image references before queuing a provider job', async () => {
    const id = await project(1), other = await project(), foreign = await study(other), stale = await study(id, 0);
    const request = { operationId: crypto.randomUUID(), baseRevision: 1, instruction: 'Make this red', sourceArtifactId: foreign };
    expect((await call(`/projects/${id}/images`, 'POST', request)).status).toBe(404);
    expect((await call(`/projects/${id}/images`, 'POST', { ...request, sourceArtifactId: stale })).status).toBe(409);
    const valid = await study(id, 1);
    expect((await call(`/projects/${id}/images`, 'POST', { ...request, sourceArtifactId: valid })).status).toBe(202);
    expect(await env.DB.prepare('SELECT reference_artifact_id FROM runs WHERE id = ?').bind(request.operationId).first()).toEqual({ reference_artifact_id: valid });
  });

  it('serves authenticated raster previews inline while keeping metadata as downloads', async () => {
    const id = await project(), image = await study(id);
    const response = await call(`/projects/${id}/artifacts/${image}?inline=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toMatch(/^inline;/);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect((await call(`/projects/${id}/artifacts/${image.replace('.png', '.json')}?inline=1`)).headers.get('Content-Disposition')).toMatch(/^attachment;/);
    const other = await project(0, 'other-owner');
    expect((await call(`/projects/${other}/images`, 'POST', { operationId: crypto.randomUUID(), baseRevision: 0, instruction: 'Explore wood', sourceArtifactId: image })).status).toBe(404);
    expect((await call(`/projects/${other}/artifacts/${image}?inline=1`)).status).toBe(404);
  });

  it('selects a concept and freezes it into initial generation without changing design state', async () => {
    const id = await project(), image = await study(id), operationId = crypto.randomUUID();
    expect((await call(`/projects/${id}/concept`, 'PUT', { operationId, baseRevision: 0, artifactId: image, apply: false })).status).toBe(200);
    const snapshot = await (await call(`/projects/${id}`)).json() as any;
    expect(snapshot.project.selectedConceptId).toBe(image);
    expect(snapshot.project.revision).toBe(0);
    expect(snapshot.images[0]).toMatchObject({ id: image, revision: 0, model: 'gpt-image-2.5-flare' });
    const runId = crypto.randomUUID();
    expect((await call('/test/begin', 'POST', { projectId: id, userId: owner, runId, kind: 'generate', baseRevision: 0 })).status).toBe(200);
    expect(await env.DB.prepare('SELECT reference_artifact_id FROM runs WHERE id = ?').bind(runId).first()).toEqual({ reference_artifact_id: image });
    await env.DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").bind(runId).run();
    await env.DB.prepare('UPDATE projects SET revision = 1 WHERE id = ?').bind(id).run();
    const laterId = crypto.randomUUID();
    expect((await call('/test/begin', 'POST', { projectId: id, userId: owner, runId: laterId, kind: 'generate', baseRevision: 1 })).status).toBe(200);
    expect(await env.DB.prepare('SELECT reference_artifact_id,context_artifact_id FROM runs WHERE id = ?').bind(laterId).first()).toEqual({ reference_artifact_id: null, context_artifact_id: image });
  });

  it('freezes an original selected concept for later steering without treating it as an explicit image application', async () => {
    const id = await project(3), image = await study(id, 0), later = await study(id, 3);
    await env.DB.prepare('UPDATE projects SET concept_artifact_id = ? WHERE id = ?').bind(image, id).run();
    const request = { projectId: id, userId: owner, runId: crypto.randomUUID(), kind: 'change', baseRevision: 3, instruction: 'Make the exterior red.' };
    expect((await call('/test/begin', 'POST', request)).status).toBe(200);
    expect(await env.DB.prepare('SELECT reference_artifact_id,context_artifact_id FROM runs WHERE id = ?').bind(request.runId).first()).toEqual({ reference_artifact_id: null, context_artifact_id: image });
    await env.DB.prepare('UPDATE projects SET concept_artifact_id = ? WHERE id = ?').bind(later, id).run();
    expect((await call('/test/begin', 'POST', request)).status).toBe(200);
    expect(await env.DB.prepare('SELECT context_artifact_id FROM runs WHERE id = ?').bind(request.runId).first()).toEqual({ context_artifact_id: image });
    await env.DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").bind(request.runId).run();
    const explicit = { ...request, runId: crypto.randomUUID(), referenceArtifactId: later };
    expect((await call('/test/begin', 'POST', explicit)).status).toBe(200);
    expect(await env.DB.prepare('SELECT reference_artifact_id,context_artifact_id FROM runs WHERE id = ?').bind(explicit.runId).first()).toEqual({ reference_artifact_id: later, context_artifact_id: null });
  });

  it.each(['edited-study', 'foreign-study', 'wrong-artifact-kind'] as const)('does not reuse a selected %s as historical background', async kind => {
    const id = await project(3), sourceProject = kind === 'foreign-study' ? await project() : id;
    const image = await study(sourceProject, 0);
    if (kind === 'edited-study') await env.DB.prepare('UPDATE image_studies SET source_artifact_id = ? WHERE id = ?').bind('old-capture.png', image).run();
    if (kind === 'wrong-artifact-kind') await env.DB.prepare("UPDATE artifacts SET kind = 'model_capture' WHERE id = ?").bind(image).run();
    await env.DB.prepare('UPDATE projects SET concept_artifact_id = ? WHERE id = ?').bind(image, id).run();
    const runId = crypto.randomUUID();
    expect((await call('/test/begin', 'POST', { projectId: id, userId: owner, runId, kind: 'change', baseRevision: 3, instruction: 'Refine the home.' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT reference_artifact_id,context_artifact_id FROM runs WHERE id = ?').bind(runId).first()).toEqual({ reference_artifact_id: null, context_artifact_id: null });
  });

  it('queues selected visual direction with a frozen reference and rejects it if the model advances', async () => {
    const id = await project(1), image = await study(id, 1), operationId = crypto.randomUUID();
    const request = { operationId, baseRevision: 1, artifactId: image, apply: true };
    expect((await call(`/projects/${id}/concept`, 'PUT', request)).status).toBe(503);
    expect((await call(`/projects/${id}/concept`, 'PUT', request, { 'X-Test-Generation': 'true' })).status).toBe(202);
    expect(await env.DB.prepare('SELECT reference_artifact_id,base_revision,status FROM changes WHERE id = ?').bind(operationId).first()).toEqual({ reference_artifact_id: image, base_revision: 1, status: 'pending' });
    expect((await env.DB.prepare('SELECT instruction FROM changes WHERE id = ?').bind(operationId).first()).instruction).toContain('Explore a warm palette');
    await env.DB.prepare('UPDATE projects SET revision = 2 WHERE id = ?').bind(id).run();
    const begin = vi.fn();
    await dispatchPending({ ...env, GENERATION_ENABLED: 'true' }, id, owner, begin);
    expect(begin).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT status FROM changes WHERE id = ?').bind(operationId).first()).toEqual({ status: 'failed' });
    expect((await call(`/projects/${id}/concept`, 'PUT', { ...request, baseRevision: 2 }, { 'X-Test-Generation': 'true' })).status).toBe(409);
  });

  it('cancels image work and associated changes without releasing the project desktop', async () => {
    const id = await project(), runId = crypto.randomUUID(), leaseId = `${runId}-existing-desktop`;
    expect((await call(`/projects/${id}/images`, 'POST', { operationId: runId, baseRevision: 0, instruction: 'Explore timber', sourceArtifactId: null })).status).toBe(202);
    const budget = env.BUDGET.getByName('desktop-budget');
    expect((await budget.reserve(leaseId, owner, 60)).allowed).toBe(true);
    await env.DB.prepare('INSERT INTO desktop_sessions(project_id,agent,sandbox_id,lease_id,expires_at,viewed_at) VALUES(?,?,?,?,?,?)').bind(id, 'designer', 'unused', leaseId, Date.now() + 60000, Date.now()).run();
    await env.DB.prepare("INSERT INTO changes(id,project_id,agent,instruction,base_revision,status,created_at) VALUES(?,?,'designer','test',0,'in_progress',?)").bind(runId, id, new Date().toISOString()).run();
    expect((await call(`/projects/${id}/runs/${runId}`, 'DELETE')).status).toBe(200);
    expect(await env.DB.prepare('SELECT status FROM changes WHERE id = ?').bind(runId).first()).toEqual({ status: 'cancelled' });
    expect((await budget.reserve(leaseId, owner, 60)).allowed).toBe(true);
    await budget.release(leaseId);
    const retry = await call(`/projects/${id}/images`, 'POST', { operationId: runId, baseRevision: 0, instruction: 'Explore timber', sourceArtifactId: null });
    expect(retry.status).toBe(409);
    expect(await retry.text()).toContain('cancelled');
  });

  it('does not cancel tasks or release a desktop when cancelling an already completed run', async () => {
    const id = await project(), image = await study(id), runId = image.replace('-concept.png', ''), leaseId = `${runId}-old-desktop`;
    const budget = env.BUDGET.getByName('desktop-budget');
    expect((await budget.reserve(leaseId, owner, 60)).allowed).toBe(true);
    await env.DB.prepare("INSERT INTO tasks(id,project_id,run_id,agent,title,status,detail) VALUES(?,?,?,'designer','Completed concept','completed','Saved')").bind(`${runId}-task`, id, runId).run();
    await env.DB.prepare('INSERT INTO desktop_sessions(project_id,agent,sandbox_id,lease_id,expires_at,viewed_at) VALUES(?,?,?,?,?,?)').bind(id, 'designer', 'unused', leaseId, Date.now() + 60000, Date.now()).run();
    expect(await (await call(`/projects/${id}/runs/${runId}`, 'DELETE')).json()).toEqual({ cancelled: false });
    expect(await env.DB.prepare('SELECT status FROM tasks WHERE run_id = ?').bind(runId).first()).toEqual({ status: 'completed' });
    expect((await budget.reserve(leaseId, owner, 60)).allowed).toBe(true);
    await budget.release(leaseId);
  });

  it('reconciles terminal duplicate changes instead of repeatedly dispatching a failed run', async () => {
    const id = await project(), operationId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO changes(id,project_id,agent,instruction,base_revision,status,created_at) VALUES(?,?,'architect','test',0,'pending',?)").bind(operationId, id, new Date().toISOString()).run();
    const begin = vi.fn(async () => {
      await env.DB.prepare("INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,created_at) VALUES(?,?,?,'change','failed',0,?)").bind(operationId, id, owner, new Date().toISOString()).run();
      throw new HttpError(503, 'Dispatch failed');
    });
    await dispatchPending({ ...env, GENERATION_ENABLED: 'true' }, id, owner, begin);
    await dispatchPending({ ...env, GENERATION_ENABLED: 'true' }, id, owner, begin);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare('SELECT status FROM changes WHERE id = ?').bind(operationId).first()).toEqual({ status: 'failed' });
  });
});
