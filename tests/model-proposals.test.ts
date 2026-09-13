import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { modelJSON } from '../worker/src/ai';
import { ProposalSession, PROPOSAL_PATH } from '../worker/src/proposals';
import { DesignSchema, type Design } from '../shared/design';
import { applyDesignEdits, DesignEditsSchema, type DesignEdits } from '../shared/design-edits';
import { exampleDesign } from '../shared/example';
import type { Bindings } from '../worker/src/types';

const mocks = vi.hoisted(() => ({ create: vi.fn(), emit: vi.fn(), artifact: vi.fn() }));
vi.mock('openai', () => ({ default: class { responses = { create: mocks.create }; } }));
vi.mock('../worker/src/security', () => ({ credential: async () => 'test-key', HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock('../worker/src/prompts', () => ({ agentInstructions: () => 'Author an inspected file proposal.' }));
vi.mock('../worker/src/store', () => ({ emit: mocks.emit, artifact: mocks.artifact }));
// Keep registration and proposal validation real; terminal transport is tested
// separately. This workstation records the compiled files and preview metadata.
vi.mock('../worker/src/desktop', () => ({ runVisible: vi.fn(async (desktop, command, timeoutMs) => desktop.commands.run(command, { timeoutMs })) }));
const env = { OPENAI_MODEL: 'test-model' } as Bindings;
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
const call = (name: string) => ({ type: 'function_call', call_id: crypto.randomUUID(), name, arguments: '{}' });
const round = (...names: string[]) => ({ status: 'completed', output: names.map(call), output_text: '' });
const toolRound = (name: string, args: unknown) => ({ status: 'completed', output: [{ ...call(name), arguments: JSON.stringify(args) }], output_text: '' });
const final = { status: 'completed', output: [], output_text: JSON.stringify({ summary: 'Inspected the roof, plans and interior; submitted the saved proposal.' }) };

function fixture(baseDesign: Design | null = null, fixtureEnv = env) {
  const design = baseDesign || exampleDesign(), baseRevision = baseDesign ? 3 : 0;
  const registeredAssets: Design['assets'] = [];
  const files = new Map<string, Uint8Array>();
  const put = (path: string, value: unknown) => files.set(path, new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));
  put(PROPOSAL_PATH, design); put('/home/user/project/design.json', baseDesign || { brief: 'A warm home for four.' });
  const desktop = {
    launch: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    files: {
      write: vi.fn(async (path: string, data: string) => { put(path, data); }),
      read: vi.fn(async (path: string, options?: { format: string }) => {
        const bytes = files.get(path);
        if (!bytes) throw new Error('Missing fixture file');
        return options?.format === 'stream'
          ? new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } })
          : options?.format === 'bytes' ? bytes : new TextDecoder().decode(bytes);
      }),
    },
    commands: { run: vi.fn(async (command: string) => {
      if (command.includes('blender_asset.py')) {
        const output = /--output (\S+)/.exec(command)![1];
        files.set(output, new Uint8Array([1, 2, 3]));
        put(`${output}.json`, { size: [1, 1, 1] });
        return { exitCode: 0 };
      }
      const view = /--view (\S+)/.exec(command)![1], output = /--output (\S+)/.exec(command)![1];
      const source = files.get('/home/user/project/inspection-design.json')!;
      put(`${output}/preview-${view}.json`, { revision: baseRevision, view, source: 'task proposal', designHash: createHash('sha256').update(source).digest('hex'), elements: JSON.parse(new TextDecoder().decode(source)).elements.length,
        camera: { position: [1, 2, 3], target: [0, 1, 0], ...(view === 'front' || view === 'rear' ? { front: [0, 1] } : { floor: 0, orthographic: view.startsWith('plan_') }) }, resolution: [1, 1], samples: 8 });
      files.set(`${output}/preview-${view}.png`, png);
      return { exitCode: 0 };
    }) },
  };
  const checkActive = vi.fn(async () => {});
  const session = new ProposalSession({ env: fixtureEnv, desktop: desktop as never, projectId: 'project-1', runId: 'run-1', taskId: 'run-1-architect', key: 'team-0-task-0', baseRevision, baseDesign, agent: 'architect', registeredAssets: () => registeredAssets, prepare: async () => {}, checkActive });
  const context = { desktop, projectId: 'project-1', taskId: 'run-1-architect', design: baseDesign, proposal: session, registeredAssets, checkActive };
  return {
    design, files, put, session, context, desktop, checkActive,
    run: () => modelJSON(fixtureEnv, 'owner', 'architect', 'Build the home from the brief.', DesignSchema, context as never),
    runEdits: () => modelJSON(fixtureEnv, 'owner', 'architect', 'Restore the saved component and add original furniture.', DesignEditsSchema, context as never),
  };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.create.mockResolvedValue(final);
  mocks.artifact.mockImplementation(async (_env, _project, run, name) => `${run}-${name}`);
});

describe('file proposals through the actual model tool loop', () => {
  it('returns a large validated file while the model response schema contains only a summary', async () => {
    const f = fixture();
    f.design.elements = Array.from({ length: 1000 }, (_, i) => ({ ...f.design.elements[i % f.design.elements.length], id: `part_${i}` }));
    f.put(PROPOSAL_PATH, f.design);
    mocks.create.mockResolvedValueOnce(round('read_design')).mockResolvedValueOnce(round('inspect_proposal'))
      .mockImplementationOnce(async request => {
        expect(request.input.some((item: { content?: unknown }) => Array.isArray(item.content) && item.content.some((part: { type?: string }) => part.type === 'input_image'))).toBe(true);
        return round('submit_proposal');
      });
    expect(await f.run()).toEqual(f.design);
    const first = mocks.create.mock.calls[0][0];
    expect(Object.keys(first.text.format.schema.properties)).toEqual(['summary']);
    expect(first.parallel_tool_calls).toBe(false);
    // An accepted file completes the task without buying another summary.
    expect(mocks.create).toHaveBeenCalledTimes(3);
    expect(f.session.submitted?.design.elements).toHaveLength(1000);
    expect(f.desktop.files.write.mock.calls.some(([path]) => path === PROPOSAL_PATH)).toBe(false);
  });

  it('rejects inspection and submission in one model batch until images have reached a later turn', async () => {
    const f = fixture();
    mocks.create.mockResolvedValueOnce(round('read_design')).mockResolvedValueOnce(round('inspect_proposal', 'submit_proposal'))
      .mockImplementationOnce(async request => {
        expect(f.session.submitted).toBeNull();
        expect(request.input.some((item: { output?: string }) => item.output?.includes('same tool batch'))).toBe(true);
        return round('submit_proposal');
      });
    expect(await f.run()).toEqual(f.design);
    expect(f.session.submitted).not.toBeNull();
  });

  it('requires another inspection after file edits instead of accepting stale rendered evidence', async () => {
    const f = fixture();
    mocks.create.mockResolvedValueOnce(round('read_design')).mockResolvedValueOnce(round('inspect_proposal'))
      .mockImplementationOnce(async () => { f.design.elements.find(e => e.kind === 'roof')!.position[1] += 0.2; f.put(PROPOSAL_PATH, f.design); return round('submit_proposal'); })
      .mockImplementationOnce(async request => {
        expect(f.session.submitted).toBeNull();
        expect(request.input.some((item: { output?: string }) => item.output?.includes('changed or has not been inspected'))).toBe(true);
        return round('inspect_proposal');
      }).mockResolvedValueOnce(round('submit_proposal'));
    expect(await f.run()).toEqual(f.design);
    expect(f.session.submitted?.evidence.attempt).toBe(2);
  });

  it('never accepts a final chat reply as a substitute for submitted geometry', async () => {
    const f = fixture();
    mocks.create.mockResolvedValue({ status: 'completed', output: [], output_text: JSON.stringify(f.design) });
    await expect(f.run()).rejects.toMatchObject({ status: 422, message: expect.stringContaining('did not submit an inspected proposal') });
    expect(f.session.submitted).toBeNull();
    expect(mocks.create).toHaveBeenCalledTimes(12);
    expect(mocks.artifact).not.toHaveBeenCalled();
  });

  it('checks cancellation before purchasing a model response', async () => {
    const f = fixture(); f.checkActive.mockRejectedValue(new Error('Work stopped'));
    await expect(f.run()).rejects.toThrow('Work stopped');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns submitted incremental edits with only referenced registrations and historical assets', async () => {
    const asset = (id: string) => ({ id, name: id, artifactId: `${id}.glb`, author: 'Project specialist', license: 'Original project geometry' });
    const existing = asset('existing-sofa'), historic = asset('historic-lamp'), unusedHistoric = asset('unused-historic');
    const base = exampleDesign(), sofa = base.elements.find(element => element.id === 'sofa')!;
    sofa.assetId = existing.id;
    base.assets = [existing];
    const saved = { ...base, assets: [existing, historic, unusedHistoric] };
    const first = vi.fn(async () => ({ artifact_key: 'project-1/revisions/2/design.json', revision: 3 }));
    const bind = vi.fn(() => ({ first })), prepare = vi.fn(() => ({ bind }));
    const get = vi.fn(async () => ({ size: 10000, json: async () => saved }));
    const f = fixture(base, { ...env, DB: { prepare }, FILES: { get } } as unknown as Bindings);
    f.files.set('/home/user/project/lamp.blend', new Uint8Array([4, 5, 6]));
    f.files.set('/home/user/project/unused.blend', new Uint8Array([7, 8, 9]));
    let authored!: DesignEdits, original!: Design['assets'][number];
    mocks.create.mockResolvedValueOnce(round('read_design'))
      .mockResolvedValueOnce(toolRound('read_design_revision', { revision: 2 }))
      .mockResolvedValueOnce(toolRound('register_blender_asset', { blendFile: 'lamp.blend', name: 'Original lamp' }))
      .mockResolvedValueOnce(toolRound('register_blender_asset', { blendFile: 'unused.blend', name: 'Unused study' }))
      .mockImplementationOnce(async () => {
        expect(f.context.registeredAssets).toHaveLength(4);
        original = f.context.registeredAssets.find(item => item.name === 'Original lamp')!;
        authored = {
          elements: { upsert: [{ ...sofa, id: 'restored-lamp', assetId: historic.id }, { ...sofa, id: 'original-lamp', assetId: original.id }], remove: [] },
          materials: { upsert: [], remove: [] }, spaces: { upsert: [], remove: [] },
          metadata: { title: null, buildingType: null, floors: null, spawn: null, notes: null },
        };
        f.put(PROPOSAL_PATH, authored);
        return round('inspect_proposal');
      }).mockResolvedValueOnce(round('submit_proposal'));
    const returned = await f.runEdits();
    expect(returned).toEqual(authored);
    expect(f.context.registeredAssets).toEqual([historic, original]);
    const result = applyDesignEdits(base, returned, f.context.registeredAssets);
    expect(result).toEqual(f.session.submitted!.design);
    expect(result.assets).toEqual([existing, historic, original]);
    expect(result.elements.slice(0, base.elements.length)).toEqual(base.elements);
    expect(f.session.submitted!.input).toEqual(authored);
    expect(get).toHaveBeenCalledExactlyOnceWith('project-1/revisions/2/design.json');
    expect(mocks.artifact.mock.calls.filter(([, , , , kind]) => kind === 'model-asset')).toHaveLength(2);
    expect(mocks.create).toHaveBeenCalledTimes(6);
  });

  it('does not return an accepted proposal when the run is cancelled immediately after submission', async () => {
    const f = fixture(), stopped = new Error('Work stopped after submission');
    f.checkActive.mockImplementation(async () => { if (f.session.submitted) throw stopped; });
    mocks.create.mockResolvedValueOnce(round('read_design')).mockResolvedValueOnce(round('inspect_proposal')).mockResolvedValueOnce(round('submit_proposal'));
    await expect(f.run()).rejects.toBe(stopped);
    expect(f.session.submitted!.design).toEqual(f.design);
    expect(mocks.create).toHaveBeenCalledTimes(3);
  });

  it('returns a proposal submitted on the last permitted tool round without another paid response', async () => {
    const f = fixture();
    // Rounds 0–10 permit tools; round 11 was formerly a paid summary-only call.
    for (let index = 0; index < 9; index++) mocks.create.mockResolvedValueOnce(round('read_design'));
    mocks.create.mockResolvedValueOnce(round('inspect_proposal')).mockResolvedValueOnce(round('submit_proposal'));
    expect(await f.run()).toEqual(f.design);
    expect(f.session.submitted).not.toBeNull();
    expect(mocks.create).toHaveBeenCalledTimes(11);
    expect(mocks.create.mock.calls.at(-1)![0].tool_choice).toBe('auto');
  });
});
