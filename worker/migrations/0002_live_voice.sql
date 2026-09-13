-- Persist tool receipts so duplicated provider events cannot repeat a spoken action.
CREATE TABLE voice_tool_results (
  operation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
