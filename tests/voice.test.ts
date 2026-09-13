import { afterEach, describe, expect, it, vi } from 'vitest';
import { completedVoiceTool, hangupVoice, LiveResponseTools, startVoice, voiceOperationId, voiceSessionConfig } from '../worker/src/voice';
import type { Bindings, ProjectRow } from '../worker/src/types';

vi.mock('../worker/src/prompts', () => ({ agentInstructions: () => 'Keep work within your task ownership.' }));

const modelConfig = { VOICE_MODEL: 'gpt-live-1', OPENAI_MODEL: 'gpt-5.6-terra' };
const providerKey = 'test-worker-only-openai-key';
const offer = 'v=0\r\no=- 123 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
const answer = 'v=0\r\no=- 456 1 IN IP4 127.0.0.1\r\ns=Live\r\nt=0 0\r\n';
const sessionId = 'live-session:opaque/with?token=one';
const project: ProjectRow = {
  id: 'project-test', owner_id: 'owner-test', name: 'Courtyard house',
  brief: JSON.stringify({ request: 'A courtyard house for four people.', summary: 'Courtyard house', goals: [], constraints: [], questions: [] }),
  revision: 0, design_key: null, status: 'draft', created_at: '2026-09-13', updated_at: '2026-09-13',
};

function bindings() {
  const attachVoice = vi.fn().mockResolvedValue(undefined);
  const closeVoice = vi.fn().mockResolvedValue(undefined);
  const getByName = vi.fn().mockReturnValue({ attachVoice, closeVoice });
  const prepare = vi.fn(() => {
    const statement = { bind: vi.fn(), first: vi.fn().mockResolvedValue(null), run: vi.fn().mockResolvedValue({ success: true }) };
    statement.bind.mockReturnValue(statement);
    return statement;
  });
  const env = {
    ...modelConfig, VOICE_ENABLED: 'true', OPENAI_API_KEY: providerKey,
    DB: { prepare }, PROJECTS: { getByName },
  } as unknown as Bindings;
  return { env, attachVoice, closeVoice, getByName, prepare };
}

function voiceRequest(body = offer, contentType = 'application/sdp', signal?: AbortSignal) {
  return new Request('https://atelier.test/projects/project-test/voice', {
    method: 'POST', headers: { 'Content-Type': contentType }, body, signal,
  });
}

function providerAnswer(transport: unknown = { type: 'webrtc', sdp: answer }) {
  return Response.json({ session: { id: sessionId }, transport });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('GPT-Live session contract', () => {
  it('separates the voice model from Responses delegation without legacy Realtime configuration', () => {
    const session = voiceSessionConfig(modelConfig, 'designer');
    expect(session.model).toBe('gpt-live-1');
    expect(session.store).toBe(false);
    expect(session).not.toHaveProperty('type');
    expect(session).not.toHaveProperty('tools');
    expect(session).not.toHaveProperty('turn_detection');
    expect(session.audio).not.toHaveProperty('input.turn_detection');
    expect(session.delegation).toMatchObject({ type: 'responses', responses: { model: 'gpt-5.6-terra', parallel_tool_calls: false } });
    expect(session.instructions).toContain('Sofia Reyes');
  });

  it('exposes transcript events to the browser while keeping mutation tools on the backend', () => {
    const session = voiceSessionConfig(modelConfig, 'principal');
    expect(session.client?.data_channel?.allowed_client_events).toEqual([]);
    expect(session.client?.data_channel?.allowed_server_events).toEqual(expect.arrayContaining([
      { type: 'session.started' }, { type: 'session.closed' }, { type: 'session.input_transcript.delta' }, { type: 'session.output_transcript.delta' }, { type: 'error' },
    ]));
    expect(session.client?.data_channel?.allowed_server_events).not.toContainEqual({ type: 'response.event' });
    expect(session.delegation?.type).toBe('responses');
    if (session.delegation?.type !== 'responses') throw new Error('Missing Responses delegation');
    const tools = session.delegation.responses.tools;
    expect(tools?.map(tool => tool.type === 'function' ? tool.name : tool.type)).toEqual([
      'review_team', 'finish_meeting', 'get_project_context', 'save_brief', 'answer_clarification', 'request_change',
    ]);
    expect(tools?.find(tool => tool.type === 'function' && tool.name === 'request_change')).toMatchObject({
      type: 'function', strict: true,
      parameters: { required: ['instruction', 'elementId', 'baseRevision'], additionalProperties: false },
    });
    expect(tools?.find(tool => tool.type === 'function' && tool.name === 'answer_clarification')).toMatchObject({
      type: 'function', strict: true,
      parameters: {
        required: ['clarificationId', 'clarificationVersion', 'answers'], additionalProperties: false,
        properties: { answers: { type: 'array', items: { required: ['questionId', 'answer'], additionalProperties: false } } },
      },
    });
  });
});

describe('voice tool completion and operation identity', () => {
  const item = { type: 'function_call', call_id: 'call-1', name: 'save_brief', arguments: '{"details":"Four occupants"}' };

  it('reads a complete nested function item instead of executing partial arguments or transcript events', () => {
    expect(completedVoiceTool({ type: 'response.output_item.done', item })).toMatchObject(item);
    for (const type of ['response.function_call_arguments.done', 'response.function_call_arguments.delta', 'response.output_item.added', 'session.input_transcript.delta']) {
      expect(completedVoiceTool({ ...item, type, item })).toBeNull();
    }
    expect(completedVoiceTool({ type: 'response.output_item.done', call_id: 'call-1', name: 'save_brief', arguments: '{}' })).toBeNull();
    expect(completedVoiceTool({ type: 'response.output_item.done', item: { ...item, call_id: '' } })).toBeNull();
    expect(completedVoiceTool({ type: 'response.output_item.done', item: { ...item, type: 'message' } })).toBeNull();
  });

  it('gives replayed calls the same valid operation UUID and separates calls and sessions', async () => {
    const original = await voiceOperationId('session-1', 'call-1');
    expect(original).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await voiceOperationId('session-1', 'call-1')).toBe(original);
    expect(new Set(await Promise.all([
      voiceOperationId('session-1', 'call-1'), voiceOperationId('session-2', 'call-1'),
      voiceOperationId('session-1', 'call-2'), voiceOperationId('a:b', 'c'), voiceOperationId('a', 'b:c'),
    ])).size).toBe(5);
  });
});

describe('server-side voice setup and cleanup', () => {
  it('exchanges the offer as JSON, attaches the exact opaque session ID, and returns only browser connection data', async () => {
    const { env, attachVoice } = bindings();
    const fetchMock = vi.fn().mockResolvedValue(providerAnswer());
    vi.stubGlobal('fetch', fetchMock);
    const response = await startVoice(voiceRequest(), env, project, project.owner_id, 'designer');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/live/sessions');
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${providerKey}`);
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    const payload = JSON.parse(init.body);
    expect(payload.transport).toEqual({ type: 'webrtc', sdp: offer });
    expect(payload.session.model).toBe('gpt-live-1');
    expect(init.body).not.toContain(providerKey);
    expect(attachVoice).toHaveBeenCalledWith(project.id, project.owner_id, sessionId, 'designer', null, false);
    expect(response.headers.get('Content-Type')).toBe('application/sdp');
    expect(response.headers.get('X-Voice-Session')).toBe(sessionId);
    const body = await response.text();
    expect(body).toBe(answer);
    expect(body + JSON.stringify([...response.headers])).not.toContain(providerKey);
  });

  it.each([
    ['voice disabled', 'false', offer, 'application/sdp', 503],
    ['wrong content type', 'true', offer, 'application/json', 415],
    ['invalid SDP', 'true', 'not an SDP offer', 'application/sdp', 400],
    ['oversized SDP', 'true', 'v=0' + 'x'.repeat(64000), 'application/sdp', 413],
  ])('rejects %s before making a provider request', async (_name, enabled, body, contentType, status) => {
    const { env, attachVoice } = bindings();
    env.VOICE_ENABLED = enabled;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(startVoice(voiceRequest(body, contentType), env, project, project.owner_id, 'principal')).rejects.toMatchObject({ status });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attachVoice).not.toHaveBeenCalled();
  });

  it('sanitizes provider errors without creating local controls', async () => {
    const { env, attachVoice, closeVoice } = bindings();
    const fetchMock = vi.fn().mockResolvedValue(new Response(`Bad credentials: ${providerKey}`, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await startVoice(voiceRequest(), env, project, project.owner_id, 'principal').catch(error => error);
    expect(error.status).toBe(502);
    expect(error.message).not.toContain(providerKey);
    expect(attachVoice).not.toHaveBeenCalled();
    expect(closeVoice).not.toHaveBeenCalled();
  });

  it('hangs up a created provider session if project controls cannot attach', async () => {
    const { env, attachVoice, closeVoice } = bindings();
    attachVoice.mockRejectedValue(new Error('Sideband unavailable'));
    const fetchMock = vi.fn().mockResolvedValueOnce(providerAnswer()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startVoice(voiceRequest(), env, project, project.owner_id, 'architect')).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/hangup`,
      expect.objectContaining({ method: 'POST', headers: { Authorization: `Bearer ${providerKey}` } }),
    );
    expect(closeVoice).toHaveBeenCalledWith(sessionId, project.owner_id);
  });

  it('hangs up a known provider session when its answer is malformed', async () => {
    const { env, attachVoice, closeVoice } = bindings();
    const fetchMock = vi.fn().mockResolvedValueOnce(providerAnswer({ type: 'webrtc', sdp: 'not SDP' })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startVoice(voiceRequest(), env, project, project.owner_id, 'principal')).rejects.toMatchObject({ status: 502 });
    expect(attachVoice).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(closeVoice).toHaveBeenCalledWith(sessionId, project.owner_id);
  });

  it('cleans up local controls even if provider rollback also fails', async () => {
    const { env, attachVoice, closeVoice } = bindings();
    attachVoice.mockRejectedValue(new Error('Sideband unavailable'));
    const fetchMock = vi.fn().mockResolvedValueOnce(providerAnswer()).mockRejectedValueOnce(new Error('Provider unreachable'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startVoice(voiceRequest(), env, project, project.owner_id, 'principal')).rejects.toMatchObject({ status: 502 });
    expect(closeVoice).toHaveBeenCalledWith(sessionId, project.owner_id);
  });

  it('treats hangup of an already absent provider session as complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(hangupVoice(providerKey, sessionId)).resolves.toBeUndefined();
  });
});

describe('delegated Responses stream', () => {
  const call = (id: string) => ({ type: 'function_call', call_id: id, name: 'save_brief', arguments: '{"details":"Four occupants"}' });
  const envelope = (event: Record<string, unknown>, delegation = 'delegation-1') => ({ type: 'response.event', delegation_id: delegation, event });

  it('waits for terminal completion, submits all collected results, then continues once despite an empty output snapshot', async () => {
    const execute = vi.fn(async item => ({ saved: true, callId: item.call_id }));
    const send = vi.fn();
    const tools = new LiveResponseTools(execute, send);
    await tools.handle(envelope({ type: 'response.created', response: { id: 'response-1', output: [] } }));
    await tools.handle(envelope({ ...call('partial-call'), type: 'response.function_call_arguments.done' }));
    await tools.handle(envelope({ type: 'response.output_item.done', item: call('call-1') }));
    await tools.handle(envelope({ type: 'response.output_item.done', item: call('call-2') }));
    await tools.handle(envelope({ type: 'response.output_item.done', item: call('call-1') }));
    expect(execute).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    await tools.handle(envelope({ type: 'response.completed', response: { id: 'response-1', output: [] } }));
    expect(execute.mock.calls.map(([item]) => item.call_id)).toEqual(['call-1', 'call-2']);
    expect(send.mock.calls.map(([event]) => event)).toEqual([
      { type: 'response.item.create', item: { type: 'function_call_output', call_id: 'call-1', output: '{"saved":true,"callId":"call-1"}' } },
      { type: 'response.item.create', item: { type: 'function_call_output', call_id: 'call-2', output: '{"saved":true,"callId":"call-2"}' } },
      { type: 'response.create' },
    ]);
    await tools.handle(envelope({ type: 'response.completed', response: { id: 'response-1', output: [] } }));
    await tools.handle(envelope({ type: 'response.created', response: { id: 'response-1', output: [] } }));
    await tools.handle(envelope({ type: 'response.output_item.done', item: call('call-1') }));
    await tools.handle(envelope({ type: 'response.completed', response: { id: 'response-1', output: [] } }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it.each(['response.failed', 'response.incomplete', 'response.cancelled'])('does not apply collected changes when the response ends with %s', async terminal => {
    const execute = vi.fn().mockResolvedValue({ saved: true });
    const send = vi.fn();
    const tools = new LiveResponseTools(execute, send);
    await tools.handle(envelope({ type: 'response.created', response: { id: 'response-1' } }));
    await tools.handle(envelope({ type: 'response.output_item.done', item: call('call-1') }));
    await tools.handle(envelope({ type: terminal, response: { id: 'response-1', output: [] } }));
    await tools.handle(envelope({ type: 'response.completed', response: { id: 'response-1', output: [] } }));
    expect(execute).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('isolates interleaved delegation streams and ignores mismatched terminal IDs and unwrapped events', async () => {
    const execute = vi.fn().mockResolvedValue({ saved: true });
    const send = vi.fn();
    const tools = new LiveResponseTools(execute, send);
    await tools.handle(envelope({ type: 'response.created', response: { id: 'response-a' } }, 'delegation-a'));
    await tools.handle(envelope({ type: 'response.created', response: { id: 'response-b' } }, 'delegation-b'));
    await tools.handle({ type: 'response.output_item.done', item: call('unwrapped-call') });
    await tools.handle(envelope({ type: 'response.output_item.done', item: call('call-a') }, 'delegation-a'));
    await tools.handle(envelope({ type: 'response.output_item.done', item: call('call-b') }, 'delegation-b'));
    await tools.handle(envelope({ type: 'response.completed', response: { id: 'response-b' } }, 'delegation-a'));
    expect(execute).not.toHaveBeenCalled();
    await tools.handle(envelope({ type: 'response.completed', response: { id: 'response-b', output: [] } }, 'delegation-b'));
    expect(execute.mock.calls.map(([item]) => item.call_id)).toEqual(['call-b']);
    await tools.handle(envelope({ type: 'response.completed', response: { id: 'response-a', output: [] } }, 'delegation-a'));
    expect(execute.mock.calls.map(([item]) => item.call_id)).toEqual(['call-b', 'call-a']);
    expect(send.mock.calls.filter(([event]) => event.type === 'response.create')).toHaveLength(2);
  });
});
