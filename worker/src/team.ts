import type { WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import { AgentIdSchema, DesignSchema, recolor, reviewDesign, type Brief, type Design } from '../../shared/design';
import { applyDesignEdits, DesignEditsSchema } from '../../shared/design-edits';
import { PlanSchema, readyTasks, validatePlan, mergeDesignProposal, type PlannedTask } from '../../shared/collaboration';
import type { Bindings, RunParams } from './types';
import { modelJSON } from './ai';
import { artifact, designFromRow, emit } from './store';
import { ownedProject, HttpError } from './security';
import { createDesktop, releaseDesktop, syncDesktop, checkpointDesktop, prepareProposalAuthoring, prepareProposalDesktop } from './desktop';
import { ProposalSession, PreviewCameraSchema, type ProposalEvidence, type ProposalView } from './proposals';
import { TaskTimeBudget, TASK_STEP_TIMEOUT } from './task-time';
import { designReasoningEffort } from './model-settings';
import { designContext } from './design-context';
import { checkedWorkflowStep } from './workflow-errors';
import { loadImageReference, validatePNG, visualReferenceInstructions } from './images';
import { requirementsPrompt, type EffectiveRequirements } from '../../shared/requirements';
import { readEffectiveRequirements } from './requirements';
import { changeAppliedStatement, changeReviewedStatement } from './changes';
import { draftFirstPlan, FIRST_DRAFT_TASK } from '../../shared/draft-plan';

const ReviewSchema = z.object({ findings: z.array(z.string().max(1000)).max(20), summary: z.string().max(3000) });
const VisualSpecSchema = z.object({
  summary: z.string().min(1).max(1000),
  landmarks: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/), feature: z.string().min(1).max(200), requirement: z.string().min(1).max(800) }).strict()).min(1).max(7),
}).strict().superRefine((spec, ctx) => {
  if (new Set(spec.landmarks.map(item => item.id)).size !== spec.landmarks.length) ctx.addIssue({ code: 'custom', path: ['landmarks'], message: 'Visual landmark IDs must be unique.' });
});
const VisualReviewSchema = ReviewSchema.extend({
  landmarks: z.array(z.object({
    id: z.string().max(48), status: z.enum(['pass', 'fail', 'unverified']),
    elementIds: z.array(z.string().max(80)).max(40),
    evidenceArtifactIds: z.array(z.string().max(200)).max(5),
    explanation: z.string().min(1).max(1000),
  }).strict()).max(7),
}).strict();
type VisualSpec = z.infer<typeof VisualSpecSchema>;
const PreviewMetadataSchema = z.object({
  revision: z.number().int().min(0), view: z.enum(['front', 'rear', 'plan_ground', 'plan_upper', 'interior']),
  camera: PreviewCameraSchema,
  resolution: z.tuple([z.number().int().min(1).max(1280), z.number().int().min(1).max(960)]),
  samples: z.number().int().min(1).max(32), source: z.literal('canonical design'), elements: z.number().int().min(1).max(1200),
  designHash: z.string().regex(/^[a-f0-9]{64}$/),
});
type VisualEvidence = { revision: number; referenceArtifactId: string | null; views: { view: ProposalView; artifactId: string; metadataArtifactId: string; camera: z.infer<typeof PreviewMetadataSchema>['camera'] }[]; unavailable: string[] };
const DirectionSchema = z.object({
  summary: z.string().max(3000), recommendations: z.array(z.string().max(1000)).max(20),
  coordination: z.array(z.object({ target: AgentIdSchema, message: z.string().max(1000) })).max(6),
});
const DecisionSchema = z.object({ decision: z.string().max(3000), instruction: z.string().min(1).max(4000) });
const options = { retries: { limit: 0, delay: '1 second' }, timeout: TASK_STEP_TIMEOUT } as const;
type Base = { revision: number; design: Design | null };
type Result = { artifactId: string; baseRevision: number; proposal: Design | null; summary: string; findings: string[]; recommendations: string[]; coordination: { target: string; message: string }[]; proposalEvidence?: ProposalEvidence; visualReview?: { evidence: VisualEvidence; landmarks?: z.infer<typeof VisualReviewSchema>['landmarks'] } };
type LocalColor = { color: string; elementId: string };

/** Run a persisted dependency graph. Only publication serializes; independent proposals run together. */
export async function runTeam(env: Bindings, p: RunParams, step: WorkflowStep, brief: Brief, referenceId: string | null, local: LocalColor | null = null) {
  // The full design team uses the configured quality setting. Conversational
  // routing and voice delegation keep their separate latency-oriented paths.
  const teamModel = <T>(agent: z.infer<typeof AgentIdSchema>, prompt: string, schema: z.ZodType<T>, context?: Parameters<typeof modelJSON>[5], images: string[] = [], timeBudget?: TaskTimeBudget) =>
    modelJSON(env, p.userId, agent, prompt, schema, context, images, designReasoningEffort(env), timeBudget).catch(async error => {
      // Preserve bounded, explicitly unpublished authoring work before its
      // workstation is released, without masking the original failure.
      await context?.proposal?.saveDraft().catch(() => {});
      throw error;
    });
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
  const requirements = await step.do('effective-requirements', async () => {
    await checkCancelled();
    const saved = await savedArtifact<EffectiveRequirements>(`${p.runId}-effective-requirements.json`);
    if (saved) return saved;
    const effective = await readEffectiveRequirements(env, p.projectId, brief, p.baseRevision, p.runId);
    await artifact(env, p.projectId, p.runId, 'effective-requirements.json', 'requirements', p.baseRevision, JSON.stringify(effective), 'application/json');
    return effective;
  });
  const requirementsText = requirementsPrompt(requirements, p.kind === 'change' && p.instruction
    ? { instruction: p.instruction, elementId: p.elementId || null, referenceArtifactId: p.referenceArtifactId || null }
    : undefined);
  async function desktopFor(task: PlannedTask, key: string, rowId: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const sandboxId = await checkedWorkflowStep(step, `${key}-computer-${attempt}`, { ...options, timeout: '2 minutes' }, async () => {
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

  const visualSpec: VisualSpec | null = referenceId ? await checkedWorkflowStep(step, 'visual-landmarks', options, async () => {
    const timeBudget = new TaskTimeBudget();
    await checkCancelled();
    const cached = await savedArtifact<VisualSpec>(`${p.runId}-visual-spec.json`);
    if (cached) return VisualSpecSchema.parse(cached);
    const taskId = `${p.runId}-visual-landmarks`;
    await env.DB.prepare("INSERT OR IGNORE INTO tasks(id,project_id,run_id,agent,title,status,detail,kind,objective,dependencies,deliverables,base_revision) VALUES(?,?,?,'designer','Identify visual landmarks','in_progress','Preparing concrete visual requirements for the team.','visual_direction','Identify required visual features for geometry and rendered review.','[]','[\"Visual landmark specification\"]',?)").bind(taskId, p.projectId, p.runId, p.baseRevision).run();
    await emit(env, p.projectId, 'task_started', 'Identifying visual landmarks for the accepted design direction.', 'designer', taskId, `${p.runId}-visual-landmarks-started`);
    const spec = local ? VisualSpecSchema.parse({
      summary: 'Verify the accepted selected finish and preserve the existing design.',
      landmarks: [{ id: 'accepted-finish', feature: 'Accepted selected finish', requirement: `Element ${local.elementId} must use ${local.color}; preserve its geometry and all unrelated work. The accepted finish overrides historical image colors.` }],
    }) : await teamModel('designer', `Extract the essential visual landmarks from this selected architectural reference before the team models it. Brief: ${JSON.stringify(brief)}. Accepted current change: ${p.instruction || 'none'}. ${visualReferenceInstructions}
${requirementsText}
Return 1–7 concrete landmarks that make this design recognizable: massing, setbacks/terraces, roof silhouette, major glazing/openings, entrance and material relationships as relevant. Describe relative placement and proportions, not invented exact dimensions. Each requirement must be testable against actual model elements and rendered views. Accepted current changes override conflicting features or colors in the historical reference. For an existing-design correction, scope requirements to the accepted change and preservation of unrelated existing work. Distinguish required geometry from atmospheric image styling. Use primitives where sufficient; identify a curved feature requiring a registered custom component instead of silently dropping it. Do not require landscaping or photographic effects unless part of the brief.`, VisualSpecSchema, undefined, [(await loadImageReference(env, p.projectId, referenceId)).dataUrl], timeBudget);
    await artifact(env, p.projectId, p.runId, 'visual-spec.json', 'visual-specification', p.baseRevision, JSON.stringify(spec), 'application/json');
    await updateTask(taskId, 'completed', `${spec.landmarks.length} visual landmarks saved.`, p.baseRevision, `${p.runId}-visual-spec.json`, p.baseRevision);
    await emit(env, p.projectId, 'task_completed', 'Visual landmark specification saved for the team.', 'designer', taskId, `${p.runId}-visual-landmarks-completed`);
    await emit(env, p.projectId, 'artifact_created', `${spec.landmarks.length} visual landmarks saved for geometry and rendered review.`, 'designer', null, `${p.runId}-visual-landmarks`);
    return spec;
  }) : null;

  async function renderEvidence(desktop: Awaited<ReturnType<typeof createDesktop>>, key: string, rowId: string, base: Base, timeBudget: TaskTimeBudget) {
    const evidence: VisualEvidence = { revision: base.revision, referenceArtifactId: referenceId, views: [], unavailable: [] };
    const images: string[] = [];
    const requiredViews: ProposalView[] = ['front', 'rear', 'plan_ground', ...(base.design!.floors > 1 ? ['plan_upper' as const] : []), 'interior'];
    await prepareProposalDesktop(desktop, base.design!, env, p.projectId);
    const canonicalJSON = JSON.stringify(base.design);
    const designHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON))).toString('hex');
    await desktop.files.write('/home/user/project/review-design.json', canonicalJSON);
    for (const [index, view] of requiredViews.entries()) {
      await checkCancelled();
      await emit(env, p.projectId, 'tool_started', `Rendering the canonical model ${view} view for visual review of revision ${base.revision}.`, 'critic', rowId);
      try {
        // Keep time for the remaining views and the Critic's actual review.
        const timeoutMs = timeBudget.allowance(65000, 120000 + (requiredViews.length - index - 1) * 20000 + 10000, 6000);
        const renderSeconds = Math.max(1, Math.floor((timeoutMs - 5000) / 1000));
        const command = await desktop.commands.run(`timeout ${renderSeconds}s blender --background --python-exit-code 1 --python /home/user/project/blender_compile.py -- --design /home/user/project/review-design.json --output /home/user/project/output --preview --view ${view} --revision ${base.revision}`, { timeoutMs });
        if (command.exitCode !== 0) throw new Error('Preview renderer failed.');
        const metadata = PreviewMetadataSchema.parse(JSON.parse(await desktop.files.read(`/home/user/project/output/preview-${view}.json`)));
        if (metadata.revision !== base.revision || metadata.view !== view || metadata.designHash !== designHash || metadata.elements !== base.design!.elements.length) throw new Error('Preview provenance does not match the current canonical design.');
        const bytes = new Uint8Array(await desktop.files.read(`/home/user/project/output/preview-${view}.png`, { format: 'bytes' }));
        const dimensions = validatePNG(bytes, 8 * 1024 * 1024);
        if (dimensions.width !== metadata.resolution[0] || dimensions.height !== metadata.resolution[1]) throw new Error('Preview dimensions do not match its provenance.');
        await checkCancelled();
        const metadataArtifactId = await artifact(env, p.projectId, p.runId, `${key}-preview-${view}.json`, 'render-metadata', base.revision, JSON.stringify(metadata), 'application/json');
        const artifactId = await artifact(env, p.projectId, p.runId, `${key}-preview-${view}.png`, 'render', base.revision, bytes, 'image/png');
        evidence.views.push({ view, artifactId, metadataArtifactId, camera: metadata.camera });
        images.push(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
        await emit(env, p.projectId, 'tool_completed', `Canonical ${view} view saved for revision ${base.revision}: ${artifactId}`, 'critic', rowId);
      } catch {
        await checkCancelled();
        evidence.unavailable.push(view);
        await emit(env, p.projectId, 'tool_completed', `Canonical ${view} preview unavailable for revision ${base.revision}; visual correspondence remains unverified.`, 'critic', rowId);
      }
    }
    await artifact(env, p.projectId, p.runId, `${key}-visual-evidence.json`, 'visual-evidence', base.revision, JSON.stringify({ ...evidence, purpose: 'Visual review of actual canonical geometry', canonical: true, projectId: p.projectId, renderer: 'Blender', createdAt: new Date().toISOString() }), 'application/json');
    return { evidence, images };
  }

  function visualFindings(review: z.infer<typeof VisualReviewSchema>, evidence: VisualEvidence, design: Design): string[] {
    const findings: string[] = [], elementIds = new Set(design.elements.map(element => element.id)), artifactIds = new Set(evidence.views.map(view => view.artifactId));
    const expected = new Set(visualSpec!.landmarks.map(landmark => landmark.id));
    if (review.landmarks.some(landmark => !expected.has(landmark.id))) findings.push('Visual review contains an unknown landmark; review the saved specification.');
    for (const landmark of visualSpec!.landmarks) {
      const matches = review.landmarks.filter(item => item.id === landmark.id), item = matches[0];
      if (matches.length !== 1 || !item) { findings.push(`Visual correspondence unverified for ${landmark.feature}: provide exactly one landmark assessment.`); continue; }
      if (item.status !== 'pass') findings.push(`Visual landmark ${landmark.feature} ${item.status}: ${item.explanation}`);
      else if (!item.elementIds.length || item.elementIds.some(id => !elementIds.has(id)) || !item.evidenceArtifactIds.length || item.evidenceArtifactIds.some(id => !artifactIds.has(id))) findings.push(`Visual correspondence unverified for ${landmark.feature}: a pass requires existing element IDs and current canonical render evidence.`);
    }
    return findings;
  }

  async function execute(task: PlannedTask, key: string, rowId: string, base: Base, dependencies: Record<string, Result>, extraInstruction = '', color: LocalColor | null = null): Promise<Result> {
    const usesComputer = (task.kind === 'architecture' || task.kind === 'interior' || (task.kind === 'review' && Boolean(base.design))) && !color;
    try {
      const persisted = await step.do(`${key}-saved-result`, async () => { await checkCancelled(); return savedArtifact<Result>(`${p.runId}-${key}-result.json`); });
      if (persisted) return persisted;
      const sandboxId = usesComputer ? await desktopFor(task, key, rowId) : null;
      const completed = await checkedWorkflowStep(step, `${key}-work`, options, async () => {
        const firstDraft = task.id === FIRST_DRAFT_TASK && !base.design;
        const timeBudget = new TaskTimeBudget(firstDraft ? 6 * 60_000 : task.kind === 'visual_direction' ? 2 * 60_000 : undefined);
        await checkCancelled();
        const cached = await savedArtifact<Result>(`${p.runId}-${key}-result.json`);
        if (cached) return cached;
        await updateTask(rowId, 'in_progress', task.objective, base.revision);
        await emit(env, p.projectId, 'task_started', `${task.title}: ${task.objective}`, task.agent, rowId, `${p.runId}-${key}-started`);
        const images = referenceId ? [(await loadImageReference(env, p.projectId, referenceId)).dataUrl] : [];
        const visual = referenceId ? `Visual reference artifact: ${referenceId}. ${visualReferenceInstructions}` : '';
        const dependencySummaries = Object.fromEntries(Object.entries(dependencies).map(([id, { proposal, ...saved }]) =>
          [id, { ...saved, proposalSummary: designContext(proposal) }]));
        const prompt = `Task ${task.id} (${task.kind}). Objective: ${task.objective}. Deliverables: ${JSON.stringify(task.deliverables)}.
${requirementsText}
Brief: ${JSON.stringify(brief)}. Current design revision ${base.revision} summary: ${JSON.stringify(designContext(base.design, p.elementId))}.
read_design returns the exact assigned canonical snapshot from /home/user/project/design.json. Use that file for existing element records and geometry; this compact summary omits mesh arrays.
Accepted change for this round: ${p.instruction || 'none'}.
Completed dependencies and their saved outputs: ${JSON.stringify(dependencySummaries)}.
${extraInstruction} ${visual}
${firstDraft ? 'FIRST DRAFT PASS: this is a six-minute work allowance, not a final presentation. Author one useful bounded candidate promptly; start inspection with at least three minutes remaining. Kai uses Blender and the structured write_proposal tool, not Python. Show the useful candidate in Blender; skip elaborate custom sculpting, alternative studies and cosmetic polishing in this pass. Required inspect_proposal and submit_proposal still apply. The next tasks will refine this saved draft in parallel; leave clear limitations instead of pretending it is finished.' : ''}
${visualSpec ? `Visual specification: ${JSON.stringify(visualSpec)}\nMap each required feature to actual stable element IDs and geometry; a name or note is not implementation. Use the accepted current change to resolve any conflict with the reference. Preserve unrelated existing design during scoped repairs.` : ''}
Use dependency outputs to coordinate your work. Preserve unrelated elements and stable IDs. Your output is a proposal; the coordinator publishes the canonical revision after checking conflicts.`;
        let desktop;
        if (sandboxId) {
          const { Sandbox } = await import('@e2b/desktop');
          desktop = await Sandbox.connect(sandboxId, { apiKey: env.E2B_API_KEY });
          if (base.design) await syncDesktop(desktop, base.design, env, p.projectId, task.agent !== 'architect');
          else await desktop.files.write('/home/user/project/design.json', JSON.stringify({ brief }));
        }
        const communications: { target: z.infer<typeof AgentIdSchema>; message: string }[] = [];
        const registeredAssets: Design['assets'] = [];
        const context = desktop ? { desktop, projectId: p.projectId, taskId: rowId, design: base.design, communications, registeredAssets, checkActive: checkCancelled, timeBudget, proposal: undefined as ProposalSession | undefined } : undefined;
        const result: Result = { artifactId: `${p.runId}-${key}-result.json`, baseRevision: base.revision, proposal: null, summary: '', findings: [], recommendations: [], coordination: communications };
        if (task.kind === 'visual_direction') {
          Object.assign(result, await teamModel('designer', `${prompt}\nDevelop a concrete palette, material, furniture and lighting direction. Describe these in recommendations. Send coordination messages only for actual requirements affecting another specialist. Do not invent geometry or tool activity.`, DirectionSchema, undefined, images, timeBudget));
        } else if (task.kind === 'review') {
          const deterministic = base.design ? reviewDesign(base.design) : [];
          if (base.design && desktop) {
            const rendered = await renderEvidence(desktop, key, rowId, base, timeBudget);
            await checkCancelled();
            const labels = [
              ...(referenceId ? [`Image 1: selected concept ${referenceId}; generated visual intent, not a model render. Accepted changes override conflicting historical details.`] : []),
              ...rendered.evidence.views.map((view, index) => `Image ${index + (referenceId ? 2 : 1)}: ACTUAL canonical model ${view.view} preview; revision ${base.revision}; artifact ${view.artifactId}.`),
            ];
            const reviewPrompt = `${prompt}\nReview the current canonical model using the attached actual rendered views and its JSON. Inspect massing and proportions, enclosure, hosted openings, visible circulation, roof/wall/slab relationships, interior arrangement and material assignments against the brief. Use the actual floor plans and interior preview to inspect room arrangement and furniture. Distinguish what is visible from geometry checks and unknown headroom/operability details; never infer a successful walkthrough from an exterior image. A simple box or missing design-defining geometry is a meaningful finding when it fails the accepted brief or reference.\nCanonical render evidence: ${JSON.stringify(rendered.evidence)}\n${labels.join('\n')}\n${rendered.evidence.unavailable.length ? 'Some required canonical previews failed. Mark visual verification unverified and raise a finding; do not claim the design is ready.' : 'These images are rendered from the exact saved canonical revision being reviewed, not generated illustrations.'}\n${visualSpec ? 'Assess every saved landmark exactly once in landmarks. A pass needs actual implementing element IDs and current preview artifact IDs demonstrating it. Mark absent geometry fail and insufficient evidence unverified; feature names, material definitions and design notes are not visual proof. Report concrete corrections that preserve unaffected elements.' : 'Raise concrete, actionable geometry and visual findings, preserving unrelated accepted work.'}\nDeterministic findings: ${JSON.stringify(deterministic)}.`;
            if (visualSpec) {
              const review = await teamModel('critic', reviewPrompt, VisualReviewSchema, context, [...images, ...rendered.images]);
              result.summary = review.summary;
              result.findings = [...deterministic, ...review.findings, ...visualFindings(review, rendered.evidence, base.design)];
              result.visualReview = { evidence: rendered.evidence, landmarks: review.landmarks };
            } else {
              const review = await teamModel('critic', reviewPrompt, ReviewSchema, context, rendered.images);
              result.summary = review.summary; result.findings = [...deterministic, ...review.findings];
              result.visualReview = { evidence: rendered.evidence };
            }
            if (rendered.evidence.unavailable.length || rendered.evidence.views.length !== (base.design.floors > 1 ? 5 : 4)) {
              result.summary = 'The design is saved, but visual review is incomplete because required canonical previews are unavailable.';
              result.findings.push('Visual review is unverified: exterior, floor-plan and interior previews of the current canonical revision are required before the design is ready.');
            }
            result.findings = [...new Set(result.findings)];
          } else {
            const review = await teamModel('critic', `${prompt}\nReview the brief and dependencies for conflicts and missing requirements; no building exists yet. Raise actionable issues only; distinguish missing evidence from a verified result.`, ReviewSchema, context, images, timeBudget);
            result.summary = review.summary;
            result.findings = [...new Set([...deterministic, ...review.findings])];
          }
        } else {
          if (context && !color) {
            await prepareProposalAuthoring(context.desktop, z.toJSONSchema(base.design ? DesignEditsSchema : DesignSchema));
            context.proposal = new ProposalSession({
              env, desktop: context.desktop, projectId: p.projectId, runId: p.runId, taskId: rowId, key,
              baseRevision: base.revision, baseDesign: base.design, agent: task.agent,
              registeredAssets: () => registeredAssets, checkActive: checkCancelled, timeBudget,
              prepare: candidate => prepareProposalDesktop(context.desktop, candidate, env, p.projectId),
            });
          }
          const ownership = task.agent === 'designer'
            ? 'You own materials, material assignments, furniture and lights. Preserve metadata, notes, structural geometry, spaces, floors and spawn exactly.'
            : 'Develop the requested architecture. Make spaces accessible, split upper slabs around stair voids, and keep existing finishes and furniture unless the objective requires changing them. Use assetId null for procedural elements.';
          if (color && base.design) result.proposal = recolor(base.design, color.elementId, color.color);
          else if (base.design) {
            const edits = await teamModel(task.agent, `${prompt}\n${ownership}\nWrite explicit incremental edits to /home/user/project/proposal.json: upsert complete records for changed or new IDs, and remove only existing IDs that this objective requires deleting. Empty arrays leave a collection unchanged; null metadata values preserve the current values. Omitted elements, materials and spaces are preserved automatically. Do not list untouched records, rebuild the scene, or return an asset registry. Use only existing asset IDs or IDs returned by register_blender_asset or read_design_revision. To restore missing work, read the relevant saved revision and upsert only the needed records while preserving current accepted repairs. Inspect the proposal with inspect_proposal, examine its images, then submit_proposal. Your final JSON contains only the requested summary.`, DesignEditsSchema, context, images);
            result.proposal = applyDesignEdits(base.design, edits, registeredAssets);
          } else result.proposal = await teamModel(task.agent, `${prompt}\n${ownership}\nWrite the initial complete design to /home/user/project/proposal.json. ${task.agent === 'architect' ? 'Use Blender GUI modeling and write_proposal for canonical records; do not write scripts. Open the saved candidate with open_proposal_in_blender.' : 'Use design_authoring helpers and supported mesh geometry to fulfill the brief.'} Inspect the candidate with inspect_proposal, examine its images, then submit_proposal. Your final JSON contains only the requested summary.`, DesignSchema, context, images);
          // Enforce ownership before a proposal reaches shared state.
          mergeDesignProposal(base.design, base.design, result.proposal, task.agent);
          result.summary = `${task.title}: design proposal prepared from revision ${base.revision}.`;
          if (context?.proposal?.submitted) result.proposalEvidence = context.proposal.submitted.evidence;
        }
        await checkCancelled();
        await artifact(env, p.projectId, p.runId, `${key}-result.json`, result.proposal ? 'design-proposal' : task.kind, base.revision, JSON.stringify(result), 'application/json');
        await updateTask(rowId, result.proposal ? 'review' : 'in_progress', result.summary, null, result.artifactId);
        if (task.kind === 'visual_direction') for (const [index, message] of result.coordination.entries()) await emit(env, p.projectId, 'agent_message', `To ${message.target}: ${message.message}`, task.agent, rowId, `${p.runId}-${key}-message-${index}`);
        return result;
      });
      if (sandboxId) {
        // The real task result is durable before optional GUI/screenshot work.
        // A stalled window manager must not invalidate accepted geometry.
        try {
          await step.do(`${key}-workstation-capture`, { ...options, timeout: '30 seconds' }, async () => {
            await checkCancelled();
            const { Sandbox } = await import('@e2b/desktop');
            const desktop = await Sandbox.connect(sandboxId, { apiKey: env.E2B_API_KEY });
            if (completed.proposal) await syncDesktop(desktop, completed.proposal, env, p.projectId, task.agent !== 'architect');
            await checkpointDesktop(env, desktop, p.projectId, `${p.runId}-${key}`, base.revision, task.agent);
          });
        } catch {
          await checkCancelled();
        }
      }
      return completed;
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
    const plan = await checkedWorkflowStep(step, `${phase}-plan`, options, async () => {
      const timeBudget = new TaskTimeBudget();
      await checkCancelled();
      if (round) await emit(env, p.projectId, 'meeting_started', `The Critic found ${findings.length} issues. The Principal is assigning corrections.`, 'principal', null, `${p.runId}-${phase}-meeting-started`);
      await updateTask(`${p.runId}-principal`, 'in_progress', round ? 'Assigning bounded corrections from the design review.' : 'Planning dependencies and independent specialist work.');
      const cached = await savedArtifact<z.infer<typeof PlanSchema>>(`${p.runId}-${phase}-plan.json`);
      const next = cached ? validatePlan(cached, Boolean(initial.design)) : local && round === 0 ? validatePlan({ summary: 'The Designer applies the selected finish; the Critic reviews the resulting revision.', tasks: [
        { id: 'finish', kind: 'interior', agent: 'designer', title: 'Update selected finish', objective: p.instruction || 'Apply the selected colour.', dependencies: [], deliverables: ['Updated element material'] },
        { id: 'review', kind: 'review', agent: 'critic', title: 'Review changed finish', objective: 'Verify the accepted colour change and preserve other requirements.', dependencies: ['finish'], deliverables: ['Design review'] },
      ] }, Boolean(initial.design)) : !initial.design && round === 0 ? draftFirstPlan() : validatePlan(await teamModel('principal', `Create a dependency plan for the specialist team.
${requirementsText}
Brief: ${JSON.stringify(brief)}. Current design summary (rooms, materials and counts; detailed geometry remains in the canonical file): ${JSON.stringify(designContext(initial.design, p.elementId))}. Accepted change: ${p.instruction || 'none'}.
${visualSpec ? `Saved visual landmarks to realize in actual geometry and verify with model renders: ${JSON.stringify(visualSpec)}. Include concrete feature-to-element acceptance checks in the architecture objective and final review. The attached image is visual intent; accepted current changes override historical features.` : ''}
Review findings requiring correction: ${JSON.stringify(findings)}.
Choose only work needed now, at most 8 tasks. Each task needs a unique short ID, objective, deliverables and dependencies. Independent tasks should have no unnecessary dependencies; at most two different specialists run together. One specialist performs one task at a time.
Kinds and owners: architecture=architect (canonical geometry), interior=designer (materials, material assignments, furniture, lights), visual_direction=designer (saved palette/material/furniture/lighting recommendations, no geometry edits), review=critic (requirements or actual design review).
For a new house, architecture and visual_direction can begin together. Interior placement needs the architecture and any visual direction. For an existing house, independent structure and finish proposals may run together; finishes-only requests need no Architect. An early Critic review can run independently when useful. Do not invent a required task just to involve a role.
The graph must be acyclic. It needs a design-writing task and a final review that transitively depends on EVERY other task. A new house needs architecture and interior, with interior depending on architecture. Dependent tasks receive actual saved outputs. ${round ? 'This is the final automatic correction round; make the smallest bounded corrections.' : ''}`, PlanSchema, undefined, referenceId ? [(await loadImageReference(env, p.projectId, referenceId)).dataUrl] : [], timeBudget), Boolean(initial.design));
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
    const final = plan.tasks.find(task => task.kind === 'review' && !plan.tasks.some(other => other.dependencies.includes(task.id)))!;
    const completed = new Set<string>();
    const outputs: Record<string, Result> = {};
    let wave = 0;
    while (completed.size < plan.tasks.length) {
      const agents = new Set<string>();
      const batch = readyTasks(plan.tasks, completed).filter(task => { if (agents.has(task.agent) || agents.size >= 2) return false; agents.add(task.agent); return true; });
      if (!batch.length) throw new HttpError(422, 'The task plan has no runnable work.');
      const base = await step.do(`${phase}-wave-${wave++}-base`, current);
      if (p.kind === 'change' && batch.some(task => task.id === final.id)) {
        await step.do(`${phase}-change-applied`, async () => {
          await checkCancelled();
          const applied = await changeAppliedStatement(env, p, base.revision).run();
          if (applied.meta.changes) await emit(env, p.projectId, 'change_applied', `Your requested design work is saved in revision ${base.revision}. The Critic is checking it.`, p.agent || 'principal', null, `${p.runId}-${phase}-change-applied`);
        });
      }
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
            const resolution = await checkedWorkflowStep(step, `${key}-meeting`, options, async () => {
              const timeBudget = new TaskTimeBudget();
              await checkCancelled();
              const cached = await savedArtifact<z.infer<typeof DecisionSchema> & { base: Base }>(`${p.runId}-${key}-conflict.json`);
              const latest = cached?.base || await current();
              await emit(env, p.projectId, 'meeting_started', `Overlapping edits in ${publication.conflicts.join(', ')} need a shared decision.`, 'principal', rowId, `${rowId}-conflict-started`);
              const resolved = cached || await teamModel('principal', `Resolve overlapping edits in this task: ${JSON.stringify(task)}. Brief: ${JSON.stringify(brief)}. User instruction: ${p.instruction || 'none'}. Conflicting paths: ${JSON.stringify(publication.conflicts)}. Current accepted design: ${JSON.stringify(latest.design)}. Pending proposal: ${JSON.stringify(result.proposal)}. Decide how this task's owner should revise its proposal against the current design while preserving other accepted changes and respecting field ownership. Return a concise decision and an actionable instruction.\n${requirementsText}`, DecisionSchema, undefined, [], timeBudget);
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
          if (task.id === FIRST_DRAFT_TASK && !base.design && result.proposal) {
            await emit(env, p.projectId, 'draft_ready', `Your first draft is saved as revision ${revision}. View it in Design or the Presentation room, or export it from Files. Architecture refinement and interiors are next; this is not the final reviewed model.`, 'architect', rowId, `${rowId}-draft-ready`);
          }
        });
        completed.add(task.id); outputs[task.id] = result;
      }
    }
    // Plan validation guarantees that this terminal review saw all prior work.
    findings = outputs[final.id].findings;
    // Rendering infrastructure failures need a new evidence attempt, not paid
    // design corrections that cannot repair an unavailable renderer.
    const reviewedEvidence = outputs[final.id].visualReview?.evidence;
    const missingReviewEvidence = Boolean(reviewedEvidence && (reviewedEvidence.unavailable.length > 0 || reviewedEvidence.views.length < 4));
    if (!findings.length || round === 1 || missingReviewEvidence) {
      await step.do(`${phase}-review-outcome`, async () => {
        const latest = await current();
        if (latest.revision !== outputs[final.id].baseRevision) throw new HttpError(409, 'The design changed after its review. Review the current revision before marking it ready.');
        await artifact(env, p.projectId, p.runId, 'review.json', 'review', latest.revision, JSON.stringify({ summary: outputs[final.id].summary, findings, revision: latest.revision, visualReview: outputs[final.id].visualReview }), 'application/json');
        const status = findings.length ? 'review' : 'ready';
        const published = await env.DB.batch([
          env.DB.prepare("UPDATE projects SET status = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND project_id = projects.id AND status = 'in_progress')").bind(status, p.projectId, latest.revision, p.runId),
          changeReviewedStatement(env, p, latest.revision, outputs[final.id].summary, findings, `${p.runId}-review.json`),
          env.DB.prepare("INSERT OR IGNORE INTO events(project_id,type,agent,revision,message,created_at,operation_id) SELECT id,?,'principal',revision,?,?,? FROM projects WHERE id = ? AND revision = ? AND status = ? AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND project_id = projects.id AND status = 'in_progress')").bind(findings.length ? 'review_required' : 'final_design_ready', findings.length ? `${findings.length} findings remain after the correction round. Review and proposals are saved.` : 'The coordinated design is ready to explore.', new Date().toISOString(), `${p.runId}-review-outcome`, p.projectId, latest.revision, status, p.runId),
        ]);
        if (!published[0].meta.changes) throw new HttpError(409, 'The run stopped or the design advanced before this review could be published.');
      });
      break;
    }
  }
}
