import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toStrictJsonSchema } from 'openai/lib/transform';
import { modelResponseSchema } from '../worker/src/model-schema';
import { modelJSON } from '../worker/src/ai';
import { DesignSchema, BriefSchema } from '../shared/design';
import { PlanSchema } from '../shared/collaboration';
import { exampleDesign } from '../shared/example';
import type { Bindings } from '../worker/src/types';

const mocks = vi.hoisted(() => ({ create: vi.fn(), credential: vi.fn() }));
vi.mock('openai', () => ({ default: class OpenAI { responses = { create: mocks.create }; } }));
vi.mock('../worker/src/prompts', () => ({ agentInstructions: () => 'Return the requested canonical design.' }));
vi.mock('../worker/src/security', () => ({ credential: mocks.credential, HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock('../worker/src/store', () => ({ emit: vi.fn() }));
const env = { OPENAI_MODEL: 'gpt-5.6-terra' } as Bindings;
const final = (output: unknown) => ({ status: 'completed', output: [], output_text: JSON.stringify(output) });
beforeEach(() => { vi.resetAllMocks(); mocks.credential.mockResolvedValue('test-key'); mocks.create.mockResolvedValue(final(exampleDesign())); });

function verifyArrays(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(verifyArrays); return; }
  const node = value as Record<string, unknown>;
  expect(node).not.toHaveProperty('prefixItems');
  expect(node).not.toHaveProperty('additionalItems');
  if (node.type === 'array' || (Array.isArray(node.type) && node.type.includes('array'))) {
    expect(node.items).not.toBeNull();
    expect(typeof node.items).toBe('object');
    expect(Array.isArray(node.items)).toBe(false);
  }
  if (node.type === 'object') expect(node.additionalProperties).toBe(false);
  Object.values(node).forEach(verifyArrays);
}

describe('OpenAI wire schema compatibility', () => {
  it('sends compatible XYZ arrays in the actual model request while retaining per-axis guidance and canonical tuples', async () => {
    const original = z.toJSONSchema(DesignSchema);
    expect(await modelJSON(env, 'owner', 'architect', 'Create the design.', DesignSchema)).toEqual(exampleDesign());
    const schema = mocks.create.mock.calls[0][0].text.format.schema;
    verifyArrays(schema);
    expect(() => toStrictJsonSchema(schema)).not.toThrow();
    const position = schema.properties.spaces.items.properties.position;
    const size = schema.properties.elements.items.properties.size;
    for (const vector of [position, size, schema.properties.spawn]) expect(vector).toMatchObject({ type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } });
    expect(position.items).toEqual({ type: 'number', minimum: -500, maximum: 500 });
    expect(position.description).toContain('x (index 0): -500 to 500 inclusive');
    expect(position.description).toContain('y (index 1): -5 to 50 inclusive');
    expect(position.description).toContain('z (index 2): -500 to 500 inclusive');
    expect(size.items).toEqual({ type: 'number', minimum: 0.01, maximum: 150 });
    expect(size.description).toContain('y (index 1): 0.01 to 20 inclusive');
    expect(z.toJSONSchema(DesignSchema)).toEqual(original);
    expect(original.properties!.spawn).toHaveProperty('prefixItems');
  });

  it.each([['brief', BriefSchema], ['plan', PlanSchema]] as const)('keeps the %s schema compatible without inventing vector constraints', (_name, schema) => {
    const wire = modelResponseSchema(schema);
    verifyArrays(wire);
    expect(() => toStrictJsonSchema(wire)).not.toThrow();
    expect(JSON.stringify(wire)).not.toContain('Exactly three finite numbers');
  });

  it.each([
    z.object({ unsupported: z.tuple([z.number(), z.string()]) }),
    z.object({ unsupported: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]).rest(z.number()) }),
  ])('fails before an API call for unsupported tuple semantics', async schema => {
    await expect(modelJSON(env, 'owner', 'architect', 'Unsupported tuple.', schema)).rejects.toThrow(/fixed, bounded numeric XYZ tuples/);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.credential).not.toHaveBeenCalled();
  });
});

describe('canonical validation after the wire schema', () => {
  it.each([
    { name: 'short position', target: 'position', value: [1, 2] },
    { name: 'long position', target: 'position', value: [1, 2, 3, 4] },
    { name: 'position below vertical bound', target: 'position', value: [0, -5.01, 0] },
    { name: 'position above vertical bound', target: 'position', value: [0, 50.01, 0] },
    { name: 'horizontal position outside bounds', target: 'position', value: [500.01, 0, 0] },
    { name: 'size above vertical bound', target: 'size', value: [1, 20.01, 1] },
    { name: 'zero size', target: 'size', value: [1, 0, 1] },
    { name: 'nonnumeric coordinate', target: 'position', value: [1, '2', 3] },
    { name: 'infinite coordinate', target: 'position', value: [1, Infinity, 3] },
    { name: 'NaN coordinate', target: 'position', value: [1, NaN, 3] },
  ])('rejects $name instead of accepting relaxed wire validation', async ({ target, value }) => {
    const invalid = structuredClone(exampleDesign()) as unknown as { elements: Record<string, unknown>[] };
    invalid.elements[0][target] = value;
    expect(DesignSchema.safeParse(invalid).success).toBe(false);
    mocks.create.mockResolvedValue(final(invalid));
    await expect(modelJSON(env, 'owner', 'architect', 'Create the design.', DesignSchema)).rejects.toMatchObject({ status: 422, message: 'The agent returned an invalid design. The previous revision is unchanged.' });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('rejects numeric JSON overflow and preserves cross-field validation', async () => {
    const design = exampleDesign();
    const overflow = JSON.stringify({ ...design, spawn: ['OVERFLOW', 0, 0] }).replace('"OVERFLOW"', '1e999');
    expect(JSON.parse(overflow).spawn[0]).toBe(Infinity);
    mocks.create.mockResolvedValue({ status: 'completed', output: [], output_text: overflow });
    await expect(modelJSON(env, 'owner', 'architect', 'Create the design.', DesignSchema)).rejects.toMatchObject({ status: 422 });
    const unknownMaterial = structuredClone(design);
    unknownMaterial.elements[0].materialId = 'missing-material';
    mocks.create.mockResolvedValue(final(unknownMaterial));
    await expect(modelJSON(env, 'owner', 'architect', 'Create the design.', DesignSchema)).rejects.toMatchObject({ status: 422 });
  });
});
