import type { Snapshot } from '../shared/design';

export type ProjectConnection = 'connecting' | 'live' | 'polling' | 'offline';

/** Neither a late event refresh nor a manual refresh may restore an older model. */
export function isCurrentSnapshot(next: Snapshot, current: Snapshot | null): boolean {
  return !current || (next.project.id === current.project.id
    && next.project.revision >= current.project.revision
    && (next.events.at(-1)?.id ?? 0) >= (current.events.at(-1)?.id ?? 0)
    && next.project.updatedAt >= current.project.updatedAt);
}

type Options = {
  projectId: string;
  after: number;
  read: (signal: AbortSignal) => Promise<Snapshot>;
  onSnapshot: (snapshot: Snapshot) => void;
  onConnection: (status: ProjectConnection) => void;
};

/** Coalesce event bursts and keep checking saved state if the stream goes quiet. */
export function subscribeToProject(options: Options) {
  const source = new EventSource(`/api/studio/projects/${encodeURIComponent(options.projectId)}/events?after=${options.after}`);
  let stopped = false, reading = false, pending = false, live = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  options.onConnection('connecting');

  const refresh = async () => {
    if (stopped) return;
    if (reading) { pending = true; return; }
    reading = true;
    request = new AbortController();
    const controller = request;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const next = await options.read(controller.signal);
      if (!stopped) {
        options.onSnapshot(next);
        options.onConnection(live ? 'live' : 'polling');
      }
    } catch {
      if (!stopped) options.onConnection('offline');
    } finally {
      clearTimeout(timeout);
      reading = false;
      if (pending && !stopped) { pending = false; schedule(); }
    }
  };
  const schedule = () => {
    if (stopped || debounce !== undefined) return;
    debounce = setTimeout(() => { debounce = undefined; void refresh(); }, 150);
  };
  source.onmessage = schedule;
  source.onopen = () => { live = true; schedule(); };
  source.onerror = () => { live = false; schedule(); };
  const poll = setInterval(schedule, 15000);
  window.addEventListener('focus', schedule);
  window.addEventListener('online', schedule);
  schedule();
  return () => {
    stopped = true;
    clearInterval(poll);
    clearTimeout(debounce);
    request?.abort();
    source.close();
    window.removeEventListener('focus', schedule);
    window.removeEventListener('online', schedule);
  };
}
