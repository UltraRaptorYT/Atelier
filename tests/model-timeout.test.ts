import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { modelJSON } from '../worker/src/ai';
import type { Bindings } from '../worker/src/types';

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
  it('aborts a stalled JSON body after headers without purchasing a retry', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController(); signals.push(controller.signal);
      setTimeout(() => controller.abort(new DOMException('Test deadline elapsed', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
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
    const pending = modelJSON(env, 'owner', 'critic', 'Review the model.', schema).then(value => { settled = true; return value; }, error => { settled = true; throw error; });
    const rejected = expect(pending).rejects.toThrow(/abort|timeout|timed out/i);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(timeout).toHaveBeenCalledExactlyOnceWith(120000);
    await vi.advanceTimersByTimeAsync(119999);
    expect(settled).toBe(false);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(signals[0].aborted).toBe(true);
    expect(transportSignal!.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('gives each tool-continuation request a fresh deadline through the real SDK', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
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
    expect(timeout.mock.calls).toEqual([[120000], [120000]]);
    const callerSignals = timeout.mock.results.map(result => result.value as AbortSignal);
    expect(callerSignals[0]).not.toBe(callerSignals[1]);
    expect(transportSignals[0]).not.toBe(transportSignals[1]);
    expect(callerSignals.every(signal => !signal.aborted)).toBe(true);
  });
});
