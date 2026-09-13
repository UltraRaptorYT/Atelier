import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { exampleDesign } from '../shared/example';
import type { AgentId, Design } from '../shared/design';
import type { DesignEdits } from '../shared/design-edits';
import type { Bindings } from '../worker/src/types';
import { MAX_PROPOSAL_BYTES, PROPOSAL_PATH, PreviewCameraSchema, ProposalError, ProposalSession, parseProposal } from '../worker/src/proposals';

const mocks = vi.hoisted(() => ({ artifact: vi.fn() }));
vi.mock('../worker/src/store', () => ({ artifact: mocks.artifact }));
const bytes = (value: string) => new TextEncoder().encode(value);
const emptyEdits = (): DesignEdits => ({ elements: { upsert: [], remove: [] }, materials: { upsert: [], remove: [] }, spaces: { upsert: [], remove: [] }, metadata: { title: null, buildingType: null, floors: null, spawn: null, notes: null } });
const registeredAsset = { id: 'asset_test', name: 'Original chair', artifactId: 'task-asset_test.glb', author: 'Project specialist', license: 'Original project geometry' };
function png(width = 640, height = 480) {
  const result = new Uint8Array(33), view = new DataView(result.buffer);
  result.set([137, 80, 78, 71, 13, 10, 26, 10]); result.set(bytes('IHDR'), 12);
  view.setUint32(16, width); view.setUint32(20, height);
  return result;
}
function setup(baseDesign: Design | null = null, agent: AgentId = 'architect') {
  const files = new Map<string, Uint8Array>();
  files.set(PROPOSAL_PATH, bytes(JSON.stringify(baseDesign ? emptyEdits() : exampleDesign())));
  const read = vi.fn(async (path: string, _options: { format: string }) => {
    const value = files.get(path);
    if (!value) throw new Error('File does not exist');
    return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(value); controller.close(); } });
  });
  const write = vi.fn(async (path: string, data: string) => { files.set(path, bytes(data)); });
  const run = vi.fn(async (command: string, _options?: { timeoutMs: number }) => {
    const output = command.match(/--output (\S+)/)![1], view = command.match(/--view (\S+)/)![1];
    const source = files.get('/home/user/project/inspection-design.json')!;
    const design = JSON.parse(new TextDecoder().decode(source)) as Design;
    // Match real compiler variants: plans/interiors do not emit `front`.
    const camera = view.startsWith('plan_')
      ? { position: [0, 17.7, -.85], target: [0, 1.2, -.85], orthographic: true, orthoScale: 15.486666666666668, floor: view === 'plan_upper' ? 1 : 0, cutHeight: 1.2 }
      : view === 'interior'
        ? { position: [-3.3, 1.65, -3.3], target: [0, 1.5, 0], lens: 22, floor: 0, spaceId: 'living', cameraObstructions: 0 }
        : { position: [1, 2, 3], target: [0, 1, 0], front: [0, 1], lens: 42 };
    const metadata = { revision: 3, view, camera, resolution: [640, 480], samples: 8, source: 'task proposal', designHash: createHash('sha256').update(source).digest('hex'), elements: design.elements.length };
    files.set(`${output}/preview-${view}.json`, bytes(JSON.stringify(metadata)));
    files.set(`${output}/preview-${view}.png`, png());
    return { exitCode: 0 };
  });
  const checkActive = vi.fn(async () => {}), prepare = vi.fn(async () => {}), assets: Design['assets'] = [];
  const desktop = { files: { read, write }, commands: { run } };
  const session = new ProposalSession({ env: {} as Bindings, desktop: desktop as never, projectId: 'project-1', runId: 'run-1', taskId: 'run-1-architecture', key: 'team-0-task-0', baseRevision: 3, baseDesign, agent, registeredAssets: () => assets, prepare, checkActive });
  return { session, files, read, write, run, prepare, checkActive, assets, set(value: unknown) { files.set(PROPOSAL_PATH, bytes(JSON.stringify(value))); } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.artifact.mockImplementation(async (_env, _project, run, name) => `${run}-${name}`);
});

describe('validated file proposals', () => {
  it('preserves bounded invalid authoring bytes as an unpublished recovery artifact', async () => {
    const ctx = setup(), draft = bytes('{"unfinished":');
    ctx.files.set(PROPOSAL_PATH, draft);
    await ctx.session.saveDraft();
    expect(mocks.artifact).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'project-1', 'run-1', 'team-0-task-0-unsubmitted-proposal.json', 'proposal-draft', 3, draft, 'application/json');
    expect(ctx.session.submitted).toBeNull();
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.prepare).not.toHaveBeenCalled();
  });

  it('does not persist an oversized or cancelled draft', async () => {
    const ctx = setup();
    ctx.files.set(PROPOSAL_PATH, new Uint8Array(MAX_PROPOSAL_BYTES + 1));
    await expect(ctx.session.saveDraft()).rejects.toThrow('exceeds');
    ctx.checkActive.mockRejectedValue(new Error('cancelled'));
    await expect(ctx.session.saveDraft()).rejects.toThrow('cancelled');
    expect(mocks.artifact).not.toHaveBeenCalled();
  });
  it('accepts and preserves camera metadata from the actual Python compiler for every view', () => {
    const design = exampleDesign();
    design.floors = 2;
    design.spaces.push({ ...design.spaces[0], id: 'upper-room', floor: 1, position: [0, 4.5, 0] });
    const cameras = JSON.parse(execFileSync('python3', ['-c', "import json,sys; from scripts.blender_compile import presentation_camera; d=json.load(sys.stdin); print(json.dumps({v:presentation_camera(d,v) for v in ['front','rear','plan_ground','plan_upper','interior']}))"], { input: JSON.stringify(design), encoding: 'utf8' }));
    for (const camera of Object.values(cameras)) expect(PreviewCameraSchema.parse(camera)).toEqual(camera);
    expect(cameras.plan_ground).not.toHaveProperty('front');
    expect(cameras.interior).not.toHaveProperty('front');
    expect(cameras.plan_upper).toMatchObject({ floor: 1, orthographic: true });
    expect(cameras.interior).toMatchObject({ lens: 22, floor: 0, cameraObstructions: expect.any(Number) });
    expect(PreviewCameraSchema.safeParse({ ...cameras.interior, cameraObstructions: 1201 }).success).toBe(false);
  });
  it('accepts a detailed file without reserializing the scene into a model response', async () => {
    const ctx = setup(), design = exampleDesign();
    design.elements = Array.from({ length: 1000 }, (_, index) => ({ ...design.elements[index % design.elements.length], id: `detailed_${index}` }));
    expect(JSON.stringify(design).length).toBeGreaterThan(18000);
    ctx.set(design);
    const inspection = await ctx.session.inspect(), receipt = await ctx.session.submit();
    expect(receipt).toEqual({ hash: inspection.hash, baseRevision: 3, evidenceArtifactId: inspection.evidenceArtifactId, elementCount: 1000 });
    expect(JSON.stringify(receipt).length).toBeLessThan(400);
    expect(ctx.session.submitted?.design).toEqual(design);
    expect(ctx.write.mock.calls.map(([path]) => path)).toEqual(['/home/user/project/inspection-design.json']);
    expect(ctx.read.mock.calls.every(([_path, options]) => (options as { format: string })?.format === 'stream')).toBe(true);
  });

  it('persists actual proposal images and explicit task/base/hash provenance, without publishing a canonical revision', async () => {
    const ctx = setup(), result = await ctx.session.inspect();
    expect(result.images).toHaveLength(3);
    expect(result.evidence).toMatchObject({ canonical: false, source: 'task proposal', projectId: 'project-1', runId: 'run-1', taskId: 'run-1-architecture', baseRevision: 3, candidateHash: result.hash, unavailable: [] });
    expect(result.evidence.views.map(view => view.view)).toEqual(['front', 'plan_ground', 'interior']);
    const metadata = mocks.artifact.mock.calls.filter(call => call[4] === 'proposal-render-metadata').map(call => JSON.parse(call[6]));
    expect(metadata).toHaveLength(3);
    expect(metadata.every(item => item.canonical === false && item.designHash === result.hash && item.taskId === 'run-1-architecture')).toBe(true);
    expect(ctx.run.mock.calls.every(([command, options]) => command.includes("--source 'task proposal'") && (options as { timeoutMs: number }).timeoutMs === 60000)).toBe(true);
  });

  it('rejects uninspected and changed candidates, permits a second inspection, and freezes the accepted design', async () => {
    const ctx = setup();
    await expect(ctx.session.submit()).rejects.toThrow(/has not been inspected/);
    await ctx.session.inspect();
    const changed = { ...exampleDesign(), title: 'Refined after seeing the first render' };
    ctx.set(changed);
    await expect(ctx.session.submit()).rejects.toThrow(/proposal changed/);
    await ctx.session.inspect();
    await ctx.session.submit();
    const returned = ctx.session.submitted!; returned.design.title = 'Caller mutation';
    ctx.set({ ...changed, title: 'Later workstation mutation' });
    expect(ctx.session.submitted?.design.title).toBe(changed.title);
    await expect(ctx.session.submit()).rejects.toThrow(/frozen/);
    expect(ctx.run).toHaveBeenCalledTimes(6);
  });

  it('treats whitespace/property-order changes as the same validated candidate and reuses complete previews', async () => {
    const ctx = setup(), design = exampleDesign();
    const first = await ctx.session.inspect();
    ctx.files.set(PROPOSAL_PATH, bytes(JSON.stringify(Object.fromEntries(Object.entries(design).reverse()), null, 2)));
    expect((await ctx.session.inspect()).hash).toBe(first.hash);
    expect(await ctx.session.submit()).toMatchObject({ hash: first.hash });
    expect(ctx.run).toHaveBeenCalledTimes(3);
    expect(await ctx.session.submit()).toMatchObject({ hash: first.hash });
  });

  it.each([
    (design: Design) => ({ ...design, blender: { meshes: [] } }),
    (design: Design) => ({ ...design, elements: [{ ...design.elements[0], blender: { type: 'mesh' } }, ...design.elements.slice(1)] }),
    (design: Design) => ({ ...design, materials: [{ ...design.materials[0], texture: '/tmp/photo.png' }, ...design.materials.slice(1)] }),
    (design: Design) => ({ ...design, spaces: [{ ...design.spaces[0], unregisteredShape: true }, ...design.spaces.slice(1)] }),
  ])('rejects unsupported authored fields instead of silently stripping them', mutate => {
    expect(() => parseProposal(mutate(exampleDesign()), null, 'architect', [])).toThrow(/canonical schema/);
  });

  it('preserves untouched records during incremental edits and rejects designer structural changes before rendering', async () => {
    const design = exampleDesign(), ctx = setup(design, 'designer'), edits = emptyEdits();
    edits.materials.upsert = [{ ...design.materials[0], color: '#123456' }];
    ctx.set(edits);
    await ctx.session.inspect(); await ctx.session.submit();
    expect(ctx.session.submitted?.design.elements).toEqual(design.elements);
    expect(ctx.session.submitted?.design.materials[0].color).toBe('#123456');
    const accepted = ctx.session.submitted!;
    expect(accepted.input).toEqual(edits);
    (accepted.input as DesignEdits).materials.upsert[0].color = '#ffffff';
    expect(ctx.session.submitted?.input).toEqual(edits);
    const unauthorized = setup(design, 'designer');
    edits.elements.upsert = [{ ...design.elements.find(element => element.kind === 'wall')!, size: [2, 3, 4] }];
    unauthorized.set(edits);
    await expect(unauthorized.session.inspect()).rejects.toThrow(/ownership/);
    expect(unauthorized.run).not.toHaveBeenCalled();
    expect(unauthorized.session.submitted).toBeNull();
  });

  it('rejects unsupported nested mesh metadata in both complete files and incremental edits', () => {
    const design = exampleDesign();
    const element = { ...design.elements[0], geometry: { type: 'mesh', vertices: [[-.5, -.5, 0], [.5, -.5, 0], [0, .5, 0]], triangles: [[0, 1, 2]], unsupportedTexture: 'local-only.png' } };
    expect(() => parseProposal({ ...design, elements: [element, ...design.elements.slice(1)] }, null, 'architect', [])).toThrow(/Unsupported canonical schema field.*geometry.unsupportedTexture/);
    const edits = emptyEdits();
    expect(() => parseProposal({ ...edits, elements: { upsert: [element], remove: [] } }, design, 'architect', [])).toThrow(/Unsupported canonical schema field.*geometry.unsupportedTexture/);
  });

  it('merges only referenced trusted assets and rejects forged registries and unknown assets', () => {
    const design = exampleDesign(), furniture = { ...design.elements[0], id: 'sculpted_chair', kind: 'furniture' as const, assetId: registeredAsset.id };
    design.elements.push(furniture);
    const unused = { ...registeredAsset, id: 'unused_mesh', artifactId: 'unused.glb' };
    expect(parseProposal(design, null, 'architect', [registeredAsset, unused]).assets).toEqual([registeredAsset]);
    expect(() => parseProposal(design, null, 'architect', [])).toThrow(/Unknown asset/);
    expect(() => parseProposal({ ...design, assets: [{ ...registeredAsset, artifactId: 'foreign-project-secret.glb' }] }, null, 'architect', [registeredAsset])).toThrow(/registry/);
    const edits = emptyEdits(); edits.elements.upsert = [furniture];
    const base = exampleDesign(), result = parseProposal(edits, base, 'designer', [registeredAsset, unused]);
    expect(result.assets).toEqual([registeredAsset]);
    expect(result.elements.slice(0, base.elements.length)).toEqual(base.elements);
    expect(() => parseProposal({ ...edits, assets: [registeredAsset] }, base, 'designer', [registeredAsset])).toThrow(/canonical schema/);
  });

  it('does not spend render attempts on fixable invalid JSON or schema errors', async () => {
    const ctx = setup();
    ctx.files.set(PROPOSAL_PATH, bytes('{invalid'));
    await expect(ctx.session.inspect()).rejects.toBeInstanceOf(ProposalError);
    ctx.set({ elements: [] }); await expect(ctx.session.inspect()).rejects.toThrow(/schema/);
    ctx.set(exampleDesign());
    await ctx.session.inspect(); await ctx.session.submit();
    expect(ctx.run).toHaveBeenCalledTimes(3);
  });

  it('bounds streaming input and cancels oversized reads before parsing or rendering', async () => {
    const ctx = setup(), cancel = vi.fn();
    ctx.read.mockImplementationOnce(async () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_PROPOSAL_BYTES)); controller.enqueue(new Uint8Array(1)); }, cancel }));
    await expect(ctx.session.inspect()).rejects.toThrow(/byte allowance/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(ctx.run).not.toHaveBeenCalled();
  });

  it('does not submit after a failed preview and can recover with one bounded retry', async () => {
    const ctx = setup(); ctx.run.mockResolvedValueOnce({ exitCode: 1 });
    const first = await ctx.session.inspect();
    expect(first.evidence.unavailable).toEqual(['front']);
    await expect(ctx.session.submit()).rejects.toThrow(/missing preview evidence/);
    const second = await ctx.session.inspect();
    expect(second.evidence.unavailable).toEqual([]);
    expect(second.evidence.attempt).toBe(2);
    await ctx.session.submit();
    expect(ctx.run).toHaveBeenCalledTimes(6);
  });

  it.each(['hash', 'source', 'dimensions'])('rejects forged or stale %s in preview evidence', async failure => {
    const ctx = setup(), original = ctx.run.getMockImplementation()!;
    ctx.run.mockImplementation(async command => {
      const result = await original(command);
      const output = command.match(/--output (\S+)/)![1], view = command.match(/--view (\S+)/)![1];
      const path = `${output}/preview-${view}.json`, metadata = JSON.parse(new TextDecoder().decode(ctx.files.get(path)));
      if (failure === 'hash') metadata.designHash = 'f'.repeat(64);
      if (failure === 'source') metadata.source = 'canonical design';
      if (failure === 'dimensions') metadata.resolution = [100, 100];
      ctx.files.set(path, bytes(JSON.stringify(metadata)));
      return result;
    });
    expect((await ctx.session.inspect()).evidence.unavailable).toHaveLength(3);
    await expect(ctx.session.submit()).rejects.toThrow(/missing preview/);
    expect(ctx.session.submitted).toBeNull();
  });

  it('allows at most two distinct render attempts per specialist task', async () => {
    const ctx = setup();
    await ctx.session.inspect();
    ctx.set({ ...exampleDesign(), title: 'Second version' }); await ctx.session.inspect();
    ctx.set({ ...exampleDesign(), title: 'Third version' });
    await expect(ctx.session.inspect()).rejects.toThrow(/two proposal inspection attempts/);
    await expect(ctx.session.submit()).rejects.toThrow(/proposal changed/);
    expect(ctx.run).toHaveBeenCalledTimes(6);
  });

  it('fences submission and inspection completion when cancellation arrives', async () => {
    const ctx = setup();
    await ctx.session.inspect();
    ctx.checkActive.mockRejectedValue(new Error('Work stopped'));
    await expect(ctx.session.submit()).rejects.toThrow('Work stopped');
    expect(ctx.session.submitted).toBeNull();
    const late = setup();
    mocks.artifact.mockImplementation(async (_env, _project, run, name) => {
      if (name.endsWith('-evidence.json')) late.checkActive.mockRejectedValue(new Error('Work stopped'));
      return `${run}-${name}`;
    });
    await expect(late.session.inspect()).rejects.toThrow('Work stopped');
    expect(late.session.submitted).toBeNull();
  });

  it('does not swallow artifact persistence failures as successful visual inspection', async () => {
    const ctx = setup();
    mocks.artifact.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(ctx.session.inspect()).rejects.toThrow('Storage unavailable');
    await expect(ctx.session.submit()).rejects.toThrow(/has not been inspected/);
    expect(ctx.session.submitted).toBeNull();
  });
});
