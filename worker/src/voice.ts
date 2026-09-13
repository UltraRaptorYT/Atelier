import type { MediaSessionConfig } from 'openai/resources/live/live';
import { z } from 'zod';
import { agents, BriefSchema, ChangeSchema, type AgentId } from '../../shared/design';
import type { Bindings, ProjectRow } from './types';
import { bodyText, credential, HttpError, ownedProject } from './security';
import { designFromRow, emit } from './store';
import { queueChange } from './steering';
import { reviewMeeting } from './meeting';

export function voiceSessionConfig(env: Pick<Bindings, 'VOICE_MODEL' | 'OPENAI_MODEL'>, agent: AgentId, meeting = false): MediaSessionConfig {
  return {
    model: env.VOICE_MODEL,
    store: false,
    audio: { output: { voice: 'marin' } },
    instructions: `You are ${agents[agent].name}, the ${agents[agent].role} at Atelier, an architecture studio. ${meeting ? 'You are at the meeting table, facilitating the whole team briefing.' : 'You are at your specialist workstation.'} Help the user brief and steer the shared design team. Speak briefly and naturally. Ask at most two high-impact questions at a time.
Backchannel policy: Acknowledge naturally without competing with the user.
Interruption policy: Stop your answer when interrupted and listen to the correction.
Delegation policy:
Backend tools: Read current project facts, save spoken brief details, and queue contextual design changes for the team.
Delegate to the backend when: The user supplies requirements or corrections, asks about project progress, or requests a design change. Delegate before claiming any action or current project fact. Saved, queued, applied and reviewed are different states.
Do not delegate to the backend when: Greeting the user or asking a short clarification. Never invent task results. Design work is performed by the existing specialist team. At the meeting table you facilitate the whole team. Save the brief, consult review_team, ask their high-impact unanswered questions, and use finish_meeting only when the user explicitly says to begin work. Location updates change your specialist identity. Stop work cancels design work. Ending this voice call does not cancel design work.`,
    client: { data_channel: {
      allowed_client_events: [],
      allowed_server_events: ['session.started', 'session.closed', 'session.input_transcript.delta', 'session.output_transcript.delta', 'error'].map(type => ({ type })),
    } },
    delegation: { type: 'responses', responses: {
      model: env.OPENAI_MODEL,
      parallel_tool_calls: false,
      max_output_tokens: 1800,
      instructions: `You route voice input to Atelier's existing project system, speaking for the currentAgent returned by get_project_context. You do not own or directly regenerate the design.
Use get_project_context before answering project questions or choosing a mutation. Read the latest brief, revision, selection, pending work and accepted changes. User speech can contain unfinished phrases and corrections; clarify ambiguous targets.
Before a first design exists, use save_brief for the user's new requirements or clarification answers. Supply only new details; the server appends them without deleting earlier requirements. Do not save speculation, questions, or assistant suggestions as requirements.
After a design exists, use request_change for explicit changes. Use baseRevision from your latest context. Use the selected element only when the user refers to it; use null for a whole-building request. Never infer an element ID that is absent from context. Scope and work ownership are resolved by the existing project workflow.
Answer questions without queuing changes. Check tool results. Report saved or queued work precisely; never claim the model changed until current project state confirms it. Do not retry an action with altered parameters just to bypass a conflict. If generation is paused, explain that the brief can still be saved and voice can continue. At the meeting table use review_team after saving a substantive brief. Present actual specialist perspectives and unanswered high-impact questions. Only when the user explicitly says start or proceed, call finish_meeting with confirmed=true. Never start merely because requirements were mentioned. Return concise facts for the voice model.`,
      tools: [
        { type: 'function', name: 'review_team', description: 'Gather actual specialist perspectives on the saved brief. Meeting room only.', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
        { type: 'function', name: 'finish_meeting', description: 'Start specialist work after explicit user approval. Meeting room only.', strict: true, parameters: { type: 'object', properties: { confirmed: { type: 'boolean' } }, required: ['confirmed'], additionalProperties: false } },
        { type: 'function', name: 'get_project_context', description: 'Read the current saved brief, design revision, selected element and task/change status.', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
        { type: 'function', name: 'save_brief', description: 'Append newly spoken requirements or clarification answers before the first design. Preserve existing details.', strict: true, parameters: { type: 'object', properties: { details: { type: 'string' } }, required: ['details'], additionalProperties: false } },
        { type: 'function', name: 'request_change', description: 'Queue an explicit change against the latest design revision.', strict: true, parameters: { type: 'object', properties: { instruction: { type: 'string' }, elementId: { type: ['string', 'null'] }, baseRevision: { type: 'integer' } }, required: ['instruction', 'elementId', 'baseRevision'], additionalProperties: false } },
      ],
    } },
  };
}

export async function startVoice(request: Request, env: Bindings, row: ProjectRow, owner: string, agent: AgentId) {
  const meeting = request.headers.get('X-Atelier-Location') === 'reception';
  if (String(env.VOICE_ENABLED) !== 'true') throw new HttpError(503, 'Live voice is disabled for this studio.');
  if (!request.headers.get('Content-Type')?.startsWith('application/sdp')) throw new HttpError(415, 'An SDP voice offer is required.');
  const sdp = await bodyText(request);
  if (!sdp.trim().startsWith('v=0')) throw new HttpError(400, 'Invalid voice offer.');
  const elementId = request.headers.get('X-Atelier-Element') || null;
  if (elementId) {
    const design = await designFromRow(env, row);
    if (!design?.elements.some(element => element.id === elementId)) throw new HttpError(409, 'The selected element is no longer in the saved design. Select it again.');
  }
  const key = await credential(env, owner);
  const upstream = await fetch('https://api.openai.com/v1/live/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: voiceSessionConfig(env, agent, meeting), transport: { type: 'webrtc', sdp } }),
    signal: AbortSignal.timeout(25000),
  });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    throw new HttpError(502, 'OpenAI could not start GPT-Live 1. Check your key’s model access and billing.');
  }
  const result = await upstream.json();
  const sessionId = z.object({ session: z.object({ id: z.string().min(1) }) }).parse(result).session.id;
  try {
    const transport = z.object({ transport: z.object({ type: z.literal('webrtc'), sdp: z.string().regex(/^v=0/) }) }).parse(result).transport;
    await env.DB.prepare('INSERT INTO voice_sessions(id,project_id,owner_id,agent,created_at) VALUES(?,?,?,?,?)').bind(sessionId, row.id, owner, agent, Date.now()).run();
    await env.PROJECTS.getByName(row.id).attachVoice(row.id, owner, sessionId, agent, elementId, meeting);
    if (request.signal.aborted) throw new Error('Voice connection cancelled.');
    return new Response(transport.sdp, { headers: { 'Content-Type': 'application/sdp', 'X-Voice-Session': sessionId } });
  } catch {
    // A successful provider create must be paired with hangup if server controls fail.
    await hangupVoice(key, sessionId).catch(() => {});
    await env.PROJECTS.getByName(row.id).closeVoice(sessionId, owner).catch(() => {});
    throw new HttpError(502, 'Voice could not attach project controls. Please reconnect.');
  }
}

export async function hangupVoice(key: string, sessionId: string) {
  const response = await fetch(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/hangup`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
  });
  await response.body?.cancel();
  if (!response.ok && response.status !== 404) throw new HttpError(502, 'Voice could not be ended.');
}

export type VoiceToolCall = { call_id: string; name: string; arguments: string };
export function completedVoiceTool(event: Record<string, unknown>): VoiceToolCall | null {
  if (event.type !== 'response.output_item.done') return null;
  const parsed = z.object({ type: z.literal('function_call'), call_id: z.string().min(1), name: z.string(), arguments: z.string() }).safeParse(event.item);
  return parsed.success ? parsed.data : null;
}

// Live envelopes contain a Responses stream. Terminal snapshots omit output items,
// so collect completed calls while streaming and continue only after the terminal event.
export class LiveResponseTools {
  private batches = new Map<string, { responseId: string; calls: Map<string, VoiceToolCall> }>();
  private completed = new Set<string>();
  constructor(private execute: (call: VoiceToolCall) => Promise<unknown>, private send: (event: unknown) => void) {}
  async handle(envelope: Record<string, unknown>) {
    if (envelope.type !== 'response.event' || !envelope.event || typeof envelope.event !== 'object') return;
    const event = envelope.event as Record<string, unknown>;
    const key = typeof envelope.delegation_id === 'string' ? envelope.delegation_id : 'current';
    const response = event.response as { id?: string } | undefined;
    if (event.type === 'response.created' && response?.id) {
      if (!this.completed.has(response.id) && this.batches.get(key)?.responseId !== response.id) this.batches.set(key, { responseId: response.id, calls: new Map() });
      return;
    }
    const batch = this.batches.get(key);
    if (!batch) return;
    const call = completedVoiceTool(event);
    if (call) { batch.calls.set(call.call_id, call); return; }
    if (!['response.completed', 'response.failed', 'response.incomplete', 'response.cancelled'].includes(String(event.type))) return;
    if (response?.id && response.id !== batch.responseId) return;
    this.batches.delete(key); this.completed.add(batch.responseId);
    if (event.type !== 'response.completed' || !batch.calls.size) return;
    for (const tool of batch.calls.values()) {
      const result = await this.execute(tool);
      this.send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: tool.call_id, output: JSON.stringify(result) } });
    }
    this.send({ type: 'response.create' });
  }
}

export async function voiceOperationId(sessionId: string, callId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([sessionId, callId])));
  const bytes = new Uint8Array(digest).slice(0, 16); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function executeVoiceTool(env: Bindings, projectId: string, owner: string, sessionId: string, agent: AgentId, selected: string | null, call: VoiceToolCall, meeting = false): Promise<unknown> {
  const operationId = await voiceOperationId(sessionId, call.call_id);
  const receipt = await env.DB.prepare('SELECT result FROM voice_tool_results WHERE operation_id = ? AND project_id = ?').bind(operationId, projectId).first<{ result: string }>();
  if (receipt) return JSON.parse(receipt.result);
  const session = await env.DB.prepare('SELECT id FROM voice_sessions WHERE id = ? AND project_id = ? AND owner_id = ?').bind(sessionId, projectId, owner).first();
  if (!session) return { error: 'The voice session has ended. No action was applied.' };
  const project = await ownedProject(env, projectId, owner);
  try {
    const args = JSON.parse(call.arguments);
    if (call.name === 'get_project_context') {
      const design = await designFromRow(env, project);
      const [tasks, changes] = await Promise.all([
        env.DB.prepare('SELECT agent,title,status,detail FROM tasks WHERE project_id = ? ORDER BY rowid DESC LIMIT 12').bind(projectId).all(),
        env.DB.prepare('SELECT instruction,status,base_revision FROM changes WHERE project_id = ? ORDER BY rowid DESC LIMIT 12').bind(projectId).all(),
      ]);
      return { currentAgent: agents[agent], location: meeting ? 'meeting room (whole team)' : agents[agent].role + ' workstation', brief: JSON.parse(project.brief), revision: project.revision, status: project.status, generationEnabled: String(env.GENERATION_ENABLED) === 'true', selectedElementId: selected,
        design: design ? { title: design.title, floors: design.floors, spaces: design.spaces, elements: design.elements.map(({ id, name, materialId }) => ({ id, name, materialId })), materials: design.materials } : null,
        tasks: tasks.results, changes: changes.results };
    }
    let result: unknown;
    if (call.name === 'review_team') {
      if (!meeting || project.design_key) throw new HttpError(409, 'Meet at the team table before the first design.');
      return { perspectives: await reviewMeeting(env, projectId, owner, BriefSchema.parse(JSON.parse(project.brief))) };
    } else if (call.name === 'finish_meeting') {
      if (!meeting) throw new HttpError(409, 'Return to the meeting table to start the team.');
      z.object({confirmed:z.literal(true)}).parse(args);
      if (String(env.GENERATION_ENABLED) !== 'true') throw new HttpError(503, 'Design generation is paused.');
      if (project.design_key) throw new HttpError(409, 'Use a contextual change for an existing design.');
      if (JSON.parse(project.brief).request === 'Awaiting your spoken project brief.') throw new HttpError(409, 'Save the user brief first.');
      await credential(env, owner);
      result = await env.PROJECTS.getByName(projectId).begin({projectId,userId:owner,runId:operationId,kind:'generate',baseRevision:project.revision});
    } else if (call.name === 'request_change') {
      if (String(env.GENERATION_ENABLED) !== 'true') throw new HttpError(503, 'Design generation is paused. Your spoken brief can still be saved before generation.');
      if (!project.design_key) throw new HttpError(409, 'Save the requirements as brief details, then use Start team briefing.');
      const change = ChangeSchema.parse({ ...args, operationId, agent });
      if (change.elementId) {
        const design = await designFromRow(env, project);
        if (!design?.elements.some(element => element.id === change.elementId)) throw new HttpError(409, 'The requested element does not exist. Read the current context and clarify the target.');
      }
      result = await queueChange(env, projectId, owner, change);
    } else if (call.name === 'save_brief') {
      if (project.design_key) throw new HttpError(409, 'A design already exists. Use a contextual change request.');
      const { details } = z.object({ details: z.string().trim().min(1).max(4000) }).parse(args);
      const brief = BriefSchema.parse(JSON.parse(project.brief));
      const request = brief.request === 'Awaiting your spoken project brief.' ? details : `${brief.request}\n\nSpoken requirements / clarification:\n${details}`;
      const updated = BriefSchema.parse({ ...brief, request, summary: request.slice(0, 2000) });
      result = { saved: true, next: 'Consult review_team; finish_meeting only after explicit user approval.' };
      // Receipt and append share one D1 transaction; never overwrite concurrent edits or an active run.
      const now = new Date().toISOString();
      const saved = await env.DB.batch([
        env.DB.prepare("UPDATE projects SET brief = ?, updated_at = ? WHERE id = ? AND brief = ? AND design_key IS NULL AND NOT EXISTS (SELECT 1 FROM runs WHERE project_id = ? AND status IN ('queued','in_progress')) AND NOT EXISTS (SELECT 1 FROM voice_tool_results WHERE operation_id = ?)").bind(JSON.stringify(updated), now, projectId, project.brief, projectId, operationId),
        env.DB.prepare('INSERT OR IGNORE INTO voice_tool_results(operation_id,project_id,result,created_at) SELECT ?,?,?,? WHERE changes() = 1').bind(operationId, projectId, JSON.stringify(result), now),
      ]);
      if (!saved[0].meta.changes) throw new HttpError(409, 'The brief changed or design work started. Read the current context before continuing.');
      await emit(env, projectId, 'clarification_received', 'Spoken requirements saved to the project brief.', agent, null, operationId);
      return result;
    } else throw new HttpError(400, 'Unknown voice tool.');
    await env.DB.prepare('INSERT OR IGNORE INTO voice_tool_results(operation_id,project_id,result,created_at) VALUES(?,?,?,?)').bind(operationId, projectId, JSON.stringify(result), new Date().toISOString()).run();
    return result;
  } catch (error) {
    return { error: error instanceof HttpError ? error.message : 'The action could not be applied. Check the project panel and clarify the request.' };
  }
}
