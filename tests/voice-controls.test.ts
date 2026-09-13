import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectCoordinator } from '../worker/src/coordinator';
import { emit } from '../worker/src/store';
import type { Bindings } from '../worker/src/types';

vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
vi.mock('../worker/src/security', () => ({ credential: async () => 'test-key', HttpError: class extends Error {} }));
vi.mock('../worker/src/store', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../worker/src/voice', () => ({ executeVoiceTool: vi.fn(), hangupVoice: vi.fn(), LiveResponseTools: class { handle = vi.fn(); } }));
vi.mock('../worker/src/steering', () => ({ dispatchPending: vi.fn() }));
vi.mock('../worker/src/clarifications', () => ({ dispatchClarification: vi.fn() }));
vi.mock('../worker/src/images', () => ({ originalConceptId: vi.fn() }));

async function setup() {
  const socket = Object.assign(new EventTarget(), { accept: vi.fn(), send: vi.fn(), close: vi.fn(), readyState: 1 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ webSocket: socket }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), storage: { put: vi.fn(), getAlarm: vi.fn(), setAlarm: vi.fn() } };
  const coordinator = new ProjectCoordinator(ctx as unknown as DurableObjectState, {} as Bindings);
  const close = vi.spyOn(coordinator, 'closeVoice').mockResolvedValue(undefined);
  await coordinator.attachVoice('project', 'owner', 'voice', 'architect');
  return { close, socket, send: async (value: unknown) => {
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
    await Promise.all(pending.splice(0));
  } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function useHandshakeClock() {
  vi.useFakeTimers();
  // Native AbortSignal.timeout does not use Vitest's clock. Control it as well
  // so the old lifetime-bound signal would fail the accepted-upgrade regression.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
}

describe('voice server control recovery', () => {
  it('releases the handshake deadline after upgrade without aborting the accepted sideband', async () => {
    useHandshakeClock();
    const f = await setup();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    expect(f.socket.accept).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(45000);
    expect(signal?.aborted).toBe(false);
    expect(f.socket.close).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    await f.send({ type: 'error', error: { type: 'invalid_request_error', code: 'rejected_command' } });
    expect(emit).toHaveBeenCalledWith(expect.anything(), 'project', 'voice_warning', expect.stringContaining('call is still connected'), 'architect');
    expect(f.close).not.toHaveBeenCalled();
  });

  it('aborts an upgrade that is still waiting after 15 seconds without registering an active session', async () => {
    useHandshakeClock();
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = options?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetcher);
    const ctx = { waitUntil: vi.fn(), storage: { put: vi.fn(), getAlarm: vi.fn(), setAlarm: vi.fn() } };
    const coordinator = new ProjectCoordinator(ctx as unknown as DurableObjectState, {} as Bindings);
    const pending = coordinator.attachVoice('project', 'owner', 'voice', 'architect');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(14999);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(false);
    expect(ctx.storage.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(ctx.storage.put).not.toHaveBeenCalled();
    expect(ctx.storage.setAlarm).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a rejected command without hanging up the active call', async () => {
    const f = await setup();
    await f.send({ type: 'error', error: { type: 'invalid_request_error', code: 'immutable_field_update', message: 'Provider diagnostic' } });
    expect(f.close).not.toHaveBeenCalled();
    expect(f.socket.close).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(expect.anything(), 'project', 'voice_warning', expect.stringContaining('call is still connected'), 'architect');
    expect(JSON.stringify(vi.mocked(emit).mock.calls)).not.toContain('Provider diagnostic');
  });

  it('still releases project controls for an unclassified provider failure', async () => {
    const f = await setup();
    await f.send({ type: 'error', error: { type: 'server_error', code: 'unavailable' } });
    expect(f.close).toHaveBeenCalledExactlyOnceWith('voice');
  });

  it('honors a terminal session event after a rejected command', async () => {
    const f = await setup();
    await f.send({ type: 'error', error: { type: 'invalid_request_error', code: null } });
    await f.send({ type: 'session.closed', reason: 'close_requested' });
    expect(f.close).toHaveBeenCalledExactlyOnceWith('voice');
  });
});
