import type { Sandbox } from '@e2b/desktop';
import { z } from 'zod';
import { AssetSchema, DesignSchema, ElementSchema, MaterialSchema, SpaceSchema, reviewDesign, type AgentId, type Design } from '../../shared/design';
import { DesignEditsSchema, applyDesignEdits, type DesignEdits } from '../../shared/design-edits';
import { DesignScopeError, mergeDesignProposal } from '../../shared/collaboration';
import type { Bindings } from './types';
import { artifact } from './store';
import { validatePNG } from './images';
import { PROPOSAL_FINISH_MS, TaskTimeError, TaskTimeBudget } from './task-time';

export const PROPOSAL_PATH = '/home/user/project/proposal.json';
export const MAX_PROPOSAL_BYTES = 1024 * 1024;
export const MAX_PROPOSAL_INSPECTIONS = 2;
const INSPECTED_PATH = '/home/user/project/inspection-design.json';
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const VIEW_TIMEOUT_MS = 60000;
export const ProposalSummarySchema = z.object({ summary: z.string().trim().min(1).max(3000) }).strict();
export type ProposalView = 'front' | 'rear' | 'plan_ground' | 'plan_upper' | 'interior';

/** Only these deliberately authored messages are safe to return to a model tool. */
export class ProposalError extends Error {
  constructor(message: string) { super(message); this.name = 'ProposalError'; }
}

// Reject unsupported geometry instead of silently dropping authored meshes or
// texture data when the canonical schema does not support those fields.
const FileDesignSchema = DesignSchema.safeExtend({
  materials: z.array(MaterialSchema.strict()).min(1).max(80),
  assets: z.array(AssetSchema.strict()).max(30).default([]),
  spaces: z.array(SpaceSchema.strict()).min(1).max(40),
  elements: z.array(ElementSchema.strict()).min(1).max(1200),
}).strict();
const cameraCoordinate = z.number().min(-5000).max(5000);
/** Exterior, orthographic plans and interior cameras have different metadata. */
export const PreviewCameraSchema = z.object({
  position: z.tuple([cameraCoordinate, cameraCoordinate, cameraCoordinate]),
  target: z.tuple([cameraCoordinate, cameraCoordinate, cameraCoordinate]),
  front: z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1)]).optional(),
  lens: z.number().min(1).max(300).optional(),
  orthographic: z.boolean().optional(),
  orthoScale: z.number().min(.01).max(5000).optional(),
  floor: z.number().int().min(0).max(3).optional(),
  cutHeight: z.number().min(-20).max(100).optional(),
  spaceId: SpaceSchema.shape.id.optional(),
  cameraObstructions: z.number().int().min(0).max(1200).optional(),
});
const PreviewMetadataSchema = z.object({
  revision: z.number().int().min(0),
  view: z.enum(['front', 'rear', 'plan_ground', 'plan_upper', 'interior']),
  camera: PreviewCameraSchema,
  resolution: z.tuple([z.number().int().min(1).max(1280), z.number().int().min(1).max(960)]),
  samples: z.number().int().min(1).max(32),
  source: z.literal('task proposal'),
  designHash: z.string().regex(/^[a-f0-9]{64}$/),
  elements: z.number().int().min(1).max(1200),
});
type PreviewMetadata = z.infer<typeof PreviewMetadataSchema>;
export type ProposalEvidence = {
  canonical: false; source: 'task proposal'; projectId: string; runId: string; taskId: string;
  baseRevision: number; candidateHash: string; attempt: number; candidateArtifactId: string;
  views: { view: ProposalView; artifactId: string; metadataArtifactId: string; camera: PreviewMetadata['camera'] }[];
  unavailable: ProposalView[]; findings: string[]; createdAt: string;
};
export type ProposalInspection = { hash: string; findings: string[]; evidence: ProposalEvidence; evidenceArtifactId: string; images: string[] };
export type ProposalReceipt = { hash: string; baseRevision: number; evidenceArtifactId: string; elementCount: number };
export type SubmittedProposal = { input: Design | DesignEdits; design: Design; receipt: ProposalReceipt; evidence: ProposalEvidence };

type Options = {
  env: Bindings; desktop: Sandbox; projectId: string; runId: string; taskId: string; key: string;
  baseRevision: number; baseDesign: Design | null; agent: AgentId;
  registeredAssets: () => Design['assets'];
  /** Refresh trusted compiler and asset files. Never read candidate geometry from a mutable file here. */
  prepare: (candidate: Design, candidatePath: string) => Promise<void>;
  checkActive: () => Promise<void>;
  timeBudget?: TaskTimeBudget;
};

/** A streamed cap also bounds a file that grows after its metadata is checked. */
async function readBounded(desktop: Sandbox, path: string, limit: number, timeBudget?: TaskTimeBudget): Promise<Uint8Array> {
  const timeoutMs = timeBudget?.allowance(10000) ?? 10000;
  const stream = await desktop.files.read(path, { format: 'stream', requestTimeoutMs: timeoutMs, streamIdleTimeoutMs: timeoutMs, signal: AbortSignal.timeout(timeoutMs) });
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) throw new ProposalError(`The proposal file exceeds its ${limit} byte allowance.`);
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function registry(assets: Design['assets']): Map<string, Design['assets'][number]> {
  const entries = new Map<string, Design['assets'][number]>();
  for (const value of assets) {
    const asset = AssetSchema.strict().parse(value), existing = entries.get(asset.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(asset)) throw new ProposalError('A registered asset ID conflicts with an existing asset. Use a new registered asset ID.');
    entries.set(asset.id, asset);
  }
  return entries;
}

function assertNoStrippedFields(input: unknown, parsed: unknown, path = 'proposal') {
  if (!input || typeof input !== 'object' || !parsed || typeof parsed !== 'object') return;
  if (Array.isArray(input) && Array.isArray(parsed)) {
    input.forEach((value, index) => assertNoStrippedFields(value, parsed[index], `${path}.${index}`));
  } else if (!Array.isArray(input) && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(input)) {
      if (!Object.hasOwn(parsed, key)) throw new ProposalError(`Unsupported canonical schema field: ${path}.${key}`.slice(0, 500));
      assertNoStrippedFields(value, (parsed as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

/** Asset registries are server-owned; files can reference only registered IDs. */
export function parseProposal(input: unknown, base: Design | null, agent: AgentId, registeredAssets: Design['assets']): Design {
  try {
    const trusted = registry([...(base?.assets || []), ...registeredAssets]);
    let candidate: Design;
    if (base) {
      const edits = DesignEditsSchema.parse(input);
      assertNoStrippedFields(input, edits);
      const references = new Set(edits.elements.upsert.map(element => element.assetId));
      const added = [...trusted.values()].filter(asset => references.has(asset.id) && !base.assets.some(existing => existing.id === asset.id));
      candidate = applyDesignEdits(base, edits, added);
    } else {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProposalError('Write a complete Design object to proposal.json for an initial architecture task.');
      const document = input as Record<string, unknown>;
      if (document.assets !== undefined) {
        for (const declared of z.array(AssetSchema.strict()).max(30).parse(document.assets)) {
          if (JSON.stringify(trusted.get(declared.id)) !== JSON.stringify(declared)) throw new ProposalError('The proposal cannot create or modify asset registry entries. Use IDs returned by the asset tools.');
        }
      }
      const references = new Set(Array.isArray(document.elements) ? document.elements.map(element => element?.assetId) : []);
      const registered = { ...document, assets: [...trusted.values()].filter(asset => references.has(asset.id)) };
      candidate = FileDesignSchema.parse(registered);
      assertNoStrippedFields(registered, candidate);
    }
    return mergeDesignProposal(base, base, candidate, agent);
  } catch (error) {
    if (error instanceof ProposalError) throw error;
    if (error instanceof DesignScopeError) throw new ProposalError(`This proposal exceeds your ownership at ${error.paths.slice(0, 8).join(', ')}. Preserve those fields and report the structural requirement to the Architect.`);
    if (error instanceof z.ZodError) {
      const issues = error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || 'design'}: ${issue.message}`).join('; ').slice(0, 1600);
      throw new ProposalError(`Fix proposal.json to match the canonical schema. ${issues}`);
    }
    throw new ProposalError('The proposal contains an invalid edit or asset reference. Preserve existing IDs and remove only IDs present in the assigned base design.');
  }
}

function viewsFor(agent: AgentId, design: Design): ProposalView[] {
  if (agent === 'designer') return design.floors > 1 ? ['interior', 'plan_ground', 'plan_upper'] : ['interior', 'plan_ground'];
  return ['front', 'plan_ground', design.floors > 1 ? 'plan_upper' : 'interior'];
}
async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Keeps an unpublished, validated candidate isolated from canonical publication. */
export class ProposalSession {
  private readonly options: Options;
  private attempts = 0;
  private inspection: ProposalInspection | null = null;
  private accepted: SubmittedProposal | null = null;
  constructor(options: Options) {
    if (!/^[a-zA-Z0-9_.-]{1,160}$/.test(options.key) || !Number.isInteger(options.baseRevision) || options.baseRevision < 0) throw new Error('Invalid proposal task identity.');
    this.options = { ...options, baseDesign: options.baseDesign ? DesignSchema.parse(options.baseDesign) : null };
  }
  get submitted(): SubmittedProposal | null { return this.accepted ? structuredClone(this.accepted) : null; }
  async saveDraft(): Promise<void> {
    if (this.accepted) return;
    await this.options.checkActive();
    // The work clock may have expired. Use only a short part of the checkpoint's
    // persistence margin, and never validate or publish this recovery artifact.
    const bytes = await readBounded(this.options.desktop, PROPOSAL_PATH, MAX_PROPOSAL_BYTES, new TaskTimeBudget(5000));
    await this.save(`${this.options.key}-unsubmitted-proposal.json`, 'proposal-draft', bytes, 'application/json');
  }
  private async readCandidate() {
    const o = this.options;
    await o.checkActive();
    o.timeBudget?.check();
    let input: unknown;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(await readBounded(o.desktop, PROPOSAL_PATH, MAX_PROPOSAL_BYTES, o.timeBudget))); }
    catch (error) {
      if (error instanceof ProposalError || error instanceof TaskTimeError) throw error;
      throw new ProposalError(`Write valid UTF-8 JSON to ${PROPOSAL_PATH} before inspecting or submitting it.`);
    }
    const design = parseProposal(input, o.baseDesign, o.agent, o.registeredAssets());
    const json = JSON.stringify(design), hash = await digest(json);
    await o.checkActive();
    return { input: o.baseDesign ? DesignEditsSchema.parse(input) : design, design, json, hash };
  }
  private async save(name: string, kind: string, data: string | Uint8Array, mime: string) {
    const o = this.options;
    await o.checkActive();
    const id = await artifact(o.env, o.projectId, o.runId, name, kind, o.baseRevision, data, mime);
    await o.checkActive();
    return id;
  }
  async inspect(): Promise<ProposalInspection> {
    const o = this.options, candidate = await this.readCandidate();
    if (this.accepted) throw new ProposalError('This task already submitted its proposal. Finish with your summary.');
    if (this.inspection?.hash === candidate.hash && this.inspection.evidence.unavailable.length === 0) return structuredClone(this.inspection);
    if (this.attempts >= MAX_PROPOSAL_INSPECTIONS) throw new ProposalError('The two proposal inspection attempts are used. Submit the last successfully inspected candidate without changing it, or report that the task cannot finish.');
    const views = viewsFor(o.agent, candidate.design);
    if (o.timeBudget && o.timeBudget.remainingMs() < PROPOSAL_FINISH_MS + views.length * 20000)
      throw new ProposalError('Too little task time remains for another full inspection and submission. Submit an unchanged, already inspected proposal if one exists; otherwise report that this task cannot finish.');
    this.inspection = null;
    const attempt = ++this.attempts;
    // Every attempt has its own files/artifacts, so a failed preview can never
    // pass by accidentally reading a previous attempt's render.
    const name = `${o.key}-proposal-${attempt}-${candidate.hash.slice(0, 16)}`;
    const output = `/home/user/project/output/proposal-${attempt}`;
    await o.prepare(structuredClone(candidate.design), INSPECTED_PATH);
    await o.checkActive();
    await o.desktop.files.write(INSPECTED_PATH, candidate.json);
    const findings = reviewDesign(candidate.design);
    const evidence: ProposalEvidence = {
      canonical: false, source: 'task proposal', projectId: o.projectId, runId: o.runId, taskId: o.taskId,
      baseRevision: o.baseRevision, candidateHash: candidate.hash, attempt,
      candidateArtifactId: await this.save(`${name}-design.json`, 'design-proposal', candidate.json, 'application/json'),
      views: [], unavailable: [], findings, createdAt: new Date().toISOString(),
    };
    const images: string[] = [];
    for (const [index, view] of views.entries()) {
      await o.checkActive();
      let bytes: Uint8Array, metadata: PreviewMetadata;
      try {
        const timeoutMs = o.timeBudget?.allowance(VIEW_TIMEOUT_MS, PROPOSAL_FINISH_MS + (views.length - index - 1) * 20000 + 10000, 6000) ?? VIEW_TIMEOUT_MS;
        const renderSeconds = Math.max(1, Math.floor((timeoutMs - 5000) / 1000));
        const result = await o.desktop.commands.run(`timeout ${renderSeconds}s blender --background --python-exit-code 1 --python /home/user/project/blender_compile.py -- --design ${INSPECTED_PATH} --output ${output} --preview --view ${view} --revision ${o.baseRevision} --source 'task proposal'`, { timeoutMs });
        if (result.exitCode !== 0) throw new Error('Preview renderer failed.');
        metadata = PreviewMetadataSchema.parse(JSON.parse(new TextDecoder().decode(await readBounded(o.desktop, `${output}/preview-${view}.json`, 16384, o.timeBudget))));
        if (metadata.revision !== o.baseRevision || metadata.designHash !== candidate.hash || metadata.view !== view || metadata.elements !== candidate.design.elements.length) throw new Error('Preview provenance mismatch.');
        bytes = await readBounded(o.desktop, `${output}/preview-${view}.png`, MAX_PREVIEW_BYTES, o.timeBudget);
        const dimensions = validatePNG(bytes, MAX_PREVIEW_BYTES);
        if (dimensions.width !== metadata.resolution[0] || dimensions.height !== metadata.resolution[1]) throw new Error('Preview dimensions mismatch.');
      } catch (error) {
        if (error instanceof TaskTimeError) throw error;
        await o.checkActive();
        evidence.unavailable.push(view);
        continue;
      }
      const provenance = { ...metadata, canonical: false, baseRevision: o.baseRevision, candidateHash: candidate.hash, projectId: o.projectId, runId: o.runId, taskId: o.taskId, attempt };
      const metadataArtifactId = await this.save(`${name}-${view}.json`, 'proposal-render-metadata', JSON.stringify(provenance), 'application/json');
      const artifactId = await this.save(`${name}-${view}.png`, 'proposal-render', bytes, 'image/png');
      evidence.views.push({ view, artifactId, metadataArtifactId, camera: metadata.camera });
      images.push(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
    }
    if (evidence.unavailable.length) findings.push(`Proposal inspection incomplete: ${evidence.unavailable.join(', ')} previews are unavailable. Retry inspection before submission.`);
    const evidenceArtifactId = await this.save(`${name}-evidence.json`, 'proposal-evidence', JSON.stringify(evidence), 'application/json');
    await o.checkActive();
    this.inspection = { hash: candidate.hash, findings, evidence, evidenceArtifactId, images };
    return structuredClone(this.inspection);
  }
  async submit(): Promise<ProposalReceipt> {
    const candidate = await this.readCandidate(), inspection = this.inspection;
    if (this.accepted) {
      if (candidate.hash !== this.accepted.receipt.hash) throw new ProposalError('The submitted proposal is frozen. Finish this task before requesting another design change.');
      return { ...this.accepted.receipt };
    }
    if (!inspection || candidate.hash !== inspection.hash) throw new ProposalError('The proposal changed or has not been inspected. Call inspect_proposal, review its actual images, and submit the same candidate.');
    if (inspection.evidence.unavailable.length) throw new ProposalError('The proposal has missing preview evidence. Retry inspect_proposal before submitting.');
    const receipt: ProposalReceipt = { hash: candidate.hash, baseRevision: this.options.baseRevision, evidenceArtifactId: inspection.evidenceArtifactId, elementCount: candidate.design.elements.length };
    await this.options.checkActive();
    this.accepted = { input: structuredClone(candidate.input), design: structuredClone(candidate.design), receipt, evidence: structuredClone(inspection.evidence) };
    return { ...receipt };
  }
}
