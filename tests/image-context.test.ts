import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { modelJSON } from '../worker/src/ai';
import type { Bindings } from '../worker/src/types';

const mocks = vi.hoisted(() => ({ create: vi.fn(), constructor: vi.fn(), credential: vi.fn(), emit: vi.fn() }));
vi.mock('openai', () => ({ default: class OpenAI {
  responses = { create: mocks.create };
  constructor(options: unknown) { mocks.constructor(options); }
} }));
vi.mock('../worker/src/prompts', () => ({ agentInstructions: () => 'Return a schema-conforming design proposal.' }));
vi.mock('../worker/src/security', () => ({ credential: mocks.credential, HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock('../worker/src/store', () => ({ emit: mocks.emit }));

const resultSchema = z.object({ accepted: z.boolean() });
const env = { OPENAI_MODEL: 'gpt-5.6-terra' } as Bindings;
const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.credential.mockResolvedValue('server-test-key');
  mocks.emit.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ status: 'completed', output: [], output_text: '{"accepted":true}' });
});

describe('actual reference image input to structured design models', () => {
  it.each(['architect', 'designer', 'critic'] as const)('passes image bytes to %s alongside text and the structured-output contract', async agent => {
    expect(await modelJSON(env, 'owner', agent, 'Use this selected visual reference.', resultSchema, undefined, [reference])).toEqual({ accepted: true });
    const request = mocks.create.mock.calls[0][0];
    expect(request.model).toBe('gpt-5.6-terra');
    expect(request.input).toEqual([{ role: 'user', content: [
      { type: 'input_text', text: 'Use this selected visual reference.' },
      { type: 'input_image', image_url: reference, detail: 'high' },
    ] }]);
    expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true, schema: { type: 'object', required: ['accepted'] } });
    expect(request.store).toBe(false);
    expect(JSON.stringify(request)).not.toContain('server-test-key');
  });

  it('retains the selected reference after an actual read_design tool round without duplicating or replacing it', async () => {
    const snapshots: unknown[] = [];
    mocks.create.mockImplementation(async request => {
      snapshots.push(structuredClone(request.input));
      if (snapshots.length === 1) return { status: 'completed', output: [{ type: 'function_call', call_id: 'read-1', name: 'read_design', arguments: '{}' }], output_text: '' };
      return { status: 'completed', output: [], output_text: '{"accepted":true}' };
    });
    const read = vi.fn().mockResolvedValue('{"floors":2,"notes":["Keep the courtyard"]}');
    const context = { desktop: { files: { read } }, projectId: 'project-1', taskId: 'task-1', design: null };
    expect(await modelJSON(env, 'owner', 'architect', 'Translate the reference into editable geometry.', resultSchema, context as never, [reference])).toEqual({ accepted: true });
    expect(read).toHaveBeenCalledExactlyOnceWith('/home/user/project/design.json');
    expect(snapshots).toHaveLength(2);
    for (const input of snapshots as Array<Array<{ content?: Array<{ type: string; image_url?: string }> }>>) {
      const images = input.flatMap(item => Array.isArray(item.content) ? item.content.filter(part => part.type === 'input_image') : []);
      expect(images).toEqual([{ type: 'input_image', image_url: reference, detail: 'high' }]);
    }
    expect(snapshots[1]).toEqual(expect.arrayContaining([
      { type: 'function_call_output', call_id: 'read-1', output: '{"floors":2,"notes":["Keep the courtyard"]}' },
    ]));
  });
});
