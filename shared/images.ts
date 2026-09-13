import { z } from 'zod';

export const artifactIdSchema = z.string().regex(/^[a-zA-Z0-9_.-]{1,200}$/);
const operation = { operationId: z.string().uuid(), baseRevision: z.number().int().min(0) };
export const ImageRequestSchema = z.object({ ...operation, instruction: z.string().trim().min(2).max(4000), sourceArtifactId: artifactIdSchema.nullable() });
export const CaptureRequestSchema = z.object({ ...operation, dataUrl: z.string() });
export const ConceptRequestSchema = z.object({ ...operation, artifactId: artifactIdSchema, apply: z.boolean() });
export type ImageStudy = { id: string; name: string; prompt: string; model: string; revision: number; sourceArtifactId: string | null; createdAt: string; metadataArtifactId: string };
export type StudioRun = { id: string; kind: string; status: string; resumesRunId?: string | null };
