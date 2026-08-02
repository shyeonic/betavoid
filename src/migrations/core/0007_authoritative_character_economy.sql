PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS character_states (
  firebase_uid TEXT PRIMARY KEY,
  character_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  assets_revision INTEGER NOT NULL DEFAULT 1,
  ship_revision INTEGER NOT NULL DEFAULT 0,
  assets_json TEXT NOT NULL,
  ship_state_json TEXT,
  docking_json TEXT,
  last_reason TEXT NOT NULL DEFAULT 'bootstrap',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_character_states_character_id
  ON character_states (character_id);

CREATE TABLE IF NOT EXISTS economy_occupancies (
  ship_uid TEXT PRIMARY KEY,
  owner_character_id TEXT NOT NULL,
  occupancy_type TEXT NOT NULL CHECK (occupancy_type IN ('TRADE', 'GATHERING')),
  contract_id TEXT NOT NULL UNIQUE,
  world_object_id TEXT,
  started_at INTEGER NOT NULL,
  busy_until INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_economy_occupancies_owner
  ON economy_occupancies (owner_character_id, busy_until);

CREATE TABLE IF NOT EXISTS gathering_contracts (
  contract_id TEXT PRIMARY KEY,
  client_action_id TEXT NOT NULL UNIQUE,
  owner_character_id TEXT NOT NULL,
  ship_uid TEXT NOT NULL,
  node_id TEXT NOT NULL,
  target_storage_id TEXT NOT NULL,
  produces_item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CANCELED', 'COMPLETED')),
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  start_at INTEGER NOT NULL,
  settled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gathering_contracts_node_status
  ON gathering_contracts (node_id, status, start_at);

CREATE INDEX IF NOT EXISTS idx_gathering_contracts_owner_status
  ON gathering_contracts (owner_character_id, status, start_at);

CREATE TABLE IF NOT EXISTS economy_command_receipts (
  client_action_id TEXT PRIMARY KEY,
  owner_character_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_economy_command_receipts_owner
  ON economy_command_receipts (owner_character_id, created_at DESC);
