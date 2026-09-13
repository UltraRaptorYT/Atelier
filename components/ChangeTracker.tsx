import { agents, type ChangeRecord, type Design } from '@/shared/design';
import type { EffectiveRequirements } from '@/shared/requirements';
import styles from './ChangeTracker.module.css';

type Props = {
  projectId: string;
  changes: ChangeRecord[];
  design: Design | null;
  activeRunId: string | null;
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ChangeCard({ change, projectId, design, activeRunId }: Omit<Props, 'changes'> & { change: ChangeRecord }) {
  const reviewed = Boolean(change.reviewedAt);
  const applied = Boolean(change.appliedAt) && change.appliedRevision != null;
  const incompleteHistory = change.status === 'applied' && !applied;
  const started = Boolean(change.startedAt) || change.status === 'in_progress' || applied;
  const stopped = change.status === 'failed' || change.status === 'cancelled';
  const findings = change.reviewFindings ?? [];
  const label = stopped ? change.status === 'failed' ? 'Failed' : 'Cancelled'
    : reviewed ? findings.length ? 'Reviewed · findings' : 'Reviewed'
      : applied ? 'Applied · awaiting review' : incompleteHistory ? 'History incomplete' : change.status === 'in_progress' ? 'Working' : 'Queued';
  const steps = [
    { label: 'Queued', reached: true, at: change.createdAt },
    { label: 'Working', reached: started, at: change.startedAt },
    { label: 'Applied', reached: applied, at: change.appliedAt },
    { label: 'Reviewed', reached: reviewed, at: change.reviewedAt },
  ];
  const current = reviewed ? 3 : applied ? 2 : started ? 1 : 0;
  const element = design?.elements.find(item => item.id === change.elementId);
  const baseURL = `/api/studio/projects/${encodeURIComponent(projectId)}`;
  const revisions = [...new Set([change.appliedRevision, change.reviewedRevision].filter((value): value is number => value != null && value > 0))];

  return <li className={styles.card} data-status={change.status} data-findings={reviewed && findings.length > 0}>
    <div className={styles.cardTop}>
      <span className={styles.agent}>{agents[change.agent].role}</span>
      <span className={styles.badge}>{label}</span>
    </div>
    <p className={styles.instruction}>{change.instruction}</p>
    <p className={styles.scope}>Scope: {change.elementId ? <>{element?.name || 'Selected element'} <span>({change.elementId})</span></> : 'Project context'} · Requested at revision {change.baseRevision}</p>
    <ol className={styles.milestones} aria-label="Change milestones">
      {steps.map((step, index) => <li key={step.label} data-reached={step.reached} aria-current={!stopped && !incompleteHistory && current === index ? 'step' : undefined}>
        <i aria-hidden="true">{step.reached ? '✓' : index + 1}</i>
        <span>{step.label}</span>
        <small>{step.reached ? timestamp(step.at) || 'Recorded' : stopped || incompleteHistory ? 'Not recorded' : 'Pending'}</small>
      </li>)}
    </ol>
    {change.status === 'pending' && <p className={styles.detail}>{activeRunId && activeRunId !== change.id ? 'Saved in the queue. Work will start after the current run finishes.' : 'Saved in the queue, waiting for work to start.'}</p>}
    {change.status === 'in_progress' && !applied && <p className={styles.detail}>The team is working on this request. Its applied milestone will appear when a design revision is saved for it.</p>}
    {incompleteHistory && <p className={styles.problem}>This older request is marked applied, but its application milestone was not recorded. Its saved revision cannot be verified from this history.</p>}
    {stopped && <p className={styles.problem}>{change.failureDetail || (change.status === 'failed' ? 'This request could not finish. Check the activity below for details.' : 'This request was cancelled.')}{applied ? ' The recorded design revision remains saved.' : ' No applied revision is recorded for this request.'}</p>}
    {applied && !reviewed && <p className={styles.detail}>The change is saved. {stopped ? 'A completed review is not recorded.' : 'A completed Critic review has not been recorded yet.'}</p>}
    {reviewed && <div className={styles.review}>
      <strong>{findings.length ? `${findings.length} ${findings.length === 1 ? 'finding needs' : 'findings need'} attention` : 'Critic review recorded'}{change.reviewedRevision != null ? ` · revision ${change.reviewedRevision}` : ''}</strong>
      {change.reviewSummary && <p>{change.reviewSummary}</p>}
      {findings.length ? <ul>{findings.map((finding, index) => <li key={`${index}-${finding}`}>{finding}</li>)}</ul> : <p>No findings were recorded in this review.</p>}
    </div>}
    {(revisions.length > 0 || change.reviewArtifactId || change.referenceArtifactId) && <div className={styles.evidence}>
      {revisions.map(value => <a key={value} href={`${baseURL}/revisions/${value}`} download={`design-revision-${value}.json`}>Download revision {value}</a>)}
      {change.reviewArtifactId && <a href={`${baseURL}/artifacts/${encodeURIComponent(change.reviewArtifactId)}`} download>Read saved review</a>}
      {change.referenceArtifactId && <a href={`${baseURL}/artifacts/${encodeURIComponent(change.referenceArtifactId)}`} download>View request reference</a>}
    </div>}
  </li>;
}

export default function ChangeTracker({ changes, ...context }: Props) {
  if (!changes.length) return null;
  const ordered = [...changes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = changes.filter(change => ['pending', 'in_progress'].includes(change.status)).length;
  return <section className={styles.tracker} aria-label="Your change requests">
    <div className={styles.heading}><h3>Your changes</h3><span>{changes.length} saved</span></div>
    <p className={styles.summary} role="status">{pending ? `${pending} ${pending === 1 ? 'request is' : 'requests are'} queued or working.` : 'Your saved requests and their outcomes.'}</p>
    <ul className={styles.cards}>{ordered.map(change => <ChangeCard key={change.id} change={change} {...context} />)}</ul>
  </section>;
}

export function RequirementsHistory({ requirements }: { requirements?: EffectiveRequirements }) {
  if (!requirements) return null;
  return <details className={styles.requirements}>
    <summary>Current requirements <span>Revision {requirements.designRevision}</span></summary>
    <p>Later feedback overrides earlier requirements where they overlap. Unrelated requirements remain in effect.</p>
    <h4>Project brief</h4>
    <p className={styles.requirementText}>{requirements.brief.request}</p>
    {requirements.amendments.length > 0 && <><h4>Applied feedback, in order</h4><ol>{requirements.amendments.map(amendment => <li key={amendment.id}>
      <p className={styles.requirementText}>{amendment.instruction}</p>
      <small>Revision {amendment.appliedRevision} · {amendment.elementId ? `Element ${amendment.elementId}` : 'Project context'}</small>
    </li>)}</ol></>}
  </details>;
}
