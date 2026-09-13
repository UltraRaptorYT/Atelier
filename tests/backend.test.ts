import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';
import { exampleDesign } from '../shared/example';
import { recolor } from '../shared/design';
import { executeVoiceTool } from '../worker/src/voice';
vi.mock('../worker/src/prompts', () => ({ agentInstructions: () => 'Keep work within your task ownership.' }));
let mf: Miniflare, env: any, tokenA: string, tokenB: string;
let commitWorker: Awaited<ReturnType<Miniflare['getWorker']>>;
const brief = { request:'A warm courtyard house for a family.', summary:'Courtyard house', goals:[],constraints:[],questions:[] };
const call = (path:string, token=tokenA, method='GET', body?:unknown) => mf.dispatchFetch(`http://localhost${path}`, {method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body ? JSON.stringify(body):undefined});
async function project() { const r=await call('/projects',tokenA,'POST',{name:'Test house',brief}); expect(r.status).toBe(201); return (await r.json() as any).id as string; }
async function commit(projectId: string, baseRevision: number, operationId: string, design: unknown, runId?: string): Promise<number> {
  const response = await commitWorker.fetch('http://test/commit', { method:'POST', body:JSON.stringify([projectId,baseRevision,operationId,design,runId]) });
  const result = await response.json() as { revision: number; error?: string };
  if (!response.ok) throw new Error(result.error);
  return result.revision;
}
async function proposal(projectId: string, baseRevision: number, operationId: string, design: unknown, runId: string, agent: string): Promise<{ revision: number | null; conflicts: string[] }> {
  const response = await commitWorker.fetch('http://test/proposal', { method: 'POST', body: JSON.stringify([projectId, baseRevision, operationId, design, runId, agent]) });
  const result = await response.json() as { revision: number | null; conflicts: string[]; error?: string };
  if (!response.ok) throw new Error(result.error);
  return result;
}
async function proposalRun(projectId: string, status = 'in_progress') {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,created_at) VALUES(?,?,'user-a','change',?,1,?)").bind(id, projectId, status, new Date().toISOString()).run();
  return id;
}
beforeAll(async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const token=(sub:string)=>new SignJWT({azp:'http://127.0.0.1:3000',sid:'session-test'}).setProtectedHeader({alg:'RS256'}).setSubject(sub).setIssuer('https://atelier-test.clerk.accounts.dev').setIssuedAt().setNotBefore('0 seconds').setExpirationTime('1 hour').sign(privateKey);
  tokenA=await token('user-a'); tokenB=await token('user-b');
  const root=resolve('worker/.atelier/test-worker');
  mf=new Miniflare(convertV4MiniflareOptions({ workers: [{ name:'atelier-test', modules: [{type:'ESModule',path:resolve(root,'index.js')},...readdirSync(root).filter(x=>/\.(py|md)$/.test(x)).map(x=>({type:'Text' as const,path:resolve(root,x)}))],
    compatibilityDate:'2026-09-12',compatibilityFlags:['nodejs_compat'],
    d1Databases:['DB'],r2Buckets:['FILES'],
    ratelimits:{API_LIMIT:{namespace_id:'927301',simple:{limit:120,period:60}}},
    durableObjects:{PROJECTS:{className:'ProjectCoordinator',useSQLite:true},BUDGET:{className:'ComputeBudget',useSQLite:true}},
    workflows:{JOBS:{name:'atelier-jobs-test',className:'DesignWorkflow'}},
    bindings:{ENVIRONMENT:'test',APP_ORIGIN:'http://127.0.0.1:3000',GENERATION_ENABLED:'false',RENDER_ENABLED:'false',CLERK_JWT_KEY:await exportSPKI(publicKey),KEY_VERSION:'v1',OPENAI_MODEL:'gpt-5.6-terra',VOICE_MODEL:'gpt-live-1',VOICE_ENABLED:'true',OPENAI_API_KEY:'test-environment-key',E2B_TEMPLATE:'atelier-desktop'} },
    // Miniflare's Node RPC proxy drops the Promise header on rejected RPC calls.
    // Catch in a real Worker so assertions see the coordinator's actual error.
    { name:'commit-test-bridge', modules:true, compatibilityDate:'2026-09-12',
      durableObjects:{PROJECTS:{className:'ProjectCoordinator',scriptName:'atelier-test',useSQLite:true}},
      script:`export default { async fetch(request, env) {
        const args = await request.json();
        try {
          if (new URL(request.url).pathname === '/proposal') {
            const result = await env.PROJECTS.getByName(args[0]).commitProposal(...args);
            return Response.json({ revision: result.revision, conflicts: [...result.conflicts] });
          }
          return Response.json({ revision: await env.PROJECTS.getByName(args[0]).commit(...args) });
        }
        catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
      } };`
    }] }));
  env=await mf.getBindings('atelier-test');
  commitWorker=await mf.getWorker('commit-test-bridge');
  for (const migration of readdirSync('worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(`worker/migrations/${migration}`, 'utf8').split(';').filter(sql => sql.trim())) await env.DB.prepare(statement).run();
  }
});
afterAll(async()=>{await mf?.dispose();});
describe('real Worker, D1, R2 and Durable Object integration',()=>{
  it('authenticates signed sessions and rejects local bypass outside development',async()=>{
    expect((await call('/projects')).status).toBe(200);
    expect((await mf.dispatchFetch('http://localhost/projects',{headers:{'X-Atelier-Local':'true'}})).status).toBe(401);
    expect((await call('/projects','invalid')).status).toBe(401);
  });
  it('isolates projects, revisions, files, desktops, voice and cancellation by owner',async()=>{
    const id=await project();
    for(const [path,method] of [['','GET'],['/revisions/1','GET'],['/artifacts/file','GET'],['/desktop/architect','POST'],['/voice/call','DELETE'],['/runs/run','DELETE'],['/events','GET']]) {
      expect((await call(`/projects/${id}${path}`,tokenB,method)).status).toBe(404);
    }
    expect(await (await call('/projects',tokenB)).json()).toEqual([]);
  });
  it('publishes exactly one revision and event when the same request is retried concurrently',async()=>{
    const id=await project(), stub=env.PROJECTS.getByName(id), design=exampleDesign();
    expect(await Promise.all([stub.commit(id,0,'same-operation',design),stub.commit(id,0,'same-operation',design)])).toEqual([1,1]);
    const data=await (await call(`/projects/${id}`)).json() as any;
    expect(data.project.revision).toBe(1); expect(data.design).toEqual(design);
    expect(data.events.filter((e:any)=>e.type==='artifact_updated')).toHaveLength(1);
  });
  it('fences stale proposals and atomically keeps the winning pointer and event',async()=>{
    const id=await project(), stub=env.PROJECTS.getByName(id), original=exampleDesign();
    await stub.commit(id,0,'initial-'+id,original);
    const results=await Promise.allSettled([stub.commit(id,1,'red-'+id,recolor(original,'front-left','#ff0000')),stub.commit(id,1,'blue-'+id,recolor(original,'front-left','#0000ff'))]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const current=await (await call(`/projects/${id}`)).json() as any;
    expect(current.project.revision).toBe(2);
    expect(current.events.filter((e:any)=>e.type==='artifact_updated')).toHaveLength(2);
    expect(await (await call(`/projects/${id}/revisions/1`)).json()).toEqual(original);
  });
  it('rejects invalid designs and late results from a cancelled run while preserving saved files',async()=>{
    const id=await project(), stub=env.PROJECTS.getByName(id);
    await stub.commit(id,0,'saved-'+id,exampleDesign());
    await expect(stub.commit(id,1,'bad-'+id,{...exampleDesign(),floors:5})).rejects.toThrow();
    await env.DB.prepare("INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,created_at) VALUES(?,?,'user-a','generate','cancelled',1,?)").bind('cancel-'+id,id,new Date().toISOString()).run();
    await expect(Promise.resolve(stub.commit(id,1,'late-'+id,exampleDesign(),'cancel-'+id))).rejects.toThrow();
    expect((await (await call(`/projects/${id}`)).json() as any).project.revision).toBe(1);
  });
  it('merges concurrent sibling proposals from the same saved revision without losing either agent’s work', async () => {
    const id = await project(), original = exampleDesign();
    await commit(id, 0, `initial-${id}`, original);
    const runId = await proposalRun(id);
    try {
      const architecture = structuredClone(original);
      architecture.elements.find(element => element.id === 'roof')!.position[1] += .3;
      const interiors = recolor(original, 'front-left', '#ff0000');
      const results = await Promise.all([
        proposal(id, 1, `architecture-${id}`, architecture, runId, 'architect'),
        proposal(id, 1, `interiors-${id}`, interiors, runId, 'designer'),
      ]);
      expect(results.map(result => result.revision).sort()).toEqual([2, 3]);
      expect(results.every(result => result.conflicts.length === 0)).toBe(true);
      const current = await (await call(`/projects/${id}`)).json() as any;
      expect(current.project.revision).toBe(3);
      expect(current.design).toEqual(recolor(architecture, 'front-left', '#ff0000'));
      expect(current.events.filter((event: any) => event.type === 'artifact_updated')).toHaveLength(3);
      expect(current.events.find((event: any) => event.type === 'artifact_updated' && event.revision === results[1].revision)?.agent).toBe('designer');
      expect(await proposal(id, 1, `interiors-${id}`, interiors, runId, 'designer')).toEqual(results[1]);
      expect(await (await call(`/projects/${id}/revisions/1`)).json()).toEqual(original);
    } finally { await env.DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").bind(runId).run(); }
  });
  it('reports a conflicting proposal path without advancing the canonical revision or publishing an event', async () => {
    const id = await project(), original = exampleDesign();
    await commit(id, 0, `initial-${id}`, original);
    const runId = await proposalRun(id);
    try {
      const first = structuredClone(original), second = structuredClone(original);
      first.elements.find(element => element.id === 'sofa')!.position[0] += .5;
      second.elements.find(element => element.id === 'sofa')!.position[0] -= .5;
      expect(await proposal(id, 1, `first-${id}`, first, runId, 'designer')).toEqual({ revision: 2, conflicts: [] });
      expect(await proposal(id, 1, `second-${id}`, second, runId, 'architect')).toEqual({ revision: null, conflicts: ['/elements/sofa/position'] });
      const current = await (await call(`/projects/${id}`)).json() as any;
      expect(current.project.revision).toBe(2);
      expect(current.design).toEqual(first);
      expect(current.events.filter((event: any) => event.type === 'artifact_updated')).toHaveLength(2);
      expect(await env.DB.prepare('SELECT revision FROM revisions WHERE operation_id = ?').bind(`second-${id}`).first()).toBeNull();
    } finally { await env.DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").bind(runId).run(); }
  });
  it('fences a cancelled proposal writer even when its base-relative edit can merge cleanly', async () => {
    const id = await project(), original = exampleDesign();
    await commit(id, 0, `initial-${id}`, original);
    const runId = await proposalRun(id, 'cancelled');
    await expect(proposal(id, 1, `cancelled-proposal-${id}`, recolor(original, 'roof', '#ff0000'), runId, 'designer')).rejects.toThrow(/stopped|cancelled/);
    const current = await (await call(`/projects/${id}`)).json() as any;
    expect(current.project.revision).toBe(1);
    expect(current.design).toEqual(original);
    expect(current.events.filter((event: any) => event.type === 'artifact_updated')).toHaveLength(1);
    expect(await env.DB.prepare('SELECT revision FROM revisions WHERE operation_id = ?').bind(`cancelled-proposal-${id}`).first()).toBeNull();
  });
  it('enforces the global computer count atomically and refunds reservations that never allocated a sandbox',async()=>{
    const budget=env.BUDGET.getByName('test-budget');
    const ids = ['a','b','c'], results=await Promise.all(ids.map(id=>budget.reserve(id,'owner',900)));
    expect(results.filter(r=>r.allowed)).toHaveLength(2);
    for (let index = 0; index < ids.length; index++) if (results[index].allowed) expect(await budget.release(ids[index])).toBe(true);
    for (let index = 0; index < 6; index++) {
      const id = `unused-${index}`;
      expect((await budget.reserve(id,'owner',900)).allowed).toBe(true);
      expect((await budget.reserve(id,'another-owner',900)).reason).toMatch(/another owner/);
      expect(await budget.release(id)).toBe(true);
      expect(await budget.release(id)).toBe(true);
    }
  });
  it('keeps saved projects accessible when generation is paused',async()=>{
    const id=await project();
    const response=await call(`/projects/${id}/runs`,tokenA,'POST',{operationId:crypto.randomUUID(),kind:'generate',baseRevision:0});
    expect(response.status).toBe(503); expect((await call(`/projects/${id}`)).status).toBe(200);
  });
  it('advertises the environment connection without exposing its key or requiring generation', async () => {
    const response = await call('/capabilities');
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({ keyConnected: true, keySource: 'environment', voice: true, voiceModel: 'gpt-live-1', generation: false });
    expect(raw).not.toContain('test-environment-key');
  });
  it('saves spoken clarifications exactly once and preserves prior brief constraints', async () => {
    const id = await project(), voiceId = `voice-${id}`;
    const original = { ...brief, constraints: ['Keep the courtyard'], questions: ['How many floors?'] };
    await env.DB.prepare('UPDATE projects SET brief = ? WHERE id = ?').bind(JSON.stringify(original), id).run();
    await env.DB.prepare('INSERT INTO voice_sessions(id,project_id,owner_id,agent,created_at) VALUES(?,?,?,?,?)').bind(voiceId,id,'user-a','principal',Date.now()).run();
    const input = { call_id: 'spoken-floors', name: 'save_brief', arguments: JSON.stringify({ details: 'Two floors and four occupants.' }) };
    const apply = () => executeVoiceTool(env,id,'user-a',voiceId,'principal',null,input);
    expect(await apply()).toMatchObject({ saved: true });
    expect(await apply()).toMatchObject({ saved: true });
    const snapshot = await (await call(`/projects/${id}`)).json() as any;
    expect(snapshot.project.brief.constraints).toEqual(original.constraints);
    expect(snapshot.project.brief.request).toContain(original.request);
    expect(snapshot.project.brief.request.match(/Two floors/g)).toHaveLength(1);
    expect(snapshot.events.filter((event:any) => event.type === 'clarification_received')).toHaveLength(1);
    // While a workflow is active, voice cannot replace the brief it is using.
    await env.DB.prepare("INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,created_at) VALUES(?,?,'user-a','generate','in_progress',0,?)").bind(`voice-run-${id}`, id, new Date().toISOString()).run();
    const blocked = await executeVoiceTool(env,id,'user-a',voiceId,'principal',null,{ ...input, call_id: 'while-running' });
    expect(blocked).toMatchObject({ error: expect.stringMatching(/work started/) });
    await env.DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").bind(`voice-run-${id}`).run();
    await commit(id,0,`voice-design-${id}`,exampleDesign());
    const afterDesign = await executeVoiceTool(env,id,'user-a',voiceId,'principal',null,{ ...input, call_id: 'after-design' });
    expect(afterDesign).toMatchObject({ error: expect.stringMatching(/design already exists/) });
    const change = await executeVoiceTool(env,id,'user-a',voiceId,'designer',null,{ call_id: 'paused-change', name:'request_change', arguments:JSON.stringify({instruction:'Make the roof red',elementId:null,baseRevision:1}) });
    expect(change).toMatchObject({ error: expect.stringMatching(/paused/) });
    await env.DB.prepare('DELETE FROM voice_sessions WHERE id = ?').bind(voiceId).run();
    const ended = await executeVoiceTool(env,id,'user-a',voiceId,'principal',null,{ ...input, call_id:'after-hangup' });
    expect(ended).toMatchObject({ error: expect.stringMatching(/ended/) });
  });

  it('applies a material edit immediately, retries idempotently and rejects stale editing',async()=>{
    const id=await project(),original=exampleDesign();await commit(id,0,'finish-'+id,original);
    const change={elementId:'front-left',color:'#cc3344',baseRevision:1,operationId:crypto.randomUUID()};
    expect((await call(`/projects/${id}/material`,tokenA,'PUT',change)).status).toBe(200);
    expect((await call(`/projects/${id}/material`,tokenA,'PUT',change)).status).toBe(200);
    expect((await call(`/projects/${id}/material`,tokenA,'PUT',{...change,operationId:crypto.randomUUID()})).status).toBe(409);
    const saved=await (await call(`/projects/${id}`)).json() as any;
    expect(saved.project.revision).toBe(2); expect(saved.design).toEqual(recolor(original,'front-left','#cc3344'));
    expect((await call(`/projects/${id}/material`,tokenB,'PUT',change)).status).toBe(404);
  });

});
