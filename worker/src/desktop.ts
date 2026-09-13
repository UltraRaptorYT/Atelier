import { Sandbox } from '@e2b/desktop';
import type { AgentId, Design } from '../../shared/design';
import type { Bindings } from './types';
import { HttpError } from './security';
import { artifact, emit } from './store';
import compiler from '../../scripts/blender_compile.py';
type DesktopRow = { sandbox_id: string; lease_id: string; expires_at: number };
export async function connectDesktop(env: Bindings, projectId: string, agent: AgentId): Promise<Sandbox | null> {
  if (!env.E2B_API_KEY) return null;
  const row = await env.DB.prepare('SELECT sandbox_id,lease_id,expires_at FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(projectId, agent).first<DesktopRow>();
  if (!row || row.expires_at <= Date.now()) return null;
  try { return await Sandbox.connect(row.sandbox_id, { apiKey: env.E2B_API_KEY }); } catch { return null; }
}
export async function createDesktop(env: Bindings, projectId: string, owner: string, agent: AgentId, leaseId: string): Promise<Sandbox> {
  if (!env.E2B_API_KEY) throw new HttpError(503, 'Remote computers are not configured.');
  const budget = env.BUDGET.getByName('desktop-budget');
  const previous = await env.DB.prepare('SELECT sandbox_id,lease_id,expires_at FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(projectId,agent).first<DesktopRow>();
  // A new task gets a full bounded lease. Reusing an older machine can expire mid-commit.
  if (previous?.lease_id === leaseId) { const existing = await connectDesktop(env,projectId,agent); if (existing) { await budget.touch(leaseId,true); return existing; } }
  if (previous) { const released = await budget.release(previous.lease_id); if (released === false) throw new HttpError(425, 'Waiting for the previous workstation to shut down.'); }
  const reservation = await budget.reserve(leaseId, owner, 900);
  if (!reservation.allowed) throw new HttpError(reservation.reason === 'queue' ? 425 : 429, reservation.reason === 'queue' ? 'The studio’s computers are busy. Your job is waiting in the queue.' : reservation.reason!);
  try {
    const desktop = await Sandbox.create(env.E2B_TEMPLATE, { apiKey: env.E2B_API_KEY, timeoutMs: 900000, resolution: [1280, 800], metadata: { project: projectId, agent, lease: leaseId } });
    await budget.attach(leaseId, desktop.sandboxId);
    await env.DB.prepare('INSERT OR REPLACE INTO desktop_sessions(project_id,agent,sandbox_id,lease_id,expires_at,viewed_at) VALUES(?,?,?,?,?,?)').bind(projectId, agent, desktop.sandboxId, leaseId, Date.now()+900000, Date.now()).run();
    await desktop.commands.run('mkdir -p /home/user/project/output', { timeoutMs: 10000 });
    await desktop.files.write('/home/user/project/blender_compile.py', compiler);
    await emit(env, projectId, 'tool_completed', 'Remote workstation connected.', agent);
    return desktop;
  } catch (e) { await budget.release(leaseId); throw e; }
}
export async function syncDesktop(desktop: Sandbox, design: Design) {
  await desktop.files.write('/home/user/project/design.json', JSON.stringify(design, null, 2));
  const html = `<!doctype html><html><meta charset="utf-8"><title>Atelier design workspace</title><style>body{background:#eeeee5;color:#36432f;font:16px system-ui;margin:40px}h1{font:36px Georgia}pre{background:white;padding:20px;border-radius:8px;white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #ccc}small{color:#75856c}</style><h1>Atelier / live design workspace</h1><small>Canonical file: /home/user/project/design.json</small><h2 id="title"></h2><table id="spaces"><tr><th>Space</th><th>Floor</th><th>Size (m)</th></tr></table><h2>Design source</h2><pre id="source"></pre><script>const design=${JSON.stringify(design).replaceAll('<', '\\u003c')};document.getElementById('title').textContent=design.title;document.getElementById('source').textContent=JSON.stringify(design,null,2);for(const space of design.spaces){const tr=document.createElement('tr');for(const value of [space.name,space.floor+1,space.size.join(' × ')]){const td=document.createElement('td');td.textContent=value;tr.append(td)}document.getElementById('spaces').append(tr)}</script></html>`;
  await desktop.files.write('/home/user/project/studio.html', html);
  await desktop.open('/home/user/project/studio.html');
}
export async function checkpointDesktop(env: Bindings, desktop: Sandbox, projectId: string, runId: string, revision: number, agent: AgentId) {
  const screenshot = await desktop.screenshot();
  await artifact(env, projectId, runId, `${agent}-desktop.png`, 'desktop-preview', revision, screenshot, 'image/png');
  await artifact(env, projectId, runId, `${agent}-design.json`, 'workspace', revision, await desktop.files.read('/home/user/project/design.json'), 'application/json');
}
export async function openDesktopStream(env: Bindings, projectId: string, agent: AgentId) {
  const desktop = await connectDesktop(env, projectId, agent);
  if (!desktop) throw new HttpError(409, 'This specialist has no active computer. Start a design task; saved workstation previews remain in Files.');
  // Rotate access on every inspection. Old viewer URLs stop authenticating.
  await desktop.stream.stop();
  await desktop.stream.start({ requireAuth: true });
  const url = desktop.stream.getUrl({ authKey: desktop.stream.getAuthKey(), viewOnly: true, resize: 'scale' });
  return { url };
}
export async function idleDesktop(env: Bindings, projectId: string, agent: AgentId) {
  const row = await env.DB.prepare('SELECT lease_id FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(projectId, agent).first<{ lease_id: string }>();
  if (row) await env.BUDGET.getByName('desktop-budget').touch(row.lease_id, false);
}
