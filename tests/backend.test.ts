import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';
import { exampleDesign } from '../shared/example';
import { recolor } from '../shared/design';
let mf: Miniflare, env: any, tokenA: string, tokenB: string;
const brief = { request:'A warm courtyard house for a family.', summary:'Courtyard house', goals:[],constraints:[],questions:[] };
const call = (path:string, token=tokenA, method='GET', body?:unknown) => mf.dispatchFetch(`http://localhost${path}`, {method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body ? JSON.stringify(body):undefined});
async function project() { const r=await call('/projects',tokenA,'POST',{name:'Test house',brief}); expect(r.status).toBe(201); return (await r.json() as any).id as string; }
beforeAll(async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const token=(sub:string)=>new SignJWT({azp:'http://127.0.0.1:3000',sid:'session-test'}).setProtectedHeader({alg:'RS256'}).setSubject(sub).setIssuer('https://atelier-test.clerk.accounts.dev').setIssuedAt().setNotBefore('0 seconds').setExpirationTime('1 hour').sign(privateKey);
  tokenA=await token('user-a'); tokenB=await token('user-b');
  const root=resolve('.atelier/test-worker');
  mf=new Miniflare(convertV4MiniflareOptions({ workers: [{ name:'atelier-test', modules: [{type:'ESModule',path:resolve(root,'index.js')},...readdirSync(root).filter(x=>x.endsWith('.py')).map(x=>({type:'Text' as const,path:resolve(root,x)}))],
    compatibilityDate:'2026-09-12',compatibilityFlags:['nodejs_compat'],
    d1Databases:['DB'],r2Buckets:['FILES'],
    durableObjects:{PROJECTS:{className:'ProjectCoordinator',useSQLite:true},BUDGET:{className:'ComputeBudget',useSQLite:true}},
    workflows:{JOBS:{name:'atelier-jobs-test',className:'DesignWorkflow'}},
    bindings:{ENVIRONMENT:'test',APP_ORIGIN:'http://127.0.0.1:3000',GENERATION_ENABLED:'false',RENDER_ENABLED:'false',CLERK_JWT_KEY:await exportSPKI(publicKey),KEY_VERSION:'v1',OPENAI_MODEL:'gpt-5.6-terra',VOICE_MODEL:'gpt-realtime-2.1',E2B_TEMPLATE:'atelier-desktop'} }] }));
  env=await mf.getBindings('atelier-test');
  await env.DB.exec(readFileSync('worker/migrations/0001_initial.sql','utf8'));
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
    await expect(stub.commit(id,1,'late-'+id,exampleDesign(),'cancel-'+id)).rejects.toThrow(/cancelled/);
    expect((await (await call(`/projects/${id}`)).json() as any).project.revision).toBe(1);
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
});
