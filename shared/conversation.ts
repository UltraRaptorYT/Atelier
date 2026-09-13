import { z } from 'zod';
import { ChangeSchema, type AgentId } from './design';

export const InteractionIntentSchema = z.enum(['ask', 'brief_update', 'answer_clarification', 'change']);
export const ClarificationAnswerSchema = z.object({
  questionId: z.string().min(1).max(160),
  answer: z.string().trim().min(1).max(2000),
});
export const InteractionRequestSchema = ChangeSchema.extend({
  instruction: z.string().trim().min(1).max(4000),
  intent: z.enum(['auto', 'ask', 'brief_update', 'answer_clarification', 'change']).optional(),
  clarificationId: z.string().min(1).max(160).optional(),
  clarificationVersion: z.number().int().min(1).optional(),
  answers: z.array(ClarificationAnswerSchema).min(1).max(3).optional(),
});
export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
export type InteractionResult = {
  intent: z.infer<typeof InteractionIntentSchema>;
  reply: string;
  operationId: string;
  queued?: boolean;
  runId?: string;
  saved?: boolean;
};
export type Clarification = {
  id: string;
  runId: string;
  version: number;
  status: 'awaiting_input' | 'queued' | 'continued' | 'cancelled' | 'superseded' | 'failed';
  questions: { id: string; question: string; answer: string | null }[];
  continuationRunId: string | null;
  detail: string | null;
};
export type ConversationTurn = {
  id: string;
  agent: AgentId;
  instruction: string;
  reply: string;
  intent: InteractionResult['intent'];
  createdAt: string;
};
