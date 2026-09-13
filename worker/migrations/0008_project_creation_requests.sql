CREATE TABLE project_creation_requests (
  operation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
