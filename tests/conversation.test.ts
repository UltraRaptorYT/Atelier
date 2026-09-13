import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { handleInteraction } from '../worker/src/conversation';
import { modelJSON } from '../worker/src/ai';
import { exampleDesign } from '../shared/example';
import type { InteractionRequest } from '../shared/conversation';
import type { Bindings } from '../worker/src/types';

vi.mock('../worker/src/ai', () => ({ modelJSON: vi.fn() }));
let mf: Miniflare, env: Bindings;
const scheduleChanges = vi.fn().mockResolvedValue(undefined);
const begin = vi.fn();
const brief = { request: 'A courtyard home for four people.', summary: 'Courtyard home', goals: ['Four occupants'], constraints: ['Keep the courtyard'], questions: [] };
async function project(design = false) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const key = design ? `${id}/design.json` : null;
  if (key) await env.FILES.put(key, JSON.stringify(exampleDesign()));
  await env.DB.prepare('INSERT INTO projects(id,owner_id,name,brief,revision,design_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(id, 'owner', 'Conversation house', JSON.stringify(brief), design ? 1 : 0, key, now, now).run();
  return id;
}
const message = (instruction: string, overrides: Partial<InteractionRequest> = {}): InteractionRequest => ({
  instruction, agent: 'principal', elementId: null, baseRevision: 0, operationId: crypto.randomUUID(), intent: 'auto', ...overrides,
});
async function count(table: 'runs' | 'changes' | 'conversation_turns', projectId: string) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`).bind(projectId).first<{ count: number }>())!.count;
}
beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("conversation"); } };',
    compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], r2Buckets: ['FILES'] }));
  env = { ...await mf.getBindings(), GENERATION_ENABLED: 'false', OPENAI_API_KEY: 'test-only',
    PROJECTS: { getByName: () => ({ scheduleChanges, begin }) } } as unknown as Bindings;
  for (const name of readdirSync('worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(`worker/migrations/${name}`, 'utf8').split(';').filter(sql => sql.trim())) await env.DB.prepare(sql).run();
  }
});
beforeEach(() => { vi.clearAllMocks(); env.GENERATION_ENABLED = 'false'; });
afterAll(async () => { await mf?.dispose(); });

describe('shared conversation routing with real persistence', () => {
  it('answers a design question while generation is paused, without opening a run or changing the design', async () => {
    const id = await project(true), request = message('Why is the roof sloped?', { baseRevision: 1 });
    vi.mocked(modelJSON).mockResolvedValueOnce({ intent: 'ask', reply: 'No roof-slope rationale is recorded. I can explain possible reasons.', answers: [] });
    const result = await handleInteraction(env, id, 'owner', request);
    expect(result).toMatchObject({ intent: 'ask', reply: expect.stringContaining('No roof-slope rationale'), operationId: request.operationId });
    expect(await count('runs', id)).toBe(0); expect(await count('changes', id)).toBe(0);
    expect(begin).not.toHaveBeenCalled(); expect(scheduleChanges).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT revision FROM projects WHERE id = ?').bind(id).first()).toEqual({ revision: 1 });
    expect(vi.mocked(modelJSON).mock.calls[0][5]).toBeUndefined();
  });

  it('persists an answer and replays the same operation without repeating the model or conversation events', async () => {
    const id = await project(), request = message('What happens next?');
    vi.mocked(modelJSON).mockResolvedValueOnce({ intent: 'ask', reply: 'Start team briefing when your brief is ready.', answers: [] });
    const first = await handleInteraction(env, id, 'owner', request);
    expect(await handleInteraction(env, id, 'owner', request)).toEqual(first);
    expect(modelJSON).toHaveBeenCalledTimes(1); expect(await count('conversation_turns', id)).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM events WHERE project_id = ?').bind(id).first()).toEqual({ count: 2 });
    await expect(handleInteraction(env, id, 'owner', { ...request, instruction: 'Actually make it red.' })).rejects.toMatchObject({ status: 409 });
  });

  it('enforces an explicit read-only ask even if the routing model proposes a mutation', async () => {
    const id = await project(true);
    vi.mocked(modelJSON).mockResolvedValueOnce({ intent: 'change', reply: 'Red is one possible colour.', answers: [] });
    expect(await handleInteraction(env, id, 'owner', message('Would red suit it?', { intent: 'ask', baseRevision: 1 }))).toMatchObject({ intent: 'ask' });
    expect(await count('changes', id)).toBe(0); expect(begin).not.toHaveBeenCalled();
  });

  it('queues a polite modification request using meaning rather than question punctuation', async () => {
    env.GENERATION_ENABLED = 'true';
    const id = await project(true), request = message('Can you make the roof red?', { baseRevision: 1 });
    vi.mocked(modelJSON).mockResolvedValueOnce({ intent: 'change', reply: 'Change the roof colour.', answers: [] });
    expect(await handleInteraction(env, id, 'owner', request)).toMatchObject({ intent: 'change', queued: true });
    expect(await count('changes', id)).toBe(1); expect(scheduleChanges).toHaveBeenCalledWith(id, 'owner');
    expect(await env.DB.prepare('SELECT instruction FROM changes WHERE id = ?').bind(request.operationId).first()).toEqual({ instruction: request.instruction });
  });

  it('saves initial requirements without starting work and preserves previous goals and constraints', async () => {
    const id = await project(), request = message('Include a gaming room.', { intent: 'brief_update' });
    const result = await handleInteraction(env, id, 'owner', request);
    expect(result).toMatchObject({ intent: 'brief_update', saved: true });
    expect(await handleInteraction(env, id, 'owner', request)).toEqual(result);
    const stored = JSON.parse((await env.DB.prepare('SELECT brief FROM projects WHERE id = ?').bind(id).first<{ brief: string }>())!.brief);
    expect(stored.goals).toEqual(brief.goals); expect(stored.constraints).toEqual(brief.constraints);
    expect(stored.request).toContain(brief.request); expect(stored.request.match(/Include a gaming room\./g)).toHaveLength(1);
    expect(await count('runs', id)).toBe(0); expect(await count('changes', id)).toBe(0);
  });

  it('sends a resolved follow-up instruction to the design team while preserving the original conversation turn', async () => {
    env.GENERATION_ENABLED = 'true';
    const id = await project(true), request = message('Yes, red please.', { baseRevision: 1 });
    vi.mocked(modelJSON).mockResolvedValueOnce({ intent: 'change', reply: 'The roof should be red.', answers: [], changeInstruction: 'Make the roof red. Preserve the walls and other finishes.' });
    await handleInteraction(env, id, 'owner', request);
    expect(await env.DB.prepare('SELECT instruction FROM changes WHERE id = ?').bind(request.operationId).first()).toEqual({ instruction: 'Make the roof red. Preserve the walls and other finishes.' });
    const turn = await env.DB.prepare('SELECT request_json FROM conversation_turns WHERE id = ?').bind(request.operationId).first<{ request_json: string }>();
    expect(JSON.parse(turn!.request_json).instruction).toBe('Yes, red please.');
  });

  it('does not attach an unbound free-text answer to whichever clarification happens to be current', async () => {
    const id = await project();
    vi.mocked(modelJSON).mockResolvedValueOnce({ intent: 'answer_clarification', reply: 'Two floors.', answers: [{ questionId: 'some-question', answer: 'Two floors.' }] });
    expect(await handleInteraction(env, id, 'owner', message('Two floors.'))).toMatchObject({ intent: 'ask', reply: expect.stringContaining('question card') });
    expect(await count('runs', id)).toBe(0); expect(await count('changes', id)).toBe(0);
  });

  it('checks ownership before reading context, calling a model, or replaying a saved result', async () => {
    const id = await project(), request = message('What happens next?');
    await expect(handleInteraction(env, id, 'other-owner', request)).rejects.toMatchObject({ status: 404 });
    expect(modelJSON).not.toHaveBeenCalled(); expect(await count('conversation_turns', id)).toBe(0);
  });
});
