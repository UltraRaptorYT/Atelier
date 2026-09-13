import { agents, type AgentId, type Snapshot } from '../shared/design';
import { projectActivity } from './project-activity';

/** Explicit room selection is independent of the microphone's physical range. */
export function inspectionAgentForRoom(room: string): AgentId {
  return Object.hasOwn(agents, room) ? room as AgentId : 'principal';
}

/** A viewer follows the current task, never an old task's computer. */
export function workstationView(snapshot: Snapshot | null, agent: AgentId) {
  const activity = projectActivity(snapshot);
  const terminal = activity.currentRun?.status === 'failed' || activity.currentRun?.status === 'cancelled' || activity.currentRun?.status === 'completed' ? activity.currentRun.status : null;
  const tasks = activity.tasks.filter(task => task.agent === agent).map(task =>
    terminal && !['completed', 'failed', 'cancelled'].includes(task.status) ? { ...task, status: terminal } : task);
  const task = tasks.find(task => ['in_progress', 'review'].includes(task.status))
    || tasks.find(task => !['completed', 'cancelled'].includes(task.status)) || tasks.at(-1);
  const activeRun = activity.currentRun?.status === 'in_progress';
  const live = Boolean(snapshot && !snapshot.project.id.startsWith('local_') && agent !== 'principal'
    && activeRun && task && ['in_progress', 'review'].includes(task.status)
    && task.kind !== 'visual_direction' && activity.currentRun?.kind !== 'image');
  const status = task?.status.replaceAll('_', ' ') || (activeRun ? 'Waiting for a task' : 'Not started');
  let title = 'Ready when work begins';
  let description = 'The live screen appears while this specialist uses a computer. Saved activity and files stay available here.';
  if (!snapshot || snapshot.project.id.startsWith('local_')) {
    title = 'A workspace for your ideas';
    description = 'Give the connected studio a brief to begin. This screen will show the specialist’s actual work as it happens.';
  } else if (activity.currentRun?.status === 'failed') {
    const firstName = agents[agent].name.split(' ')[0];
    const earlierPreview = snapshot.artifacts.some(file => file.kind === 'desktop-preview' && file.name.startsWith(agent));
    const failedBriefing = !activity.tasks.some(item => item.agent !== 'principal');
    title = task?.status === 'completed' ? 'The work is saved' : task ? 'This work stopped' : earlierPreview ? 'No computer in this round' : 'This computer never started';
    description = task?.status === 'completed'
      ? `${firstName}’s task finished; the team stopped during later work. Saved outputs remain available in Files.`
      : !task ? `${failedBriefing ? `Briefing stopped before ${firstName} received a design task.` : `${firstName} was not assigned a computer task in this round.`} Review the team notes for the failure details; your brief and saved files are preserved.`
      : 'The run stopped during this work. Review Activity for the failure details; your brief and any saved files are preserved.';
  } else if (activity.currentRun?.status === 'cancelled') {
    title = 'Work has been stopped';
    description = 'The team is no longer using this computer. You can still read its activity and open every saved output.';
  } else if (agent === 'principal') {
    title = 'Alex coordinates the team';
    description = 'The Principal works through the brief, task plan and team decisions. Follow that work in Activity; specialist computers show the design tools.';
  } else if (task?.kind === 'visual_direction') {
    title = 'Developing the visual direction';
    description = 'This task produces a saved palette and design recommendations without opening a computer. Follow its progress in Activity.';
  } else if (task?.status === 'queued' || task?.status === 'blocked') {
    title = 'Waiting for this task to begin';
    description = task.detail || 'The computer will appear when dependencies are ready and the specialist starts work.';
  } else if (task?.status === 'completed' || activity.currentRun?.status === 'completed') {
    title = 'The work is saved';
    description = 'This computer has finished its task. Explore the saved outputs or read how the design developed in Activity.';
  }
  return {
    task, tasks, live, status, title, description, runStatus: activity.currentRun?.status,
    identity: task ? `${task.runId}:${task.id}` : '',
    events: activity.events.filter(event => event.agent === agent).slice().reverse(),
    teamEvents: activity.events.filter(event => ['meeting_started', 'meeting_ended', 'agent_message', 'error', 'clarification_requested', 'clarification_received'].includes(event.type)).slice().reverse(),
    meeting: activity.meeting,
    preview: snapshot?.artifacts.filter(file => file.kind === 'desktop-preview' && file.name.startsWith(agent)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
  };
}
