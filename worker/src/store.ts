import type { AgentId, Design, Project, Snapshot, StudioEvent, Task, Artifact } from '../../shared/design';
import { DesignSchema } from '../../shared/design';
import type { Bindings, ProjectRow } from './types';
import { HttpError } from './security';
export function projectFromRow(row: ProjectRow): Project { return { id: row.id, name: row.name, brief: JSON.parse(row.brief), revision: row.revision, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }
export async function designFromRow(env: Bindings, row: ProjectRow): Promise<Design | null> {
  if (!row.design_key) return null;
  const object = await env.FILES.get(row.design_key); if (!object) throw new HttpError(503, 'The saved design is temporarily unavailable.');
  return DesignSchema.parse(await object.json());
}
export async function eventsAfter(env: Bindings, projectId: string, after = 0): Promise<StudioEvent[]> {
  const result = await env.DB.prepare('SELECT id, project_id as projectId, type, agent, task_id as taskId, revision, message, created_at as createdAt FROM events WHERE project_id = ? AND id > ? ORDER BY id LIMIT 200').bind(projectId, after).all<StudioEvent>(); return result.results;
}
export async function snapshot(env: Bindings, row: ProjectRow): Promise<Snapshot> {
  const [design, tasks, events, artifacts] = await Promise.all([
    designFromRow(env, row),
    env.DB.prepare('SELECT id, agent, title, status, detail, run_id as runId FROM tasks WHERE project_id = ? ORDER BY rowid DESC LIMIT 100').bind(row.id).all<Task>(),
    env.DB.prepare('SELECT id, project_id as projectId, type, agent, task_id as taskId, revision, message, created_at as createdAt FROM (SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT 200) ORDER BY id').bind(row.id).all<StudioEvent>(),
    env.DB.prepare('SELECT id, name, kind, revision, size, created_at as createdAt FROM artifacts WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').bind(row.id).all<Artifact>(),
  ]);
  return { project: projectFromRow(row), design, tasks: tasks.results, events: events.results, artifacts: artifacts.results };
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
  if ((total?.total || 0) + bytes.byteLength > 250 * 1024 * 1024) throw new HttpError(429, 'This project has reached its 250 MB artifact allowance.');
  const key = `${projectId}/runs/${runId}/${crypto.randomUUID()}/${name}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
  await env.DB.prepare('INSERT OR IGNORE INTO artifacts(id,project_id,name,kind,revision,object_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(artifactId, projectId, name, kind, revision, key, mime, bytes.length, new Date().toISOString()).run();
  return artifactId;
}
