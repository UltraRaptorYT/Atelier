import { z } from 'zod';
import { artifactIdSchema, type ImageStudy, type StudioRun } from './images';

export const AgentIdSchema = z.enum(['principal', 'architect', 'designer', 'critic']);
export type AgentId = z.infer<typeof AgentIdSchema>;
export const agents = {
  principal: { name: 'Alex Morgan', role: 'Principal architect', initials: 'AM', color: '#c45418', description: 'Brief, direction & coordination' },
  architect: { name: 'Kai Chen', role: 'Architect', initials: 'KC', color: '#2563eb', description: 'Space, structure & form' },
  designer: { name: 'Sofia Reyes', role: 'Interior designer', initials: 'SR', color: '#9333c7', description: 'Materials, light & atmosphere' },
  critic: { name: 'Noah Ellis', role: 'Design critic', initials: 'NE', color: '#15803d', description: 'Requirements & design review' },
} as const;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const position = z.tuple([z.number().min(-500).max(500), z.number().min(-5).max(50), z.number().min(-500).max(500)]);
const size = z.tuple([z.number().min(.01).max(150), z.number().min(.01).max(20), z.number().min(.01).max(150)]);
export const MaterialSchema = z.object({ id, name: z.string().max(80), color, roughness: z.number().min(0).max(1), metalness: z.number().min(0).max(1), opacity: z.number().min(0).max(1).nullish(), transmission: z.number().min(0).max(1).nullish() });
// Mesh coordinates are normalized in the element's local bounding box. Both
// renderers scale them by size, then apply the existing yaw and translation.
const meshCoordinate = z.number().min(-.5).max(.5);
export const MeshGeometrySchema = z.object({
  type: z.literal('mesh'),
  vertices: z.array(z.tuple([meshCoordinate, meshCoordinate, meshCoordinate])).min(3).max(2048),
  triangles: z.array(z.array(z.number().int().min(0).max(2047)).length(3)).min(1).max(4096),
}).superRefine((mesh, ctx) => {
  for (const triangle of mesh.triangles) {
    if (triangle.some(index => index >= mesh.vertices.length)) {
      ctx.addIssue({ code: 'custom', message: 'Mesh triangle references an unknown vertex.' });
      continue;
    }
    const [a, b, c] = triangle.map(index => mesh.vertices[index]);
    const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
    const area = Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]);
    if (area < 1e-10) ctx.addIssue({ code: 'custom', message: 'Mesh triangles must have nonzero area.' });
  }
});
export const AssetSchema = z.object({id,name:z.string().max(100),artifactId:z.string().max(200),author:z.string().max(100),license:z.string().max(100)});
export const ElementSchema = z.object({
  id, kind: z.enum(['slab', 'wall', 'roof', 'door', 'window', 'stair', 'furniture', 'light', 'asset']),
  name: z.string().min(1).max(100), position, size, rotation: z.number().min(-Math.PI * 2).max(Math.PI * 2),
  materialId: id, floor: z.number().int().min(0).max(3),
  assetId: id.nullable(),
  geometry: MeshGeometrySchema.nullish(),
  assetMaterialOverride: z.boolean().nullish(),
});
export const SpaceSchema = z.object({ id, name: z.string().min(1).max(100), floor: z.number().int().min(0).max(3), position, size });
export const DesignSchema = z.object({
  schemaVersion: z.literal(1), units: z.literal('meters'), title: z.string().min(1).max(120),
  buildingType: z.string().min(1).max(80), floors: z.number().int().min(1).max(4),
  materials: z.array(MaterialSchema).min(1).max(80),
  assets: z.array(AssetSchema).max(30).default([]),
  spaces: z.array(SpaceSchema).min(1).max(40),
  elements: z.array(ElementSchema).min(1).max(1200),
  spawn: position,
  notes: z.array(z.string().max(500)).max(30),
}).superRefine((d, ctx) => {
  const ids = new Set<string>();
  for (const x of [...d.materials, ...d.spaces, ...d.elements, ...d.assets]) {
    if (ids.has(x.id)) ctx.addIssue({ code: 'custom', message: `Duplicate ID: ${x.id}` });
    ids.add(x.id);
  }
  const mats = new Set(d.materials.map(x => x.id));
  let vertices = 0, triangles = 0;
  for (const el of d.elements) {
    if (el.geometry) {
      vertices += el.geometry.vertices.length; triangles += el.geometry.triangles.length;
      if (el.assetId) ctx.addIssue({ code: 'custom', message: 'An element cannot use both a mesh and an asset.' });
    }
    if (!mats.has(el.materialId)) ctx.addIssue({ code: 'custom', message: `Unknown material: ${el.materialId}` });
    if (el.floor >= d.floors) ctx.addIssue({ code: 'custom', message: 'Element exceeds floor count' });
    if(el.assetId && !['atelier-chair','atelier-table','atelier-sofa','atelier-bed','atelier-shelf'].includes(el.assetId) && !d.assets.some(a=>a.id===el.assetId)) ctx.addIssue({code:'custom',message:`Unknown asset: ${el.assetId}`});
  }
  if (vertices > 60000 || triangles > 100000) ctx.addIssue({ code: 'custom', message: 'Design mesh budget exceeded (60000 vertices / 100000 triangles).' });
  if (d.spaces.some(s => s.floor >= d.floors)) ctx.addIssue({ code: 'custom', message: 'Space exceeds floor count' });
  if(new Set(d.spaces.map(s=>s.floor)).size!==d.floors) ctx.addIssue({code:'custom',message:'Each declared floor needs at least one space.'});
});
export type Design = z.infer<typeof DesignSchema>;
export type DesignElement = z.infer<typeof ElementSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export const BriefSchema = z.object({
  request: z.string().min(10).max(8000), summary: z.string().max(2000),
  goals: z.array(z.string().max(500)).max(30), constraints: z.array(z.string().max(500)).max(30),
  questions: z.array(z.string().max(500)).max(3),
  clarificationAnswers: z.array(z.object({ question: z.string().max(500), answer: z.string().max(2000) })).max(30).nullish(),
});
export type Brief = z.infer<typeof BriefSchema>;
export const ChangeSchema = z.object({
  instruction: z.string().min(2).max(4000), agent: AgentIdSchema,
  elementId: id.nullable(), baseRevision: z.number().int().min(0), operationId: z.string().uuid(),
  referenceArtifactId: artifactIdSchema.nullable().optional(),
});
export type Change = z.infer<typeof ChangeSchema>;
export type ChangeRecord = {
  id: string; instruction: string; agent: AgentId; elementId: string | null; baseRevision: number;
  referenceArtifactId: string | null; status: 'pending' | 'in_progress' | 'applied' | 'failed' | 'cancelled';
  createdAt: string; startedAt: string | null; appliedAt: string | null; appliedRevision: number | null;
  reviewedAt: string | null; reviewedRevision: number | null; reviewSummary: string | null;
  reviewFindings: string[]; reviewArtifactId: string | null; failureDetail: string | null;
};
export type TaskStatus = 'queued' | 'blocked' | 'in_progress' | 'review' | 'completed' | 'cancelled' | 'failed';
export type Task = { id: string; agent: AgentId; title: string; status: TaskStatus; detail: string; runId: string; kind?: string; objective?: string; dependencies?: string[]; deliverables?: string[]; baseRevision?: number | null; artifactId?: string | null; artifactRevision?: number | null };
export type StudioEvent = { id: number; projectId: string; type: string; agent: AgentId | null; taskId: string | null; revision: number; message: string; createdAt: string };
export type Artifact = { id: string; name: string; kind: string; revision: number; createdAt: string; size: number };
export type Project = { id: string; name: string; brief: Brief; revision: number; status: string; createdAt: string; updatedAt: string; selectedConceptId?: string | null };
export type Snapshot = { project: Project; design: Design | null; tasks: Task[]; events: StudioEvent[]; artifacts: Artifact[]; images?: ImageStudy[]; runs?: StudioRun[]; changes?: ChangeRecord[]; requirements?: import('./requirements').EffectiveRequirements; clarification?: import('./conversation').Clarification | null; messages?: import('./conversation').ConversationTurn[] };

export function recolor(d: Design, elementId: string, newColor: string): Design {
  color.parse(newColor);
  const next = structuredClone(d);
  const element = next.elements.find(e => e.id === elementId);
  if (!element) throw new Error('Select an existing design element.');
  const original = next.materials.find(m => m.id === element.materialId)!;
  const materialId = `custom_${elementId}`;
  next.materials = next.materials.filter(m => m.id !== materialId);
  next.materials.push({ ...original, id: materialId, name: `${element.name} finish`, color: newColor });
  element.materialId = materialId;
  if (element.assetId && !element.assetId.startsWith('atelier-')) element.assetMaterialOverride = true;
  return DesignSchema.parse(next);
}

export function reviewDesign(d: Design): string[] {
  const issues: string[] = [];
  if (!d.elements.some(e => e.kind === 'door')) issues.push('No doors are defined; add a usable entrance.');
  if (!d.elements.some(e => e.kind === 'window')) issues.push('No windows are defined; review daylight and ventilation.');
  if (d.floors > 1 && !d.elements.some(e => e.kind === 'stair')) issues.push('Multiple floors need a connected staircase.');
  for (const s of d.spaces) if (s.size[0] < 1.2 || s.size[2] < 1.2) issues.push(`${s.name} is unusually narrow; review circulation.`);
  return issues;
}

// Original procedural furniture geometry; no third-party asset license required.
export const assetProvenance = [{ id: 'atelier-procedural-v1', author: 'Atelier', license: 'CC0-1.0', description: 'Original procedural desks, chairs, sofas, tables, shelves and planters.' }];
