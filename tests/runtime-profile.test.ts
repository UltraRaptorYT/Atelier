import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeProfile, saveRuntimeProfile, type RuntimeProfileSources } from '../worker/src/runtime-profile';
import type { Bindings, RunParams } from '../worker/src/types';

const stored = vi.hoisted(() => ({ rows: new Map<string, { projectId: string; key: string }>(), objects: new Map<string, string>(), artifact: vi.fn() }));
vi.mock('../worker/src/store', () => ({ artifact: stored.artifact }));
const fixtureSources = (): RuntimeProfileSources => ({ schema: { version: 1, properties: { elements: 'mesh-or-box', materials: 'physical' } }, prompts: { architect: 'Author a design.', designer: 'Refine materials.' }, authoring: 'def wall_with_openings(): pass', compiler: { source: 'compile_design()', furniture: [{ name: 'chair', size: [1, 1, 1] }] } });
const environment = (): Bindings => ({
  ENVIRONMENT: 'local', OPENAI_MODEL: 'gpt-6-astra', VOICE_MODEL: 'gpt-live-1', OPENAI_IMAGE_CONCEPT_MODEL: 'gpt-image-2.5-flare', OPENAI_IMAGE_EDIT_MODEL: 'gpt-image-2.5-sunburst',
  GENERATION_ENABLED: 'true', RENDER_ENABLED: 'true', VOICE_ENABLED: 'true', IMAGE_GENERATION_ENABLED: 'false', E2B_TEMPLATE: 'atelier-desktop',
  OPENAI_API_KEY: 'sk-private-model-test-key', E2B_API_KEY: 'e2b_private-desktop-test-key', KEY_ENCRYPTION_KEYS: '{"v1":"private-encryption-value"}', CLERK_SECRET_KEY: 'private-auth-value', SITES_PROXY_SECRET: 'private-proxy-value',
  DB: { prepare: () => ({ bind: (id: string, projectId: string) => ({ first: async () => { const row=stored.rows.get(id); return row?.projectId === projectId ? { object_key: row.key } : null; } }) }) },
  FILES: { get: async (key: string) => stored.objects.has(key) ? { json: async () => JSON.parse(stored.objects.get(key)!) } : null },
  PROJECTS: {}, BUDGET: {}, JOBS: {},
} as unknown as Bindings);
beforeEach(() => {
  stored.rows.clear(); stored.objects.clear(); stored.artifact.mockReset();
  stored.artifact.mockImplementation(async (_env, projectId, runId, name, _kind, _revision, data) => {
    const id=`${runId}-${name}`;
    if (!stored.rows.has(id)) { const key=`${projectId}/${id}`; stored.rows.set(id,{projectId,key}); stored.objects.set(key,data); }
    return id;
  });
});

describe('safe runtime generation fingerprint',()=>{
  it('is deterministic across equivalent local/deployed configurations, key order and credential rotation',async()=>{
    const local=environment(),deployed={...local,ENVIRONMENT:'production',OPENAI_API_KEY:'sk-rotated-private-key',E2B_API_KEY:'e2b_rotated-private-key'};
    const sources=fixtureSources(),reordered={compiler:sources.compiler,authoring:sources.authoring,prompts:{designer:'Refine materials.',architect:'Author a design.'},schema:{properties:{materials:'physical',elements:'mesh-or-box'},version:1}};
    const a=await runtimeProfile(local,sources),b=await runtimeProfile(deployed,reordered);
    expect(a.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(a.fingerprint).toBe(b.fingerprint);expect(a.components).toEqual(b.components);
    expect(a.environment).toBe('local');expect(b.environment).toBe('production');
  });
  it.each(['schema','prompts','authoring','compiler'] as const)('changes the %s hash and overall fingerprint when its bundled input changes',async component=>{
    const original=fixtureSources(),modified=fixtureSources();
    if(component==='authoring')modified.authoring+='\n# changed';else modified[component]={changed:true};
    const a=await runtimeProfile(environment(),original),b=await runtimeProfile(environment(),modified);
    expect(b.fingerprint).not.toBe(a.fingerprint);
    for(const name of ['schema','prompts','authoring','compiler'] as const)expect(b.components[name]===a.components[name]).toBe(name!==component);
  });
  it.each([{OPENAI_MODEL:'another-model'},{OPENAI_REASONING_EFFORT:'high'},{GENERATION_ENABLED:'false'},{RENDER_ENABLED:'false'},{E2B_TEMPLATE:'another-template'}])('detects configured runtime differences %j',async change=>{
    const original=await runtimeProfile(environment(),fixtureSources()),changed=await runtimeProfile({...environment(),...change},fixtureSources());
    expect(changed.fingerprint).not.toBe(original.fingerprint);
  });
  it('returns only allowlisted nonsecret identifiers, hashes and configuration readiness',async()=>{
    const env=environment(),profile=await runtimeProfile(env,fixtureSources()),raw=JSON.stringify(profile);
    expect(profile.models).toEqual({design:'gpt-6-astra',voice:'gpt-live-1',conceptImage:'gpt-image-2.5-flare',imageEdit:'gpt-image-2.5-sunburst'});
    expect(profile.reasoning).toEqual({design:'max'});
    expect(profile.limits).toEqual({modelOutputTokens:64000});
    expect(profile.readiness).toEqual({designModelConfigured:true,designReasoningConfigured:true,desktopKeyConfigured:true,environmentModelKeyConfigured:true,savedKeyEncryptionConfigured:true,projectServicesBound:true,providerConnectivityChecked:false});
    for(const secret of [env.OPENAI_API_KEY!,env.E2B_API_KEY!,env.KEY_ENCRYPTION_KEYS!,env.CLERK_SECRET_KEY!,env.SITES_PROXY_SECRET!,'private-encryption-value'])expect(raw).not.toContain(secret);
    expect(raw).not.toContain('OPENAI_API_KEY');expect(raw).not.toContain('CLERK_SECRET_KEY');
    expect(profile.scope).toContain('Matching fingerprints do not prove');
    const missing=await runtimeProfile({...env,OPENAI_MODEL:'',OPENAI_API_KEY:' ',E2B_API_KEY:undefined,KEY_ENCRYPTION_KEYS:undefined},fixtureSources());
    expect(missing.readiness).toMatchObject({designModelConfigured:false,desktopKeyConfigured:false,environmentModelKeyConfigured:false,savedKeyEncryptionConfigured:false});
  });
  it('redacts malformed or credential-shaped identifiers instead of echoing accidental secret configuration',async()=>{
    const profile=await runtimeProfile({...environment(),OPENAI_MODEL:'sk-secret-in-wrong-binding',OPENAI_REASONING_EFFORT:'secret-in-wrong-binding',E2B_TEMPLATE:'e2b_secret-in-wrong-binding',VOICE_MODEL:'Bearer secret value',ENVIRONMENT:'private-environment-value'},fixtureSources());
    expect(profile.models.design).toBeNull();expect(profile.models.voice).toBeNull();expect(profile.workstation.template).toBeNull();expect(profile.environment).toBe('unknown');
    expect(profile.reasoning.design).toBeNull();expect(profile.readiness.designReasoningConfigured).toBe(false);
    expect(JSON.stringify(profile)).not.toContain('secret-in-wrong-binding');
  });
  it('hashes the actual bundled schema, active prompts and Python modules',async()=>{
    const a=await runtimeProfile(environment()),b=await runtimeProfile(environment());
    expect(a).toEqual(b);for(const hash of Object.values(a.components))expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(a.components)).toEqual(['schema','prompts','authoring','compiler']);
  });
});

describe('persisted generation profile',()=>{
  const run:RunParams={projectId:'project-one',runId:'run-one',userId:'private-owner',kind:'generate',baseRevision:3};
  it('freezes one per-run artifact and returns the original after checkpoint replay or configuration changes',async()=>{
    const env=environment(),first=await saveRuntimeProfile(env,run);
    const second=await saveRuntimeProfile({...env,OPENAI_MODEL:'changed-after-restart'},run);
    expect(second).toEqual(first);expect(stored.artifact).toHaveBeenCalledTimes(1);
    const record=JSON.parse([...stored.objects.values()][0]);
    expect(record).toMatchObject({run:{id:'run-one',kind:'generate',baseRevision:3},profile:{fingerprint:first.fingerprint,models:{design:'gpt-6-astra'}}});
    expect(record.recordedAt).toMatch(/^\d{4}-/);expect(JSON.stringify(record)).not.toContain(run.userId);
    await saveRuntimeProfile({...env,OPENAI_MODEL:'changed-after-restart'},{...run,runId:'run-two'});
    expect(stored.artifact).toHaveBeenCalledTimes(2);expect(stored.rows.size).toBe(2);
  });
  it('does not silently replace missing saved evidence on replay',async()=>{
    stored.rows.set('run-one-generation-profile.json',{projectId:'project-one',key:'missing-object'});
    await expect(saveRuntimeProfile(environment(),run)).rejects.toThrow('Saved generation profile is unavailable');
    expect(stored.artifact).not.toHaveBeenCalled();
  });
});
