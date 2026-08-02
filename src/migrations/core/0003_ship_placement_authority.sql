PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ship_custodies (
  ship_uid TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  custodian_type TEXT NOT NULL CHECK (custodian_type IN ('BUILDING')),
  custodian_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot >= 0),
  since_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (ship_uid) REFERENCES ship_locations (ship_uid) ON DELETE CASCADE,
  FOREIGN KEY (world_id) REFERENCES world_instances (world_id) ON DELETE CASCADE,
  UNIQUE (world_id, custodian_type, custodian_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_ship_custodies_custodian
  ON ship_custodies (world_id, custodian_type, custodian_id);

CREATE TABLE IF NOT EXISTS beta_space_sessions (
  session_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  ship_uid TEXT NOT NULL,
  owner_character_id TEXT NOT NULL,
  source_beta_void_id TEXT NOT NULL,
  source_generation INTEGER NOT NULL CHECK (source_generation > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'EXITED', 'EXPIRED')),
  entered_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  return_position_x REAL NOT NULL,
  return_position_y REAL NOT NULL,
  return_position_z REAL NOT NULL,
  return_rotation_x REAL NOT NULL,
  return_rotation_y REAL NOT NULL,
  return_rotation_z REAL NOT NULL,
  return_rotation_w REAL NOT NULL,
  return_speed REAL NOT NULL DEFAULT 0,
  return_desired_speed REAL NOT NULL DEFAULT 0,
  returned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (ship_uid) REFERENCES ship_locations (ship_uid) ON DELETE CASCADE,
  FOREIGN KEY (world_id) REFERENCES world_instances (world_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_beta_space_sessions_active_ship
  ON beta_space_sessions (ship_uid)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_beta_space_sessions_expiry
  ON beta_space_sessions (world_id, status, expires_at);
