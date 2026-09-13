import { z } from 'zod';
import { DesignSchema, ElementSchema, MaterialSchema, SpaceSchema, type Design } from './design';

const id = ElementSchema.shape.id;
function editsFor<T extends z.ZodType<{ id: string }>>(item: T, limit: number) {
  return z.object({
    upsert: z.array(item).max(limit).describe('Complete records for only the IDs being added or changed. Omitted IDs are preserved.'),
    remove: z.array(id).max(limit).describe('Existing IDs to explicitly delete. An omitted record is never deleted.'),
  }).strict().superRefine((edits, ctx) => {
    const upserts = new Set<string>(), removals = new Set<string>();
    for (const [index, item] of edits.upsert.entries()) {
      if (upserts.has(item.id)) ctx.addIssue({ code: 'custom', path: ['upsert', index, 'id'], message: `Duplicate upsert ID: ${item.id}` });
      upserts.add(item.id);
    }
    for (const [index, value] of edits.remove.entries()) {
      if (removals.has(value) || upserts.has(value)) ctx.addIssue({ code: 'custom', path: ['remove', index], message: `ID cannot be removed twice or both upserted and removed: ${value}` });
      removals.add(value);
    }
  });
}

/** An existing design is edited explicitly; the model never re-emits its registry or whole scene. */
export const DesignEditsSchema = z.object({
  elements: editsFor(ElementSchema.strict(), 200),
  materials: editsFor(MaterialSchema.strict(), 80),
  spaces: editsFor(SpaceSchema.strict(), 40),
  metadata: z.object({
    title: DesignSchema.shape.title.nullable(),
    buildingType: DesignSchema.shape.buildingType.nullable(),
    floors: DesignSchema.shape.floors.nullable(),
    spawn: DesignSchema.shape.spawn.nullable(),
    notes: DesignSchema.shape.notes.nullable(),
  }).strict().describe('Use null to preserve each existing value. Only the architect may change metadata.'),
}).strict();
export type DesignEdits = z.infer<typeof DesignEditsSchema>;

function applyCollection<T extends { id: string }>(base: T[], edits: { upsert: T[]; remove: string[] }, collection: string): T[] {
  const byId = new Map(base.map(item => [item.id, item]));
  for (const id of edits.remove) {
    if (!byId.delete(id)) throw new Error(`Cannot remove unknown ${collection} ID: ${id}`);
  }
  for (const item of edits.upsert) byId.set(item.id, item);
  return [...byId.values()];
}

/** registeredAssets must come only from successful server-side asset tools, never model JSON. */
export function applyDesignEdits(base: Design, input: DesignEdits, registeredAssets: Design['assets'] = []): Design {
  const before = DesignSchema.parse(base), edits = DesignEditsSchema.parse(input);
  const metadata = Object.fromEntries(Object.entries(edits.metadata).filter(([, value]) => value !== null));
  return DesignSchema.parse({
    ...before, ...metadata,
    elements: applyCollection(before.elements, edits.elements, 'element'),
    materials: applyCollection(before.materials, edits.materials, 'material'),
    spaces: applyCollection(before.spaces, edits.spaces, 'space'),
    assets: [...before.assets, ...registeredAssets],
  });
}
