import { z } from 'zod';
import { BriefSchema, type Brief } from '../../shared/design';
import type { Clarification, InteractionResult } from '../../shared/conversation';
import type { Bindings, RunParams } from './types';
import { HttpError, credential, ownedProject } from './security';

type ClarificationRow = {
  id: string; project_id: string; run_id: string; version: number; status: Clarification['status'];
  questions_json: string; brief_json: string; base_revision: number;
  continuation_run_id: string | null; detail: string | null;
};
const AnswerSchema = z.object({
  operationId: z.string().uuid(), clarificationId: z.string().min(1).max(200), version: z.number().int().positive(),
  answers: z.array(z.object({ questionId: z.string().min(1).max(200), answer: z.string().trim().min(1).max(2000) })).min(1).max(3),
});
type AnswerInput = z.infer<typeof AnswerSchema>;
function fromRow(row: ClarificationRow): Clarification {
  return { id: row.id, runId: row.run_id, version: row.version, status: row.status,
    questions: JSON.parse(row.questions_json), continuationRunId: row.continuation_run_id, detail: row.detail };
}
export async function getClarification(env: Bindings, projectId: string): Promise<Clarification | null> {
  const row = await env.DB.prepare('SELECT * FROM project_clarifications WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(projectId).first<ClarificationRow>();
  return row ? fromRow(row) : null;
}
async function receipt(env: Bindings, projectId: string, operationId: string, request: string): Promise<InteractionResult | null> {
  const saved = await env.DB.prepare('SELECT project_id, request_json, result_json FROM interaction_receipts WHERE operation_id = ?').bind(operationId).first<{project_id:string;request_json:string;result_json:string}>();
  if (!saved) return null;
  if (saved.project_id !== projectId || saved.request_json !== request) throw new HttpError(409, 'This operation ID was already used for another message.');
  return JSON.parse(saved.result_json);
}
function eventStatement(env: Bindings, projectId: string, operationId: string, type: string, message: string) {
  return env.DB.prepare("INSERT OR IGNORE INTO events(project_id,type,agent,revision,message,created_at,operation_id) SELECT p.id,?,'principal',p.revision,?,?,? FROM projects p JOIN interaction_receipts r ON r.project_id = p.id WHERE p.id = ? AND r.operation_id = ?")
    .bind(type, message, new Date().toISOString(), `interaction-${operationId}`, projectId, operationId);
}

/** This checkpoint is replay-safe, including cancellation while the Principal was answering. */
export async function requestClarification(env: Bindings, p: RunParams, brief: Brief) {
  const saved = await env.DB.prepare('SELECT id FROM project_clarifications WHERE run_id = ? AND project_id = ?').bind(p.runId, p.projectId).first();
  if (saved) return;
  // Keep a durable wake-up before the D1 outbox can be written. Awaiting-input
  // records keep this alarm alive, so a crash after an answer cannot strand it.
  await env.PROJECTS.getByName(p.projectId).scheduleChanges(p.projectId, p.userId);
  const now = new Date().toISOString(), id = `clarification-${p.runId}`;
  const questions = brief.questions.map((question, index) => ({ id: `${id}-${index + 1}`, question, answer: null }));
  const statements = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO project_clarifications(id,project_id,run_id,status,questions_json,brief_json,base_revision,created_at,updated_at) SELECT ?,p.id,r.id,'awaiting_input',?,?,p.revision,?,? FROM projects p JOIN runs r ON r.project_id = p.id WHERE p.id = ? AND p.owner_id = ? AND p.brief = ? AND r.id = ? AND r.status = 'in_progress'")
      .bind(id, JSON.stringify(questions), JSON.stringify(brief), now, now, p.projectId, p.userId, JSON.stringify(brief), p.runId),
    env.DB.prepare("UPDATE runs SET status = 'awaiting_input' WHERE id = ? AND status = 'in_progress' AND EXISTS (SELECT 1 FROM project_clarifications WHERE run_id = runs.id AND status = 'awaiting_input')").bind(p.runId),
    env.DB.prepare("UPDATE tasks SET title = 'Clarify brief', status = 'blocked', detail = ? WHERE id = ? AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'awaiting_input')").bind(brief.questions.join('\n'), `${p.runId}-principal`, p.runId),
    env.DB.prepare("UPDATE projects SET status = 'awaiting_input', updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'awaiting_input')").bind(now, p.projectId, p.runId),
    env.DB.prepare("INSERT OR IGNORE INTO events(project_id,type,agent,task_id,revision,message,created_at,operation_id) SELECT project_id,'clarification_requested','principal',?,base_revision,?,?,? FROM project_clarifications WHERE id = ? AND status = 'awaiting_input'").bind(`${p.runId}-principal`, brief.questions.join('\n'), now, `clarification-requested-${p.runId}`, id),
  ]);
  if (!statements[0].meta.changes && !await env.DB.prepare('SELECT id FROM project_clarifications WHERE id = ?').bind(id).first()) throw new HttpError(409, 'Work stopped before the clarification could be saved.');
}

export async function answerClarification(env: Bindings, projectId: string, owner: string, input: AnswerInput): Promise<InteractionResult> {
  const data = AnswerSchema.parse(input), project = await ownedProject(env, projectId, owner);
  // Stable order allows transport retries without depending on answer order.
  data.answers.sort((a, b) => a.questionId.localeCompare(b.questionId));
  const request = JSON.stringify({ intent: 'answer_clarification', ...data });
  const duplicate = await receipt(env, projectId, data.operationId, request);
  if (duplicate) { if (duplicate.queued) await env.PROJECTS.getByName(projectId).scheduleChanges(projectId, owner); return duplicate; }
  const row = await env.DB.prepare('SELECT * FROM project_clarifications WHERE id = ? AND project_id = ?').bind(data.clarificationId, projectId).first<ClarificationRow>();
  if (!row || row.status !== 'awaiting_input' || row.version !== data.version || row.brief_json !== project.brief || row.base_revision !== project.revision) throw new HttpError(409, 'These questions changed or were stopped. Refresh the project before answering.');
  const questions = fromRow(row).questions, ids = new Set<string>();
  for (const answer of data.answers) {
    const question = questions.find(item => item.id === answer.questionId);
    if (!question || question.answer !== null || ids.has(answer.questionId)) throw new HttpError(409, 'Answer each currently open question once. Refresh the questions before continuing.');
    ids.add(answer.questionId); question.answer = answer.answer;
  }
  const brief = BriefSchema.parse(JSON.parse(project.brief));
  const accepted = questions.filter(question => ids.has(question.id)).map(question => ({ question: question.question, answer: question.answer! }));
  const additions = accepted.map(question => `${question.question}\nAnswer: ${question.answer}`).join('\n\n');
  const expandedRequest = `${brief.request}\n\nClient clarification:\n${additions}`;
  // Answers have a separate durable field so a full-length original brief can
  // still be clarified without truncating either the request or the answers.
  const updated = BriefSchema.parse({ ...brief, request: expandedRequest.length <= 8000 ? expandedRequest : brief.request,
    clarificationAnswers: [...(brief.clarificationAnswers || []), ...accepted], questions: questions.filter(question => question.answer === null).map(question => question.question) });
  const ready = updated.questions.length === 0, continuationId = ready ? crypto.randomUUID() : null;
  const reply = ready ? "That answers all our current questions. Your answers are saved, and we're ready to get back to work. The continuation is queued and will start automatically when generation is available and your current work has finished; you don't need to say start again." : 'Your answer is saved. Please answer the remaining questions so the team can continue.';
  const result: InteractionResult = { intent: 'answer_clarification', reply, operationId: data.operationId, saved: true, queued: ready, ...(continuationId ? { runId: continuationId } : {}) };
  await env.PROJECTS.getByName(projectId).scheduleChanges(projectId, owner);
  const now = new Date().toISOString();
  const saved = await env.DB.batch([
    env.DB.prepare("UPDATE projects SET brief = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND brief = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM interaction_receipts WHERE operation_id = ?) AND EXISTS (SELECT 1 FROM project_clarifications c JOIN runs r ON r.id = c.run_id WHERE c.id = ? AND c.project_id = projects.id AND c.status = 'awaiting_input' AND c.version = ? AND r.status = 'awaiting_input') AND NOT EXISTS (SELECT 1 FROM runs WHERE project_id = projects.id AND kind IN ('generate','change') AND status IN ('queued','in_progress'))")
      .bind(JSON.stringify(updated), now, projectId, owner, project.brief, project.revision, data.operationId, row.id, data.version),
    env.DB.prepare('UPDATE project_clarifications SET questions_json = ?, brief_json = ?, version = version + 1, status = ?, continuation_run_id = ?, detail = ?, updated_at = ? WHERE id = ? AND changes() = 1')
      .bind(JSON.stringify(questions), JSON.stringify(updated), ready ? 'queued' : 'awaiting_input', continuationId, ready ? 'Answers saved; waiting for the team to continue.' : null, now, row.id),
    env.DB.prepare('INSERT OR IGNORE INTO interaction_receipts(operation_id,project_id,request_json,result_json,created_at) SELECT ?,?,?,?,? WHERE changes() = 1').bind(data.operationId, projectId, request, JSON.stringify(result), now),
    eventStatement(env, projectId, data.operationId, 'clarification_received', reply),
  ]);
  if (!saved[0].meta.changes) {
    const replay = await receipt(env, projectId, data.operationId, request); if (replay) return replay;
    throw new HttpError(409, 'The brief or questions changed while your answer was being saved. Refresh and try again.');
  }
  return result;
}

export async function saveBriefDetails(env: Bindings, projectId: string, owner: string, input: {operationId:string;details:string}): Promise<InteractionResult> {
  const data = z.object({ operationId: z.string().uuid(), details: z.string().trim().min(1).max(4000) }).parse(input);
  const project = await ownedProject(env, projectId, owner), request = JSON.stringify({ intent: 'brief_update', ...data });
  const duplicate = await receipt(env, projectId, data.operationId, request); if (duplicate) return duplicate;
  if (project.design_key) throw new HttpError(409, 'Use a contextual change request to update an existing design.');
  const brief = BriefSchema.parse(JSON.parse(project.brief));
  const placeholder = brief.request === 'Awaiting your spoken project brief.';
  // A first spoken detail ("4 people", "a house") need not be a complete
  // ten-character brief. Preserve it verbatim with a descriptive label.
  const nextRequest = placeholder ? (data.details.length < 10 ? `Client requirements:\n${data.details}` : data.details) : `${brief.request}\n\nClient requirements:\n${data.details}`;
  if (nextRequest.length > 8000) throw new HttpError(409, 'Your saved brief is full (8,000 characters). Earlier requirements are safe. Shorten it in View & edit brief, then repeat this new detail; it has not been added yet.');
  const updated = BriefSchema.parse({ ...brief, request: nextRequest, summary: (placeholder ? data.details : `${brief.summary}\n${data.details}`).slice(0, 2000) });
  const clarification = await getClarification(env, projectId);
  const pending = clarification?.status === 'awaiting_input';
  const result: InteractionResult = { intent: 'brief_update', reply: pending ? 'The extra requirement is saved. Your existing answers and open questions are unchanged. Read the current questions and answer those still open so the team can continue.' : 'Saved to your project brief. Start team briefing when you are ready.', operationId: data.operationId, saved: true };
  const now = new Date().toISOString();
  const saved = await env.DB.batch([
    env.DB.prepare("UPDATE projects SET brief = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND brief = ? AND design_key IS NULL AND NOT EXISTS (SELECT 1 FROM interaction_receipts WHERE operation_id = ?) AND NOT EXISTS (SELECT 1 FROM runs WHERE project_id = ? AND status IN ('queued','in_progress')) AND NOT EXISTS (SELECT 1 FROM project_clarifications WHERE project_id = ? AND status = 'queued') AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.project_id = projects.id AND r.status = 'awaiting_input' AND NOT EXISTS (SELECT 1 FROM project_clarifications c WHERE c.run_id = r.id AND c.project_id = projects.id AND c.status = 'awaiting_input' AND c.brief_json = projects.brief AND c.base_revision = projects.revision))")
      .bind(JSON.stringify(updated), now, projectId, owner, project.brief, data.operationId, projectId, projectId),
    env.DB.prepare('INSERT OR IGNORE INTO interaction_receipts(operation_id,project_id,request_json,result_json,created_at) SELECT ?,?,?,?,? WHERE changes() = 1').bind(data.operationId, projectId, request, JSON.stringify(result), now),
    // Keep the waiting checkpoint aligned atomically, without answering,
    // cancelling or auto-starting it. Old question versions must refresh.
    env.DB.prepare("UPDATE project_clarifications SET brief_json = ?, version = version + 1, updated_at = ? WHERE project_id = ? AND status = 'awaiting_input' AND brief_json = ? AND EXISTS (SELECT 1 FROM interaction_receipts WHERE operation_id = ? AND project_id = ?)")
      .bind(JSON.stringify(updated), now, projectId, project.brief, data.operationId, projectId),
    eventStatement(env, projectId, data.operationId, 'clarification_received', 'Requirements saved to the project brief.'),
  ]);
  if (!saved[0].meta.changes) {
    const replay = await receipt(env, projectId, data.operationId, request); if (replay) return replay;
    const active = await env.DB.prepare("SELECT id,kind,status FROM runs WHERE project_id = ? AND status IN ('queued','in_progress') LIMIT 1").bind(projectId).first<{ id: string; kind: string; status: string }>();
    if (active) throw new HttpError(409, 'The team already has an active job and is using the current brief. This new detail has not been added to that brief. Wait for the job to finish or stop it in Activity before updating the brief; do not start another job.');
    throw new HttpError(409, 'The brief changed or the team is already starting work. This detail was not added. Read the latest project context before retrying; wait for active work to finish before editing its brief.');
  }
  return result;
}

/** Full replacement is an explicit reset of pending questions, not an answer. */
export async function replaceBrief(env: Bindings, projectId: string, owner: string, input: {name:string;brief:Brief}) {
  const project = await ownedProject(env, projectId, owner), brief = BriefSchema.parse(input.brief), now = new Date().toISOString();
  const saved = await env.DB.batch([
    env.DB.prepare("UPDATE projects SET name = ?, brief = ?, status = CASE WHEN status = 'awaiting_input' THEN 'draft' ELSE status END, updated_at = ? WHERE id = ? AND owner_id = ? AND brief = ? AND NOT EXISTS (SELECT 1 FROM runs WHERE project_id = ? AND status IN ('queued','in_progress'))").bind(input.name, JSON.stringify(brief), now, projectId, owner, project.brief, projectId),
    env.DB.prepare("INSERT INTO events(project_id,type,agent,revision,message,created_at) SELECT id,'clarification_received','principal',revision,'The project brief was updated. Start team briefing when ready.',? FROM projects WHERE id = ? AND changes() = 1").bind(now, projectId),
    env.DB.prepare("UPDATE project_clarifications SET status = 'superseded', detail = 'The brief was replaced. Start a new briefing when ready.', updated_at = ? WHERE project_id = ? AND status IN ('awaiting_input','queued') AND changes() = 1").bind(now, projectId),
    env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE project_id = ? AND status = 'awaiting_input' AND EXISTS (SELECT 1 FROM project_clarifications WHERE run_id = runs.id AND status = 'superseded')").bind(projectId),
    env.DB.prepare("UPDATE tasks SET status = 'cancelled' WHERE project_id = ? AND status = 'blocked' AND EXISTS (SELECT 1 FROM runs WHERE id = tasks.run_id AND status = 'cancelled')").bind(projectId),
  ]);
  if (!saved[0].meta.changes) throw new HttpError(409, 'Work started or the brief changed. Refresh before replacing the brief.');
  return { saved: true };
}

export async function cancelClarification(env: Bindings, projectId: string, owner: string, runId: string): Promise<{cancelled:boolean}> {
  await ownedProject(env, projectId, owner);
  const now = new Date().toISOString();
  const linked = await env.DB.prepare("SELECT continuation_run_id FROM project_clarifications WHERE project_id = ? AND run_id = ? AND (status IN ('awaiting_input','queued') OR (status = 'continued' AND EXISTS (SELECT 1 FROM runs WHERE id = continuation_run_id AND status IN ('queued','in_progress'))))").bind(projectId, runId).first<{continuation_run_id:string|null}>();
  if (!linked) return { cancelled: false };
  const saved = await env.DB.batch([
    env.DB.prepare("UPDATE project_clarifications SET status = 'cancelled', detail = 'Briefing stopped. Your saved answers are retained.', updated_at = ? WHERE project_id = ? AND run_id = ? AND (status IN ('awaiting_input','queued') OR (status = 'continued' AND EXISTS (SELECT 1 FROM runs WHERE id = continuation_run_id AND status IN ('queued','in_progress'))))").bind(now, projectId, runId),
    env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE project_id = ? AND owner_id = ? AND ((id = ? AND status IN ('awaiting_input','completed')) OR (id = (SELECT continuation_run_id FROM project_clarifications WHERE project_id = ? AND run_id = ?) AND status IN ('queued','in_progress'))) AND EXISTS (SELECT 1 FROM project_clarifications WHERE run_id = ? AND status = 'cancelled')").bind(projectId, owner, runId, projectId, runId, runId),
    env.DB.prepare("UPDATE tasks SET status = 'cancelled' WHERE (run_id = ? OR run_id = (SELECT continuation_run_id FROM project_clarifications WHERE project_id = ? AND run_id = ?)) AND status IN ('blocked','queued','in_progress','review') AND EXISTS (SELECT 1 FROM runs WHERE id = tasks.run_id AND status = 'cancelled')").bind(runId, projectId, runId),
    env.DB.prepare("UPDATE projects SET status = CASE WHEN design_key IS NULL THEN 'draft' ELSE 'review' END, updated_at = ? WHERE id = ? AND status = 'awaiting_input' AND EXISTS (SELECT 1 FROM project_clarifications WHERE run_id = ? AND status = 'cancelled')").bind(now, projectId, runId),
    env.DB.prepare("INSERT OR IGNORE INTO events(project_id,type,agent,revision,message,created_at,operation_id) SELECT p.id,'task_cancelled','principal',p.revision,'Briefing stopped. Your saved answers and revisions remain available.',?,? FROM projects p JOIN project_clarifications c ON c.project_id = p.id WHERE p.id = ? AND c.run_id = ? AND c.status = 'cancelled'").bind(now, `clarification-cancelled-${runId}`, projectId, runId),
  ]);
  const cancelled = await env.DB.prepare("SELECT continuation_run_id FROM project_clarifications WHERE project_id = ? AND run_id = ? AND status = 'cancelled'").bind(projectId, runId).first<{continuation_run_id:string|null}>();
  if (saved[0].meta.changes && cancelled?.continuation_run_id) {
    try { await (await env.JOBS.get(cancelled.continuation_run_id)).terminate(); } catch { /* D1 is the cancellation fence, including provider dispatch races. */ }
    const prefix = `${cancelled.continuation_run_id}-`;
    const desktops = await env.DB.prepare('SELECT lease_id FROM desktop_sessions WHERE project_id = ? AND substr(lease_id,1,?) = ?').bind(projectId, prefix.length, prefix).all<{lease_id:string}>();
    for (const desktop of desktops.results) await env.BUDGET.getByName('desktop-budget').release(desktop.lease_id);
  }
  return { cancelled: !!saved[0].meta.changes };
}

/** D1 is the outbox; retries always use the same continuation run ID. */
export async function dispatchClarification(env: Bindings, projectId: string, owner: string, begin: (params:RunParams) => Promise<{runId:string}>) {
  const row = await env.DB.prepare("SELECT * FROM project_clarifications WHERE project_id = ? AND (status = 'queued' OR (status = 'continued' AND EXISTS (SELECT 1 FROM runs WHERE id = continuation_run_id AND status = 'queued' AND workflow_dispatched = 0))) ORDER BY created_at LIMIT 1").bind(projectId).first<ClarificationRow>();
  if (!row?.continuation_run_id) return;
  const project = await ownedProject(env, projectId, owner);
  if (row.status === 'queued' && (project.revision !== row.base_revision || project.brief !== row.brief_json)) {
    const now = new Date().toISOString(), detail = 'The design or brief changed before this continuation could start. Start a new team briefing using the current project.';
    await env.DB.batch([
      env.DB.prepare("UPDATE project_clarifications SET status = 'superseded', detail = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status = 'queued' AND EXISTS (SELECT 1 FROM projects WHERE id = project_clarifications.project_id AND owner_id = ? AND (revision <> project_clarifications.base_revision OR brief <> project_clarifications.brief_json))").bind(detail, now, row.id, projectId, owner),
      env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE id = ? AND project_id = ? AND status = 'awaiting_input' AND EXISTS (SELECT 1 FROM project_clarifications WHERE id = ? AND status = 'superseded')").bind(row.run_id, projectId, row.id),
      env.DB.prepare("UPDATE tasks SET status = 'cancelled' WHERE run_id = ? AND status = 'blocked' AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'cancelled')").bind(row.run_id, row.run_id),
      env.DB.prepare("UPDATE projects SET status = CASE WHEN design_key IS NULL THEN 'draft' ELSE 'review' END, updated_at = ? WHERE id = ? AND status = 'awaiting_input' AND EXISTS (SELECT 1 FROM project_clarifications WHERE id = ? AND status = 'superseded') AND NOT EXISTS (SELECT 1 FROM runs WHERE project_id = projects.id AND status IN ('queued','in_progress'))").bind(now, projectId, row.id),
      env.DB.prepare("INSERT OR IGNORE INTO events(project_id,type,agent,revision,message,created_at,operation_id) SELECT p.id,'agent_message','principal',p.revision,?,?,? FROM projects p JOIN project_clarifications c ON c.project_id = p.id WHERE c.id = ? AND c.status = 'superseded'").bind(detail, now, `clarification-superseded-${row.id}`, row.id),
    ]);
    return;
  }
  if (String(env.GENERATION_ENABLED) !== 'true') {
    await env.DB.prepare("UPDATE project_clarifications SET detail = 'Answers saved. Generation is paused; the team will continue when it is enabled.' WHERE id = ? AND status IN ('queued','continued')").bind(row.id).run(); return;
  }
  const active = await env.DB.prepare("SELECT id FROM runs WHERE owner_id = ? AND status IN ('queued','in_progress') AND id <> ?").bind(owner, row.continuation_run_id).first();
  if (active) return;
  const parent = await env.DB.prepare('SELECT reference_artifact_id, context_artifact_id FROM runs WHERE id = ? AND project_id = ? AND owner_id = ?').bind(row.run_id, projectId, owner).first<{reference_artifact_id:string|null;context_artifact_id:string|null}>();
  if (!parent) return;
  try {
    await credential(env, owner);
    if (!env.E2B_API_KEY) throw new HttpError(503, 'Computer access is not configured.');
    await begin({ projectId, userId: owner, runId: row.continuation_run_id, kind: 'generate', baseRevision: row.base_revision, resumesRunId: row.run_id, referenceArtifactId: parent.reference_artifact_id, contextArtifactId: parent.context_artifact_id });
  } catch {
    await env.DB.prepare("UPDATE project_clarifications SET detail = 'Answers saved. The team could not start yet; dispatch will retry automatically.' WHERE id = ? AND status IN ('queued','continued')").bind(row.id).run();
  }
}
