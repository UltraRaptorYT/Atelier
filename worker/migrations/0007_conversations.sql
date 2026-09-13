ALTER TABLE runs ADD COLUMN resumes_run_id TEXT REFERENCES runs(id);
ALTER TABLE runs ADD COLUMN workflow_dispatched INTEGER NOT NULL DEFAULT 1;

CREATE TABLE project_clarifications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  continuation_run_id TEXT UNIQUE,
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_pending_clarification_per_project ON project_clarifications(project_id)
  WHERE status IN ('awaiting_input', 'queued');

CREATE TABLE interaction_receipts (
  operation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX conversation_turns_project ON conversation_turns(project_id, created_at);

-- Recover unanswered briefings created before structured answer routing.
-- Only the latest design run at the current revision can still own questions.
INSERT INTO project_clarifications(id,project_id,run_id,status,questions_json,brief_json,base_revision,created_at,updated_at)
SELECT 'clarification-' || r.id,p.id,r.id,'awaiting_input',
  (SELECT json_group_array(json_object('id','clarification-' || r.id || '-' || (CAST(q.key AS INTEGER) + 1),'question',q.value,'answer',NULL)) FROM json_each(p.brief,'$.questions') q),
  p.brief,p.revision,r.created_at,p.updated_at
FROM projects p JOIN runs r ON r.project_id = p.id
WHERE r.kind = 'generate' AND r.status = 'completed' AND r.base_revision = p.revision
  AND json_valid(p.brief) AND json_array_length(p.brief,'$.questions') BETWEEN 1 AND 3
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.run_id = r.id AND t.agent = 'principal' AND t.status = 'blocked' AND t.title = 'Clarify brief')
  AND NOT EXISTS (SELECT 1 FROM runs newer WHERE newer.project_id = p.id AND newer.kind IN ('generate','change') AND newer.rowid > r.rowid)
  AND NOT EXISTS (SELECT 1 FROM runs active WHERE active.project_id = p.id AND active.status IN ('queued','in_progress'));
UPDATE runs SET status = 'awaiting_input' WHERE id IN (SELECT run_id FROM project_clarifications WHERE status = 'awaiting_input');
UPDATE projects SET status = 'awaiting_input' WHERE id IN (SELECT project_id FROM project_clarifications WHERE status = 'awaiting_input');
