import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { modelJSON } from '../worker/src/ai';
import type { Bindings } from '../worker/src/types';
import type { AgentId } from '../shared/design';

const mocks = vi.hoisted(() => ({ create: vi.fn(), constructor: vi.fn(), credential: vi.fn(), emit: vi.fn() }));
vi.mock('openai', () => ({ default: class OpenAI {
  responses = { create: mocks.create };
  constructor(options: unknown) { mocks.constructor(options); }
} }));
vi.mock('../worker/src/prompts', () => ({ agentInstructions: () => 'Keep work within your task ownership.' }));
vi.mock('../worker/src/security', () => ({ credential: mocks.credential, HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock('../worker/src/store', () => ({ emit: mocks.emit }));

const env = { OPENAI_MODEL: 'gpt-5.6-terra' } as Bindings;
const schema = z.object({ accepted: z.boolean() });
const final = { status: 'completed', output: [], output_text: '{"accepted":true}' };
const call = (id: string, args: unknown, name = 'report_coordination') => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
const round = (...output: ReturnType<typeof call>[]) => ({ status: 'completed', output, output_text: '' });
function context() {
  return { projectId: 'project-1', taskId: 'run-1-interior', design: null, communications: [] as Array<{ target: AgentId; message: string }>, desktop: { files: { read: vi.fn().mockResolvedValue('{"notes":["Keep the courtyard"]}'), write: vi.fn() }, commands: { run: vi.fn() } } };
}
const notes = () => mocks.emit.mock.calls.filter(([, , type]) => type === 'agent_message');
const outputs = () => mocks.create.mock.calls.at(-1)![0].input.filter((item: { type?: string }) => item.type === 'function_call_output');
beforeEach(() => {
  vi.resetAllMocks(); mocks.credential.mockResolvedValue('test-key'); mocks.emit.mockResolvedValue(undefined); mocks.create.mockResolvedValue(final);
});

describe('bounded operational agent tools', () => {
  it('persists and collects a coordination note after an actual filesystem read without editing the canonical file', async () => {
    const ctx = context(), message = 'The stair opening needs more headroom. Preserve the furniture layout.';
    mocks.create.mockResolvedValueOnce(round(call('read-1', {}, 'read_design'))).mockResolvedValueOnce(round(call('message-1', { target: 'architect', message })));
    expect(await modelJSON(env, 'owner', 'designer', 'Develop the interiors.', schema, ctx as never)).toEqual({ accepted: true });
    expect(ctx.desktop.files.read).toHaveBeenCalledExactlyOnceWith('/home/user/project/design.json');
    expect(ctx.desktop.files.write).not.toHaveBeenCalled(); expect(ctx.desktop.commands.run).not.toHaveBeenCalled();
    expect(notes()).toEqual([[env, 'project-1', 'agent_message', `To architect: ${message}`, 'designer', 'run-1-interior', 'run-1-interior-coordination-message-1']]);
    expect(ctx.communications).toEqual([{ target: 'architect', message }]);
    expect(outputs()).toContainEqual({ type: 'function_call_output', call_id: 'message-1', output: 'Coordination note recorded for architect; continue within your task ownership.' });
    expect(mocks.create.mock.calls[0][0].tools.find((tool: { name: string }) => tool.name === 'report_coordination')).toMatchObject({ strict: true, parameters: { additionalProperties: false, required: ['target', 'message'], properties: { target: { enum: ['principal', 'architect', 'designer', 'critic'] }, message: { maxLength: 1000 } } } });
  });

  it('does not republish a repeated call or append duplicate notes', async () => {
    const ctx = context(), note = { target: 'principal' as const, message: 'Confirm ownership of the roof clearance change.' };
    mocks.create.mockResolvedValueOnce(round(call('same', note), call('same', note), call('another-call', note)));
    await modelJSON(env, 'owner', 'architect', 'Develop architecture.', schema, ctx as never);
    expect(notes()).toHaveLength(2);
    expect(notes().map(args => args[6])).toEqual(['run-1-interior-coordination-same', 'run-1-interior-coordination-another-call']);
    expect(ctx.communications).toEqual([note]);
  });

  it('rejects conflicting reuse of a call ID without claiming the changed note was recorded', async () => {
    const ctx = context();
    mocks.create.mockResolvedValueOnce(round(call('same', { target: 'principal', message: 'Review the roof.' }), call('same', { target: 'critic', message: 'Review the windows.' })));
    await modelJSON(env, 'owner', 'designer', 'Develop interiors.', schema, ctx as never);
    expect(notes()).toHaveLength(1); expect(ctx.communications).toEqual([{ target: 'principal', message: 'Review the roof.' }]);
    expect(outputs().at(-1).output).toMatch(/^Tool failed/);
  });

  it.each([
    { target: 'external-contractor', message: 'Review this.' },
    { target: 'architect', message: 'x'.repeat(1001) },
    { target: 'designer', message: '   ' },
    { target: 'critic', message: 'Review this.', extra: true },
  ])('rejects invalid coordination arguments without persisting or collecting them (%j)', async invalid => {
    const ctx = context(); mocks.create.mockResolvedValueOnce(round(call('invalid', invalid)));
    expect(await modelJSON(env, 'owner', 'architect', 'Develop architecture.', schema, ctx as never)).toEqual({ accepted: true });
    expect(notes()).toHaveLength(0); expect(ctx.communications).toEqual([]);
    expect(outputs()).toContainEqual({ type: 'function_call_output', call_id: 'invalid', output: expect.stringMatching(/^Tool failed/) });
  });

  it('does not claim success or collect a note when its persistent event fails', async () => {
    const ctx = context(); mocks.create.mockResolvedValueOnce(round(call('failed-save', { target: 'principal', message: 'Resolve the stair clearance.' })));
    mocks.emit.mockImplementation(async (_env, _project, type) => { if (type === 'agent_message') throw new Error('Storage unavailable'); });
    await modelJSON(env, 'owner', 'architect', 'Develop architecture.', schema, ctx as never);
    expect(ctx.communications).toEqual([]);
    expect(outputs().at(-1).output).toMatch(/^Tool failed/);
    expect(mocks.emit).toHaveBeenLastCalledWith(env, 'project-1', 'tool_completed', 'report coordination failed.', 'architect', 'run-1-interior');
  });

  it('keeps existing contexts without a communications collector compatible', async () => {
    const { communications: _unused, ...ctx } = context();
    mocks.create.mockResolvedValueOnce(round(call('without-collector', { target: 'critic', message: 'Verify accessible circulation.' })));
    expect(await modelJSON(env, 'owner', 'designer', 'Develop interiors.', schema, ctx as never)).toEqual({ accepted: true });
    expect(notes()).toHaveLength(1);
    expect(outputs().at(-1).output).toMatch(/^Coordination note recorded for critic/);
  });

  it('does not advertise operational tools for an invocation without a workstation context', async () => {
    await modelJSON(env, 'owner', 'principal', 'Prepare the brief.', schema);
    expect(mocks.create.mock.calls[0][0].tools).toEqual([]);
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('stops repeated tool failures at the existing twelve-round limit with no automatic provider retries', async () => {
    const ctx = context();
    mocks.create.mockImplementation(async () => round(call(`invalid-${mocks.create.mock.calls.length}`, { target: 'unknown', message: 'Escalate.' })));
    await expect(modelJSON(env, 'owner', 'designer', 'Develop interiors.', schema, ctx as never)).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/tool limit/) });
    expect(mocks.create).toHaveBeenCalledTimes(12);
    expect(mocks.create.mock.calls.at(-1)![0].tool_choice).toBe('none');
    expect(mocks.constructor).toHaveBeenCalledWith({ apiKey: 'test-key', maxRetries: 0, timeout: 120000 });
    expect(ctx.communications).toEqual([]); expect(notes()).toHaveLength(0);
  });
});
