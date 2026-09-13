import { z } from 'zod';
import { BriefSchema, DesignSchema, type AgentId } from '../../shared/design';
import { DesignEditsSchema } from '../../shared/design-edits';
import { PlanSchema } from '../../shared/collaboration';
import furniture from '../../shared/furniture.json';
import authoring from '../../scripts/design_authoring.py';
import compiler from '../../scripts/blender_compile.py';
import assetCompiler from '../../scripts/blender_asset.py';
import proposalGuide from '../../prompts/proposal-guide.md';
import { agentInstructions } from './prompts';
import { designReasoningEffort, MODEL_MAX_OUTPUT_TOKENS } from './model-settings';
import { artifact } from './store';
import type { Bindings, RunParams } from './types';

export type RuntimeProfileSources = { schema: unknown; prompts: unknown; authoring: string; compiler: unknown };
const profileVersion = 2;

function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJSON(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function sources(): RuntimeProfileSources {
  return {
    schema: { design: z.toJSONSchema(DesignSchema), brief: z.toJSONSchema(BriefSchema), edits: z.toJSONSchema(DesignEditsSchema), plan: z.toJSONSchema(PlanSchema) },
    prompts: { roles: Object.fromEntries((['principal', 'architect', 'designer', 'critic'] as AgentId[]).map(agent => [agent, agentInstructions(agent)])), proposalGuide },
    authoring,
    compiler: { canonical: compiler, asset: assetCompiler, furniture },
  };
}
let bundledHashes: Promise<Record<keyof RuntimeProfileSources, string>> | undefined;
async function componentHashes(input: RuntimeProfileSources) {
  const names = ['schema', 'prompts', 'authoring', 'compiler'] as const;
  const hashes = await Promise.all(names.map(name => sha256(input[name])));
  return Object.fromEntries(names.map((name, index) => [name, hashes[index]])) as Record<keyof RuntimeProfileSources, string>;
}
const connected = (value: unknown) => typeof value === 'string' && Boolean(value.trim());
const enabled = (value: unknown) => String(value) === 'true';
function identifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  // Model/template identifiers are public configuration, never arbitrary env
  // text or a mistakenly assigned provider credential.
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(name) && !/^(sk-|e2b_|Bearer)/i.test(name) ? name : null;
}

/** Diagnostic comparison of configured inputs; no provider calls or secret hashes. */
export async function runtimeProfile(env: Bindings, input?: RuntimeProfileSources) {
  const components = await (input ? componentHashes(input) : bundledHashes ??= componentHashes(sources()));
  let effort: ReturnType<typeof designReasoningEffort> | null;
  try { effort = designReasoningEffort(env); } catch { effort = null; }
  const configuration = {
    models: { design: identifier(env.OPENAI_MODEL), voice: identifier(env.VOICE_MODEL), conceptImage: identifier(env.OPENAI_IMAGE_CONCEPT_MODEL), imageEdit: identifier(env.OPENAI_IMAGE_EDIT_MODEL) },
    reasoning: { design: effort },
    limits: { modelOutputTokens: MODEL_MAX_OUTPUT_TOKENS },
    features: { generation: enabled(env.GENERATION_ENABLED), render: enabled(env.RENDER_ENABLED), voice: enabled(env.VOICE_ENABLED), imageGeneration: enabled(env.IMAGE_GENERATION_ENABLED) },
    workstation: { template: identifier(env.E2B_TEMPLATE) },
  };
  return {
    version: profileVersion,
    fingerprint: await sha256({ version: profileVersion, ...configuration, components }),
    environment: ['local', 'staging', 'production'].includes(env.ENVIRONMENT) ? env.ENVIRONMENT : 'unknown',
    ...configuration,
    components,
    readiness: {
      designModelConfigured: configuration.models.design !== null,
      designReasoningConfigured: effort !== null,
      desktopKeyConfigured: connected(env.E2B_API_KEY),
      environmentModelKeyConfigured: connected(env.OPENAI_API_KEY),
      savedKeyEncryptionConfigured: connected(env.KEY_ENCRYPTION_KEYS),
      projectServicesBound: Boolean(env.DB && env.FILES && env.PROJECTS && env.BUDGET && env.JOBS),
      providerConnectivityChecked: false,
    },
    scope: 'Configured models, reasoning effort and model output allowance, feature flags, workstation template, serialized schema contracts, bundled prompts, authoring helpers and compilers. Matching fingerprints do not prove identical code, provider availability, workstation software, stochastic output or design quality.',
  };
}
export type RuntimeProfile = Awaited<ReturnType<typeof runtimeProfile>>;

/** Freeze the first profile saved for this run, including after checkpoint replay. */
export async function saveRuntimeProfile(env: Bindings, run: RunParams) {
  const name = 'generation-profile.json', id = `${run.runId}-${name}`;
  const readSaved = async () => {
    const saved = await env.DB.prepare('SELECT object_key FROM artifacts WHERE id = ? AND project_id = ?').bind(id, run.projectId).first<{ object_key: string }>();
    if (!saved) return null;
    const object = await env.FILES.get(saved.object_key);
    if (!object) throw new Error('Saved generation profile is unavailable.');
    const record = await object.json<{ profile: RuntimeProfile }>();
    if (!/^[a-f0-9]{64}$/.test(record.profile?.fingerprint ?? '')) throw new Error('Saved generation profile is invalid.');
    return { artifactId: id, fingerprint: record.profile.fingerprint };
  };
  const previous = await readSaved();
  if (previous) return previous;
  const profile = await runtimeProfile(env);
  await artifact(env, run.projectId, run.runId, name, 'generation-profile', run.baseRevision,
    JSON.stringify({ profile, run: { id: run.runId, kind: run.kind, baseRevision: run.baseRevision }, recordedAt: new Date().toISOString() }), 'application/json');
  // artifact() resolves concurrent identical IDs to the first successful write.
  const saved = await readSaved();
  if (!saved) throw new Error('Generation profile could not be saved.');
  return saved;
}
