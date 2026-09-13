'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, PhoneOff } from 'lucide-react';
import type { AgentId } from '@/shared/design';
import { agents } from '@/shared/design';
import { LiveVoiceSession, type VoiceStatus } from '@/lib/live-voice';

export default function Voice({ projectId, agent, elementId = null, meeting = false, inRange = true, onTranscript, onError }: {
  projectId: string | null; agent: AgentId; elementId?: string | null; meeting?: boolean; inRange?: boolean;
  onTranscript: (text: string) => void; onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<VoiceStatus>('off');
  const wanted = useRef(false), generation = useRef(0), retries = useRef(0);
  const microphone = useRef<MediaStream | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stableTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef<LiveVoiceSession | null>(null);
  const startLatest = useRef<() => void>(() => {});
  const latest = useRef({ projectId, agent, elementId, meeting, inRange, onTranscript, onError });
  latest.current = { projectId, agent, elementId, meeting, inRange, onTranscript, onError };

  function releaseMicrophone() {
    microphone.current?.getTracks().forEach(track => track.stop());
    microphone.current = null;
  }
  function endCall() {
    wanted.current = false; generation.current++;
    clearTimeout(retryTimer.current); clearTimeout(stableTimer.current);
    active.current?.stop(); active.current = null;
    releaseMicrophone(); setStatus('off');
  }
  useEffect(() => {
    setStatus('off');
    return () => {
      wanted.current = false; generation.current++;
      clearTimeout(retryTimer.current); clearTimeout(stableTimer.current);
      const call = active.current; active.current = null; call?.stop();
      releaseMicrophone();
    };
  }, [projectId]);

  useEffect(() => {
    const call = active.current;
    if (!call || status !== 'live') return;
    const update = () => void call.setProximity(agent, meeting ? 'Team / Alex' : agents[agent].name, elementId, meeting, inRange);
    if (!inRange) { update(); return; }
    const timer = setTimeout(update, 500);
    return () => clearTimeout(timer);
  }, [agent, elementId, meeting, inRange, status]);

  async function connect() {
    const snapshot = latest.current;
    if (!wanted.current || active.current || !snapshot.projectId) return;
    const attempt = ++generation.current;
    setStatus('connecting');
    try {
      // Keep the original capture alive across transport renewal. Each call owns
      // only a clone, so stopping an old peer cannot switch the microphone off.
      if (!microphone.current || microphone.current.getTracks().every(track => track.readyState === 'ended')) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!wanted.current || generation.current !== attempt) { stream.getTracks().forEach(track => track.stop()); return; }
        microphone.current = stream;
      }
      if (!wanted.current || generation.current !== attempt) return;
      const call = new LiveVoiceSession({
        projectId: snapshot.projectId, agent: snapshot.agent, elementId: snapshot.elementId, meeting: snapshot.meeting,
        agentName: snapshot.meeting ? 'Team / Alex' : agents[snapshot.agent].name.split(' ')[0],
        onStatus: next => {
          if (active.current !== call) return;
          if (next === 'live') {
            setStatus('live');
            stableTimer.current = setTimeout(() => { retries.current = 0; }, 30000);
            const target = latest.current;
            void call.setProximity(target.agent, target.meeting ? 'Team / Alex' : agents[target.agent].name, target.elementId, target.meeting, target.inRange);
          } else if (next === 'off') {
            active.current = null; clearTimeout(stableTimer.current);
            if (wanted.current) {
              setStatus('connecting');
              const delay = Math.min(30000, 1000 * 2 ** Math.min(retries.current++, 5));
              retryTimer.current = setTimeout(() => startLatest.current(), delay);
            } else { releaseMicrophone(); setStatus('off'); }
          } else setStatus(next);
        },
        onTranscript: text => { if (active.current === call) latest.current.onTranscript(text); },
        onError: (message, retryable) => {
          if (active.current !== call) return;
          if (retryable === false) wanted.current = false;
          latest.current.onError(wanted.current && retryable !== undefined ? 'Voice interrupted. Reconnecting automatically; your project keeps running.' : message);
        },
      }, {
        getUserMedia: async () => {
          const stream = microphone.current!.clone();
          stream.getAudioTracks().forEach(track => { track.enabled = latest.current.inRange; });
          return stream;
        },
        createPeer: () => new RTCPeerConnection(), createAudio: () => new Audio(), fetch: (...args) => fetch(...args),
      });
      active.current = call;
      await call.start();
    } catch (error) {
      if (generation.current !== attempt) return;
      wanted.current = false; releaseMicrophone(); setStatus('off');
      latest.current.onError(error instanceof Error ? error.message : 'Microphone unavailable.');
    }
  }
  startLatest.current = () => { void connect(); };

  function start() {
    if (!projectId) return onError('Create a project to start a live voice conversation.');
    if (!inRange) return onError('Walk near the meeting table or a teammate to start voice.');
    wanted.current = true; retries.current = 0; void connect();
  }

  return <><button type="button" className={`voice-button ${status === 'live' ? 'live' : ''}`}
    onClick={() => status === 'off' ? start() : endCall()} aria-pressed={status !== 'off'}
    title={status === 'off' ? 'Start live voice with GPT-Live 1' : 'End microphone connection'}>
    {status === 'off' ? <Mic size={17} /> : <PhoneOff size={17} />}
    {status === 'connecting' ? 'Connecting · End' : status === 'live' ? (inRange ? 'End call' : 'Mic paused · End') : 'Live voice'}
  </button>{status !== 'off' && createPortal(<button className="voice-floating" onClick={endCall} aria-label="End live microphone connection">
    <PhoneOff size={16}/><span>{status === 'connecting' ? 'Connecting / reconnecting' : inRange ? `Mic live · ${meeting ? 'Team' : agents[agent].name.split(' ')[0]}` : 'Connected · mic paused out of range'}<small>End call</small></span>
  </button>, document.body)}</>;
}
