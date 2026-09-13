import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveVoiceSession, parseLiveDisplayEvent, type VoiceEnvironment } from '../lib/live-voice';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const track = { stop: vi.fn(), enabled: true };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const channel = { onmessage: null, onclose: null, onerror: null, close: vi.fn() } as unknown as RTCDataChannel;
  const peerEvents = new EventTarget();
  const peer = {
    close: vi.fn(), addTrack: vi.fn(), createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' })),
    setLocalDescription: vi.fn(async () => {}), setRemoteDescription: vi.fn(async () => {}),
    ontrack: null, onconnectionstatechange: null, connectionState: 'new',
    iceGatheringState: 'complete', localDescription: { type: 'offer', sdp: 'offer-with-candidates' },
    addEventListener: vi.fn(peerEvents.addEventListener.bind(peerEvents)),
    removeEventListener: vi.fn(peerEvents.removeEventListener.bind(peerEvents)),
    dispatchEvent: peerEvents.dispatchEvent.bind(peerEvents),
  } as unknown as RTCPeerConnection;
  const audio = { autoplay: false, srcObject: null, pause: vi.fn(), play: vi.fn(async () => {}) } as unknown as HTMLAudioElement;
  const fetcher = vi.fn(async () => new Response('answer-sdp', { headers: { 'X-Voice-Session': 'live_123' } }));
  const environment: VoiceEnvironment = {
    getUserMedia: vi.fn(async () => stream), createPeer: vi.fn(() => peer), createAudio: vi.fn(() => audio), fetch: fetcher,
  };
  const onStatus = vi.fn(), onTranscript = vi.fn(), onError = vi.fn();
  const call = new LiveVoiceSession({ projectId: 'project-a', agent: 'designer', elementId: 'roof', agentName: 'Sofia', onStatus, onTranscript, onError }, environment);
  const send = (event: unknown) => channel.onmessage?.call(channel, { data: typeof event === 'string' ? event : JSON.stringify(event) } as MessageEvent);
  return { call, track, stream, channel, peer, audio, fetcher, environment, onStatus, onTranscript, onError, send };
}

afterEach(() => { vi.useRealTimers(); });

describe('GPT-Live display events', () => {
  it('rejects malformed input and old Realtime transcript events', () => {
    for (const raw of ['{', 'null', '[]', JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'Old' }), JSON.stringify({ type: 'session.input_transcript.delta', event_id: 'x', delta: 'Hi', start_ms: 2, end_ms: 1 })]) {
      expect(parseLiveDisplayEvent(raw)).toBeNull();
    }
  });

  it('groups append-only deltas without waiting for a nonexistent transcript-done event', async () => {
    const x = setup(); await x.call.start();
    const first = { type: 'session.input_transcript.delta', event_id: 'a', delta: 'Make the roof', start_ms: 0, end_ms: 500 };
    x.send(first); x.send(first);
    x.send({ ...first, event_id: 'b', delta: ' red.', start_ms: 500, end_ms: 1000 });
    x.send({ type: 'session.closed' });
    expect(x.onTranscript.mock.calls.map(([text]) => text)).toEqual(['You: Make the roof red.']);
    expect(x.track.stop).toHaveBeenCalledOnce();
  });
});

describe('live voice lifecycle', () => {
  it('keeps media and the session alive after a rejected command, without exposing provider diagnostics', async () => {
    const x = setup(); await x.call.start(); x.send({ type: 'session.started' });
    x.send({ type: 'error', error: { type: 'invalid_request_error', message: 'Private upstream diagnostic' } });
    expect(x.onStatus).toHaveBeenLastCalledWith('live');
    expect(x.track.stop).not.toHaveBeenCalled();
    expect(x.peer.close).not.toHaveBeenCalled();
    expect(x.onError).toHaveBeenCalledWith('A voice action could not complete. You can keep talking.', { retryable: false });
    x.send({ type: 'session.input_transcript.delta', event_id: 'after-error', delta: 'Still connected', start_ms: 0, end_ms: 1000 });
    x.call.stop();
    expect(x.onTranscript).toHaveBeenCalledWith('You: Still connected');
  });

  it('classifies an unexpected final connection loss for recovery but does not retry a deliberate close', async () => {
    const x = setup(); await x.call.start(); x.send({ type: 'session.started' });
    x.send({ type: 'session.closed', reason: 'connection_lost' });
    expect(x.onError).toHaveBeenCalledWith(expect.any(String), { retryable: true });
    expect(x.track.stop).toHaveBeenCalledOnce();
    const next = setup(); await next.call.start(); next.send({ type: 'session.closed', reason: 'close_requested' });
    expect(next.onError).not.toHaveBeenCalled();
    expect(next.track.stop).toHaveBeenCalledOnce();
  });

  it('allows a transient peer disconnection to recover without ending the call', async () => {
    vi.useFakeTimers(); const x = setup(); await x.call.start(); x.send({ type: 'session.started' });
    Object.defineProperty(x.peer, 'connectionState', { value: 'disconnected', configurable: true });
    x.peer.onconnectionstatechange?.call(x.peer, new Event('connectionstatechange'));
    await vi.advanceTimersByTimeAsync(11000);
    Object.defineProperty(x.peer, 'connectionState', { value: 'connected' });
    x.peer.onconnectionstatechange?.call(x.peer, new Event('connectionstatechange'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(x.onError).not.toHaveBeenCalled(); expect(x.peer.close).not.toHaveBeenCalled(); x.call.stop();
  });

  it('serializes handoffs, skips superseded targets, and mutes until the latest target is acknowledged', async () => {
    const x = setup(); await x.call.start(); x.send({ type: 'session.started' });
    await x.call.setProximity('designer', 'Sofia', 'roof', false, true);
    expect(x.track.enabled).toBe(true);
    const first = deferred<Response>(), last = deferred<Response>();
    x.fetcher.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => last.promise);
    const a = x.call.setProximity('architect', 'Kai', null, false, true);
    await vi.waitFor(() => expect(x.fetcher).toHaveBeenCalledTimes(2));
    const b = x.call.setProximity('critic', 'Morgan', null, false, true);
    const c = x.call.setProximity('principal', 'Team / Alex', null, true, true);
    expect(x.fetcher).toHaveBeenCalledTimes(2);
    expect(x.track.enabled).toBe(false); expect(x.audio.muted).toBe(true);
    first.resolve(new Response('{}')); await a; await b;
    await vi.waitFor(() => expect(x.fetcher).toHaveBeenCalledTimes(3));
    expect(x.fetcher).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ method: 'PUT', body: JSON.stringify({ agent: 'principal', elementId: null, meeting: true }) }));
    expect(x.track.enabled).toBe(false); expect(x.audio.muted).toBe(true);
    last.resolve(new Response('{}')); await c;
    expect(x.track.enabled).toBe(true); expect(x.audio.muted).toBe(false);
    x.call.stop();
  });

  it('keeps the microphone paused when the user leaves during connection or an in-flight handoff', async () => {
    const x = setup(); await x.call.start();
    await x.call.setProximity('principal', 'Alex', null, false, false);
    x.send({ type: 'session.started' }); await Promise.resolve();
    expect(x.track.enabled).toBe(false); expect(x.audio.muted).toBe(true);
    const pending = deferred<Response>(); x.fetcher.mockImplementationOnce(() => pending.promise);
    const handoff = x.call.setProximity('architect', 'Kai', null, false, true);
    await vi.waitFor(() => expect(x.fetcher).toHaveBeenCalledTimes(2));
    const leaving = x.call.setProximity('principal', 'Alex', null, false, false);
    pending.resolve(new Response('{}')); await handoff; await leaving;
    expect(x.track.enabled).toBe(false); expect(x.audio.muted).toBe(true);
    expect(x.track.stop).not.toHaveBeenCalled(); x.call.stop();
  });

  it('ignores a stale failed handoff after the call was stopped', async () => {
    const x = setup(); await x.call.start(); x.send({ type: 'session.started' });
    const pending = deferred<Response>(); x.fetcher.mockImplementationOnce(() => pending.promise);
    const handoff = x.call.setProximity('architect', 'Kai', null, false, true);
    await vi.waitFor(() => expect(x.fetcher).toHaveBeenCalledTimes(2));
    x.call.stop(); pending.resolve(new Response('{}', { status: 503 })); await handoff;
    expect(x.onError).not.toHaveBeenCalled(); expect(x.track.stop).toHaveBeenCalledOnce();
  });

  it('waits for session.started and includes the chosen specialist and element', async () => {
    const x = setup(); await x.call.start();
    expect(x.onStatus.mock.calls).toEqual([['connecting']]);
    expect(x.fetcher).toHaveBeenCalledWith('/api/studio/projects/project-a/voice', expect.objectContaining({ headers: { 'Content-Type': 'application/sdp', 'X-Atelier-Agent': 'designer', 'X-Atelier-Element': 'roof', 'X-Atelier-Location': 'designer' } }));
    x.send('{'); x.send({ type: 'session.started' });
    expect(x.onStatus).toHaveBeenLastCalledWith('live');
    x.call.stop(); x.call.stop();
    expect(x.track.stop).toHaveBeenCalledOnce();
    expect(x.peer.close).toHaveBeenCalledOnce();
    expect(x.audio.pause).toHaveBeenCalledOnce();
    expect(x.fetcher).toHaveBeenLastCalledWith('/api/studio/projects/project-a/voice/live_123', { method: 'DELETE', keepalive: true });
  });

  it('stops a microphone granted after cancellation without creating a connection', async () => {
    const x = setup(), permission = deferred<MediaStream>();
    x.environment.getUserMedia = () => permission.promise;
    const starting = x.call.start(); x.call.stop(); permission.resolve(x.stream); await starting;
    expect(x.track.stop).toHaveBeenCalledOnce();
    expect(x.environment.createPeer).not.toHaveBeenCalled();
    expect(x.fetcher).not.toHaveBeenCalled();
    expect(x.onStatus).toHaveBeenLastCalledWith('off');
  });

  it('waits for ICE candidates and posts the updated local SDP', async () => {
    const x = setup(); Object.defineProperty(x.peer, 'iceGatheringState', { value: 'gathering', configurable: true });
    const starting = x.call.start();
    await vi.waitFor(() => expect(x.peer.addEventListener).toHaveBeenCalled());
    expect(x.fetcher).not.toHaveBeenCalled();
    Object.defineProperty(x.peer, 'iceGatheringState', { value: 'complete' });
    x.peer.dispatchEvent(new Event('icegatheringstatechange')); await starting;
    expect(x.fetcher).toHaveBeenCalledWith('/api/studio/projects/project-a/voice', expect.objectContaining({ body: 'offer-with-candidates' }));
    expect(x.peer.removeEventListener).toHaveBeenCalledOnce();
    x.call.stop();
  });

  it('cancels ICE gathering without sending an offer and removes its listener', async () => {
    const x = setup(); Object.defineProperty(x.peer, 'iceGatheringState', { value: 'gathering' });
    const starting = x.call.start();
    await vi.waitFor(() => expect(x.peer.addEventListener).toHaveBeenCalled());
    x.call.stop(); await starting;
    expect(x.fetcher).not.toHaveBeenCalled();
    expect(x.track.stop).toHaveBeenCalledOnce();
    expect(x.peer.removeEventListener).toHaveBeenCalledOnce();
    expect(x.onError).not.toHaveBeenCalled();
  });

  it('bounds ICE gathering and releases the microphone when gathering stalls', async () => {
    vi.useFakeTimers(); const x = setup(); Object.defineProperty(x.peer, 'iceGatheringState', { value: 'gathering' });
    const starting = x.call.start(); await vi.advanceTimersByTimeAsync(8000); await starting;
    expect(x.fetcher).not.toHaveBeenCalled();
    expect(x.onError).toHaveBeenCalledWith('Your network took too long to prepare voice. Please reconnect.', { retryable: false });
    expect(x.track.stop).toHaveBeenCalledOnce();
    expect(x.peer.removeEventListener).toHaveBeenCalledOnce();
  });

  it('deletes a server session returned after cancellation instead of attaching it', async () => {
    const x = setup(), response = deferred<Response>(), requested = deferred<void>();
    x.fetcher.mockImplementationOnce(() => { requested.resolve(); return response.promise; });
    const starting = x.call.start(); await requested.promise; x.call.stop();
    response.resolve(new Response('late-sdp', { headers: { 'X-Voice-Session': 'live_late' } })); await starting;
    expect(x.peer.setRemoteDescription).not.toHaveBeenCalled();
    expect(x.fetcher).toHaveBeenLastCalledWith('/api/studio/projects/project-a/voice/live_late', { method: 'DELETE', keepalive: true });
    expect(x.onError).not.toHaveBeenCalled();
  });

  it('releases the allocated session if applying SDP fails', async () => {
    const x = setup(); vi.mocked(x.peer.setRemoteDescription).mockRejectedValueOnce(new Error('Invalid SDP'));
    await x.call.start();
    expect(x.onError).toHaveBeenCalledWith('Invalid SDP', { retryable: false });
    expect(x.track.stop).toHaveBeenCalledOnce();
    expect(x.fetcher).toHaveBeenLastCalledWith('/api/studio/projects/project-a/voice/live_123', { method: 'DELETE', keepalive: true });
  });

  it('cleans up once on service errors and allows a fresh independent call', async () => {
    const x = setup(); await x.call.start();
    x.send({ type: 'error', error: { message: 'Private upstream diagnostic' } });
    expect(x.onError).toHaveBeenCalledOnce();
    expect(x.onError.mock.calls[0][0]).not.toContain('Private');
    expect(x.track.stop).toHaveBeenCalledOnce();
    const next = setup(); await next.call.start(); next.send({ type: 'session.started' });
    expect(next.onStatus).toHaveBeenLastCalledWith('live'); next.call.stop();
  });

  it('times out a connection that never starts and releases its session', async () => {
    vi.useFakeTimers(); const x = setup(); await x.call.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(x.onStatus).toHaveBeenLastCalledWith('off');
    expect(x.track.stop).toHaveBeenCalledOnce();
    expect(x.fetcher).toHaveBeenLastCalledWith('/api/studio/projects/project-a/voice/live_123', { method: 'DELETE', keepalive: true });
  });
});
