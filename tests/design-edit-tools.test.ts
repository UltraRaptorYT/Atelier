import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelJSON } from '../worker/src/ai';
import { applyDesignEdits, DesignEditsSchema, type DesignEdits } from '../shared/design-edits';
import { mergeDesignProposal } from '../shared/collaboration';
import { exampleDesign } from '../shared/example';
import type { Design } from '../shared/design';
import type { Bindings } from '../worker/src/types';

const mocks = vi.hoisted(() => ({ create: vi.fn(), artifact: vi.fn(), emit: vi.fn(), credential: vi.fn() }));
vi.mock('openai', () => ({ default: class OpenAI { responses = { create: mocks.create }; } }));
vi.mock('../worker/src/prompts', () => ({ agentInstructions: () => 'Keep your task ownership.' }));
vi.mock('../worker/src/security', () => ({ credential: mocks.credential, HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock('../worker/src/store', () => ({ emit: mocks.emit, artifact: mocks.artifact }));
// Asset registration owns the compiler result; terminal transport is covered
// separately and is not part of this tool's contract.
vi.mock('../worker/src/desktop', () => ({ runVisible: vi.fn(async (desktop, command, timeoutMs) => desktop.commands.run(command, { timeoutMs })) }));
const empty = (): DesignEdits => ({ elements: { upsert: [], remove: [] }, materials: { upsert: [], remove: [] }, spaces: { upsert: [], remove: [] }, metadata: { title: null, buildingType: null, floors: null, spawn: null, notes: null } });
const final = (value: unknown) => ({ status: 'completed', output: [], output_text: JSON.stringify(value) });
const call = (name: string, args: unknown) => ({ status: 'completed', output: [{ type: 'function_call', call_id: 'tool-1', name, arguments: JSON.stringify(args) }], output_text: '' });
const outputs = () => mocks.create.mock.calls.at(-1)![0].input.filter((item: { type?: string }) => item.type === 'function_call_output');
function setup() {
  const base = exampleDesign(), registeredAssets: Design['assets'] = [];
  const first = vi.fn().mockResolvedValue({ artifact_key: 'project-1/revisions/2-original/design.json', revision: 3 });
  const bind = vi.fn(() => ({ first })), prepare = vi.fn(() => ({ bind }));
  const json = vi.fn().mockResolvedValue(base), get = vi.fn().mockResolvedValue({ size: 10000, json });
  const env = { OPENAI_MODEL: 'gpt-5.6-terra', DB: { prepare }, FILES: { get } } as unknown as Bindings;
  const desktop = { open: vi.fn().mockResolvedValue(undefined), files: { read: vi.fn(async (path: string, options?: unknown) => options ? new Uint8Array([1, 2, 3]) : path.endsWith('.glb.json') ? '{"size":[1,1,1]}' : JSON.stringify(base)), write: vi.fn() }, commands: { run: vi.fn().mockResolvedValue({ exitCode: 0 }) } };
  const context = { desktop, projectId: 'project-1', taskId: 'run-1-interior', design: base, registeredAssets };
  return { base, env, context, first, bind, prepare, json, get };
}
beforeEach(() => { vi.resetAllMocks(); mocks.credential.mockResolvedValue('test-key'); mocks.artifact.mockImplementation(async (_env, _project, task, name) => `${task}-${name}`); mocks.create.mockResolvedValue(final(empty())); });

describe('trusted assets with incremental model output', () => {
  it('does not publish an asset when Blender reports a compiler failure', async () => {
    const { env, context } = setup();
    context.desktop.commands.run.mockResolvedValueOnce({ exitCode: 1 });
    mocks.create.mockResolvedValueOnce(call('register_blender_asset', { blendFile: 'failed.blend', name: 'Failed component' }));
    await modelJSON(env, 'owner', 'architect', 'Create a roof component.', DesignEditsSchema, context as never);
    expect(outputs()[0].output).toMatch(/^Tool failed/);
    expect(context.registeredAssets).toEqual([]);
    expect(mocks.artifact).not.toHaveBeenCalled();
    expect(context.desktop.commands.run.mock.calls[0][0]).toContain('--python-exit-code 1');
  });

  it('carries a real registration result into edits without accepting model registry fields', async () => {
    const { env, context, base } = setup();
    mocks.create.mockResolvedValueOnce(call('register_blender_asset', { blendFile: 'lamp.blend', name: 'Original lamp' })).mockImplementationOnce(async request => {
      const asset = JSON.parse(request.input.find((item: { type?: string }) => item.type === 'function_call_output').output);
      const edits = empty(); edits.elements.upsert = [{ ...base.elements.find(element => element.id === 'sofa')!, assetId: asset.id }];
      return final(edits);
    });
    const edits = await modelJSON(env, 'owner', 'designer', 'Create the furniture.', DesignEditsSchema, context as never);
    expect(context.registeredAssets).toHaveLength(1);
    expect(context.registeredAssets[0]).toMatchObject({ author: 'Project specialist', license: 'Original project geometry', name: 'Original lamp' });
    expect(edits.elements.upsert[0].assetId).toBe(context.registeredAssets[0].id);
    const result = applyDesignEdits(base, edits, context.registeredAssets);
    expect(() => mergeDesignProposal(base, base, result, 'designer')).not.toThrow();
    expect(result.elements).toHaveLength(base.elements.length);
    expect(mocks.artifact).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[0][0].text.format.schema.properties).not.toHaveProperty('assets');
  });

  it('rejects invented registry values and never adds them to the server collector', async () => {
    const { env, context } = setup();
    mocks.create.mockResolvedValue(final({ ...empty(), assets: [{ id: 'invented', artifactId: 'someone-else.glb' }] }));
    await expect(modelJSON(env, 'owner', 'designer', 'Create furniture.', DesignEditsSchema, context as never)).rejects.toMatchObject({ status: 422 });
    expect(context.registeredAssets).toEqual([]);
    expect(mocks.artifact).not.toHaveBeenCalled();
  });
});

describe('read-only historical design tool', () => {
  it('reads and validates the requested revision of only the current project without changing the workstation', async () => {
    const { env, context, base, prepare, bind, get } = setup();
    mocks.create.mockResolvedValueOnce(call('read_design_revision', { revision: 2 }));
    await modelJSON(env, 'owner', 'architect', 'Restore omitted facade records from revision 2.', DesignEditsSchema, context as never);
    expect(prepare).toHaveBeenCalledExactlyOnceWith('SELECT artifact_key FROM revisions WHERE project_id = ? AND revision = ?');
    expect(bind).toHaveBeenCalledExactlyOnceWith('project-1', 2);
    expect(get).toHaveBeenCalledExactlyOnceWith('project-1/revisions/2-original/design.json');
    expect(JSON.parse(outputs()[0].output)).toEqual({ revision: 2, design: base });
    expect(context.desktop.files.write).not.toHaveBeenCalled(); expect(context.desktop.commands.run).not.toHaveBeenCalled();
    expect(mocks.artifact).not.toHaveBeenCalled();
  });

  it.each([{ revision: 0 }, { revision: 1.5 }, { revision: 101 }, { revision: 2, projectId: 'another-project' }, { revision: 2, path: 'another-project/design.json' }])('rejects invalid or cross-project arguments %j before storage access', async args => {
    const { env, context, prepare, get } = setup(); mocks.create.mockResolvedValueOnce(call('read_design_revision', args));
    await modelJSON(env, 'owner', 'architect', 'Inspect earlier design.', DesignEditsSchema, context as never);
    expect(prepare).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    expect(outputs()[0].output).toMatch(/^Tool failed/);
  });

  it.each(['missing-row', 'missing-object', 'oversized-object', 'invalid-design'] as const)('fails safely for %s without returning unvalidated data', async condition => {
    const { env, context, first, get, json } = setup();
    if (condition === 'missing-row') first.mockResolvedValue(null);
    if (condition === 'missing-object') get.mockResolvedValue(null);
    if (condition === 'oversized-object') get.mockResolvedValue({ size: 25 * 1024 * 1024 + 1, json });
    if (condition === 'invalid-design') json.mockResolvedValue({ secret: 'unvalidated payload' });
    mocks.create.mockResolvedValueOnce(call('read_design_revision', { revision: 2 }));
    await modelJSON(env, 'owner', 'architect', 'Inspect earlier design.', DesignEditsSchema, context as never);
    expect(outputs()[0].output).toMatch(/^Tool failed/); expect(outputs()[0].output).not.toContain('unvalidated payload');
    if (condition === 'oversized-object') expect(json).not.toHaveBeenCalled();
    expect(context.registeredAssets).toEqual([]);
  });

  it('reuses only referenced server-saved historical assets and preserves the current registry', async () => {
    const { env, context, base, json } = setup();
    const old = { id: 'old-lamp', name: 'Lamp', artifactId: 'old-lamp.glb', author: 'Project specialist', license: 'Original project geometry' };
    const unused = { ...old, id: 'old-unused' };
    json.mockResolvedValue({ ...base, assets: [old, unused] });
    const edits = empty(); edits.elements.upsert = [{ ...base.elements.find(element => element.id === 'sofa')!, assetId: old.id }];
    mocks.create.mockResolvedValueOnce(call('read_design_revision', { revision: 2 })).mockResolvedValueOnce(final(edits));
    const returned = await modelJSON(env, 'owner', 'designer', 'Restore the earlier furniture.', DesignEditsSchema, context as never);
    expect(context.registeredAssets).toEqual([old]);
    expect(applyDesignEdits(base, returned, context.registeredAssets).assets).toEqual([old]);
    expect(mocks.artifact).not.toHaveBeenCalled();
  });
});
