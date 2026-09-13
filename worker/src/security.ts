import { verifyToken } from '@clerk/backend';
import type { Bindings, ProjectRow } from './types';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function userId(request: Request, env: Bindings): Promise<string> {
  const url = new URL(request.url);
  if (env.ENVIRONMENT === 'local' && ['127.0.0.1', 'localhost'].includes(url.hostname) && request.headers.get('X-Atelier-Local') === 'true') return 'local-developer';
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token || (!env.CLERK_SECRET_KEY && !env.CLERK_JWT_KEY)) throw new HttpError(401, 'Sign in to use your studio.');
  try { const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY, jwtKey: env.CLERK_JWT_KEY, authorizedParties: [env.APP_ORIGIN] }); if (!payload.sub) throw new Error(); return payload.sub; }
  catch { throw new HttpError(401, 'Your sign-in has expired. Please sign in again.'); }
}
export async function ownedProject(env: Bindings, id: string, owner: string): Promise<ProjectRow> {
  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').bind(id, owner).first<ProjectRow>();
  if (!row) throw new HttpError(404, 'Project not found.'); return row;
}
const base64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
const unbase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function keyFor(env: Pick<Bindings, 'KEY_ENCRYPTION_KEYS'>, version: string) {
  if (!env.KEY_ENCRYPTION_KEYS) throw new HttpError(503, 'Credential encryption is not configured.');
  const keys = JSON.parse(env.KEY_ENCRYPTION_KEYS) as Record<string, string>;
  if (!keys[version]) throw new HttpError(503, 'The credential encryption key is unavailable.');
  const bytes = unbase64(keys[version]); if (bytes.length !== 32) throw new HttpError(503, 'Credential encryption is not configured correctly.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptCredential(env: Pick<Bindings, 'KEY_ENCRYPTION_KEYS' | 'KEY_VERSION'>, owner: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) }, await keyFor(env, env.KEY_VERSION), new TextEncoder().encode(value));
  return JSON.stringify({ v: env.KEY_VERSION, iv: base64(iv), data: base64(new Uint8Array(data)) });
}
export async function decryptCredential(env: Pick<Bindings, 'KEY_ENCRYPTION_KEYS'>, owner: string, ciphertext: string) {
  const c = JSON.parse(ciphertext) as { v: string; iv: string; data: string };
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(c.iv), additionalData: new TextEncoder().encode(owner) }, await keyFor(env, c.v), unbase64(c.data));
  return new TextDecoder().decode(data);
}
export async function credential(env: Bindings, owner: string) {
  const row = await env.DB.prepare('SELECT ciphertext FROM credentials WHERE owner_id = ?').bind(owner).first<{ ciphertext: string }>();
  if (row) return decryptCredential(env, owner, row.ciphertext);
  if (env.OPENAI_API_KEY?.trim()) return env.OPENAI_API_KEY.trim();
  throw new HttpError(409, 'Add OPENAI_API_KEY to the Worker environment or connect your key in Settings.');
}
export async function bodyJSON(request: Request, maxBytes = 64000): Promise<unknown> {
  const text = await bodyText(request, maxBytes);
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
export async function bodyText(request: Request, maxBytes = 64000): Promise<string> {
  if (Number(request.headers.get('Content-Length') || 0) > maxBytes) throw new HttpError(413, 'Request too large.');
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, 'Request body is required.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, 'Request too large.'); } chunks.push(value); }
  const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(result);
}
