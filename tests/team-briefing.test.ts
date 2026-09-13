import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DesignWorkflow } from '../worker/src/workflow';
import { modelJSON } from '../worker/src/ai';
import { generateStudy } from '../worker/src/images';
import { runTeam } from '../worker/src/team';
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
  await env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE status IN ('queued','in_progress')").run();
  await env.DB.prepare("UPDATE changes SET status = 'cancelled' WHERE status = 'pending'").run();
});
afterAll(async () => { await mf?.dispose(); });

describe('team briefing, clarification and manual continuation', () => {
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
    expect(saved.runs[0]).toMatchObject({ id: params.runId, kind: 'generate', status: 'completed' });
    expect(saved.project.brief).toEqual(clarification);
    expect(saved.events.filter((event: any) => event.type === 'agent_message').map((event: any) => event.agent).sort()).toEqual(['architect', 'critic', 'designer']);
    expect(saved.tasks).toHaveLength(1);
    expect(saved.tasks[0]).toMatchObject({ agent: 'principal', title: 'Clarify brief', status: 'blocked' });
    expect(saved.events.filter((event: any) => event.type === 'clarification_requested')).toEqual([
      expect.objectContaining({ agent: 'principal', message: clarification.questions.join('\n') }),
    ]);
    expect(saved.design).toBeNull();
    expect(saved.artifacts).toEqual([]);
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
    expect(saved.runs.every((run: any) => run.status === 'completed')).toBe(true);
    expect(saved.project.brief).toEqual(answered);
    expect(saved.events.some((event: any) => event.type === 'clarification_received')).toBe(true);
  });

  it('documents the text-composer gap: an answer creates a change request without resolving the blocked brief', async () => {
    const { projectId, params } = await blockedProject();
    const operationId = crypto.randomUUID(), instruction = 'Two floors, please.';
    const response = await call(`/projects/${projectId}/messages`, 'POST', { operationId, instruction, agent: 'principal', elementId: null, baseRevision: 0 });
    expect(response.status).toBe(202);
    const saved = await snapshot(projectId);
    expect(saved.project.brief).toEqual(clarification);
    expect(saved.tasks.find((task: any) => task.runId === params.runId)).toMatchObject({ status: 'blocked' });
    expect(await env.DB.prepare('SELECT instruction FROM changes WHERE id = ?').bind(operationId).first()).toEqual({ instruction });
    // The coordinator dispatches queued changes through its alarm after the
    // message response; refresh the snapshot until that run has been admitted.
    await expect.poll(async () => (await snapshot(projectId)).runs.find((run: any) => run.id === operationId), { timeout: 10_000 }).toMatchObject({ kind: 'change' });
    expect(modelJSON).toHaveBeenCalledTimes(4);
    expect(runTeam).not.toHaveBeenCalled();
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
