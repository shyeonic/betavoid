CREATE TABLE IF NOT EXISTS player_states (
  firebase_uid TEXT PRIMARY KEY,
  character_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  assets_revision INTEGER NOT NULL DEFAULT 1 CHECK (assets_revision > 0),
  ship_revision INTEGER NOT NULL DEFAULT 0 CHECK (ship_revision >= 0),
  assets_json TEXT NOT NULL,
  ship_state_json TEXT,
  docking_json TEXT,
  last_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (firebase_uid) REFERENCES player_profiles (firebase_uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_player_states_character_id
  ON player_states (character_id);
