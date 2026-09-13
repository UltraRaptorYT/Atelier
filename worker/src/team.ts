import type { WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import { AgentIdSchema, DesignSchema, recolor, reviewDesign, type Brief, type Design } from '../../shared/design';
import { PlanSchema, readyTasks, validatePlan, mergeDesignProposal, type PlannedTask } from '../../shared/collaboration';
import type { Bindings, RunParams } from './types';
import { modelJSON } from './ai';
import { artifact, designFromRow, emit } from './store';
import { ownedProject, HttpError } from './security';
import { createDesktop, releaseDesktop, syncDesktop, checkpointDesktop, runVisible } from './desktop';
import { loadImageReference, visualReferenceInstructions } from './images';

const ReviewSchema = z.object({ findings: z.array(z.string().max(1000)).max(20), summary: z.string().max(3000) });
const DirectionSchema = z.object({
  summary: z.string().max(3000), recommendations: z.array(z.string().max(1000)).max(20),
  coordination: z.array(z.object({ target: AgentIdSchema, message: z.string().max(1000) })).max(6),
});
const DecisionSchema = z.object({ decision: z.string().max(3000), instruction: z.string().min(1).max(4000) });
const options = { retries: { limit: 0, delay: '1 second' }, timeout: '10 minutes' } as const;
type Base = { revision: number; design: Design | null };
type Result = { artifactId: string; baseRevision: number; proposal: Design | null; summary: string; findings: string[]; recommendations: string[]; coordination: { target: string; message: string }[] };
type LocalColor = { color: string; elementId: string };

/** Run a persisted dependency graph. Only publication serializes; independent proposals run together. */
export async function runTeam(env: Bindings, p: RunParams, step: WorkflowStep, brief: Brief, referenceId: string | null, local: LocalColor | null = null) {
  const coordinator = env.PROJECTS.getByName(p.projectId);
  const checkCancelled = async () => {
    const row = await env.DB.prepare('SELECT status FROM runs WHERE id = ?').bind(p.runId).first<{ status: string }>();
    if (row?.status !== 'in_progress') throw new HttpError(409, 'Work stopped. Saved revisions are preserved.');
  };
  const current = async (): Promise<Base> => {
    await checkCancelled();
    const row = await ownedProject(env, p.projectId, p.userId);
    return { revision: row.revision, design: await designFromRow(env, row) };
  };
  async function updateTask(id: string, status: string, detail: string, baseRevision: number | null = null, artifactId: string | null = null, artifactRevision: number | null = null) {
    const result = await env.DB.prepare("UPDATE tasks SET status = ?, detail = ?, base_revision = COALESCE(?,base_revision), artifact_id = COALESCE(?,artifact_id), artifact_revision = COALESCE(?,artifact_revision) WHERE id = ? AND run_id = ? AND EXISTS (SELECT 1 FROM runs WHERE id = tasks.run_id AND status = 'in_progress')")
      .bind(status, detail, baseRevision, artifactId, artifactRevision, id, p.runId).run();
    if (!result.meta.changes) throw new HttpError(409, 'The run stopped before this task could update its status.');
  }
  const decision = async (key: string, topic: string, text: string) => {
    await env.DB.prepare('INSERT OR IGNORE INTO decisions(id,project_id,run_id,topic,decision,created_at) VALUES(?,?,?,?,?,?)')
      .bind(`${p.runId}-${key}`, p.projectId, p.runId, topic, text, new Date().toISOString()).run();
  };
  async function savedArtifact<T>(id: string): Promise<T | null> {
    const row = await env.DB.prepare('SELECT object_key FROM artifacts WHERE project_id = ? AND id = ?').bind(p.projectId, id).first<{ object_key: string }>();
    if (!row) return null;
    const file = await env.FILES.get(row.object_key);
    if (!file) throw new HttpError(503, 'A saved task result is temporarily unavailable.');
    return file.json<T>();
  }
  async function desktopFor(task: PlannedTask, key: string, rowId: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const sandboxId = await step.do(`${key}-computer-${attempt}`, { ...options, timeout: '2 minutes' }, async () => {
        await checkCancelled();
        try { return (await createDesktop(env, p.projectId, p.userId, task.agent, `${p.runId}-${key}-${attempt}`)).sandboxId; }
        catch (error) {
          if (!(error instanceof HttpError) || error.status !== 425) throw error;
          await updateTask(rowId, 'queued', 'Dependencies are ready; waiting for an available computer.');
          return null;
        }
      });
      if (sandboxId) return sandboxId;
      await step.sleep(`${key}-computer-wait-${attempt}`, '30 seconds');
    }
    throw new HttpError(408, 'The computer queue timed out. Saved task results are preserved.');
  }

  async function execute(task: PlannedTask, key: string, rowId: string, base: Base, dependencies: Record<string, Result>, extraInstruction = '', color: LocalColor | null = null): Promise<Result> {
    const usesComputer = (task.kind === 'architecture' || task.kind === 'interior' || (task.kind === 'review' && Boolean(base.design))) && !color;
    try {
      const persisted = await step.do(`${key}-saved-result`, async () => { await checkCancelled(); return savedArtifact<Result>(`${p.runId}-${key}-result.json`); });
      if (persisted) return persisted;
      const sandboxId = usesComputer ? await desktopFor(task, key, rowId) : null;
      return await step.do(`${key}-work`, options, async () => {
        await checkCancelled();
        const cached = await savedArtifact<Result>(`${p.runId}-${key}-result.json`);
        if (cached) return cached;
        await updateTask(rowId, 'in_progress', task.objective, base.revision);
        await emit(env, p.projectId, 'task_started', `${task.title}: ${task.objective}`, task.agent, rowId, `${p.runId}-${key}-started`);
        const images = referenceId ? [(await loadImageReference(env, p.projectId, referenceId)).dataUrl] : [];
        const visual = referenceId ? `Visual reference artifact: ${referenceId}. ${visualReferenceInstructions}` : '';
        const prompt = `Task ${task.id} (${task.kind}). Objective: ${task.objective}. Deliverables: ${JSON.stringify(task.deliverables)}.
Brief: ${JSON.stringify(brief)}. Current design revision ${base.revision}: ${JSON.stringify(base.design)}.
Accepted change for this round: ${p.instruction || 'none'}.
Completed dependencies and their saved outputs: ${JSON.stringify(dependencies)}.
${extraInstruction} ${visual}
Use dependency outputs to coordinate your work. Preserve unrelated elements and stable IDs. Your output is a proposal; the coordinator publishes the canonical revision after checking conflicts.`;
        let desktop;
        if (sandboxId) {
          const { Sandbox } = await import('@e2b/desktop');
          desktop = await Sandbox.connect(sandboxId, { apiKey: env.E2B_API_KEY });
          if (base.design) await syncDesktop(desktop, base.design, env, p.projectId);
          else await desktop.files.write('/home/user/project/design.json', JSON.stringify({ brief }));
        }
        const communications: { target: z.infer<typeof AgentIdSchema>; message: string }[] = [];
        const context = desktop ? { desktop, projectId: p.projectId, taskId: rowId, design: base.design, communications } : undefined;
        const result: Result = { artifactId: `${p.runId}-${key}-result.json`, baseRevision: base.revision, proposal: null, summary: '', findings: [], recommendations: [], coordination: communications };
        if (task.kind === 'visual_direction') {
          Object.assign(result, await modelJSON(env, p.userId, 'designer', `${prompt}\nDevelop a concrete palette, material, furniture and lighting direction. Describe these in recommendations. Send coordination messages only for actual requirements affecting another specialist. Do not invent geometry or tool activity.`, DirectionSchema, undefined, images));
        } else if (task.kind === 'review') {
          const deterministic = base.design ? reviewDesign(base.design) : [];
          const review = await modelJSON(env, p.userId, 'critic', `${prompt}\n${base.design ? 'Review the actual model and its accessible spaces.' : 'Review the brief and dependencies for conflicts and missing requirements; no building exists yet.'} Deterministic findings: ${JSON.stringify(deterministic)}. Raise actionable issues only; distinguish missing evidence from a verified result.`, ReviewSchema, context, images);
          result.summary = review.summary;
          result.findings = [...new Set([...deterministic, ...review.findings])];
        } else {
          const ownership = task.agent === 'designer'
            ? 'You own materials, material assignments, furniture and lights. Preserve metadata, notes, structural geometry, spaces, floors and spawn exactly. Return the complete design with only your owned fields changed.'
            : 'Develop the requested architecture. Make spaces accessible, split upper slabs around stair voids, and keep existing finishes and furniture unless the objective requires changing them. Return the complete design. Use assetId null for procedural elements.';
          result.proposal = color && base.design ? recolor(base.design, color.elementId, color.color) : await modelJSON(env, p.userId, task.agent, `${prompt}\n${ownership}`, DesignSchema, context, images);
          // Enforce ownership before a proposal reaches shared state.
          mergeDesignProposal(base.design, base.design, result.proposal, task.agent);
          result.summary = `${task.title}: design proposal prepared from revision ${base.revision}.`;
          if (desktop) {
            await syncDesktop(desktop, result.proposal, env, p.projectId);
            const validation = await runVisible(desktop, 'python3 -m json.tool /home/user/project/design.json /home/user/project/validated-design.json', 10000);
            if (validation.exitCode !== 0) throw new HttpError(422, 'The workstation could not validate its design proposal.');
          }
        }
        await checkCancelled();
        if (desktop) await checkpointDesktop(env, desktop, p.projectId, `${p.runId}-${key}`, base.revision, task.agent);
        await artifact(env, p.projectId, p.runId, `${key}-result.json`, result.proposal ? 'design-proposal' : task.kind, base.revision, JSON.stringify(result), 'application/json');
        await updateTask(rowId, result.proposal ? 'review' : 'in_progress', result.summary, null, result.artifactId);
        if (task.kind === 'visual_direction') for (const [index, message] of result.coordination.entries()) await emit(env, p.projectId, 'agent_message', `To ${message.target}: ${message.message}`, task.agent, rowId, `${p.runId}-${key}-message-${index}`);
        return result;
      });
    } finally {
      if (usesComputer) await step.do(`${key}-release-computer`, async () => { await releaseDesktop(env, p.projectId, task.agent, `${p.runId}-${key}`); });
    }
  }

  let findings: string[] = [];
  // The Principal may replan once after the final review. This bounds cost and
  // produces explicit outstanding findings instead of an unbounded debate.
  for (let round = 0; round < 2; round++) {
    const phase = `team-${round}`;
    const initial = await step.do(`${phase}-base`, current);
    const plan = await step.do(`${phase}-plan`, { ...options, timeout: '3 minutes' }, async () => {
      await checkCancelled();
      if (round) await emit(env, p.projectId, 'meeting_started', `The Critic found ${findings.length} issues. The Principal is assigning corrections.`, 'principal', null, `${p.runId}-${phase}-meeting-started`);
      await updateTask(`${p.runId}-principal`, 'in_progress', round ? 'Assigning bounded corrections from the design review.' : 'Planning dependencies and independent specialist work.');
      const cached = await savedArtifact<z.infer<typeof PlanSchema>>(`${p.runId}-${phase}-plan.json`);
      const next = cached ? validatePlan(cached, Boolean(initial.design)) : local && round === 0 ? validatePlan({ summary: 'The Designer applies the selected finish; the Critic reviews the resulting revision.', tasks: [
        { id: 'finish', kind: 'interior', agent: 'designer', title: 'Update selected finish', objective: p.instruction || 'Apply the selected colour.', dependencies: [], deliverables: ['Updated element material'] },
        { id: 'review', kind: 'review', agent: 'critic', title: 'Review changed finish', objective: 'Verify the accepted colour change and preserve other requirements.', dependencies: ['finish'], deliverables: ['Design review'] },
      ] }, Boolean(initial.design)) : validatePlan(await modelJSON(env, p.userId, 'principal', `Create a dependency plan for the specialist team.
Brief: ${JSON.stringify(brief)}. Current design: ${JSON.stringify(initial.design)}. Accepted change: ${p.instruction || 'none'}.
Review findings requiring correction: ${JSON.stringify(findings)}.
Choose only work needed now, at most 8 tasks. Each task needs a unique short ID, objective, deliverables and dependencies. Independent tasks should have no unnecessary dependencies; at most two different specialists run together. One specialist performs one task at a time.
Kinds and owners: architecture=architect (canonical geometry), interior=designer (materials, material assignments, furniture, lights), visual_direction=designer (saved palette/material/furniture/lighting recommendations, no geometry edits), review=critic (requirements or actual design review).
For a new house, architecture and visual_direction can begin together. Interior placement needs the architecture and any visual direction. For an existing house, independent structure and finish proposals may run together; finishes-only requests need no Architect. An early Critic review can run independently when useful. Do not invent a required task just to involve a role.
The graph must be acyclic. It needs a design-writing task and a final review that transitively depends on EVERY other task. A new house needs architecture and interior, with interior depending on architecture. Dependent tasks receive actual saved outputs. ${round ? 'This is the final automatic correction round; make the smallest bounded corrections.' : ''}`, PlanSchema), Boolean(initial.design));
      await artifact(env, p.projectId, p.runId, `${phase}-plan.json`, 'task-plan', initial.revision, JSON.stringify(next), 'application/json');
      await decision(`${phase}-plan`, round ? 'Design review corrections' : 'Specialist dependency plan', next.summary);
      for (const [index, task] of next.tasks.entries()) {
        const rowId = `${p.runId}-${phase}-task-${index}`;
        await env.DB.prepare("INSERT OR IGNORE INTO tasks(id,project_id,run_id,agent,title,status,detail,kind,objective,dependencies,deliverables,base_revision) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'in_progress')")
          .bind(rowId, p.projectId, p.runId, task.agent, task.title, 'queued', task.dependencies.length ? `Waiting for ${task.dependencies.join(', ')}.` : 'Ready for a specialist.', task.kind, task.objective, JSON.stringify(task.dependencies.map(id => `${p.runId}-${phase}-task-${next.tasks.findIndex(other => other.id === id)}`)), JSON.stringify(task.deliverables), initial.revision, p.runId).run();
        await emit(env, p.projectId, 'task_created', `${task.title}: ${task.objective}`, task.agent, rowId, `${rowId}-created`);
      }
      await updateTask(`${p.runId}-principal`, 'completed', next.summary);
      await emit(env, p.projectId, 'meeting_ended', next.summary, 'principal', null, `${p.runId}-${phase}-delegated`);
      return next;
    });
    const completed = new Set<string>();
    const outputs: Record<string, Result> = {};
    let wave = 0;
    while (completed.size < plan.tasks.length) {
      const agents = new Set<string>();
      const batch = readyTasks(plan.tasks, completed).filter(task => { if (agents.has(task.agent) || agents.size >= 2) return false; agents.add(task.agent); return true; });
      if (!batch.length) throw new HttpError(422, 'The task plan has no runnable work.');
      const base = await step.do(`${phase}-wave-${wave++}-base`, current);
      // Settle every sibling before handling failure/cancellation. No work is
      // left running after the workflow records failure or publishes dependents.
      const results = await Promise.allSettled(batch.map(async task => {
        const key = `${phase}-task-${plan.tasks.indexOf(task)}`, rowId = `${p.runId}-${key}`;
        return execute(task, key, rowId, base, Object.fromEntries(task.dependencies.map(id => [id, outputs[id]])), '', local && !round && task.kind === 'interior' ? local : null);
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      for (let index = 0; index < batch.length; index++) {
        const task = batch[index], key = `${phase}-task-${plan.tasks.indexOf(task)}`, rowId = `${p.runId}-${key}`;
        let result = (results[index] as PromiseFulfilledResult<Result>).value;
        let revision = result.baseRevision;
        if (result.proposal) {
          let publication = await step.do(`${key}-publish`, async () => { await checkCancelled(); const saved = await coordinator.commitProposal(p.projectId, result.baseRevision, `${p.runId}-${key}`, result.proposal!, p.runId, task.agent); return { revision: saved.revision, conflicts: [...saved.conflicts] }; });
          if (publication.conflicts.length) {
            const resolution = await step.do(`${key}-meeting`, { ...options, timeout: '3 minutes' }, async () => {
              await checkCancelled();
              const cached = await savedArtifact<z.infer<typeof DecisionSchema> & { base: Base }>(`${p.runId}-${key}-conflict.json`);
              const latest = cached?.base || await current();
              await emit(env, p.projectId, 'meeting_started', `Overlapping edits in ${publication.conflicts.join(', ')} need a shared decision.`, 'principal', rowId, `${rowId}-conflict-started`);
              const resolved = cached || await modelJSON(env, p.userId, 'principal', `Resolve overlapping edits in this task: ${JSON.stringify(task)}. Brief: ${JSON.stringify(brief)}. User instruction: ${p.instruction || 'none'}. Conflicting paths: ${JSON.stringify(publication.conflicts)}. Current accepted design: ${JSON.stringify(latest.design)}. Pending proposal: ${JSON.stringify(result.proposal)}. Decide how this task's owner should revise its proposal against the current design while preserving other accepted changes and respecting field ownership. Return a concise decision and an actionable instruction.`, DecisionSchema);
              await artifact(env, p.projectId, p.runId, `${key}-conflict.json`, 'coordination', latest.revision, JSON.stringify({ ...resolved, base: latest, conflicts: publication.conflicts, proposalArtifactId: result.artifactId }), 'application/json');
              await decision(`${key}-conflict`, 'Resolve overlapping design edits', resolved.decision);
              await emit(env, p.projectId, 'meeting_ended', resolved.decision, 'principal', rowId, `${rowId}-conflict-ended`);
              return { ...resolved, base: latest };
            });
            result = await execute(task, `${key}-retry`, rowId, resolution.base, Object.fromEntries(task.dependencies.map(id => [id, outputs[id]])), resolution.instruction);
            publication = await step.do(`${key}-retry-publish`, async () => { await checkCancelled(); const saved = await coordinator.commitProposal(p.projectId, result.baseRevision, `${p.runId}-${key}-retry`, result.proposal!, p.runId, task.agent); return { revision: saved.revision, conflicts: [...saved.conflicts] }; });
            if (publication.conflicts.length) throw new HttpError(409, 'The proposals still overlap after coordination. Saved proposals need another design review.');
          }
          if (publication.revision === null) throw new HttpError(409, 'The design proposal could not be published.');
          revision = publication.revision;
        }
        await step.do(`${key}-complete`, async () => {
          await checkCancelled();
          await updateTask(rowId, 'completed', result.proposal ? `${task.title}: saved design revision ${revision}.` : result.summary, null, result.artifactId, revision);
          await emit(env, p.projectId, 'task_completed', result.proposal ? `${task.title}: design revision ${revision} saved.` : result.summary, task.agent, rowId, `${rowId}-completed`);
        });
        completed.add(task.id); outputs[task.id] = result;
      }
    }
    // Plan validation guarantees that this terminal review saw all prior work.
    const final = plan.tasks.find(task => task.kind === 'review' && !plan.tasks.some(other => other.dependencies.includes(task.id)))!;
    findings = outputs[final.id].findings;
    if (!findings.length || round === 1) {
      await step.do(`${phase}-review-outcome`, async () => {
        const latest = await current();
        await artifact(env, p.projectId, p.runId, 'review.json', 'review', latest.revision, JSON.stringify({ summary: outputs[final.id].summary, findings, revision: latest.revision }), 'application/json');
        const status = findings.length ? 'review' : 'ready';
        const published = await env.DB.batch([
          env.DB.prepare("UPDATE projects SET status = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND project_id = projects.id AND status = 'in_progress')").bind(status, p.projectId, latest.revision, p.runId),
          env.DB.prepare("INSERT OR IGNORE INTO events(project_id,type,agent,revision,message,created_at,operation_id) SELECT id,?,'principal',revision,?,?,? FROM projects WHERE id = ? AND revision = ? AND status = ? AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND project_id = projects.id AND status = 'in_progress')").bind(findings.length ? 'review_required' : 'final_design_ready', findings.length ? `${findings.length} findings remain after the correction round. Review and proposals are saved.` : 'The coordinated design is ready to explore.', new Date().toISOString(), `${p.runId}-review-outcome`, p.projectId, latest.revision, status, p.runId),
        ]);
        if (!published[0].meta.changes) throw new HttpError(409, 'The run stopped or the design advanced before this review could be published.');
      });
      break;
    }
  }
}
