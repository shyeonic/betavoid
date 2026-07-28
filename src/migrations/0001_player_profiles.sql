CREATE TABLE IF NOT EXISTS player_profiles (
  firebase_uid TEXT PRIMARY KEY,
  character_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_profiles_character_id
  ON player_profiles (character_id);
