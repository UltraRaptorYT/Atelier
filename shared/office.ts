import type { AgentId } from './design';
export type OfficePoint = [number, number, number];
export const meetingSeats: Record<AgentId, OfficePoint> = {
  principal: [-1.4, 0, 5.1], architect: [-1.4, 0, 2.45],
  designer: [1.4, 0, 2.45], critic: [1.4, 0, 5.1],
};
export const workSeats: Record<AgentId, OfficePoint> = {
  principal: [-7.5, 0, 4], architect: [-7.5, 0, -4],
  designer: [0, 0, -4], critic: [7.5, 0, -4],
};
// Doorway graph. Both outbound and recalled avatars follow the same clear routes.
const points: Record<string, OfficePoint> = {
  ...Object.fromEntries(Object.entries(meetingSeats).map(([a,p]) => ['meet-'+a,p])),
  ...Object.fromEntries(Object.entries(workSeats).map(([a,p]) => ['work-'+a,p])),
  leftBack:[-2.8,0,5.1], rightBack:[2.8,0,5.1],
  leftFront:[-2.8,0,1.4], rightFront:[2.8,0,1.4],
  hall:[0,0,.38], leftHall:[-7.5,0,.38], rightHall:[7.5,0,.38],
};
const edges = [
  ['meet-principal','leftBack'], ['leftBack','leftFront'], ['meet-architect','leftFront'],
  ['meet-designer','rightFront'], ['meet-critic','rightBack'], ['rightBack','rightFront'],
  ['leftFront','hall'], ['rightFront','hall'], ['hall','leftHall'], ['hall','rightHall'],
  ['leftHall','work-principal'], ['leftHall','work-architect'], ['hall','work-designer'], ['rightHall','work-critic'],
];
export function officeRoute(from: OfficePoint, agent: AgentId, meeting: boolean): OfficePoint[] {
  const start = Object.keys(points).sort((a,b) => Math.hypot(from[0]-points[a][0],from[2]-points[a][2])-Math.hypot(from[0]-points[b][0],from[2]-points[b][2]))[0];
  const end = (meeting ? 'meet-' : 'work-') + agent;
  const queue = [[start]], visited = new Set([start]);
  while (queue.length) {
    const route = queue.shift()!, node = route.at(-1)!;
    if (node === end) return route.map(id => points[id]);
    for (const edge of edges) if (edge.includes(node)) {
      const next = edge[0] === node ? edge[1] : edge[0];
      if (!visited.has(next)) { visited.add(next); queue.push([...route,next]); }
    }
  }
  return [];
}
