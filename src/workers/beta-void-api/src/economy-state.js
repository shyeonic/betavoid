import { WORLD_TEMPLATE } from "./generated/world-template.js";
import { normalizePlayerStateRow } from "./player-state.js";

const PRIMARY_WORLD_ID = "primary";
const MAX_COMMAND_LIFETIME_MS = 10_000;
const COMMAND_CLOCK_SKEW_MS = 2_000;

export async function tradeAtStation(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getReceipt(db, context.characterId, clientActionId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);

  const buildingId = requiredId(body?.building_id, "building");
  const itemId = requiredId(body?.item_id, "item");
  const direction = String(body?.direction || "");
  if (!['in', 'out'].includes(direction)) {
    throw economyError(400, "TRADE_DIRECTION_INVALID", "Trade direction is invalid.");
  }
  const requestedAmount = Math.floor(Number(body?.amount));
  if (!Number.isInteger(requestedAmount) || requestedAmount <= 0 || requestedAmount > 1_000_000) {
    throw economyError(400, "TRADE_AMOUNT_INVALID", "Trade amount is invalid.");
  }

  const [characterRow, custodyRow, buildingRow, storageRow, occupancyRow] = await Promise.all([
    getCharacterRow(db, context.characterId),
    db.prepare(`
      SELECT custody.*
      FROM ship_custodies AS custody
      JOIN ship_locations AS ship ON ship.ship_uid = custody.ship_uid
      WHERE custody.ship_uid = ? AND ship.owner_character_id = ?
        AND custody.custodian_type = 'BUILDING' AND custody.custodian_id = ?
    `).bind(context.shipUid, context.characterId, buildingId).first(),
    db.prepare(`
      SELECT state_json FROM world_entities
      WHERE world_id = ? AND entity_type = 'building' AND entity_id = ?
    `).bind(PRIMARY_WORLD_ID, buildingId).first(),
    db.prepare(`
      SELECT * FROM world_storages
      WHERE world_id = ? AND world_object_id = ?
      ORDER BY storage_id LIMIT 1
    `).bind(PRIMARY_WORLD_ID, buildingId).first(),
    db.prepare(`
      SELECT * FROM economy_occupancies
      WHERE ship_uid = ? AND busy_until > ?
    `).bind(context.shipUid, now).first()
  ]);
  if (!characterRow) throw economyError(404, "PLAYER_STATE_UNAVAILABLE", "Player state unavailable.");
  const expectedAssetsRevision = Number(body?.expected_assets_revision);
  if (!Number.isInteger(expectedAssetsRevision) || expectedAssetsRevision < 1) {
    throw economyError(400, "PLAYER_REVISION_INVALID", "A valid assets revision is required.");
  }
  if (expectedAssetsRevision !== Number(characterRow.assets_revision)) {
    throw economyError(409, "PLAYER_STATE_CONFLICT", "Player assets changed in another session.");
  }
  if (!custodyRow) throw economyError(409, "TRADE_SHIP_NOT_DOCKED", "Ship is not docked at this station.");
  if (occupancyRow) throw economyError(409, "SHIP_OCCUPIED", "Ship is occupied by another action.");
  if (!buildingRow || !storageRow) throw economyError(404, "TRADE_STATION_UNAVAILABLE", "Station storage is unavailable.");

  const building = parseObject(buildingRow.state_json, "WORLD_ENTITY_CORRUPT");
  const storage = parseObject(storageRow.state_json, "WORLD_STORAGE_CORRUPT");
  const tradeConfig = WORLD_TEMPLATE.economyConfig?.buildingTrade?.[building.building_id] || {};
  if (!tradeConfig.enabled || !(Number(tradeConfig.handlingSpeed) > 0)) {
    throw economyError(409, "TRADE_STATION_DISABLED", "This station does not support trade.");
  }

  const assets = parseObject(characterRow.assets_json, "PLAYER_STATE_CORRUPT");
  const cargoStorage = (assets.storageLocations || []).find((entry) => (
    entry.storage_type === "ship_cargo" && entry.parent_item_uid === context.shipUid
  ));
  const ship = (assets.uniqueItems || []).find((entry) => entry.item_uid === context.shipUid);
  if (!cargoStorage || !ship) throw economyError(409, "TRADE_CARGO_UNAVAILABLE", "Ship cargo is unavailable.");

  const publicInventory = { ...(storage.public_inventory || {}) };
  const cargo = quantityMap(assets.quantityItems, cargoStorage.storage_id);
  const unitMass = Math.max(0, Number(WORLD_TEMPLATE.economyConfig?.itemMasses?.[itemId]) || 0);
  const cargoCapacity = Math.max(
    0,
    Number(cargoStorage.capacity)
      || Number(WORLD_TEMPLATE.economyConfig?.shipCargoCapacities?.[ship.item_id])
      || 0
  );
  const stationCapacity = Math.max(0, Number(storage.capacity) || Number(tradeConfig.cargoCapacity) || 0);
  const plan = planTrade({
    direction,
    itemId,
    requestedAmount,
    publicInventory,
    cargo,
    unitMass,
    cargoCapacity,
    stationCapacity
  });
  if (plan.applied <= 0) {
    return {
      committed: false,
      applied: 0,
      reason: plan.reason,
      server_time: now
    };
  }

  applyQuantityMap(assets, cargoStorage.storage_id, plan.cargo, now);
  storage.public_inventory = plan.publicInventory;
  storage.updated_at = now;
  const handlingDurationMs = Math.max(
    1_000,
    Math.ceil(plan.applied / Number(tradeConfig.handlingSpeed) * 1000)
  );
  const busyUntil = now + handlingDurationMs;
  const contractId = `trade-${crypto.randomUUID()}`;
  const occupancy = {
    contract_id: contractId,
    type: "TRADE",
    building_id: buildingId,
    item_id: itemId,
    direction,
    amount: plan.applied,
    started_at: now,
    busy_until: busyUntil
  };
  const nextAssetsRevision = Number(characterRow.assets_revision) + 1;
  const nextStorageRevision = Number(storageRow.revision) + 1;
  const nextPlayerRow = {
    ...characterRow,
    assets_revision: nextAssetsRevision,
    assets_json: JSON.stringify(assets),
    docking_json: null,
    last_reason: "trade",
    updated_at: now
  };
  const state = normalizePlayerStateRow(nextPlayerRow, context.profile);
  const response = {
    committed: true,
    applied: plan.applied,
    reason: plan.reason,
    occupancy,
    state,
    storage,
    storage_revision: nextStorageRevision,
    server_time: now
  };

  const results = await db.batch([
    db.prepare(`
      UPDATE character_states
      SET assets_json = ?, assets_revision = assets_revision + 1,
          docking_json = NULL, last_reason = 'trade', updated_at = ?
      WHERE character_id = ? AND assets_revision = ?
        AND EXISTS (
          SELECT 1 FROM world_storages
          WHERE world_id = ? AND storage_id = ? AND revision = ?
        )
    `).bind(
      JSON.stringify(assets),
      now,
      context.characterId,
      Number(characterRow.assets_revision),
      PRIMARY_WORLD_ID,
      storageRow.storage_id,
      Number(storageRow.revision)
    ),
    db.prepare(`
      UPDATE world_storages
      SET state_json = ?, revision = revision + 1, updated_at = ?
      WHERE world_id = ? AND storage_id = ? AND revision = ?
        AND EXISTS (
          SELECT 1 FROM character_states
          WHERE character_id = ? AND assets_revision = ? AND updated_at = ?
        )
    `).bind(
      JSON.stringify(storage),
      now,
      PRIMARY_WORLD_ID,
      storageRow.storage_id,
      Number(storageRow.revision),
      context.characterId,
      nextAssetsRevision,
      now
    ),
    db.prepare(`
      INSERT INTO economy_occupancies (
        ship_uid, owner_character_id, occupancy_type, contract_id,
        world_object_id, started_at, busy_until, state_json, revision, updated_at
      )
      SELECT ?, ?, 'TRADE', ?, ?, ?, ?, ?, 1, ?
      WHERE EXISTS (
        SELECT 1 FROM world_storages
        WHERE world_id = ? AND storage_id = ? AND revision = ? AND updated_at = ?
      )
      ON CONFLICT(ship_uid) DO UPDATE SET
        owner_character_id = excluded.owner_character_id,
        occupancy_type = excluded.occupancy_type,
        contract_id = excluded.contract_id,
        world_object_id = excluded.world_object_id,
        started_at = excluded.started_at,
        busy_until = excluded.busy_until,
        state_json = excluded.state_json,
        revision = economy_occupancies.revision + 1,
        updated_at = excluded.updated_at
    `).bind(
      context.shipUid,
      context.characterId,
      contractId,
      buildingId,
      now,
      busyUntil,
      JSON.stringify(occupancy),
      now,
      PRIMARY_WORLD_ID,
      storageRow.storage_id,
      nextStorageRevision,
      now
    ),
    db.prepare(`
      UPDATE world_instances
      SET revision = revision + 1, updated_at = ?
      WHERE world_id = ?
        AND EXISTS (
          SELECT 1 FROM world_storages
          WHERE world_id = ? AND storage_id = ? AND revision = ? AND updated_at = ?
        )
    `).bind(now, PRIMARY_WORLD_ID, PRIMARY_WORLD_ID, storageRow.storage_id, nextStorageRevision, now),
    db.prepare(`
      INSERT OR IGNORE INTO economy_command_receipts (
        client_action_id, owner_character_id, command_type, response_json, created_at
      )
      SELECT ?, ?, 'TRADE', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM economy_occupancies
        WHERE ship_uid = ? AND contract_id = ? AND busy_until = ?
      )
    `).bind(
      clientActionId,
      context.characterId,
      JSON.stringify(response),
      now,
      context.shipUid,
      contractId,
      busyUntil
    )
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw economyError(409, "TRADE_REVISION_CONFLICT", "Trade state changed concurrently.");
  }
  return response;
}

function planTrade({
  direction,
  itemId,
  requestedAmount,
  publicInventory,
  cargo,
  unitMass,
  cargoCapacity,
  stationCapacity
}) {
  const publicStock = Math.max(0, Number(publicInventory[itemId]) || 0);
  const cargoStock = Math.max(0, Number(cargo[itemId]) || 0);
  const cargoFree = freeUnits(cargo, cargoCapacity, unitMass, itemId);
  const stationFree = freeUnits(publicInventory, stationCapacity, unitMass, itemId);
  const applied = direction === "out"
    ? Math.min(requestedAmount, publicStock, cargoFree)
    : Math.min(requestedAmount, cargoStock, stationFree);
  let reason = null;
  if (applied < requestedAmount) {
    if (direction === "out") reason = publicStock <= applied ? "insufficient-stock" : "cargo-full";
    else reason = cargoStock <= applied ? "insufficient-cargo" : "station-full";
  }
  if (applied > 0 && direction === "out") {
    setQuantity(publicInventory, itemId, publicStock - applied);
    setQuantity(cargo, itemId, cargoStock + applied);
  } else if (applied > 0) {
    setQuantity(cargo, itemId, cargoStock - applied);
    setQuantity(publicInventory, itemId, publicStock + applied);
  }
  return { applied, reason, publicInventory, cargo };
}

function freeUnits(inventory, capacity, unitMass, targetItemId) {
  if (!(unitMass > 0)) return Number.MAX_SAFE_INTEGER;
  let usedMass = 0;
  for (const [itemId, quantity] of Object.entries(inventory)) {
    const mass = Math.max(0, Number(WORLD_TEMPLATE.economyConfig?.itemMasses?.[itemId]) || 0);
    usedMass += mass * Math.max(0, Number(quantity) || 0);
  }
  const targetMass = Math.max(0, Number(WORLD_TEMPLATE.economyConfig?.itemMasses?.[targetItemId]) || unitMass);
  return Math.max(0, Math.floor((capacity - usedMass) / targetMass + 1e-9));
}

function quantityMap(items, storageId) {
  const result = {};
  for (const item of items || []) {
    if (item.storage_id !== storageId) continue;
    const quantity = Math.max(0, Number(item.quantity) || 0);
    if (quantity > 0) result[item.item_id] = (result[item.item_id] || 0) + quantity;
  }
  return result;
}

function applyQuantityMap(assets, storageId, quantities, now) {
  const retained = (assets.quantityItems || []).filter((item) => item.storage_id !== storageId);
  for (const [itemId, quantity] of Object.entries(quantities)) {
    if (!(quantity > 0)) continue;
    retained.push({
      entry_id: `qty-${storageId}-${itemId}`,
      storage_id: storageId,
      item_id: itemId,
      kind: WORLD_TEMPLATE.resourceLifecycle?.itemTypes?.[itemId] || "item",
      quantity,
      created_at: now,
      updated_at: now
    });
  }
  assets.quantityItems = retained;
  if (assets.profile) assets.profile.updated_at = now;
}

function setQuantity(map, itemId, quantity) {
  if (quantity > 0) map[itemId] = quantity;
  else delete map[itemId];
}

async function getReceipt(db, characterId, clientActionId) {
  const row = await db.prepare(`
    SELECT response_json FROM economy_command_receipts
    WHERE client_action_id = ? AND owner_character_id = ?
  `).bind(clientActionId, characterId).first();
  return row ? parseObject(row.response_json, "ECONOMY_RECEIPT_CORRUPT") : null;
}

function getCharacterRow(db, characterId) {
  return db.prepare("SELECT * FROM character_states WHERE character_id = ?")
    .bind(characterId)
    .first();
}

function assertCommandDeadline(body, now) {
  const issuedAt = Number(body?.issued_at);
  const expiresAt = Number(body?.expires_at);
  if (
    !Number.isInteger(issuedAt)
    || !Number.isInteger(expiresAt)
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_COMMAND_LIFETIME_MS
    || issuedAt > now + COMMAND_CLOCK_SKEW_MS
  ) {
    throw economyError(400, "ECONOMY_COMMAND_WINDOW_INVALID", "Economy command window is invalid.");
  }
  if (now > expiresAt) throw economyError(409, "ECONOMY_COMMAND_EXPIRED", "Economy command expired.");
}

function requiredId(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 180 || /[\u0000-\u001f]/.test(normalized)) {
    throw economyError(400, "ECONOMY_COMMAND_INVALID", `${label} is invalid.`);
  }
  return normalized;
}

function parseObject(value, code) {
  try {
    const result = JSON.parse(value);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("invalid");
    return result;
  } catch {
    throw economyError(500, code, "Stored economy state is invalid.");
  }
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function economyError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
