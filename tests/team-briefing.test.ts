import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DesignWorkflow } from '../worker/src/workflow';
import { modelJSON } from '../worker/src/ai';
import { generateStudy } from '../worker/src/images';
import { runTeam } from '../worker/src/team';
import { dispatchClarification } from '../worker/src/clarifications';
import { BriefSchema, type Brief } from '../shared/design';
import type { Bindings, RunParams } from '../worker/src/types';

vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {
  constructor(_context: unknown, public env: unknown) {}
} }));
vi.mock('../worker/src/ai', () => ({ modelJSON: vi.fn() }));
vi.mock('../worker/src/images', () => ({ generateStudy: vi.fn(), loadImageReference: vi.fn(), loadConceptContext: vi.fn() }));
vi.mock('../worker/src/team', () => ({ runTeam: vi.fn() }));
vi.mock('../worker/src/desktop', () => ({ createDesktop: vi.fn(), idleDesktop: vi.fn(), syncDesktop: vi.fn(), checkpointDesktop: vi.fn() }));

// The HTTP routes, coordinator, D1/R2 and Principal workflow are real. Only
// provider responses, specialist execution and automatic job delivery are fake.
let mf: Miniflare, env: Bindings;
const owner = 'local-developer';
const original: Brief = { request: 'A compact courtyard home for four people.', summary: 'Courtyard home', goals: [], constraints: [], questions: [] };
const perspective = { understanding: 'Preserve the shared courtyard and four-person occupancy.', question: null };
function principalResponse(brief: Brief) {
  for (let specialist = 0; specialist < 3; specialist++) vi.mocked(modelJSON).mockResolvedValueOnce(perspective);
  vi.mocked(modelJSON).mockResolvedValueOnce(brief);
}
const clarification: Brief = {
  ...original, summary: 'Resolve the conflicting floor requirements before design.',
  goals: ['House four people'], constraints: ['Keep the courtyard'],
  questions: ['One floor or two?', 'Should all bedrooms be upstairs?', 'Is step-free access required?'],
};
const call = (path: string, method = 'GET', body?: unknown) => mf.dispatchFetch(`http://localhost${path}`, {
  method, headers: { 'X-Atelier-Local': 'true', 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function snapshot(id: string) { return (await call(`/projects/${id}`)).json() as Promise<any>; }
async function createProject() {
  const response = await call('/projects', 'POST', { name: 'Briefing workflow test', brief: original });
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}
async function start(projectId: string) {
  const runId = crypto.randomUUID();
  const response = await call(`/projects/${projectId}/runs`, 'POST', { operationId: runId, kind: 'generate', baseRevision: 0 });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ runId });
  return { projectId, userId: owner, runId, kind: 'generate', baseRevision: 0 } satisfies RunParams;
}
async function deliver(params: RunParams) {
  const step = { do: async (_name: string, ...args: unknown[]) => structuredClone(await (args.at(-1) as () => Promise<unknown>)()), sleep: vi.fn() };
  return new DesignWorkflow({} as never, env).run({ payload: params } as never, step as never);
}
async function blockedProject() {
  const projectId = await createProject(), params = await start(projectId);
  principalResponse(clarification);
  expect(await deliver(params)).toEqual({ needsClarification: true });
  return { projectId, params };
}
function answerMessage(saved: any, answers: string[], operationId = crypto.randomUUID()) {
  return { operationId, instruction: answers.join(' '), agent: 'principal', elementId: null, baseRevision: saved.project.revision,
    intent: 'answer_clarification', clarificationId: saved.clarification.id, clarificationVersion: saved.clarification.version,
    answers: saved.clarification.questions.filter((question: any) => question.answer === null).slice(0, answers.length).map((question: any, index: number) => ({ questionId: question.id, answer: answers[index] })) };
}

beforeAll(async () => {
  const root = resolve('worker/.atelier/test-worker');
  const wrapper = `import app, { ProjectCoordinator, ComputeBudget } from './index.js';
    import { WorkflowEntrypoint } from 'cloudflare:workers';
    export { ProjectCoordinator, ComputeBudget };
    export class DeliveredByTest extends WorkflowEntrypoint { async run() { return {}; } }
    export default app;`;
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'briefing-test', modules: [
      { type: 'ESModule', path: resolve(root, 'briefing-wrapper.js'), contents: wrapper },
      { type: 'ESModule', path: resolve(root, 'index.js') },
      ...readdirSync(root).filter(name => /\.(py|md)$/.test(name)).map(name => ({ type: 'Text' as const, path: resolve(root, name) })),
    ], compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], r2Buckets: ['FILES'],
    durableObjects: { PROJECTS: { className: 'ProjectCoordinator', useSQLite: true }, BUDGET: { className: 'ComputeBudget', useSQLite: true } },
    workflows: { JOBS: { name: 'briefing-jobs', className: 'DeliveredByTest' } },
    outboundService: () => new Response('No external provider calls in briefing tests.', { status: 502 }),
    bindings: { ENVIRONMENT: 'local', APP_ORIGIN: 'http://localhost', GENERATION_ENABLED: 'true', IMAGE_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'test-only', E2B_API_KEY: 'test-only', E2B_TEMPLATE: 'unused' },
  }] }));
  env = await mf.getBindings('briefing-test') as unknown as Bindings;
  for (const name of readdirSync('worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(`worker/migrations/${name}`, 'utf8').split(';').filter(sql => sql.trim())) await env.DB.prepare(sql).run();
  }
});
beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(runTeam).mockResolvedValue(undefined);
  vi.mocked(generateStudy).mockImplementation(async (_env, p, stage) => `${p.runId}-${stage}.png`);
  await env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE status IN ('queued','in_progress','awaiting_input')").run();
  await env.DB.prepare("UPDATE project_clarifications SET status = 'cancelled' WHERE status IN ('queued','awaiting_input')").run();
  await env.DB.prepare("UPDATE changes SET status = 'cancelled' WHERE status = 'pending'").run();
  // Each scenario gets its own projects; earlier fixtures must not consume the
  // account's ten-project limit or leave clarification receipts in later cases.
  await env.DB.prepare('DELETE FROM projects').run();
});
afterAll(async () => { await mf?.dispose(); });

describe('team briefing, saved clarification and automatic continuation', () => {
  it('preserves the complete original two-storey request even if the Principal rewrites its request field', async () => {
    const request = readFileSync('docs/draftroom/prompts/projects/03-pikachu-house.md', 'utf8');
    expect(request.length).toBeGreaterThan(2000);
    const response = await call('/projects', 'POST', { name: 'Original Pikachu brief', brief: { ...original, request, summary: request.slice(0, 2000) } });
    expect(response.status).toBe(201);
    const projectId = (await response.json() as { id: string }).id;
    expect((await snapshot(projectId)).project.brief.request).toBe(request);
    principalResponse({ ...original, request: 'A simplified single-storey house.', summary: 'Two-storey family house', questions: [] });
    await deliver(await start(projectId));
    expect((await snapshot(projectId)).project.brief.request).toBe(request);
    expect(vi.mocked(runTeam).mock.calls[0][3].request).toBe(request);
    const principalPrompt = vi.mocked(modelJSON).mock.calls.find(call => call[2] === 'principal')![3];
    expect(principalPrompt).toContain(perspective.understanding);
    expect(principalPrompt).toContain('AUTHORITATIVE PROJECT REQUIREMENTS');
  });

  it('consults the team and saves the structured brief, stopping before images or design tasks', async () => {
    const { projectId, params } = await blockedProject();
    expect((await call(`/projects/${projectId}/runs`, 'POST', { operationId: params.runId, kind: 'generate', baseRevision: 0 })).status).toBe(202);
    const saved = await snapshot(projectId);
    expect(saved.runs).toHaveLength(1);
    expect(saved.runs[0]).toMatchObject({ id: params.runId, kind: 'generate', status: 'awaiting_input' });
    expect(saved.clarification).toMatchObject({ runId: params.runId, status: 'awaiting_input', version: 1, continuationRunId: null });
    expect(saved.clarification.questions.map((question: any) => question.question)).toEqual(clarification.questions);
    expect(saved.clarification.questions.every((question: any) => question.answer === null)).toBe(true);
    expect(saved.project.brief).toEqual(clarification);
    expect(saved.events.filter((event: any) => event.type === 'agent_message').map((event: any) => event.agent).sort()).toEqual(['architect', 'critic', 'designer']);
    expect(saved.tasks).toHaveLength(1);
    expect(saved.tasks[0]).toMatchObject({ agent: 'principal', title: 'Clarify brief', status: 'blocked' });
    expect(saved.events.filter((event: any) => event.type === 'clarification_requested')).toEqual([
      expect.objectContaining({ agent: 'principal', message: clarification.questions.join('\n') }),
    ]);
    expect(saved.design).toBeNull();
    expect(saved.artifacts.map(artifact => artifact.kind)).toEqual(['generation-profile']);
    expect(generateStudy).not.toHaveBeenCalled();
    expect(runTeam).not.toHaveBeenCalled();
  });

  it('accepts Save existing brief and starts a new briefing with the answers before dispatching specialists', async () => {
    const { projectId, params: first } = await blockedProject();
    const request = `${original.request}\nTwo floors, upstairs bedrooms, no step-free access requirement.`;
    const edited = { request, summary: request, goals: [], constraints: [], questions: [] };
    expect((await call(`/projects/${projectId}/brief`, 'PUT', { name: 'Answered briefing', brief: edited })).status).toBe(200);
    expect(runTeam).not.toHaveBeenCalled();
    const answered = { ...clarification, request, questions: [] };
    principalResponse(answered);
    const next = await start(projectId);
    await deliver(next);
    expect(next.runId).not.toBe(first.runId);
    expect(vi.mocked(modelJSON).mock.calls.at(-1)?.[3]).toContain(request);
    expect(vi.mocked(modelJSON).mock.calls.at(-1)?.[4]).toBe(BriefSchema);
    expect(runTeam).toHaveBeenCalledExactlyOnceWith(env, next, expect.anything(), answered, null, null);
    expect(generateStudy).not.toHaveBeenCalled();
    const saved = await snapshot(projectId);
    expect(saved.runs).toHaveLength(2);
    expect(saved.runs.find((run: any) => run.id === first.runId).status).toBe('cancelled');
    expect(saved.runs.find((run: any) => run.id === next.runId).status).toBe('completed');
    expect(saved.clarification.status).toBe('superseded');
    expect(saved.project.brief).toEqual(answered);
    expect(saved.events.some((event: any) => event.type === 'clarification_received')).toBe(true);
  });

  it('saves clarification answers and automatically starts one linked generation without creating a change', async () => {
    const { projectId, params } = await blockedProject();
    const before = await snapshot(projectId), message = answerMessage(before, ['Two floors.', 'Bedrooms upstairs.', 'No step-free access requirement.']);
    const response = await call(`/projects/${projectId}/messages`, 'POST', message);
    expect(response.status).toBe(202);
    const result = await response.json() as {runId:string};
    const saved = await snapshot(projectId);
    expect(saved.project.brief.request).toContain(original.request);
    expect(saved.project.brief.request).toContain('Two floors.');
    expect(saved.project.brief.goals).toEqual(clarification.goals);
    expect(saved.project.brief.constraints).toEqual(clarification.constraints);
    expect(saved.project.brief.questions).toEqual([]);
    expect(await env.DB.prepare('SELECT id FROM changes WHERE project_id = ?').bind(projectId).first()).toBeNull();
    await expect.poll(async () => (await snapshot(projectId)).runs.find((run: any) => run.id === result.runId), { timeout: 10_000 }).toMatchObject({ kind: 'generate', resumesRunId: params.runId });
    const replay = await call(`/projects/${projectId}/messages`, 'POST', message);
    expect(await replay.json()).toEqual(result);
    const next: RunParams = { projectId, userId: owner, runId: result.runId, kind: 'generate', baseRevision: 0, resumesRunId: params.runId };
    vi.mocked(modelJSON).mockResolvedValueOnce(saved.project.brief);
    await deliver(next);
    expect(runTeam).toHaveBeenCalledExactlyOnceWith(env, next, expect.anything(), saved.project.brief, null, null);
    const completed = await snapshot(projectId);
    expect(completed.runs).toHaveLength(2);
    expect(completed.runs.every((run: any) => run.status === 'completed')).toBe(true);
    expect(completed.messages).toHaveLength(1);
    expect(completed.messages[0]).toMatchObject({ intent: 'answer_clarification', agent: 'principal', instruction: message.instruction });
  });

  it('keeps partial answers across reloads and rejects a different message using the stale question version', async () => {
    const { projectId } = await blockedProject(), before = await snapshot(projectId);
    const message = answerMessage(before, ['Two floors.']);
    const response = await call(`/projects/${projectId}/messages`, 'POST', message);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ saved: true, queued: false });
    const replay = await call(`/projects/${projectId}/messages`, 'POST', message);
    expect(await replay.json()).toEqual(result);
    const saved = await snapshot(projectId);
    expect(saved.clarification).toMatchObject({ status: 'awaiting_input', version: 2, continuationRunId: null });
    expect(saved.clarification.questions[0].answer).toBe('Two floors.');
    expect(saved.project.brief.questions).toEqual(clarification.questions.slice(1));
    expect(saved.project.brief.request.match(/Answer: Two floors\./g)).toHaveLength(1);
    expect(saved.runs).toHaveLength(1);
    const stale = await call(`/projects/${projectId}/messages`, 'POST', { ...message, operationId: crypto.randomUUID() });
    expect(stale.status).toBe(409);
    expect((await snapshot(projectId)).project.brief).toEqual(saved.project.brief);
  });

  it('preserves a maximum-length brief and its accepted answers through Principal normalization', async () => {
    const request = `A courtyard home for four people. ${'Preserve the existing architectural requirements. '.repeat(180)}`.slice(0, 8000);
    expect(request).toHaveLength(8000);
    const created = await call('/projects', 'POST', { name: 'Long brief', brief: { ...original, request } });
    expect(created.status).toBe(201);
    const projectId = (await created.json() as {id:string}).id, first = await start(projectId);
    principalResponse({ ...clarification, request });
    await deliver(first);
    const before = await snapshot(projectId), answers = ['Two floors.', 'All bedrooms upstairs.', 'Step-free ground floor access.'];
    const response = await call(`/projects/${projectId}/messages`, 'POST', answerMessage(before, answers));
    expect(response.status).toBe(202);
    const result = await response.json() as {runId:string};
    const answered = (await snapshot(projectId)).project.brief;
    expect(answered.request).toBe(request);
    expect(answered.clarificationAnswers).toEqual(clarification.questions.map((question, index) => ({ question, answer: answers[index] })));
    await expect.poll(async () => (await snapshot(projectId)).runs.find((run: any) => run.id === result.runId), { timeout: 10_000 }).toBeDefined();
    vi.mocked(modelJSON).mockResolvedValueOnce({ ...answered, clarificationAnswers: [{ question: 'Invented by the Principal?', answer: 'Not a client answer.' }] });
    const next: RunParams = { projectId, userId: owner, runId: result.runId, kind: 'generate', baseRevision: 0, resumesRunId: first.runId };
    await deliver(next);
    expect((await snapshot(projectId)).project.brief).toEqual(answered);
    expect(vi.mocked(runTeam).mock.calls[0][3].clarificationAnswers).toEqual(answered.clarificationAnswers);
  });

  it.each(['revision', 'brief'] as const)('supersedes an answered continuation if an independent %s update makes its captured context stale', async field => {
    const { projectId, params } = await blockedProject(), before = await snapshot(projectId);
    // Hold the owner slot so the alarm cannot admit the continuation before
    // the independent canonical write below has happened.
    await start(await createProject());
    const response = await call(`/projects/${projectId}/messages`, 'POST', answerMessage(before, ['Two floors.', 'Upstairs.', 'Not required.']));
    expect(response.status).toBe(202);
    if (field === 'revision') await env.DB.prepare('UPDATE projects SET revision = revision + 1 WHERE id = ?').bind(projectId).run();
    else await env.DB.prepare('UPDATE projects SET brief = ? WHERE id = ?').bind(JSON.stringify({ ...original, request: 'A separately updated brief that replaces the captured context.' }), projectId).run();
    const begin = vi.fn();
    await dispatchClarification(env, projectId, owner, begin);
    expect(begin).not.toHaveBeenCalled();
    const saved = await snapshot(projectId);
    expect(saved.clarification).toMatchObject({ status: 'superseded', runId: params.runId });
    expect(saved.runs).toHaveLength(1);
    expect(saved.runs[0].status).toBe('cancelled');
  });

  it('does not resume a cancelled clarification when a late answer arrives', async () => {
    const { projectId, params } = await blockedProject(), before = await snapshot(projectId);
    expect((await call(`/projects/${projectId}/runs/${params.runId}`, 'DELETE')).status).toBe(200);
    const response = await call(`/projects/${projectId}/messages`, 'POST', answerMessage(before, ['Two floors.', 'Upstairs.', 'Not required.']));
    expect(response.status).toBe(409);
    const saved = await snapshot(projectId);
    expect(saved.clarification.status).toBe('cancelled');
    expect(saved.runs).toHaveLength(1);
    expect(saved.runs[0].status).toBe('cancelled');
    expect(saved.project.brief).toEqual(clarification);
  });

  it('does not let an old answer overwrite a manually replaced brief', async () => {
    const { projectId } = await blockedProject(), before = await snapshot(projectId);
    const edited = { ...original, request: 'An entirely new single-storey courtyard home.' };
    expect((await call(`/projects/${projectId}/brief`, 'PUT', { name: 'Replaced briefing', brief: edited })).status).toBe(200);
    expect((await call(`/projects/${projectId}/messages`, 'POST', answerMessage(before, ['Two floors.']))).status).toBe(409);
    expect((await snapshot(projectId)).project.brief).toEqual(edited);
    expect((await snapshot(projectId)).clarification.status).toBe('superseded');
  });

  it('frees the owner run slot while waiting and retains an answered continuation behind work on another project', async () => {
    const { projectId, params } = await blockedProject(), before = await snapshot(projectId);
    const other = await createProject(), active = await start(other);
    const response = await call(`/projects/${projectId}/messages`, 'POST', answerMessage(before, ['Two floors.', 'Upstairs.', 'Not required.']));
    expect(response.status).toBe(202);
    const result = await response.json() as {runId:string};
    expect((await snapshot(projectId)).runs).toHaveLength(1);
    expect((await snapshot(projectId)).clarification.status).toBe('queued');
    expect((await call(`/projects/${other}/runs/${active.runId}`, 'DELETE')).status).toBe(200);
    await env.PROJECTS.getByName(projectId).scheduleChanges(projectId, owner);
    await expect.poll(async () => (await snapshot(projectId)).runs.find((run: any) => run.id === result.runId), { timeout: 10_000 }).toMatchObject({ kind: 'generate', resumesRunId: params.runId });
  });

  it('rejects more than three clarification questions at the brief boundary', async () => {
    const response = await call('/projects', 'POST', { name: 'Too many questions', brief: { ...clarification, questions: [...clarification.questions, 'A fourth question?'] } });
    expect(response.status).toBe(400);
  });

  it('rejects full-brief edits while the team run is active', async () => {
    const projectId = await createProject();
    await start(projectId);
    const response = await call(`/projects/${projectId}/brief`, 'PUT', { name: 'Unsafe timing', brief: { ...original, request: 'A replacement brief while work is running.' } });
    expect(response.status).toBe(409);
    expect((await snapshot(projectId)).project.brief).toEqual(original);
  });
});
