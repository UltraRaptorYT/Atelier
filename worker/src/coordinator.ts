import { DurableObject } from 'cloudflare:workers';
import { DesignSchema, type AgentId, type Design } from '../../shared/design';
import type { Bindings, ProjectRow, RunParams } from './types';
import { HttpError, credential, ownedProject } from './security';
import { emit } from './store';
import { dispatchPending } from './steering';
import { executeVoiceTool, hangupVoice, LiveResponseTools } from './voice';
import { DesignMergeConflict, mergeDesignProposal } from '../../shared/collaboration';
import { originalConceptId } from './images';
import { changeFailedStatement } from './changes';
export class ProjectCoordinator extends DurableObject<Bindings> {
  private voices = new Map<string, WebSocket>();
  private voiceTargets = new Map<string, { agent: AgentId; elementId: string | null; meeting: boolean }>();
  private closingVoices = new Set<string>();
  async publish(projectId: string, baseRevision: number, operationId: string, design: Design) {
    try { return { ok: true as const, revision: await this.commit(projectId, baseRevision, operationId, design) }; }
    catch (error) {
      return { ok: false as const, status: error instanceof HttpError ? error.status : 500, message: error instanceof HttpError ? error.message : 'The revision could not be saved. The previous design remains available.' };
    }
  }
  async scheduleChanges(projectId: string, owner: string) {
    await this.ctx.storage.put('pending-project', { projectId,owner });
    await this.ctx.storage.setAlarm(Date.now()+1000);
  }
  async attachVoice(projectId: string, owner: string, callId: string, agent: AgentId, elementId: string | null = null, meeting = false) {
    const key = await credential(this.env, owner);
    const response = await fetch(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(callId)}/attach`, {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    const socket = response.webSocket;
    if (!socket) throw new HttpError(502, 'Could not attach server controls to the voice session.');
    socket.accept(); this.voices.set(callId, socket);
    const send = (event: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); };
    const target = { agent, elementId, meeting }; this.voiceTargets.set(callId, target);
    const router = new LiveResponseTools(call => executeVoiceTool(this.env, projectId, owner, callId, target.agent, target.elementId, call, target.meeting), send);
    let pending: { role: 'user' | 'assistant'; text: string; id: string } | null = null;
    let transcriptTimer: ReturnType<typeof setTimeout> | undefined;
    const flushTranscript = async () => {
      clearTimeout(transcriptTimer);
      const chunk = pending; pending = null;
      if (chunk?.text.trim()) await emit(this.env, projectId, chunk.role === 'user' ? 'user_message' : 'agent_message', chunk.text, target.agent, null, `voice-${callId}-${chunk.id}`);
    };
    let processing = Promise.resolve();
    socket.addEventListener('message', event => {
      // Serialize events: finish all function outputs before a single response continuation.
      processing = processing.then(async () => {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (data.type === 'session.input_transcript.delta' || data.type === 'session.output_transcript.delta') {
          if (typeof data.delta !== 'string' || typeof data.event_id !== 'string') return;
          const role = data.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
          if (pending && (pending.role !== role || pending.text.length + data.delta.length > 3500)) await flushTranscript();
          if (!pending) pending = { role, text: '', id: data.event_id };
          pending.text += data.delta;
          clearTimeout(transcriptTimer);
          transcriptTimer = setTimeout(() => this.ctx.waitUntil(flushTranscript()), 1500);
        }
        if (data.type === 'session.closed') { await flushTranscript(); await this.closeVoice(callId); return; }
        if (data.type === 'error') { const problem = data.error as {code?:string;type?:string} | undefined; console.error(JSON.stringify({type:'live_provider_error',code:problem?.code?.slice(0,100),category:problem?.type?.slice(0,100)})); throw new Error('Live provider error'); }
        await router.handle(data);
      }).catch(async () => {
        await emit(this.env, projectId, 'error', 'Live voice lost project controls. Reconnect to continue speaking.', agent);
        await flushTranscript(); await this.closeVoice(callId);
      });
      this.ctx.waitUntil(processing);
    });
    socket.addEventListener('close', () => {
      this.voices.delete(callId);
      this.ctx.waitUntil(processing.then(flushTranscript).then(() => this.closeVoice(callId)));
    });
    socket.addEventListener('error', () => this.ctx.waitUntil(this.closeVoice(callId)));
    await this.ctx.storage.put(`voice-${callId}`, { owner, created: Date.now() });
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm || alarm > Date.now() + 60000) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  async moveVoice(callId: string, owner: string, agent: AgentId, elementId: string | null, meeting: boolean) {
    const session = await this.env.DB.prepare('SELECT id FROM voice_sessions WHERE id = ? AND owner_id = ?').bind(callId, owner).first();
    const socket = this.voices.get(callId), target = this.voiceTargets.get(callId);
    if (!session || !socket || socket.readyState !== WebSocket.OPEN || !target) return { ok: false };
    await this.env.DB.prepare('UPDATE voice_sessions SET agent = ? WHERE id = ? AND owner_id = ?').bind(agent, callId, owner).run();
    Object.assign(target, { agent, elementId, meeting });
    socket.send(JSON.stringify({ type: 'session.instructions.append', delegation_id: null, content: `The user walked to ${meeting ? 'the meeting table. Speak as the Principal facilitating the entire team' : agent + "'s workstation. Speak as that specialist"}. This supersedes the previous speaking role. Read get_project_context before facts or actions. Preserve the existing project. Briefly acknowledge only when the user speaks.` }));
    return { ok: true };
  }
  async closeVoice(callId: string, owner?: string) {
    // Startup rollback can happen before D1 insertion or sideband attachment.
    // Keep enough trusted context to retry hangup even in that partial state.
    if (owner) {
      await this.ctx.storage.put(`voice-${callId}`, { owner, created: 0 });
      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm || alarm > Date.now() + 1000) await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
    if (this.closingVoices.has(callId)) return;
    this.closingVoices.add(callId);
    try { await this.finishVoiceClosure(callId); } finally { this.closingVoices.delete(callId); }
  }
  private async finishVoiceClosure(callId: string) {
    const session = await this.env.DB.prepare('SELECT owner_id FROM voice_sessions WHERE id = ?').bind(callId).first<{owner_id:string}>();
    // Remove local authority before closing the socket, whose close callback can re-enter here.
    await this.env.DB.prepare('DELETE FROM voice_sessions WHERE id = ?').bind(callId).run();
    const socket = this.voices.get(callId); this.voices.delete(callId); this.voiceTargets.delete(callId);
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close();
    if (session) {
      try { await hangupVoice(await credential(this.env, session.owner_id), callId); }
      catch {
        // Keep the durable cleanup record until a later alarm can retry provider hangup.
        await this.ctx.storage.put(`voice-${callId}`, { owner: session.owner_id, created: 0 });
        await this.ctx.storage.setAlarm(Date.now() + 60000);
        return;
      }
    } else {
      const pending = await this.ctx.storage.get<{owner:string}>(`voice-${callId}`);
      if (pending) {
        try { await hangupVoice(await credential(this.env, pending.owner), callId); }
        catch { await this.ctx.storage.setAlarm(Date.now() + 60000); return; }
      }
    }
    await this.ctx.storage.delete(`voice-${callId}`);
  }
  async alarm() {
    const pending = await this.ctx.storage.get<{projectId:string;owner:string}>('pending-project');
    if (pending) {
      try { await dispatchPending(this.env,pending.projectId,pending.owner,p => this.begin(p)); } catch { /* The next alarm retries dispatch, without discarding the change. */ }
      const remaining = await this.env.DB.prepare("SELECT id FROM changes WHERE project_id = ? AND status = 'pending' LIMIT 1").bind(pending.projectId).first();
      if (!remaining) await this.ctx.storage.delete('pending-project');
    }
    const sessions = await this.ctx.storage.list<{owner:string; created:number}>({ prefix: 'voice-' });
    for (const [id, session] of sessions) if (Date.now()-session.created > 15*60000 || !this.voices.has(id.slice(6))) await this.closeVoice(id.slice(6));
    if ((await this.ctx.storage.list({ prefix: 'voice-' })).size || await this.ctx.storage.get('pending-project')) await this.ctx.storage.setAlarm(Date.now()+60000);
  }
  async commitProposal(projectId: string, baseRevision: number, operationId: string, proposal: Design, runId: string, agent: AgentId): Promise<{ revision: number | null; conflicts: string[] }> {
    const saved = await this.env.DB.prepare('SELECT revision FROM revisions WHERE project_id = ? AND operation_id = ?').bind(projectId, operationId).first<{ revision: number }>();
    if (saved) return { revision: saved.revision, conflicts: [] };
    const run = await this.env.DB.prepare('SELECT status FROM runs WHERE id = ? AND project_id = ?').bind(runId, projectId).first<{ status: string }>();
    if (run?.status !== 'in_progress') throw new HttpError(409, 'The run stopped before this proposal could be published.');
    let base: Design | null = null;
    if (baseRevision) {
      const previous = await this.env.DB.prepare('SELECT artifact_key FROM revisions WHERE project_id = ? AND revision = ?').bind(projectId, baseRevision).first<{ artifact_key: string }>();
      const object = previous && await this.env.FILES.get(previous.artifact_key);
      if (!object) throw new HttpError(409, 'The task’s starting design revision is unavailable.');
      base = DesignSchema.parse(await object.json());
    }
    // Proposals may have been produced concurrently. Merge against the saved
    // common ancestor, then retain the existing atomic revision/cancellation fence.
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>();
      if (!row || row.revision < baseRevision) throw new HttpError(409, 'The task’s starting revision is invalid.');
      const object = row.design_key && await this.env.FILES.get(row.design_key);
      if (row.design_key && !object) throw new HttpError(503, 'The current saved design is unavailable.');
      const latest = object ? DesignSchema.parse(await object.json()) : null;
      let merged: Design;
      try { merged = mergeDesignProposal(base, latest, proposal, agent); }
      catch (error) { if (error instanceof DesignMergeConflict) return { revision: null, conflicts: error.paths }; throw error; }
      try { return { revision: await this.commit(projectId, row.revision, operationId, merged, runId, agent), conflicts: [] }; }
      catch (error) { if (!(error instanceof HttpError) || error.status !== 409 || attempt === 2) throw error; }
    }
    throw new HttpError(409, 'The design is changing. Reconcile the saved proposals before continuing.');
  }
  async commit(projectId: string, baseRevision: number, operationId: string, design: Design, runId?: string, agent: AgentId = 'architect'): Promise<number> {
    const duplicate = await this.env.DB.prepare('SELECT project_id, revision FROM revisions WHERE operation_id = ?').bind(operationId).first<{ project_id: string; revision: number }>();
    if (duplicate) { if (duplicate.project_id !== projectId) throw new HttpError(409, 'Operation belongs to another project.'); return duplicate.revision; }
    if (baseRevision>=100) throw new HttpError(429,'This project has reached its 100-revision beta storage allowance. Saved revisions remain available.');
    const current=await this.env.DB.prepare('SELECT revision FROM projects WHERE id = ?').bind(projectId).first<{revision:number}>();
    if(!current || current.revision!==baseRevision) {
      const retried=await this.env.DB.prepare('SELECT revision FROM revisions WHERE project_id = ? AND operation_id = ?').bind(projectId,operationId).first<{revision:number}>();
      if(retried)return retried.revision;
      throw new HttpError(409,'The design changed. Refresh and reconcile your edit against the current revision.');
    }
    const validated = DesignSchema.parse(design), revision = baseRevision + 1;
    for(const asset of validated.assets){
      const stored=await this.env.DB.prepare("SELECT object_key FROM artifacts WHERE id = ? AND project_id = ? AND kind = 'model-asset'").bind(asset.artifactId,projectId).first<{object_key:string}>();
      if(!stored || !await this.env.FILES.head(stored.object_key)) throw new HttpError(409,'A geometry asset must be uploaded to this project before committing its design.');
    }
    // Unique immutable object name: racing proposals never overwrite one another.
    const key = `${projectId}/revisions/${revision}-${operationId}-${crypto.randomUUID()}/design.json`;
    await this.env.FILES.put(key, JSON.stringify(validated), { httpMetadata: { contentType: 'application/json' } });
    const now = new Date().toISOString();
    const result = await this.env.DB.batch([
      this.env.DB.prepare("INSERT OR IGNORE INTO revisions(project_id,revision,artifact_key,operation_id,created_at) SELECT id,?,?,?,? FROM projects WHERE id = ? AND revision = ? AND (? IS NULL OR EXISTS (SELECT 1 FROM runs WHERE id = ? AND project_id = projects.id AND status = 'in_progress'))").bind(revision, key, operationId, now, projectId, baseRevision, runId || null, runId || null),
      this.env.DB.prepare('UPDATE projects SET revision = ?, design_key = ?, status = ?, updated_at = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM revisions WHERE operation_id = ?)').bind(revision, key, 'review', now, projectId, baseRevision, operationId),
      this.env.DB.prepare("INSERT OR IGNORE INTO events(project_id,type,agent,revision,message,created_at,operation_id) SELECT project_id,'artifact_updated',?,revision,?,?,? FROM revisions WHERE operation_id = ?").bind(agent, `Design revision ${revision} saved.`, now, `commit-${operationId}`, operationId),
    ]);
    if (!result[0].meta.changes) {
      const saved = await this.env.DB.prepare('SELECT revision FROM revisions WHERE project_id = ? AND operation_id = ?').bind(projectId, operationId).first<{revision:number}>();
      if (saved) return saved.revision;
      throw new HttpError(409, 'Design changed while this task was working, or the run was cancelled. Reconcile against the latest revision.');
    }
    return revision;
  }
  async begin(params: RunParams) {
    const existing = await this.env.DB.prepare('SELECT project_id, owner_id, status, kind, base_revision, instruction, reference_artifact_id FROM runs WHERE id = ?').bind(params.runId).first<{ project_id: string; owner_id: string; status: string; kind: string; base_revision: number; instruction: string | null; reference_artifact_id: string | null }>();
    if (existing) {
      if (existing.project_id !== params.projectId || existing.owner_id !== params.userId) throw new HttpError(409, 'Operation ID already used.');
      if (existing.status === 'failed' || existing.status === 'cancelled') throw new HttpError(409, `This request already ${existing.status === 'failed' ? 'failed' : 'was cancelled'}. Start a new request to try again.`);
      if (existing.kind !== params.kind || existing.base_revision !== params.baseRevision || existing.instruction !== (params.instruction || null) || (params.kind !== 'generate' && existing.reference_artifact_id !== (params.referenceArtifactId || null))) throw new HttpError(409, 'Operation ID already used for a different request.');
      return { runId: params.runId };
    }
    const row = await this.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').bind(params.projectId, params.userId).first<ProjectRow>();
    if (!row) throw new HttpError(404, 'Project not found.');
    if (row.revision !== params.baseRevision) throw new HttpError(409, 'Refresh the project before starting work on a previous revision.');
    const selected = params.kind === 'generate' && row.concept_artifact_id ? await this.env.DB.prepare('SELECT id FROM image_studies WHERE id = ? AND project_id = ? AND revision = ?').bind(row.concept_artifact_id, params.projectId, params.baseRevision).first<{id:string}>() : null;
    const referenceArtifactId = params.referenceArtifactId || (params.kind === 'generate' ? selected?.id || null : null);
    const contextArtifactId = !referenceArtifactId && (params.kind === 'generate' || params.kind === 'change')
      ? await originalConceptId(this.env, params.projectId, row.concept_artifact_id) : null;
    // Persist the selected background concept at run creation. A later selection
    // cannot retarget an accepted run or its replayed Workflow checkpoints.
    const frozen = { ...params, referenceArtifactId, contextArtifactId };
    try {
      await this.env.DB.prepare('INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,instruction,agent,element_id,reference_artifact_id,context_artifact_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(params.runId, params.projectId, params.userId, params.kind, 'queued', params.baseRevision, params.instruction || null, params.agent || 'principal', params.elementId || null, frozen.referenceArtifactId, frozen.contextArtifactId, new Date().toISOString()).run();
    } catch { throw new HttpError(409, 'You already have an active run. Stop it before starting another.'); }
    try { await this.env.JOBS.create({ id: params.runId, params: frozen }); }
    catch {
      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE runs SET status = 'failed' WHERE id = ? AND project_id = ? AND owner_id = ? AND status = 'queued'").bind(params.runId, params.projectId, params.userId),
        changeFailedStatement(this.env, params, 'failed', 'The job could not be queued. Retry with a new request.'),
      ]);
      throw new HttpError(503, 'The job could not be queued. Retry with a new request.');
    }
    await emit(this.env, params.projectId, 'task_created', `${params.kind === 'image' ? 'Visual concept' : params.kind === 'render' ? 'Presentation render' : 'Design work'} queued.`, params.agent || 'principal');
    return { runId: params.runId };
  }
}
