'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, PhoneOff } from 'lucide-react';
import type { AgentId } from '@/shared/design';
import { agents } from '@/shared/design';
import { LiveVoiceSession, type VoiceStatus } from '@/lib/live-voice';

export default function Voice({ projectId, agent, elementId = null, onTranscript, onError }: {
  projectId: string | null;
  agent: AgentId;
  elementId?: string | null;
  onTranscript: (s: string) => void;
  onError: (s: string) => void;
}) {
  const [status, setStatus] = useState<VoiceStatus>('off');
  const active = useRef<LiveVoiceSession | null>(null);
  const callbacks = useRef({ onTranscript, onError });
  callbacks.current = { onTranscript, onError };

  useEffect(() => {
    setStatus('off');
    return () => {
      const call = active.current;
      active.current = null;
      call?.stop();
    };
  }, [projectId, agent, elementId]);

  function start() {
    if (active.current) return;
    if (!projectId) return onError('Create a project to start a live voice conversation.');
    const call = new LiveVoiceSession({
      projectId, agent, elementId, agentName: agents[agent].name.split(' ')[0],
      onStatus: next => {
        if (active.current !== call) return;
        setStatus(next);
        if (next === 'off') active.current = null;
      },
      onTranscript: text => { if (active.current === call) callbacks.current.onTranscript(text); },
      onError: message => { if (active.current === call) callbacks.current.onError(message); },
    });
    active.current = call;
    void call.start();
  }

  return <button type="button" className={`voice-button ${status === 'live' ? 'live' : ''}`}
    onClick={() => status === 'off' ? start() : active.current?.stop()}
    aria-pressed={status !== 'off'}
    title={status === 'off' ? 'Start live voice with GPT-Live 1' : status === 'connecting' ? 'Cancel connecting to GPT-Live 1' : 'End GPT-Live 1 conversation'}>
    {status === 'off' ? <Mic size={17} /> : <PhoneOff size={17} />}
    {status === 'connecting' ? 'Cancel connection' : status === 'live' ? 'End call' : 'Live voice'}
  </button>;
}
