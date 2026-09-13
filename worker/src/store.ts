import type { AgentId, Design, Project, Snapshot, StudioEvent, Task, Artifact, ChangeRecord } from '../../shared/design';
import { DesignSchema } from '../../shared/design';
import { buildEffectiveRequirements } from '../../shared/requirements';
import type { ImageStudy, StudioRun } from '../../shared/images';
import type { Bindings, ProjectRow } from './types';
import { HttpError } from './security';
import { getClarification } from './clarifications';
import type { ConversationTurn } from '../../shared/conversation';
export function projectFromRow(row: ProjectRow): Project { return { id: row.id, name: row.name, brief: JSON.parse(row.brief), revision: row.revision, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, selectedConceptId: row.concept_artifact_id ?? null }; }
export async function designFromRow(env: Bindings, row: ProjectRow): Promise<Design | null> {
  if (!row.design_key) return null;
  const object = await env.FILES.get(row.design_key); if (!object) throw new HttpError(503, 'The saved design is temporarily unavailable.');
  return DesignSchema.parse(await object.json());
}
export async function eventsAfter(env: Bindings, projectId: string, after = 0): Promise<StudioEvent[]> {
  const result = await env.DB.prepare('SELECT id, project_id as projectId, type, agent, task_id as taskId, revision, message, created_at as createdAt FROM events WHERE project_id = ? AND id > ? ORDER BY id LIMIT 200').bind(projectId, after).all<StudioEvent>(); return result.results;
}
export async function snapshot(env: Bindings, row: ProjectRow): Promise<Snapshot> {
  const [design, tasks, events, artifacts, images, runs, changes, clarification, messages] = await Promise.all([
    designFromRow(env, row),
    env.DB.prepare('SELECT id, agent, title, status, detail, run_id as runId, kind, objective, dependencies, deliverables, base_revision as baseRevision, artifact_id as artifactId, artifact_revision as artifactRevision FROM tasks WHERE project_id = ? ORDER BY rowid DESC LIMIT 100').bind(row.id).all<Omit<Task, 'dependencies' | 'deliverables'> & { dependencies: string; deliverables: string }>(),
    env.DB.prepare('SELECT id, project_id as projectId, type, agent, task_id as taskId, revision, message, created_at as createdAt FROM (SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT 200) ORDER BY id').bind(row.id).all<StudioEvent>(),
    env.DB.prepare('SELECT id, name, kind, revision, size, created_at as createdAt FROM artifacts WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').bind(row.id).all<Artifact>(),
    env.DB.prepare('SELECT id, name, prompt, model, revision, source_artifact_id as sourceArtifactId, created_at as createdAt, metadata_artifact_id as metadataArtifactId FROM image_studies WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').bind(row.id).all<ImageStudy>(),
    env.DB.prepare('SELECT id, kind, status, resumes_run_id as resumesRunId FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').bind(row.id).all<StudioRun>(),
    env.DB.prepare('SELECT id, instruction, agent, element_id as elementId, base_revision as baseRevision, reference_artifact_id as referenceArtifactId, status, created_at as createdAt, started_at as startedAt, applied_at as appliedAt, applied_revision as appliedRevision, reviewed_at as reviewedAt, reviewed_revision as reviewedRevision, review_summary as reviewSummary, review_findings as reviewFindings, review_artifact_id as reviewArtifactId, failure_detail as failureDetail FROM changes WHERE project_id = ? ORDER BY created_at DESC, rowid DESC').bind(row.id).all<Omit<ChangeRecord, 'reviewFindings'> & { reviewFindings: string }>(),
    getClarification(env, row.id),
    env.DB.prepare("SELECT id, CASE WHEN json_extract(result_json,'$.intent') IN ('brief_update','answer_clarification') THEN 'principal' ELSE json_extract(request_json,'$.agent') END as agent, json_extract(request_json,'$.instruction') as instruction, json_extract(result_json,'$.reply') as reply, json_extract(result_json,'$.intent') as intent, created_at as createdAt FROM (SELECT * FROM conversation_turns WHERE project_id = ? AND result_json IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 100) ORDER BY created_at, id").bind(row.id).all<ConversationTurn>(),
  ]);
  const project = projectFromRow(row), history = changes.results.map(change => ({ ...change, reviewFindings: JSON.parse(change.reviewFindings) }));
  return { project, design, tasks: tasks.results.map(task => ({ ...task, dependencies: JSON.parse(task.dependencies), deliverables: JSON.parse(task.deliverables) })), events: events.results, artifacts: artifacts.results, images: images.results, runs: runs.results.map(({ resumesRunId, ...run }) => resumesRunId ? { ...run, resumesRunId } : run), changes: history, requirements: buildEffectiveRequirements(project.brief, row.revision, history), clarification, messages: messages.results };
}
export async function emit(env: Bindings, projectId: string, type: string, message: string, agent: AgentId | null = null, taskId: string | null = null, operationId: string | null = null) {
  await env.DB.prepare('INSERT OR IGNORE INTO events(project_id,type,agent,task_id,revision,message,created_at,operation_id) SELECT id,?,?,?,?,?,?,? FROM projects WHERE id = ?')
    .bind(type, agent, taskId, (await env.DB.prepare('SELECT revision FROM projects WHERE id = ?').bind(projectId).first<{ revision: number }>())?.revision || 0, message.slice(0, 4000), new Date().toISOString(), operationId, projectId).run();
}
export async function artifact(env: Bindings, projectId: string, runId: string, name: string, kind: string, revision: number, data: string | Uint8Array, mime: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid artifact name');
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const artifactId = `${runId}-${name}`;
  const existing = await env.DB.prepare('SELECT id FROM artifacts WHERE id = ? AND project_id = ?').bind(artifactId, projectId).first();
  if (existing) return artifactId;
  if (bytes.byteLength > 25 * 1024 * 1024) throw new HttpError(413, 'Artifact exceeds the 25 MB beta limit.');
  const total = await env.DB.prepare('SELECT COALESCE(SUM(size),0) as total FROM artifacts WHERE project_id = ?').bind(projectId).first<{ total: number }>();
  if ((total?.total || 0) + bytes.byteLength > 250 * 1024 * 1024) {
    // A concurrent copy may have filled the allowance after our first lookup.
    const saved = await env.DB.prepare('SELECT id FROM artifacts WHERE id = ? AND project_id = ?').bind(artifactId, projectId).first();
    if (saved) return artifactId;
    throw new HttpError(429, 'This project has reached its 250 MB artifact allowance.');
  }
  const key = `${projectId}/runs/${runId}/${crypto.randomUUID()}/${name}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
  // The precheck avoids unnecessary uploads, but only this atomic statement
  // can enforce the allowance when multiple specialists finish together.
  const inserted = await env.DB.prepare('INSERT OR IGNORE INTO artifacts(id,project_id,name,kind,revision,object_key,mime,size,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM artifacts WHERE project_id = ?) + ? <= ?')
    .bind(artifactId, projectId, name, kind, revision, key, mime, bytes.byteLength, new Date().toISOString(), projectId, bytes.byteLength, 250 * 1024 * 1024).run();
  if (inserted.meta.changes) return artifactId;
  // Every upload has a unique key: never delete the object chosen by a
  // concurrent successful writer of the same artifact ID.
  await env.FILES.delete(key);
  const saved = await env.DB.prepare('SELECT id FROM artifacts WHERE id = ? AND project_id = ?').bind(artifactId, projectId).first();
  if (saved) return artifactId;
  throw new HttpError(429, 'This project has reached its 250 MB artifact allowance.');
}
