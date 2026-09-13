import { z, ZodError } from 'zod';
import { BriefSchema, ChangeSchema, AgentIdSchema, recolor } from '../../shared/design';
import { credential, encryptCredential, userId, ownedProject, bodyJSON, HttpError } from './security';
import { designFromRow, eventsAfter, projectFromRow, snapshot, emit } from './store';
import { openDesktopStream } from './desktop';
import { queueChange } from './steering';
import { changeFailedStatement } from './changes';
import { startVoice } from './voice';
import { CaptureRequestSchema, ConceptRequestSchema, ImageRequestSchema } from '../../shared/images';
import { loadImageReference, saveCapture, selectConcept } from './images';
import type { Bindings, ProjectRow, RunParams } from './types';
export { ProjectCoordinator } from './coordinator';
export { ComputeBudget } from './budget';
export { DesignWorkflow } from './workflow';
const CreateSchema = z.object({ name: z.string().trim().min(1).max(120), brief: BriefSchema });
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
  try { return await env.PROJECTS.getByName(params.projectId).begin(params); }
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
  if (path[0] === 'health') return Response.json({ service: 'atelier', status: 'ok', generation: String(env.GENERATION_ENABLED) === 'true', render: String(env.RENDER_ENABLED) === 'true', imageGeneration: String(env.IMAGE_GENERATION_ENABLED) === 'true' });
  const owner = await userId(request, env);
  const allowance = env.API_LIMIT ? await env.API_LIMIT.limit({ key: owner }) : { success: true };
  if (!allowance.success) throw new HttpError(429, 'Too many requests. Wait a minute and retry.');
  if (path[0] === 'capabilities') {
    const key = await env.DB.prepare('SELECT owner_id FROM credentials WHERE owner_id = ?').bind(owner).first();
    return Response.json({ configured: true, generation: String(env.GENERATION_ENABLED) === 'true', render: String(env.RENDER_ENABLED) === 'true', local: env.ENVIRONMENT === 'local', keyConnected: Boolean(key || env.OPENAI_API_KEY?.trim()), keySource: key ? 'saved' : env.OPENAI_API_KEY?.trim() ? 'environment' : 'none', voice: String(env.VOICE_ENABLED) === 'true', voiceModel: env.VOICE_MODEL, images: String(env.IMAGE_GENERATION_ENABLED) === 'true', imageModel: env.OPENAI_IMAGE_CONCEPT_MODEL, imageEditModel: env.OPENAI_IMAGE_EDIT_MODEL });
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
    if (method === 'GET') return Response.json((await env.DB.prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100').bind(owner).all<ProjectRow>()).results.map(projectFromRow));
    if (method === 'POST') {
      const data = CreateSchema.parse(await bodyJSON(request));
      const count = await env.DB.prepare('SELECT COUNT(*) as count FROM projects WHERE owner_id = ?').bind(owner).first<{ count: number }>();
      if ((count?.count || 0) >= 10) throw new HttpError(429, 'The beta allows ten projects per account.');
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const saved=await env.DB.prepare('INSERT INTO projects(id,owner_id,name,brief,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM projects WHERE owner_id = ?) < 10').bind(id, owner, data.name, JSON.stringify(data.brief), now, now,owner).run();
      if(!saved.meta.changes) throw new HttpError(429,'The beta allows ten projects per account.');
      await emit(env, id, 'project_created', 'Project created. Your brief is ready for the principal.');
      return Response.json(projectFromRow(await ownedProject(env, id, owner)), { status: 201 });
    }
  }
  const id = path[1], row = await ownedProject(env, id, owner);
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
    const active = await env.DB.prepare("SELECT id FROM runs WHERE project_id = ? AND status IN ('queued','in_progress')").bind(id).first();
    if (active) throw new HttpError(409, 'Send a steering message while work is running. Edit the full brief after it finishes.');
    await env.DB.prepare('UPDATE projects SET name = ?, brief = ?, updated_at = ? WHERE id = ?').bind(data.name, JSON.stringify(data.brief), new Date().toISOString(), id).run();
    await emit(env, id, 'clarification_received', 'The project brief was updated.', 'principal');
    return Response.json({ saved: true });
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
  if (path[2] === 'messages' && method === 'POST') { enabled(env); await credential(env, owner); return Response.json(await queueChange(env, id, owner, ChangeSchema.parse(await bodyJSON(request))), { status: 202 }); }
  if (path[2] === 'desktop' && method === 'POST') {
    const agent = AgentIdSchema.parse(path[3]);
    const desktop = await env.DB.prepare('SELECT lease_id,expires_at FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(id, agent).first<{ lease_id: string; expires_at: number }>();
    if (!desktop || desktop.expires_at < Date.now()) throw new HttpError(409, 'No active workstation. Start a design task first.');
    await env.DB.prepare('UPDATE desktop_sessions SET viewed_at = ? WHERE project_id = ? AND agent = ?').bind(Date.now(), id, agent).run();
    const running = await env.DB.prepare("SELECT id FROM tasks WHERE project_id = ? AND agent = ? AND status = 'in_progress'").bind(id, agent).first();
    await env.BUDGET.getByName('desktop-budget').touch(desktop.lease_id, Boolean(running));
    return Response.json(path[4] === 'heartbeat' ? { active: true } : await openDesktopStream(env, id, agent));
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
