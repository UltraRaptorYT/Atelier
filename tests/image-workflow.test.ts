import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { DesignWorkflow } from '../worker/src/workflow';
import { modelJSON } from '../worker/src/ai';
import { generateStudy, loadImageReference } from '../worker/src/images';
import { createDesktop, idleDesktop, syncDesktop, checkpointDesktop } from '../worker/src/desktop';
import { Sandbox } from '@e2b/desktop';
import { exampleDesign } from '../shared/example';
import { recolor, type Design } from '../shared/design';
import type { Bindings, ProjectRow, RunParams } from '../worker/src/types';

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {
    env: unknown;
    constructor(_context: unknown, env: unknown) { this.env = env; }
  },
}));
vi.mock('../worker/src/ai', () => ({ modelJSON: vi.fn() }));
vi.mock('../worker/src/images', () => ({ generateStudy: vi.fn(), loadImageReference: vi.fn(), visualReferenceInstructions: 'Treat the image as visual intent; preserve canonical requirements.' }));
vi.mock('../worker/src/desktop', () => ({ createDesktop: vi.fn(), idleDesktop: vi.fn(), syncDesktop: vi.fn(), checkpointDesktop: vi.fn() }));
vi.mock('@e2b/desktop', () => ({ Sandbox: { connect: vi.fn() } }));

const brief = { request: 'A courtyard home for four people.', summary: 'Courtyard home', goals: [], constraints: ['Keep the courtyard'], questions: [] };
const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const model = vi.mocked(modelJSON);
const study = vi.mocked(generateStudy);
const loadReference = vi.mocked(loadImageReference);
let mf: Miniflare;
let storage: Pick<Bindings, 'DB' | 'FILES'>;

beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default { fetch() { return new Response("workflow storage"); } };',
    compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], r2Buckets: ['FILES'],
  }));
  storage = await mf.getBindings() as unknown as typeof storage;
  for (const migration of readdirSync('worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(`worker/migrations/${migration}`, 'utf8').split(';').filter(value => value.trim())) await storage.DB.prepare(sql).run();
  }
});
afterAll(async () => { await mf?.dispose(); });

beforeEach(() => {
  vi.resetAllMocks();
  study.mockImplementation(async (_env, params, stage) => `${params.runId}-${stage}.png`);
  loadReference.mockResolvedValue({ bytes: new Uint8Array([1]), mime: 'image/png', dataUrl: reference });
  const desktop = { files: { write: vi.fn().mockResolvedValue(undefined) }, commands: { run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) } };
  vi.mocked(createDesktop).mockImplementation(async (_env, _project, _owner, agent) => ({ sandboxId: `sandbox-${agent}` }) as never);
  vi.mocked(Sandbox.connect).mockResolvedValue(desktop as never);
  vi.mocked(idleDesktop).mockResolvedValue(undefined);
  vi.mocked(syncDesktop).mockResolvedValue(undefined);
  vi.mocked(checkpointDesktop).mockResolvedValue(undefined);
  model.mockImplementation(async (_env, _owner, agent, _prompt, _schema, context) => {
    if (agent === 'principal') return structuredClone(brief);
    if (agent === 'critic') return { findings: [], summary: 'Review completed with the supplied evidence.' };
    return structuredClone(context?.design || exampleDesign());
  });
});

async function fixture(kind: RunParams['kind'], revision = 0, referenceArtifactId?: string) {
  const projectId = crypto.randomUUID(), userId = crypto.randomUUID(), runId = crypto.randomUUID();
  const initialDesign = revision ? exampleDesign() : null;
  const key = initialDesign ? `${projectId}/initial.json` : null;
  if (key) await storage.FILES.put(key, JSON.stringify(initialDesign));
  const now = new Date().toISOString();
  await storage.DB.prepare('INSERT INTO projects(id,owner_id,name,brief,revision,design_key,status,created_at,updated_at,concept_artifact_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(projectId, userId, 'Workflow house', JSON.stringify(brief), revision, key, initialDesign ? 'ready' : 'draft', now, now, referenceArtifactId || null).run();
  await storage.DB.prepare('INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(runId, projectId, userId, kind, 'queued', revision, now).run();
  const params: RunParams = { projectId, userId, runId, kind, baseRevision: revision, referenceArtifactId, instruction: kind === 'change' ? 'Make the selected exterior red.' : undefined };
  const commit = vi.fn(async (id: string, base: number, operation: string, design: Design) => {
    const row = await storage.DB.prepare('SELECT revision FROM projects WHERE id = ?').bind(id).first<{ revision: number }>();
    if (row?.revision !== base) throw new Error('Stale test commit');
    const nextKey = `${id}/${operation}.json`;
    await storage.FILES.put(nextKey, JSON.stringify(design));
    // Simulate another visual selection after the first canonical commit. The
    // workflow must continue using the reference frozen at its checkpoint.
    await storage.DB.prepare('UPDATE projects SET revision = ?, design_key = ?, concept_artifact_id = ? WHERE id = ?')
      .bind(base + 1, nextKey, 'later-user-selected-image.png', id).run();
    return base + 1;
  });
  const scheduleChanges = vi.fn().mockResolvedValue(undefined);
  const env = { ...storage, IMAGE_GENERATION_ENABLED: 'true', PROJECTS: { getByName: () => ({ commit, scheduleChanges }) } } as unknown as Bindings;
  const steps: string[] = [];
  const step = {
    do: async (name: string, ...args: unknown[]) => { steps.push(name); return (args.at(-1) as () => Promise<unknown>)(); },
    sleep: vi.fn().mockRejectedValue(new Error('Unexpected desktop queue wait')),
  };
  const run = async () => {
    const workflow = new DesignWorkflow({} as never, env);
    return workflow.run({ payload: params } as never, step as never);
  };
  const row = async () => (await storage.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>())!;
  const status = async () => (await storage.DB.prepare('SELECT status FROM runs WHERE id = ?').bind(runId).first<{ status: string }>())!.status;
  return { env, params, commit, scheduleChanges, steps, run, row, status, initialDesign };
}

describe('visual references across the real workflow branch', () => {
  it('creates one initial concept and sends that same image to every specialist as canonical revisions advance', async () => {
    const task = await fixture('generate');
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(study).toHaveBeenCalledExactlyOnceWith(task.env, task.params, 'initial-concept', brief);
    const frozenId = `${task.params.runId}-initial-concept.png`;
    const specialistCalls = model.mock.calls.filter(([, , agent]) => agent !== 'principal');
    expect(specialistCalls.map(([, , agent]) => agent)).toEqual(['architect', 'designer', 'critic']);
    for (const call of specialistCalls) {
      expect(call[6]).toEqual([reference]);
      expect(call[3]).toContain(frozenId);
      expect(call[3]).not.toContain('later-user-selected-image.png');
    }
    expect(loadReference.mock.calls.map(([, , id]) => id)).toEqual([frozenId, frozenId, frozenId]);
    expect(task.commit.mock.calls.map(([, base]) => base)).toEqual([0, 1]);
    expect((await task.row()).revision).toBe(2);
    expect(await storage.DB.prepare("SELECT topic FROM decisions WHERE project_id = ? AND topic = 'Initial visual direction'").bind(task.params.projectId).first()).toBeTruthy();
  });

  it('freezes an explicitly chosen concept at its starting revision and retains it after later commits and selections', async () => {
    const selectedId = 'accepted-concept.png';
    const task = await fixture('change', 3, selectedId);
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(study).not.toHaveBeenCalled();
    expect(loadReference.mock.calls[0]).toEqual([task.env, task.params.projectId, selectedId, 3]);
    expect(loadReference.mock.calls.slice(1).map(([, , id, revision]) => ({ id, revision }))).toEqual([
      { id: selectedId, revision: undefined }, { id: selectedId, revision: undefined }, { id: selectedId, revision: undefined },
    ]);
    expect(model.mock.calls.map(([, , agent]) => agent)).toEqual(['architect', 'designer', 'critic']);
    expect(model.mock.calls.every(call => call[6]?.[0] === reference && call[3].includes(selectedId))).toBe(true);
    expect(task.commit.mock.calls.map(([, base]) => base)).toEqual([3, 4]);
    expect((await task.row()).revision).toBe(5);
  });

  it('keeps ordinary local recoloring on the existing canonical path without generating or reusing an image', async () => {
    const task = await fixture('change', 1);
    await storage.DB.prepare('UPDATE projects SET concept_artifact_id = ? WHERE id = ?').bind('historical-concept.png', task.params.projectId).run();
    model.mockImplementation(async (_env, _owner, agent) => {
      if (agent === 'principal') return { scope: 'local', color: '#ff0000', elementId: 'front-left', explanation: 'Change one selected finish.' };
      if (agent === 'critic') return { findings: [], summary: 'The changed finish preserves the model.' };
      throw new Error('A local finish edit must not regenerate the shell or interior');
    });
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(study).not.toHaveBeenCalled();
    expect(loadReference).not.toHaveBeenCalled();
    expect(model.mock.calls.map(([, , agent]) => agent)).toEqual(['principal', 'critic']);
    expect(model.mock.calls.at(-1)?.[6]).toEqual([]);
    expect(task.commit).toHaveBeenCalledTimes(1);
    expect(task.commit.mock.calls[0][3]).toEqual(recolor(task.initialDesign!, 'front-left', '#ff0000'));
  });

  it.each(['completed', 'failed'])('runs a standalone image job to %s without opening or idling workstations', async outcome => {
    const task = await fixture('image', 2);
    const original = await task.row();
    if (outcome === 'failed') study.mockRejectedValueOnce(new Error('Simulated provider failure'));
    await task.run();
    expect(await task.status()).toBe(outcome);
    expect(study).toHaveBeenCalledExactlyOnceWith(task.env, task.params, 'study', brief);
    expect(model).not.toHaveBeenCalled();
    expect(createDesktop).not.toHaveBeenCalled();
    expect(Sandbox.connect).not.toHaveBeenCalled();
    expect(idleDesktop).not.toHaveBeenCalled();
    expect(syncDesktop).not.toHaveBeenCalled();
    expect(checkpointDesktop).not.toHaveBeenCalled();
    expect(task.commit).not.toHaveBeenCalled();
    expect(await task.row()).toEqual(original);
    expect(task.scheduleChanges).toHaveBeenCalledWith(task.params.projectId, task.params.userId);
  });
});
