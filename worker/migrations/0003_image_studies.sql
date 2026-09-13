ALTER TABLE projects ADD COLUMN concept_artifact_id TEXT;
ALTER TABLE runs ADD COLUMN reference_artifact_id TEXT;
ALTER TABLE changes ADD COLUMN reference_artifact_id TEXT;
CREATE TABLE image_studies (
  id TEXT PRIMARY KEY REFERENCES artifacts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  revision INTEGER NOT NULL,
  source_artifact_id TEXT,
  metadata_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  created_at TEXT NOT NULL
);
CREATE INDEX images_project ON image_studies(project_id, created_at);
CREATE TABLE image_attempts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  day TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX images_daily_budget ON image_attempts(owner_id, day);
