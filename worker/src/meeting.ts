import { z } from 'zod';
import { type AgentId, type Brief } from '../../shared/design';
import type { Bindings } from './types';
import { modelJSON } from './ai';
import { emit } from './store';
import type { TaskTimeBudget } from './task-time';
import { BRIEFING_MODEL_LIMITS } from './model-settings';

const Perspective = z.object({ understanding: z.string().max(700), question: z.string().max(500).nullable() });
export async function reviewMeeting(env: Bindings, projectId: string, owner: string, brief: Brief, timeBudget?: TaskTimeBudget) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(brief.request));
  const key = projectId + '-brief-' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  await emit(env, projectId, 'meeting_started', 'The whole team is listening to the shared brief.', 'principal', null, key + '-start');
  const perspectives = await Promise.allSettled((['architect', 'designer', 'critic'] as AgentId[]).map(async agent => {
    const operation = key + '-' + agent;
    const saved = await env.DB.prepare('SELECT message FROM events WHERE project_id = ? AND operation_id = ?').bind(projectId, operation).first<{message:string}>();
    if (saved) return { agent, message: saved.message };
    const view = await modelJSON(env, owner, agent, `You are attending the initial team meeting. Read this shared user brief: ${JSON.stringify(brief)}. In one concise statement explain what you understand and what your role will do. Ask ONE question only if an unresolved ambiguity materially changes occupancy, scale, feasibility or design direction. Do not ask details already provided or claim work has started. Otherwise question=null, and explicitly end your understanding with "I have no more questions for now; I'm ready to work." This expresses readiness, not permission to start; the Principal handles the user's go-ahead.`, Perspective, undefined, [], 'low', timeBudget, BRIEFING_MODEL_LIMITS);
    const message = view.understanding + (view.question ? '\nQuestion: ' + view.question : '');
    await emit(env, projectId, 'agent_message', message, agent, null, operation);
    return { agent, message };
  }));
  const failure = perspectives.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return perspectives.map(result => (result as PromiseFulfilledResult<{agent: AgentId; message: string}>).value);
}
