PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS world_instances (
  world_id TEXT PRIMARY KEY,
  seed TEXT NOT NULL,
  data_source_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  generated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_entities (
  world_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('sector', 'resource_node', 'building', 'beta_void')
  ),
  entity_id TEXT NOT NULL,
  sector_id TEXT,
  chunk_id TEXT,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, entity_type, entity_id),
  FOREIGN KEY (world_id) REFERENCES world_instances (world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_entities_sector
  ON world_entities (world_id, sector_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_world_entities_chunk
  ON world_entities (world_id, chunk_id, entity_type);

CREATE TABLE IF NOT EXISTS world_storages (
  world_id TEXT NOT NULL,
  storage_id TEXT NOT NULL,
  storage_type TEXT NOT NULL,
  world_object_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, storage_id),
  FOREIGN KEY (world_id) REFERENCES world_instances (world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_storages_object
  ON world_storages (world_id, world_object_id);

CREATE TABLE IF NOT EXISTS world_meta (
  world_id TEXT NOT NULL,
  meta_key TEXT NOT NULL,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, meta_key),
  FOREIGN KEY (world_id) REFERENCES world_instances (world_id) ON DELETE CASCADE
);
