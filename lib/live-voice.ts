import { TranscriptGrouper } from 'openai/lib/live/transcript-grouper';
import type { InputTranscriptDeltaEvent, OutputTranscriptDeltaEvent, SessionClosedEvent } from 'openai/resources/live/live';
import { isRecoverableLiveError } from '../shared/live-errors';

export type VoiceStatus = 'off' | 'connecting' | 'live';
type TranscriptDelta = InputTranscriptDeltaEvent | OutputTranscriptDeltaEvent;
type DisplayEvent = TranscriptDelta | { type: 'session.started' } | { type: 'session.closed'; reason?: SessionClosedEvent['reason'] } | { type: 'error'; recoverable: boolean; code?: string };
export type VoiceErrorDetails = { retryable: boolean };
type Proximity = { agent: string; agentName: string; elementId: string | null; meeting: boolean; inRange: boolean };

/** Consume only public Live display events; the server owns project actions. */
export function parseLiveDisplayEvent(raw: unknown): DisplayEvent | null {
  if (typeof raw !== 'string') return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type === 'session.started') return { type: event.type };
  if (event.type === 'error') {
    const error = event.error as {code?:unknown} | undefined;
    return { type: event.type, recoverable: isRecoverableLiveError(event), ...(typeof error?.code === 'string' ? {code:error.code} : {}) };
  }
  if (event.type === 'session.closed') {
    const reason = ['close_requested', 'expired', 'content', 'remote_hangup', 'connection_lost'].includes(String(event.reason)) ? event.reason as SessionClosedEvent['reason'] : undefined;
    return { type: event.type, reason };
  }
  if (event.type !== 'session.input_transcript.delta' && event.type !== 'session.output_transcript.delta') return null;
  if (typeof event.event_id !== 'string' || !event.event_id || typeof event.delta !== 'string'
    || typeof event.start_ms !== 'number' || !Number.isSafeInteger(event.start_ms) || event.start_ms < 0
    || typeof event.end_ms !== 'number' || !Number.isSafeInteger(event.end_ms) || event.end_ms < event.start_ms) return null;
  return { type: event.type, event_id: event.event_id, delta: event.delta, start_ms: event.start_ms, end_ms: event.end_ms };
}

type VoiceOptions = {
  projectId: string; agent: string; elementId: string | null; agentName: string; meeting?: boolean;
  onStatus: (status: VoiceStatus) => void;
  onTranscript: (text: string) => void;
  /** `retryable` is true only for a transient failure that ended the call and may be renewed. */
  onError: (message: string, details?: VoiceErrorDetails) => void;
};
export type VoiceEnvironment = {
  getUserMedia: () => Promise<MediaStream>;
  createPeer: () => RTCPeerConnection;
  createAudio: () => HTMLAudioElement;
  fetch: typeof fetch;
};

/** One instance per call: stale async completions can only clean up their own call. */
export class LiveVoiceSession {
  private closed = false;
  private started = false;
  private ready = false;
  private peer: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private channel: RTCDataChannel | null = null;
  private sessionId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private proximityRevision = 0;
  private proximityUpdates: Promise<void> = Promise.resolve();
  private proximity: Proximity;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private cancelIceWait: (() => void) | null = null;
  private transcript: TranscriptGrouper;
  private readonly url: string;

  constructor(private readonly options: VoiceOptions, private readonly environment: VoiceEnvironment = {
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    createPeer: () => new RTCPeerConnection(),
    createAudio: () => new Audio(),
    fetch: (...args) => fetch(...args),
  }) {
    this.url = `/api/studio/projects/${encodeURIComponent(options.projectId)}/voice`;
    this.proximity = { agent: options.agent, agentName: options.agentName, elementId: options.elementId, meeting: Boolean(options.meeting), inRange: true };
    // Live deltas have no server "done" event. These are local display segments,
    // finalized by speaker changes/inactivity, never treated as tool instructions.
    this.transcript = this.createTranscript();
  }

  private createTranscript(): TranscriptGrouper {
    const transcript = new TranscriptGrouper({ backchannelMaxDurationMs: 0 });
    transcript.on('segment.closed', ({ segment }) => {
      if (segment.text.trim()) this.options.onTranscript(`${segment.speaker === 'user' ? 'You' : this.options.agentName}: ${segment.text}`);
    });
    return transcript;
  }

  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    this.options.onStatus('connecting');
    this.timer = setTimeout(() => this.fail('Voice took too long to connect. Try starting live voice again.'), 60000);
    try {
      const stream = await this.environment.getUserMedia();
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.setAudible(false);
      const pc = this.environment.createPeer(); this.peer = pc;
      const audio = this.environment.createAudio(); this.audio = audio; audio.autoplay = true; audio.muted = true;
      pc.ontrack = event => {
        if (this.closed) return;
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void audio.play().catch(() => { if (!this.closed) this.options.onError('Allow audio playback to hear your agent.'); });
      };
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const channel = pc.createDataChannel('oai-events'); this.channel = channel;
      channel.onmessage = event => this.receive(event.data);
      channel.onclose = () => this.fail('Live voice disconnected. Start live voice to reconnect.', true);
      channel.onerror = () => { /* Connection state decides whether a transient error needs recovery. */ };
      pc.onconnectionstatechange = () => {
        clearTimeout(this.disconnectTimer);
        if (pc.connectionState === 'disconnected') this.disconnectTimer = setTimeout(() => { if (pc.connectionState !== 'connected') this.fail('The voice network connection did not recover. Please reconnect.', true); }, 12000);
        else if (['failed', 'closed'].includes(pc.connectionState)) this.fail('The voice network connection ended. Your saved project is available.', true);
      };
      const offer = await pc.createOffer();
      if (this.closed) return;
      await pc.setLocalDescription(offer);
      if (this.closed) return;
      await this.waitForIce(pc);
      if (this.closed) return;
      const localSdp = pc.localDescription?.sdp;
      if (!localSdp) throw new Error('Your browser could not prepare the voice connection. Please reconnect.');
      const headers: Record<string, string> = { 'Content-Type': 'application/sdp', 'X-Atelier-Agent': this.options.agent, 'X-Atelier-Location': this.options.meeting ? 'reception' : this.options.agent };
      if (this.options.elementId) headers['X-Atelier-Element'] = this.options.elementId;
      // Let an in-flight response finish after stop so its newly allocated server
      // session can be deleted. Aborting here would lose the returned session ID.
      const response = await this.environment.fetch(this.url, { method: 'POST', headers, body: localSdp });
      this.sessionId = response.headers.get('X-Voice-Session');
      if (this.closed) { this.closeServerSession(); await response.body?.cancel(); return; }
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: unknown } | null;
        this.fail(typeof result?.error === 'string' ? result.error : 'Voice could not connect.', ![400,401,402,403,404,415].includes(response.status));
        return;
      }
      if (!this.sessionId) throw new Error('Voice did not return a session. Please reconnect.');
      const sdp = await response.text();
      if (this.closed) return;
      await pc.setRemoteDescription({ type: 'answer', sdp });
      // session.started, rather than receipt of SDP, confirms the live session.
    } catch (error) {
      if (!this.closed) this.fail(error instanceof Error ? error.message : 'Microphone unavailable.');
    }
  }

  setProximity(agent: string, agentName: string, elementId: string | null, meeting: boolean, inRange: boolean): Promise<void> {
    this.proximity = { agent, agentName, elementId, meeting, inRange };
    return this.queueProximity();
  }

  private setAudible(enabled: boolean): void {
    this.stream?.getAudioTracks().forEach(track => { track.enabled = enabled; });
    if (this.audio) this.audio.muted = !enabled;
  }

  private queueProximity(): Promise<void> {
    const update = ++this.proximityRevision;
    this.setAudible(false);
    // Keep at most one server handoff in flight. Superseded queued targets are
    // skipped, but an acknowledged in-flight target remains our true server state.
    this.proximityUpdates = this.proximityUpdates.then(async () => {
      if (this.closed || !this.ready || !this.sessionId || update !== this.proximityRevision || !this.proximity.inRange) return;
      const { agent, agentName, elementId, meeting } = this.proximity;
      const changed = agent !== this.options.agent || elementId !== this.options.elementId || meeting !== Boolean(this.options.meeting);
      if (changed) {
        let response: Response;
        try {
          response = await this.environment.fetch(`${this.url}/${encodeURIComponent(this.sessionId)}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({agent, elementId, meeting}), signal: AbortSignal.timeout(15000) });
        } catch {
          if (!this.closed) this.fail('The voice network connection could not complete the handoff. Please reconnect.', true);
          return;
        }
        if (this.closed) return;
        if (!response.ok) { this.fail('Voice handoff could not complete. Reconnect near your teammate.', response.status >= 500 || response.status === 404); return; }
        // Flush segments under the previous speaker's name before relabeling.
        this.transcript.close();
        Object.assign(this.options, {agent, agentName, elementId, meeting});
        this.transcript = this.createTranscript();
      } else this.options.agentName = agentName;
      if (!this.closed && update === this.proximityRevision) this.setAudible(true);
    });
    return this.proximityUpdates;
  }

  private waitForIce(pc: RTCPeerConnection): Promise<void> {
    if (this.closed || pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', onGatheringChange);
        this.cancelIceWait = null;
        if (error) reject(error); else resolve();
      };
      const onGatheringChange = () => { if (pc.iceGatheringState === 'complete') finish(); };
      const timeout = setTimeout(() => finish(new Error('Your network took too long to prepare voice. Please reconnect.')), 8000);
      this.cancelIceWait = () => finish();
      pc.addEventListener('icegatheringstatechange', onGatheringChange);
      // Gathering can finish between the initial check and listener registration.
      onGatheringChange();
    });
  }

  private receive(raw: unknown): void {
    if (this.closed) return;
    const event = parseLiveDisplayEvent(raw);
    if (!event) return;
    if (event.type === 'session.started') {
      if (this.ready) return;
      this.ready = true; clearTimeout(this.timer); this.options.onStatus('live');
      void this.queueProximity();
    }
    else if (event.type === 'session.closed') {
      if (event.reason === 'content') this.fail('The voice service ended this session for a content safety restriction.');
      else if (event.reason === 'expired') this.fail('Voice session ended. Renewing the connection.', true);
      else if (event.reason === 'connection_lost') this.fail('The voice network connection ended. Your saved project is available.', true);
      else this.stop();
    }
    else if (event.type === 'error') {
      if (event.recoverable) this.options.onError('A voice action could not complete. You can keep talking.', { retryable: false });
      else this.fail('The voice service reported an error.', !/auth|api_key|quota|billing|content|policy|permission/i.test(event.code || ''));
    }
    else this.transcript.push(event);
  }

  private fail(message: string, retryable = false): void {
    if (this.closed) return;
    this.options.onError(message, { retryable });
    this.stop();
  }

  private closeServerSession(): void {
    const id = this.sessionId;
    this.sessionId = null;
    if (id) void this.environment.fetch(`${this.url}/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.disconnectTimer);
    this.cancelIceWait?.();
    this.transcript.close();
    if (this.channel) { this.channel.onmessage = null; this.channel.onclose = null; this.channel.onerror = null; this.channel.close(); this.channel = null; }
    if (this.peer) { this.peer.ontrack = null; this.peer.onconnectionstatechange = null; this.peer.close(); this.peer = null; }
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; this.audio = null; }
    this.closeServerSession();
    this.options.onStatus('off');
  }
}
