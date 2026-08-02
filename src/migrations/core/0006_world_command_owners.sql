ALTER TABLE world_command_receipts
  ADD COLUMN owner_character_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_world_command_receipts_owner
  ON world_command_receipts (owner_character_id, created_at);
