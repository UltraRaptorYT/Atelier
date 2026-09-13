import type { Bindings, RunParams } from './types';

// Return statements so callers can persist milestones in the same atomic batch
// as their workflow transition. Every statement independently fences ownership
// and run state, including retries that arrive after cancellation.
export function changeStartedStatement(env: Bindings, p: RunParams): D1PreparedStatement {
  return env.DB.prepare(`UPDATE changes SET status = 'in_progress', started_at = COALESCE(started_at, ?)
    WHERE id = ? AND project_id = ? AND status IN ('pending', 'in_progress')
      AND EXISTS (SELECT 1 FROM runs r JOIN projects p ON p.id = r.project_id
        WHERE r.id = changes.id AND r.project_id = changes.project_id AND r.owner_id = ?
          AND p.owner_id = r.owner_id AND r.status = 'in_progress')`)
    .bind(new Date().toISOString(), p.runId, p.projectId, p.userId);
}

export function changeAppliedStatement(env: Bindings, p: RunParams, revision: number): D1PreparedStatement {
  return env.DB.prepare(`UPDATE changes SET status = 'applied', applied_at = COALESCE(applied_at, ?), applied_revision = ?
    WHERE id = ? AND project_id = ? AND status IN ('in_progress', 'applied') AND reviewed_at IS NULL
      AND (applied_revision IS NULL OR applied_revision <= ?)
      AND EXISTS (SELECT 1 FROM runs r JOIN projects p ON p.id = r.project_id
        JOIN revisions v ON v.project_id = p.id AND v.revision = p.revision
        WHERE r.id = changes.id AND r.project_id = changes.project_id AND r.owner_id = ?
          AND p.owner_id = r.owner_id AND r.status = 'in_progress' AND p.revision = ? AND p.revision > r.base_revision
          AND (v.operation_id = r.id OR substr(v.operation_id, 1, length(r.id) + 1) = r.id || '-'))`)
    .bind(new Date().toISOString(), revision, p.runId, p.projectId, revision, p.userId, revision);
}

export function changeReviewedStatement(env: Bindings, p: RunParams, revision: number, summary: string, findings: string[], artifactId: string): D1PreparedStatement {
  return env.DB.prepare(`UPDATE changes SET reviewed_at = ?, reviewed_revision = ?, review_summary = ?, review_findings = ?, review_artifact_id = ?
    WHERE id = ? AND project_id = ? AND status = 'applied' AND applied_revision = ? AND reviewed_at IS NULL
      AND EXISTS (SELECT 1 FROM runs r JOIN projects p ON p.id = r.project_id
        WHERE r.id = changes.id AND r.project_id = changes.project_id AND r.owner_id = ?
          AND p.owner_id = r.owner_id AND r.status = 'in_progress' AND p.revision = ?)
      AND EXISTS (SELECT 1 FROM artifacts a WHERE a.id = ? AND a.project_id = changes.project_id AND a.kind = 'review' AND a.revision = ?)`)
    .bind(new Date().toISOString(), revision, summary, JSON.stringify(findings), artifactId, p.runId, p.projectId, revision, p.userId, revision, artifactId, revision);
}

export function changeFailedStatement(env: Bindings, p: RunParams, status: 'failed' | 'cancelled', detail: string): D1PreparedStatement {
  // Earlier published application/review evidence survives a later failure.
  return env.DB.prepare(`UPDATE changes SET status = ?, failure_detail = COALESCE(failure_detail, ?)
    WHERE id = ? AND project_id = ? AND EXISTS (SELECT 1 FROM runs r JOIN projects p ON p.id = r.project_id
      WHERE r.id = changes.id AND r.project_id = changes.project_id AND r.owner_id = ?
        AND p.owner_id = r.owner_id AND r.status = ?)`)
    .bind(status, detail, p.runId, p.projectId, p.userId, status);
}
