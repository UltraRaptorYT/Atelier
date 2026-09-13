import { z, ZodError } from 'zod';
import { BriefSchema, AgentIdSchema, recolor } from '../../shared/design';
import { credential, encryptCredential, userId, ownedProject, bodyJSON, HttpError } from './security';
import { designFromRow, eventsAfter, projectFromRow, snapshot, emit } from './store';
import { queueChange } from './steering';
import { changeFailedStatement } from './changes';
import { handleInteraction } from './conversation';
import { InteractionRequestSchema } from '../../shared/conversation';
import { cancelClarification, replaceBrief } from './clarifications';
import { startVoice } from './voice';
import { CaptureRequestSchema, ConceptRequestSchema, ImageRequestSchema } from '../../shared/images';
import { loadImageReference, saveCapture, selectConcept } from './images';
import type { Bindings, ProjectRow, RunParams } from './types';
import { runtimeProfile } from './runtime-profile';
export { ProjectCoordinator } from './coordinator';
export { ComputeBudget } from './budget';
export { DesignWorkflow } from './workflow';
const CreateSchema = z.object({ name: z.string().trim().min(1).max(120), brief: BriefSchema, operationId: z.string().uuid().optional() });
const RunSchema = z.object({ operationId: z.string().uuid(), kind: z.enum(['generate','render']), baseRevision: z.number().int().min(0) });
function enabled(env: Bindings, render = false) {
  if (String(env.GENERATION_ENABLED) !== 'true') throw new HttpError(503, 'Live generation is paused until the deployment checks pass.');
  if (render && String(env.RENDER_ENABLED) !== 'true') throw new HttpError(503, 'Public rendering is disabled until the Blender benchmark passes.');
}
async function beginRun(env: Bindings, params: RunParams) {
  const previous = await env.DB.prepare('SELECT project_id,owner_id,status FROM runs WHERE id = ?').bind(params.runId).first<{project_id:string;owner_id:string;status:string}>();
  if (previous) {
    if (previous.project_id !== params.projectId || previous.owner_id !== params.userId) throw new HttpError(409, 'Operation ID already used.');
    if (previous.status === 'failed' || previous.status === 'cancelled') throw new HttpError(409, `This request ${previous.status === 'failed' ? 'failed' : 'was cancelled'}. Start a new request to try again.`);
  }
  try {
    const result = await env.PROJECTS.getByName(params.projectId).requestRun(params);
    if (!result.ok) throw new HttpError(result.status, result.message);
    return { runId: result.runId };
  }
  catch (error) {
    if (error instanceof HttpError) throw error;
    // Durable Object RPC does not retain a custom Error prototype or status.
    // Re-read authoritative state instead of exposing an arbitrary RPC message.
    const run = await env.DB.prepare('SELECT status FROM runs WHERE id = ? AND project_id = ?').bind(params.runId, params.projectId).first<{status:string}>();
    if (run?.status === 'failed') throw new HttpError(503, 'The job could not be queued. Start a new request to try again.');
    if (run?.status === 'cancelled') throw new HttpError(409, 'This request was cancelled. Start a new request to try again.');
    if (run) throw new HttpError(409, 'This operation is already saved. Refresh Activity before starting another request.');
    const active = await env.DB.prepare("SELECT id FROM runs WHERE owner_id = ? AND status IN ('queued','in_progress')").bind(params.userId).first();
    if (active) throw new HttpError(409, 'You already have an active run. Stop it or wait for it to finish before starting another.');
    const project = await ownedProject(env, params.projectId, params.userId);
    if (project.revision !== params.baseRevision) throw new HttpError(409, 'The design changed. Refresh before starting work from this revision.');
    throw new HttpError(502, 'The job could not be queued. Refresh Activity before trying again.');
  }
}
async function route(request: Request, env: Bindings): Promise<Response> {
  const path = new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent), method = request.method;
  if (path[0] === 'health') return Response.json({ service: 'atelier', status: 'ok', generation: String(env.GENERATION_ENABLED) === 'true', render: String(env.RENDER_ENABLED) === 'true', imageGeneration: String(env.IMAGE_GENERATION_ENABLED) === 'true', runtimeProfile: await runtimeProfile(env) });
  const owner = await userId(request, env);
  const allowance = env.API_LIMIT ? await env.API_LIMIT.limit({ key: owner }) : { success: true };
  if (!allowance.success) throw new HttpError(429, 'Too many requests. Wait a minute and retry.');
  if (path[0] === 'capabilities') {
    const key = await env.DB.prepare('SELECT owner_id FROM credentials WHERE owner_id = ?').bind(owner).first();
    const profile = await runtimeProfile(env);
    return Response.json({ configured: true, generation: String(env.GENERATION_ENABLED) === 'true', render: String(env.RENDER_ENABLED) === 'true', local: env.ENVIRONMENT === 'local', keyConnected: Boolean(key || env.OPENAI_API_KEY?.trim()), keySource: key ? 'saved' : env.OPENAI_API_KEY?.trim() ? 'environment' : 'none', voice: String(env.VOICE_ENABLED) === 'true', voiceModel: profile.models.voice, images: String(env.IMAGE_GENERATION_ENABLED) === 'true', imageModel: profile.models.conceptImage, imageEditModel: profile.models.imageEdit, runtimeProfile: profile });
  }
  if (path[0] === 'credentials') {
    if (method === 'DELETE') {
      const sessions=await env.DB.prepare('SELECT id,project_id FROM voice_sessions WHERE owner_id = ?').bind(owner).all<{id:string;project_id:string}>();
      for(const session of sessions.results) await env.PROJECTS.getByName(session.project_id).closeVoice(session.id);
      await env.DB.prepare('DELETE FROM credentials WHERE owner_id = ?').bind(owner).run(); return Response.json({ removed: true });
    }
    if (method === 'PUT') {
      const { apiKey } = z.object({ apiKey: z.string().trim().min(20).max(512) }).parse(await bodyJSON(request, 2048));
      const check = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) });
      await check.body?.cancel();
      if (!check.ok) throw new HttpError(400, 'OpenAI could not validate this API key. Check its access and billing.');
      await env.DB.prepare('INSERT INTO credentials(owner_id,ciphertext,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at').bind(owner, await encryptCredential(env, owner, apiKey), new Date().toISOString()).run();
      return Response.json({ connected: true });
    }
  }
  if (path[0] !== 'projects') throw new HttpError(404, 'Not found.');
  if (path.length === 1) {
    if (method === 'GET') return Response.json((await env.DB.prepare('SELECT * FROM projects WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100').bind(owner).all<ProjectRow>()).results.map(projectFromRow));
    if (method === 'POST') {
      const data = CreateSchema.parse(await bodyJSON(request));
      const fingerprint = JSON.stringify({ name: data.name, brief: data.brief });
      const replay = async () => {
        if (!data.operationId) return null;
        const saved = await env.DB.prepare('SELECT owner_id,project_id,request_json FROM project_creation_requests WHERE operation_id = ?').bind(data.operationId).first<{owner_id:string;project_id:string;request_json:string}>();
        if (!saved) return null;
        if (saved.owner_id !== owner || saved.request_json !== fingerprint) throw new HttpError(409, 'This project connection belongs to another account or a different brief. Your browser draft is preserved.');
        return projectFromRow(await ownedProject(env, saved.project_id, owner));
      };
      const previous = await replay();
      if (previous) return Response.json(previous);
      const id = data.operationId || crypto.randomUUID(), now = new Date().toISOString();
      // Saving a project is not a compute reservation. Keep API rate limits and
      // generation budgets, but do not block meetings after ten saved briefs.
      const create = env.DB.prepare('INSERT OR IGNORE INTO projects(id,owner_id,name,brief,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, owner, data.name, JSON.stringify(data.brief), now, now);
      const statements = [create];
      // Also repair pre-receipt connections, but only for the same owner and
      // exact unchanged request. Never adopt another account's ID or overwrite
      // a newer brief. The batch makes creation and receipt persistence atomic.
      if (data.operationId) statements.push(env.DB.prepare('INSERT OR IGNORE INTO project_creation_requests(operation_id,owner_id,project_id,request_json,created_at) SELECT ?,owner_id,id,?,? FROM projects WHERE id = ? AND owner_id = ? AND name = ? AND brief = ?').bind(data.operationId, fingerprint, now, id, owner, data.name, JSON.stringify(data.brief)));
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO events(project_id,type,revision,message,created_at,operation_id) SELECT id,'project_created',revision,'Project created. Your brief is ready for the principal.',?,? FROM projects WHERE id = ? AND owner_id = ? AND changes() = 1").bind(now, `project-created-${id}`, id, owner));
      const saved = await env.DB.batch(statements);
      const result = await replay();
      if (!saved[0].meta.changes && !result) throw new HttpError(409, 'This connection cannot be reused for this brief. Open your saved project from Projects to continue. Your browser draft is preserved.');
      return Response.json(result || projectFromRow(await ownedProject(env, id, owner)), { status: saved[0].meta.changes ? 201 : 200 });
    }
  }
  const id = path[1];
  if (path.length === 2 && method === 'DELETE') {
    const project = await env.DB.prepare('SELECT deleted_at FROM projects WHERE id = ? AND owner_id = ?').bind(id, owner).first<{ deleted_at: string | null }>();
    if (!project) throw new HttpError(404, 'Project not found.');
    if (project.deleted_at) return Response.json({ deleted: true, recoverable: true });
    const now = new Date().toISOString();
    const deleted = await env.DB.batch([
      env.DB.prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM runs WHERE project_id = projects.id AND status IN ('queued','in_progress')) AND NOT EXISTS (SELECT 1 FROM desktop_sessions WHERE project_id = projects.id) AND NOT EXISTS (SELECT 1 FROM voice_sessions WHERE project_id = projects.id)")
        .bind(now, now, id, owner),
      env.DB.prepare("UPDATE changes SET status = 'cancelled', failure_detail = 'Project deleted.' WHERE project_id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL)").bind(id, id, owner),
      env.DB.prepare("UPDATE project_clarifications SET status = 'cancelled', detail = 'Project deleted.', updated_at = ? WHERE project_id = ? AND status IN ('awaiting_input','queued') AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL)").bind(now, id, id, owner),
      env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE project_id = ? AND status = 'awaiting_input' AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL)").bind(id, id, owner),
      env.DB.prepare("UPDATE tasks SET status = 'cancelled', detail = 'Project deleted.' WHERE project_id = ? AND status IN ('queued','blocked','review') AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL)").bind(id, id, owner),
    ]);
    if (!deleted[0].meta.changes) {
      const saved = await env.DB.prepare('SELECT deleted_at FROM projects WHERE id = ? AND owner_id = ?').bind(id, owner).first<{ deleted_at: string | null }>();
      if (!saved?.deleted_at) throw new HttpError(409, 'Stop this project’s work and end its live voice call before deleting it. If computers are closing, wait a moment and retry.');
    }
    return Response.json({ deleted: true, recoverable: true });
  }
  const row = await ownedProject(env, id, owner);
  if (path.length === 2 && method === 'GET') return Response.json(await snapshot(env, row));
  if (path[2] === 'material' && method === 'PUT') {
    const data=z.object({elementId:z.string().max(80),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),baseRevision:z.number().int().min(1),operationId:z.string().uuid()}).parse(await bodyJSON(request));
    const current=await designFromRow(env,row); if(!current) throw new HttpError(409,'Generate a design before editing a finish.');
    if(!current.elements.some(e=>e.id===data.elementId)) throw new HttpError(404,'Element not found.');
    const result=await env.PROJECTS.getByName(id).publish(id,data.baseRevision,data.operationId,recolor(current,data.elementId,data.color));
    if(!result.ok) throw new HttpError(result.status,result.message);
    return Response.json({revision:result.revision});
  }
  if (path[2] === 'brief' && method === 'PUT') {
    const data = CreateSchema.parse(await bodyJSON(request));
    return Response.json(await replaceBrief(env, id, owner, data));
  }
  if (path[2] === 'events' && method === 'GET') {
    const url = new URL(request.url); let after = Number(request.headers.get('Last-Event-ID') || url.searchParams.get('after') || 0);
    if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, 'Invalid event cursor.');
    const encoder = new TextEncoder(), deadline = Date.now()+25000; let closed = false;
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode('retry: 2000\n\n'));
          while (!closed && !request.signal.aborted && Date.now() < deadline) {
            const events = await eventsAfter(env, id, after);
            for (const event of events) { if (closed) break; controller.enqueue(encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)); after = event.id; }
            if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n'));
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        } catch { /* Reconnect from the persisted cursor. */ }
        finally { if (!closed) { closed = true; controller.close(); } }
      }, cancel() { closed = true; },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store' } });
  }
  if (path[2] === 'revisions' && method === 'GET') {
    const revision = Number(path[3]); if (!Number.isSafeInteger(revision) || revision < 1) throw new HttpError(400, 'Invalid revision.');
    const rev = await env.DB.prepare('SELECT artifact_key FROM revisions WHERE project_id = ? AND revision = ?').bind(id, revision).first<{ artifact_key: string }>();
    if (!rev) throw new HttpError(404, 'Revision not found.'); const object = await env.FILES.get(rev.artifact_key); if (!object) throw new HttpError(404, 'Revision unavailable.');
    return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
  }
  if (path[2] === 'artifacts' && method === 'GET') {
    const a = await env.DB.prepare('SELECT object_key,mime,name FROM artifacts WHERE project_id = ? AND id = ?').bind(id, path[3]).first<{ object_key: string; mime: string; name: string }>();
    if (!a) throw new HttpError(404, 'Artifact not found.'); const object = await env.FILES.get(a.object_key); if (!object) throw new HttpError(404, 'Artifact unavailable.');
    const inline = new URL(request.url).searchParams.get('inline') === '1' && ['image/png', 'image/jpeg', 'image/webp'].includes(a.mime);
    return new Response(object.body, { headers: { 'Content-Type': a.mime, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}"` } });
  }
  if (path[2] === 'captures' && method === 'POST') {
    const data = CaptureRequestSchema.parse(await bodyJSON(request, 12 * 1024 * 1024));
    if (!row.design_key) throw new HttpError(409, 'Generate a design before capturing a model view.');
    if (data.baseRevision !== row.revision) throw new HttpError(409, 'The design changed. Refresh the model before capturing its view.');
    return Response.json({ artifactId: await saveCapture(env, row, data.operationId, data.dataUrl) }, { status: 201 });
  }
  if (path[2] === 'images' && method === 'POST') {
    const data = ImageRequestSchema.parse(await bodyJSON(request));
    if (String(env.IMAGE_GENERATION_ENABLED) !== 'true') throw new HttpError(503, 'Image generation is disabled for this studio.');
    await credential(env, owner);
    if (data.baseRevision !== row.revision) throw new HttpError(409, 'The design changed. Refresh before generating a concept for this revision.');
    if (data.sourceArtifactId) await loadImageReference(env, id, data.sourceArtifactId, row.revision);
    return Response.json(await beginRun(env, { projectId: id, userId: owner, runId: data.operationId, kind: 'image', baseRevision: data.baseRevision, instruction: data.instruction, agent: 'designer', referenceArtifactId: data.sourceArtifactId }), { status: 202 });
  }
  if (path[2] === 'concept' && method === 'PUT') {
    const data = ConceptRequestSchema.parse(await bodyJSON(request));
    if (data.baseRevision !== row.revision) throw new HttpError(409, 'The design changed. Choose a concept generated for the current revision.');
    const study = await env.DB.prepare('SELECT id,prompt,source_artifact_id FROM image_studies WHERE id = ? AND project_id = ? AND revision = ?').bind(data.artifactId, id, row.revision).first<{ id: string; prompt: string; source_artifact_id: string | null }>();
    if (!study) throw new HttpError(409, 'Choose a generated concept from this project and current design revision.');
    if (data.apply) {
      enabled(env); await credential(env, owner);
      if (!env.E2B_API_KEY) throw new HttpError(503, 'Remote computers are not configured.');
      if (!row.design_key) throw new HttpError(409, 'Save this direction for the first design before applying it to a model.');
      const instruction = `Apply the selected visual concept to the canonical design. Saved user direction: ${JSON.stringify(study.prompt)}. Preserve the brief, constraints, unrelated design elements and existing IDs. ${study.source_artifact_id ? 'This concept edits an existing image or model view: preserve unchanged geometry, spatial arrangement, openings and finishes; interpret its camera as a viewpoint, not a geometry change. ' : ''}Translate achievable visual ideas into editable geometry and explain any differences from the concept.`;
      await queueChange(env, id, owner, { operationId: data.operationId, baseRevision: row.revision, agent: 'architect', elementId: null, referenceArtifactId: data.artifactId, instruction });
    }
    await selectConcept(env, row, data.artifactId, data.operationId);
    return Response.json({ selected: true, queued: data.apply, artifactId: data.artifactId }, { status: data.apply ? 202 : 200 });
  }
  if (path[2] === 'runs') {
    if (method === 'POST') {
      const data = RunSchema.parse(await bodyJSON(request)); enabled(env, data.kind === 'render'); await credential(env, owner);
      if (!env.E2B_API_KEY) throw new HttpError(503, 'Remote computers are not configured.');
      if (data.kind === 'render' && !row.design_key) throw new HttpError(409, 'Generate a design before rendering.');
      return Response.json(await beginRun(env, { projectId: id, userId: owner, runId: data.operationId, kind: data.kind, baseRevision: data.baseRevision }), { status: 202 });
    }
    if (method === 'DELETE' && path[3]) {
      const run = await env.DB.prepare('SELECT id,kind,status FROM runs WHERE id = ? AND project_id = ? AND owner_id = ?').bind(path[3], id, owner).first<{ id: string; kind: string; status: string }>(); if (!run) throw new HttpError(404, 'Run not found.');
      const clarification = await cancelClarification(env, id, owner, run.id);
      if (clarification.cancelled) return Response.json(clarification);
      const changed = await env.DB.batch([
        env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE id = ? AND status IN ('queued','in_progress','review','blocked')").bind(run.id),
        env.DB.prepare("UPDATE tasks SET status = 'cancelled' WHERE run_id = ? AND status IN ('queued','in_progress','review','blocked') AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'cancelled')").bind(run.id, run.id),
        changeFailedStatement(env, { projectId: id, userId: owner, runId: run.id, kind: 'change', baseRevision: row.revision }, 'cancelled', 'Work stopped. Previously saved revisions remain available.'),
      ]);
      if (!changed[0].meta.changes) return Response.json({ cancelled: run.status === 'cancelled' });
      try { await (await env.JOBS.get(run.id)).terminate(); } catch { /* D1 cancellation is the commit fence. */ }
      if (run.kind !== 'image') {
        const prefix = `${run.id}-`;
        const desktops = await env.DB.prepare('SELECT lease_id FROM desktop_sessions WHERE project_id = ? AND substr(lease_id,1,?) = ?').bind(id, prefix.length, prefix).all<{lease_id:string}>();
        for (const desktop of desktops.results) await env.BUDGET.getByName('desktop-budget').release(desktop.lease_id);
      }
      await emit(env, id, 'task_cancelled', run.kind === 'image' ? 'Image work stopped. Saved studies remain available; an image request already sent to OpenAI may still incur usage.' : 'Work stopped. Completed revisions remain saved.');
      return Response.json({ cancelled: true });
    }
  }
  if (path[2] === 'messages' && method === 'POST') {
    const result = await handleInteraction(env, id, owner, InteractionRequestSchema.parse(await bodyJSON(request)));
    return Response.json(result, { status: result.queued ? 202 : 200 });
  }
  if (path[2] === 'desktop' && method === 'POST') {
    const agent = AgentIdSchema.parse(path[3]);
    const desktop = await env.DB.prepare('SELECT lease_id,expires_at FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(id, agent).first<{ lease_id: string; expires_at: number }>();
    if (!desktop || desktop.expires_at < Date.now()) throw new HttpError(409, 'No active workstation. Start a design task first.');
    await env.DB.prepare('UPDATE desktop_sessions SET viewed_at = ? WHERE project_id = ? AND agent = ?').bind(Date.now(), id, agent).run();
    const running = await env.DB.prepare("SELECT id FROM tasks WHERE project_id = ? AND agent = ? AND status = 'in_progress'").bind(id, agent).first();
    await env.BUDGET.getByName('desktop-budget').touch(desktop.lease_id, Boolean(running));
    if (path[4] === 'heartbeat') return Response.json({ active: true });
    const opened = await env.PROJECTS.getByName(id).desktopStream(id, owner, agent, desktop.lease_id);
    if (!opened.ok) throw new HttpError(opened.status, opened.message);
    return Response.json({ url: opened.url });
  }
  if (path[2] === 'voice') {
    if (method === 'PUT' && path[3]) {
      const input = z.object({ agent: AgentIdSchema, elementId: z.string().nullable(), meeting: z.boolean() }).parse(await bodyJSON(request));
      const voice = await env.DB.prepare('SELECT id FROM voice_sessions WHERE id = ? AND project_id = ? AND owner_id = ?').bind(path[3], id, owner).first();
      if (!voice) throw new HttpError(404, 'Voice session not found.');
      if (input.elementId && !(await designFromRow(env, row))?.elements.some(e => e.id === input.elementId)) throw new HttpError(409, 'Selected element no longer exists.');
      const result = await env.PROJECTS.getByName(id).moveVoice(path[3], owner, input.agent, input.elementId, input.meeting);
      if (!result.ok) throw new HttpError(409, 'Reconnect live voice to continue.');
      return Response.json(result);
    }
    if (method === 'DELETE' && path[3]) {
      const voice = await env.DB.prepare('SELECT id FROM voice_sessions WHERE id = ? AND project_id = ? AND owner_id = ?').bind(path[3], id, owner).first(); if (!voice) throw new HttpError(404, 'Voice session not found.');
      await env.PROJECTS.getByName(id).closeVoice(path[3]);
      return Response.json({ ended: true });
    }
    if (method === 'POST') {
      const agent = AgentIdSchema.parse(request.headers.get('X-Atelier-Agent') || 'principal');
      return startVoice(request, env, row, owner, agent);
    }
  }
  throw new HttpError(404, 'Not found.');
}
export default {
  async fetch(request: Request, env: Bindings) {
    try { const response = await route(request, env); response.headers.set('Cache-Control','private, no-store'); response.headers.set('X-Content-Type-Options','nosniff'); return response; }
    catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof ZodError ? 400 : 500;
      const error = e instanceof HttpError ? e.message : e instanceof ZodError ? e.issues.map(i => i.message).slice(0,3).join('; ') : 'The request could not be completed. Your saved design is unchanged.';
      if (status === 500) console.error(JSON.stringify({ type: 'request_failed', requestId: crypto.randomUUID(), errorType: e instanceof Error ? e.name : 'unknown' }));
      return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
  },
} satisfies ExportedHandler<Bindings>;
