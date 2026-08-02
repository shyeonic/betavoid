CREATE TABLE IF NOT EXISTS world_command_receipts (
  client_action_id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_world_command_receipts_created
  ON world_command_receipts (created_at);
