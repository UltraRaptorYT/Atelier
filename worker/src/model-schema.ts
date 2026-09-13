import { z } from 'zod';
import { toStrictJsonSchema } from 'openai/lib/transform';
import type { JSONSchema } from 'openai/lib/jsonschema';

/** API representation only. The original Zod schema still validates every result. */
export function modelResponseSchema(schema: z.ZodType): Record<string, unknown> {
  const wire = z.toJSONSchema(schema, {
    target: 'draft-7',
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type !== 'tuple') return;
      const axes = jsonSchema.items;
      // Structured Outputs supports homogeneous arrays, not positional tuple
      // schemas. Adapt only the bounded numeric XYZ vectors used by DesignSchema.
      if (!Array.isArray(axes) || axes.length !== 3 || jsonSchema.minItems !== 3 || jsonSchema.maxItems !== 3
        || axes.some(axis => typeof axis !== 'object' || axis === null || axis.type !== 'number'
          || !Number.isFinite(axis.minimum) || !Number.isFinite(axis.maximum)
          || Object.keys(axis).some(key => !['type', 'minimum', 'maximum', 'description'].includes(key)))) {
        throw new Error('Only fixed, bounded numeric XYZ tuples can be represented by the model response schema.');
      }
      const coordinates = axes as Array<{ minimum: number; maximum: number; description?: string }>;
      jsonSchema.items = { type: 'number', minimum: Math.min(...coordinates.map(axis => axis.minimum)), maximum: Math.max(...coordinates.map(axis => axis.maximum)) };
      delete jsonSchema.additionalItems;
      const bounds = coordinates.map((axis, index) => `${['x', 'y', 'z'][index]} (index ${index}): ${axis.minimum} to ${axis.maximum} inclusive${axis.description ? `; ${axis.description}` : ''}`).join('. ');
      jsonSchema.description = [jsonSchema.description, `Exactly three finite numbers in [x, y, z] order. ${bounds}. Each axis must obey its own bounds.`].filter(Boolean).join(' ');
    },
  });
  // Fail locally for other unsupported schema constructs before purchasing a
  // response. This does not replace axis-specific or cross-field Zod validation.
  return { ...toStrictJsonSchema(wire as JSONSchema) };
}
