import type { Snapshot } from '../shared/design';

/** Presentation always enters the latest canonical save, including a model under review. */
export function savedDesignEntry(snapshot: Snapshot | null) {
  if (!snapshot?.design) return null;
  return { design: snapshot.design, revision: snapshot.project.revision, mode: 'model' as const, navigation: 'walk' as const };
}

export function presentationInRange(position: { x: number; z: number }, exhibit: [number, number, number], available: boolean) {
  return available && Math.hypot(position.x - exhibit[0], position.z - exhibit[2]) < 2.8;
}
