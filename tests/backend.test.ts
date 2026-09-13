import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';
import { exampleDesign } from '../shared/example';
import { recolor } from '../shared/design';
import { executeVoiceTool } from '../worker/src/voice';
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
beforeAll(async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const token=(sub:string)=>new SignJWT({azp:'http://127.0.0.1:3000',sid:'session-test'}).setProtectedHeader({alg:'RS256'}).setSubject(sub).setIssuer('https://atelier-test.clerk.accounts.dev').setIssuedAt().setNotBefore('0 seconds').setExpirationTime('1 hour').sign(privateKey);
  tokenA=await token('user-a'); tokenB=await token('user-b');
  const root=resolve('worker/.atelier/test-worker');
  mf=new Miniflare(convertV4MiniflareOptions({ workers: [{ name:'atelier-test', modules: [{type:'ESModule',path:resolve(root,'index.js')},...readdirSync(root).filter(x=>/\.(py|md)$/.test(x)).map(x=>({type:'Text' as const,path:resolve(root,x)}))],
    compatibilityDate:'2026-09-12',compatibilityFlags:['nodejs_compat'],
    d1Databases:['DB'],r2Buckets:['FILES'],
    durableObjects:{PROJECTS:{className:'ProjectCoordinator',useSQLite:true},BUDGET:{className:'ComputeBudget',useSQLite:true}},
    workflows:{JOBS:{name:'atelier-jobs-test',className:'DesignWorkflow'}},
    bindings:{ENVIRONMENT:'test',APP_ORIGIN:'http://127.0.0.1:3000',GENERATION_ENABLED:'false',RENDER_ENABLED:'false',CLERK_JWT_KEY:await exportSPKI(publicKey),KEY_VERSION:'v1',OPENAI_MODEL:'gpt-5.6-terra',VOICE_MODEL:'gpt-live-1',VOICE_ENABLED:'true',OPENAI_API_KEY:'test-environment-key',E2B_TEMPLATE:'atelier-desktop'} },
    // Miniflare's Node RPC proxy drops the Promise header on rejected RPC calls.
    // Catch in a real Worker so assertions see the coordinator's actual error.
    { name:'commit-test-bridge', modules:true, compatibilityDate:'2026-09-12',
      durableObjects:{PROJECTS:{className:'ProjectCoordinator',scriptName:'atelier-test',useSQLite:true}},
      script:`export default { async fetch(request, env) {
        const args = await request.json();
        try { return Response.json({ revision: await env.PROJECTS.getByName(args[0]).commit(...args) }); }
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
    const id=await project(), design=exampleDesign();
    expect(await Promise.all([commit(id,0,'same-operation',design),commit(id,0,'same-operation',design)])).toEqual([1,1]);
    const data=await (await call(`/projects/${id}`)).json() as any;
    expect(data.project.revision).toBe(1); expect(data.design).toEqual(design);
    expect(data.events.filter((e:any)=>e.type==='artifact_updated')).toHaveLength(1);
  });
  it('fences stale proposals and atomically keeps the winning pointer and event',async()=>{
    const id=await project(), original=exampleDesign();
    await commit(id,0,'initial-'+id,original);
    const results=await Promise.allSettled([commit(id,1,'red-'+id,recolor(original,'front-left','#ff0000')),commit(id,1,'blue-'+id,recolor(original,'front-left','#0000ff'))]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')?.reason.message).toMatch(/Design changed/);
    const current=await (await call(`/projects/${id}`)).json() as any;
    expect(current.project.revision).toBe(2);
    expect(current.events.filter((e:any)=>e.type==='artifact_updated')).toHaveLength(2);
    expect(await (await call(`/projects/${id}/revisions/1`)).json()).toEqual(original);
  });
  it('rejects invalid designs and late results from a cancelled run while preserving saved files',async()=>{
    const id=await project(), original=exampleDesign();
    await commit(id,0,'saved-'+id,original);
    await expect(commit(id,1,'bad-'+id,{...original,floors:5})).rejects.toThrow(/ZodError/);
    await env.DB.prepare("INSERT INTO runs(id,project_id,owner_id,kind,status,base_revision,created_at) VALUES(?,?,'user-a','generate','cancelled',1,?)").bind('cancel-'+id,id,new Date().toISOString()).run();
    await expect(commit(id,1,'late-'+id,recolor(original,'front-left','#ff0000'),'cancel-'+id)).rejects.toThrow(/cancelled/);
    const saved=await (await call(`/projects/${id}`)).json() as any;
    expect(saved.project.revision).toBe(1);
    expect(saved.design).toEqual(original);
    expect(saved.events.filter((e:any)=>e.type==='artifact_updated')).toHaveLength(1);
    expect(await (await call(`/projects/${id}/revisions/1`)).json()).toEqual(original);
  });
  it('enforces the global computer count atomically and retains daily charges after release',async()=>{
    const budget=env.BUDGET.getByName('test-budget');
    const results=await Promise.all(['a','b','c'].map(id=>budget.reserve(id,'owner',900)));
    expect(results.filter(r=>r.allowed)).toHaveLength(2);
    await budget.release('a'); await budget.release('b');
    expect((await budget.reserve('d','owner',900)).allowed).toBe(true); await budget.release('d');
    expect((await budget.reserve('e','owner',900)).allowed).toBe(true); await budget.release('e');
    expect((await budget.reserve('f','owner',900)).reason).toMatch(/daily/);
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

});
