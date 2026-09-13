'use client';

import { ArrowRight, Box } from 'lucide-react';
import { agents, type Snapshot } from '@/shared/design';
import type { ProjectConnection } from '@/lib/project-feed';
import { summarizeWork } from '@/lib/work-overview';
import styles from './WorkOverview.module.css';

type Props = { snapshot: Snapshot | null; connection: ProjectConnection; viewingLatest: boolean; onViewDesign: () => void; onActivity: () => void };

export default function WorkOverview({ snapshot, connection, viewingLatest, onViewDesign, onActivity }: Props) {
  if (!snapshot) return <div className={styles.sample}>Sample studio · no AI work is running</div>;
  const work = summarizeWork(snapshot);
  const local = snapshot.project.id.startsWith('local_');
  const offline = !local && connection === 'offline';
  const connectionLabel = { connecting: 'Connecting to updates…', live: 'Updates connected', polling: 'Checking for updates', offline: 'Updates paused · reconnecting' }[connection];

  return <section className={styles.overview} aria-label="Project work and saved model">
    <div className={styles.work} aria-live="polite">
      <div className={styles.heading}><strong><i data-state={offline ? 'stopped' : work.state} aria-hidden="true" />{offline ? 'Last known activity' : work.title}</strong><button type="button" onClick={onActivity}>Activity<ArrowRight size={12} /></button></div>
      {work.tasks.length > 0 ? <ul className={styles.tasks}>{work.tasks.slice(0, 2).map(task => <li key={task.id}><span>{agents[task.agent].role}</span>{task.title}</li>)}</ul> : <p>{local ? 'This brief is saved in your browser. Connect the studio to start AI work.' : work.description}</p>}
      {!local && <small className={styles.connection} data-offline={offline}>{connectionLabel}</small>}
    </div>
    <div className={styles.saved}>
      <Box size={17} aria-hidden="true" />
      <div><span className={styles.label}>SAVED MODEL</span><strong>{snapshot.design ? `Revision ${snapshot.project.revision}` : 'No model saved yet'}</strong><p>{snapshot.design ? work.state === 'working' ? 'The team is working beyond this saved version.' : snapshot.design.title : 'Geometry appears here after the first save.'}</p></div>
    </div>
    {snapshot.design && <button className={styles.view} type="button" onClick={onViewDesign}>{viewingLatest ? 'Viewing latest design' : 'View latest design'}<ArrowRight size={14} /></button>}
  </section>;
}
