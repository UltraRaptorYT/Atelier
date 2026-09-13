import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { generateStudy, imagePrompt, loadImageReference, saveCapture, selectConcept } from '../worker/src/images';
import { generateImage } from '../worker/src/image-provider';
import { exampleDesign } from '../shared/example';
import type { Bindings, ProjectRow, RunParams } from '../worker/src/types';

vi.mock('../worker/src/image-provider', () => ({ generateImage: vi.fn() }));

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const capture = `data:image/png;base64,${png.toString('base64')}`;
const brief = { request: 'A warm courtyard house for four people.', summary: 'Courtyard house', goals: [], constraints: ['Preserve a central courtyard'], questions: [] };
const provider = vi.mocked(generateImage);
let mf: Miniflare;
let env: Bindings;

beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("image test storage"); } };',
    compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], r2Buckets: ['FILES'],
  }));
  const storage = await mf.getBindings();
  env = {
    ...storage, OPENAI_API_KEY: 'private-image-test-key', IMAGE_GENERATION_ENABLED: 'true',
    OPENAI_IMAGE_CONCEPT_MODEL: 'gpt-image-2.5-flare', OPENAI_IMAGE_EDIT_MODEL: 'gpt-image-2.5-sunburst',
  } as unknown as Bindings;
  for (const migration of readdirSync('worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(`worker/migrations/${migration}`, 'utf8').split(';').filter(sql => sql.trim())) {
      await env.DB.prepare(statement).run();
    }
  }
});

beforeEach(() => {
  provider.mockReset();
  provider.mockImplementation(async () => ({ bytes: png, mime: 'image/png', usage: { input_tokens: 20, output_tokens: 100 }, revisedPrompt: null }));
});

afterAll(async () => { await mf?.dispose(); });

async function seed(options: { revision?: number; owner?: string; runStatus?: string } = {}) {
  const id = crypto.randomUUID(), owner = options.owner ?? crypto.randomUUID();
  const revision = options.revision ?? 0, design = revision ? exampleDesign() : null;
  const designKey = design ? `${id}/canonical.json` : null;
  if (designKey) await env.FILES.put(designKey, JSON.stringify(design));
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO projects(id,owner_id,name,brief,revision,design_key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id, owner, 'Image study house', JSON.stringify(brief), revision, designKey, design ? 'ready' : 'draft', now, now).run();
  const params: RunParams = { projectId: id, userId: owner, runId: crypto.randomUUID(), kind: 'image', baseRevision: revision, agent: 'designer', instruction: 'Explore a warm red courtyard exterior.' };
  await env.DB.prepare('INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,instruction,agent,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(params.runId, id, owner, 'image', options.runStatus ?? 'in_progress', revision, params.instruction!, 'designer', now).run();
  const row = (await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>())!;
  return { params, row, design };
}

async function projectRow(id: string) {
  return (await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>())!;
}

describe('image studies with real D1 and R2', () => {
  it('saves one image and provenance without changing the canonical design or reserving a computer', async () => {
    const { params, row, design } = await seed({ revision: 2 });
    const id = await generateStudy(env, params, 'study', brief);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-2.5-flare', reference: undefined }));
    expect(await projectRow(row.id)).toMatchObject({ revision: row.revision, design_key: row.design_key, status: 'ready', concept_artifact_id: null });
    expect(await (await env.FILES.get(row.design_key!))!.json()).toEqual(design);
    const study = await env.DB.prepare('SELECT * FROM image_studies WHERE id = ?').bind(id).first<{ revision: number; metadata_artifact_id: string }>();
    expect(study?.revision).toBe(2);
    const metadataRow = await env.DB.prepare('SELECT object_key FROM artifacts WHERE id = ?').bind(study!.metadata_artifact_id).first<{ object_key: string }>();
    const metadataText = await (await env.FILES.get(metadataRow!.object_key))!.text();
    expect(JSON.parse(metadataText)).toMatchObject({ canonical: false, revision: 2, brief, sourceArtifactId: null, imageArtifactId: id, usage: { input_tokens: 20, output_tokens: 100 } });
    expect(metadataText).not.toContain('private-image-test-key');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ?').bind(row.id).first<{ n: number }>())?.n).toBe(2);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM desktop_sessions WHERE project_id = ?').bind(row.id).first<{ n: number }>())?.n).toBe(0);
    expect((await loadImageReference(env, row.id, id, 2)).bytes).toEqual(new Uint8Array(png));
  });

  it('cleans unregistered files if the metadata upload fails, without spending again on retry', async () => {
    const { params } = await seed();
    const files = {
      put: async (key: string, bytes: Uint8Array | string, options: R2PutOptions) => {
        if (key.endsWith('.json')) throw new Error('Metadata storage unavailable');
        return env.FILES.put(key, bytes, options);
      },
      delete: (key: string) => env.FILES.delete(key),
    } as unknown as R2Bucket;
    await expect(generateStudy({ ...env, FILES: files }, params, 'study', brief)).rejects.toThrow('Metadata storage');
    expect((await env.FILES.list({ prefix: `${params.projectId}/images/` })).objects).toHaveLength(0);
    await expect(generateStudy(env, params, 'study', brief)).rejects.toMatchObject({ status: 409 });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('preserves registered files after an ambiguous publication acknowledgment and recovers the saved result', async () => {
    const { params } = await seed();
    const db = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.batch(statements);
        throw new Error('Publication acknowledgment lost');
      },
    } as unknown as D1Database;
    await expect(generateStudy({ ...env, DB: db }, params, 'study', brief)).rejects.toThrow('acknowledgment lost');
    expect((await env.FILES.list({ prefix: `${params.projectId}/images/` })).objects).toHaveLength(2);
    const id = await generateStudy(env, params, 'study', brief);
    expect((await loadImageReference(env, params.projectId, id)).bytes).toEqual(new Uint8Array(png));
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('returns a completed study on retry without another provider attempt or duplicate completion event', async () => {
    const { params } = await seed();
    const first = await generateStudy(env, params, 'study', brief);
    expect(await generateStudy(env, params, 'study', brief)).toBe(first);
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM image_attempts WHERE run_id = ?').bind(params.runId).first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND type = 'tool_completed'").bind(params.projectId).first<{ n: number }>())?.n).toBe(1);
  });

  it('reserves an uncertain failed request once and requires a new operation before spending again', async () => {
    const { params } = await seed();
    provider.mockRejectedValueOnce(new Error('Ambiguous provider connection failure'));
    await expect(generateStudy(env, params, 'study', brief)).rejects.toThrow('Ambiguous provider');
    await expect(generateStudy(env, params, 'study', brief)).rejects.toMatchObject({ status: 409 });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare('SELECT status FROM image_attempts WHERE run_id = ?').bind(params.runId).first()).toMatchObject({ status: 'failed' });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM image_studies WHERE project_id = ?').bind(params.projectId).first<{ n: number }>())?.n).toBe(0);
  });

  it.each(['cancelled', 'completed', 'queued'])('does not make a paid call for a run that is %s', async runStatus => {
    const { params } = await seed({ runStatus });
    await expect(generateStudy(env, params, 'study', brief)).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects a stale starting revision before reserving or generating an image', async () => {
    const { params } = await seed({ revision: 2 });
    await expect(generateStudy(env, { ...params, baseRevision: 1 }, 'study', brief)).rejects.toMatchObject({ status: 409 });
    expect(provider).not.toHaveBeenCalled();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM image_attempts WHERE run_id = ?').bind(params.runId).first<{ n: number }>())?.n).toBe(0);
  });

  it.each(['cancelled', 'revision changed'])('fences the returned provider image when work was %s during generation', async outcome => {
    const { params, row } = await seed({ revision: 2 });
    provider.mockImplementationOnce(async () => {
      if (outcome === 'cancelled') await env.DB.prepare("UPDATE runs SET status = 'cancelled' WHERE id = ?").bind(params.runId).run();
      else await env.DB.prepare('UPDATE projects SET revision = revision + 1 WHERE id = ?').bind(row.id).run();
      return { bytes: png, mime: 'image/png', usage: null, revisedPrompt: null };
    });
    await expect(generateStudy(env, params, 'study', brief)).rejects.toMatchObject({ status: 409 });
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM image_studies WHERE project_id = ?').bind(row.id).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ?').bind(row.id).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND type = 'tool_completed'").bind(row.id).first<{ n: number }>())?.n).toBe(0);
    expect(await projectRow(row.id)).toMatchObject({ concept_artifact_id: null, design_key: row.design_key, status: row.status });
    expect((await env.FILES.list({ prefix: `${row.id}/images/` })).objects).toHaveLength(0);
  });

  it('admits at most the final daily slot when independent requests race', async () => {
    const { params } = await seed();
    const now = new Date().toISOString();
    for (let index = 0; index < 11; index++) {
      await env.DB.prepare('INSERT INTO image_attempts(id,owner_id,run_id,day,status,created_at) VALUES(?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), params.userId, params.runId, now.slice(0, 10), 'failed', now).run();
    }
    const outcomes = await Promise.allSettled([
      generateStudy(env, params, 'candidate-a', brief), generateStudy(env, params, 'candidate-b', brief),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 429 } });
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM image_attempts WHERE owner_id = ?').bind(params.userId).first<{ n: number }>())?.n).toBe(12);
  });

  it('edits only a same-project image from the requested canonical revision', async () => {
    const { params, row } = await seed({ revision: 1 });
    const referenceArtifactId = await saveCapture(env, row, crypto.randomUUID(), capture);
    const id = await generateStudy(env, { ...params, referenceArtifactId }, 'study', brief);
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-2.5-sunburst', reference: expect.objectContaining({ bytes: new Uint8Array(png), mime: 'image/png' }) }));
    expect(await env.DB.prepare('SELECT source_artifact_id FROM image_studies WHERE id = ?').bind(id).first()).toEqual({ source_artifact_id: referenceArtifactId });
    const other = await seed({ revision: 1 });
    provider.mockClear();
    await expect(generateStudy(env, { ...other.params, referenceArtifactId }, 'study', brief)).rejects.toMatchObject({ status: 404 });
    expect(provider).not.toHaveBeenCalled();
    await env.DB.prepare('UPDATE projects SET revision = 2 WHERE id = ?').bind(row.id).run();
    await expect(generateStudy(env, { ...params, baseRevision: 2, referenceArtifactId }, 'later-study', brief)).rejects.toMatchObject({ status: 409 });
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('captured model references and concept selection', () => {
  it('cleans a captured image if saving its companion metadata fails', async () => {
    const { row } = await seed({ revision: 1 });
    const files = {
      put: async (key: string, bytes: Uint8Array | string, options: R2PutOptions) => {
        if (key.endsWith('.json')) throw new Error('Capture metadata unavailable');
        return env.FILES.put(key, bytes, options);
      },
      delete: (key: string) => env.FILES.delete(key),
    } as unknown as R2Bucket;
    await expect(saveCapture({ ...env, FILES: files }, row, crypto.randomUUID(), capture)).rejects.toThrow('Capture metadata');
    expect((await env.FILES.list({ prefix: `${row.id}/captures/` })).objects).toHaveLength(0);
  });

  it('persists a capture once with source revision and validates it when loaded', async () => {
    const { row } = await seed({ revision: 3 });
    const operation = crypto.randomUUID();
    const id = await saveCapture(env, row, operation, capture);
    expect(await saveCapture(env, row, operation, capture)).toBe(id);
    const loaded = await loadImageReference(env, row.id, id, 3);
    expect(loaded).toEqual({ bytes: new Uint8Array(png), mime: 'image/png', dataUrl: capture });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ?').bind(row.id).first<{ n: number }>())?.n).toBe(2);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND type = 'artifact_created'").bind(row.id).first<{ n: number }>())?.n).toBe(1);
    const other = await seed({ revision: 3 });
    await expect(loadImageReference(env, other.row.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(saveCapture(env, other.row, operation, capture)).rejects.toMatchObject({ status: 409 });
    await expect(loadImageReference(env, row.id, id, 4)).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ['non-raster', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['invalid base64', 'data:image/png;base64,invalid!'],
    ['truncated PNG', `data:image/png;base64,${png.subarray(0, 8).toString('base64')}`],
    ['oversized upload', 'data:image/png;base64,' + 'A'.repeat(Math.ceil(8 * 1024 * 1024 / 3) * 4 + 4)],
  ])('rejects a %s before creating artifacts', async (_label, input) => {
    const { row } = await seed({ revision: 1 });
    await expect(saveCapture(env, row, crypto.randomUUID(), input)).rejects.toThrow();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ?').bind(row.id).first<{ n: number }>())?.n).toBe(0);
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects excessive decoded dimensions even when the PNG has a short body', async () => {
    const { row } = await seed({ revision: 1 });
    const hugeDimensions = Buffer.from(png);
    hugeDimensions.writeUInt32BE(8193, 16);
    await expect(saveCapture(env, row, crypto.randomUUID(), `data:image/png;base64,${hugeDimensions.toString('base64')}`)).rejects.toMatchObject({ status: 400 });
  });

  it('does not publish a stale capture or a view when no canonical design exists', async () => {
    const { row } = await seed({ revision: 1 });
    await env.DB.prepare('UPDATE projects SET revision = 2 WHERE id = ?').bind(row.id).run();
    await expect(saveCapture(env, row, crypto.randomUUID(), capture)).rejects.toMatchObject({ status: 409 });
    const draft = await seed();
    await expect(saveCapture(env, draft.row, crypto.randomUUID(), capture)).rejects.toMatchObject({ status: 409 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE project_id IN (?,?)').bind(row.id, draft.row.id).first<{ n: number }>())?.n).toBe(0);
    expect((await env.FILES.list({ prefix: `${row.id}/captures/` })).objects).toHaveLength(0);
  });

  it('selects a generated study without editing canonical state and rejects captures or foreign studies as concepts', async () => {
    const { params, row } = await seed({ revision: 1 });
    const id = await generateStudy(env, params, 'study', brief);
    await selectConcept(env, row, id, crypto.randomUUID());
    expect(await projectRow(row.id)).toMatchObject({ concept_artifact_id: id, revision: row.revision, design_key: row.design_key, status: row.status });
    const reference = await saveCapture(env, row, crypto.randomUUID(), capture);
    await expect(selectConcept(env, row, reference, crypto.randomUUID())).rejects.toMatchObject({ status: 409 });
    const other = await seed({ revision: 1 });
    await expect(selectConcept(env, other.row, id, crypto.randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await projectRow(other.row.id)).concept_artifact_id).toBeNull();
  });

  it('does not restore an earlier choice when a completed selection operation is replayed', async () => {
    const { params, row } = await seed();
    const first = await generateStudy(env, params, 'candidate-a', brief);
    const second = await generateStudy(env, params, 'candidate-b', brief);
    const operation = crypto.randomUUID();
    await selectConcept(env, row, first, operation);
    await selectConcept(env, row, second, crypto.randomUUID());
    await selectConcept(env, row, first, operation);
    expect((await projectRow(row.id)).concept_artifact_id).toBe(second);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND type = 'concept_selected'").bind(row.id).first<{ n: number }>())?.n).toBe(2);
  });
});

describe('bounded architectural image prompt', () => {
  it('keeps a maximum-size editable design inside the provider prompt limit while retaining the user direction', () => {
    const design = exampleDesign();
    design.elements = Array.from({ length: 1200 }, (_, index) => ({ ...design.elements[0], id: `element-${index}`, name: 'An articulated courtyard wall with sheltered outdoor gathering spaces' }));
    const direction = 'Make only the exterior red; keep the courtyard and entrance.';
    const prompt = imagePrompt(brief, direction, true, design);
    expect(prompt.length).toBeLessThanOrEqual(32000);
    expect(prompt).toContain(direction);
    expect(prompt).toContain(brief.request);
  });
});
