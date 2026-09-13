import type { AgentId } from '../shared/design';

export const WORKSTATION_CONNECT_MS = 20_000;
export const WORKSTATION_REUSE_MS = 120_000;

export type WorkstationSpec = Readonly<{ projectId: string; agent: AgentId; identity: string }>;
export type WorkstationSession = WorkstationSpec & Readonly<{
  key: string;
  generation: number;
  status: 'connecting' | 'ready' | 'error';
  url?: string;
  message?: string;
  connectedAt?: number;
}>;
type Options = {
  connect: (projectId: string, agent: AgentId, signal: AbortSignal) => Promise<{ url: string }>;
  onChange?: (sessions: readonly WorkstationSession[]) => void;
  now?: () => number;
};
type Pending = { generation: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };

const unavailable = 'Could not connect to this workstation. Retry, or view saved previews in Files.';
const timedOut = 'The workstation did not connect within 20 seconds. Retry, or view saved previews in Files.';
const invalidAddress = 'The workstation returned an invalid viewer address. Retry, or view saved previews in Files.';

/** A new task replaces the previous stream for this same project and agent. */
export function workstationKey(spec: Pick<WorkstationSpec, 'projectId' | 'agent'>): string {
  return JSON.stringify([spec.projectId, spec.agent]);
}

function viewerUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch { return null; }
}

/** Memory-only viewer credentials. Nothing reconnects without an explicit ensure. */
export function createWorkstationSessions({ connect, onChange, now = Date.now }: Options) {
  const records = new Map<string, WorkstationSession>();
  const pending = new Map<string, Pending>();
  const listeners = new Set<() => void>();
  let snapshot: readonly WorkstationSession[] = Object.freeze([]);
  let generation = 0;

  const publish = () => {
    snapshot = Object.freeze([...records.values()]);
    onChange?.(snapshot);
    for (const listener of listeners) listener();
  };
  const stopPending = (key: string) => {
    const request = pending.get(key);
    if (!request) return;
    pending.delete(key);
    clearTimeout(request.timer);
    request.controller.abort();
  };
  const setError = (session: WorkstationSession, message: string) => {
    records.set(session.key, Object.freeze({
      key: session.key, projectId: session.projectId, agent: session.agent,
      identity: session.identity, generation: session.generation, status: 'error', message,
    }));
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    ensure(spec: WorkstationSpec, force = false): void {
      const key = workstationKey(spec), previous = records.get(key);
      if (!force && previous?.identity === spec.identity) {
        if (previous.status === 'connecting' || previous.status === 'error') return;
        const age = now() - previous.connectedAt!;
        if (age >= 0 && age < WORKSTATION_REUSE_MS) return;
      }
      stopPending(key);
      const session: WorkstationSession = Object.freeze({ ...spec, key, generation: ++generation, status: 'connecting' });
      const controller = new AbortController();
      const request: Pending = {
        generation: session.generation, controller,
        timer: setTimeout(() => {
          if (pending.get(key) !== request) return;
          stopPending(key);
          setError(session, timedOut);
          publish();
        }, WORKSTATION_CONNECT_MS),
      };
      pending.set(key, request);
      records.set(key, session);
      publish();
      // Scheduling also lets a synchronous close cancel before a POST is sent.
      void Promise.resolve().then(async () => {
        if (pending.get(key) !== request) return;
        try {
          const response = await connect(session.projectId, session.agent, controller.signal);
          if (pending.get(key) !== request) return;
          const url = viewerUrl(response?.url);
          pending.delete(key);
          clearTimeout(request.timer);
          if (url) records.set(key, Object.freeze({ ...session, status: 'ready', url, connectedAt: now() }));
          else setError(session, invalidAddress);
        } catch {
          if (pending.get(key) !== request) return;
          pending.delete(key);
          clearTimeout(request.timer);
          setError(session, unavailable);
        }
        publish();
      });
    },
    /** Closing the viewer stops pending connections and preserves healthy frames. */
    cancelPending(): void {
      if (!pending.size) return;
      for (const key of pending.keys()) {
        stopPending(key);
        records.delete(key);
      }
      publish();
    },
    /** A project switch or sign-out must discard its in-memory viewer credentials. */
    clear(projectId?: string): void {
      let changed = false;
      for (const [key, session] of records) {
        if (projectId !== undefined && session.projectId !== projectId) continue;
        stopPending(key);
        records.delete(key);
        changed = true;
      }
      if (changed) publish();
    },
    /** Release one inactive frame; a later deliberate open may connect again. */
    discard(keyOrSpec: string | WorkstationSpec, expectedGeneration?: number): void {
      const key = typeof keyOrSpec === 'string' ? keyOrSpec : workstationKey(keyOrSpec);
      const session = records.get(key);
      if (!session || (typeof keyOrSpec !== 'string' && session.identity !== keyOrSpec.identity)
        || (expectedGeneration !== undefined && session.generation !== expectedGeneration)) return;
      stopPending(key);
      records.delete(key);
      publish();
    },
    /** Callbacks can supply their generation so an old frame cannot invalidate a new one. */
    invalidate(keyOrSpec: string | WorkstationSpec, message = unavailable, expectedGeneration?: number): void {
      const key = typeof keyOrSpec === 'string' ? keyOrSpec : workstationKey(keyOrSpec);
      const session = records.get(key);
      if (!session || (typeof keyOrSpec !== 'string' && session.identity !== keyOrSpec.identity)
        || (expectedGeneration !== undefined && session.generation !== expectedGeneration)) return;
      stopPending(key);
      // This message is UI-authored copy; provider errors are never forwarded here.
      setError(session, message);
      publish();
    },
  };
}
