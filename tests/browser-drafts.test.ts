import { describe, expect, it, vi } from 'vitest';
import { connectDraft, draftConnection, mergeProjects, readLocalProjects, saveLocalSnapshot } from '../lib/browser-drafts';
import type { Snapshot } from '../shared/design';

function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const draft: Snapshot = { project: { id: `local_${crypto.randomUUID()}`, name: 'Offline house', brief: { request: 'A courtyard home for four people.', summary: 'Courtyard home', goals: [], constraints: [], questions: [] }, revision: 0, status: 'draft', createdAt: '2026-09-13', updatedAt: '2026-09-13' }, design: null, tasks: [], events: [], artifacts: [], runs: [] };
  const created = new Map<string, Snapshot>(), payloads = new Map<string, string>();
  let lostCreate = false, lostRun = false, readsOffline = false, hideRunRecovery = false;
  const request = vi.fn(async (path: string, method = 'GET', input?: any) => {
    if (path === '/projects') {
      const payload = JSON.stringify(input);
      if (payloads.has(input.operationId) && payloads.get(input.operationId) !== payload) throw new Error('Conflicting create request.');
      payloads.set(input.operationId, payload);
      if (!created.has(input.operationId)) created.set(input.operationId, { ...structuredClone(draft), project: { ...draft.project, name: input.name, brief: structuredClone(input.brief), id: input.operationId } });
      if (lostCreate) { lostCreate = false; throw new Error('Create reply lost.'); }
      return created.get(input.operationId)!.project;
    }
    const snapshot = created.get(path.split('/')[2])!;
    if (method === 'POST') {
      snapshot.runs!.push({ id: input.operationId, kind: 'generate', status: 'in_progress' });
      if (lostRun) { lostRun = false; readsOffline = hideRunRecovery; throw new Error('Run reply lost.'); }
    } else if (method === 'PUT') { snapshot.project.name = input.name; snapshot.project.brief = input.brief; }
    else if (readsOffline) throw new Error('Read unavailable.');
    return structuredClone(snapshot);
  });
  saveLocalSnapshot(draft, storage);
  return { storage, draft, created, request, api: request as <T>(path: string, method?: string, body?: unknown) => Promise<T>, loseCreate: () => { lostCreate = true; }, loseRun: (hideRecovery = false) => { lostRun = true; hideRunRecovery = hideRecovery; }, setReadsOffline: (offline: boolean) => { readsOffline = offline; } };
}

describe('browser draft reconnection', () => {
  it('replays a lost project save after reload and starts exactly one run with durable identities', async () => {
    const f = setup(); f.loseCreate();
    await expect(connectDraft(f.draft, f.api, f.storage)).rejects.toThrow('Create reply lost');
    const pending = draftConnection(f.draft.project.id, f.storage)!;
    expect(readLocalProjects(f.storage)).toEqual([f.draft]);
    const connected = await connectDraft(readLocalProjects(f.storage)[0], f.api, f.storage);
    expect(f.created.size).toBe(1);
    expect(connected.project.id).toBe(pending.operationId);
    expect(connected.runs).toEqual([{ id: pending.runOperationId, kind: 'generate', status: 'in_progress' }]);
    await connectDraft(f.draft, f.api, f.storage);
    expect(f.request.mock.calls.filter(([path]) => path.endsWith('/runs'))).toHaveLength(1);
  });

  it('recovers an accepted run whose reply was lost without dispatching again', async () => {
    const f = setup(); f.loseRun();
    const connected = await connectDraft(f.draft, f.api, f.storage);
    expect(connected.runs).toHaveLength(1);
    await connectDraft(f.draft, f.api, f.storage);
    expect(f.request.mock.calls.filter(([path]) => path.endsWith('/runs'))).toHaveLength(1);
    expect(readLocalProjects(f.storage)).toEqual([f.draft]);
  });

  it('carries later offline edits into the same untouched project using the immutable create request', async () => {
    const f = setup(); f.loseCreate();
    await expect(connectDraft(f.draft, f.api, f.storage)).rejects.toThrow();
    f.draft.project.brief.request += ' Include a gaming room.';
    const connected = await connectDraft(f.draft, f.api, f.storage);
    expect(f.created.size).toBe(1);
    expect(connected.project.brief.request).toContain('gaming room');
    expect(f.request.mock.calls.filter(([path]) => path === '/projects').map(([, , body]) => body)).toEqual([f.request.mock.calls[0][2], f.request.mock.calls[0][2]]);
  });

  it('recovers after both run reply and reconciliation fail, even if the Principal has normalized the brief', async () => {
    const f = setup(); f.loseRun(true);
    await expect(connectDraft(f.draft, f.api, f.storage)).rejects.toThrow('Run reply lost');
    expect(readLocalProjects(f.storage)).toEqual([f.draft]);
    const remote = [...f.created.values()][0];
    remote.project.brief = { ...remote.project.brief, summary: 'Principal interpreted courtyard brief', goals: ['Four occupants'] };
    f.setReadsOffline(false);
    expect((await connectDraft(readLocalProjects(f.storage)[0], f.api, f.storage)).project.brief.goals).toEqual(['Four occupants']);
    expect(f.created.size).toBe(1);
    expect(f.request.mock.calls.filter(([path]) => path.endsWith('/runs'))).toHaveLength(1);
  });

  it('preserves later browser edits when a lost-reply run already started and keeps both distinct copies accessible', async () => {
    const f = setup(); f.loseRun(true);
    await expect(connectDraft(f.draft, f.api, f.storage)).rejects.toThrow();
    f.draft.project.brief.request += ' Add a balcony.';
    saveLocalSnapshot(f.draft, f.storage);
    f.setReadsOffline(false);
    await expect(connectDraft(f.draft, f.api, f.storage)).rejects.toThrow('Both copies are in Projects');
    expect(readLocalProjects(f.storage)[0].project.brief.request).toContain('balcony');
    const projects = mergeProjects([...f.created.values()].map(snapshot => snapshot.project), [f.draft], f.storage);
    expect(projects).toHaveLength(2);
    expect(projects.find(project => project.id === f.draft.project.id)?.name).toContain('browser edits');
    expect(f.request.mock.calls.filter(([path]) => path.endsWith('/runs'))).toHaveLength(1);
  });

  it('keeps a single recoverable picker entry and preserves the draft when the connected account cannot access its project', async () => {
    const f = setup(); f.setReadsOffline(true);
    await expect(connectDraft(f.draft, f.api, f.storage)).rejects.toThrow('Read unavailable');
    const remote = [...f.created.values()].map(value => value.project);
    expect(mergeProjects(remote, [f.draft], f.storage).map(project => project.id)).toEqual([f.draft.project.id]);
    f.setReadsOffline(false);
    await connectDraft(f.draft, f.api, f.storage);
    expect(mergeProjects(remote, [f.draft], f.storage).map(project => project.id)).toEqual([remote[0].id]);
    expect(mergeProjects([], [f.draft], f.storage).map(project => project.id)).toEqual([f.draft.project.id]);
    const otherAccount = vi.fn().mockRejectedValue(new Error('This project connection belongs to another account.'));
    await expect(connectDraft(f.draft, otherAccount, f.storage)).rejects.toThrow('another account');
    expect(readLocalProjects(f.storage)).toEqual([f.draft]);
  });
});
