import { type Change } from '../../shared/design';
import type { Bindings, RunParams } from './types';
import { ownedProject, HttpError } from './security';
import { emit } from './store';
import { loadImageReference } from './images';
export async function queueChange(env: Bindings, projectId: string, owner: string, change: Change) {
  const project = await ownedProject(env, projectId, owner);
  const duplicate = await env.DB.prepare('SELECT project_id,status,instruction,agent,element_id,base_revision,reference_artifact_id FROM changes WHERE id = ?').bind(change.operationId).first<{project_id:string;status:string;instruction:string;agent:string;element_id:string|null;base_revision:number;reference_artifact_id:string|null}>();
  if (duplicate) {
    if (duplicate.project_id !== projectId) throw new HttpError(409, 'Operation already used.');
    if (duplicate.status === 'failed' || duplicate.status === 'cancelled') throw new HttpError(409, 'This change stopped before completion. Send a new request to try again.');
    if (duplicate.instruction !== change.instruction || duplicate.agent !== change.agent || duplicate.element_id !== change.elementId || duplicate.base_revision !== change.baseRevision || duplicate.reference_artifact_id !== (change.referenceArtifactId || null)) throw new HttpError(409, 'Operation already used for a different change.');
    if (duplicate.status === 'pending') await env.PROJECTS.getByName(projectId).scheduleChanges(projectId, owner);
    return { queued: true, operationId: change.operationId };
  }
  if (change.baseRevision !== project.revision) throw new HttpError(409, 'The design changed. Refresh it and send your change against the current revision.');
  if (change.referenceArtifactId) await loadImageReference(env, projectId, change.referenceArtifactId, change.baseRevision);
  await env.DB.prepare('INSERT INTO changes(id,project_id,agent,instruction,element_id,base_revision,reference_artifact_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(change.operationId, projectId, change.agent, change.instruction, change.elementId, change.baseRevision, change.referenceArtifactId || null, 'pending', new Date().toISOString()).run();
  await emit(env, projectId, 'change_requested', change.instruction, change.agent, null, `request-${change.operationId}`);
  await env.PROJECTS.getByName(projectId).scheduleChanges(projectId,owner);
  await emit(env, projectId, 'agent_message', 'Your change is saved and will be applied after the current work reaches a safe checkpoint.', change.agent);
  return { queued: true, operationId: change.operationId };
}
type PendingChange = { id: string; agent: Change['agent']; instruction: string; element_id: string | null; base_revision: number; reference_artifact_id: string | null };
async function reconcileRun(env: Bindings, change: PendingChange): Promise<boolean> {
  const existing = await env.DB.prepare('SELECT status FROM runs WHERE id = ?').bind(change.id).first<{status:string}>();
  if (!existing) return false;
  const status = existing.status === 'completed' ? 'applied' : ['failed', 'cancelled'].includes(existing.status) ? existing.status : 'in_progress';
  await env.DB.prepare("UPDATE changes SET status = ? WHERE id = ? AND status = 'pending'").bind(status, change.id).run();
  return true;
}
export async function dispatchPending(env: Bindings, projectId: string, owner: string, begin: (p:RunParams) => Promise<{runId:string}> = p => env.PROJECTS.getByName(projectId).begin(p)) {
  if (String(env.GENERATION_ENABLED) !== 'true') return;
  const change = await env.DB.prepare("SELECT * FROM changes WHERE project_id = ? AND status = 'pending' ORDER BY created_at LIMIT 1").bind(projectId).first<PendingChange>();
  if (!change || await reconcileRun(env, change)) return;
  const active = await env.DB.prepare("SELECT id FROM runs WHERE owner_id = ? AND status IN ('queued','in_progress')").bind(owner).first();
  if (active) return;
  const project = await ownedProject(env,projectId,owner);
  if (change.reference_artifact_id && change.base_revision !== project.revision) {
    await env.DB.prepare("UPDATE changes SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(change.id).run();
    await emit(env, projectId, 'error', 'The design advanced before this visual change could start. Generate a concept for the current revision and choose its direction again.', change.agent, null, `stale-reference-${change.id}`);
    return;
  }
  try {
    await begin({ projectId,userId:owner,runId:change.id,kind:'change',baseRevision:project.revision,instruction:change.instruction,agent:change.agent,elementId:change.element_id,referenceArtifactId:change.reference_artifact_id });
    await env.DB.prepare("UPDATE changes SET status = 'in_progress' WHERE id = ? AND status = 'pending'").bind(change.id).run();
  } catch (error) {
    if (await reconcileRun(env, change)) {
      await emit(env, projectId, 'error', 'This change could not start. Check Activity and send a new request if it failed.', change.agent, null, `dispatch-failed-${change.id}`);
      return;
    }
    if (!(error instanceof HttpError) || error.status !== 409) throw error;
    // A competing active run can win the unique owner lock. Keep this change queued.
  }
}
