import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/client';

const transport = vi.fn<typeof fetch>();
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', transport); transport.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function stallConnection() {
  transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
  }));
}
function stallBody(status = 200) {
  transport.mockImplementation(async (_url, init) => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"saved":'));
      // Match native fetch: cancelling its signal errors the response stream,
      // including when response headers have already arrived.
      init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true });
    },
  }), { status, headers: { 'content-type': 'application/json' } }));
}

describe('JSON request deadlines', () => {
  it('ends a stalled GET connection at 30 seconds without retrying', async () => {
    stallConnection();
    const pending = api('/projects');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError', message: 'The studio response timed out. Please try loading it again.' });
    const signal = transport.mock.calls[0][1]!.signal!;
    await vi.advanceTimersByTimeAsync(29999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the original deadline while response JSON is stalled after headers', async () => {
    stallBody();
    const pending = api('/projects/project-one');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(transport).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts connection time and body time toward the same deadline', async () => {
    transport.mockImplementation((_url, init) => new Promise(resolve => {
      setTimeout(() => resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) { init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true }); },
      }))), 20000);
    }));
    const pending = api('/projects');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(29999);
    expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['POST', 'PUT', 'DELETE'])('allows a model turn, then reports uncertain %s outcome without replaying the mutation', async method => {
    stallBody();
    const payload = { instruction: 'Make the roof red.', operationId: 'stable-operation-one' };
    const pending = api('/projects/project-one/messages', method, payload);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError', message: 'The studio response timed out. Your request may still be saved or running. Check your project and activity before retrying.',
    });
    await vi.advanceTimersByTimeAsync(120000);
    expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(transport).toHaveBeenCalledOnce();
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual(payload);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not hide a timed-out HTTP error body behind a generic service error', async () => {
    stallBody(503);
    const pending = api('/projects');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('JSON caller cancellation and cleanup', () => {
  it('does not dispatch when the caller has already cancelled', async () => {
    const caller = new AbortController(), reason = new DOMException('Project changed', 'AbortError');
    caller.abort(reason);
    await expect(api('/projects', 'GET', undefined, caller.signal)).rejects.toBe(reason);
    expect(transport).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([stallConnection, stallBody])('propagates the caller reason through connection or body cancellation', async stall => {
    stall();
    const caller = new AbortController(), reason = new DOMException('Project changed', 'AbortError');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const pending = api('/projects', 'GET', undefined, caller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(10000);
    caller.abort(reason);
    await rejected;
    expect(transport.mock.calls[0][1]!.signal!.reason).toBe(reason);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(150000);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('cleans up successful requests so a later caller cancellation has no effect', async () => {
    transport.mockResolvedValueOnce(Response.json({ saved: true }));
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener'), remove = vi.spyOn(caller.signal, 'removeEventListener');
    expect(await api('/projects', 'GET', undefined, caller.signal)).toEqual({ saved: true });
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    caller.abort();
    expect(transport.mock.calls[0][1]!.signal!.aborted).toBe(false);
  });

  it('cleans up transport failures and preserves the original error', async () => {
    const failure = new TypeError('Network unavailable');
    transport.mockRejectedValueOnce(failure);
    const caller = new AbortController(), remove = vi.spyOn(caller.signal, 'removeEventListener');
    await expect(api('/projects', 'GET', undefined, caller.signal)).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('cleans up invalid successful JSON without treating it as a timeout', async () => {
    transport.mockResolvedValueOnce(new Response('not JSON'));
    await expect(api('/projects')).rejects.toBeInstanceOf(SyntaxError);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('JSON HTTP errors', () => {
  it('preserves actionable backend error messages', async () => {
    transport.mockResolvedValueOnce(Response.json({ error: 'The design changed. Refresh before continuing.' }, { status: 409 }));
    await expect(api('/projects/project-one/messages', 'POST', { operationId: 'stable-one' })).rejects.toThrow('The design changed. Refresh before continuing.');
    expect(transport).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['<html>Bad gateway</html>', null, {}, { error: 42 }])('handles an unavailable or malformed error response: %j', async body => {
    transport.mockResolvedValueOnce(typeof body === 'string' ? new Response(body, { status: 502 }) : Response.json(body, { status: 503 }));
    await expect(api('/projects')).rejects.toThrow(typeof body === 'string' ? 'The studio service is unavailable.' : 'The request could not be completed.');
    expect(vi.getTimerCount()).toBe(0);
  });
});
