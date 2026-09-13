import type { Snapshot, StudioEvent } from '../shared/design';
import type { StudioRun } from '../shared/images';

function runEvents(snapshot: Snapshot, run: StudioRun | null): StudioEvent[] {
  if (!run) return [];
  const ordered = [...snapshot.events].sort((a, b) => a.id - b.id);
  const taskRuns = new Map(snapshot.tasks.map(task => [task.id, task.runId]));
  const eventRun = (event: StudioEvent) => event.taskId
    ? taskRuns.get(event.taskId) || snapshot.runs?.find(candidate => event.taskId!.startsWith(`${candidate.id}-`))?.id
    : undefined;
  // Profile artifacts precede each run's work. Older snapshots can use the
  // coordinator's queue marker; never treat the full project history as live.
  const profile = snapshot.artifacts.find(artifact => artifact.id === `${run.id}-generation-profile.json`);
  const queue = ordered.filter(event => event.type === 'task_created' && !event.taskId && /queued\.$/.test(event.message)).at(-1);
  const queueBelongsElsewhere = queue && ordered.some(event => event.id > queue.id && eventRun(event) && eventRun(event) !== run.id);
  return ordered.filter(event => {
    const owner = eventRun(event);
    if (owner && owner !== run.id) return false;
    // A voice handoff can precede the profile artifact. Explicit run ownership
    // is authoritative; timestamp fencing must not discard its meeting end.
    if (owner === run.id) return true;
    if (profile) return event.createdAt >= profile.createdAt;
    if (queue && !queueBelongsElsewhere) return event.id >= queue.id;
    return owner === run.id;
  });
}

/** Saved run status fences visual activity; historical tasks cannot animate a room. */
export function projectActivity(snapshot: Snapshot | null) {
  const runs = snapshot?.runs || [];
  const activeRuns = runs.filter(run => ['queued', 'in_progress'].includes(run.status));
  const currentRun = activeRuns.find(run => run.status === 'in_progress') || activeRuns[0] || runs[0] || null;
  const tasks = currentRun ? snapshot!.tasks.filter(task => task.runId === currentRun.id) : [];
  const officeTasks = currentRun && ['queued', 'in_progress'].includes(currentRun.status) ? tasks : [];
  const activeTasks = officeTasks.filter(task => task.status === 'in_progress');
  const events = snapshot ? runEvents(snapshot, currentRun) : [];
  const clarification = snapshot?.clarification;
  const currentClarification = clarification?.runId === currentRun?.id && currentRun?.status === 'awaiting_input';
  const awaitingInput = currentClarification && clarification?.status === 'awaiting_input';
  const continuingBrief = currentClarification && clarification?.status === 'queued';
  const lastMeeting = events.filter(event => ['meeting_started', 'meeting_ended', 'clarification_requested'].includes(event.type)).at(-1);
  const liveMeeting = currentRun?.status === 'in_progress' && ['generate', 'change'].includes(currentRun.kind) && lastMeeting?.type === 'meeting_started';
  // Specialist execution is stronger evidence than an unclosed meeting event.
  // In the bounded runtime, meetings coordinate batches rather than interrupt them.
  const dispatched = officeTasks.some(task => task.agent !== 'principal' && ['queued', 'in_progress', 'review', 'completed'].includes(task.status));
  const meeting = !dispatched && Boolean(awaitingInput || liveMeeting);
  return { currentRun, activeRuns, activeTasks, tasks, officeTasks, events, meeting, awaitingInput, continuingBrief };
}
