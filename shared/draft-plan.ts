import { validatePlan, type CollaborationPlan } from './collaboration';

export const FIRST_DRAFT_TASK = 'first-draft';

/** A bounded delivery sequence, not a stock design. Each task receives the
 * Principal's actual brief, accepted reference and effective requirements. */
export function draftFirstPlan(): CollaborationPlan {
  return validatePlan({
    summary: 'Kai will build an inspected first draft alongside the Designer’s visual direction. Once that draft is saved, architecture detail and interiors run together, followed by review. You can inspect and export saved revisions during refinement.',
    tasks: [
      { id: FIRST_DRAFT_TASK, kind: 'architecture', agent: 'architect', title: 'Build the first draft', dependencies: [],
        objective: 'Deliver a coherent first architectural draft now: brief-specific massing and roof silhouette, required floors and rooms, entrance, real openings, circulation and a clear spawn. Establish stable space IDs, room bounds and structural IDs for parallel refinement. Keep detail economical; do not substitute an unrelated sample or a single placeholder box. Record unfinished details and assumptions in notes. Inspect and submit the useful draft instead of polishing it to completion.',
        deliverables: ['Inspected editable draft model', 'Stable room bounds and circulation', 'Explicit unfinished details'] },
      { id: 'visual-direction', kind: 'visual_direction', agent: 'designer', title: 'Develop visual direction', dependencies: [],
        objective: 'Develop concise, brief-specific materials, palette, lighting and furniture recommendations while Kai builds the draft. Do not wait for geometry or attempt interior placement yet.',
        deliverables: ['Palette and material direction', 'Furniture and lighting priorities'] },
      { id: 'architecture-refinement', kind: 'architecture', agent: 'architect', title: 'Refine the draft architecture', dependencies: [FIRST_DRAFT_TASK, 'visual-direction'],
        objective: 'Refine the published draft with the design-defining architectural details and envelope corrections still needed by the brief. Work concurrently with interior placement: preserve agreed room bounds, space IDs, circulation, material assignments and furniture. Do not recreate the draft. If a necessary structural repair changes room bounds, record the affected spaces in coordination and leave that cross-domain adjustment for the review correction round.',
        deliverables: ['Incremental architectural detail proposal', 'Preserved shared layout and specialist handoff'] },
      { id: 'interiors', kind: 'interior', agent: 'designer', title: 'Furnish and finish the draft', dependencies: [FIRST_DRAFT_TASK, 'visual-direction'],
        objective: 'Apply the visual direction to the saved draft while Kai refines its envelope. Furnish the established spaces, add useful lighting and assign finishes without moving structural elements or room bounds. Keep paths clear, preserve stable IDs and make only incremental edits.',
        deliverables: ['Materials and furniture proposal', 'Lighting and clear circulation'] },
      { id: 'final-review', kind: 'review', agent: 'critic', title: 'Review the refined model', dependencies: ['architecture-refinement', 'interiors'],
        objective: 'Review the combined saved revision against the actual brief and accepted reference. Distinguish the draft limitations that were resolved from remaining meaningful defects. Return targeted corrections only; do not demand optional polishing unrelated to the requirements.',
        deliverables: ['Evidence-backed review and remaining corrections'] },
    ],
  }, false);
}
