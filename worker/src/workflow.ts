import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import { BriefSchema, type AgentId } from '../../shared/design';
import type { Bindings, RunParams } from './types';
import { modelJSON } from './ai';
import { reviewMeeting } from './meeting';
import { generateStudy, loadImageReference } from './images';
import { artifact, designFromRow, emit } from './store';
import { createDesktop, idleDesktop, syncDesktop, checkpointDesktop, runVisible } from './desktop';
import { ownedProject, HttpError } from './security';
import { runTeam } from './team';
const RouteSchema = z.object({ scope: z.enum(['local', 'global']), color: z.string().nullable(), elementId: z.string().nullable(), explanation: z.string() });
type ImageStepResult = { ok: true; value: string | null } | { ok: false; status: number; message: string };
async function imageStepResult(work: () => Promise<string | null>): Promise<ImageStepResult> {
  try { return { ok: true, value: await work() }; }
  catch (error) {
    // Workflow checkpoints erase exception prototypes. Only application-created
    // public errors may cross that boundary as data; unknown errors stay private.
    if (error instanceof HttpError) return { ok: false, status: error.status, message: error.message };
    throw error;
  }
}
function imageStepValue(result: ImageStepResult): string | null {
  if (!result.ok) throw new HttpError(result.status, result.message);
  return result.value;
}
export class DesignWorkflow extends WorkflowEntrypoint<Bindings, RunParams> {
  async run(event: WorkflowEvent<RunParams>, step: WorkflowStep) {
    const p = event.payload;
    const checkCancelled = async () => {
      const run = await this.env.DB.prepare('SELECT status FROM runs WHERE id = ?').bind(p.runId).first<{ status: string }>();
      if (!run || !['queued', 'in_progress'].includes(run.status)) throw new Error('Run cancelled.');
    };
    const task = async (agent: AgentId, title: string, detail: string, status = 'in_progress') => {
      const id = `${p.runId}-${agent}`;
      await this.env.DB.prepare('INSERT INTO tasks(id,project_id,run_id,agent,title,status,detail) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,detail=excluded.detail').bind(id, p.projectId, p.runId, agent, title, status, detail).run();
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
      if (p.kind === 'image') {
        imageStepValue(await step.do('image-study', { retries: { limit: 0, delay: '1 second' }, timeout: '4 minutes' }, () => imageStepResult(async () => {
          await checkCancelled();
          const row = await ownedProject(this.env, p.projectId, p.userId);
          return generateStudy(this.env, p, 'study', BriefSchema.parse(JSON.parse(row.brief)));
        })));
      } else if (p.kind === 'render') {
        const sandboxId = await desktopFor('designer', 'render');
        await step.do('blender-render', { retries: { limit: 0, delay: '1 second' }, timeout: '15 minutes' }, async () => {
          await checkCancelled(); const row = await ownedProject(this.env, p.projectId, p.userId); const design = await designFromRow(this.env, row); if (!design) throw new Error('Generate a design first.');
          const desktop = await connect(sandboxId); await task('designer', 'Render presentation', `Rendering design revision ${row.revision} in Blender.`);
          await syncDesktop(desktop, design, this.env, p.projectId);
          await emit(this.env, p.projectId, 'tool_started', 'Compiling the canonical design and rendering a presentation image in Blender.', 'designer');
          let completed = false;
          try { const result = await runVisible(desktop, `blender --background --python-exit-code 1 --python /home/user/project/blender_compile.py -- --design /home/user/project/design.json --output /home/user/project/output --render --revision ${row.revision}`, 780000); completed = result.exitCode === 0; }
          catch { /* Retain any model/source files completed before the renderer stopped. */ }
          for (const [name, mime, kind] of [['design.blend', 'application/octet-stream', 'blender'], ['design.glb', 'model/gltf-binary', 'model'], ['presentation.png', 'image/png', 'render']]) {
            try { await artifact(this.env, p.projectId, p.runId, name, kind, row.revision, await desktop.files.read(`/home/user/project/output/${name}`, { format: 'bytes' }), mime); }
            catch { if (completed) throw new Error('A completed render artifact could not be saved.'); }
          }
          await artifact(this.env, p.projectId, p.runId, 'blender-source.py', 'source', row.revision, await desktop.files.read('/home/user/project/blender_compile.py'), 'text/x-python');
          await artifact(this.env, p.projectId, p.runId, 'furniture.json', 'asset-library', row.revision, await desktop.files.read('/home/user/project/furniture.json'), 'application/json');
          if (!completed) throw new HttpError(408,'The render did not finish within its allowance. Any completed model and source files have been saved; retry the render from this revision.');
          await desktop.open('/home/user/project/output/design.blend');
          await checkpointDesktop(this.env, desktop, p.projectId, p.runId, row.revision, 'designer');
          await task('designer', 'Render presentation', `Presentation files for revision ${row.revision} are ready.`, 'completed');
        });
      } else {
        const perspectives = p.kind === 'generate' && !p.instruction?.startsWith('[VOICE_START]') ? await step.do('team-listens', { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' }, async () => { await checkCancelled(); const row = await ownedProject(this.env, p.projectId, p.userId); return reviewMeeting(this.env, p.projectId, p.userId, BriefSchema.parse(JSON.parse(row.brief))); }) : [];
        const brief = await step.do('principal-brief', { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' }, async () => {
          await checkCancelled(); const row = await ownedProject(this.env, p.projectId, p.userId);
          const original = BriefSchema.parse(JSON.parse(row.brief));
          await task('principal', 'Prepare the project brief', p.kind === 'change' ? 'Assessing the requested design change.' : 'Interpreting the brief and assigning specialists.');
          if (p.kind === 'change') return original;
          const parsed = await modelJSON(this.env, p.userId, 'principal', `Prepare a structured brief from: ${original.request}. Start authorization: ${p.instruction || 'No explicit voice start instruction.'}. Preserve request exactly. Infer reasonable defaults. Consider these real specialist perspectives: ${JSON.stringify(perspectives)}. Ask at most two high-impact unanswered questions if needed to resolve occupancy, scale, realism, conflicts or limits (4 floors/40 spaces). Do not repeat questions answered in the brief. If the user explicitly asks you to choose defaults, do so.`, BriefSchema);
          await this.env.DB.prepare('UPDATE projects SET brief = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(parsed), new Date().toISOString(), p.projectId).run();
          if (parsed.questions.length) await emit(this.env, p.projectId, 'clarification_requested', parsed.questions.join('\n'), 'principal');
          return parsed;
        });
        if (brief.questions.length && p.kind === 'generate') {
          await step.do('needs-clarification', async () => { await this.env.DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").bind(p.runId).run(); await task('principal', 'Clarify brief', brief.questions.join(' '), 'blocked'); });
          return { needsClarification: true };
        }
        // A workflow checkpoint freezes one reference for all specialist stages.
        const referenceId = imageStepValue(await step.do('visual-reference', { retries: { limit: 0, delay: '1 second' }, timeout: '4 minutes' }, () => imageStepResult(async () => {
          await checkCancelled();
          if (p.referenceArtifactId) {
            await loadImageReference(this.env, p.projectId, p.referenceArtifactId, p.baseRevision);
            return p.referenceArtifactId;
          }
          const row = await ownedProject(this.env, p.projectId, p.userId);
          if (p.kind !== 'generate' || row.design_key || String(this.env.IMAGE_GENERATION_ENABLED) !== 'true') return null;
          const id = await generateStudy(this.env, p, 'initial-concept', brief);
          await this.env.DB.batch([
            this.env.DB.prepare("UPDATE projects SET concept_artifact_id = ? WHERE id = ? AND revision = ? AND concept_artifact_id IS NULL AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'in_progress')").bind(id, p.projectId, p.baseRevision, p.runId),
            this.env.DB.prepare("INSERT OR IGNORE INTO decisions(id,project_id,run_id,topic,decision,created_at) SELECT ?,project_id,id,'Initial visual direction',?,? FROM runs WHERE id = ? AND status = 'in_progress'").bind(`${p.runId}-concept`, `Use ${id} as a visual reference; the brief and editable geometry remain authoritative.`, new Date().toISOString(), p.runId),
          ]);
          return id;
        })));
        let local: { color: string; elementId: string } | null = null;
        if (p.kind === 'change' && p.elementId && !referenceId) {
          const route = await step.do('route-change', { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' }, async () => {
            await checkCancelled();
            const row = await ownedProject(this.env, p.projectId, p.userId), current = await designFromRow(this.env, row);
            return modelJSON(this.env, p.userId, 'principal', `Classify this change: ${p.instruction}. Selected element: ${p.elementId}. Current elements: ${JSON.stringify(current?.elements.map(e => ({ id: e.id, name: e.name })))}. Local means a color-only edit to the selected existing element. Return hex color and its ID for a local edit. Otherwise return global so the Principal can plan the required specialists.`, RouteSchema);
          });
          if (route.scope === 'local' && route.color && /^#[0-9a-fA-F]{6}$/.test(route.color) && route.elementId === p.elementId) local = { color: route.color, elementId: route.elementId };
        }
        await runTeam(this.env, p, step, brief, referenceId, local);
      }
      await step.do('complete', async () => {
        await checkCancelled();
        const completed = await this.env.DB.batch([this.env.DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ? AND status = 'in_progress'").bind(p.runId), this.env.DB.prepare("UPDATE changes SET status = 'applied' WHERE id = ? AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'completed')").bind(p.runId, p.runId)]);
        if (completed[0].meta.changes) await emit(this.env, p.projectId, 'task_completed', p.kind === 'image' ? 'Your visual study is ready in Files. Choose it as a direction or refine it.' : 'This round of work is complete.', 'principal', null, `complete-${p.runId}`);
      });
    } catch (e) {
      await step.do('record-failure', async () => {
        const cancelled = (await this.env.DB.prepare('SELECT status FROM runs WHERE id = ?').bind(p.runId).first<{status:string}>())?.status === 'cancelled';
        await this.env.DB.batch([this.env.DB.prepare("UPDATE runs SET status = 'failed' WHERE id = ? AND status != 'cancelled'").bind(p.runId), this.env.DB.prepare("UPDATE tasks SET status = ? WHERE run_id = ? AND status IN ('in_progress','queued','review','blocked')").bind(cancelled ? 'cancelled' : 'failed', p.runId), this.env.DB.prepare("UPDATE changes SET status = ? WHERE id = ?").bind(cancelled ? 'cancelled' : 'failed', p.runId)]);
        const message = e instanceof HttpError ? e.message : cancelled ? 'Work cancelled. Saved revisions are preserved.' : 'The run stopped before completion. Saved revisions are preserved; check credentials and computer availability, then retry.';
        await emit(this.env, p.projectId, 'error', message, 'principal');
      });
    } finally {
      if (p.kind !== 'image') await step.do('idle-workstations', async () => { for (const agent of ['architect', 'designer', 'critic'] as AgentId[]) await idleDesktop(this.env, p.projectId, agent); });
    }
    await step.do('drain-steering', () => this.env.PROJECTS.getByName(p.projectId).scheduleChanges(p.projectId,p.userId));
    return { runId: p.runId };
  }
}
