'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, PhoneOff } from 'lucide-react';
import { AgentId } from '@/shared/design';
export default function Voice({ projectId, agent, onTranscript, onError }: { projectId: string | null; agent: AgentId; onTranscript: (s: string) => void; onError: (s: string) => void }) {
  const [status, setStatus] = useState<'off' | 'connecting' | 'live'>('off');
  const peer = useRef<RTCPeerConnection | null>(null), stream = useRef<MediaStream | null>(null), audio = useRef<HTMLAudioElement | null>(null), session = useRef<string | null>(null);
  const cleanup = () => { peer.current?.close(); peer.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; if (audio.current) { audio.current.pause(); audio.current.srcObject = null; } };
  const stop = async () => { cleanup(); setStatus('off'); if (session.current) { const id = session.current; session.current = null; await fetch(`/api/studio/projects/${projectId}/voice/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {}); } };
  useEffect(() => { return () => { cleanup(); if (session.current) void fetch(`/api/studio/projects/${projectId}/voice/${encodeURIComponent(session.current)}`, { method: 'DELETE', keepalive: true }); session.current = null; }; }, [agent, projectId]);
  useEffect(() => { setStatus('off'); }, [agent, projectId]);
  async function start() {
    if (!projectId) return onError('Create a project and connect your OpenAI key to start a voice conversation.');
    setStatus('connecting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const pc = new RTCPeerConnection(); peer.current = pc;
      audio.current = new Audio(); audio.current.autoplay = true;
      pc.ontrack = e => { if (audio.current) { audio.current.srcObject = e.streams[0]; void audio.current.play().catch(() => onError('Allow audio playback to hear your agent.')); } };
      stream.current.getTracks().forEach(t => pc.addTrack(t, stream.current!));
      const channel = pc.createDataChannel('oai-events');
      channel.onmessage = e => {
        const event = JSON.parse(e.data);
        if (event.type === 'conversation.item.input_audio_transcription.completed') onTranscript(`You: ${event.transcript}`);
        if (event.type === 'response.output_audio_transcript.done' || event.type === 'response.audio_transcript.done') onTranscript(`${agent}: ${event.transcript}`);
        if (event.type === 'error') onError('The voice service reported an error. End the call and reconnect.');
      };
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState)) { void stop(); onError('Voice disconnected. Your design work is still saved.'); } };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const response = await fetch(`/api/studio/projects/${projectId}/voice`, { method: 'POST', headers: { 'Content-Type': 'application/sdp', 'X-Atelier-Agent': agent }, body: offer.sdp });
      if (!response.ok) throw new Error((await response.json()).error || 'Voice could not connect.');
      session.current = response.headers.get('X-Voice-Session');
      await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() }); setStatus('live');
    } catch (e) { await stop(); onError(e instanceof Error ? e.message : 'Microphone unavailable.'); }
  }
  return <button className={`voice-button ${status === 'live' ? 'live' : ''}`} onClick={() => status === 'off' ? void start() : void stop()} disabled={status === 'connecting'} title={status === 'live' ? 'End voice conversation' : 'Start voice conversation'}>{status === 'live' ? <PhoneOff size={17} /> : <Mic size={17} />}{status === 'connecting' ? 'Connecting…' : status === 'live' ? 'End call' : 'Talk'}</button>;
}
