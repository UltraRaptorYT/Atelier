import { auth } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';
export const runtime = 'nodejs';
export const maxDuration = 60;
async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const local = process.env.NODE_ENV === 'development' && !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && ['127.0.0.1', 'localhost'].includes(request.nextUrl.hostname);
  if (!local && !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return Response.json({ error: 'Authentication and the studio backend must be configured before live use.' }, { status: 503 });
  const headers = new Headers();
  if (local) headers.set('X-Atelier-Local', 'true');
  else { const session = await auth(); const token = await session.getToken(); if (!token) return Response.json({ error: 'Sign in to use your studio.' }, { status: 401 }); headers.set('Authorization', `Bearer ${token}`); }
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  for (const key of ['content-type', 'x-atelier-agent', 'last-event-id']) { const value = request.headers.get(key); if (value) headers.set(key, value); }
  const upstream = process.env.ATELIER_WORKER_URL || (local ? 'http://127.0.0.1:8787' : '');
  if (!upstream) return Response.json({ error: 'The studio backend is not connected yet.' }, { status: 503 });
  try {
    const response = await fetch(`${upstream}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(), cache: 'no-store', signal: request.signal });
    const out = new Headers(); for (const key of ['content-type', 'content-disposition', 'x-voice-session', 'cache-control']) { const value = response.headers.get(key); if (value) out.set(key, value); }
    out.set('Cache-Control', 'private, no-store'); out.set('X-Accel-Buffering', 'no');
    return new Response(response.body, { status: response.status, headers: out });
  } catch { return Response.json({ error: 'The studio backend is unavailable. Start the local Worker or connect your deployment.' }, { status: 503 }); }
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
