import { z } from 'zod';
import { artifactIdSchema, type ImageStudy, type StudioRun } from './images';

export const AgentIdSchema = z.enum(['principal', 'architect', 'designer', 'critic']);
export type AgentId = z.infer<typeof AgentIdSchema>;
export const agents = {
  principal: { name: 'Alex Morgan', role: 'Principal architect', initials: 'AM', color: '#a16c45', description: 'Brief, direction & coordination' },
  architect: { name: 'Kai Chen', role: 'Architect', initials: 'KC', color: '#617c84', description: 'Space, structure & form' },
  designer: { name: 'Sofia Reyes', role: 'Interior designer', initials: 'SR', color: '#9e775b', description: 'Materials, light & atmosphere' },
  critic: { name: 'Noah Ellis', role: 'Design critic', initials: 'NE', color: '#71816b', description: 'Requirements & design review' },
} as const;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const position = z.tuple([z.number().min(-500).max(500), z.number().min(-5).max(50), z.number().min(-500).max(500)]);
const size = z.tuple([z.number().min(.01).max(150), z.number().min(.01).max(20), z.number().min(.01).max(150)]);
export const MaterialSchema = z.object({ id, name: z.string().max(80), color, roughness: z.number().min(0).max(1), metalness: z.number().min(0).max(1) });
export const ElementSchema = z.object({
  id, kind: z.enum(['slab', 'wall', 'roof', 'door', 'window', 'stair', 'furniture', 'light', 'asset']),
  name: z.string().min(1).max(100), position, size, rotation: z.number().min(-Math.PI * 2).max(Math.PI * 2),
  materialId: id, floor: z.number().int().min(0).max(3),
  assetId: z.string().nullable(),
});
export const SpaceSchema = z.object({ id, name: z.string().min(1).max(100), floor: z.number().int().min(0).max(3), position, size });
export const DesignSchema = z.object({
  schemaVersion: z.literal(1), units: z.literal('meters'), title: z.string().min(1).max(120),
  buildingType: z.string().min(1).max(80), floors: z.number().int().min(1).max(4),
  materials: z.array(MaterialSchema).min(1).max(80),
  spaces: z.array(SpaceSchema).min(1).max(40),
  elements: z.array(ElementSchema).min(1).max(1200),
  spawn: position,
  notes: z.array(z.string().max(500)).max(30),
}).superRefine((d, ctx) => {
  const ids = new Set<string>();
  for (const x of [...d.materials, ...d.spaces, ...d.elements]) {
    if (ids.has(x.id)) ctx.addIssue({ code: 'custom', message: `Duplicate ID: ${x.id}` });
    ids.add(x.id);
  }
  const mats = new Set(d.materials.map(x => x.id));
  for (const el of d.elements) {
    if (!mats.has(el.materialId)) ctx.addIssue({ code: 'custom', message: `Unknown material: ${el.materialId}` });
    if (el.floor >= d.floors) ctx.addIssue({ code: 'custom', message: 'Element exceeds floor count' });
  }
  if (d.spaces.some(s => s.floor >= d.floors)) ctx.addIssue({ code: 'custom', message: 'Space exceeds floor count' });
});
export type Design = z.infer<typeof DesignSchema>;
export type DesignElement = z.infer<typeof ElementSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export const BriefSchema = z.object({
  request: z.string().min(10).max(8000), summary: z.string().max(2000),
  goals: z.array(z.string().max(500)).max(30), constraints: z.array(z.string().max(500)).max(30),
  questions: z.array(z.string().max(500)).max(3),
});
export type Brief = z.infer<typeof BriefSchema>;
export const ChangeSchema = z.object({
  instruction: z.string().min(2).max(4000), agent: AgentIdSchema,
  elementId: id.nullable(), baseRevision: z.number().int().min(0), operationId: z.string().uuid(),
  referenceArtifactId: artifactIdSchema.nullable().optional(),
});
export type Change = z.infer<typeof ChangeSchema>;
export type TaskStatus = 'queued' | 'blocked' | 'in_progress' | 'review' | 'completed' | 'cancelled' | 'failed';
export type Task = { id: string; agent: AgentId; title: string; status: TaskStatus; detail: string; runId: string };
export type StudioEvent = { id: number; projectId: string; type: string; agent: AgentId | null; taskId: string | null; revision: number; message: string; createdAt: string };
export type Artifact = { id: string; name: string; kind: string; revision: number; createdAt: string; size: number };
export type Project = { id: string; name: string; brief: Brief; revision: number; status: string; createdAt: string; updatedAt: string; selectedConceptId?: string | null };
export type Snapshot = { project: Project; design: Design | null; tasks: Task[]; events: StudioEvent[]; artifacts: Artifact[]; images?: ImageStudy[]; runs?: StudioRun[] };

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
