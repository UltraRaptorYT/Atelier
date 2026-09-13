import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { modelJSON } from '../worker/src/ai';
import type { Bindings } from '../worker/src/types';
import { TaskTimeBudget } from '../worker/src/task-time';

// Use the installed OpenAI SDK with a local fetch stub, including its real
// response-body parser. No request leaves the process.
vi.mock('../worker/src/prompts', () => ({ agentInstructions: () => 'Return the supplied schema.' }));
vi.mock('../worker/src/security', () => ({ credential: async () => 'test-key', HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock('../worker/src/store', () => ({ emit: vi.fn(), artifact: vi.fn() }));
const env = { OPENAI_MODEL: 'gpt-6-astra' } as Bindings;
const schema = z.object({ accepted: z.boolean() });
beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('model request end-to-end deadline', () => {
  it('sends the requested Astra effort on every continuation and clamps requests to shared task time', async () => {
    let now = 0;
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const requests: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(init!.body as string));
      return Response.json(fetch.mock.calls.length === 1
        ? { status: 'completed', output: [{ type: 'function_call', call_id: 'read-budget', name: 'read_design', arguments: '{}' }], output_text: '' }
        : { status: 'completed', output: [], output_text: '{"accepted":true}' });
    });
    vi.stubGlobal('fetch', fetch);
    const read = vi.fn(async () => { now = 110000; return '{}'; });
    const context = { projectId: 'project-1', taskId: 'task-1', design: null, timeBudget: new TaskTimeBudget(150000, () => now), desktop: { files: { read } } };
    expect(await modelJSON(env, 'owner', 'critic', 'Review the model.', schema, context as never, [], 'max')).toEqual({ accepted: true });
    expect(timeout.mock.calls.map(([, delay]) => delay)).toEqual(expect.arrayContaining([150000, 40000]));
    expect(requests).toHaveLength(2);
    for (const request of requests) expect(request).toMatchObject({ model: 'gpt-6-astra', reasoning: { effort: 'max' }, max_output_tokens: 64000 });
    expect(requests[1].instructions).toContain('Task time remaining: 40 seconds');
  });

  it('does not purchase another response when a tool consumes the remaining task time', async () => {
    let now = 0;
    const fetch = vi.fn(async () => Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'read-expired', name: 'read_design', arguments: '{}' }], output_text: '' }));
    vi.stubGlobal('fetch', fetch);
    const context = { projectId: 'project-1', taskId: 'task-1', design: null, timeBudget: new TaskTimeBudget(150000, () => now), desktop: { files: { read: async () => { now = 150000; return '{}'; } } } };
    await expect(modelJSON(env, 'owner', 'critic', 'Review the model.', schema, context as never, [], 'max')).rejects.toMatchObject({ status: 408 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { reason: 'max_output_tokens', message: /64,000-token response allowance/, outputTokens: 64000 },
    { reason: 'content_filter', message: /content filter/, outputTokens: 200 },
    { reason: undefined, message: /incomplete model response/, outputTokens: 200 },
  ])('reports $reason accurately without executing incomplete tool calls or retrying', async ({ reason, message, outputTokens }) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn(async () => Response.json({
      id: 'resp-incomplete', status: 'incomplete', incomplete_details: reason ? { reason } : null,
      output: [{ type: 'function_call', call_id: 'unfinished-read', name: 'read_design', arguments: '{}' }],
      output_text: 'Private generated content must not be logged.',
      usage: { input_tokens: 100, output_tokens: outputTokens, output_tokens_details: { reasoning_tokens: outputTokens - 100 } },
    }));
    vi.stubGlobal('fetch', fetch);
    const read = vi.fn();
    const context = { projectId: 'project-1', taskId: 'task-1', design: null, desktop: { files: { read } } };
    await expect(modelJSON(env, 'owner', 'principal', 'Private client brief.', schema, context as never)).rejects.toMatchObject({ status: 422, message });
    expect(fetch).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledExactlyOnceWith('Atelier model response incomplete', {
      agent: 'principal', responseId: 'resp-incomplete', reason: reason ?? 'unknown', maxOutputTokens: 64000,
      inputTokens: 100, outputTokens, reasoningTokens: outputTokens - 100,
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('Private');
  });

  it('aborts a stalled JSON body after headers without purchasing a retry', async () => {
    vi.useFakeTimers();
    let transportSignal: AbortSignal | undefined;
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      transportSignal = init!.signal!;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"status":"completed",'));
          transportSignal!.addEventListener('abort', () => controller.error(transportSignal!.reason), { once: true });
        },
      }), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch);
    let settled = false;
    const pending = modelJSON(env, 'owner', 'critic', 'Review the model.', schema, undefined, [], 'max').then(value => { settled = true; return value; }, error => { settled = true; throw error; });
    const rejected = expect(pending).rejects.toMatchObject({ status: 408, message: expect.stringContaining('480-second allowance') });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(479999);
    expect(settled).toBe(false);
    expect(transportSignal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(transportSignal!.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives each tool-continuation request a fresh deadline through the real SDK', async () => {
    vi.useFakeTimers();
    const transportSignals: AbortSignal[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      transportSignals.push(init!.signal!);
      return Response.json(fetch.mock.calls.length === 1
        ? { status: 'completed', output: [{ type: 'function_call', call_id: 'read-1', name: 'read_design', arguments: '{}' }], output_text: '' }
        : { status: 'completed', output: [], output_text: '{"accepted":true}' });
    });
    vi.stubGlobal('fetch', fetch);
    const read = vi.fn().mockResolvedValue('{}');
    const context = { projectId: 'project-1', taskId: 'task-1', design: null, desktop: { files: { read } } };
    expect(await modelJSON(env, 'owner', 'critic', 'Review the model.', schema, context as never)).toEqual({ accepted: true });
    expect(read).toHaveBeenCalledExactlyOnceWith('/home/user/project/design.json');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(transportSignals[0]).not.toBe(transportSignals[1]);
    expect(transportSignals.every(signal => !signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
