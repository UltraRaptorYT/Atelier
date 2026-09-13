ALTER TABLE changes ADD COLUMN started_at TEXT;
ALTER TABLE changes ADD COLUMN applied_at TEXT;
ALTER TABLE changes ADD COLUMN applied_revision INTEGER;
ALTER TABLE changes ADD COLUMN reviewed_at TEXT;
ALTER TABLE changes ADD COLUMN reviewed_revision INTEGER;
ALTER TABLE changes ADD COLUMN review_summary TEXT;
ALTER TABLE changes ADD COLUMN review_findings TEXT NOT NULL DEFAULT '[]';
ALTER TABLE changes ADD COLUMN review_artifact_id TEXT;
ALTER TABLE changes ADD COLUMN failure_detail TEXT;
CREATE INDEX changes_project_history ON changes(project_id, created_at, id);

-- Completion alone was previously sufficient to set status to applied. Only
-- backfill application when a run-owned revision, saved final review and its
-- published outcome agree. Missing evidence leaves milestone fields unknown.
UPDATE changes SET applied_revision = (
  SELECT a.revision FROM runs r
  JOIN artifacts a ON a.id = r.id || '-review.json' AND a.project_id = r.project_id AND a.kind = 'review'
  JOIN revisions v ON v.project_id = r.project_id AND v.revision = a.revision
  JOIN events e ON e.operation_id = r.id || '-review-outcome' AND e.project_id = r.project_id AND e.revision = a.revision
  WHERE r.id = changes.id AND r.project_id = changes.project_id AND r.status = 'completed'
    AND e.type IN ('final_design_ready', 'review_required')
    AND a.revision > r.base_revision
    AND (v.operation_id = r.id OR substr(v.operation_id, 1, length(r.id) + 1) = r.id || '-')
) WHERE status = 'applied';
UPDATE changes SET applied_at = (
  SELECT created_at FROM revisions WHERE project_id = changes.project_id AND revision = changes.applied_revision
) WHERE applied_revision IS NOT NULL;
