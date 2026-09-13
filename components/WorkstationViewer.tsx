'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, Check, Clock3, FileText, FolderOpen, LoaderCircle, Maximize2, Minimize2, Monitor, RefreshCw, Square, Users, X } from 'lucide-react';
import { agents, type AgentId, type Artifact, type Snapshot, type StudioEvent } from '@/shared/design';
import { api } from '@/lib/client';
import { workstationView } from '@/lib/workstation-view';
import { createWorkstationSessions, workstationKey } from '@/lib/workstation-session';
import styles from './WorkstationViewer.module.css';

type View = 'desktop' | 'activity' | 'output' | 'meeting';
type Props = { snapshot: Snapshot | null; agent: AgentId | null; onAgent: (agent: AgentId) => void; onClose: () => void; onStop?: () => void; stopping?: boolean; onDesign?: () => void };
const people = Object.keys(agents) as AgentId[];
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fileSize = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function EventList({ events }: { events: StudioEvent[] }) {
  return <ol className={styles.events}>{events.map(event => <li key={event.id} data-error={event.type === 'error'}>
    <span className={styles.eventDot} /><div><div className={styles.eventMeta}>{event.agent ? agents[event.agent].name.split(' ')[0] : 'Team'} · {event.type.replaceAll('_', ' ')}<time dateTime={event.createdAt}>{time(event.createdAt)}</time></div><p>{event.message}</p></div>
  </li>)}</ol>;
}
function FileList({ files, projectId }: { files: Artifact[]; projectId: string }) {
  return <div className={styles.files}>{files.map(file => <a key={file.id} href={`/api/studio/projects/${projectId}/artifacts/${file.id}`} download>
    <span className={styles.fileIcon}><FileText size={18} /></span><span><strong>{file.name}</strong><small>{file.kind.replaceAll('-', ' ')} · Revision {file.revision} · {fileSize(file.size)}</small></span><ArrowDownToLine size={16} />
  </a>)}</div>;
}

export default function WorkstationViewer({ snapshot, agent, onAgent, onClose, onStop, stopping, onDesign }: Props) {
  const [manager] = useState(() => createWorkstationSessions({ connect: (projectId, target, signal) => api<{ url: string }>(`/projects/${projectId}/desktop/${target}`, 'POST', {}, signal) }));
  const sessions = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  const [view, setView] = useState<View>('desktop');
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const [slow, setSlow] = useState<number | null>(null);
  const [badPreview, setBadPreview] = useState<string | null>(null);
  const lastAgent = useRef<AgentId>('principal');
  const wasOpen = useRef(false);
  if (agent) lastAgent.current = agent;
  const selected = agent || lastAgent.current;
  const person = agents[selected];
  const projectId = snapshot?.project.id;
  const work = workstationView(snapshot, selected);
  const spec = projectId && work.live ? { projectId, agent: selected, identity: work.identity } : null;
  const session = spec ? sessions.find(item => item.key === workstationKey(spec) && item.identity === spec.identity) : undefined;
  const displayed = session?.status === 'ready' && loaded[session.generation];
  const connecting = work.live && (!session || session.status === 'connecting' || (session.status === 'ready' && !displayed));
  const files = [...(snapshot?.artifacts || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const preview = work.preview && work.preview.id !== badPreview ? work.preview : null;
  const retry = () => { if (spec) manager.ensure(spec, true); };

  useEffect(() => () => manager.clear(), [manager]);
  useEffect(() => {
    if (agent && !wasOpen.current) setView('desktop');
    wasOpen.current = Boolean(agent);
    if (agent) return;
    manager.cancelPending();
    // A brief close/reopen keeps a healthy screen, but never retains a hidden
    // authenticated desktop indefinitely or heartbeats an unwatched machine.
    const timer = setTimeout(() => manager.clear(), 60_000);
    return () => clearTimeout(timer);
  }, [agent, manager]);
  useEffect(() => {
    for (const cached of sessions) {
      const next = workstationView(snapshot, cached.agent);
      if (cached.projectId !== projectId || !next.live || next.identity !== cached.identity) {
        if (cached.status !== 'error' || cached.url) manager.invalidate(cached.key, 'This task’s computer has finished. Saved activity and files remain available.', cached.generation);
      }
    }
  }, [snapshot, projectId, sessions, manager]);
  useEffect(() => {
    if (agent && view === 'desktop' && projectId && work.live) manager.ensure({ projectId, agent, identity: work.identity });
  }, [agent, view, projectId, work.live, work.identity, manager]);
  useEffect(() => {
    if (!agent || !session || session.status !== 'ready') return;
    const { key, generation } = session;
    const controller = new AbortController();
    let checking = false;
    const heartbeat = async () => {
      if (checking) return;
      checking = true;
      try { await api(`/projects/${session.projectId}/desktop/${session.agent}/heartbeat`, 'POST', {}, controller.signal); }
      catch { if (!controller.signal.aborted) manager.invalidate(key, 'The live computer is no longer available. Try reconnecting, or open its saved activity and files.', generation); }
      finally { checking = false; }
    };
    void heartbeat();
    const timer = setInterval(() => void heartbeat(), 30_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [agent, session?.generation, session?.status, manager]);
  useEffect(() => {
    if (!session || session.status !== 'ready' || displayed) return;
    const timer = setTimeout(() => setSlow(session.generation), 15_000);
    return () => clearTimeout(timer);
  }, [session?.generation, session?.status, displayed]);
  useEffect(() => {
    // Keep a recently visited screen through quick switches, then release its
    // iframe. Only the selected agent receives a heartbeat.
    const timers = sessions.filter(item => item.agent !== agent && item.status !== 'error').map(item =>
      setTimeout(() => manager.discard(item.key, item.generation), 30_000));
    return () => timers.forEach(clearTimeout);
  }, [agent, sessions, manager]);

  return <div className={styles.backdrop} hidden={!agent} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`${styles.dialog} ${expanded ? styles.expanded : ''}`} role={agent ? 'dialog' : undefined} aria-modal={agent ? true : undefined} aria-labelledby="workstation-heading">
      <header className={styles.header}>
        <span className={styles.brand}>a</span><div><span className={styles.eyebrow}>ATELIER / TEAM WORKSPACE</span><h2 id="workstation-heading">{view === 'meeting' ? 'Around the meeting table' : `${person.name.split(' ')[0]}’s workspace`}</h2></div>
        <div className={styles.headerActions}>{onStop && <button className={styles.stop} disabled={stopping} onClick={onStop}><Square size={12} />{stopping ? 'Stopping…' : 'Stop work'}</button>}<button className={styles.iconButton} aria-label={expanded ? 'Restore workspace size' : 'Expand workspace'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button><button className={styles.iconButton} aria-label="Close workspace" onClick={onClose}><X size={21} /></button></div>
      </header>
      <div className={styles.layout}>
        <nav className={styles.people} aria-label="Team workspaces"><span className={styles.eyebrow}>YOUR TEAM</span>{people.map(id => {
          const item = workstationView(snapshot, id);
          return <button key={id} aria-pressed={selected === id && view !== 'meeting'} onClick={() => { onAgent(id); if (view === 'meeting') setView('desktop'); }}><span className={styles.avatar} style={{ background: agents[id].color }}>{agents[id].name[0]}</span><span><strong>{agents[id].name.split(' ')[0]}</strong><small>{item.live ? 'At work' : item.task?.status === 'failed' ? 'Work stopped' : item.task?.status === 'completed' ? 'Finished' : 'At desk'}</small></span>{item.live && <i className={styles.liveDot} />}</button>;
        })}<button className={styles.meetingButton} aria-pressed={view === 'meeting'} onClick={() => setView('meeting')}><Users size={19} /><span><strong>Meeting table</strong><small>{work.meeting ? 'In session' : 'Brief & decisions'}</small></span></button><div className={styles.project}><span className={styles.eyebrow}>PROJECT</span><p>{snapshot?.project.name || 'Your next idea'}</p><small>{snapshot?.design ? `Saved revision ${snapshot.project.revision}` : 'No model saved yet'}</small>{snapshot?.design && onDesign && <button onClick={onDesign}>View design<ArrowRight size={14} /></button>}</div></nav>
        <main className={styles.main}>
          {view !== 'meeting' && <><div className={styles.context}><div><span className={styles.eyebrow}>{person.role}</span><p>{work.task?.title || 'Waiting for the team’s next task'}</p></div><span className={styles.status} data-status={work.task?.status || 'idle'}>{work.live ? <i className={styles.liveDot} /> : work.task?.status === 'completed' ? <Check size={12} /> : <Clock3 size={12} />}{work.status}</span></div>
          <div className={styles.tabs} role="tablist" aria-label="Workspace content">{([{ id: 'desktop', label: 'Screen', icon: Monitor }, { id: 'activity', label: 'Activity', icon: Activity }, { id: 'output', label: 'Files', icon: FolderOpen }] as const).map(item => <button key={item.id} id={`workspace-tab-${item.id}`} role="tab" aria-selected={view === item.id} aria-controls={`workspace-panel-${item.id}`} onClick={() => setView(item.id)}><item.icon size={15} />{item.label}{item.id === 'output' && files.length > 0 && <span>{files.length}</span>}</button>)}<span className={styles.tabsHint}>Actual work, as it happens</span></div></>}
          <div className={styles.screenPanel} id="workspace-panel-desktop" role="tabpanel" aria-labelledby="workspace-tab-desktop" hidden={view !== 'desktop'}>
            <div className={styles.screenArea}>
              <div className={styles.screenToolbar}><span><Monitor size={13} />{person.name.split(' ')[0]}’s computer</span><span>{displayed ? 'Screen connected' : connecting ? 'Opening screen…' : preview ? 'Saved preview' : 'No live screen'}</span>{work.live && <button onClick={retry} disabled={session?.status === 'connecting'} aria-label={`Reconnect ${person.name.split(' ')[0]}’s screen`}><RefreshCw size={13} />Reconnect</button>}</div>
              <div className={styles.screen} aria-busy={connecting}>
                {sessions.filter(item => item.status === 'ready' && item.url).map(item => <iframe key={`${item.key}:${item.generation}`} hidden={!agent || view !== 'desktop' || item.key !== session?.key || item.generation !== session?.generation} src={item.url} title={`${agents[item.agent].name}’s live computer`} onLoad={() => setLoaded(current => ({ ...current, [item.generation]: true }))} onError={() => manager.invalidate(item.key, 'The screen could not open. Reconnect to try again; saved work is still available.', item.generation)} allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />)}
                {!displayed && <div className={styles.screenFallback}>
                  {preview && projectId && <img className={styles.preview} src={`/api/studio/projects/${projectId}/artifacts/${preview.id}?inline=1`} alt={`Saved preview from ${time(preview.createdAt)}; not a live screen`} onError={() => setBadPreview(preview.id)} />}
                  <div className={styles.emptyCard} data-loading={connecting} role="status"><span className={styles.emptyIcon}>{connecting ? <LoaderCircle className={styles.spinner} size={25} /> : <Monitor size={27} />}</span><span className={styles.eyebrow}>{connecting ? 'CONNECTING TO THE WORKSPACE' : session?.status === 'error' ? 'CONNECTION PAUSED' : 'WORKSPACE STATUS'}</span><h3>{connecting ? slow === session?.generation ? 'The screen is taking a moment' : `Opening ${person.name.split(' ')[0]}’s screen` : session?.status === 'error' ? 'Let’s reconnect the screen' : work.title}</h3><p>{connecting ? 'You can check Activity or Files while the live view connects.' : session?.status === 'error' ? session.message : work.description}</p><div className={styles.emptyActions}>{(session?.status === 'error' || (connecting && slow === session?.generation)) && <button className={styles.primary} onClick={retry}><RefreshCw size={14} />Retry connection</button>}<button className={styles.secondary} onClick={() => setView(work.runStatus === 'failed' && !work.task ? 'meeting' : 'activity')}>{work.runStatus === 'failed' && !work.task ? 'Review team activity' : 'View activity'}<ArrowRight size={14} /></button></div></div>
                </div>}
              </div><div className={styles.screenFooter}><span>{preview && !displayed && !connecting ? `Last saved ${time(preview.createdAt)} · Preview only` : 'View only · The specialist controls this computer'}</span>{displayed && <button onClick={retry}>Screen not updating? Reconnect</button>}</div>
            </div>
            <aside className={styles.details}><span className={styles.eyebrow}>ON THE DESK</span><h3>{work.task?.title || 'No task started yet'}</h3><p>{work.task?.detail || person.description}</p>{work.task?.deliverables?.length ? <div className={styles.deliverables}><span className={styles.eyebrow}>EXPECTED OUTPUTS</span>{work.task.deliverables.map(item => <p key={item}><FileText size={13} />{item}</p>)}</div> : null}<div className={styles.latestHeading}><span className={styles.eyebrow}>LATEST ACTIVITY</span><button onClick={() => setView('activity')}>All<ArrowRight size={12} /></button></div>{work.events.length ? <EventList events={work.events.slice(0, 3)} /> : <p className={styles.quiet}>Updates will appear here when this specialist begins.</p>}</aside>
          </div>
          {view === 'activity' && <section className={styles.content} id="workspace-panel-activity" role="tabpanel" aria-labelledby="workspace-tab-activity"><div className={styles.contentHeading}><span className={styles.eyebrow}>SAVED PROGRESS</span><h3>{person.name.split(' ')[0]}’s activity</h3><p>Tasks, tools and decisions from the current round of work.</p></div>{work.tasks.map(task => <article className={styles.taskCard} key={task.id} data-status={task.status}><span className={styles.eyebrow}>{task.status.replaceAll('_', ' ')}</span><h4>{task.title}</h4><p>{task.detail}</p></article>)}{work.events.length ? <EventList events={work.events.slice(0, 40)} /> : <div className={styles.contentEmpty}><Activity size={24} /><h4>No activity from {person.name.split(' ')[0]} yet</h4><p>{work.description}</p></div>}</section>}
          {view === 'output' && <section className={styles.content} id="workspace-panel-output" role="tabpanel" aria-labelledby="workspace-tab-output"><div className={styles.contentHeading}><span className={styles.eyebrow}>SHARED PROJECT FILES</span><h3>Everything the team has saved</h3><p>Versioned outputs remain available after computers finish their work.</p></div>{files.length && projectId ? <FileList files={files} projectId={projectId} /> : <div className={styles.contentEmpty}><FolderOpen size={26} /><h4>A place for the work to take shape</h4><p>The team’s proposals, previews and decisions will appear here as they are saved.</p></div>}</section>}
          {view === 'meeting' && <section className={styles.content}><div className={styles.contentHeading}><span className={styles.eyebrow}>{work.meeting ? 'MEETING IN SESSION' : 'TEAM NOTES'}</span><h3>The shared brief</h3><p>{snapshot?.project.brief.summary || 'Tell the team what you would like to build.'}</p></div>{snapshot?.project.brief.questions.map(question => <p className={styles.question} key={question}>{question}</p>)}{work.teamEvents.length ? <EventList events={work.teamEvents.slice(0, 30)} /> : <div className={styles.contentEmpty}><Users size={25} /><h4>Room for a conversation</h4><p>Shared decisions and the team’s meeting notes will be saved here.</p></div>}</section>}
        </main>
      </div>
      <footer className={styles.footer}><span><span className={styles.footerDot} />{view === 'meeting' ? 'One brief. A shared direction.' : `${person.name} · ${person.role}`}</span><span>Voice follows your position in the studio.<kbd>Esc</kbd> Close</span></footer>
    </section>
  </div>;
}
