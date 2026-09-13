import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { artifact } from '../worker/src/store';
import type { Bindings } from '../worker/src/types';

const PROJECT_LIMIT = 250 * 1024 * 1024;
let mf: Miniflare, env: Bindings;
beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("artifact storage"); } };', compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], r2Buckets: ['FILES'] }));
  env = await mf.getBindings() as unknown as Bindings;
  for (const migration of readdirSync('worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(`worker/migrations/${migration}`, 'utf8').split(';').filter(value => value.trim())) await env.DB.prepare(sql).run();
  }
});
afterAll(async () => { await mf?.dispose(); });

async function project(existingBytes = 0) {
  const projectId = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO projects(id,owner_id,name,brief,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(projectId, crypto.randomUUID(), 'Storage test', '{}', now, now).run();
  if (existingBytes) {
    // Account for previous artifacts without uploading hundreds of megabytes.
    const key = `${projectId}/previous.json`;
    await env.FILES.put(key, '{}');
    await env.DB.prepare('INSERT INTO artifacts(id,project_id,name,kind,revision,object_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(`${projectId}-previous`, projectId, 'previous.json', 'test', 0, key, 'application/json', existingBytes, now).run();
  }
  return projectId;
}

function concurrentUploads(count = 2) {
  let arrived = 0, open!: () => void;
  const barrier = new Promise<void>(resolve => { open = resolve; }), keys: string[] = [];
  const files = {
    put: async (...args: Parameters<Bindings['FILES']['put']>) => {
      const uploaded = await env.FILES.put(...args);
      keys.push(args[0]);
      if (++arrived === count) open();
      await barrier;
      return uploaded;
    },
    delete: (...args: Parameters<Bindings['FILES']['delete']>) => env.FILES.delete(...args),
  };
  return { concurrent: { ...env, FILES: files } as unknown as Bindings, keys };
}

const save = (bindings: Bindings, projectId: string, run: string, name: string, data: string | Uint8Array = '12345678') => artifact(bindings, projectId, run, name, 'test', 1, data, 'application/json');

describe('atomic artifact storage allowance', () => {
  it('admits only one of two parallel artifacts near the limit and removes only the rejected upload', async () => {
    const projectId = await project(PROJECT_LIMIT - 10), { concurrent, keys } = concurrentUploads();
    const results = await Promise.allSettled([save(concurrent, projectId, 'run-a', 'a.json'), save(concurrent, projectId, 'run-b', 'b.json')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 429 } });
    const rows = await env.DB.prepare('SELECT object_key, size FROM artifacts WHERE project_id = ? AND revision = 1').bind(projectId).all<{ object_key: string; size: number }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].size).toBe(8);
    const total = await env.DB.prepare('SELECT SUM(size) AS total FROM artifacts WHERE project_id = ?').bind(projectId).first<{ total: number }>();
    expect(total?.total).toBe(PROJECT_LIMIT - 2);
    expect(keys).toHaveLength(2);
    const winner = rows.results[0].object_key, rejected = keys.find(key => key !== winner)!;
    expect(await (await env.FILES.get(winner))?.text()).toBe('12345678');
    expect(await env.FILES.get(rejected)).toBeNull();
    expect((await env.FILES.list({ prefix: `${projectId}/` })).objects).toHaveLength(2);
  });

  it('returns the same artifact for concurrent duplicates and preserves the winning object', async () => {
    const projectId = await project(), runId = crypto.randomUUID(), { concurrent, keys } = concurrentUploads();
    const results = await Promise.all([save(concurrent, projectId, runId, 'result.json', 'first'), save(concurrent, projectId, runId, 'result.json', 'second')]);
    expect(results).toEqual([`${runId}-result.json`, `${runId}-result.json`]);
    const rows = await env.DB.prepare('SELECT object_key, size FROM artifacts WHERE project_id = ?').bind(projectId).all<{ object_key: string; size: number }>();
    expect(rows.results).toHaveLength(1);
    const winner = rows.results[0].object_key;
    expect(['first', 'second']).toContain(await (await env.FILES.get(winner))?.text());
    expect(await env.FILES.get(keys.find(key => key !== winner)!)).toBeNull();
    expect((await env.FILES.list({ prefix: `${projectId}/` })).objects).toHaveLength(1);
    const savedSize = rows.results[0].size;
    await save(env, projectId, runId, 'result.json', 'This retry must not replace the original.');
    expect((await env.DB.prepare('SELECT size FROM artifacts WHERE id = ?').bind(results[0]).first<{ size: number }>())?.size).toBe(savedSize);
    expect((await env.FILES.list({ prefix: `${projectId}/` })).objects).toHaveLength(1);
  });

  it('keeps existing duplicate IDs idempotent when the project is already full', async () => {
    const projectId = await project(PROJECT_LIMIT - 8), runId = crypto.randomUUID();
    const id = await save(env, projectId, runId, 'result.json');
    expect(await save(env, projectId, runId, 'result.json', 'a longer retry')).toBe(id);
    await expect(save(env, projectId, runId, 'extra.json', 'x')).rejects.toMatchObject({ status: 429 });
    expect((await env.FILES.list({ prefix: `${projectId}/` })).objects).toHaveLength(2);
  });

  it('recognizes a duplicate that fills the quota between the initial lookup and precheck', async () => {
    const projectId = await project(PROJECT_LIMIT - 8), runId = crypto.randomUUID();
    let resume!: () => void, reached!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; }), atQuota = new Promise<void>(resolve => { reached = resolve; });
    const delayed = { ...env, DB: { prepare: (sql: string) => {
      const statement = env.DB.prepare(sql);
      if (!sql.startsWith('SELECT COALESCE(SUM(size),0) as total')) return statement;
      return { bind: (...values: unknown[]) => {
        const bound = statement.bind(...values);
        return { first: async () => { reached(); await gate; return bound.first(); } };
      } };
    } } } as unknown as Bindings;
    const pending = save(delayed, projectId, runId, 'result.json');
    await atQuota;
    const saved = await save(env, projectId, runId, 'result.json');
    resume();
    expect(await pending).toBe(saved);
    expect((await env.FILES.list({ prefix: `${projectId}/` })).objects).toHaveLength(2);
  });

  it('does not adopt a duplicate artifact from another project or delete its object', async () => {
    const first = await project(), second = await project(), runId = crypto.randomUUID();
    const id = await save(env, first, runId, 'result.json', 'keep');
    const original = await env.DB.prepare('SELECT object_key FROM artifacts WHERE id = ?').bind(id).first<{ object_key: string }>();
    await expect(save(env, second, runId, 'result.json', 'discard')).rejects.toMatchObject({ status: 429 });
    expect((await env.FILES.list({ prefix: `${second}/` })).objects).toHaveLength(0);
    expect(await (await env.FILES.get(original!.object_key))?.text()).toBe('keep');
  });

  it('rejects payloads above 25 MB before either storage system grows', async () => {
    const projectId = await project();
    await expect(save(env, projectId, crypto.randomUUID(), 'oversized.json', new Uint8Array(25 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 });
    expect((await env.DB.prepare('SELECT id FROM artifacts WHERE project_id = ?').bind(projectId).all()).results).toHaveLength(0);
    expect((await env.FILES.list({ prefix: `${projectId}/` })).objects).toHaveLength(0);
  });
});
