'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, PhoneOff } from 'lucide-react';
import type { AgentId } from '@/shared/design';
import { agents } from '@/shared/design';
import { LiveVoiceSession, type VoiceStatus } from '@/lib/live-voice';

export default function Voice({ projectId, agent, elementId = null, meeting = false, inRange = true, onTranscript, onError }: {
  projectId: string | null;
  agent: AgentId;
  elementId?: string | null;
  meeting?: boolean;
  inRange?: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<VoiceStatus>('off');
  const retries = useRef(0), wasLive = useRef(false), reconnect = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startLatest = useRef<() => void>(() => {});
  const active = useRef<LiveVoiceSession | null>(null);
  const callbacks = useRef({ onTranscript, onError });
  callbacks.current = { onTranscript, onError };

  useEffect(() => {
    setStatus('off');
    return () => {
      clearTimeout(retryTimer.current); reconnect.current = false;
      const call = active.current;
      active.current = null;
      call?.stop();
    };
  }, [projectId]);

  useEffect(() => {
    const call = active.current;
    if (!call || status !== 'live') return;
    // Mute immediately in corridors; debounce valid targets at room boundaries.
    if (!inRange) { void call.setProximity(agent, agents[agent].name, elementId, meeting, false); return; }
    const timer = setTimeout(() => { void call.setProximity(agent, meeting ? 'Team / Alex' : agents[agent].name, elementId, meeting, true).catch(() => { call.stop(); callbacks.current.onError('Voice handoff failed. Please reconnect.'); }); }, 500);
    return () => clearTimeout(timer);
  }, [agent, elementId, meeting, inRange, status]);

  function start(automatic = false) {
    if (!automatic) retries.current = 0;
    reconnect.current = false; wasLive.current = false;
    if (active.current) return;
    if (!inRange) return onError('Walk near the meeting table or a teammate to start voice.');
    if (!projectId) return onError('Create a project to start a live voice conversation.');
    const call = new LiveVoiceSession({
      projectId,
      agent,
      elementId, meeting,
      agentName: agents[agent].name.split(' ')[0],
      onStatus: next => {
        if (active.current !== call) return;
        setStatus(next);
        if (next === 'live') wasLive.current = true;
        if (next === 'off') {
          active.current = null;
          if (reconnect.current) { setStatus('connecting'); retryTimer.current = setTimeout(() => startLatest.current(), 1800); }
        }
      },
      onTranscript: text => { if (active.current === call) callbacks.current.onTranscript(text); },
      onError: message => {
        if (active.current !== call) return;
        if (wasLive.current && retries.current < 2 && /disconnected|network connection/.test(message)) {
          retries.current++; reconnect.current = true;
          callbacks.current.onError('Voice connection interrupted. Reconnecting automatically...');
        } else callbacks.current.onError(message);
      },
    });
    active.current = call;
    void call.start();
  }

  startLatest.current = () => { if (inRange) start(true); else { reconnect.current = false; setStatus('off'); } };

  return <button
    type="button"
    className={`voice-button ${status === 'live' ? 'live' : ''}`}
    onClick={() => { if (status === 'off') start(); else { clearTimeout(retryTimer.current); reconnect.current = false; active.current?.stop(); setStatus('off'); } }}
    aria-pressed={status !== 'off'}
    title={status === 'off' ? 'Start live voice with GPT-Live 1' : status === 'connecting' ? 'Cancel connecting to GPT-Live 1' : 'End GPT-Live 1 conversation'}
  >
    {status === 'off' ? <Mic size={17} /> : <PhoneOff size={17} />}
    {status === 'connecting' ? 'Cancel connection' : status === 'live' ? (inRange ? 'End call' : 'Mic paused · End') : 'Live voice'}
  </button>;
}
