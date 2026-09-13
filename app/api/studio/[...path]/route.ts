import { auth } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';
export const runtime = 'nodejs';
export const maxDuration = 60;
function matchesOrigin(request: NextRequest, origin: string): boolean {
  if (process.env.NODE_ENV === 'development' && request.nextUrl.hostname === 'localhost') {
    // Next normalizes loopback IPs in both nextUrl and request.url. Recover the
    // browser's actual host without trusting forwarded headers or aliasing origins.
    const host = request.headers.get('host');
    if (!host || !/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host)) return false;
    try {
      const actual = new URL(`${request.nextUrl.protocol}//${host}`);
      return actual.port === request.nextUrl.port && origin === actual.origin;
    } catch { return false; }
  }
  return origin === request.nextUrl.origin;
}
async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const requestHost = request.headers.get('host') || '';
  const local = process.env.NODE_ENV === 'development' && !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(requestHost);
  if (!local && !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return Response.json({ error: 'Authentication and the studio backend must be configured before live use.' }, { status: 503 });
  const headers = new Headers();
  if (local) headers.set('X-Atelier-Local', 'true');
  else { const session = await auth(); const token = await session.getToken(); if (!token) return Response.json({ error: 'Sign in to use your studio.' }, { status: 401 }); headers.set('Authorization', `Bearer ${token}`); }
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && !matchesOrigin(request, origin)) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  for (const key of ['content-type', 'x-atelier-agent', 'x-atelier-element', 'x-atelier-location', 'last-event-id']) { const value = request.headers.get(key); if (value) headers.set(key, value); }
  const upstream = process.env.ATELIER_WORKER_URL || (local ? 'http://127.0.0.1:8787' : '');
  if (!upstream) return Response.json({ error: 'The studio backend is not connected yet.' }, { status: 503 });
  let payload:Uint8Array<ArrayBuffer>|undefined;
  if(!['GET','HEAD'].includes(request.method)) {
    // Captures carry a base64 raster image; match the Worker's bounded JSON
    // allowance only for this exact upload route, leaving other requests small.
    const bodyLimit = request.method === 'POST' && path.length === 3 && path[0] === 'projects' && Boolean(path[1]) && path[2] === 'captures' ? 12 * 1024 * 1024 : 64000;
    if(Number(request.headers.get('content-length')||0)>bodyLimit) return Response.json({error:'Request too large.'},{status:413});
    const reader=request.body?.getReader(), chunks:Uint8Array[]=[]; let size=0;
    if(reader) while(true) {const {done,value}=await reader.read();if(done) break;size+=value.length;if(size>bodyLimit){await reader.cancel();return Response.json({error:'Request too large.'},{status:413});}chunks.push(value);}
    payload=new Uint8Array(size);let offset=0;for(const chunk of chunks){payload.set(chunk,offset);offset+=chunk.length;}
  }
  try {
    const response = await fetch(`${upstream}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, { method: request.method, headers, body: payload, cache: 'no-store', signal: request.signal });
    const out = new Headers(); for (const key of ['content-type', 'content-disposition', 'x-voice-session', 'cache-control']) { const value = response.headers.get(key); if (value) out.set(key, value); }
    out.set('X-Content-Type-Options', 'nosniff'); out.set('Cache-Control', 'private, no-store'); out.set('X-Accel-Buffering', 'no');
    return new Response(response.body, { status: response.status, headers: out });
  } catch { return Response.json({ error: 'The studio backend is unavailable. Start the local Worker or connect your deployment.' }, { status: 503 }); }
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
