import type { Snapshot } from '../shared/design';

/** Task completion and model approval are deliberately separate states. */
export function summarizeWork(snapshot: Snapshot) {
  const runs = snapshot.runs?.filter(run => ['queued', 'in_progress'].includes(run.status));
  const activeIds = new Set(runs?.map(run => run.id));
  const currentTasks = snapshot.tasks.filter(task => (!runs || activeIds.has(task.runId)) && ['in_progress', 'queued', 'review'].includes(task.status));
  const working = currentTasks.filter(task => task.status === 'in_progress');
  const saved = Boolean(snapshot.design);
  if (snapshot.clarification?.status === 'awaiting_input') return { state: 'waiting', title: 'Your answers are needed', description: 'The Principal is waiting before the team continues.', tasks: [] };
  if (snapshot.clarification?.status === 'queued') return { state: 'waiting', title: 'Brief ready to continue', description: 'Your answers are saved. The team is queued to continue.', tasks: [] };
  if (working.length) return { state: 'working', title: 'Current work', description: '', tasks: working };
  if (runs?.length || currentTasks.length) {
    const running = runs?.find(run => run.status === 'in_progress');
    return {
      state: 'working', title: running ? 'Work is underway' : 'Waiting to start',
      description: running?.kind === 'image' ? 'Creating an image concept. The saved 3D model is separate.'
        : running?.kind === 'render' ? 'Preparing exports from the saved model.'
        : currentTasks[0]?.detail || 'Preparing the team and its workstations.', tasks: [],
    };
  }
  if (snapshot.project.status === 'review') return { state: 'review', title: 'Review remains open', description: 'The saved model is available; its review is still unresolved.', tasks: [] };
  if (snapshot.runs?.[0]?.status === 'failed') return { state: 'stopped', title: 'Work stopped', description: saved ? 'Your last saved model is preserved. See Activity for the error.' : 'No model was saved. See Activity for the error.', tasks: [] };
  return { state: 'idle', title: saved ? 'No work running' : 'Ready for your brief', description: saved ? 'You can explore the saved design or ask for a change.' : 'The first model will appear after the Architect saves it.', tasks: [] };
}
