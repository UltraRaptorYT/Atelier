import { SignJWT } from 'jose';

// Sites dispatch supplies identity and ASSETS; this Worker has no public workers.dev URL.
interface SiteBindings {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ATELIER_WORKER_URL: string;
  SITES_PROXY_SECRET: string;
}
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export default {
  async fetch(request: Request, env: SiteBindings): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/studio/')) return env.ASSETS.fetch(request);
    const path = url.pathname.slice('/api/studio'.length);
    const user = request.headers.get('oai-authenticated-user-id');
    const email = request.headers.get('oai-authenticated-user-email');
    if (path === '/session' && request.method === 'GET') {
      return json({ provider: 'chatgpt', signedIn: Boolean(user && email), email: user && email ? email : null });
    }
    if (!user || !email) return json({ error: 'Sign in with ChatGPT to create a project and work with your team.', signIn: '/signin-with-chatgpt?return_to=%2F' }, 401);
    if (!env.ATELIER_WORKER_URL || !env.SITES_PROXY_SECRET) return json({ error: 'The studio connection is being configured. Please try again shortly.' }, 503);
    if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.get('Origin');
      if (origin !== url.origin) return json({ error: 'Invalid request origin.' }, 403);
    }
    try {
      const upstream = new URL(env.ATELIER_WORKER_URL);
      if (upstream.protocol !== 'https:') return json({ error: 'The studio connection is invalid.' }, 503);
      upstream.pathname = path;
      upstream.search = url.search;
      const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(`sites:${user}`)
        .setIssuer('atelier-sites').setAudience('atelier-api').setIssuedAt().setExpirationTime('90s')
        .sign(new TextEncoder().encode(env.SITES_PROXY_SECRET));
      const headers = new Headers({ Authorization: `Bearer ${token}` });
      for (const name of ['content-type', 'x-atelier-agent', 'x-atelier-element', 'x-atelier-location', 'last-event-id']) {
        const value = request.headers.get(name); if (value) headers.set(name, value);
      }
      // Limit uploads before forwarding; captures legitimately exceed the JSON command limit.
      let body: Uint8Array<ArrayBuffer> | undefined;
      if (!['GET', 'HEAD'].includes(request.method) && request.body) {
        const limit = request.method === 'POST' && /^\/projects\/[^/]+\/captures$/.test(path) ? 12 * 1024 * 1024 : 64000;
        if (Number(request.headers.get('content-length') || 0) > limit) return json({ error: 'Request too large.' }, 413);
        const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.length;
          if (size > limit) { await reader.cancel(); return json({ error: 'Request too large.' }, 413); }
          chunks.push(part.value);
        }
        body = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      }
      const response = await fetch(upstream, { method: request.method, headers, body, redirect: 'manual', signal: request.signal });
      const out = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' });
      for (const name of ['content-type', 'content-disposition', 'x-voice-session']) {
        const value = response.headers.get(name); if (value) out.set(name, value);
      }
      return new Response(response.body, { status: response.status, headers: out });
    } catch {
      return json({ error: 'The studio service could not be reached. Please try again shortly.' }, 503);
    }
  },
};
