import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import site from '../sites';

const origin = 'https://atelier.example';
const identity = { 'oai-authenticated-user-id': 'owner-one', 'oai-authenticated-user-email': 'owner@example.test' };
const upstreamFetch = vi.fn<typeof fetch>();
const assetsFetch = vi.fn<(request: Request) => Promise<Response>>();
const env = {
  ASSETS: { fetch: assetsFetch }, ATELIER_WORKER_URL: 'https://api.example.test',
  SITES_PROXY_SECRET: 'local-test-proxy-secret-with-no-provider-access',
};
function request(path: string, method = 'GET', body?: BodyInit, extraHeaders: Record<string, string> = {}) {
  return new Request(`${origin}/api/studio${path}`, {
    method, headers: { ...identity, origin, 'content-type': 'application/json', ...extraHeaders }, body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', upstreamFetch);
  upstreamFetch.mockImplementation(async () => Response.json({ saved: true }, { status: 201 }));
  assetsFetch.mockImplementation(async () => new Response('studio assets'));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Sites identity and routing', () => {
  it.each(['/', '/_next/static/studio.js'])('serves public assets without backend authentication: %s', async path => {
    const req = new Request(origin + path);
    expect(await (await site.fetch(req, env)).text()).toBe('studio assets');
    expect(assetsFetch).toHaveBeenCalledExactlyOnceWith(req);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('reports an anonymous session without contacting the backend', async () => {
    const response = await site.fetch(new Request(`${origin}/api/studio/session`), env);
    expect(await response.json()).toEqual({ provider: 'chatgpt', signedIn: false, email: null });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('reports the hosting identity without exposing a backend token', async () => {
    expect(await (await site.fetch(request('/session'), env)).json()).toEqual({ provider: 'chatgpt', signedIn: true, email: identity['oai-authenticated-user-email'] });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each(['oai-authenticated-user-id', 'oai-authenticated-user-email'])('requires both hosting identity fields; missing %s', async name => {
    const req = request('/projects', 'GET', undefined, { Authorization: 'Bearer client-supplied', 'X-Atelier-Local': 'true' });
    req.headers.delete(name);
    const response = await site.fetch(req, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ signIn: '/signin-with-chatgpt?return_to=%2F' });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    { ATELIER_WORKER_URL: '' }, { SITES_PROXY_SECRET: '' }, { ATELIER_WORKER_URL: 'http://api.example.test' },
  ])('fails closed when the backend is unconfigured or insecure: %j', async override => {
    expect((await site.fetch(request('/projects'), { ...env, ...override })).status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('signs a short-lived scoped backend identity and forwards only permitted context', async () => {
    const payload = JSON.stringify({ instruction: 'Make the roof red.' });
    const req = request('/projects/project-one/messages?after=12', 'POST', payload, {
      Authorization: 'Bearer client-supplied', cookie: 'private-client-cookie', 'X-Atelier-Local': 'true',
      'x-atelier-agent': 'designer', 'x-atelier-element': 'roof', 'x-atelier-location': 'workstation', 'last-event-id': '12',
    });
    expect((await site.fetch(req, env)).status).toBe(201);
    const [url, options] = upstreamFetch.mock.calls[0];
    expect(String(url)).toBe('https://api.example.test/projects/project-one/messages?after=12');
    expect(options!.method).toBe('POST');
    expect(options!.redirect).toBe('manual');
    expect(options!.signal).toBe(req.signal);
    expect(new TextDecoder().decode(options!.body as Uint8Array)).toBe(payload);
    const headers = new Headers(options!.headers);
    const token = headers.get('authorization')!.slice('Bearer '.length);
    const { payload: claims } = await jwtVerify(token, new TextEncoder().encode(env.SITES_PROXY_SECRET), {
      algorithms: ['HS256'], issuer: 'atelier-sites', audience: 'atelier-api', maxTokenAge: '2m',
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    expect(claims.sub).toBe('sites:owner-one');
    expect(claims.exp! - claims.iat!).toBe(90);
    expect(Object.fromEntries([...headers].filter(([key]) => key !== 'authorization'))).toEqual({
      'content-type': 'application/json', 'last-event-id': '12', 'x-atelier-agent': 'designer',
      'x-atelier-element': 'roof', 'x-atelier-location': 'workstation',
    });
  });

  it.each(['POST', 'PUT', 'DELETE'])('requires the exact browser Origin on %s', async method => {
    for (const supplied of [undefined, 'null', 'https://elsewhere.example', 'http://atelier.example']) {
      const req = request('/projects', method, '{}');
      if (supplied === undefined) req.headers.delete('origin'); else req.headers.set('origin', supplied);
      expect((await site.fetch(req, env)).status).toBe(403);
    }
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each(['PATCH', 'OPTIONS'])('rejects unsupported methods: %s', async method => {
    expect((await site.fetch(request('/projects', method), env)).status).toBe(405);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe('Sites upload bounds', () => {
  it('forwards capture JSON larger than 64 KB unchanged', async () => {
    const body = JSON.stringify({ baseRevision: 1, dataUrl: `data:image/png;base64,${'A'.repeat(100000)}` });
    expect((await site.fetch(request('/projects/project-one/captures', 'POST', body), env)).status).toBe(201);
    expect(new TextDecoder().decode(upstreamFetch.mock.calls[0][1]!.body as Uint8Array)).toBe(body);
  });

  it.each([undefined, '1'])('bounds the actual capture stream regardless of Content-Length %s', async contentLength => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(12 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel,
    });
    const headers = contentLength === undefined ? {} : { 'content-length': contentLength };
    expect((await site.fetch(request('/projects/project-one/captures', 'POST', body, headers), env)).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared capture before forwarding', async () => {
    expect((await site.fetch(request('/projects/project-one/captures', 'POST', '{}', { 'content-length': String(12 * 1024 * 1024 + 1) }), env)).status).toBe(413);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['/projects/project-one/captures/extra', 'POST'], ['/projects/project-one/images', 'POST'],
    ['/projects/captures', 'POST'], ['/captures/project-one/captures', 'POST'], ['/projects//captures', 'POST'],
    ['/projects/project-one/captures', 'PUT'], ['/projects/project-one/captures', 'DELETE'],
  ])('keeps ordinary commands bounded to 64 KB: %s %s', async (path, method) => {
    expect((await site.fetch(request(path, method, 'A'.repeat(64001), { 'content-length': '1' }), env)).status).toBe(413);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe('Sites responses', () => {
  it('streams events immediately and passes cancellation to the backend stream', async () => {
    const cancel = vi.fn();
    upstreamFetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('id: 13\ndata: {"type":"task_started"}\n\n')); }, cancel,
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const req = request('/projects/project-one/events?after=12', 'GET', undefined, { 'last-event-id': '12' });
    const response = await site.fetch(req, env);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('id: 13');
    await reader.cancel('viewer left');
    expect(cancel).toHaveBeenCalledExactlyOnceWith('viewer left');
  });

  it('preserves binary artifacts and download headers without caching private content', async () => {
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
    upstreamFetch.mockResolvedValueOnce(new Response(bytes, { headers: {
      'content-type': 'model/gltf-binary', 'content-disposition': 'attachment; filename="model.glb"',
      'cache-control': 'public, max-age=86400', 'set-cookie': 'backend-private',
    } }));
    const response = await site.fetch(request('/projects/project-one/artifacts/model?inline=1'), env);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('content-type')).toBe('model/gltf-binary');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="model.glb"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('preserves SDP and the voice-session response header', async () => {
    upstreamFetch.mockResolvedValueOnce(new Response('v=0\r\ns=answer\r\n', {
      status: 201, headers: { 'content-type': 'application/sdp', 'x-voice-session': 'voice-one' },
    }));
    const response = await site.fetch(request('/projects/project-one/voice', 'POST', 'v=0\r\ns=offer\r\n', { 'content-type': 'application/sdp' }), env);
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/sdp');
    expect(response.headers.get('x-voice-session')).toBe('voice-one');
    expect(await response.text()).toBe('v=0\r\ns=answer\r\n');
  });

  it('preserves actionable backend errors', async () => {
    upstreamFetch.mockResolvedValueOnce(Response.json({ error: 'The design changed. Refresh before continuing.' }, { status: 409 }));
    const response = await site.fetch(request('/projects/project-one/messages', 'POST', '{}'), env);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'The design changed. Refresh before continuing.' });
  });

  it('returns a safe retryable failure when the backend cannot be reached', async () => {
    upstreamFetch.mockRejectedValueOnce(new Error('Private provider connection details'));
    const response = await site.fetch(request('/projects'), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'The studio service could not be reached. Please try again shortly.' });
  });
});
