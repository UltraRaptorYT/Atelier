import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { DesignWorkflow } from '../worker/src/workflow';
import { modelJSON } from '../worker/src/ai';
import { reviewMeeting } from '../worker/src/meeting';
import { generateStudy, loadImageReference, loadConceptContext } from '../worker/src/images';
import { createDesktop, idleDesktop, releaseDesktop, syncDesktop, checkpointDesktop } from '../worker/src/desktop';
import { Sandbox } from '@e2b/desktop';
import { exampleDesign } from '../shared/example';
import { DesignSchema, recolor, type AgentId, type Design } from '../shared/design';
import type { EffectiveRequirements } from '../shared/requirements';
import { DesignEditsSchema, type DesignEdits } from '../shared/design-edits';
import { DesignMergeConflict, mergeDesignProposal, type CollaborationPlan } from '../shared/collaboration';
import type { Bindings, ProjectRow, RunParams } from '../worker/src/types';
import { HttpError } from '../worker/src/security';

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {
    env: unknown;
    constructor(_context: unknown, env: unknown) { this.env = env; }
  },
}));
vi.mock('../worker/src/ai', () => ({ modelJSON: vi.fn() }));
// Team briefing tests exercise the initial meeting. These assertions concern
// the later design task graph and its frozen visual/requirements context.
vi.mock('../worker/src/meeting', () => ({ reviewMeeting: vi.fn() }));
vi.mock('../worker/src/images', async importOriginal => ({
  ...(await importOriginal<typeof import('../worker/src/images')>()),
  generateStudy: vi.fn(), loadImageReference: vi.fn(), loadConceptContext: vi.fn(),
  visualReferenceInstructions: 'Treat the image as visual intent; accepted changes override older image features.',
}));
vi.mock('../worker/src/desktop', () => ({ createDesktop: vi.fn(), idleDesktop: vi.fn(), releaseDesktop: vi.fn(), syncDesktop: vi.fn(), checkpointDesktop: vi.fn() }));
vi.mock('@e2b/desktop', () => ({ Sandbox: { connect: vi.fn() } }));

const brief = { request: 'A courtyard home for four people.', summary: 'Courtyard home', goals: [], constraints: ['Keep the courtyard'], questions: [] };
const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const previewBytes = new Uint8Array(Buffer.from(reference.split(',')[1], 'base64'));
const visualSpec = { summary: 'Recognizable courtyard shell and broad glazing.', landmarks: [
  { id: 'roof', feature: 'Sheltering roof', requirement: 'Retain the roof above the occupied courtyard rooms.' },
  { id: 'glazing', feature: 'Broad glazing', requirement: 'Provide a broad glazed opening in the facade.' },
] };
const model = vi.mocked(modelJSON);
const study = vi.mocked(generateStudy);
const loadReference = vi.mocked(loadImageReference);
const loadContext = vi.mocked(loadConceptContext);
// Real Miniflare D1/R2 work happens before these barriers. The 30-second test
// timeout does not override expect.poll's 1-second default on slower CI runners.
const workflowPollOptions = { timeout: 10_000 };
const visualDirection = { summary: 'Warm timber and red accents around the courtyard.', recommendations: ['Keep the shared courtyard clear of furniture.'], coordination: [{ target: 'architect', message: 'Preserve the courtyard connection for the interior layout.' }] };
const freshPlan: CollaborationPlan = {
  summary: 'Develop the shell and visual direction together, then coordinate interiors and review.',
  tasks: [
    { id: 'shell', title: 'Design the shell', objective: 'Create an accessible courtyard shell.', kind: 'architecture', agent: 'architect', dependencies: [], deliverables: ['Canonical shell'] },
    { id: 'palette', title: 'Study visual direction', objective: 'Propose materials while the shell develops.', kind: 'visual_direction', agent: 'designer', dependencies: [], deliverables: ['Material direction'] },
    { id: 'interior', title: 'Fit out the interior', objective: 'Use the shell and visual study to place furniture.', kind: 'interior', agent: 'designer', dependencies: ['shell', 'palette'], deliverables: ['Interior design'] },
    { id: 'review', title: 'Review the coordinated design', objective: 'Check the saved model and all task outputs.', kind: 'review', agent: 'critic', dependencies: ['interior'], deliverables: ['Review report'] },
  ],
};
const parallelChangePlan: CollaborationPlan = {
  summary: 'Develop the roof and interior independently against the same saved design, then review both.',
  tasks: [freshPlan.tasks[0], { ...freshPlan.tasks[2], dependencies: [] }, { ...freshPlan.tasks[3], dependencies: ['shell', 'interior'] }],
};
const repairPlan: CollaborationPlan = {
  summary: 'Correct the identified roof issue, then review the corrected revision.',
  tasks: [
    { ...freshPlan.tasks[0], id: 'repair', title: 'Correct the roof', objective: 'Correct the roof finding while preserving unaffected elements.' },
    { ...freshPlan.tasks[3], id: 'recheck', dependencies: ['repair'] },
  ],
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const kindOf = (prompt: string) => /\((architecture|interior|visual_direction|review)\)/.exec(prompt)?.[1];
const isExtraction = (prompt: string) => prompt.startsWith('Extract the essential visual landmarks');
const specialistCalls = () => model.mock.calls.filter(([, , agent, prompt]) => agent !== 'principal' && !isExtraction(prompt));
function passingReview(prompt: string, current: Design | null, findings: string[] = []) {
  const spec = /^Visual specification: (.+)$/m.exec(prompt)?.[1];
  const evidence = /^Canonical render evidence: (.+)$/m.exec(prompt)?.[1];
  const review = { findings, summary: 'Review completed with the supplied evidence.' };
  if (!spec || !evidence || !current) return review;
  const landmarks = (JSON.parse(spec) as typeof visualSpec).landmarks;
  const views = (JSON.parse(evidence) as { views: { artifactId: string }[] }).views;
  return { ...review, landmarks: landmarks.map(landmark => ({
    id: landmark.id, status: 'pass', elementIds: [landmark.id === 'accepted-finish' ? 'front-left' : landmark.id],
    evidenceArtifactIds: views.map(view => view.artifactId), explanation: 'The cited current model element is present in the supplied canonical views.',
  })) };
}
const elementColor = (design: Design, id: string) => design.materials.find(material => material.id === design.elements.find(element => element.id === id)?.materialId)?.color;
function editsFor(base: Design, next: Design = base): DesignEdits {
  const changed = <T extends { id: string }>(before: T[], after: T[]) => ({
    upsert: structuredClone(after.filter(item => JSON.stringify(before.find(old => old.id === item.id)) !== JSON.stringify(item))),
    remove: before.filter(item => !after.some(updated => updated.id === item.id)).map(item => item.id),
  });
  return {
    elements: changed(base.elements, next.elements),
    materials: changed(base.materials, next.materials),
    spaces: changed(base.spaces, next.spaces),
    metadata: {
      title: next.title === base.title ? null : next.title,
      buildingType: next.buildingType === base.buildingType ? null : next.buildingType,
      floors: next.floors === base.floors ? null : next.floors,
      spawn: JSON.stringify(next.spawn) === JSON.stringify(base.spawn) ? null : structuredClone(next.spawn),
      notes: JSON.stringify(next.notes) === JSON.stringify(base.notes) ? null : structuredClone(next.notes),
    },
  };
}
function standardResult(agent: AgentId, prompt: string, current: Design | null = null) {
  if (isExtraction(prompt)) return structuredClone(visualSpec);
  if (agent === 'principal') return prompt.startsWith('Prepare a structured brief') ? structuredClone(brief) : structuredClone(freshPlan);
  if (agent === 'critic') return passingReview(prompt, current);
  if (kindOf(prompt) === 'visual_direction') return structuredClone(visualDirection);
  return current ? editsFor(current) : exampleDesign();
}
let mf: Miniflare;
let storage: Pick<Bindings, 'DB' | 'FILES'>;
let previewFailure: 'command-error' | 'invalid-png' | 'stale-revision' | 'wrong-view' | 'wrong-dimensions' | null;

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
  vi.mocked(reviewMeeting).mockResolvedValue([]);
  previewFailure = null;
  let previewRevision = 0, previewElementCount = 0;
  study.mockImplementation(async (_env, params, stage) => `${params.runId}-${stage}.png`);
  loadReference.mockResolvedValue({ bytes: new Uint8Array([1]), mime: 'image/png', dataUrl: reference });
  loadContext.mockResolvedValue({ bytes: new Uint8Array([1]), mime: 'image/png', dataUrl: reference });
  const desktop = {
    files: { write: vi.fn().mockResolvedValue(undefined), read: vi.fn(async (path: string) => {
      if (path.endsWith('.png')) return previewFailure === 'invalid-png' ? new Uint8Array([1, 2, 3]) : previewBytes;
      const view = /preview-(front|rear)\.json$/.exec(path)?.[1];
      if (!view) return '{}';
      return JSON.stringify({
        revision: previewRevision - (previewFailure === 'stale-revision' ? 1 : 0),
        view: previewFailure === 'wrong-view' ? (view === 'front' ? 'rear' : 'front') : view,
        camera: { position: [10, 8, view === 'front' ? -10 : 10], target: [0, 2, 0], front: [0, view === 'front' ? -1 : 1] },
        resolution: [previewFailure === 'wrong-dimensions' ? 2 : 1, 1], samples: 8, source: 'canonical design', elements: previewElementCount,
      });
    }) },
    commands: { run: vi.fn(async (command: string) => {
      if (command.includes('--preview')) {
        previewRevision = Number(/--revision (\d+)/.exec(command)![1]);
        if (previewFailure === 'command-error') return { exitCode: 1, stdout: '', stderr: 'Preview renderer failed' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    }) },
    screenshot: vi.fn().mockResolvedValue(new Uint8Array([1])), open: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(createDesktop).mockImplementation(async (_env, _project, _owner, agent) => ({ sandboxId: `sandbox-${agent}` }) as never);
  vi.mocked(Sandbox.connect).mockResolvedValue(desktop as never);
  vi.mocked(idleDesktop).mockResolvedValue(undefined);
  vi.mocked(releaseDesktop).mockResolvedValue(true);
  vi.mocked(syncDesktop).mockImplementation(async (_desktop, design) => { previewElementCount = design.elements.length; });
  vi.mocked(checkpointDesktop).mockResolvedValue(undefined);
  model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => standardResult(agent, prompt, context?.design));
});

async function fixture(kind: RunParams['kind'], revision = 0, referenceArtifactId?: string, seed?: Design) {
  const projectId = crypto.randomUUID(), userId = crypto.randomUUID(), runId = crypto.randomUUID();
  const initialDesign = revision ? structuredClone(seed || exampleDesign()) : null;
  const versions = new Map<number, Design>(initialDesign ? [[revision, structuredClone(initialDesign)]] : []);
  const key = initialDesign ? `${projectId}/initial.json` : null;
  if (key) await storage.FILES.put(key, JSON.stringify(initialDesign));
  const now = new Date().toISOString();
  await storage.DB.prepare('INSERT INTO projects(id,owner_id,name,brief,revision,design_key,status,created_at,updated_at,concept_artifact_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(projectId, userId, 'Workflow house', JSON.stringify(brief), revision, key, initialDesign ? 'ready' : 'draft', now, now, referenceArtifactId || null).run();
  await storage.DB.prepare('INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(runId, projectId, userId, kind, 'queued', revision, now).run();
  if (key) await storage.DB.prepare('INSERT INTO revisions(project_id,revision,artifact_key,operation_id,created_at) VALUES(?,?,?,?,?)').bind(projectId, revision, key, `initial-${projectId}`, now).run();
  const params: RunParams = { projectId, userId, runId, kind, baseRevision: revision, referenceArtifactId, instruction: kind === 'change' ? 'Make the selected exterior red.' : undefined };
  const commit = vi.fn(async (id: string, base: number, operation: string, design: Design) => {
    const run = await storage.DB.prepare('SELECT status FROM runs WHERE id = ?').bind(runId).first<{ status: string }>();
    if (run?.status !== 'in_progress') throw new Error('Run cancelled.');
    const row = await storage.DB.prepare('SELECT revision FROM projects WHERE id = ?').bind(id).first<{ revision: number }>();
    if (row?.revision !== base) throw new Error('Stale test commit');
    const nextKey = `${id}/${operation}.json`;
    await storage.FILES.put(nextKey, JSON.stringify(design));
    await storage.DB.prepare('INSERT INTO revisions(project_id,revision,artifact_key,operation_id,created_at) VALUES(?,?,?,?,?)').bind(id, base + 1, nextKey, operation, new Date().toISOString()).run();
    // Simulate another visual selection after the first canonical commit. The
    // workflow must continue using the reference frozen at its checkpoint.
    await storage.DB.prepare("UPDATE projects SET revision = ?, design_key = ?, concept_artifact_id = ?, status = 'review' WHERE id = ?")
      .bind(base + 1, nextKey, 'later-user-selected-image.png', id).run();
    versions.set(base + 1, structuredClone(design));
    return base + 1;
  });
  const commitProposal = vi.fn(async (id: string, base: number, operation: string, proposal: Design, _runId: string, agent: AgentId) => {
    const row = (await storage.DB.prepare('SELECT revision,design_key FROM projects WHERE id = ?').bind(id).first<{ revision: number; design_key: string | null }>())!;
    const latest = row.design_key ? await (await storage.FILES.get(row.design_key))!.json<Design>() : null;
    let merged: Design;
    try { merged = mergeDesignProposal(versions.get(base) ?? null, latest, proposal, agent); }
    catch (error) { if (error instanceof DesignMergeConflict) return { revision: null, conflicts: error.paths }; throw error; }
    return { revision: await commit(id, row.revision, operation, merged), conflicts: [] };
  });
  const scheduleChanges = vi.fn().mockResolvedValue(undefined);
  const env = { ...storage, IMAGE_GENERATION_ENABLED: 'true', PROJECTS: { getByName: () => ({ commit, commitProposal, scheduleChanges }) } } as unknown as Bindings;
  const steps: string[] = [];
  const cached = new Map<string, Promise<unknown>>();
  const step = {
    do: async (name: string, ...args: unknown[]) => {
      steps.push(name);
      // Real WorkflowStep serializes both values and thrown exceptions; custom
      // Error subclasses lose their prototypes at the checkpoint boundary.
      if (!cached.has(name)) cached.set(name, (args.at(-1) as () => Promise<unknown>)().then(result => structuredClone(result), error => { throw structuredClone(error); }));
      return cached.get(name);
    },
    sleep: vi.fn().mockRejectedValue(new Error('Unexpected desktop queue wait')),
  };
  const run = async () => {
    const workflow = new DesignWorkflow({} as never, env);
    return workflow.run({ payload: params } as never, step as never);
  };
  const row = async () => (await storage.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>())!;
  const status = async () => (await storage.DB.prepare('SELECT status FROM runs WHERE id = ?').bind(runId).first<{ status: string }>())!.status;
  const design = async () => { const saved = await row(); return saved.design_key ? await (await storage.FILES.get(saved.design_key))!.json<Design>() : null; };
  const tasks = async () => (await storage.DB.prepare('SELECT * FROM tasks WHERE run_id = ?').bind(runId).all()).results;
  const events = async () => (await storage.DB.prepare('SELECT type,message FROM events WHERE project_id = ? ORDER BY id').bind(projectId).all<{type:string;message:string}>()).results;
  return { env, params, commit, commitProposal, scheduleChanges, step, steps, run, row, status, design, tasks, events, initialDesign };
}

async function trackChange(task: Awaited<ReturnType<typeof fixture>>) {
  const p = task.params;
  await storage.DB.prepare("INSERT INTO changes(id,project_id,agent,instruction,element_id,base_revision,reference_artifact_id,status,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)")
    .bind(p.runId, p.projectId, p.agent || 'principal', p.instruction!, p.elementId || null, p.baseRevision, p.referenceArtifactId || null, new Date().toISOString()).run();
  return () => storage.DB.prepare('SELECT * FROM changes WHERE id = ?').bind(p.runId).first();
}

async function requirementsArtifact(task: Awaited<ReturnType<typeof fixture>>) {
  const saved = await storage.DB.prepare('SELECT object_key FROM artifacts WHERE id = ? AND project_id = ?')
    .bind(`${task.params.runId}-effective-requirements.json`, task.params.projectId).first<{ object_key: string }>();
  expect(saved).not.toBeNull();
  return (await storage.FILES.get(saved!.object_key))!.json<EffectiveRequirements>();
}

describe('tracked steering through the real workflow', () => {
  it('persists working and applied before review, then keeps the final review immutable across replay', async () => {
    const task = await fixture('change', 1);
    task.params.elementId = 'front-left'; task.params.agent = 'designer';
    const change = await trackChange(task), releaseReview = deferred();
    let criticStarted = false;
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent === 'principal') return { scope: 'local', color: '#ff0000', elementId: 'front-left', explanation: 'Selected finish only.' };
      if (agent === 'critic') { criticStarted = true; await releaseReview.promise; }
      return standardResult(agent, prompt, context?.design);
    });
    const running = task.run();
    try {
      await expect.poll(() => criticStarted, workflowPollOptions).toBe(true);
      const applied = await change();
      expect(applied).toMatchObject({ status: 'applied', applied_revision: 2, reviewed_at: null, reviewed_revision: null, review_artifact_id: null });
      expect(applied!.started_at).toEqual(expect.any(String));
      expect(applied!.applied_at).toEqual(expect.any(String));
      expect(await task.status()).toBe('in_progress');
      expect(elementColor((await task.design())!, 'front-left')).toBe('#ff0000');
      expect((await task.events()).filter(event => event.type === 'change_applied')).toHaveLength(1);
      expect((await requirementsArtifact(task)).amendments).toEqual([]);
    } finally { releaseReview.resolve(); await running; }
    expect(await task.status()).toBe('completed');
    const reviewed = await change();
    expect(reviewed).toMatchObject({ status: 'applied', applied_revision: 2, reviewed_revision: 2, review_findings: '[]', review_artifact_id: `${task.params.runId}-review.json` });
    expect(reviewed!.reviewed_at).toEqual(expect.any(String));
    const modelCalls = model.mock.calls.length, commits = task.commitProposal.mock.calls.length;
    await task.run();
    expect(await change()).toEqual(reviewed);
    expect(model).toHaveBeenCalledTimes(modelCalls);
    expect(task.commitProposal).toHaveBeenCalledTimes(commits);
    expect((await task.events()).filter(event => event.type === 'change_applied')).toHaveLength(1);
  });

  it('carries authoritative applied history into briefing, planning, visual extraction, specialists and review while freezing each run context', async () => {
    const oldBrief = { ...brief, request: 'A yellow courtyard house for four people, with a new balcony.', goals: ['Yellow exterior', 'Add a balcony'], constraints: ['Keep the courtyard'] };
    const redInstruction = 'Make the front-left exterior red instead of yellow and keep it red in future edits.';
    const spaceInstruction = 'Preserve the courtyard connection when adding future rooms.';
    const futureInstruction = 'Queued only: make every wall purple.';
    const failedInstruction = 'Failed before application: remove the courtyard.';
    for (const kind of ['generate', 'change'] as const) {
      model.mockClear();
      const task = await fixture(kind, 4, 'historical-yellow-reference.png', recolor(exampleDesign(), 'front-left', '#ff0000'));
      if (kind === 'change') { task.params.instruction = 'Add a balcony while preserving accepted exterior finishes.'; await trackChange(task); }
      await storage.DB.prepare('UPDATE projects SET brief = ? WHERE id = ?').bind(JSON.stringify(oldBrief), task.params.projectId).run();
      const redId = crypto.randomUUID(), spaceId = crypto.randomUUID();
      const insert = (id: string, instruction: string, status: string, appliedRevision: number | null, elementId: string | null = null) => storage.DB.prepare('INSERT INTO changes(id,project_id,agent,instruction,element_id,base_revision,status,created_at,applied_revision,applied_at) VALUES(?,?,?,?,?,0,?,?,?,?)')
        .bind(id, task.params.projectId, 'designer', instruction, elementId, status, '2026-09-12T00:00:00.000Z', appliedRevision, appliedRevision === null ? null : '2026-09-12T01:00:00.000Z');
      await storage.DB.batch([
        insert(redId, redInstruction, 'applied', 2, 'front-left'),
        // A later execution failure does not undo already-published work.
        insert(spaceId, spaceInstruction, 'failed', 3),
        insert(crypto.randomUUID(), futureInstruction, 'pending', null),
        insert(crypto.randomUUID(), failedInstruction, 'failed', null),
      ]);
      model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
        if (agent === 'principal' && prompt.startsWith('Prepare a structured brief')) return structuredClone(oldBrief);
        return standardResult(agent, prompt, context?.design);
      });
      await task.run();
      expect(await task.status()).toBe('completed');
      const prompts = model.mock.calls.map(call => call[3]);
      const briefing = prompts.filter(prompt => prompt.startsWith('Prepare a structured brief'));
      expect(briefing).toHaveLength(kind === 'generate' ? 1 : 0);
      expect(prompts.filter(prompt => prompt.startsWith('Create a dependency plan'))).toHaveLength(1);
      expect(prompts.filter(isExtraction)).toHaveLength(1);
      expect(specialistCalls().map(call => kindOf(call[3])).sort()).toEqual(['architecture', 'interior', 'review', 'visual_direction']);
      for (const prompt of prompts) {
        expect(prompt).toContain('AUTHORITATIVE PROJECT REQUIREMENTS');
        expect(prompt).toContain(redInstruction);
        expect(prompt).toContain(spaceInstruction);
        expect(prompt).toContain('Later amendments take precedence');
        expect(prompt).toContain('Never restore a superseded requirement');
        expect(prompt).not.toContain(futureInstruction);
        expect(prompt).not.toContain(failedInstruction);
      }
      const frozen = await requirementsArtifact(task);
      expect(frozen.designRevision).toBe(4);
      expect(frozen.amendments.map(item => item.id)).toEqual([redId, spaceId]);
      expect(frozen.amendments[0]).toMatchObject({ instruction: redInstruction, elementId: 'front-left', appliedRevision: 2 });
      expect(frozen.amendments.some(item => item.id === task.params.runId)).toBe(false);
      expect(elementColor((await task.design())!, 'front-left')).toBe('#ff0000');
      await storage.DB.prepare("UPDATE changes SET instruction = 'A later external history edit must not rewrite a checkpoint.' WHERE id = ?").bind(redId).run();
      await task.run();
      expect(await requirementsArtifact(task)).toEqual(frozen);
    }
  });

  it('keeps the applied revision when Critic execution fails without inventing a reviewed milestone', async () => {
    const task = await fixture('change', 1);
    task.params.elementId = 'front-left'; task.params.agent = 'designer';
    const change = await trackChange(task);
    model.mockImplementation(async (_env, _owner, agent) => {
      if (agent === 'principal') return { scope: 'local', color: '#ff0000', elementId: 'front-left', explanation: 'Selected finish only.' };
      throw new Error('The Critic provider stopped before returning a review.');
    });
    await task.run();
    expect(await task.status()).toBe('failed');
    expect(await change()).toMatchObject({ status: 'failed', applied_revision: 2, applied_at: expect.any(String), reviewed_at: null, reviewed_revision: null, review_artifact_id: null, failure_detail: expect.any(String) });
    expect(elementColor((await task.design())!, 'front-left')).toBe('#ff0000');
    expect((await task.events()).filter(event => event.type === 'change_applied')).toHaveLength(1);
    expect((await task.events()).some(event => event.type === 'final_design_ready')).toBe(false);
  });
});

describe('visual references across the real workflow branch', () => {
  it('uses an explicitly selected concept for every specialist as canonical revisions advance', async () => {
    const frozenId = 'selected-initial-concept.png';
    const task = await fixture('generate', 0, frozenId);
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(study).not.toHaveBeenCalled();
    expect(specialistCalls().map(call => kindOf(call[3])).sort()).toEqual(['architecture', 'interior', 'review', 'visual_direction']);
    expect(specialistCalls().find(call => kindOf(call[3]) === 'architecture')?.[4]).toBe(DesignSchema);
    expect(specialistCalls().find(call => kindOf(call[3]) === 'interior')?.[4]).toBe(DesignEditsSchema);
    for (const call of specialistCalls()) {
      expect(call[6]).toEqual(call[2] === 'critic' ? [reference, reference, reference] : [reference]);
      expect(call[3]).toContain(frozenId);
      expect(call[3]).not.toContain('later-user-selected-image.png');
    }
    expect(loadReference.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(loadReference.mock.calls.every(([, , id]) => id === frozenId)).toBe(true);
    expect(task.commit.mock.calls.map(([, base]) => base)).toEqual([0, 1]);
    expect((await task.row()).revision).toBe(2);
    const spec = await storage.DB.prepare("SELECT object_key FROM artifacts WHERE project_id = ? AND kind = 'visual-specification'").bind(task.params.projectId).first<{ object_key: string }>();
    expect(spec).not.toBeNull();
    expect(await (await storage.FILES.get(spec!.object_key))!.json()).toEqual(visualSpec);
  });

  it('freezes an explicitly chosen concept at its starting revision and retains it after later commits and selections', async () => {
    const selectedId = 'accepted-concept.png';
    const task = await fixture('change', 3, selectedId);
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(study).not.toHaveBeenCalled();
    expect(loadReference.mock.calls[0]).toEqual([task.env, task.params.projectId, selectedId, 3]);
    expect(loadReference.mock.calls.slice(1).every(([, , id]) => id === selectedId)).toBe(true);
    expect(specialistCalls().map(call => kindOf(call[3])).sort()).toEqual(['architecture', 'interior', 'review', 'visual_direction']);
    expect(specialistCalls().every(call => call[6]?.[0] === reference && call[3].includes(selectedId))).toBe(true);
    expect(task.commit.mock.calls.map(([, base]) => base)).toEqual([3, 4]);
    expect((await task.row()).revision).toBe(5);
  });

  it('keeps ordinary local recoloring on the existing canonical path without generating or reusing an image', async () => {
    const task = await fixture('change', 1);
    task.params.elementId = 'front-left';
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
    expect(model.mock.calls.at(-1)?.[6]).toEqual([reference, reference]);
    expect(task.commit).toHaveBeenCalledTimes(1);
    expect(task.commit.mock.calls[0][3]).toEqual(recolor(task.initialDesign!, 'front-left', '#ff0000'));
    expect(createDesktop.mock.calls.map(([, , , agent]) => agent)).toEqual(['critic']);
  });

  it('keeps selected-element recoloring deterministic with an older original concept as background', async () => {
    const task = await fixture('change', 3);
    task.params.elementId = 'front-left';
    task.params.contextArtifactId = 'original-yellow-concept-rev-0.png';
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent === 'principal') return { scope: 'local', color: '#ff0000', elementId: 'front-left', explanation: 'Accepted red overrides the older yellow concept.' };
      if (agent === 'critic') return passingReview(prompt, context?.design ?? null);
      throw new Error('Background context must not turn a local finish edit into model regeneration.');
    });
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(study).not.toHaveBeenCalled();
    expect(loadContext).toHaveBeenCalledExactlyOnceWith(task.env, task.params.projectId, task.params.contextArtifactId);
    expect(model.mock.calls.map(([, , agent]) => agent)).toEqual(['principal', 'critic']);
    expect(model.mock.calls.at(-1)?.[6]).toContain(reference);
    expect(task.commit).toHaveBeenCalledTimes(1);
    expect(await task.design()).toEqual(recolor(task.initialDesign!, 'front-left', '#ff0000'));
    expect(createDesktop.mock.calls.map(([, , , agent]) => agent)).toEqual(['critic']);
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
    expect(releaseDesktop).not.toHaveBeenCalled();
    expect(syncDesktop).not.toHaveBeenCalled();
    expect(checkpointDesktop).not.toHaveBeenCalled();
    expect(task.commit).not.toHaveBeenCalled();
    expect(await task.row()).toEqual(original);
    expect(task.scheduleChanges).toHaveBeenCalledWith(task.params.projectId, task.params.userId);
  });

  it.each(['image'] as const)('preserves a trusted image rejection through serialized %s checkpoints without retrying generation', async kind => {
    const task = await fixture(kind);
    const message = 'OpenAI could not generate this image under its content rules. Revise the concept instructions before trying again.';
    const rejection = new HttpError(422, message);
    expect(structuredClone(rejection)).not.toBeInstanceOf(HttpError);
    study.mockRejectedValueOnce(rejection);
    task.step.do = vi.fn(task.step.do);
    await task.run();
    expect(await task.status()).toBe('failed');
    expect((await task.events()).filter(event => event.type === 'error')).toEqual([{ type: 'error', message }]);
    const imageStep = vi.mocked(task.step.do).mock.calls.find(([name]) => name === 'image-study');
    expect(imageStep?.[1]).toMatchObject({ retries: { limit: 0 } });
    // Replaying a completed failure envelope must not purchase another image.
    await task.run();
    expect(study).toHaveBeenCalledTimes(1);
    expect(createDesktop).not.toHaveBeenCalled();
    expect(Sandbox.connect).not.toHaveBeenCalled();
    expect(specialistCalls()).toHaveLength(0);
    expect(task.commit).not.toHaveBeenCalled();
    expect(await task.design()).toBeNull();
  });

  it.each([
    { kind: 'image', error: new Error('private-provider-detail secret-token') },
    { kind: 'image', error: { name: 'HttpError', status: 422, message: 'private-provider-detail secret-token' } },
  ] as const)('keeps untrusted errors private across a serialized $kind checkpoint ($error.name)', async ({ kind, error }) => {
    const task = await fixture(kind);
    study.mockRejectedValueOnce(error);
    await task.run();
    expect(await task.status()).toBe('failed');
    const errors = (await task.events()).filter(event => event.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('The run stopped before completion.');
    expect(JSON.stringify(await task.events())).not.toContain('private-provider-detail');
    expect(JSON.stringify(await task.events())).not.toContain('secret-token');
    expect(study).toHaveBeenCalledTimes(1);
    expect(createDesktop).not.toHaveBeenCalled();
    expect(task.commit).not.toHaveBeenCalled();
  });

  it('preserves a trusted missing-reference error before starting specialist work', async () => {
    const task = await fixture('change', 1, 'unavailable-reference.png');
    loadReference.mockRejectedValueOnce(new HttpError(404, 'The selected visual reference is unavailable.'));
    await task.run();
    expect(await task.status()).toBe('failed');
    expect((await task.events()).filter(event => event.type === 'error')).toEqual([{ type: 'error', message: 'The selected visual reference is unavailable.' }]);
    expect(study).not.toHaveBeenCalled();
    expect(createDesktop).not.toHaveBeenCalled();
    expect(task.commit).not.toHaveBeenCalled();
  });

  it('treats a Blender Python exception as render failure and retains completed source artifacts', async () => {
    const task = await fixture('render', 1);
    const desktop = {
      commands: { run: vi.fn() }, files: { read: vi.fn() }, open: vi.fn(),
    };
    desktop.commands.run = vi.fn(async (command: string) => {
      // Blender normally exits 0 after a Python exception unless this option
      // occurs before the script. Model that real CLI behavior in the stub.
      const args = command.split(' '), flag = args.indexOf('--python-exit-code');
      return { exitCode: flag >= 0 && args[flag + 1] === '1' && flag < args.indexOf('--python') ? 1 : 0, stdout: '', stderr: 'Traceback: compiler failed' };
    });
    desktop.files.read = vi.fn(async (path: string) => path.endsWith('.py') ? '# Completed compiler source' : new Uint8Array([1, 2, 3]));
    vi.mocked(Sandbox.connect).mockResolvedValue(desktop as never);
    await task.run();
    expect(await task.status()).toBe('failed');
    expect(desktop.commands.run).toHaveBeenCalledTimes(1);
    expect(desktop.open).not.toHaveBeenCalled();
    expect(checkpointDesktop).not.toHaveBeenCalled();
    expect((await task.tasks()).some(value => value.status === 'completed')).toBe(false);
    const artifacts = await storage.DB.prepare('SELECT name FROM artifacts WHERE project_id = ?').bind(task.params.projectId).all<{ name: string }>();
    expect(artifacts.results.map(value => value.name)).toContain('blender-source.py');
  });
});

describe('canonical visual review evidence', () => {
  it('saves the extracted contract before planning and gives the Critic two revision-bound model previews', async () => {
    const task = await fixture('generate', 0, 'selected-direction.png');
    await task.run();
    expect(await task.status()).toBe('completed');
    expect((await task.row()).status).toBe('ready');
    const extractionIndex = model.mock.calls.findIndex(call => isExtraction(call[3]));
    const planningIndex = model.mock.calls.findIndex(call => call[3].startsWith('Create a dependency plan'));
    expect(extractionIndex).toBeGreaterThanOrEqual(0); expect(extractionIndex).toBeLessThan(planningIndex);
    expect(model.mock.calls[extractionIndex][5]).toBeUndefined();
    expect(model.mock.calls[planningIndex][3]).toContain(JSON.stringify(visualSpec));
    expect(model.mock.calls[planningIndex][6]).toEqual([reference]);
    const critic = specialistCalls().find(call => call[2] === 'critic')!;
    expect(critic[5]?.design).toEqual(await task.design());
    expect(critic[6]).toEqual([reference, reference, reference]);
    const evidence = JSON.parse(/^Canonical render evidence: (.+)$/m.exec(critic[3])![1]) as {
      revision: number; referenceArtifactId: string; unavailable: string[];
      views: { view: string; artifactId: string; metadataArtifactId: string }[];
    };
    expect(evidence).toMatchObject({ revision: 2, referenceArtifactId: 'selected-direction.png', unavailable: [] });
    expect(evidence.views.map(view => view.view)).toEqual(['front', 'rear']);
    for (const view of evidence.views) {
      const png = await storage.DB.prepare('SELECT object_key,revision,kind FROM artifacts WHERE project_id = ? AND id = ?').bind(task.params.projectId, view.artifactId).first<{ object_key: string; revision: number; kind: string }>();
      expect(png).toMatchObject({ revision: 2, kind: 'render' });
      expect(new Uint8Array(await (await storage.FILES.get(png!.object_key))!.arrayBuffer())).toEqual(previewBytes);
      const metadata = await storage.DB.prepare('SELECT object_key,revision,kind FROM artifacts WHERE project_id = ? AND id = ?').bind(task.params.projectId, view.metadataArtifactId).first<{ object_key: string; revision: number; kind: string }>();
      expect(metadata).toMatchObject({ revision: 2, kind: 'render-metadata' });
      expect(await (await storage.FILES.get(metadata!.object_key))!.json()).toMatchObject({ revision: 2, view: view.view, source: 'canonical design', elements: (await task.design())!.elements.length, resolution: [1, 1] });
    }
    const desktop = await vi.mocked(Sandbox.connect).mock.results.at(-1)!.value;
    const commands = vi.mocked(desktop.commands.run).mock.calls.map(call => String(call[0])).filter(command => command.includes('--preview'));
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('--preview --view front --revision 2');
    expect(commands[1]).toContain('--preview --view rear --revision 2');
    expect(study).not.toHaveBeenCalled();
  });

  it.each(['command-error', 'invalid-png', 'stale-revision', 'wrong-view', 'wrong-dimensions'] as const)('keeps direct 3D in review when canonical evidence has %s', async failure => {
    previewFailure = failure;
    const task = await fixture('generate');
    await task.run();
    expect(await task.status()).toBe('completed');
    expect((await task.row()).status).toBe('review');
    expect(task.commit).toHaveBeenCalledTimes(2);
    const reviews = specialistCalls().filter(call => call[2] === 'critic');
    expect(reviews).toHaveLength(1);
    expect(reviews[0][6]).toEqual([]);
    expect(reviews[0][3]).toContain('Some required canonical previews failed.');
    expect(model.mock.calls.filter(call => call[3].startsWith('Create a dependency plan'))).toHaveLength(1);
    expect((await task.events()).some(event => event.type === 'final_design_ready')).toBe(false);
    expect(await storage.DB.prepare("SELECT id FROM artifacts WHERE project_id = ? AND kind = 'render'").bind(task.params.projectId).first()).toBeNull();
    expect(study).not.toHaveBeenCalled();
  });

  it.each(['unknown-element', 'unrelated-render', 'missing-landmark', 'failed-landmark'] as const)('rejects a visual pass with %s even when the model returns no general findings', async failure => {
    const task = await fixture('generate', 0, 'selected-direction.png');
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent !== 'critic') return standardResult(agent, prompt, context?.design);
      const result = passingReview(prompt, context?.design ?? null);
      if (!('landmarks' in result)) throw new Error('The Critic did not receive the visual specification and model evidence.');
      if (failure === 'unknown-element') result.landmarks[0].elementIds = ['invented-roof'];
      if (failure === 'unrelated-render') result.landmarks[0].evidenceArtifactIds = ['old-revision-preview.png'];
      if (failure === 'missing-landmark') result.landmarks.pop();
      if (failure === 'failed-landmark') result.landmarks[0].status = 'fail';
      return result;
    });
    await task.run();
    expect(await task.status()).toBe('completed');
    expect((await task.row()).status).toBe('review');
    expect(specialistCalls().filter(call => call[2] === 'critic')).toHaveLength(2);
    const correctivePlan = model.mock.calls.filter(call => call[3].startsWith('Create a dependency plan')).at(-1)!;
    expect(correctivePlan[3]).toMatch(/Visual (correspondence|landmark)/);
    expect((await task.events()).some(event => event.type === 'final_design_ready')).toBe(false);
    expect(model.mock.calls.filter(call => isExtraction(call[3]))).toHaveLength(1);
    expect(study).not.toHaveBeenCalled();
  });
});

describe('dependency-driven specialist collaboration', () => {
  it('starts independent roles together, waits for both, and passes their saved results to the dependent interior task', async () => {
    const task = await fixture('generate');
    const release = deferred(), started = new Set<string>();
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      const kind = kindOf(prompt);
      if (kind === 'architecture' || kind === 'visual_direction') {
        started.add(kind);
        await release.promise;
      }
      if (kind === 'architecture') return { ...exampleDesign(), notes: ['Keep the ARCHITECT_COURTYARD connection.'] };
      return standardResult(agent, prompt, context?.design);
    });
    const running = task.run();
    try {
      await expect.poll(() => [...started].sort(), workflowPollOptions).toEqual(['architecture', 'visual_direction']);
      expect(specialistCalls()).toHaveLength(2);
      expect((await task.tasks()).filter(value => value.status === 'in_progress')).toHaveLength(2);
      expect(task.commitProposal).not.toHaveBeenCalled();
    } finally { release.resolve(); await running; }
    expect(await task.status()).toBe('completed');
    const interior = specialistCalls().find(call => kindOf(call[3]) === 'interior')!;
    expect(interior[3]).toContain(visualDirection.summary);
    expect(interior[3]).toContain('ARCHITECT_COURTYARD');
    expect(interior[5]?.design?.notes).toContain('Keep the ARCHITECT_COURTYARD connection.');
    expect((await task.events()).some(event => event.type === 'agent_message' && event.message.includes(visualDirection.coordination[0].message))).toBe(true);
    expect((await task.tasks()).filter(value => value.status === 'completed').length).toBeGreaterThanOrEqual(4);
    const artifacts = await storage.DB.prepare('SELECT object_key FROM artifacts WHERE project_id = ?').bind(task.params.projectId).all<{ object_key: string }>();
    expect(artifacts.results.length).toBeGreaterThanOrEqual(4);
    for (const artifact of artifacts.results) expect(await storage.FILES.get(artifact.object_key)).not.toBeNull();
  });

  it.each([0, 1250])('merges simultaneous disjoint architecture and interior proposals without losing either edit (desktop delay: %i ms)', async delayMs => {
    const task = await fixture('change', 1);
    const create = vi.mocked(createDesktop).getMockImplementation()!;
    vi.mocked(createDesktop).mockImplementation(async (...args) => {
      // Exercise startup beyond expect.poll's default 1-second deadline.
      if (delayMs) await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      return create(...args);
    });
    const release = deferred(), started = new Set<string>();
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent === 'principal') return structuredClone(parallelChangePlan);
      const kind = kindOf(prompt);
      if (kind === 'architecture' || kind === 'interior') {
        started.add(kind); await release.promise;
        const next = structuredClone(context!.design!);
        if (kind === 'architecture') next.elements.find(element => element.id === 'roof')!.position[1] += .25;
        else next.elements.find(element => element.id === 'sofa')!.position[0] += .4;
        return editsFor(context!.design!, next);
      }
      return standardResult(agent, prompt, context?.design);
    });
    const running = task.run();
    try { await expect.poll(() => [...started].sort(), workflowPollOptions).toEqual(['architecture', 'interior']); }
    finally { release.resolve(); await running; }
    expect(await task.status()).toBe('completed');
    expect(task.commitProposal.mock.calls.map(([, base]) => base)).toEqual([1, 1]);
    const saved = (await task.design())!;
    expect(saved.elements.find(element => element.id === 'roof')!.position[1]).toBe(task.initialDesign!.elements.find(element => element.id === 'roof')!.position[1] + .25);
    expect(saved.elements.find(element => element.id === 'sofa')!.position[0]).toBe(task.initialDesign!.elements.find(element => element.id === 'sofa')!.position[0] + .4);
    expect((await task.row()).revision).toBe(3);
    const critic = specialistCalls().find(call => call[2] === 'critic')!;
    expect(critic[5]?.design).toEqual(saved);
  });

  it('asks the Principal to resolve conflicting edits and reruns only the losing task against the latest revision', async () => {
    const task = await fixture('change', 1);
    let interiorCalls = 0;
    const resolution = 'Preserve the red exterior; apply blue to the sofa instead.';
    const decision = 'Keep the Architect exterior and scope the Designer change to furniture.';
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent === 'principal') return prompt.startsWith('Resolve overlapping edits')
        ? { decision, instruction: resolution }
        : structuredClone(parallelChangePlan);
      if (kindOf(prompt) === 'architecture') return editsFor(context!.design!, recolor(context!.design!, 'front-left', '#ff0000'));
      if (kindOf(prompt) === 'interior') {
        if (++interiorCalls === 1) return editsFor(context!.design!, recolor(context!.design!, 'front-left', '#0000ff'));
        expect(prompt).toContain(resolution);
        expect(elementColor(context!.design!, 'front-left')).toBe('#ff0000');
        return editsFor(context!.design!, recolor(context!.design!, 'sofa', '#0000ff'));
      }
      return standardResult(agent, prompt, context?.design);
    });
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(interiorCalls).toBe(2);
    expect(specialistCalls().filter(call => kindOf(call[3]) === 'architecture')).toHaveLength(1);
    const attempts = await Promise.all(task.commitProposal.mock.results.map(result => result.value));
    expect(attempts.some(result => result.revision === null && result.conflicts.length > 0)).toBe(true);
    const saved = (await task.design())!;
    expect(elementColor(saved, 'front-left')).toBe('#ff0000');
    expect(elementColor(saved, 'sofa')).toBe('#0000ff');
    expect((await task.events()).filter(event => event.type === 'meeting_started')).toHaveLength(1);
    expect((await task.events()).filter(event => event.type === 'meeting_ended').map(event => event.message)).toEqual([parallelChangePlan.summary, decision]);
  });

  it.each(['failed', 'cancelled'] as const)('waits for an in-flight sibling after work is %s and publishes no partial wave or dependent review', async outcome => {
    const task = await fixture('change', 1);
    const architectRelease = deferred(), designerRelease = deferred(), started = new Set<string>();
    let settled = false, designerFinished = false;
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent === 'principal') return structuredClone(parallelChangePlan);
      const kind = kindOf(prompt);
      if (kind === 'architecture') { started.add(kind); await architectRelease.promise; return editsFor(context!.design!, recolor(context!.design!, 'front-left', '#ff0000')); }
      if (kind === 'interior') {
        started.add(kind); await designerRelease.promise; designerFinished = true;
        if (outcome === 'failed') throw new Error('Designer failed before producing a proposal.');
        return editsFor(context!.design!, recolor(context!.design!, 'sofa', '#0000ff'));
      }
      return standardResult(agent, prompt, context?.design);
    });
    const running = task.run().finally(() => { settled = true; });
    try {
      await expect.poll(() => [...started].sort(), workflowPollOptions).toEqual(['architecture', 'interior']);
      if (outcome === 'cancelled') await storage.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE id = ?").bind(task.params.runId).run();
      designerRelease.resolve();
      await expect.poll(() => designerFinished, workflowPollOptions).toBe(true);
      expect(settled).toBe(false);
      expect(await task.status()).toBe(outcome === 'cancelled' ? 'cancelled' : 'in_progress');
      expect(task.commitProposal).not.toHaveBeenCalled();
    } finally { designerRelease.resolve(); architectRelease.resolve(); await running; }
    expect(await task.status()).toBe(outcome);
    expect(task.commitProposal).not.toHaveBeenCalled();
    expect(specialistCalls().some(call => call[2] === 'critic')).toBe(false);
    expect(await task.design()).toEqual(task.initialDesign);
    expect((await task.tasks()).filter(value => ['queued', 'in_progress', 'review', 'blocked'].includes(String(value.status)))).toHaveLength(0);
  });

  it('turns critic findings into one bounded correction plan and checks the corrected revision before readiness', async () => {
    const task = await fixture('change', 1);
    let planCalls = 0, reviewCalls = 0;
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent === 'principal') return structuredClone(++planCalls === 1 ? parallelChangePlan : repairPlan);
      if (agent === 'critic') return ++reviewCalls === 1
        ? { summary: 'The roof needs one correction.', findings: ['Raise the roof by 0.2 metres to resolve the identified clearance.'] }
        : { summary: 'The targeted clearance correction is present.', findings: [] };
      if (prompt.startsWith('Task repair ')) {
        const next = structuredClone(context!.design!);
        next.elements.find(element => element.id === 'roof')!.position[1] += .2;
        return editsFor(context!.design!, next);
      }
      return standardResult(agent, prompt, context?.design);
    });
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(planCalls).toBe(2);
    expect(reviewCalls).toBe(2);
    expect(model.mock.calls.filter(call => call[2] === 'principal')[1][3]).toContain('Raise the roof');
    expect((await task.design())!.elements.find(element => element.id === 'roof')!.position[1]).toBe(task.initialDesign!.elements.find(element => element.id === 'roof')!.position[1] + .2);
    expect((await task.row()).status).toBe('ready');
  });

  it('applies a bathroom-wall correction without deleting omitted facade, window, furniture or light elements', async () => {
    const seed = exampleDesign();
    const bathWall = { ...structuredClone(seed.elements.find(element => element.id === 'west-wall')!), id: 'bath-wall', name: 'Bathroom partition', position: [1, 1.5, -3] as [number, number, number], size: [.18, 3, 2] as [number, number, number] };
    const light = { ...structuredClone(seed.elements.find(element => element.id === 'sofa')!), id: 'bath-light', name: 'Bathroom light', kind: 'light' as const, assetId: null, position: [2, 2.6, -3] as [number, number, number], size: [.3, .15, .3] as [number, number, number] };
    seed.elements.push(bathWall, light);
    seed.spaces.push({ id: 'bathroom', name: 'Bathroom', floor: 0, position: [2, 1.5, -3], size: [2, 3, 2] });
    const task = await fixture('change', 1, undefined, seed);
    task.params.instruction = 'Correct bathroom partition clearance while preserving the rest of the home.';
    const corrected = structuredClone(bathWall);
    corrected.position[0] += .2;
    const correction = editsFor(seed);
    correction.elements.upsert = [corrected];
    expect(() => DesignEditsSchema.parse(correction)).not.toThrow();
    const bathroomRepair: CollaborationPlan = {
      summary: 'Correct only the bathroom partition identified by the review.',
      tasks: [
        { ...repairPlan.tasks[0], id: 'bath-repair', title: 'Correct bathroom partition', objective: 'Move bath-wall by 0.2 metres; preserve every unrelated element.' },
        { ...repairPlan.tasks[1], dependencies: ['bath-repair'] },
      ],
    };
    let planCalls = 0, reviewCalls = 0;
    model.mockImplementation(async (_env, _owner, agent, prompt, schema, context) => {
      if (agent === 'principal') return structuredClone(++planCalls === 1 ? parallelChangePlan : bathroomRepair);
      if (agent === 'critic') return ++reviewCalls === 1
        ? { summary: 'One bathroom correction is required.', findings: ['Move bath-wall by 0.2 metres to improve the partition clearance.'] }
        : { summary: 'Bathroom correction is present and unrelated details remain.', findings: [] };
      if (kindOf(prompt) === 'architecture' || kindOf(prompt) === 'interior') {
        expect(context?.design).not.toBeNull();
        expect(schema).toBe(DesignEditsSchema);
      }
      if (prompt.startsWith('Task bath-repair ')) return structuredClone(correction);
      return standardResult(agent, prompt, context?.design);
    });

    await task.run();

    expect(await task.status()).toBe('completed');
    expect(planCalls).toBe(2);
    expect(reviewCalls).toBe(2);
    const protectedIds = ['front-left', 'glazing', 'sofa', 'bath-light'];
    for (const [, , , proposal] of task.commit.mock.calls) {
      expect(proposal.elements).toHaveLength(seed.elements.length);
      for (const id of protectedIds) expect(proposal.elements.find(element => element.id === id)).toEqual(seed.elements.find(element => element.id === id));
    }
    const expected = structuredClone(seed);
    expected.elements[expected.elements.findIndex(element => element.id === 'bath-wall')] = corrected;
    expect(await task.design()).toEqual(expected);
    const designCalls = specialistCalls().filter(call => ['architecture', 'interior'].includes(kindOf(call[3]) || ''));
    expect(designCalls).toHaveLength(3);
    expect(designCalls.every(call => call[4] === DesignEditsSchema)).toBe(true);
    expect(specialistCalls().filter(call => call[2] === 'critic').at(-1)?.[5]?.design).toEqual(expected);
  });

  it('stops after the correction allowance if the final critic still reports a blocker', async () => {
    const task = await fixture('change', 1);
    let planCalls = 0;
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent === 'principal') return structuredClone(++planCalls === 1 ? parallelChangePlan : repairPlan);
      if (agent === 'critic') return { summary: 'The issue still needs attention.', findings: ['Roof clearance remains unresolved.'] };
      return standardResult(agent, prompt, context?.design);
    });
    await task.run();
    expect(planCalls).toBe(2);
    expect(specialistCalls().filter(call => call[2] === 'critic')).toHaveLength(2);
    expect((await task.row()).status).toBe('review');
    expect((await task.events()).some(event => event.type === 'final_design_ready')).toBe(false);
  });

  it('replays persisted workflow checkpoints without repeating model work, design commits or task artifacts', async () => {
    const task = await fixture('generate', 0, 'selected-before-replay.png');
    await task.run();
    expect(await task.status()).toBe('completed');
    const calls = model.mock.calls.length, commits = task.commitProposal.mock.calls.length;
    const savedTasks = await task.tasks(), savedDesign = await task.design();
    const artifacts = await storage.DB.prepare('SELECT id,object_key FROM artifacts WHERE project_id = ? ORDER BY id').bind(task.params.projectId).all();
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(model).toHaveBeenCalledTimes(calls);
    expect(task.commitProposal).toHaveBeenCalledTimes(commits);
    expect(study).not.toHaveBeenCalled();
    expect(model.mock.calls.filter(call => isExtraction(call[3]))).toHaveLength(1);
    expect(await task.tasks()).toEqual(savedTasks);
    expect(await task.design()).toEqual(savedDesign);
    expect((await storage.DB.prepare('SELECT id,object_key FROM artifacts WHERE project_id = ? ORDER BY id').bind(task.params.projectId).all()).results).toEqual(artifacts.results);
  });

  it('does not publish readiness when cancellation arrives during final review artifact upload', async () => {
    const task = await fixture('change', 1);
    const files = task.env.FILES;
    let cancelledDuringUpload = false;
    task.env.FILES = {
      get: files.get.bind(files),
      put: async (...args: Parameters<typeof files.put>) => {
        const saved = await files.put(...args);
        if (String(args[0]).endsWith('/review.json')) {
          cancelledDuringUpload = true;
          await storage.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE id = ?").bind(task.params.runId).run();
        }
        return saved;
      },
    } as typeof files;
    await task.run();
    expect(cancelledDuringUpload).toBe(true);
    expect(await task.status()).toBe('cancelled');
    expect((await task.row()).status).not.toBe('ready');
    expect((await task.events()).some(event => event.type === 'final_design_ready')).toBe(false);
    expect(await task.design()).not.toBeNull();
    expect(await storage.DB.prepare("SELECT id FROM artifacts WHERE project_id = ? AND name = 'review.json'").bind(task.params.projectId).first()).not.toBeNull();
  });

  it('keeps a legal interior-retry task separate from the conflict retry of the interior task', async () => {
    const task = await fixture('change', 1);
    const plan: CollaborationPlan = {
      summary: 'Coordinate the shell and furniture, then style the coffee table.',
      tasks: [
        ...parallelChangePlan.tasks.slice(0, 2),
        { ...freshPlan.tasks[2], id: 'interior-retry', title: 'Style the coffee table', objective: 'Make the coffee table green.', dependencies: ['interior'] },
        { ...freshPlan.tasks[3], dependencies: ['shell', 'interior-retry'] },
      ],
    };
    let interiorCalls = 0, followupCalls = 0;
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent === 'principal') return prompt.startsWith('Resolve overlapping edits')
        ? { decision: 'Preserve the red exterior.', instruction: 'Apply blue to the sofa while preserving the red exterior.' }
        : structuredClone(plan);
      if (prompt.startsWith('Task interior-retry ')) { followupCalls++; return editsFor(context!.design!, recolor(context!.design!, 'coffee-table', '#00aa00')); }
      if (prompt.startsWith('Task interior ')) return ++interiorCalls === 1
        ? editsFor(context!.design!, recolor(context!.design!, 'front-left', '#0000ff'))
        : editsFor(context!.design!, recolor(context!.design!, 'sofa', '#0000ff'));
      if (kindOf(prompt) === 'architecture') return editsFor(context!.design!, recolor(context!.design!, 'front-left', '#ff0000'));
      return standardResult(agent, prompt, context?.design);
    });
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(interiorCalls).toBe(2);
    expect(followupCalls).toBe(1);
    const saved = (await task.design())!;
    expect(elementColor(saved, 'front-left')).toBe('#ff0000');
    expect(elementColor(saved, 'sofa')).toBe('#0000ff');
    expect(elementColor(saved, 'coffee-table')).toBe('#00aa00');
    const interiors = (await task.tasks()).filter(value => value.kind === 'interior');
    expect(interiors).toHaveLength(2);
    expect(interiors.every(value => value.status === 'completed')).toBe(true);
    expect(new Set(interiors.map(value => value.artifact_id)).size).toBe(2);
  });

  it('reuses the persisted Principal plan when its callback replays before the checkpoint is saved', async () => {
    const task = await fixture('change', 1);
    const db = task.env.DB, originalDo = task.step.do;
    const interruption = new Error('Simulated interruption after the plan artifact was persisted.');
    let interrupted = false, callbackReplays = 0, planCalls = 0;
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (agent === 'principal') return structuredClone(++planCalls === 1 ? freshPlan : repairPlan);
      return standardResult(agent, prompt, context?.design);
    });
    task.env.DB = {
      prepare: (sql: string) => {
        if (!interrupted && sql.includes('INSERT OR IGNORE INTO decisions')) { interrupted = true; throw interruption; }
        return db.prepare(sql);
      },
      batch: db.batch.bind(db),
      exec: db.exec.bind(db),
    } as typeof db;
    task.step.do = async (name, ...args) => {
      if (!/^team-\d+-plan$/.test(name)) return originalDo(name, ...args);
      const callback = args.at(-1) as () => Promise<unknown>;
      return originalDo(name, ...args.slice(0, -1), async () => {
        try { return await callback(); }
        catch (error) {
          if (error !== interruption) throw error;
          callbackReplays++;
          const saved = await storage.DB.prepare("SELECT object_key FROM artifacts WHERE project_id = ? AND kind = 'task-plan'").bind(task.params.projectId).first<{ object_key: string }>();
          expect(saved).not.toBeNull();
          expect(await (await storage.FILES.get(saved!.object_key))!.json()).toEqual(freshPlan);
          // Retry the actual callback, without a fulfilled WorkflowStep cache.
          return callback();
        }
      });
    };
    await task.run();
    expect(callbackReplays).toBe(1);
    expect(planCalls).toBe(1);
    expect(await task.status()).toBe('completed');
    expect((await task.tasks()).filter(value => value.kind).map(value => value.title).sort()).toEqual(freshPlan.tasks.map(value => value.title).sort());
    const saved = await storage.DB.prepare("SELECT object_key FROM artifacts WHERE project_id = ? AND kind = 'task-plan'").bind(task.params.projectId).first<{ object_key: string }>();
    expect(await (await storage.FILES.get(saved!.object_key))!.json()).toEqual(freshPlan);
  });
});

describe('visual reference continuity at workflow boundaries', () => {
  it.each([
    { enabled: 'true', selected: undefined },
    { enabled: 'false', selected: undefined },
    { enabled: 'false', selected: 'selected-before-briefing.png' },
  ])('starts the first design directly with image generation $enabled and reference $selected', async ({ enabled, selected }) => {
    const task = await fixture('generate', 0, selected);
    task.env.IMAGE_GENERATION_ENABLED = enabled;
    await task.run();
    expect(await task.status()).toBe('completed');
    expect(study).not.toHaveBeenCalled();
    expect(specialistCalls().length).toBeGreaterThanOrEqual(4);
    for (const call of specialistCalls()) expect(call[6]).toEqual([...(selected ? [reference] : []), ...(call[2] === 'critic' ? [reference, reference] : [])]);
    expect(model.mock.calls.filter(call => isExtraction(call[3]))).toHaveLength(selected ? 1 : 0);
    if (selected) expect(loadReference.mock.calls.every(([, , id]) => id === selected)).toBe(true);
    else expect(loadReference).not.toHaveBeenCalled();
  });

  it('keeps the selected image through a conflict retry, Critic correction and final re-review', async () => {
    const selected = 'accepted-before-conflict.png';
    const task = await fixture('change', 1, selected);
    let plans = 0, interiors = 0, reviews = 0;
    model.mockImplementation(async (_env, _owner, agent, prompt, _schema, context) => {
      if (isExtraction(prompt)) return structuredClone(visualSpec);
      if (agent === 'principal') {
        if (prompt.startsWith('Resolve overlapping edits')) return { decision: 'Preserve the exterior and recolor the sofa.', instruction: 'Apply blue only to the sofa.' };
        return structuredClone(++plans === 1 ? parallelChangePlan : repairPlan);
      }
      if (agent === 'critic') return passingReview(prompt, context?.design ?? null, ++reviews === 1 ? ['Raise the roof by 0.2 metres.'] : []);
      const base = context!.design!;
      if (prompt.startsWith('Task repair ')) {
        const corrected = structuredClone(base);
        corrected.elements.find(element => element.id === 'roof')!.position[1] += .2;
        return editsFor(base, corrected);
      }
      if (kindOf(prompt) === 'architecture') return editsFor(base, recolor(base, 'front-left', '#ff0000'));
      if (kindOf(prompt) === 'interior') return editsFor(base, recolor(base, ++interiors === 1 ? 'front-left' : 'sofa', '#0000ff'));
      return standardResult(agent, prompt, base);
    });
    await task.run();
    expect(await task.status()).toBe('completed');
    expect((await task.row()).status).toBe('ready');
    expect(interiors).toBe(2);
    expect(plans).toBe(2);
    expect(reviews).toBe(2);
    expect(study).not.toHaveBeenCalled();
    expect(specialistCalls()).toHaveLength(6);
    for (const call of specialistCalls()) {
      expect(call[6]).toEqual(call[2] === 'critic' ? [reference, reference, reference] : [reference]);
      expect(call[3]).toContain(`Visual reference artifact: ${selected}`);
      expect(call[3]).toContain(task.params.instruction);
      expect(call[3]).not.toContain('Visual reference artifact: later-user-selected-image.png');
    }
    expect(loadReference.mock.calls.every(([, , id]) => id === selected)).toBe(true);
    expect((await task.events()).filter(event => event.type === 'meeting_started')).toHaveLength(2);
    expect((await task.design())!.elements.find(element => element.id === 'roof')!.position[1]).toBe(task.initialDesign!.elements.find(element => element.id === 'roof')!.position[1] + .2);
  });
});
