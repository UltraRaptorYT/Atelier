import { z, ZodError } from 'zod';
import { agents, BriefSchema, ChangeSchema, AgentIdSchema } from '../../shared/design';
import { credential, encryptCredential, userId, ownedProject, bodyJSON, HttpError } from './security';
import { designFromRow, eventsAfter, projectFromRow, snapshot, emit } from './store';
import { openDesktopStream } from './desktop';
import { queueChange } from './steering';
import type { Bindings, ProjectRow } from './types';
export { ProjectCoordinator } from './coordinator';
export { ComputeBudget } from './budget';
export { DesignWorkflow } from './workflow';
const CreateSchema = z.object({ name: z.string().trim().min(1).max(120), brief: BriefSchema });
const RunSchema = z.object({ operationId: z.string().uuid(), kind: z.enum(['generate','render']), baseRevision: z.number().int().min(0) });
function enabled(env: Bindings, render = false) {
  if (String(env.GENERATION_ENABLED) !== 'true') throw new HttpError(503, 'Live generation is paused until the deployment checks pass.');
  if (render && String(env.RENDER_ENABLED) !== 'true') throw new HttpError(503, 'Public rendering is disabled until the Blender benchmark passes.');
}
async function route(request: Request, env: Bindings): Promise<Response> {
  const path = new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent), method = request.method;
  if (path[0] === 'health') return Response.json({ service: 'atelier', status: 'ok', generation: String(env.GENERATION_ENABLED) === 'true', render: String(env.RENDER_ENABLED) === 'true' });
  const owner = await userId(request, env);
  if (path[0] === 'capabilities') {
    const key = await env.DB.prepare('SELECT owner_id FROM credentials WHERE owner_id = ?').bind(owner).first();
    return Response.json({ configured: true, generation: String(env.GENERATION_ENABLED) === 'true', render: String(env.RENDER_ENABLED) === 'true', local: env.ENVIRONMENT === 'local', keyConnected: Boolean(key) });
  }
  if (path[0] === 'credentials') {
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM credentials WHERE owner_id = ?').bind(owner).run(); return Response.json({ removed: true }); }
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
      await env.DB.prepare('INSERT INTO projects(id,owner_id,name,brief,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, owner, data.name, JSON.stringify(data.brief), now, now).run();
      await emit(env, id, 'project_created', 'Project created. Your brief is ready for the principal.');
      return Response.json(projectFromRow(await ownedProject(env, id, owner)), { status: 201 });
    }
  }
  const id = path[1], row = await ownedProject(env, id, owner);
  if (path.length === 2 && method === 'GET') return Response.json(await snapshot(env, row));
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
    return new Response(object.body, { headers: { 'Content-Type': a.mime, 'Content-Disposition': `attachment; filename="${a.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}"` } });
  }
  if (path[2] === 'runs') {
    if (method === 'POST') {
      const data = RunSchema.parse(await bodyJSON(request)); enabled(env, data.kind === 'render'); await credential(env, owner);
      if (!env.E2B_API_KEY) throw new HttpError(503, 'Remote computers are not configured.');
      if (data.kind === 'render' && !row.design_key) throw new HttpError(409, 'Generate a design before rendering.');
      return Response.json(await env.PROJECTS.getByName(id).begin({ projectId: id, userId: owner, runId: data.operationId, kind: data.kind, baseRevision: data.baseRevision }), { status: 202 });
    }
    if (method === 'DELETE' && path[3]) {
      const run = await env.DB.prepare('SELECT id FROM runs WHERE id = ? AND project_id = ? AND owner_id = ?').bind(path[3], id, owner).first(); if (!run) throw new HttpError(404, 'Run not found.');
      await env.DB.batch([env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE id = ? AND status IN ('queued','in_progress')").bind(path[3]), env.DB.prepare("UPDATE tasks SET status = 'cancelled' WHERE run_id = ? AND status IN ('queued','in_progress')").bind(path[3])]);
      try { await (await env.JOBS.get(path[3])).terminate(); } catch { /* D1 cancellation is the commit fence. */ }
      const desktops = await env.DB.prepare('SELECT lease_id FROM desktop_sessions WHERE project_id = ?').bind(id).all<{lease_id:string}>();
      for (const desktop of desktops.results) await env.BUDGET.getByName('desktop-budget').release(desktop.lease_id);
      await emit(env, id, 'task_cancelled', 'Work stopped. Completed revisions remain saved.');
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
    if (method === 'DELETE' && path[3]) {
      const voice = await env.DB.prepare('SELECT id FROM voice_sessions WHERE id = ? AND project_id = ? AND owner_id = ?').bind(path[3], id, owner).first(); if (!voice) throw new HttpError(404, 'Voice session not found.');
      await env.PROJECTS.getByName(id).closeVoice(path[3]);
      return Response.json({ ended: true });
    }
    if (method === 'POST') {
      enabled(env); const agent = AgentIdSchema.parse(request.headers.get('X-Atelier-Agent') || 'principal');
      const key = await credential(env, owner); const design = await designFromRow(env, row);
      const sdp = await request.text(); if (sdp.length > 64000) throw new HttpError(413, 'Voice offer is too large.');
      const fd = new FormData(); fd.set('sdp', sdp);
      fd.set('session', JSON.stringify({ type: 'realtime', model: env.VOICE_MODEL,
        instructions: `You are ${agents[agent].name}, the ${agents[agent].role} at Atelier. Discuss the project concisely. Brief: ${row.brief}. Current design summary: ${JSON.stringify(design ? { title: design.title, spaces: design.spaces, revision: row.revision } : null)}. Use request_change for design instructions; acknowledge queued work without claiming it is already done. Use save_brief for initial requirements and clarification answers. Tool execution belongs exclusively to the server.`,
        audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad', interrupt_response: true, create_response: true } }, output: { voice: 'marin' } },
        tools: [{ type: 'function', name: 'request_change', description: 'Save a design change for the addressed specialist.', parameters: { type: 'object', properties: { instruction: { type: 'string' }, elementId: { type: ['string','null'] } }, required: ['instruction', 'elementId'], additionalProperties: false } }, { type: 'function', name: 'save_brief', description: 'Save the initial project brief or clarification answers before generation.', parameters: { type: 'object', properties: { brief: { type: 'string' } }, required: ['brief'], additionalProperties: false } }],
      }));
      const upstream = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(25000) });
      if (!upstream.ok) { await upstream.body?.cancel(); throw new HttpError(502, 'OpenAI could not start voice. Check that your key has realtime access.'); }
      const callId = upstream.headers.get('Location')?.split('/').pop(); if (!callId) throw new HttpError(502, 'Voice session ID was not returned.');
      await env.DB.prepare('INSERT INTO voice_sessions(id,project_id,owner_id,agent,created_at) VALUES(?,?,?,?,?)').bind(callId, id, owner, agent, Date.now()).run();
      await env.PROJECTS.getByName(id).attachVoice(id, owner, callId, agent);
      return new Response(upstream.body, { headers: { 'Content-Type': 'application/sdp', 'X-Voice-Session': callId } });
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
