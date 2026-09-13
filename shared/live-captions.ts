type Fragment = { event_id: string; delta: string; start_ms: number; end_ms: number };
// Continuous per-speaker captions: fragments are not semantic turns or tool triggers.
export class LiveCaptions {
  private fragments: Record<'user' | 'assistant', Fragment[]> = { user: [], assistant: [] };
  private seen = new Set<string>();
  accept(event: Record<string, unknown>) {
    if (event.type !== 'session.input_transcript.delta' && event.type !== 'session.output_transcript.delta') return null;
    if (typeof event.event_id !== 'string' || typeof event.delta !== 'string' || typeof event.start_ms !== 'number' || typeof event.end_ms !== 'number' || this.seen.has(event.event_id)) return null;
    this.seen.add(event.event_id);
    const speaker = event.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
    this.fragments[speaker].push(event as Fragment);
    this.fragments[speaker].sort((a,b) => a.start_ms - b.start_ms);
    return { speaker, text: this.fragments[speaker].map(f => f.delta).join('') };
  }
}
