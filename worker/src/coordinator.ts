import { DurableObject } from 'cloudflare:workers';
import { DesignSchema, ChangeSchema, type AgentId, type Design } from '../../shared/design';
import type { Bindings, ProjectRow, RunParams } from './types';
import { HttpError, credential, ownedProject } from './security';
import { emit } from './store';
import { queueChange, dispatchPending } from './steering';
export class ProjectCoordinator extends DurableObject<Bindings> {
  private voices = new Map<string, WebSocket>();
  async scheduleChanges(projectId: string, owner: string) {
    await this.ctx.storage.put('pending-project', { projectId,owner });
    await this.ctx.storage.setAlarm(Date.now()+1000);
  }
  async attachVoice(projectId: string, owner: string, callId: string, agent: AgentId) {
    const key = await credential(this.env, owner);
    const response = await fetch(`https://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, { headers: { Upgrade: 'websocket', Authorization: `Bearer ${key}` } });
    const socket = response.webSocket;
    if (!socket) throw new HttpError(502, 'Could not attach server controls to the voice session.');
    socket.accept(); this.voices.set(callId, socket);
    socket.addEventListener('message', event => {
      this.ctx.waitUntil((async () => {
        const data = JSON.parse(String(event.data));
        if (data.type === 'conversation.item.input_audio_transcription.completed') await emit(this.env, projectId, 'user_message', String(data.transcript).slice(0,4000), agent, null, `voice-${data.item_id}`);
        if (data.type !== 'response.function_call_arguments.done') return;
        const persisted = await this.env.DB.prepare('SELECT id FROM voice_sessions WHERE id = ? AND owner_id = ?').bind(callId, owner).first(); if (!persisted) return;
        const project = await ownedProject(this.env, projectId, owner);
        let result: unknown;
        try {
          if (String(this.env.GENERATION_ENABLED) !== 'true') throw new Error('Generation is paused.');
          const args = JSON.parse(data.arguments);
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${callId}-${data.call_id}`));
          const bytes = new Uint8Array(digest).slice(0,16); bytes[6] = (bytes[6]&15)|64; bytes[8] = (bytes[8]&63)|128;
          const hex = Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
          const operationId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
          if (data.name === 'request_change') result = await queueChange(this.env, projectId, owner, ChangeSchema.parse({ instruction: args.instruction, elementId: args.elementId || null, agent, baseRevision: project.revision, operationId }));
          else if (data.name === 'save_brief') {
            const active = await this.env.DB.prepare("SELECT id FROM runs WHERE project_id = ? AND status IN ('queued','in_progress')").bind(projectId).first();
            if (active) throw new Error('Use a change request while a run is active.');
            if (typeof args.brief !== 'string' || args.brief.length < 10 || args.brief.length > 8000) throw new Error('Brief must be 10–8000 characters.');
            const brief = { request: args.brief, summary: args.brief, goals: [], constraints: [], questions: [] };
            await this.env.DB.prepare('UPDATE projects SET brief = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(brief),new Date().toISOString(),projectId).run();
            await emit(this.env, projectId, 'clarification_received', 'Your spoken brief has been saved. Start team briefing to begin design work.', agent, null, operationId);
            result = { saved: true, next: 'Use Start team briefing to start generation.' };
          } else result = { error: 'Unknown tool.' };
        } catch { result = { error: 'This action could not be applied. Use the project panel to review and retry.' }; }
        if (socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: data.call_id, output: JSON.stringify(result) } })); socket.send(JSON.stringify({ type: 'response.create' })); }
      })().catch(() => {}));
    });
    socket.addEventListener('close', () => this.voices.delete(callId));
    await this.ctx.storage.put(`voice-${callId}`, { owner, created: Date.now() });
    await this.ctx.storage.setAlarm(Date.now()+60000);
  }
  async closeVoice(callId: string) {
    const session = await this.env.DB.prepare('SELECT owner_id FROM voice_sessions WHERE id = ?').bind(callId).first<{owner_id:string}>();
    if (session) {
      try { const key = await credential(this.env, session.owner_id); const response = await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, { method: 'POST', headers: { Authorization: `Bearer ${key}` } }); await response.body?.cancel(); } catch { /* Browser closure also stops media. */ }
      await this.env.DB.prepare('DELETE FROM voice_sessions WHERE id = ?').bind(callId).run();
    }
    this.voices.get(callId)?.close(); this.voices.delete(callId); await this.ctx.storage.delete(`voice-${callId}`);
  }
  async alarm() {
    const pending = await this.ctx.storage.get<{projectId:string;owner:string}>('pending-project');
    if (pending) {
      try { await dispatchPending(this.env,pending.projectId,pending.owner,p => this.begin(p)); } catch { /* The next alarm retries dispatch, without discarding the change. */ }
      const remaining = await this.env.DB.prepare("SELECT id FROM changes WHERE project_id = ? AND status = 'pending' LIMIT 1").bind(pending.projectId).first();
      if (!remaining) await this.ctx.storage.delete('pending-project');
    }
    const sessions = await this.ctx.storage.list<{owner:string; created:number}>({ prefix: 'voice-' });
    for (const [id, session] of sessions) if (Date.now()-session.created > 15*60000) await this.closeVoice(id.slice(6));
    if ((await this.ctx.storage.list({ prefix: 'voice-' })).size || await this.ctx.storage.get('pending-project')) await this.ctx.storage.setAlarm(Date.now()+60000);
  }
  async commit(projectId: string, baseRevision: number, operationId: string, design: Design, runId?: string): Promise<number> {
    const duplicate = await this.env.DB.prepare('SELECT project_id, revision FROM revisions WHERE operation_id = ?').bind(operationId).first<{ project_id: string; revision: number }>();
    if (duplicate) { if (duplicate.project_id !== projectId) throw new HttpError(409, 'Operation belongs to another project.'); return duplicate.revision; }
    const validated = DesignSchema.parse(design), revision = baseRevision + 1;
    // Unique immutable object name: racing proposals never overwrite one another.
    const key = `${projectId}/revisions/${revision}-${operationId}-${crypto.randomUUID()}/design.json`;
    await this.env.FILES.put(key, JSON.stringify(validated), { httpMetadata: { contentType: 'application/json' } });
    const now = new Date().toISOString();
    const result = await this.env.DB.batch([
      this.env.DB.prepare("INSERT OR IGNORE INTO revisions(project_id,revision,artifact_key,operation_id,created_at) SELECT id,?,?,?,? FROM projects WHERE id = ? AND revision = ? AND (? IS NULL OR EXISTS (SELECT 1 FROM runs WHERE id = ? AND project_id = projects.id AND status = 'in_progress'))").bind(revision, key, operationId, now, projectId, baseRevision, runId || null, runId || null),
      this.env.DB.prepare('UPDATE projects SET revision = ?, design_key = ?, status = ?, updated_at = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM revisions WHERE operation_id = ?)').bind(revision, key, 'review', now, projectId, baseRevision, operationId),
      this.env.DB.prepare("INSERT OR IGNORE INTO events(project_id,type,agent,revision,message,created_at,operation_id) SELECT project_id,'artifact_updated','architect',revision,?,?,? FROM revisions WHERE operation_id = ?").bind(`Design revision ${revision} saved.`, now, `commit-${operationId}`, operationId),
    ]);
    if (!result[0].meta.changes) {
      const saved = await this.env.DB.prepare('SELECT revision FROM revisions WHERE project_id = ? AND operation_id = ?').bind(projectId, operationId).first<{revision:number}>();
      if (saved) return saved.revision;
      throw new HttpError(409, 'Design changed while this task was working, or the run was cancelled. Reconcile against the latest revision.');
    }
    return revision;
  }
  async begin(params: RunParams) {
    const existing = await this.env.DB.prepare('SELECT project_id, owner_id FROM runs WHERE id = ?').bind(params.runId).first<{ project_id: string; owner_id: string }>();
    if (existing) { if (existing.project_id !== params.projectId || existing.owner_id !== params.userId) throw new HttpError(409, 'Operation ID already used.'); return { runId: params.runId }; }
    const row = await this.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').bind(params.projectId, params.userId).first<ProjectRow>();
    if (!row) throw new HttpError(404, 'Project not found.');
    if (row.revision !== params.baseRevision) throw new HttpError(409, 'Refresh the project before starting work on a previous revision.');
    try {
      await this.env.DB.prepare('INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,instruction,agent,element_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(params.runId, params.projectId, params.userId, params.kind, 'queued', params.baseRevision, params.instruction || null, params.agent || 'principal', params.elementId || null, new Date().toISOString()).run();
    } catch { throw new HttpError(409, 'You already have an active run. Stop it before starting another.'); }
    try { await this.env.JOBS.create({ id: params.runId, params }); }
    catch { await this.env.DB.prepare("UPDATE runs SET status = 'failed' WHERE id = ?").bind(params.runId).run(); throw new HttpError(503, 'The job could not be queued. Retry with a new request.'); }
    await emit(this.env, params.projectId, 'task_created', `${params.kind === 'render' ? 'Presentation render' : 'Design work'} queued.`, params.agent || 'principal');
    return { runId: params.runId };
  }
}
