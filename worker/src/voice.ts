import type { MediaSessionConfig } from 'openai/resources/live/live';
import { z } from 'zod';
import { agents, BriefSchema, ChangeSchema, type AgentId } from '../../shared/design';
import { ClarificationAnswerSchema, InteractionRequestSchema, type InteractionRequest } from '../../shared/conversation';
import type { Bindings, ProjectRow } from './types';
import { bodyText, credential, HttpError, ownedProject } from './security';
import { designFromRow, emit } from './store';
import { reviewMeeting } from './meeting';
import { readEffectiveRequirements } from './requirements';
import { getClarification } from './clarifications';
import { handleInteraction } from './conversation';
import { hasMeaningfulBrief } from '../../shared/brief-validation';

const meetingHandoffInstructions = `Meeting handoff: Never silently finish the question-and-answer stage. When the team has no more high-impact questions, explicitly say, "That answers our questions for now. We're ready to work. Say start working when you're ready." If the user has already approved starting, do not ask for approval again: call finish_meeting and wait for its result. After a successful start, speak the returned announcement once, including that the briefing is finished and the team is preparing to move to its rooms. If answer_clarification saves the final required answer, explicitly acknowledge that all current questions are answered and speak its returned reply. A queued continuation is not running yet: explain that it will resume automatically, without asking for another start command. For partial answers, acknowledge what was saved and ask only the remaining questions. If starting fails or generation is paused, explain the blocker instead of announcing that anyone is working. Keep the microphone session open for steering.`;

export function voiceSessionConfig(env: Pick<Bindings, 'VOICE_MODEL' | 'OPENAI_MODEL'>, agent: AgentId, meeting = false): MediaSessionConfig {
  return {
    model: env.VOICE_MODEL,
    store: false,
    audio: { output: { voice: 'marin' } },
    instructions: `You are ${agents[agent].name}, the ${agents[agent].role} at Atelier, an architecture studio. ${meeting ? 'You are at the meeting table, facilitating the whole team briefing.' : 'You are at your specialist workstation.'} Help the user brief and steer the shared design team. Speak briefly and naturally. Ask at most two high-impact questions at a time.
Backchannel policy: Acknowledge naturally without competing with the user.
Interruption policy: Stop your answer when interrupted and listen to the correction.
${meetingHandoffInstructions}
Delegation policy:
Backend tools: Read current project facts, save spoken brief details, answer pending Principal questions, and queue contextual design changes for the team.
Delegate to the backend when: The user supplies requirements or corrections, asks about project progress, or requests a design change. Delegate before claiming any action or current project fact. Saved, queued, applied and reviewed are different states.
Do not delegate to the backend when: Greeting the user or asking a short clarification. Never invent task results. Design work is performed by the existing specialist team. At the meeting table you facilitate the whole team. Save the brief, consult review_team, ask their high-impact unanswered questions, and use finish_meeting only when the user explicitly says to begin initial work. Answering all required questions from an already-started briefing automatically requests continuation; read the result before saying it resumed. Location updates change your specialist identity. Stop work cancels design work. Ending this voice call does not cancel design work.`,
    client: { data_channel: {
      allowed_client_events: [],
      allowed_server_events: ['session.started', 'session.closed', 'session.input_transcript.delta', 'session.output_transcript.delta', 'error'].map(type => ({ type })),
    } },
    delegation: { type: 'responses', responses: {
      model: env.OPENAI_MODEL,
      parallel_tool_calls: false,
      max_output_tokens: 1800,
      // This backend routes short voice commands; specialist design reasoning
      // remains separately configured. Do not spend the whole cap on reasoning.
      reasoning: { effort: 'low' },
      instructions: `You route voice input to Atelier's existing project system, speaking for the currentAgent returned by get_project_context. You do not own or directly regenerate the design.
Use get_project_context before answering project questions or choosing a mutation. Read the latest brief, revision, selection, pending work, clarification and accepted changes. User speech can contain unfinished phrases and corrections; clarify ambiguous targets.
${meetingHandoffInstructions}
The effectiveRequirements record contains every applied amendment in order. Later amendments replace earlier requirements only on overlapping subject and scope; preserve unrelated requirements. Never restore an original brief choice superseded by applied feedback. Use application and review milestones separately when reporting progress.
When clarification contains pending questions, use answer_clarification for actual user answers. Copy the clarification ID, current version and matching question IDs from context; include only questions the user has answered. Partial answers remain saved. Once every required question is answered, the server requests continuation of the work the user already started. Report the returned continuation status precisely. Asking "What would you recommend?" is a question, not an answer; give advice without saving it as a requirement. Never infer an answer from your own suggestion. Never call finish_meeting to bypass unanswered questions, stale answers or cancelled work.
Before a first design exists, use save_brief for the user's new requirements, including extra requirements unrelated to pending questions. Use answer_clarification instead for actual answers to those questions. Supply only new details, never the whole discussion or a copy of the saved brief; the server appends them without deleting earlier requirements. Read fresh context after saving because question versions may change. Do not save speculation, questions, or assistant suggestions as requirements. Saving an initial brief does not start generation. Say a detail is saved only when the result contains saved=true. If saving fails, do not call finish_meeting against an older brief; explain that specific blocker and preserve the user's intended requirements. Do not claim a general inability to save briefs or perform work.
After a design exists, use request_change for explicit changes. Use baseRevision from your latest context. Use the selected element only when the user refers to it; use null for a whole-building request. Never infer an element ID that is absent from context. Scope and work ownership are resolved by the existing project workflow.
Answer questions without queuing changes. Check tool results. Report saved or queued work precisely; never claim the model changed until current project state confirms it. Do not retry an action with altered parameters just to bypass a conflict. If generation is paused, explain that the brief can still be saved and voice can continue. At the meeting table use review_team after saving a substantive brief. Present actual specialist perspectives and unanswered high-impact questions. The phrase "start working" (also "go ahead" or "begin work") is explicit approval: save any remaining user-provided brief details, then call finish_meeting with confirmed=true immediately. Do not ask them to click a button or repeat approval. Do not close or restart voice; say the team is starting and remain available for steering. This command works from any nearby teammate. Never start merely because requirements were mentioned. Return concise facts for the voice model.`,
      tools: [
        { type: 'function', name: 'review_team', description: 'Gather actual specialist perspectives on the saved brief. Meeting room only.', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
        { type: 'function', name: 'finish_meeting', description: 'Start the team when the user says start working. Preserve the voice call.', strict: true, parameters: { type: 'object', properties: { confirmed: { type: 'boolean' } }, required: ['confirmed'], additionalProperties: false } },
        { type: 'function', name: 'get_project_context', description: 'Read the current saved brief, design revision, selected element and task/change status.', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
        { type: 'function', name: 'save_brief', description: 'Append only new user requirements (1–4000 characters) before the first design. Extra details may be saved while questions are open; actual answers use answer_clarification. Preserve existing details without starting work.', strict: true, parameters: { type: 'object', properties: { details: { type: 'string' } }, required: ['details'], additionalProperties: false } },
        { type: 'function', name: 'answer_clarification', description: 'Save actual user answers to pending Principal questions. All required answers request continuation of an already-started briefing.', strict: true, parameters: { type: 'object', properties: {
          clarificationId: { type: 'string' }, clarificationVersion: { type: 'integer' },
          answers: { type: 'array', items: { type: 'object', properties: { questionId: { type: 'string' }, answer: { type: 'string' } }, required: ['questionId', 'answer'], additionalProperties: false } },
        }, required: ['clarificationId', 'clarificationVersion', 'answers'], additionalProperties: false } },
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

function voiceInteractionRequest(name: string, args: unknown, operationId: string, agent: AgentId, revision: number): InteractionRequest | null {
  if (name === 'request_change') {
    const change = z.object({ instruction: z.string(), elementId: z.string().nullable(), baseRevision: z.number().int() }).strict().parse(args);
    return InteractionRequestSchema.parse({ ...ChangeSchema.parse({ ...change, operationId, agent }), intent: 'change' });
  }
  if (name === 'answer_clarification') {
    const answer = z.object({
      clarificationId: z.string().min(1), clarificationVersion: z.number().int().min(1),
      answers: z.array(ClarificationAnswerSchema.strict()).min(1).max(3),
    }).strict().parse(args);
    return InteractionRequestSchema.parse({
      ...answer, instruction: answer.answers.map(item => item.answer).join('\n').slice(0, 4000),
      intent: 'answer_clarification', operationId, baseRevision: revision, agent: 'principal', elementId: null,
    });
  }
  if (name === 'save_brief') {
    const { details } = z.object({ details: z.string().trim().min(1).max(4000) }).strict().parse(args);
    return InteractionRequestSchema.parse({ instruction: details, intent: 'brief_update', operationId, baseRevision: revision, agent, elementId: null });
  }
  return null;
}

export async function executeVoiceTool(env: Bindings, projectId: string, owner: string, sessionId: string, agent: AgentId, selected: string | null, call: VoiceToolCall, meeting = false): Promise<unknown> {
  const operationId = await voiceOperationId(sessionId, call.call_id);
  const receipt = await env.DB.prepare('SELECT result FROM voice_tool_results WHERE operation_id = ? AND project_id = ?').bind(operationId, projectId).first<{ result: string }>();
  if (receipt) return JSON.parse(receipt.result);
  const session = await env.DB.prepare('SELECT id FROM voice_sessions WHERE id = ? AND project_id = ? AND owner_id = ?').bind(sessionId, projectId, owner).first();
  if (!session) return { error: 'The voice session has ended. No action was applied.' };
  const project = await ownedProject(env, projectId, owner);
  const remember = async (result: unknown) => {
    await env.DB.prepare('INSERT OR IGNORE INTO voice_tool_results(operation_id,project_id,result,created_at) VALUES(?,?,?,?)').bind(operationId, projectId, JSON.stringify(result), new Date().toISOString()).run();
    return result;
  };
  try {
    const args = JSON.parse(call.arguments);
    const interaction = voiceInteractionRequest(call.name, args, operationId, agent, project.revision);
    const previous = await env.DB.prepare('SELECT request_json FROM conversation_turns WHERE id = ? AND project_id = ?').bind(operationId, projectId).first<{ request_json: string }>();
    if (previous) {
      if (!interaction) throw new HttpError(409, 'This voice call ID was already used for another request.');
      const original = InteractionRequestSchema.parse(JSON.parse(previous.request_json));
      // Brief/answer tools read their revision on the server. Recover that
      // original revision only when the actual command is otherwise identical.
      // A design change carries a caller-supplied revision and must match it too.
      const comparable = interaction.intent === 'change' ? interaction : { ...interaction, baseRevision: original.baseRevision };
      if (JSON.stringify(comparable) !== JSON.stringify(original)) throw new HttpError(409, 'This voice call ID was already used for another request.');
      const recovered = await handleInteraction(env, projectId, owner, original);
      return await remember(recovered);
    }
    if (call.name === 'get_project_context') {
      const design = await designFromRow(env, project);
      const [tasks, changes, effectiveRequirements, clarification] = await Promise.all([
        env.DB.prepare('SELECT agent,title,status,detail FROM tasks WHERE project_id = ? ORDER BY rowid DESC LIMIT 12').bind(projectId).all(),
        env.DB.prepare('SELECT instruction,status,base_revision,started_at,applied_at,applied_revision,reviewed_at,reviewed_revision,review_summary,review_findings,failure_detail FROM changes WHERE project_id = ? ORDER BY rowid DESC LIMIT 12').bind(projectId).all(),
        readEffectiveRequirements(env, projectId, BriefSchema.parse(JSON.parse(project.brief)), project.revision),
        getClarification(env, projectId),
      ]);
      return { currentAgent: agents[agent], location: meeting ? 'meeting room (whole team)' : agents[agent].role + ' workstation', brief: JSON.parse(project.brief), revision: project.revision, status: project.status, generationEnabled: String(env.GENERATION_ENABLED) === 'true', selectedElementId: selected,
        design: design ? { title: design.title, floors: design.floors, spaces: design.spaces, elements: design.elements.map(({ id, name, materialId }) => ({ id, name, materialId })), materials: design.materials } : null,
        tasks: tasks.results, changes: changes.results, effectiveRequirements, clarification };
    }
    let result: unknown;
    if (call.name === 'review_team') {
      if (!meeting || project.design_key) throw new HttpError(409, 'Meet at the team table before the first design.');
      return { perspectives: await reviewMeeting(env, projectId, owner, BriefSchema.parse(JSON.parse(project.brief))) };
    } else if (call.name === 'finish_meeting') {
      z.object({confirmed:z.literal(true)}).parse(args);
      const clarification = await getClarification(env, projectId);
      if (clarification && ['awaiting_input', 'queued'].includes(clarification.status)) throw new HttpError(409, 'Read the current clarification and answer its pending questions. The existing briefing continues when its required answers are saved.');
      if (String(env.GENERATION_ENABLED) !== 'true') throw new HttpError(503, 'Design generation is paused.');
      if (project.design_key) throw new HttpError(409, 'Use a contextual change for an existing design.');
      if (!hasMeaningfulBrief(JSON.parse(project.brief).request)) throw new HttpError(409, 'Save the user brief first.');
      await credential(env, owner);
      if (!env.E2B_API_KEY) throw new HttpError(503, 'Your brief can be saved, but remote computers are not configured for design work.');
      const active = await env.DB.prepare("SELECT id,project_id FROM runs WHERE owner_id = ? AND status IN ('queued','in_progress')").bind(owner).first<{id:string;project_id:string}>();
      if (active) return active.project_id === projectId
        ? {runId:active.id, alreadyStarted:true, message:'The team is already working. Keep the voice call open for steering.'}
        : {error:'Another project is still working. Wait for it to finish or stop that project from its panel; this voice call remains available.'};
      const started = await env.PROJECTS.getByName(projectId).requestRun({projectId,userId:owner,runId:operationId,kind:'generate',baseRevision:project.revision,instruction:'[VOICE_START] The user explicitly said start working. Proceed with the saved brief. Infer reasonable defaults for unresolved preferences; only pause for impossible requirements or platform limits.'});
      if (!started.ok) throw new HttpError(started.status, started.message);
      const announcement = "That wraps up our questions for now. Your project is queued, and we're getting ready to head to our rooms and work. You can visit us and keep talking to steer the design.";
      result = { ...started, queued: true, announcement };
      await emit(env, projectId, 'meeting_ended', announcement, 'principal', null, operationId + '-start');
    } else if (call.name === 'request_change') {
      if (String(env.GENERATION_ENABLED) !== 'true') throw new HttpError(503, 'Design generation is paused. Your spoken brief can still be saved before generation.');
      if (!project.design_key) throw new HttpError(409, 'Save the requirements as brief details, then use Start team briefing.');
      const change = interaction!;
      if (change.elementId) {
        const design = await designFromRow(env, project);
        if (!design?.elements.some(element => element.id === change.elementId)) throw new HttpError(409, 'The requested element does not exist. Read the current context and clarify the target.');
      }
      result = await handleInteraction(env, projectId, owner, change);
    } else if (call.name === 'answer_clarification') {
      result = await handleInteraction(env, projectId, owner, interaction!);
    } else if (call.name === 'save_brief') {
      if (project.design_key) throw new HttpError(409, 'A design already exists. Use a contextual change request.');
      // The shared handler saves the append and its operation receipt atomically.
      // A replay after losing this voice receipt therefore cannot append twice.
      const saved = await handleInteraction(env, projectId, owner, interaction!);
      result = saved;
    } else throw new HttpError(400, 'Unknown voice tool.');
    return await remember(result);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : error instanceof z.ZodError
      ? 'The voice tool supplied invalid or incomplete details. Read the current project context and send only the new requirement (1–4000 characters), or the exact current question IDs and user answers. No success is confirmed.'
      : 'The studio could not confirm this action. Check the saved brief and Activity before retrying; do not assume the requirements were saved or work started.';
    // Failures must be visible outside speech, without logging speech, keys,
    // provider payloads or raw database errors. Do not cache a failed receipt.
    console.warn(JSON.stringify({ event: 'voice_tool_failed', tool: call.name, status: error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500 }));
    await emit(env, projectId, 'error', `Voice action ${call.name}: ${message}`, agent, null, `voice-tool-failed-${operationId}`).catch(() => {});
    return { error: message };
  }
}
