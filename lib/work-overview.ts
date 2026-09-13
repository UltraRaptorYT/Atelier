import type { Snapshot } from '../shared/design';
import { projectActivity } from './project-activity';

/** Task completion and model approval are deliberately separate states. */
export function summarizeWork(snapshot: Snapshot) {
  const activity = projectActivity(snapshot);
  const runs = activity.activeRuns;
  const currentTasks = activity.officeTasks.filter(task => ['in_progress', 'queued', 'review'].includes(task.status));
  const working = activity.activeTasks;
  const saved = Boolean(snapshot.design);
  if (activity.awaitingInput) return { state: 'waiting', title: 'Your answers are needed', description: 'The Principal is waiting before the team continues.', tasks: [] };
  if (activity.continuingBrief) return { state: 'waiting', title: 'Brief ready to continue', description: 'Your answers are saved. The team is queued to continue.', tasks: [] };
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
  if (activity.currentRun?.status === 'failed') {
    const beforeSpecialists = activity.currentRun.kind === 'generate' && !activity.tasks.some(task => task.agent !== 'principal');
    return { state: 'stopped', title: beforeSpecialists ? 'Briefing failed before design work' : activity.currentRun.kind === 'image' ? 'Image request failed' : activity.currentRun.kind === 'render' ? 'Render failed' : 'Design work failed',
      description: `${beforeSpecialists ? 'No specialist tasks started. ' : ''}${saved ? 'Your last saved model is preserved.' : 'No model was saved.'} Your brief is saved. Open Activity to review the failure before retrying.`, tasks: [] };
  }
  if (activity.currentRun?.status === 'cancelled') return { state: 'stopped', title: 'Work stopped', description: saved ? 'Your saved model and brief are preserved. No agents are working.' : 'Your brief is saved. No agents are working and no model was saved.', tasks: [] };
  if (snapshot.project.status === 'review') return { state: 'review', title: 'Review remains open', description: 'The saved model is available; its review is still unresolved.', tasks: [] };
  if (snapshot.project.status === 'ready') return { state: 'idle', title: 'Saved design ready to explore', description: 'The team has finished. Open the saved model or visit Presentation.', tasks: [] };
  return { state: 'idle', title: saved ? 'No work running' : 'Ready for your brief', description: saved ? 'You can explore the saved design or ask for a change.' : 'The first model will appear after the Architect saves it.', tasks: [] };
}
