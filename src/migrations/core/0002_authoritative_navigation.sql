CREATE TABLE IF NOT EXISTS ship_locations (
  ship_uid TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  owner_character_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  ship_definition_id TEXT NOT NULL,
  spatial_mode TEXT NOT NULL DEFAULT 'FIELD'
    CHECK (spatial_mode IN ('FIELD', 'DOCKED', 'STORED', 'BETA_SPACE', 'DESTROYED')),
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  position_z REAL NOT NULL,
  rotation_x REAL NOT NULL,
  rotation_y REAL NOT NULL,
  rotation_z REAL NOT NULL,
  rotation_w REAL NOT NULL,
  speed REAL NOT NULL DEFAULT 0,
  desired_speed REAL NOT NULL DEFAULT 0,
  sector_id TEXT,
  chunk_id TEXT,
  active_contract_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  checkpoint_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (world_id) REFERENCES world_instances (world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ship_locations_owner
  ON ship_locations (world_id, owner_character_id);

CREATE INDEX IF NOT EXISTS idx_ship_locations_sector
  ON ship_locations (world_id, spatial_mode, sector_id);

CREATE INDEX IF NOT EXISTS idx_ship_locations_chunk
  ON ship_locations (world_id, spatial_mode, chunk_id);

CREATE TABLE IF NOT EXISTS movement_contracts (
  contract_id TEXT PRIMARY KEY,
  client_action_id TEXT NOT NULL UNIQUE,
  world_id TEXT NOT NULL,
  ship_uid TEXT NOT NULL,
  owner_character_id TEXT NOT NULL,
  route_type TEXT NOT NULL
    CHECK (route_type IN ('standard', 'hyperdrive', 'deactivation')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CANCELED', 'ARRIVED')),
  flight_at INTEGER NOT NULL,
  arrive_at INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  issued_at INTEGER NOT NULL,
  canceled_at INTEGER,
  settled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (ship_uid) REFERENCES ship_locations (ship_uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movement_contracts_ship_status
  ON movement_contracts (ship_uid, status, arrive_at);

CREATE INDEX IF NOT EXISTS idx_movement_contracts_world_arrival
  ON movement_contracts (world_id, status, arrive_at);

CREATE TABLE IF NOT EXISTS movement_command_receipts (
  client_action_id TEXT PRIMARY KEY,
  owner_character_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movement_receipts_owner
  ON movement_command_receipts (owner_character_id, created_at);
