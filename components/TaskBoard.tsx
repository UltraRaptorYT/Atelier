import { agents, type Task } from '@/shared/design';
import styles from './TaskBoard.module.css';

type Props = { tasks: Task[] };

const statusLabels: Record<Task['status'], string> = {
  queued: 'Ready to start',
  blocked: 'Blocked',
  in_progress: 'Working',
  review: 'Needs review',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
};
const statusOrder: Record<Task['status'], number> = {
  in_progress: 0, blocked: 1, failed: 2, review: 3, queued: 4, cancelled: 5, completed: 6,
};

function TaskCard({ task, byId }: { task: Task; byId: Map<string, Task> }) {
  const agent = agents[task.agent];
  const dependencies = (task.dependencies ?? []).map(id => ({ id, task: byId.get(id) }));
  const pending = dependencies.filter(dependency => dependency.task?.status !== 'completed');
  const waiting = task.status === 'queued' || task.status === 'blocked';
  const computerWait = waiting && /\b(computer|workstation|desktop)\b/i.test(task.detail)
    && /\b(wait|waiting|queue|queued|busy|available|capacity)\b/i.test(task.detail);
  const status = task.status === 'queued'
    ? pending.length ? 'Waiting on tasks' : computerWait ? 'Waiting for computer' : statusLabels.queued
    : statusLabels[task.status];
  const objective = task.objective?.trim();
  const detail = task.detail.trim();

  return <li className={styles.card} data-status={task.status}>
    <div className={styles.cardTop}>
      <span className={styles.agent}><i style={{ backgroundColor: agent.color }} aria-hidden="true" />{agent.name}</span>
      <span className={styles.status}>{status}</span>
    </div>
    <span className={styles.role}>{agent.role}</span>
    <h4 className={styles.title}>{task.title}</h4>
    {objective && <p className={styles.objective}>{objective}</p>}
    {detail && detail !== objective && <p className={styles.detail}>{detail}</p>}

    {dependencies.length > 0 && <div className={styles.dependencies}>
      <span className={styles.label}>Dependencies</span>
      <ul className={styles.dependencyList}>{dependencies.map(dependency => <li key={dependency.id}>
        <span>{dependency.task?.title ?? 'A task outside this view'}</span>
        <small>{dependency.task ? statusLabels[dependency.task.status] : 'Status unavailable'}</small>
      </li>)}</ul>
    </div>}

    {!!task.deliverables?.length && <div className={styles.deliverables}>
      <span className={styles.label}>Deliverables</span>
      <ul>{task.deliverables.map((deliverable, index) => <li key={`${index}-${deliverable}`}>{deliverable}</li>)}</ul>
    </div>}

    {(task.baseRevision != null || task.artifactId || task.artifactRevision != null) && <div className={styles.references}>
      {task.baseRevision != null && <span>Based on revision {task.baseRevision}</span>}
      {task.artifactRevision != null && <span>Saved revision {task.artifactRevision}</span>}
      {task.artifactId && <span className={styles.artifact}><span>Saved artifact</span><span>{task.artifactId}</span></span>}
    </div>}
  </li>;
}

export default function TaskBoard({ tasks }: Props) {
  if (!tasks.length) return null;
  const byId = new Map(tasks.map(task => [task.id, task]));
  const activeAgents = new Set(tasks.filter(task => task.status === 'in_progress').map(task => task.agent)).size;
  const completed = tasks.filter(task => task.status === 'completed');
  const remaining = tasks.filter(task => task.status !== 'completed').sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  const waiting = tasks.filter(task => task.status === 'queued' || task.status === 'blocked').length;

  return <section className={styles.board} aria-label="Current team tasks">
    <div className={styles.heading}>
      <h3>Team tasks</h3>
      <span>{completed.length}/{tasks.length} complete</span>
    </div>
    <p className={styles.summary} aria-live="polite" aria-atomic="true">
      <span className={styles.activityDot} data-active={activeAgents > 0} aria-hidden="true" />
      {activeAgents ? `${activeAgents} ${activeAgents === 1 ? 'agent' : 'agents'} working` : 'No agents working'}
      {waiting > 0 && <span className={styles.waitingCount}> · {waiting} {waiting === 1 ? 'task' : 'tasks'} waiting</span>}
    </p>
    {remaining.length > 0 && <ul className={styles.tasks}>{remaining.map(task => <TaskCard key={task.id} task={task} byId={byId} />)}</ul>}
    {completed.length > 0 && <details className={styles.completed}>
      <summary>Completed tasks <span>{completed.length}</span></summary>
      <ul className={styles.tasks}>{completed.map(task => <TaskCard key={task.id} task={task} byId={byId} />)}</ul>
    </details>}
  </section>;
}
