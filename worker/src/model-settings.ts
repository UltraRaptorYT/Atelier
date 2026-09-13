import { z } from 'zod';
import type { Bindings } from './types';
import { HttpError } from './security';

// Responses count both reasoning and visible output toward this per-call cap.
// Preserve output headroom while tuning reasoning effort independently.
export const MODEL_MAX_OUTPUT_TOKENS = 64_000;
// Briefing is a small structured-data task, not a geometry-authoring session.
export const BRIEFING_MODEL_LIMITS = { maxOutputTokens: 16_000, requestTimeoutMs: 120_000, instructionProfile: 'briefing' } as const;

// GPT-6 Astra's documented Responses API efforts. "ultra" is not an API
// value; max is the highest supported effort for this application.
const DesignEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export function designReasoningEffort(env: Pick<Bindings, 'OPENAI_REASONING_EFFORT'>) {
  const parsed = DesignEffortSchema.safeParse(env.OPENAI_REASONING_EFFORT?.trim() || 'high');
  if (!parsed.success) throw new HttpError(503, 'The design reasoning setting is invalid. Configure low, medium, high, xhigh, or max.');
  return parsed.data;
}
