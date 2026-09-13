import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { liveRequest, LiveToolBatches } from '../worker/src/live';
import { LiveCaptions } from '../shared/live-captions';

describe('GPT-Live protocol', () => {
  it('sends JSON to Live with a private Astra delegation and preserves opaque session IDs', async () => {
    const requests: Request[] = [];
    const client = new OpenAI({ apiKey: 'test-only', maxRetries: 0, fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ session: { id: 'live_opaque-ID' }, transport: { type: 'webrtc', sdp: 'answer' } }, { status: 201 });
    } });
    const result = await client.live.create(liveRequest('gpt-live-1','gpt-6-astra','architect','revision 7','offer'));
    const request = requests[0], body = await request.json();
    expect(request.url).toBe('https://api.openai.com/v1/live/sessions');
    expect(request.headers.get('Content-Type')).toContain('application/json');
    expect(body.transport).toEqual({ type: 'webrtc', sdp: 'offer' });
    expect(body.session.model).toBe('gpt-live-1');
    expect(body.session.delegation.responses.model).toBe('gpt-6-astra');
    expect(body.session.audio).toEqual({ output: { voice: 'marin' } });
    expect(body.session.client.data_channel.allowed_client_events).toEqual(['session.close']);
    expect(body.session.client.data_channel.allowed_server_events).not.toContainEqual({type:'response.event'});
    expect(body.session.tools).toBeUndefined();
    expect(body.session.store).toBe(false);
    expect(result.session.id).toBe('live_opaque-ID');
    expect(result.transport.sdp).toBe('answer');
  });

  it('collects completed function items, ignores argument fragments, and waits for the complete batch', () => {
    const batches = new LiveToolBatches();
    const feed = (event: unknown, revision = 7, delegation_id = 'delegate-A') => batches.accept({type:'response.event',delegation_id,event},revision);
    expect(feed({type:'response.created',response:{id:'response-A'}})).toBeNull();
    expect(feed({type:'response.function_call_arguments.done',arguments:'{}'})).toBeNull();
    const item = {type:'function_call',name:'request_change',call_id:'call-A',arguments:'{"instruction":"red walls"}'};
    expect(feed({type:'response.output_item.done',item})).toBeNull();
    feed({type:'response.output_item.done',item});
    feed({type:'response.created',response:{id:'response-B'}},8,'delegate-B');
    const batch = feed({type:'response.completed',response:{id:'response-A',output:[]}},9);
    expect(batch?.revision).toBe(7); // Compare with current revision before applying.
    expect(batch?.responseId).toBe('response-A');
    expect([...batch!.calls.values()]).toEqual([item]);
    expect(feed({type:'response.completed',response:{id:'response-A',output:[]}})).toBeNull();
    expect(feed({type:'response.created',response:{id:'response-A'}})).toBeNull();
    expect(feed({type:'response.failed',response:{id:'response-B'}},8,'delegate-B')).toBeNull();
  });

  it('does not execute incomplete responses or unrelated top-level events', () => {
    const batches = new LiveToolBatches();
    expect(batches.accept({type:'response.output_item.done',item:{type:'function_call'}},0)).toBeNull();
    batches.accept({type:'response.event',delegation_id:'d',event:{type:'response.created',response:{id:'r'}}},0);
    batches.accept({type:'response.event',delegation_id:'d',event:{type:'response.output_item.done',item:{type:'function_call',name:'save_brief',call_id:'c',arguments:'{}'}}},0);
    expect(batches.accept({type:'response.event',delegation_id:'d',event:{type:'response.incomplete',response:{id:'r'}}},0)).toBeNull();
    expect(batches.accept({type:'response.event',delegation_id:'d',event:{type:'response.completed',response:{id:'r'}}},0)).toBeNull();
  });

  it('preserves spacing, overlapping speakers, late fragments and duplicate suppression in captions', () => {
    const captions = new LiveCaptions();
    const input = (id: string, delta: string, start: number) => ({type:'session.input_transcript.delta',event_id:id,delta,start_ms:start,end_ms:start+100});
    expect(captions.accept(input('u2','red',200))?.text).toBe('red');
    expect(captions.accept({ ...input('a1','Certainly.',150), type:'session.output_transcript.delta' })).toEqual({speaker:'assistant',text:'Certainly.'});
    expect(captions.accept(input('u1','Make it ',100))).toEqual({speaker:'user',text:'Make it red'});
    expect(captions.accept(input('u2','red',200))).toBeNull();
    expect(captions.accept(input('u3',', red please.',300))?.text).toBe('Make it red, red please.');
    expect(captions.accept({type:'response.event',delta:'private tool output'})).toBeNull();
  });
});
