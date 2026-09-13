import type { Brief } from '../../shared/design';
import { buildEffectiveRequirements, type AppliedChange } from '../../shared/requirements';
import type { Bindings } from './types';

/** Read every applied amendment; a recent-events window is not requirements memory. */
export async function readEffectiveRequirements(env: Bindings, projectId: string, brief: Brief, designRevision: number, excludeChangeId?: string) {
  const rows = await env.DB.prepare(`SELECT id,instruction,agent,element_id AS elementId,
    reference_artifact_id AS referenceArtifactId,applied_revision AS appliedRevision,applied_at AS appliedAt
    FROM changes WHERE project_id = ? AND applied_revision IS NOT NULL AND applied_revision <= ?
    ORDER BY applied_revision,applied_at,id`).bind(projectId, designRevision).all<AppliedChange>();
  return buildEffectiveRequirements(brief, designRevision, rows.results, excludeChangeId);
}
