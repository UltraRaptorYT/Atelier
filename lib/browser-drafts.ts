import type { Brief, Project, Snapshot } from '../shared/design';
import { hasMeaningfulBrief } from '../shared/brief-validation';

export const localProjectsKey = 'atelier-local-projects';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Request = { name: string; brief: Brief };
type Connection = { operationId: string; runOperationId: string; request: Request; syncedRequest?: Request; startedRequest?: Request; connectedRequest?: Request; projectId?: string; baseRevision?: number; completed?: boolean };
type API = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
const connectionKey = (id: string) => `atelier-draft-connection:${id}`;
const requestFor = (draft: Snapshot): Request => ({ name: draft.project.name, brief: draft.project.brief });

export function readLocalProjects(storage: Storage = localStorage): Snapshot[] {
  try { const saved = JSON.parse(storage.getItem(localProjectsKey) || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
}
export function saveLocalSnapshot(snapshot: Snapshot, storage: Storage = localStorage) {
  const projects = readLocalProjects(storage).filter(item => item.project.id !== snapshot.project.id);
  storage.setItem(localProjectsKey, JSON.stringify([snapshot, ...projects]));
}
export function draftConnection(id: string, storage: Storage = localStorage): Connection | null {
  try { return JSON.parse(storage.getItem(connectionKey(id)) || 'null'); } catch { return null; }
}
export function prepareDraftConnection(draft: Snapshot, storage: Storage = localStorage): Connection {
  // A legacy draft may be opened in two tabs before either stores its receipt.
  // Its UUID is already unique, so both tabs must derive the same identities.
  const draftId = draft.project.id.slice('local_'.length);
  const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftId) ? draftId : crypto.randomUUID();
  const connection = draftConnection(draft.project.id, storage) || {
    operationId, runOperationId: operationId, request: structuredClone(requestFor(draft)),
  };
  storage.setItem(connectionKey(draft.project.id), JSON.stringify(connection));
  return connection;
}

/** Pending transfers remain represented by their recoverable browser draft. */
export function mergeProjects(remote: Project[], drafts: Snapshot[], storage: Storage = localStorage): Project[] {
  const projects = new Map(remote.map(project => [project.id, project]));
  for (const draft of drafts) {
    const connection = draftConnection(draft.project.id, storage);
    if (connection?.projectId && projects.has(connection.projectId)) {
      const connectedRequest = connection.connectedRequest || connection.startedRequest;
      if (connectedRequest && JSON.stringify(connectedRequest) !== JSON.stringify(requestFor(draft))) {
        projects.set(draft.project.id, { ...draft.project, name: `${draft.project.name} · browser edits` });
        continue;
      }
      if (connection.completed) continue;
      projects.delete(connection.projectId);
    }
    projects.set(draft.project.id, draft.project);
  }
  return [...projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Both mutation identities are durable before dispatch; a lost reply is safe to replay. */
export async function connectDraft(draft: Snapshot, api: API, storage: Storage = localStorage): Promise<Snapshot> {
  const key = connectionKey(draft.project.id);
  const connection = prepareDraftConnection(draft, storage);
  const persist = () => storage.setItem(key, JSON.stringify(connection));
  persist();
  const project = await api<Project>('/projects', 'POST', { ...connection.request, operationId: connection.operationId });
  connection.projectId = project.id;
  connection.baseRevision ??= project.revision;
  persist();
  let snapshot = await api<Snapshot>(`/projects/${project.id}`);
  const desired = requestFor(draft), current = { name: snapshot.project.name, brief: snapshot.project.brief };
  const dispatched = snapshot.runs?.some(run => run.id === connection.runOperationId);
  const connectedRequest = connection.connectedRequest || connection.startedRequest;
  if ((connection.completed || dispatched) && connectedRequest && JSON.stringify(connectedRequest) !== JSON.stringify(desired)) {
    throw new Error('Your browser edits were saved after this briefing started. Both copies are in Projects; open the shared project to apply these changes.');
  }
  if (!connection.completed && !dispatched && JSON.stringify(desired) !== JSON.stringify(current)) {
    const unchanged = [connection.request, connection.syncedRequest].some(request => JSON.stringify(request) === JSON.stringify(current));
    if (!unchanged || snapshot.design || snapshot.runs?.length) throw new Error('The connected project has newer work. Your browser draft is preserved; open the saved project to review it before changing its brief.');
    // Recover the original create first, then carry later offline edits into that
    // same untouched project. Remember the write before dispatch for lost replies.
    connection.syncedRequest = desired; persist();
    await api(`/projects/${project.id}/brief`, 'PUT', desired);
    snapshot = await api<Snapshot>(`/projects/${project.id}`);
  }
  if (!connection.completed && hasMeaningfulBrief(snapshot.project.brief.request) && !dispatched) {
    connection.startedRequest = structuredClone(desired); persist();
    try {
      await api(`/projects/${project.id}/runs`, 'POST', { kind: 'generate', operationId: connection.runOperationId, baseRevision: connection.baseRevision });
    } catch (error) {
      // The server may have queued work before the connection dropped.
      snapshot = await api<Snapshot>(`/projects/${project.id}`).catch(() => { throw error; });
      if (!snapshot.runs?.some(run => run.id === connection.runOperationId)) throw error;
    }
    snapshot = await api<Snapshot>(`/projects/${project.id}`);
  }
  connection.connectedRequest = structuredClone(desired);
  connection.completed = true;
  persist();
  return snapshot;
}
