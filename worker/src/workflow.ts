import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import { BriefSchema, DesignSchema, recolor, reviewDesign, type AgentId, type Design } from '../../shared/design';
import type { Bindings, RunParams } from './types';
import { modelJSON } from './ai';
import { artifact, designFromRow, emit } from './store';
import { createDesktop, idleDesktop, syncDesktop, checkpointDesktop } from './desktop';
import { ownedProject, HttpError } from './security';
const ReviewSchema = z.object({ findings: z.array(z.string()).max(20), summary: z.string() });
const RouteSchema = z.object({ scope: z.enum(['local', 'global']), color: z.string().nullable(), elementId: z.string().nullable(), explanation: z.string() });
export class DesignWorkflow extends WorkflowEntrypoint<Bindings, RunParams> {
  async run(event: WorkflowEvent<RunParams>, step: WorkflowStep) {
    const p = event.payload;
    const checkCancelled = async () => {
      const run = await this.env.DB.prepare('SELECT status FROM runs WHERE id = ?').bind(p.runId).first<{ status: string }>();
      if (!run || run.status === 'cancelled') throw new Error('Run cancelled.');
    };
    const task = async (agent: AgentId, title: string, detail: string, status = 'in_progress') => {
      const id = `${p.runId}-${agent}`;
      await this.env.DB.prepare('INSERT INTO tasks(id,project_id,run_id,agent,title,status,detail) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,detail=excluded.detail').bind(id, p.projectId, p.runId, agent, title, status, detail).run();
      await emit(this.env, p.projectId, status === 'completed' ? 'task_completed' : 'task_started', detail, agent, id);
      return id;
    };
    const desktopFor = async (agent: AgentId, index: string) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const result = await step.do(`${index}-desktop-${attempt}`, { retries: { limit: 0, delay: '1 second' }, timeout: '2 minutes' }, async () => {
          await checkCancelled();
          try { const desktop = await createDesktop(this.env, p.projectId, p.userId, agent, `${p.runId}-${index}-${attempt}`); return { sandboxId: desktop.sandboxId }; }
          catch (e) { if (e instanceof HttpError && e.status === 425) return { sandboxId: null }; throw e; }
        });
        if (result.sandboxId) return result.sandboxId;
        await step.sleep(`${index}-queue-${attempt}`, '30 seconds');
      }
      throw new Error('Computer queue timed out. Please retry later.');
    };
    const connect = async (id: string) => { const { Sandbox } = await import('@e2b/desktop'); return Sandbox.connect(id, { apiKey: this.env.E2B_API_KEY }); };
    try {
      await step.do('start', async () => { await checkCancelled(); await this.env.DB.prepare("UPDATE runs SET status = 'in_progress' WHERE id = ? AND status = 'queued'").bind(p.runId).run(); });
      if (p.kind === 'render') {
        const sandboxId = await desktopFor('designer', 'render');
        await step.do('blender-render', { retries: { limit: 0, delay: '1 second' }, timeout: '15 minutes' }, async () => {
          await checkCancelled(); const row = await ownedProject(this.env, p.projectId, p.userId); const design = await designFromRow(this.env, row); if (!design) throw new Error('Generate a design first.');
          const desktop = await connect(sandboxId); await task('designer', 'Render presentation', `Rendering design revision ${row.revision} in Blender.`);
          await syncDesktop(desktop, design);
          await emit(this.env, p.projectId, 'tool_started', 'Compiling the canonical design and rendering a presentation image in Blender.', 'designer');
          let completed = false;
          try { const result = await desktop.commands.run('timeout 780s blender --background --python /home/user/project/blender_compile.py -- --design /home/user/project/design.json --output /home/user/project/output --render', { timeoutMs: 790000 }); completed = result.exitCode === 0; }
          catch { /* Retain any model/source files completed before the renderer stopped. */ }
          for (const [name, mime, kind] of [['design.blend', 'application/octet-stream', 'blender'], ['design.glb', 'model/gltf-binary', 'model'], ['presentation.png', 'image/png', 'render']]) {
            try { await artifact(this.env, p.projectId, p.runId, name, kind, row.revision, await desktop.files.read(`/home/user/project/output/${name}`, { format: 'bytes' }), mime); }
            catch { if (completed) throw new Error('A completed render artifact could not be saved.'); }
          }
          await artifact(this.env, p.projectId, p.runId, 'blender-source.py', 'source', row.revision, await desktop.files.read('/home/user/project/blender_compile.py'), 'text/x-python');
          if (!completed) throw new HttpError(408,'The render did not finish within its allowance. Any completed model and source files have been saved; retry the render from this revision.');
          await desktop.open('/home/user/project/output/design.blend');
          await checkpointDesktop(this.env, desktop, p.projectId, p.runId, row.revision, 'designer');
          await task('designer', 'Render presentation', `Presentation files for revision ${row.revision} are ready.`, 'completed');
        });
      } else {
        const brief = await step.do('principal-brief', { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' }, async () => {
          await checkCancelled(); const row = await ownedProject(this.env, p.projectId, p.userId);
          const original = BriefSchema.parse(JSON.parse(row.brief));
          await task('principal', 'Prepare the project brief', p.kind === 'change' ? 'Assessing the requested design change.' : 'Interpreting the brief and assigning specialists.');
          if (p.kind === 'change') return original;
          const parsed = await modelJSON(this.env, p.userId, 'principal', `Prepare a structured brief from: ${original.request}. Preserve request exactly. Infer reasonable defaults. Only ask questions when requirements conflict or exceed 4 floors/40 spaces.`, BriefSchema);
          await this.env.DB.prepare('UPDATE projects SET brief = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(parsed), new Date().toISOString(), p.projectId).run();
          if (parsed.questions.length) await emit(this.env, p.projectId, 'clarification_requested', parsed.questions.join('\n'), 'principal');
          return parsed;
        });
        if (brief.questions.length && p.kind === 'generate') {
          await step.do('needs-clarification', async () => { await this.env.DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").bind(p.runId).run(); await task('principal', 'Clarify brief', brief.questions.join(' '), 'blocked'); });
          return { needsClarification: true };
        }
        let local: { color: string; elementId: string } | null = null;
        if (p.kind === 'change') {
          const route = await step.do('route-change', { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' }, async () => {
            const row = await ownedProject(this.env, p.projectId, p.userId), current = await designFromRow(this.env, row);
            return modelJSON(this.env, p.userId, 'principal', `Classify this change: ${p.instruction}. Selected element: ${p.elementId}. Current elements: ${JSON.stringify(current?.elements.map(e => ({ id: e.id, name: e.name })))}. Local means a color-only edit to ONE identified existing element. Return hex color and ID for local edits. All other changes are global.`, RouteSchema);
          });
          if (route.scope === 'local' && route.color && /^#[0-9a-fA-F]{6}$/.test(route.color) && route.elementId) local = { color: route.color, elementId: route.elementId };
          else await step.do('meeting', async () => { await emit(this.env, p.projectId, 'meeting_started', route.explanation, 'principal'); await this.env.DB.prepare('INSERT OR IGNORE INTO decisions(id,project_id,run_id,topic,decision,created_at) VALUES(?,?,?,?,?,?)').bind(p.runId, p.projectId, p.runId, 'Cross-domain steering', `Architect revises affected geometry; designer updates finishes; critic checks requirements. ${route.explanation}`, new Date().toISOString()).run(); await emit(this.env, p.projectId, 'meeting_ended', 'Decision: revise the affected design, preserve unrelated elements, and review the result.', 'principal'); });
        }
        await step.do('delegated', async () => { await task('principal', 'Coordinate specialists', 'The brief is ready. Specialist work has been delegated.', 'completed'); });
        const owner: AgentId = local ? 'designer' : 'architect';
        const sandboxId = await desktopFor(owner, 'design');
        const committedRevision = await step.do('design-and-commit', { retries: { limit: 0, delay: '1 second' }, timeout: '10 minutes' }, async () => {
          await checkCancelled();
          const row = await ownedProject(this.env, p.projectId, p.userId), current = await designFromRow(this.env, row), desktop = await connect(sandboxId);
          await desktop.files.write('/home/user/project/design.json', JSON.stringify(current || { brief }));
          const taskId = await task(owner, 'Develop the design', local ? 'Applying the requested finish to the selected element.' : 'Developing spatial organization and an editable building model.');
          let design: Design;
          if (local && current) design = recolor(current, local.elementId, local.color);
          else design = await modelJSON(this.env, p.userId, 'architect', `Create the complete canonical design for this brief: ${JSON.stringify(brief)}. ${p.instruction ? `CHANGE REQUEST: ${p.instruction}. Preserve all unrelated elements and existing IDs.` : ''} Current design: ${JSON.stringify(current)}. Make all spaces accessible. Floors use split slabs for stair voids. Use assetId null for procedural elements. Keep output under 16000 tokens.`, DesignSchema, { desktop, projectId: p.projectId, taskId, design: current });
          await syncDesktop(desktop, design);
          await desktop.commands.run('python3 -m json.tool /home/user/project/design.json /home/user/project/validated-design.json', { timeoutMs: 10000 });
          await checkCancelled();
          const rev = await this.env.PROJECTS.getByName(p.projectId).commit(p.projectId, row.revision, `${p.runId}-architecture`, design, p.runId);
          await checkpointDesktop(this.env, desktop, p.projectId, p.runId, rev, owner);
          await task(owner, 'Develop the design', `Design revision ${rev} saved and available to explore.`, 'completed');
          return rev;
        });
        await step.do('idle-design-desktop', () => idleDesktop(this.env, p.projectId, owner));
        if (!local) {
          const designerId = await desktopFor('designer', 'interior');
          await step.do('interior-design', { retries: { limit: 0, delay: '1 second' }, timeout: '10 minutes' }, async () => {
            await checkCancelled(); const row = await ownedProject(this.env, p.projectId, p.userId), current = await designFromRow(this.env, row); if (!current) throw new Error('Design missing');
            const desktop = await connect(designerId); await syncDesktop(desktop, current);
            const taskId = await task('designer', 'Develop interiors', 'Selecting materials, arranging furniture, and shaping the light.');
            const next = await modelJSON(this.env, p.userId, 'designer', `Brief: ${JSON.stringify(brief)}. Current design: ${JSON.stringify(current)}. ${p.instruction || ''} Add thoughtful furniture, materials and lights. Preserve all structural elements, spaces, floors and spawn exactly. Return the complete design.`, DesignSchema, { desktop, projectId: p.projectId, taskId, design: current });
            const structure = (d: Design) => JSON.stringify({ spaces: d.spaces, floors: d.floors, spawn: d.spawn, elements: d.elements.filter(e => !['furniture','light'].includes(e.kind)).map(e => ({ ...e, materialId: '' })) });
            if (structure(current) !== structure(next)) throw new Error('Interior proposal changed structural geometry; it was not published.');
            await syncDesktop(desktop, next); await checkCancelled();
            const rev = await this.env.PROJECTS.getByName(p.projectId).commit(p.projectId, row.revision, `${p.runId}-interior`, next, p.runId);
            await checkpointDesktop(this.env, desktop, p.projectId, p.runId, rev, 'designer');
            await task('designer', 'Develop interiors', `Interior finishes and furniture saved in revision ${rev}.`, 'completed');
          });
          await step.do('idle-interior-desktop', () => idleDesktop(this.env, p.projectId, 'designer'));
        }
        const criticId = await desktopFor('critic', 'review');
        await step.do('review', { retries: { limit: 0, delay: '1 second' }, timeout: '8 minutes' }, async () => {
          await checkCancelled(); const row = await ownedProject(this.env, p.projectId, p.userId), current = await designFromRow(this.env, row); if (!current) throw new Error('Design missing');
          const desktop = await connect(criticId); await syncDesktop(desktop, current);
          const taskId = await task('critic', 'Review the design', 'Checking the actual model against the brief and circulation requirements.');
          const result = await modelJSON(this.env, p.userId, 'critic', `Brief: ${JSON.stringify(brief)}. Design: ${JSON.stringify(current)}. Deterministic findings: ${JSON.stringify(reviewDesign(current))}. Review specific requirements and explain limitations.`, ReviewSchema, { desktop, projectId: p.projectId, taskId, design: current });
          const findings = [...new Set([...reviewDesign(current), ...result.findings])];
          await artifact(this.env, p.projectId, p.runId, 'review.json', 'review', row.revision, JSON.stringify({ ...result, findings, revision: row.revision }, null, 2), 'application/json');
          await this.env.DB.prepare('UPDATE projects SET status = ? WHERE id = ?').bind(findings.length ? 'review' : 'ready', p.projectId).run();
          await checkpointDesktop(this.env, desktop, p.projectId, p.runId, row.revision, 'critic');
          await task('critic', 'Review the design', result.summary, 'completed');
          await emit(this.env, p.projectId, findings.length ? 'review_required' : 'final_design_ready', findings.length ? `${findings.length} review findings saved. The model is available for inspection.` : 'The design is ready to explore in the presentation room.', 'principal');
        });
        void committedRevision;
      }
      await step.do('complete', async () => {
        await this.env.DB.batch([this.env.DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ? AND status != 'cancelled'").bind(p.runId), this.env.DB.prepare("UPDATE changes SET status = 'applied' WHERE id = ?").bind(p.runId)]);
        await emit(this.env, p.projectId, 'task_completed', 'This round of work is complete.', 'principal', null, `complete-${p.runId}`);
      });
    } catch (e) {
      await step.do('record-failure', async () => {
        const cancelled = (await this.env.DB.prepare('SELECT status FROM runs WHERE id = ?').bind(p.runId).first<{status:string}>())?.status === 'cancelled';
        await this.env.DB.batch([this.env.DB.prepare("UPDATE runs SET status = 'failed' WHERE id = ? AND status != 'cancelled'").bind(p.runId), this.env.DB.prepare("UPDATE tasks SET status = ? WHERE run_id = ? AND status IN ('in_progress','queued')").bind(cancelled ? 'cancelled' : 'failed', p.runId), this.env.DB.prepare("UPDATE changes SET status = 'failed' WHERE id = ?").bind(p.runId)]);
        const message = e instanceof HttpError ? e.message : cancelled ? 'Work cancelled. Saved revisions are preserved.' : 'The run stopped before completion. Saved revisions are preserved; check credentials and computer availability, then retry.';
        await emit(this.env, p.projectId, 'error', message, 'principal');
      });
    } finally {
      await step.do('idle-workstations', async () => { for (const agent of ['architect', 'designer', 'critic'] as AgentId[]) await idleDesktop(this.env, p.projectId, agent); });
    }
    await step.do('drain-steering', () => this.env.PROJECTS.getByName(p.projectId).scheduleChanges(p.projectId,p.userId));
    return { runId: p.runId };
  }
}
