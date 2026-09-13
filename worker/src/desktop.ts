import { Sandbox } from '@e2b/desktop';
import type { AgentId, Design } from '../../shared/design';
import type { Bindings } from './types';
import { HttpError } from './security';
import { artifact, emit } from './store';
import watchTerminal from '../../scripts/watch_terminal.py';
import { z } from 'zod';
import compiler from '../../scripts/blender_compile.py';
import { limits } from '../../shared/budget';
import furniture from '../../shared/furniture.json';
import assetCompiler from '../../scripts/blender_asset.py';
import designAuthoring from '../../scripts/design_authoring.py';
import proposalGuide from '../../prompts/proposal-guide.md';
type DesktopRow = { sandbox_id: string; lease_id: string; expires_at: number };
export async function connectDesktop(env: Bindings, projectId: string, agent: AgentId, expectedLeaseId?: string): Promise<Sandbox | null> {
  if (!env.E2B_API_KEY) return null;
  const row = await env.DB.prepare('SELECT sandbox_id,lease_id,expires_at FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(projectId, agent).first<DesktopRow>();
  if (!row || row.expires_at <= Date.now() || (expectedLeaseId !== undefined && row.lease_id !== expectedLeaseId)) return null;
  try { return await Sandbox.connect(row.sandbox_id, { apiKey: env.E2B_API_KEY }); } catch { return null; }
}
export async function createDesktop(env: Bindings, projectId: string, owner: string, agent: AgentId, leaseId: string): Promise<Sandbox> {
  if (String(env.GENERATION_ENABLED)!=='true') throw new HttpError(503,'Generation is paused.');
  if (!env.E2B_API_KEY) throw new HttpError(503, 'Remote computers are not configured.');
  const budget = env.BUDGET.getByName('desktop-budget');
  const previous = await env.DB.prepare('SELECT sandbox_id,lease_id,expires_at FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(projectId,agent).first<DesktopRow>();
  // A new task gets a full bounded lease. Reusing an older machine can expire mid-commit.
  if (previous?.lease_id === leaseId) {
    const reservation = await budget.reserve(leaseId, owner, limits.leaseSeconds);
    if (!reservation.allowed) throw new HttpError(429, reservation.reason!);
    const existing = await connectDesktop(env,projectId,agent);
    if (existing) { await budget.touch(leaseId,true); return existing; }
  }
  if (previous) { const released = await releaseDesktop(env, projectId, agent, previous.lease_id); if (!released) throw new HttpError(425, 'Waiting for the previous workstation to shut down.'); }
  const reservation = await budget.reserve(leaseId, owner, limits.leaseSeconds);
  if (!reservation.allowed) throw new HttpError(reservation.reason === 'queue' ? 425 : 429, reservation.reason === 'queue' ? 'The studio’s computers are busy. Your job is waiting in the queue.' : reservation.reason!);
  let desktop: Sandbox | undefined;
  let attached = false;
  try {
    desktop = await Sandbox.create(env.E2B_TEMPLATE, { apiKey: env.E2B_API_KEY, timeoutMs: limits.leaseSeconds * 1000, resolution: [1280, 800], metadata: { project: projectId, agent, lease: leaseId } });
    attached = await budget.attach(leaseId, desktop.sandboxId);
    if (!attached) throw new Error('The workstation reservation is no longer available.');
    await env.DB.prepare('INSERT OR REPLACE INTO desktop_sessions(project_id,agent,sandbox_id,lease_id,expires_at,viewed_at) VALUES(?,?,?,?,?,?)').bind(projectId, agent, desktop.sandboxId, leaseId, Date.now()+limits.leaseSeconds * 1000, Date.now()).run();
    await desktop.commands.run('mkdir -p /home/user/project/output', { timeoutMs: 10000 });
    await desktop.files.write('/home/user/project/blender_compile.py', compiler);
    await desktop.files.write('/home/user/project/furniture.json', JSON.stringify(furniture));
    await desktop.files.write('/home/user/project/blender_asset.py', assetCompiler);
    await desktop.files.write('/home/user/project/design_authoring.py', designAuthoring);
    await desktop.files.write('/home/user/project/proposal-guide.md', proposalGuide);
    await desktop.files.write('/home/user/project/watch_terminal.py', watchTerminal);
    await desktop.commands.run('mkdir -p /home/user/project/.watch', { timeoutMs: 10000 });
    await (await desktop.commands.run('xfce4-terminal --disable-server --title="Atelier live work" --geometry=120x38 -e "python3 /home/user/project/watch_terminal.py"', { background: true, timeoutMs: 0 })).disconnect();
    await desktop.commands.run('timeout 12s sh -c \'while [ ! -f /home/user/project/.watch/ready ]; do sleep 0.2; done\'', { timeoutMs: 15000 });
    await emit(env, projectId, 'tool_completed', 'Remote workstation connected. Actual commands are visible in its live terminal.', agent);
    return desktop;
  } catch (e) {
    if (desktop && !attached) {
      // An attachment may have been rejected, or committed without its RPC
      // acknowledgement. Always try the locally-known machine directly.
      try { await Sandbox.kill(desktop.sandboxId, { apiKey: env.E2B_API_KEY }); } catch { /* The budget records the ID below and retries shutdown. */ }
    }
    try {
      // Supply the local ID even if attach failed, so shutdown can be retried
      // by the budget alarm without freeing a live machine's reserved slot.
      const released = await budget.release(leaseId, desktop?.sandboxId);
      if (released) await env.DB.prepare('DELETE FROM desktop_sessions WHERE project_id = ? AND agent = ? AND lease_id = ?').bind(projectId, agent, leaseId).run();
    } catch {
      // If the budget service itself is unavailable, keep its reservation and
      // still attempt to stop the machine whose ID only this caller may know.
      if (desktop && !attached) { try { await Sandbox.kill(desktop.sandboxId, { apiKey: env.E2B_API_KEY }); } catch { /* The bounded sandbox timeout remains in force. */ } }
    }
    throw e;
  }
}
// The terminal owns execution. Waiting here only collects its bounded result.
export async function runVisible(desktop: Sandbox, command: string, timeoutMs: number, source = '') {
  const id = crypto.randomUUID(), root = '/home/user/project/.watch';
  // Focus the real terminal window before submitting work; no decorative cursor motion.
  await desktop.commands.run("xdotool search --name 'Atelier live work' windowactivate --sync", {timeoutMs:5000}).catch(() => {});
  await desktop.files.write(`${root}/${id}.tmp`, JSON.stringify({command,timeout:Math.ceil(timeoutMs/1000),source}));
  await desktop.commands.run(`mv ${root}/${id}.tmp ${root}/${id}.request.json`, {timeoutMs:5000});
  await desktop.commands.run(`timeout ${Math.ceil(timeoutMs/1000)+5}s sh -c 'while [ ! -f ${root}/${id}.result.json ]; do sleep 0.25; done'`, {timeoutMs:timeoutMs+10000});
  return z.object({exitCode:z.number().int(),stdout:z.string().max(14000),stderr:z.string()}).parse(JSON.parse(await desktop.files.read(`${root}/${id}.result.json`)));
}
export async function releaseDesktop(env: Bindings, projectId: string, agent: AgentId, leasePrefix?: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT sandbox_id,lease_id,expires_at FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(projectId, agent).first<DesktopRow>();
  if (!row || (leasePrefix && row.lease_id !== leasePrefix && !row.lease_id.startsWith(leasePrefix.endsWith('-') ? leasePrefix : `${leasePrefix}-`))) return true;
  if (!await env.BUDGET.getByName('desktop-budget').release(row.lease_id, row.sandbox_id)) return false;
  await env.DB.prepare('DELETE FROM desktop_sessions WHERE project_id = ? AND agent = ? AND lease_id = ?').bind(projectId, agent, row.lease_id).run();
  return true;
}
export async function syncDesktop(desktop: Sandbox, design: Design, env:Bindings, projectId:string, showSource = true) {
  await desktop.files.write('/home/user/project/design.json', JSON.stringify(design, null, 2));
  await syncDesktopAssets(desktop, design, env, projectId);
  const html = `<!doctype html><html><meta charset="utf-8"><title>Atelier design workspace</title><style>body{background:#eeeee5;color:#36432f;font:16px system-ui;margin:40px}h1{font:36px Georgia}pre{background:white;padding:20px;border-radius:8px;white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #ccc}small{color:#75856c}</style><h1>Atelier / live design workspace</h1><small>Canonical file: /home/user/project/design.json</small><h2 id="title"></h2><table id="spaces"><tr><th>Space</th><th>Floor</th><th>Size (m)</th></tr></table><h2>Design source</h2><pre id="source"></pre><script>const design=${JSON.stringify(design).replaceAll('<', '\\u003c')};document.getElementById('title').textContent=design.title;document.getElementById('source').textContent=JSON.stringify(design,null,2);for(const space of design.spaces){const tr=document.createElement('tr');for(const value of [space.name,space.floor+1,space.size.join(' × ')]){const td=document.createElement('td');td.textContent=value;tr.append(td)}document.getElementById('spaces').append(tr)}</script></html>`;
  await desktop.files.write('/home/user/project/studio.html', html);
  if (showSource) await desktop.open('/home/user/project/studio.html');
}

/** Restore the trusted compiler before inspecting agent-authored files. */
export async function prepareProposalDesktop(desktop: Sandbox, design: Design, env: Bindings, projectId: string) {
  await desktop.files.write('/home/user/project/blender_compile.py', compiler);
  await desktop.files.write('/home/user/project/furniture.json', JSON.stringify(furniture));
  await syncDesktopAssets(desktop, design, env, projectId);
}

export async function prepareProposalAuthoring(desktop: Sandbox, schema: Record<string, unknown>) {
  // Reinstall on resumed leases as well as newly created workstations.
  await desktop.files.write('/home/user/project/design_authoring.py', designAuthoring);
  await desktop.files.write('/home/user/project/proposal-guide.md', proposalGuide);
  await desktop.files.write('/home/user/project/proposal-schema.json', JSON.stringify(schema));
}

async function syncDesktopAssets(desktop: Sandbox, design: Design, env: Bindings, projectId: string) {
  if(design.assets.length) await desktop.commands.run('mkdir -p /home/user/project/assets');
  for(const asset of design.assets){
    const row=await env.DB.prepare("SELECT object_key FROM artifacts WHERE id = ? AND project_id = ? AND kind = 'model-asset'").bind(asset.artifactId,projectId).first<{object_key:string}>();
    const file=row && await env.FILES.get(row.object_key);
    if(!file) throw new HttpError(409,'A versioned geometry asset is unavailable.');
    await desktop.files.write(`/home/user/project/assets/${asset.id}.glb`,await file.arrayBuffer());
  }
}
export async function checkpointDesktop(env: Bindings, desktop: Sandbox, projectId: string, runId: string, revision: number, agent: AgentId) {
  const screenshot = await desktop.screenshot();
  await artifact(env, projectId, runId, `${agent}-desktop.png`, 'desktop-preview', revision, screenshot, 'image/png');
  await artifact(env, projectId, runId, `${agent}-design.json`, 'workspace', revision, await desktop.files.read('/home/user/project/design.json'), 'application/json');
}
export async function openDesktopStream(env: Bindings, projectId: string, agent: AgentId, leaseId: string) {
  const desktop = await connectDesktop(env, projectId, agent, leaseId);
  if (!desktop) throw new HttpError(409, 'This specialist has no active computer. Start a design task; saved workstation previews remain in Files.');
  // The coordinator coalesces overlapping opens for this exact lease. A later
  // deliberate inspection still rotates access and invalidates older URLs.
  await desktop.stream.stop();
  await desktop.stream.start({ requireAuth: true });
  const current = await env.DB.prepare('SELECT lease_id,expires_at FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(projectId, agent).first<{ lease_id: string; expires_at: number }>();
  if (current?.lease_id !== leaseId || current.expires_at <= Date.now()) throw new HttpError(409, 'This computer finished while the viewer was connecting. Open the current task or its saved files.');
  const url = desktop.stream.getUrl({ authKey: desktop.stream.getAuthKey(), viewOnly: true, resize: 'scale' });
  return { url };
}
export async function idleDesktop(env: Bindings, projectId: string, agent: AgentId) {
  const row = await env.DB.prepare('SELECT lease_id FROM desktop_sessions WHERE project_id = ? AND agent = ?').bind(projectId, agent).first<{ lease_id: string }>();
  if (row) await env.BUDGET.getByName('desktop-budget').touch(row.lease_id, false);
}
