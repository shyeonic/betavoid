CREATE TABLE IF NOT EXISTS world_instances (
  world_id TEXT PRIMARY KEY,
  seed TEXT NOT NULL,
  data_source_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  generated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
