'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { SignInButton, UserButton, Show } from '@clerk/nextjs';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Box, ChevronDown, CircleHelp, Clock3, FileText, FolderOpen, Layers3, Maximize2, MessageSquare, MousePointer2, Plus, Send, Settings2, Square, Users, X, Check, RotateCcw, Footprints, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { agents, type AgentId, type Design, type Snapshot, type Project, type Brief } from '@/shared/design';
import type { ConversationTurn, InteractionRequest, InteractionResult } from '@/shared/conversation';
import { exampleDesign } from '@/shared/example';
import { api, download } from '@/lib/client';
import { connectDraft, mergeProjects, prepareDraftConnection, readLocalProjects, saveLocalSnapshot } from '@/lib/browser-drafts';
import { isCurrentSnapshot, subscribeToProject, type ProjectConnection } from '@/lib/project-feed';
import { rooms, type RoomId } from './World';
import Voice from './Voice';
import ImageStudio from './ImageStudio';
import TaskBoard from './TaskBoard';
import WorkOverview from './WorkOverview';
import PresentationCard from './PresentationCard';
import WorkstationViewer from './WorkstationViewer';
import { savedDesignEntry } from '@/lib/presentation';
import { projectActivity } from '@/lib/project-activity';
import { summarizeWork } from '@/lib/work-overview';
import { inspectionAgentForRoom } from '@/lib/workstation-view';
import ChangeTracker, { RequirementsHistory } from './ChangeTracker';
import ClarificationCard from './ClarificationCard';
import conversationStyles from './ClarificationCard.module.css';
import changeStyles from './ChangeTracker.module.css';
import IdentityObserver from './IdentityObserver';
import SiteAccount from './SiteAccount';
const sitesHosted = process.env.NEXT_PUBLIC_ATELIER_SITES_AUTH === 'true';
const World = dynamic(() => import('./World'), { ssr: false, loading: () => <div className="loading-world"><span className="brand-symbol">a</span><p>Opening your studio…</p></div> });
const initialBrief = 'Design a warm, two-storey home for four people, with a generous living room, a gaming room and a playful yellow exterior.';
type Capability = { configured: boolean; generation: boolean; render: boolean; images?: boolean; local: boolean; keyConnected: boolean; keySource?: 'saved' | 'environment' | 'none'; voice?: boolean; voiceModel?: string; message?: string };
function scrollConversationToEnd(end: HTMLDivElement | null) {
  if (!end?.closest('details')?.open) return;
  const log = end.parentElement;
  log?.scrollTo({ top: log.scrollHeight });
}
function newLocalSnapshot(name: string, brief: Brief): Snapshot {
  const now = new Date().toISOString();
  return {
    project: { id: `local_${crypto.randomUUID()}`, name, brief, revision: 0, status: 'draft', createdAt: now, updatedAt: now },
    design: null, tasks: [], events: [], artifacts: [], images: [], runs: [],
  };
}
export default function Studio({ authConfigured }: { authConfigured: boolean }) {
  const [room, setRoom] = useState<RoomId>('reception'), [mode, setMode] = useState<'office' | 'model'>('office'), [navigation, setNavigation] = useState<'orbit' | 'walk' | 'click'>('walk');
  const [nearbyRoom, setNearbyRoom] = useState<RoomId | null>('reception');
  const [desktopAgent, setDesktopAgent] = useState<AgentId | null>(null);
  const [viewerIdentity, setViewerIdentity] = useState(0);
  const walking = navigation === 'walk', clickToWalk = navigation === 'click';
  const [walkStatus, setWalkStatus] = useState('Click a clear floor to walk there.');
  const setWalking = useCallback((enabled: boolean) => setNavigation(current => enabled ? 'walk' : current === 'walk' ? 'orbit' : current), []);
  const [panel, setPanel] = useState(true), [tab, setTab] = useState<'team' | 'activity' | 'files'>('team');
  const [sample, setSample] = useState(true), [snapshot, setSnapshot] = useState<Snapshot | null>(null), [projects, setProjects] = useState<Project[]>([]);
  const [design, setDesign] = useState<Design>(exampleDesign), [selected, setSelected] = useState<string | null>(null), [cutaway, setCutaway] = useState(true);
  const [modal, setModal] = useState<'brief' | 'settings' | 'projects' | 'help' | null>(null), [brief, setBrief] = useState(initialBrief), [name, setName] = useState('A new perspective');
  const [input, setInput] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [apiKey, setApiKey] = useState('');
  const [stopping, setStopping] = useState(false);
  const [capability, setCapability] = useState<Capability | null>(null), [transcripts, setTranscripts] = useState<{id:string;text:string;createdAt:string}[]>([]);
  const [receivedTurns, setReceivedTurns] = useState<ConversationTurn[]>([]);
  const messageRetry = useRef<{ key: string; request: InteractionRequest } | null>(null);
  const inputClarification = useRef<{ id: string; version: number } | null>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const [fps,setFps]=useState(0);
  const [projectConnection, setProjectConnection] = useState<ProjectConnection>('connecting');
  const [finish,setFinish]=useState('#cc3344');
  const [compare, setCompare] = useState(false), [previous, setPrevious] = useState<Design | null>(null);
  const [fromPresentation, setFromPresentation] = useState(false);
  const captureRef = useRef<(() => string) | null>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const projectRequest = useRef(0);
  const conversationRoom = walking && mode === 'office' ? nearbyRoom : room;
  const agent: AgentId = conversationRoom && conversationRoom in agents ? conversationRoom as AgentId : 'principal';
  const inspectionAgent = inspectionAgentForRoom(room);
  const tasks = snapshot?.tasks || [], revision = snapshot?.project.revision || 0;
  const hasDesign = sample || Boolean(snapshot?.design);
  const activity = projectActivity(sample ? null : snapshot);
  const { activeTasks, activeRuns, meeting } = activity;
  const currentTasks = activity.tasks;
  const workSummary = snapshot && !sample ? summarizeWork(snapshot) : null;
  const failedRunId = activity.currentRun?.status === 'failed' ? activity.currentRun.id : null;
  const clarification = snapshot?.clarification;
  const waitingForAnswers = activity.awaitingInput;
  const continuingBrief = activity.continuingBrief;
  const conversationTurns = [...new Map([...receivedTurns, ...(snapshot?.messages || [])].map(turn => [turn.id, turn])).values()];
  const conversationEntries = [
    ...conversationTurns.map(turn => ({ id: turn.id, createdAt: turn.createdAt, turn, text: null })),
    ...transcripts.map(item => ({ ...item, turn: null })),
  ].sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  const stopRunId = activeRuns.find(run => run.status === 'in_progress')?.id || activeRuns[0]?.id || (waitingForAnswers || continuingBrief ? clarification?.runId : undefined) || activeTasks[0]?.runId;
  const notify = (message: string) => setNotice(message);
  const identityChanged=useCallback(()=>{const draft = snapshotRef.current?.project.id.startsWith('local_') ? snapshotRef.current : null;projectRequest.current++;setSnapshot(draft);setSample(!draft);setDesign(draft?.design || exampleDesign());setSelected(null);setPrevious(null);setCompare(false);setDesktopAgent(null);setViewerIdentity(value => value + 1);setTranscripts([]);setReceivedTurns([]);setInput('');messageRetry.current=null;inputClarification.current=null;setApiKey('');setNavigation('walk');setRoom('reception');setNearbyRoom('reception');setMode('office');void api<Capability>('/capabilities').then(setCapability).catch(()=>setCapability(null));},[]);
  const chooseRoom = useCallback((r: RoomId) => { setRoom(r); setNearbyRoom(r); setDesktopAgent(null); setPanel(true); setTab('team'); }, []);
  useEffect(() => { void api<Capability>('/capabilities').then(setCapability).catch(() => setCapability({ configured: false, generation: false, render: false, local: true, keyConnected: false })); }, []);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 8000); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    if (waitingForAnswers) { setPanel(true); requestAnimationFrame(() => panelScrollRef.current?.scrollTo({ top: 0 })); }
  }, [clarification?.id, waitingForAnswers]);
  useEffect(() => {
    if (!failedRunId) return;
    setPanel(true); setTab('activity');
    requestAnimationFrame(() => panelScrollRef.current?.scrollTo({ top: 0 }));
  }, [failedRunId]);
  useEffect(() => { scrollConversationToEnd(conversationEnd.current); }, [conversationEntries.length]);
  useEffect(() => {
    if (!modal && !desktopAgent) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const before = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea,select,a[href],iframe,[tabindex="0"]') || []).filter(item => item.getClientRects().length > 0);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setModal(null); setDesktopAgent(null); }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); before?.focus(); };
  }, [modal, desktopAgent]);
  async function loadProject(id: string, preserveConversation = false) {
    const request = ++projectRequest.current;
    const local = id.startsWith('local_') ? readLocalProjects().find(item => item.project.id === id) : null;
    const next = local || await api<Snapshot>(`/projects/${id}`);
    if (request !== projectRequest.current) return;
    const changedProject = snapshotRef.current?.project.id !== id;
    setSnapshot(next); setSample(false); if (next.design) setDesign(next.design); else setMode('office');
    if (changedProject) { setFromPresentation(false); setSelected(null); setReceivedTurns([]); setInput(''); messageRetry.current = null; inputClarification.current = null; }
    setCompare(false); setPrevious(null); setDesktopAgent(null); if (!preserveConversation || changedProject) setTranscripts([]);
    localStorage.setItem('atelier-last-project', id);
  }
  useEffect(() => { const id = localStorage.getItem('atelier-last-project'); if (id) void loadProject(id).catch(() => {}); }, []);
  useEffect(() => {
    if (!snapshot?.project.id || snapshot.project.id.startsWith('local_')) return;
    const id = snapshot.project.id;
    return subscribeToProject({
      projectId: id, after: snapshot.events.at(-1)?.id || 0,
      read: signal => api<Snapshot>(`/projects/${id}`, 'GET', undefined, signal),
      onConnection: setProjectConnection,
      onSnapshot: next => {
        const current = snapshotRef.current;
        if (current?.project.id !== id || !isCurrentSnapshot(next, current)) return;
        const modelChanged = next.project.revision !== current.project.revision;
        // Progress events should not rebuild the scene or reset a comparison.
        const updated = modelChanged ? next : { ...next, design: current.design };
        snapshotRef.current = updated;
        setSnapshot(updated);
        if (modelChanged) {
          if (updated.design) setDesign(updated.design);
          setPrevious(null); setCompare(false);
        }
      },
    });
  }, [snapshot?.project.id]);

  async function action(fn: () => Promise<void>) { setBusy(true); try { await fn(); } catch (e) { notify(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); } }
  async function stopWork() {
    if (!snapshot?.project.id || !stopRunId || stopping) return;
    setStopping(true);
    try { await api(`/projects/${snapshot.project.id}/runs/${stopRunId}`, 'DELETE'); await refreshProject(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Work could not be stopped. Try again.'); }
    finally { setStopping(false); }
  }
  const projectId = sample ? null : snapshot?.project.id || null;
  const localProject = Boolean(projectId?.startsWith('local_'));
  async function refreshProject() {
    if (!projectId) return;
    if (localProject) {
      const next = readLocalProjects().find(item => item.project.id === projectId);
      if (next) { setSnapshot(next); if (next.design) setDesign(next.design); }
      return;
    }
    const next = await api<Snapshot>(`/projects/${projectId}`);
    if (snapshotRef.current?.project.id !== projectId || !isCurrentSnapshot(next, snapshotRef.current)) return;
    snapshotRef.current = next;
    setSnapshot(next);
    if (next.design) setDesign(next.design);
  }
  function captureCurrentModel() {
    if (mode !== 'model' || compare || sample || !snapshot?.design || design !== snapshot.design || !captureRef.current) {
      notify('Open the current model in Design and frame your view before generating an image edit.');
      return null;
    }
    return captureRef.current();
  }
  async function createProject() {
    const b: Brief = { request: brief, summary: brief.slice(0, 2000), goals: [], constraints: [], questions: [] };
    const next = newLocalSnapshot(name.trim(), b), connection = prepareDraftConnection(next);
    try {
      const p = await api<Project>('/projects', 'POST', { name, brief: b, operationId: connection.operationId });
      await loadProject(p.id);
      notify('Project saved. Meet your team at the table, or start the team briefing.');
    } catch (error) {
      if (authConfigured || sitesHosted) throw error;
      saveLocalSnapshot(next); setSnapshot(next); setSample(false); setMode('office'); setSelected(null);
      setReceivedTurns([]); setTranscripts([]); setInput(''); messageRetry.current = null; inputClarification.current = null;
      localStorage.setItem('atelier-last-project', next.project.id);
      notify('Project saved in this browser. Live AI work needs the connected studio service.');
    }
    setModal(null);
  }
  async function createVoiceProject() {
    const request = 'Awaiting your spoken project brief.';
    const b: Brief = { request, summary: request, goals: [], constraints: [], questions: [] };
    const next = newLocalSnapshot(name.trim(), b), connection = prepareDraftConnection(next);
    try {
      const p = await api<Project>('/projects', 'POST', { name, brief: b, operationId: connection.operationId });
      await loadProject(p.id); notify('Project ready. Click Live voice at the meeting table to tell your team what you want to build.');
    } catch (error) {
      if (authConfigured || sitesHosted) throw error;
      saveLocalSnapshot(next); setSnapshot(next); setSample(false); localStorage.setItem('atelier-last-project', next.project.id);
      setReceivedTurns([]); setTranscripts([]); setInput(''); messageRetry.current = null; inputClarification.current = null;
      notify('Project saved in this browser. Voice needs the connected studio service.');
    }
    chooseRoom('reception'); setNavigation('walk'); setModal(null);
  }
  async function startRun(kind: 'generate' | 'render') {
    if (!projectId) { setModal('brief'); return; }
    if (waitingForAnswers || continuingBrief) { setPanel(true); notify(waitingForAnswers ? 'Answer the Principal’s questions to continue your briefing.' : 'Your answers are saved. The team will continue automatically.'); return; }
    if (localProject && snapshot) {
      if (kind === 'render') { notify('Start your team briefing to create the first design.'); return; }
      const localId = snapshot.project.id;
      const saved = await connectDraft(snapshot, api);
      if (snapshotRef.current?.project.id !== localId) return;
      await loadProject(saved.project.id); setTab('activity'); notify('Your draft is connected. The team briefing and any saved progress are available here.');
      return;
    }
    await api(`/projects/${projectId}/runs`, 'POST', { kind, operationId: crypto.randomUUID(), baseRevision: revision });
    await loadProject(projectId); setTab('activity'); notify(kind === 'render' ? 'Render added to the shared queue.' : 'Your principal is preparing the team briefing.');
  }
  async function postInteraction(request: InteractionRequest) {
    if (!projectId) return;
    const result = await api<InteractionResult>(`/projects/${projectId}/messages`, 'POST', request);
    if (snapshotRef.current?.project.id !== projectId) return;
    setReceivedTurns(turns => [...turns.filter(turn => turn.id !== result.operationId), {
      id: result.operationId, agent: result.intent === 'answer_clarification' || result.intent === 'brief_update' ? 'principal' : request.agent,
      instruction: request.instruction, reply: result.reply, intent: result.intent, createdAt: new Date().toISOString(),
    }]);
    setPanel(true);
    if (result.intent === 'change') {
      setTab('activity');
      requestAnimationFrame(() => panelScrollRef.current?.scrollTo({ top: 0 }));
    }
    // The reply is already received. A failed refresh must not look like a failed
    // submission and encourage a second operation; the event stream also refreshes it.
    await refreshProject().catch(() => notify('Your message was saved. Project activity will refresh when the connection returns.'));
  }
  async function send() {
    if (!projectId) { notify('Create a project to brief or steer your team. The current model is a sample.'); return; }
    if (localProject) { notify('Your draft is saved. Choose Connect & start team to reconnect it before messaging.'); return; }
    if (!input.trim()) return;
    const instruction = input, requestedAgent = agent, elementId = selected;
    const context = inputClarification.current || (waitingForAnswers && clarification ? { id: clarification.id, version: clarification.version } : null);
    // Server updates during a lost response must not generate a new operation.
    // Editing the text or changing the selected agent/element creates a new request.
    const key = JSON.stringify({ projectId, instruction, agent: requestedAgent, elementId });
    const request: InteractionRequest = messageRetry.current?.key === key ? messageRetry.current.request : {
      instruction, agent: requestedAgent, elementId, baseRevision: revision, operationId: crypto.randomUUID(), intent: 'auto',
      ...(context ? { clarificationId: context.id, clarificationVersion: context.version } : {}),
    };
    messageRetry.current = { key, request }; inputClarification.current = context;
    await postInteraction(request);
    if (snapshotRef.current?.project.id !== projectId) return;
    // The user can compose another message while this one is being answered.
    // Preserve that draft's question binding and retry state when the reply arrives.
    if (messageRetry.current?.request === request) {
      messageRetry.current = null; inputClarification.current = null;
      setInput(current => current === instruction ? '' : current);
    }
  }
  async function exportModel() { const { exportGLB } = await import('@/lib/export'); const output=compare && previous ? previous : design; download(new Blob([await exportGLB(output,compare ? revision-1 : revision,projectId)], { type: 'model/gltf-binary' }), `${output.title}.glb`); }
  async function comparison() {
    if (!projectId || revision < 2) return notify('A second saved design revision is needed for comparison.');
    if (!previous) setPrevious(await api<Design>(`/projects/${projectId}/revisions/${revision - 1}`)); setCompare(v => !v); setMode('model');
  }
  function openWorkstation(target: AgentId) {
    setDesktopAgent(target);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function viewLatestDesign() {
    if (!snapshot?.design) return;
    setDesign(snapshot.design); setCompare(false); setPrevious(null); setMode('model'); setNavigation('orbit'); setFromPresentation(false);
  }
  function enterPresentation() {
    const entry = savedDesignEntry(snapshotRef.current);
    if (!entry) { notify('Your presentation opens when the first design is saved.'); return; }
    setDesign(entry.design); setCompare(false); setPrevious(null); setSelected(null);
    setMode(entry.mode); setNavigation(entry.navigation); setFromPresentation(true);
    setDesktopAgent(null); setModal(null);
    (document.activeElement as HTMLElement | null)?.blur();
  }
  const displayed = compare && previous ? previous : design;
  return <main className="studio-shell">
    {authConfigured && <IdentityObserver onChange={identityChanged}/>}
    <header className="topbar"><a className="brand" href="/" aria-label="Atelier home"><span className="brand-symbol">a</span><span>atelier<span className="brand-period">.</span></span></a><div className="header-divider" /><button className="project-switch" onClick={() => void action(async () => { const drafts = readLocalProjects(); try { setProjects(mergeProjects(await api<Project[]>('/projects'), drafts)); } catch (error) { if (!drafts.length && (authConfigured || sitesHosted)) throw error; setProjects(mergeProjects([], drafts)); notify('Showing browser drafts. Reconnect the studio to load shared projects.'); } setModal('projects'); })}><span>{sample ? 'The Courtyard House' : snapshot?.project.name}</span><ChevronDown size={14} /></button><span className="project-label">{sample ? 'SAMPLE PROJECT' : localProject ? 'BROWSER DRAFT' : `REVISION ${revision.toString().padStart(2, '0')}`}</span><div className="header-spacer" /><button className="icon-button" aria-label="Help" onClick={() => setModal('help')}><CircleHelp size={19} /></button><button className="icon-button" aria-label="Settings" onClick={() => setModal('settings')}><Settings2 size={19} /></button>{sitesHosted ? <SiteAccount /> : authConfigured ? <><Show when="signed-out"><SignInButton mode="modal"><button className="button subtle">Sign in</button></SignInButton></Show><Show when="signed-in"><UserButton /></Show></> : <span className="profile-avatar" title="Local studio preview">A</span>}</header>
    <div className="workspace">
      <nav className="rail" aria-label="Studio navigation"><button className={`rail-button ${mode === 'office' ? 'active' : ''}`} onClick={() => { setMode('office'); setNavigation('walk'); }} title="Studio"><Layers3 size={22} /><span>Studio</span></button><button className={`rail-button ${mode === 'model' ? 'active' : ''}`} onClick={() => { if (!hasDesign) return notify("Your saved design will appear here after the first design run."); setMode('model'); setWalking(false); }} title="Design"><Box size={22} /><span>Design</span></button><button className="rail-button" onClick={() => { setPanel(true); setTab('files'); }} title="Files"><FolderOpen size={22} /><span>Files</span></button><div className="rail-bottom"><button className="rail-button" onClick={() => setModal('brief')} title="New project"><Plus size={22} /><span>New</span></button></div></nav>
      <section className="scene-area" aria-label="Interactive architecture studio">
        <div className="scene-top"><div><div className="eyebrow">YOUR ARCHITECTURE STUDIO</div><h1>{mode === 'office' ? 'A space for what’s next.' : displayed.title}</h1><p>{mode === 'office' ? 'A shared table. Four perspectives. Your vision.' : `${displayed.floors} ${displayed.floors === 1 ? 'floor' : 'floors'} · ${displayed.spaces.length} spaces · ${compare ? 'Previous revision' : 'Current design'}`}</p></div><button className="view-pill" onClick={() => setPanel(v => !v)}>{panel ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}{panel ? 'Hide panel' : 'Show panel'}</button></div>
        <div className="world-canvas"><World onPresentation={enterPresentation} meeting={meeting} onProximity={setNearbyRoom} onWorkstation={target => void openWorkstation(target)} onFrameRate={setFps} previews={(Object.keys(agents) as AgentId[]).flatMap(agent=>{const file=snapshot?.artifacts.find(a=>a.kind==='desktop-preview' && a.name.startsWith(agent));return file && projectId ? [{agent,url:`/api/studio/projects/${projectId}/artifacts/${file.id}?inline=1`,createdAt:file.createdAt}] : [];})} projectId={projectId} room={room} mode={mode} walking={walking} clickToWalk={clickToWalk} paused={Boolean(modal || desktopAgent)} onWalkStatus={setWalkStatus} design={mode === 'office' && !sample ? snapshot?.design || null : hasDesign ? displayed : null} selected={selected} onSelect={setSelected} onRoom={chooseRoom} tasks={activity.officeTasks} onUnlock={() => setWalking(false)} cutaway={cutaway} revision={revision} captureRef={captureRef} /></div>
        {sample && !clickToWalk && <div className="sample-caption"><span className="sample-dot" />Explore the sample studio<span className="caption-separator">/</span><span className="sample-detail">Connect your team to begin live work</span></div>}
        {clickToWalk && <div className="walk-feedback" role="status">{walkStatus}</div>}
        {walking && <div className="crosshair">+</div>}
        <div className="scene-bottom"><div className="view-controls">{mode === 'model' && fromPresentation && <button onClick={() => { chooseRoom('presentation'); setMode('office'); setNavigation('walk'); setFromPresentation(false); }}><ArrowLeft size={16} />Return to exhibit</button>}<button className={navigation === 'orbit' ? 'selected' : ''} onClick={() => setNavigation('orbit')}><MousePointer2 size={16} />Orbit</button><button id="click-to-walk" className={clickToWalk ? 'selected' : ''} onClick={() => setNavigation('click')}><Footprints size={17} />Click to walk</button><button id="enter-walk" className={walking ? 'selected' : ''} onClick={() => { setWalking(true); (document.activeElement as HTMLElement | null)?.blur(); const canvas = document.querySelector('canvas'); void canvas?.requestPointerLock()?.catch(() => notify('Mouse capture is unavailable in this browser. Drag the scene to look around, and use WASD to walk.')); }}><Footprints size={17} />Walk inside</button>{mode === 'model' && <button className={cutaway ? 'selected' : ''} onClick={() => setCutaway(v => !v)}><Layers3 size={16} />Cutaway</button>}</div><span className="navigation-hint">{walking ? 'W A S D  move · E interact · Esc release' : clickToWalk ? 'Click floor · Drag to orbit · Esc stop' : 'Drag to orbit · Scroll to zoom'}</span><button className="icon-button" title="Save viewport image" onClick={() => { const url = captureRef.current?.(); if (url) { const a = document.createElement('a'); a.href = url; a.download = 'atelier-viewport.png'; a.click(); } }}><Maximize2 size={18} /></button></div>
        <div className="room-strip">{rooms.map((r, i) => <button key={r.id} className={room === r.id ? 'selected' : ''} onClick={() => { chooseRoom(r.id); setMode('office'); }}><span>0{i+1}</span>{r.label}</button>)}</div>
      </section>
      {<aside className="side-panel" style={{display: panel ? undefined : 'none'}}><div className="panel-heading"><div><span className="eyebrow">YOUR SHARED PROJECT</span><h2>Project workspace</h2></div></div><WorkOverview snapshot={sample ? null : snapshot} connection={projectConnection} viewingLatest={mode === 'model' && !compare} onViewDesign={viewLatestDesign} onActivity={() => { setTab('activity'); panelScrollRef.current?.scrollTo({ top: 0 }); }} /><div className="tabs" role="tablist">{(['team', 'activity', 'files'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>{t === 'team' ? <Users size={15} /> : t === 'activity' ? <Clock3 size={15} /> : <FolderOpen size={15} />}{t[0].toUpperCase()+t.slice(1)}</button>)}</div>
      <div className="panel-scroll" ref={panelScrollRef}>
        {room === 'presentation' && mode === 'office' && <PresentationCard snapshot={sample ? null : snapshot} onEnter={enterPresentation} />}
        {clarification && (waitingForAnswers || continuingBrief) && <ClarificationCard
          key={`${projectId}:${clarification.id}`} clarification={clarification} revision={revision} busy={busy}
          onSubmit={async request => { setBusy(true); try { await postInteraction(request); } finally { setBusy(false); } }}
        />}
        {tab === 'team' && <><div className="team-list">{(Object.keys(agents) as AgentId[]).map(id => {
        const a = agents[id], agentTasks = currentTasks.filter(t => t.agent === id), task = agentTasks.find(t => t.status === 'in_progress') || agentTasks.find(t => t.status !== 'completed') || agentTasks[0];
        return <button key={id} className={`agent-card ${inspectionAgent === id ? 'selected' : ''}`} onClick={() => chooseRoom(id)}><span className="agent-avatar" style={{ background: a.color }}>{a.initials}</span><span className="agent-copy"><strong>{a.name}</strong><span>{a.role}</span></span><span className={`agent-status ${task?.status === 'in_progress' ? 'working' : ''}`}>{task ? task.status.replaceAll('_', ' ') : failedRunId ? 'Not started' : activeRuns.length ? 'Waiting for task' : 'Available'}</span><ArrowRight size={14} /></button>;
      })}</div><div className="selected-agent"><div className="section-label">{agents[inspectionAgent].name.split(' ')[0].toUpperCase()}’S WORKSPACE</div><h3>{agents[inspectionAgent].description}</h3><p>{activity.officeTasks.find(t => t.agent === inspectionAgent && t.status === 'in_progress')?.detail || (failedRunId ? 'The run failed. Review Activity for saved progress and failure details.' : 'Bring an idea, ask a question, or talk through a change.')}</p><button className="text-button" onClick={() => void openWorkstation(inspectionAgent)}><Maximize2 size={14} />Open agent computer<ArrowRight size={14} /></button><p>Computer view shows tools and saved design data. Use View latest design to explore the model.</p></div><div className="brief-card"><span className="section-label">PROJECT BRIEF</span><p>{sample ? 'A light-filled home where natural materials and generous spaces bring everyday life together.' : snapshot?.project.brief.summary}</p><button className="text-button" onClick={() => { if (snapshot) { setBrief(snapshot.project.brief.request); setName(snapshot.project.name); } setModal('brief'); }}><FileText size={14} />{sample ? 'Write your brief' : 'View & edit brief'}<ArrowRight size={14} /></button></div></>}
      {tab === 'activity' && <div className="activity-list">{projectId && <ChangeTracker projectId={projectId} changes={snapshot?.changes || []} design={snapshot?.design || null} activeRunId={activeRuns.find(run => run.status === 'in_progress')?.id || activeRuns[0]?.id || null} />}<RequirementsHistory requirements={snapshot?.requirements} /><TaskBoard tasks={currentTasks} />{!snapshot?.events.length && <div className="empty-state"><Clock3 size={24} /><h3>A quiet moment before we begin.</h3><p>Real task progress, decisions, and tool results will appear here once your team starts working.</p><button className="button" onClick={() => setModal('brief')}>Brief your team<ArrowRight size={15} /></button></div>}{snapshot?.events.slice().reverse().map(e => <article className="event" key={e.id}><span className="event-marker" /><div><span className="event-meta">{e.agent ? agents[e.agent].role : 'Studio'} · {new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><p>{e.message}</p></div></article>)}</div>}
      {tab === 'files' && <div className="files-panel">{projectId && !localProject && <ImageStudio key={projectId} projectId={projectId} revision={revision} hasDesign={Boolean(snapshot?.design)} selectedConceptId={snapshot?.project.selectedConceptId || null} images={snapshot?.images || []} runs={snapshot?.runs || []} imageEnabled={Boolean(capability?.images)} generationEnabled={Boolean(capability?.generation)} captureView={captureCurrentModel} onRefresh={refreshProject} onError={notify} />}<span className="section-label">{sample ? 'SAMPLE DESIGN' : 'CURRENT DESIGN'} · REV {revision}</span>{hasDesign ? <><button className="file-row" onClick={() => download(JSON.stringify(displayed, null, 2), 'design.json')}><FileText size={20} /><span><strong>Canonical design</strong><small>JSON · editable source</small></span><ArrowDownToLine size={16} /></button><button className="file-row" onClick={() => void action(exportModel)}><Box size={20} /><span><strong>Building model</strong><small>GLB · browser geometry</small></span><ArrowDownToLine size={16} /></button>{Array.from({ length: displayed.floors }, (_, floor) => <button key={floor} className="file-row" onClick={() => void action(async () => { const { floorPlanSVG } = await import('@/lib/export'); download(floorPlanSVG(displayed, floor), `floor-${floor+1}.svg`, 'image/svg+xml'); })}><Layers3 size={20} /><span><strong>Floor {floor+1} plan</strong><small>SVG · spatial arrangement</small></span><ArrowDownToLine size={16} /></button>)}</> : <div className="empty-state"><Box size={24}/><h3>Your design starts with a brief.</h3><p>{localProject ? 'Your brief is saved in this browser. Connect the studio service to generate the first design.' : 'Generated models and floor plans will be saved here after your first design run.'}</p></div>}{snapshot?.artifacts.map(a => <a className="file-row" key={a.id} href={`/api/studio/projects/${projectId}/artifacts/${a.id}`} download><FileText size={20} /><span><strong>{a.name}</strong><small>{a.kind} · rev {a.revision}{a.revision !== revision ? ' · earlier design' : ''}</small></span><ArrowDownToLine size={16} /></a>)}<button className="button subtle full" disabled={localProject} onClick={() => void action(comparison)}><RotateCcw size={15} />{compare ? 'Return to current design' : 'Compare previous revision'}</button><button className="button full" disabled={busy || !hasDesign || sample || localProject} onClick={() => void action(() => startRun('render'))}>Request Blender render<ArrowRight size={15} /></button><p className="fine-print">Final renders use a queued remote computer. Completed images and Blender source appear here.</p></div>}
      {selected && mode === 'model' && <div className="selection-card"><span className="section-label">SELECTED ELEMENT</span><strong>{design.elements.find(e => e.id === selected)?.name}</strong><button className="text-button" onClick={() => { setInput(`Change ${design.elements.find(e => e.id === selected)?.name} to red.`); chooseRoom('designer'); }}>Ask Sofia to change this<ArrowRight size={14} /></button></div>}</div>
      <div className="composer">
        <div className="composer-label"><MessageSquare size={14} /><span>{!conversationRoom ? 'Message Alex · mic paused' : conversationRoom === 'reception' ? 'Message Alex · meeting table' : `Message ${agents[agent].name.split(' ')[0]} · voice nearby`}</span><Voice key={projectId} projectId={projectId} agent={agent} meeting={conversationRoom === 'reception'} inRange={Boolean(conversationRoom)} elementId={selected} onTranscript={text => setTranscripts(items => [...items, { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }])} onError={notify} /></div>
        {selected && <div className={changeStyles.composerScope}><span>Attached: {design.elements.find(element => element.id === selected)?.name || selected}<small>This element is included with your next message.</small></span><button type="button" onClick={() => setSelected(null)} aria-label="Clear selected element"><X size={13} />Clear</button></div>}
        {conversationEntries.length > 0 && <details className={conversationStyles.history} onToggle={() => scrollConversationToEnd(conversationEnd.current)}>
          <summary className={conversationStyles.historyToggle}>
            <ChevronDown size={14} className={conversationStyles.historyChevron} aria-hidden="true" />
            <span>Chat history</span>
            <span className={conversationStyles.historyCount}>{conversationEntries.length} {conversationEntries.length === 1 ? 'entry' : 'entries'}</span>
          </summary>
          <div className={conversationStyles.conversation} role="log" aria-label="Project conversation" aria-live="polite" aria-relevant="additions text">
            {conversationEntries.map(item => <article className={conversationStyles.turn} key={item.id}>{item.turn ? <><p><strong>You → {agents[item.turn.agent].name}</strong><br />{item.turn.instruction}</p><p><strong>{agents[item.turn.agent].name}</strong><br />{item.turn.reply}</p></> : <p>{item.text}</p>}</article>)}
            <div ref={conversationEnd} />
          </div>
        </details>}
        <form onSubmit={event => { event.preventDefault(); void action(send); }}>
          <textarea aria-label="Message your agent" value={input} maxLength={4000} onChange={event => {
            if (!input.trim() || messageRetry.current) {
              inputClarification.current = waitingForAnswers && clarification ? { id: clarification.id, version: clarification.version } : null;
              messageRetry.current = null;
            }
            setInput(event.target.value);
          }} placeholder={waitingForAnswers ? 'Answer the Principal or ask a question…' : 'Ask a question, add an idea, or request a change…'} rows={2} />
          <div className="composer-bottom"><span>{waitingForAnswers ? 'Your answers continue the briefing.' : 'Ask questions or steer your design.'}</span><button aria-label="Send message" type="submit" disabled={busy || !input.trim()}><Send size={16} /></button></div>
        </form>
      </div></aside>}
    </div>
    <footer className="statusbar"><span className="status-location"><span className="status-dot" />{rooms.find(r => r.id === conversationRoom)?.label || 'Studio corridor'}</span><span>{waitingForAnswers ? 'Principal is waiting for your answers' : continuingBrief ? 'Brief saved · team continuation queued' : activeTasks.length ? `${activeTasks.length} ${activeTasks.length === 1 ? 'agent' : 'agents'} working` : workSummary?.title || 'Sample studio · no work running'}</span><span className="footer-spacer" />{projectId && stopRunId && <button className="text-button" disabled={stopping} onClick={() => void stopWork()}><Square size={11} />{stopping ? 'Stopping…' : 'Stop work'}</button>}<span>{sample ? 'Sample · no AI activity' : 'Saved to your project'}</span><button className="footer-cta" disabled={busy || waitingForAnswers || continuingBrief || activeRuns.length > 0} onClick={() => void action(() => startRun('generate'))}>{waitingForAnswers ? 'Answer Principal above' : continuingBrief ? 'Team will continue' : activeRuns.length ? 'Team briefing underway' : localProject ? 'Connect & start team' : failedRunId && activity.currentRun?.kind === 'generate' ? 'Retry team briefing' : projectId ? 'Start team briefing' : 'Start your project'}<ArrowRight size={16} /></button></footer>
    {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}
    <WorkstationViewer key={`${viewerIdentity}:${projectId || 'sample'}`} snapshot={sample ? null : snapshot} agent={desktopAgent} onAgent={setDesktopAgent} onClose={() => setDesktopAgent(null)} onStop={stopRunId ? () => void stopWork() : undefined} stopping={stopping} onDesign={snapshot?.design ? () => { setDesktopAgent(null); viewLatestDesign(); } : undefined} />
    {modal && <div className="modal-backdrop" onClick={() => setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-label={modal === 'brief' ? 'Project brief' : modal} onClick={e => e.stopPropagation()}><button className="modal-close icon-button" aria-label="Close dialog" onClick={() => setModal(null)}><X size={20} /></button>
      {modal === 'brief' && <><span className="eyebrow">EVERY GOOD BUILDING STARTS HERE</span><h2>Tell us what you imagine.</h2><p>Your principal will help turn the idea into a shared brief.</p><label>Project name<input value={name} onChange={e => setName(e.target.value)} maxLength={120} /></label><label>Your brief<textarea rows={6} value={brief} onChange={e => setBrief(e.target.value)} maxLength={8000} /></label><p className="fine-print">Any building type · Up to 4 floors and 40 enclosed spaces</p><div className="modal-actions"><button className="button subtle" disabled={busy || !name.trim()} onClick={() => void action(createVoiceProject)}>Use voice to brief</button>{projectId && <button className="button subtle" disabled={busy} onClick={() => void action(async () => { const updatedBrief: Brief = { request: brief, summary: brief.slice(0, 2000), goals: [], constraints: [], questions: [] }; if (localProject && snapshot) { const next: Snapshot = { ...snapshot, project: { ...snapshot.project, name: name.trim(), brief: updatedBrief, updatedAt: new Date().toISOString() } }; saveLocalSnapshot(next); setSnapshot(next); notify('Brief updated in this browser.'); } else { await api(`/projects/${projectId}/brief`, 'PUT', { name, brief: updatedBrief }); await loadProject(projectId); } setModal(null); })}>Save existing brief</button>}<button className="button" disabled={busy || brief.length < 10 || !name.trim()} onClick={() => void action(createProject)}>{busy ? 'Saving…' : 'Create project'}<ArrowRight size={16} /></button></div></>}
      {modal === 'settings' && <><span className="eyebrow">YOUR CONNECTION</span><h2>Your AI connection.</h2><p>Use the studio’s configured connection or add your own OpenAI API key for design work, image concepts and GPT-Live 1 voice.</p><div className="connection-status">{capability?.keyConnected ? <Check size={17} /> : <Settings2 size={17} />}{capability?.keySource === 'environment' ? 'Studio connection ready' : capability?.keyConnected ? 'Personal OpenAI key connected' : 'No OpenAI key connected'}</div><label>OpenAI API key<input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…" /></label><p className="fine-print">Your personal key is encrypted on the server and its usage is billed to your OpenAI account. Removing it restores the studio connection, if configured.</p><div className="modal-actions"><button className="button subtle" disabled={busy} onClick={() => void action(async () => { await api('/credentials', 'DELETE'); setCapability(await api('/capabilities')); notify('Saved key removed.'); })}>Remove key</button><button className="button" disabled={busy || !apiKey.trim()} onClick={() => void action(async () => { await api('/credentials', 'PUT', { apiKey }); setApiKey(''); setCapability(await api('/capabilities')); notify('Your key is connected.'); })}>Save connection<ArrowRight size={16} /></button></div><p className="fine-print">{capability?.voice && capability.keyConnected ? 'GPT-Live 1 voice is ready. Choose a project and click Live voice.' : capability?.voice ? 'Add your key to enable GPT-Live 1 voice.' : 'Live voice is not enabled for this studio.'}</p><p className="fine-print">{capability?.images ? 'Image concepts and edits are ready in Files. Image generation works independently of the 3D agent workstations.' : 'Image generation is unavailable for this connection.'}</p><div className="setup-note">{capability?.configured ? capability.generation ? '3D design generation is available.' : '3D design generation is paused until the deployment checks pass.' : sitesHosted ? 'Sign in with ChatGPT to connect your studio.' : 'Local preview is available. Start the studio service to begin live work.'}</div></>}
      {modal === 'projects' && <><span className="eyebrow">YOUR WORK</span><h2>Projects in the studio.</h2>{projects.length ? projects.map(p => <button className="file-row" key={p.id} onClick={() => void action(async () => { await loadProject(p.id); setModal(null); })}><FolderOpen size={20} /><span><strong>{p.name}</strong><small>{p.id.startsWith('local_') ? 'Browser draft · reconnect to continue' : `Revision ${p.revision} · ${p.status}`}</small></span><ArrowRight size={17} /></button>) : <p>No saved projects yet. Bring your first idea to the table.</p>}<button className="button full" onClick={() => { setName('A new perspective'); setBrief(''); setModal('brief'); }}><Plus size={16} />New project</button></>}
      {modal === 'help' && <><span className="eyebrow">MAKE YOURSELF AT HOME</span><h2>A little orientation.</h2><p>Choose Orbit to inspect and select design elements, Click to walk to guide your avatar from above, or Walk inside to explore at eye level.</p><div className="help-grid"><kbd>Click floor</kbd><span>In Click to walk, follow a clear route to that spot</span><kbd>Drag</kbd><span>Orbit the camera in Orbit or Click to walk</span><kbd>W A S D</kbd><span>Move in Walk inside mode</span><kbd>Mouse</kbd><span>Look around</span><kbd>E</kbd><span>Interact with the closest room</span><kbd>Esc</kbd><span>Stop click walking or release the mouse</span></div><p>Choose a specialist to talk with them. Select a building element before asking for a change to give your agent precise context.</p><p className="fine-print">The sample project contains no simulated agent work. Live tools, desktops, and voice require configured services.</p></>}
    </section></div>}
  </main>;
}
