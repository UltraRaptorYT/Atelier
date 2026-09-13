import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { APIConnectionTimeoutError } from 'openai/core/error';
import { modelJSON } from '../worker/src/ai';
import { DESIGN_MODEL_REQUEST_MS, INTERACTIVE_MODEL_REQUEST_MS, ModelRequestTimeoutError, TaskTimeBudget, TaskTimeError } from '../worker/src/task-time';
import type { Bindings } from '../worker/src/types';

const mocks=vi.hoisted(()=>({create:vi.fn(),constructor:vi.fn()}));
vi.mock('openai',()=>({default:class {responses={create:mocks.create};constructor(options:unknown){mocks.constructor(options);}}}));
vi.mock('../worker/src/prompts',()=>({agentInstructions:()=> 'Use the complete supplied brief.'}));
vi.mock('../worker/src/security',()=>({credential:async()=> 'test-key',HttpError:class extends Error{constructor(public status:number,message:string){super(message);}}}));
vi.mock('../worker/src/store',()=>({emit:vi.fn(),artifact:vi.fn()}));
const env={OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'max'} as Bindings;
const schema=z.object({accepted:z.boolean()});
const final={status:'completed',output:[],output_text:'{"accepted":true}'};
const longBrief='Preserve this complete original brief. '.repeat(180);
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-13T11:00:00Z'));vi.resetAllMocks();mocks.create.mockResolvedValue(final);});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
function slowResponse(after:number) {
  mocks.create.mockImplementationOnce((_request,{signal}:{signal:AbortSignal})=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resolve(final),after);
    signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('private provider abort detail'));},{once:true});
  }));
}
describe('bounded reasoning request deadlines',()=>{
  it('allows Astra max planning beyond two minutes without changing effort or truncating the original brief',async()=>{
    slowResponse(150000);
    const running=modelJSON(env,'owner','principal',longBrief,schema,undefined,[],'max');
    await vi.advanceTimersByTimeAsync(150000);
    expect(await running).toEqual({accepted:true});
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.constructor).toHaveBeenCalledWith({apiKey:'test-key',maxRetries:0,timeout:DESIGN_MODEL_REQUEST_MS});
    const [request,options]=mocks.create.mock.calls[0];
    expect(request).toMatchObject({model:'gpt-6-astra',reasoning:{effort:'max'},store:false});
    expect(request.input[0].content[0].text).toBe(longBrief);expect(options.timeout).toBe(480000);
  });
  it('also gives bounded initial briefing sufficient time without changing its existing effort choice',async()=>{
    slowResponse(150000);
    const running=modelJSON(env,'owner','principal',longBrief,schema,undefined,[],undefined,new TaskTimeBudget());
    await vi.advanceTimersByTimeAsync(150000);expect(await running).toEqual({accepted:true});
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('reasoning');
    expect(mocks.constructor.mock.calls[0][0]).toMatchObject({maxRetries:0,timeout:480000});
  });
  it('aborts at the bounded design ceiling with a safe actionable timeout and no automatic repurchase',async()=>{
    slowResponse(600000);
    const running=modelJSON(env,'owner','principal',longBrief,schema,undefined,[],'max');
    const rejected=expect(running).rejects.toMatchObject({status:408,message:expect.stringContaining('480-second allowance')});
    await vi.advanceTimersByTimeAsync(480000);await rejected;
    expect(mocks.create).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('clips a later request to the remaining shared task clock and reports task exhaustion',async()=>{
    const timeBudget=new TaskTimeBudget();await vi.advanceTimersByTimeAsync(500000);slowResponse(80000);
    const running=modelJSON(env,'owner','architect',longBrief,schema,undefined,[],'max',timeBudget);
    const rejected=expect(running).rejects.toBeInstanceOf(TaskTimeError);
    await vi.advanceTimersByTimeAsync(40000);await rejected;
    expect(mocks.create.mock.calls[0][1].timeout).toBe(40000);expect(timeBudget.remainingMs()).toBe(0);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('keeps interactive timeout and transient retry configuration unchanged',async()=>{
    await modelJSON(env,'owner','principal','Why is the roof sloped?',schema);
    expect(mocks.constructor).toHaveBeenCalledWith({apiKey:'test-key',maxRetries:1,timeout:INTERACTIVE_MODEL_REQUEST_MS});
    expect(mocks.create.mock.calls[0][1].timeout).toBe(120000);
  });
  it('recognizes SDK transport timeouts without exposing their provider details',async()=>{
    mocks.create.mockRejectedValueOnce(new APIConnectionTimeoutError({message:'private-provider-header secret-key'}));
    const error=await modelJSON(env,'owner','principal',longBrief,schema,undefined,[],'max').catch(error=>error);
    expect(error).toBeInstanceOf(ModelRequestTimeoutError);expect(error.status).toBe(408);
    expect(error.message).not.toMatch(/private-provider|secret-key/);expect(vi.getTimerCount()).toBe(0);
  });
});
