import { type Change } from '../../shared/design';
import type { Bindings, RunParams } from './types';
import { ownedProject, HttpError } from './security';
import { emit } from './store';
export async function queueChange(env: Bindings, projectId: string, owner: string, change: Change) {
  const project = await ownedProject(env, projectId, owner);
  const duplicate = await env.DB.prepare('SELECT project_id FROM changes WHERE id = ?').bind(change.operationId).first<{project_id:string}>();
  if (duplicate) { if (duplicate.project_id !== projectId) throw new Error('Operation already used.'); return { queued: true, operationId: change.operationId }; }
  if (change.baseRevision !== project.revision) throw new HttpError(409, 'The design changed. Refresh it and send your change against the current revision.');
  await env.DB.prepare('INSERT INTO changes(id,project_id,agent,instruction,element_id,base_revision,status,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(change.operationId, projectId, change.agent, change.instruction, change.elementId, change.baseRevision, 'pending', new Date().toISOString()).run();
  await emit(env, projectId, 'change_requested', change.instruction, change.agent, null, `request-${change.operationId}`);
  await env.PROJECTS.getByName(projectId).scheduleChanges(projectId,owner);
  await emit(env, projectId, 'agent_message', 'Your change is saved and will be applied after the current work reaches a safe checkpoint.', change.agent);
  return { queued: true, operationId: change.operationId };
}
export async function dispatchPending(env: Bindings, projectId: string, owner: string, begin: (p:RunParams) => Promise<{runId:string}> = p => env.PROJECTS.getByName(projectId).begin(p)) {
  if (String(env.GENERATION_ENABLED) !== 'true') return;
  const active = await env.DB.prepare("SELECT id FROM runs WHERE owner_id = ? AND status IN ('queued','in_progress')").bind(owner).first();
  if (active) return;
  const change = await env.DB.prepare("SELECT * FROM changes WHERE project_id = ? AND status = 'pending' ORDER BY created_at LIMIT 1").bind(projectId).first<{id:string; agent:Change['agent']; instruction:string; element_id:string|null}>();
  if (!change) return;
  const project = await ownedProject(env,projectId,owner);
  try {
    await begin({ projectId,userId:owner,runId:change.id,kind:'change',baseRevision:project.revision,instruction:change.instruction,agent:change.agent,elementId:change.element_id });
    await env.DB.prepare("UPDATE changes SET status = 'in_progress' WHERE id = ? AND status = 'pending'").bind(change.id).run();
  } catch (error) { if (!(error instanceof HttpError) || error.status !== 409) throw error; }
}
