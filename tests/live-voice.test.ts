import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveVoiceSession, parseLiveDisplayEvent, type VoiceEnvironment } from '../lib/live-voice';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
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
    expect(x.onError).toHaveBeenCalledWith('Your network took too long to prepare voice. Please reconnect.');
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
    expect(x.onError).toHaveBeenCalledWith('Invalid SDP');
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
