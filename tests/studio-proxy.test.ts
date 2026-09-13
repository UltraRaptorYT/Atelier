import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, PUT, DELETE } from '../app/api/studio/[...path]/route';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
  vi.stubEnv('ATELIER_WORKER_URL', 'http://worker.test');
  vi.stubEnv('__NEXT_NO_MIDDLEWARE_URL_NORMALIZE', '');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockImplementation(async () => Response.json({ saved: true }, { status: 201 }));
  mocks.auth.mockResolvedValue({ getToken: async () => 'signed-test-session' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function request(url: string, origin: string, extraHeaders: Record<string, string> = {}, method = 'POST') {
  return new NextRequest(url, { method, headers: { host: new URL(url).host, origin, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify({ name: 'Demo project' }) });
}
const context = () => ({ params: Promise.resolve({ path: ['projects'] }) });

describe('studio proxy browser origins', () => {
  it.each([['POST', POST], ['PUT', PUT], ['DELETE', DELETE]] as const)('allows same-origin 127.0.0.1 %s despite Next URL normalization', async (method, handler) => {
    const req = request('http://127.0.0.1:3100/api/studio/projects?demo=1', 'http://127.0.0.1:3100', {}, method);
    expect(req.nextUrl.origin).toBe('http://localhost:3100');
    expect(new URL(req.url).origin).toBe('http://localhost:3100');
    const response = await handler(req, context());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ saved: true });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe('http://worker.test/projects?demo=1');
    expect(options.method).toBe(method);
    expect(new TextDecoder().decode(options.body)).toBe(JSON.stringify({ name: 'Demo project' }));
    expect(options.headers.get('X-Atelier-Local')).toBe('true');
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it('continues to allow the exact localhost browser origin', async () => {
    expect((await POST(request('http://localhost:3100/api/studio/projects', 'http://localhost:3100'), context())).status).toBe(201);
  });

  it.each([
    'http://127.0.0.1:3101', 'https://127.0.0.1:3100', 'http://localhost:3100',
    'https://evil.example', 'http://127.0.0.1.evil.example:3100', 'null',
  ])('blocks an origin different from the actual IP browser origin: %s', async origin => {
    const response = await POST(request('http://127.0.0.1:3100/api/studio/projects', origin), context());
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not treat localhost and 127.0.0.1 as interchangeable origins', async () => {
    const response = await POST(request('http://localhost:3100/api/studio/projects', 'http://127.0.0.1:3100'), context());
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('ignores spoofed forwarded host and protocol headers', async () => {
    const response = await POST(request('http://127.0.0.1:3100/api/studio/projects', 'https://evil.example', {
      'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', forwarded: 'host=evil.example;proto=https',
    }), context());
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1:3101', '127.0.0.1:99999'])('rejects an invalid or mismatched loopback port: %s', async host => {
    const response = await POST(request('http://127.0.0.1:3100/api/studio/projects', 'http://127.0.0.1:3100', { host }), context());
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(['evil.example:3100', '127.0.0.1:3100@evil.example', '127.0.0.1:3100,localhost:3100'])('does not grant local authentication to an invalid Host: %s', async host => {
    const response = await POST(request('http://127.0.0.1:3100/api/studio/projects', 'http://127.0.0.1:3100', { host }), context());
    expect(response.status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it('fails closed when the loopback Host is unavailable', async () => {
    const req = request('http://127.0.0.1:3100/api/studio/projects', 'http://127.0.0.1:3100');
    req.headers.delete('host');
    expect((await POST(req, context())).status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('preserves authenticated production same-origin forwarding', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_configured');
    const response = await POST(request('https://atelier.example/api/studio/projects', 'https://atelier.example'), context());
    expect(response.status).toBe(201);
    const headers = mocks.fetch.mock.calls[0][1].headers;
    expect(headers.get('Authorization')).toBe('Bearer signed-test-session');
    expect(headers.has('X-Atelier-Local')).toBe(false);
  });

  it('does not use a claimed Host or forwarded header to allow a production cross-origin request', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_configured');
    const response = await POST(request('https://atelier.example/api/studio/projects', 'https://evil.example', { host: 'evil.example', 'x-forwarded-host': 'evil.example' }), context());
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('studio proxy capture upload bounds', () => {
  const origin = 'http://127.0.0.1:3100';
  const capturePath = ['projects', 'project-one', 'captures'];
  const upload = (path: string[], body: BodyInit, method = 'POST', extraHeaders: Record<string, string> = {}) => new NextRequest(`${origin}/api/studio/${path.join('/')}`, {
    method, headers: { host: '127.0.0.1:3100', origin, 'content-type': 'application/json', ...extraHeaders }, body,
  });
  const route = (path: string[]) => ({ params: Promise.resolve({ path }) });

  it('forwards a real capture JSON body larger than 64 KB without altering it', async () => {
    const body = JSON.stringify({ baseRevision: 1, operationId: 'test-operation', dataUrl: `data:image/png;base64,${'A'.repeat(100000)}` });
    const response = await POST(upload(capturePath, body), route(capturePath));
    expect(response.status).toBe(201);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][0]).toBe('http://worker.test/projects/project-one/captures');
    const forwarded = mocks.fetch.mock.calls[0][1].body as Uint8Array;
    expect(forwarded.byteLength).toBeGreaterThan(64000);
    expect(new TextDecoder().decode(forwarded)).toBe(body);
  });

  it.each([undefined, '1'])('rejects a capture stream above 12 MiB regardless of Content-Length %s', async contentLength => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(12 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); },
      cancel,
    });
    const headers = contentLength === undefined ? {} : { 'content-length': contentLength };
    const response = await POST(upload(capturePath, body, 'POST', headers), route(capturePath));
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized capture before forwarding its small body', async () => {
    const response = await POST(upload(capturePath, '{}', 'POST', { 'content-length': String(12 * 1024 * 1024 + 1) }), route(capturePath));
    expect(response.status).toBe(413);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { path: ['projects', 'project-one', 'captures', 'extra'], method: 'POST' },
    { path: ['projects', 'project-one', 'images'], method: 'POST' },
    { path: ['projects', 'captures'], method: 'POST' },
    { path: ['captures', 'project-one', 'captures'], method: 'POST' },
    { path: ['projects', '', 'captures'], method: 'POST' },
    { path: capturePath, method: 'PUT' },
    { path: capturePath, method: 'DELETE' },
  ])('retains the 64 KB stream limit for $method $path', async ({ path, method }) => {
    const response = await POST(upload(path, 'A'.repeat(64001), method, { 'content-length': '1' }), route(path));
    expect(response.status).toBe(413);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
