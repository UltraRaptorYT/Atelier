import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../worker/src/security';
import { ModelRequestTimeoutError, TaskTimeError } from '../worker/src/task-time';
import { checkedWorkflowStep } from '../worker/src/workflow-errors';

function checkpoint() {
  let saved:unknown,done=false;
  return {do:vi.fn(async(_name:string,_options:unknown,callback:()=>Promise<unknown>)=>{
    if(done)return structuredClone(saved);
    try{saved=structuredClone(await callback());done=true;return structuredClone(saved);}
    catch(error){throw structuredClone(error);}
  })};
}
describe('trusted workflow failure envelopes',()=>{
  it.each([undefined, null, ['saved perspective'], { summary: 'Saved plan', tasks: [] }, { ok: false, summary: 'An ordinary old result' }])('reuses an old successful unwrapped checkpoint without rerunning work', async saved => {
    const step = { do: vi.fn(async () => structuredClone(saved)) }, work = vi.fn();
    expect(await checkedWorkflowStep(step as never, 'existing-step', { timeout: '10 minutes' }, work)).toEqual(saved);
    expect(work).not.toHaveBeenCalled();
  });
  it.each([new ModelRequestTimeoutError('Principal architect',480000),new TaskTimeError(),new HttpError(422,'The proposal has changed since inspection.')])('preserves a trusted actionable failure after serialization without replaying work',async error=>{
    const step=checkpoint(),work=vi.fn(async()=>{throw error;});
    const run=()=>checkedWorkflowStep(step as never,'paid-work',{retries:{limit:0,delay:'1 second'},timeout:'10 minutes'},work);
    await expect(run()).rejects.toMatchObject({status:error.status,message:error.message});
    await expect(run()).rejects.toBeInstanceOf(HttpError);expect(work).toHaveBeenCalledTimes(1);
  });
  it.each([new Error('secret provider text'),{name:'HttpError',status:408,message:'secret provider text'}])('does not promote untrusted error fields into public application errors',async error=>{
    const step=checkpoint();
    const thrown=await checkedWorkflowStep(step as never,'paid-work',{retries:{limit:0,delay:'1 second'},timeout:'10 minutes'},async()=>{throw error;}).catch(error=>error);
    expect(thrown).not.toBeInstanceOf(HttpError);
  });
});
