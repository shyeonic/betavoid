ALTER TABLE ship_locations
ADD COLUMN movement_phase TEXT NOT NULL DEFAULT 'MANUAL'
  CHECK (movement_phase IN ('MANUAL', 'MOVING', 'ARRIVED'));

UPDATE ship_locations
SET movement_phase = CASE
  WHEN active_contract_id IS NOT NULL THEN 'MOVING'
  ELSE 'MANUAL'
END;
