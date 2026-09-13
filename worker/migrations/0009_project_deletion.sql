-- Recoverable deletion: keep artifacts and usage ledgers, hide the workspace.
ALTER TABLE projects ADD COLUMN deleted_at TEXT;

-- Fence work admitted concurrently with deletion, including delayed voice tools.
CREATE TRIGGER reject_deleted_project_runs BEFORE INSERT ON runs
WHEN (SELECT deleted_at FROM projects WHERE id = NEW.project_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Project deleted'); END;
CREATE TRIGGER reject_deleted_project_voice BEFORE INSERT ON voice_sessions
WHEN (SELECT deleted_at FROM projects WHERE id = NEW.project_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Project deleted'); END;
CREATE TRIGGER reject_deleted_project_changes BEFORE INSERT ON changes
WHEN (SELECT deleted_at FROM projects WHERE id = NEW.project_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Project deleted'); END;
CREATE TRIGGER protect_deleted_project BEFORE UPDATE ON projects
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Project deleted'); END;
