import { WORLD_TEMPLATE } from "./generated/world-template.js";
import {
  prepareFieldEconomyAction,
  publicNavigationState
} from "./navigation-state.js";
import { normalizePlayerStateRow } from "./player-state.js";

const PRIMARY_WORLD_ID = "primary";
const ACTIVE = "ACTIVE";
const MAX_COMMAND_LIFETIME_MS = 10_000;
const COMMAND_CLOCK_SKEW_MS = 2_000;

export async function startGathering(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getReceipt(db, context.characterId, clientActionId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);

  const existing = await getActiveContractForOwner(db, context.characterId);
  if (existing) {
    await settleNodeOperation(db, context, existing.node_id, now, {
      operationId: `gather-resume-${crypto.randomUUID()}`
    });
    if (await getActiveContractForOwner(db, context.characterId)) {
      throw gatheringError(409, "SHIP_OCCUPIED", "Ship is already gathering.");
    }
  }

  const nodeId = requiredId(body?.node_id, "resource node");
  await settleNodeOperation(db, context, nodeId, now, {
    operationId: `gather-before-start-${crypto.randomUUID()}`
  });

  const prepared = await prepareFieldEconomyAction(db, context, body, now);
  const [characterRow, nodeState] = await Promise.all([
    getCharacterRow(db, context.characterId),
    loadNodeState(db, nodeId)
  ]);
  if (!characterRow) throw gatheringError(404, "PLAYER_STATE_UNAVAILABLE", "Player state unavailable.");
  assertAssetsRevision(characterRow, body?.expected_assets_revision);
  if (!nodeState) throw gatheringError(404, "GATHER_NODE_UNAVAILABLE", "Resource node is unavailable.");
  if (!(Number(nodeState.node.current_amount) > 0)) {
    throw gatheringError(409, "GATHER_NODE_DEPLETED", "Resource node is depleted.");
  }
  const nodeExpiry = nodeState.node.expiry_time == null
    ? null
    : Number(nodeState.node.expiry_time);
  if (Number.isFinite(nodeExpiry) && nodeExpiry <= now) {
    throw gatheringError(409, "GATHER_NODE_EXPIRED", "Resource node has expired.");
  }

  const maximumRange = Math.max(
    0,
    Number(WORLD_TEMPLATE.economyConfig?.gathering?.maximumRange) || 8000
  );
  if (distance(prepared.anchor.position, nodeState.node.position) > maximumRange) {
    throw gatheringError(409, "GATHER_OUT_OF_RANGE", "Ship is outside gathering range.");
  }

  const assets = parseObject(characterRow.assets_json, "PLAYER_STATE_CORRUPT");
  const storageId = requiredId(body?.target_storage_id, "target storage");
  const cargoStorage = (assets.storageLocations || []).find((storage) => (
    storage.storage_id === storageId
    && storage.storage_type === "ship_cargo"
    && storage.parent_item_uid === context.shipUid
  ));
  if (!cargoStorage) throw gatheringError(409, "GATHER_CARGO_UNAVAILABLE", "Ship cargo is unavailable.");

  const itemId = requiredId(nodeState.node.produces_item_id, "produced item");
  if (cargoFreeUnits(assets, cargoStorage, itemId) <= 0) {
    throw gatheringError(409, "GATHER_CARGO_FULL", "Ship cargo is full.");
  }
  const baseRate = Math.max(0, Number(nodeState.node.base_yield_per_sec) || 0);
  const configuredRate = Number(WORLD_TEMPLATE.economyConfig?.gathering?.effectiveRatePerSecond);
  const effectiveRate = configuredRate > 0 ? configuredRate : baseRate;
  if (!(effectiveRate > 0)) throw gatheringError(409, "GATHER_ZERO_YIELD", "Resource cannot be gathered.");

  nodeState.players.set(context.characterId, playerState(characterRow, assets));
  const contractId = `gather-${crypto.randomUUID()}`;
  const contract = {
    contract_id: contractId,
    client_action_id: clientActionId,
    actor_id: context.characterId,
    ship_uid: context.shipUid,
    type: "gathering",
    status: "active",
    target_node_id: nodeId,
    target_storage_id: storageId,
    produces_item_id: itemId,
    issued_at: now,
    start_at: now,
    epoch_settled_anchor: now,
    yield_snapshot: {
      base_yield_per_sec: baseRate,
      gather_rate_mult: baseRate > 0 ? effectiveRate / baseRate : 1,
      effective_yield_per_sec: effectiveRate
    },
    accumulated: 0,
    settled_yield: 0,
    planned_yield: 0,
    planned_end_at: null,
    created_at: now,
    updated_at: now
  };
  nodeState.contracts.set(contractId, contract);
  resetNodeEpoch(nodeState, now);
  replan(nodeState, now);

  const busyUntil = contractBusyUntil(contract, now);
  const nextShipRevision = prepared.state.ship.revision + 1;
  const nextShip = {
    ...prepared.state.ship,
    position: prepared.anchor.position,
    rotation: prepared.anchor.rotation,
    speed: 0,
    desired_speed: 0,
    sector_id: prepared.zones.sector_id,
    chunk_id: prepared.zones.chunk_id,
    phase: "manual",
    revision: nextShipRevision,
    checkpoint_at: now,
    updated_at: now
  };
  const occupancy = occupancyFor(contract, busyUntil, 1);
  const response = {
    committed: true,
    contract: publicContract(contract),
    node: nodeState.node,
    navigation: publicNavigationState({
      ship: nextShip,
      activeContract: null,
      economyOccupancy: occupancy,
      serverTime: now
    }),
    server_time: now
  };

  const statements = [
    db.prepare(`
      INSERT OR IGNORE INTO economy_command_receipts (
        client_action_id, owner_character_id, command_type, response_json, created_at
      )
      SELECT ?, ?, 'GATHER_START', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM world_entities
        WHERE world_id = ? AND entity_type = 'resource_node' AND entity_id = ? AND revision = ?
      )
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND owner_character_id = ? AND revision = ? AND spatial_mode = 'FIELD'
        )
        AND EXISTS (
          SELECT 1 FROM character_states
          WHERE character_id = ? AND assets_revision = ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM economy_occupancies WHERE ship_uid = ? AND busy_until > ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM gathering_contracts WHERE owner_character_id = ? AND status = 'ACTIVE'
        )
    `).bind(
      clientActionId,
      context.characterId,
      JSON.stringify(response),
      now,
      PRIMARY_WORLD_ID,
      nodeId,
      nodeState.nodeRevision,
      context.shipUid,
      context.characterId,
      prepared.state.ship.revision,
      context.characterId,
      Number(characterRow.assets_revision),
      context.shipUid,
      now,
      context.characterId
    ),
    db.prepare(`
      UPDATE world_entities
      SET state_json = ?, revision = revision + 1, updated_at = ?
      WHERE world_id = ? AND entity_type = 'resource_node' AND entity_id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
    `).bind(
      JSON.stringify(nodeState.node),
      now,
      PRIMARY_WORLD_ID,
      nodeId,
      nodeState.nodeRevision,
      clientActionId
    ),
    db.prepare(`
      UPDATE ship_locations
      SET position_x = ?, position_y = ?, position_z = ?,
          rotation_x = ?, rotation_y = ?, rotation_z = ?, rotation_w = ?,
          speed = 0, desired_speed = 0, sector_id = ?, chunk_id = ?,
          movement_phase = 'MANUAL', revision = revision + 1, checkpoint_at = ?, updated_at = ?
      WHERE ship_uid = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
    `).bind(
      nextShip.position.x,
      nextShip.position.y,
      nextShip.position.z,
      nextShip.rotation.x,
      nextShip.rotation.y,
      nextShip.rotation.z,
      nextShip.rotation.w,
      nextShip.sector_id,
      nextShip.chunk_id,
      now,
      now,
      context.shipUid,
      prepared.state.ship.revision,
      clientActionId
    ),
    db.prepare(`
      INSERT INTO gathering_contracts (
        contract_id, client_action_id, owner_character_id, ship_uid, node_id,
        target_storage_id, produces_item_id, status, state_json, revision,
        start_at, settled_at, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 1, ?, NULL, ?, ?
      WHERE EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
    `).bind(
      contractId,
      clientActionId,
      context.characterId,
      context.shipUid,
      nodeId,
      storageId,
      itemId,
      JSON.stringify(contract),
      now,
      now,
      now,
      clientActionId
    ),
    occupancyUpsertStatement(db, context, contract, busyUntil, now, clientActionId)
  ];
  appendExistingPlanUpdates(statements, db, nodeState, contractId, now, clientActionId);
  statements.push(worldRevisionStatement(db, now, clientActionId));
  const results = await db.batch(statements);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1 || changes(results[2]) !== 1) {
    throw gatheringError(409, "GATHER_STATE_CONFLICT", "Gathering state changed concurrently.");
  }
  return response;
}

export async function stopGathering(db, context, body, now = Date.now()) {
  return settleGatheringCommand(db, context, body, now, true);
}

export async function settleGathering(db, context, body, now = Date.now()) {
  return settleGatheringCommand(db, context, body, now, false);
}

export async function getActiveGathering(db, context, now = Date.now()) {
  const row = await getActiveContractForOwner(db, context.characterId);
  return {
    contract: row ? publicContract(contractFromRow(row)) : null,
    server_time: now
  };
}

async function settleGatheringCommand(db, context, body, now, cancel) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getReceipt(db, context.characterId, clientActionId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);
  const contractId = requiredId(body?.contract_id, "gathering contract");
  const row = await db.prepare(`
    SELECT * FROM gathering_contracts
    WHERE contract_id = ? AND owner_character_id = ?
  `).bind(contractId, context.characterId).first();
  if (!row) throw gatheringError(404, "GATHER_CONTRACT_UNAVAILABLE", "Gathering contract is unavailable.");
  if (row.status !== ACTIVE) {
    return {
      committed: false,
      contract: publicContract(contractFromRow(row)),
      server_time: now
    };
  }
  return settleNodeOperation(db, context, row.node_id, now, {
    operationId: clientActionId,
    targetContractId: contractId,
    cancel
  });
}

async function settleNodeOperation(db, context, nodeId, now, {
  operationId,
  targetContractId = null,
  cancel = false
}) {
  const existingReceipt = await getReceipt(db, context.characterId, operationId);
  if (existingReceipt) return existingReceipt;
  const state = await loadNodeState(db, nodeId);
  if (!state || activeContracts(state).length === 0) {
    return { committed: false, contract: null, node: state?.node || null, server_time: now };
  }

  const initialAmount = Math.max(0, Number(state.node.current_amount) || 0);
  simulate(state, now);
  if (cancel && targetContractId) {
    const target = state.contracts.get(targetContractId);
    if (target?.status === "active") finishContract(target, "cancelled", now);
  }
  resetNodeEpoch(state, now);
  replan(state, now);

  const extracted = Math.max(0, initialAmount - Math.max(0, Number(state.node.current_amount) || 0));
  if (extracted > 0 && state.resourceManagerRow) {
    const manager = state.resourceManager;
    const pool = manager.pools?.[state.node.resource_id || state.node.type];
    if (pool) pool.current_total = Math.max(0, Number(pool.current_total) - extracted);
  }

  const actorContract = targetContractId
    ? state.contracts.get(targetContractId) || null
    : [...state.contracts.values()].find((entry) => entry.actor_id === context.characterId) || null;
  const nextPlayerRows = buildNextPlayerRows(state, now);
  const actorPlayerRow = nextPlayerRows.get(context.characterId)
    || state.players.get(context.characterId)?.row
    || null;
  const actorState = actorPlayerRow
    ? normalizePlayerStateRow(actorPlayerRow, context.profile)
    : null;
  const response = {
    committed: true,
    gathered: Math.max(0, Number(actorContract?.settled_yield) || 0),
    contract: actorContract ? publicContract(actorContract) : null,
    node: state.depleted ? null : state.node,
    state: actorState,
    server_time: now
  };

  const characterConditions = [...state.players.values()].map(() => `
    AND EXISTS (SELECT 1 FROM character_states WHERE character_id = ? AND assets_revision = ?)
  `).join("");
  const rootValues = [
    operationId,
    context.characterId,
    cancel ? "GATHER_STOP" : "GATHER_SETTLE",
    JSON.stringify(response),
    now,
    PRIMARY_WORLD_ID,
    nodeId,
    state.nodeRevision
  ];
  for (const participant of state.players.values()) {
    rootValues.push(participant.row.character_id, Number(participant.row.assets_revision));
  }
  if (extracted > 0 && state.resourceManagerRow) {
    rootValues.push(PRIMARY_WORLD_ID, Number(state.resourceManagerRow.revision));
  }
  const managerCondition = extracted > 0 && state.resourceManagerRow
    ? "AND EXISTS (SELECT 1 FROM world_meta WHERE world_id = ? AND meta_key = 'resourceManager' AND revision = ?)"
    : "";
  const statements = [
    db.prepare(`
      INSERT OR IGNORE INTO economy_command_receipts (
        client_action_id, owner_character_id, command_type, response_json, created_at
      )
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM world_entities
        WHERE world_id = ? AND entity_type = 'resource_node' AND entity_id = ? AND revision = ?
      )
      ${characterConditions}
      ${managerCondition}
    `).bind(...rootValues)
  ];

  if (state.depleted) {
    statements.push(db.prepare(`
      DELETE FROM world_entities
      WHERE world_id = ? AND entity_type = 'resource_node' AND entity_id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
    `).bind(PRIMARY_WORLD_ID, nodeId, state.nodeRevision, operationId));
  } else {
    statements.push(db.prepare(`
      UPDATE world_entities
      SET state_json = ?, revision = revision + 1, updated_at = ?
      WHERE world_id = ? AND entity_type = 'resource_node' AND entity_id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
    `).bind(JSON.stringify(state.node), now, PRIMARY_WORLD_ID, nodeId, state.nodeRevision, operationId));
  }

  for (const [characterId, row] of nextPlayerRows) {
    const original = state.players.get(characterId).row;
    statements.push(db.prepare(`
      UPDATE character_states
      SET assets_json = ?, assets_revision = assets_revision + 1,
          last_reason = 'gathering', updated_at = ?
      WHERE character_id = ? AND assets_revision = ?
        AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
    `).bind(row.assets_json, now, characterId, Number(original.assets_revision), operationId));
  }

  for (const contract of state.contracts.values()) {
    statements.push(db.prepare(`
      UPDATE gathering_contracts
      SET status = ?, state_json = ?, revision = revision + 1,
          settled_at = ?, updated_at = ?
      WHERE contract_id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
    `).bind(
      databaseStatus(contract.status),
      JSON.stringify(contract),
      contract.status === "active" ? null : now,
      now,
      contract.contract_id,
      contract._revision,
      operationId
    ));
    if (contract.status === "active") {
      statements.push(occupancyUpdateStatement(db, contract, now, operationId));
    } else {
      statements.push(db.prepare(`
        DELETE FROM economy_occupancies
        WHERE ship_uid = ? AND contract_id = ?
          AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
      `).bind(contract.ship_uid, contract.contract_id, operationId));
    }
  }
  if (extracted > 0 && state.resourceManagerRow) {
    statements.push(db.prepare(`
      UPDATE world_meta
      SET state_json = ?, revision = revision + 1, updated_at = ?
      WHERE world_id = ? AND meta_key = 'resourceManager' AND revision = ?
        AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
    `).bind(
      JSON.stringify(state.resourceManager),
      now,
      PRIMARY_WORLD_ID,
      Number(state.resourceManagerRow.revision),
      operationId
    ));
  }
  statements.push(worldRevisionStatement(db, now, operationId));
  const results = await db.batch(statements);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw gatheringError(409, "GATHER_STATE_CONFLICT", "Gathering state changed concurrently.");
  }
  return response;
}

async function loadNodeState(db, nodeId) {
  const [nodeRow, contractRows, managerRow] = await Promise.all([
    db.prepare(`
      SELECT * FROM world_entities
      WHERE world_id = ? AND entity_type = 'resource_node' AND entity_id = ?
    `).bind(PRIMARY_WORLD_ID, nodeId).first(),
    db.prepare(`
      SELECT * FROM gathering_contracts
      WHERE node_id = ? AND status = 'ACTIVE'
      ORDER BY contract_id
    `).bind(nodeId).all(),
    db.prepare(`
      SELECT * FROM world_meta WHERE world_id = ? AND meta_key = 'resourceManager'
    `).bind(PRIMARY_WORLD_ID).first()
  ]);
  if (!nodeRow) return null;
  const contracts = new Map(
    (contractRows?.results || []).map((row) => {
      const contract = contractFromRow(row);
      return [contract.contract_id, contract];
    })
  );
  const ownerIds = [...new Set([...contracts.values()].map((entry) => entry.actor_id))];
  const players = new Map();
  if (ownerIds.length > 0) {
    const rows = await db.prepare(`
      SELECT * FROM character_states
      WHERE character_id IN (${ownerIds.map(() => "?").join(", ")})
    `).bind(...ownerIds).all();
    for (const row of rows?.results || []) {
      players.set(row.character_id, playerState(
        row,
        parseObject(row.assets_json, "PLAYER_STATE_CORRUPT")
      ));
    }
    if (players.size !== ownerIds.length) {
      throw gatheringError(500, "GATHER_PLAYER_STATE_MISSING", "Gathering participant state is missing.");
    }
  }
  return {
    node: parseObject(nodeRow.state_json, "WORLD_ENTITY_CORRUPT"),
    nodeRevision: Number(nodeRow.revision),
    contracts,
    players,
    resourceManagerRow: managerRow || null,
    resourceManager: managerRow
      ? parseObject(managerRow.state_json, "WORLD_META_CORRUPT")
      : null,
    depleted: false
  };
}

function simulate(state, targetMs) {
  let active = activeContracts(state);
  if (active.length === 0) return;
  let cursor = Number(state.node.epoch_start_at);
  if (!Number.isFinite(cursor)) cursor = Math.min(...active.map((entry) => entry.start_at));
  let remaining = Math.max(0, Number(state.node.current_amount) || 0);
  let guard = 0;
  while (cursor < targetMs && active.length > 0 && guard < 512) {
    guard += 1;
    for (const contract of active) {
      if (cargoFreeForContract(state, contract) <= 0) finishContract(contract, "completed", cursor);
    }
    active = activeContracts(state);
    if (active.length === 0) break;
    const totalRate = active.reduce((sum, entry) => sum + gatheringRate(entry), 0);
    if (!(totalRate > 0)) break;

    let segmentEnd = targetMs;
    let cause = "target";
    const exhaustAt = cursor + (remaining / totalRate) * 1000;
    if (exhaustAt < segmentEnd) {
      segmentEnd = exhaustAt;
      cause = "exhaust";
    }
    const expiryAt = state.node.expiry_time == null
      ? null
      : Number(state.node.expiry_time);
    if (Number.isFinite(expiryAt) && expiryAt < segmentEnd) {
      segmentEnd = expiryAt;
      cause = "expiry";
    }
    for (const contract of active) {
      const rate = gatheringRate(contract);
      const free = cargoFreeForContract(state, contract);
      const potentialUntilFull = Math.max(
        0,
        (Number(contract.settled_yield) || 0) + free - (Number(contract.accumulated) || 0)
      );
      const fullAt = cursor + (potentialUntilFull / rate) * 1000;
      if (fullAt < segmentEnd) {
        segmentEnd = fullAt;
        cause = "cargo";
      }
    }
    if (!(segmentEnd > cursor)) segmentEnd = Math.min(targetMs, cursor + 0.001);
    const seconds = Math.max(0, segmentEnd - cursor) / 1000;
    for (const contract of active.slice().sort(byContractId)) {
      contract.accumulated = (Number(contract.accumulated) || 0) + gatheringRate(contract) * seconds;
      const targetCredit = Math.floor((Number(contract.accumulated) || 0) + 1e-9);
      let delta = Math.max(0, targetCredit - (Number(contract.settled_yield) || 0));
      delta = Math.min(delta, remaining, cargoFreeForContract(state, contract));
      if (delta > 0) {
        creditCargo(state, contract, delta, targetMs);
        contract.settled_yield = (Number(contract.settled_yield) || 0) + delta;
        remaining -= delta;
      }
      contract.epoch_settled_anchor = segmentEnd;
      contract.updated_at = targetMs;
    }
    cursor = segmentEnd;
    if (remaining <= 0 || cause === "expiry") {
      for (const contract of activeContracts(state)) finishContract(contract, "completed", cursor);
      remaining = 0;
      state.depleted = true;
      break;
    }
    if (cause === "cargo") {
      for (const contract of activeContracts(state)) {
        if (cargoFreeForContract(state, contract) <= 0) finishContract(contract, "completed", cursor);
      }
    }
  }
  state.node.current_amount = remaining;
  state.node.updated_at = targetMs;
}

function replan(state, now) {
  const active = activeContracts(state);
  if (active.length === 0) return;
  const remaining = Math.max(0, Number(state.node.current_amount) || 0);
  const totalRate = active.reduce((sum, entry) => sum + gatheringRate(entry), 0);
  const exhaustAt = totalRate > 0 ? now + (remaining / totalRate) * 1000 : Infinity;
  for (const contract of active) {
    const rate = gatheringRate(contract);
    const free = cargoFreeForContract(state, contract);
    const potentialUntilFull = Math.max(
      0,
      (Number(contract.settled_yield) || 0) + free - (Number(contract.accumulated) || 0)
    );
    const cargoAt = rate > 0 ? now + (potentialUntilFull / rate) * 1000 : Infinity;
    const expiryAt = state.node.expiry_time != null && Number.isFinite(Number(state.node.expiry_time))
      ? Number(state.node.expiry_time)
      : Infinity;
    const plannedEndAt = Math.min(exhaustAt, cargoAt, expiryAt);
    contract.epoch_settled_anchor = now;
    contract.planned_end_at = Number.isFinite(plannedEndAt) ? Math.max(now, Math.round(plannedEndAt)) : null;
    const projected = (Number(contract.accumulated) || 0)
      + (Number.isFinite(plannedEndAt) ? rate * Math.max(0, plannedEndAt - now) / 1000 : 0);
    contract.planned_yield = Math.floor(projected + 1e-9);
    contract.updated_at = now;
  }
}

function resetNodeEpoch(state, now) {
  const active = activeContracts(state);
  state.node.active_gather_ids = active.map((entry) => entry.contract_id);
  state.node.epoch_start_at = active.length > 0 ? now : null;
  state.node.amount_at_epoch_start = Math.max(0, Number(state.node.current_amount) || 0);
  state.node.updated_at = now;
}

function activeContracts(state) {
  return [...state.contracts.values()].filter((entry) => entry.status === "active");
}

function gatheringRate(contract) {
  return Math.max(0, Number(contract.yield_snapshot?.effective_yield_per_sec) || 0);
}

function cargoFreeForContract(state, contract) {
  const participant = state.players.get(contract.actor_id);
  if (!participant) throw gatheringError(500, "GATHER_PLAYER_STATE_MISSING", "Gathering participant state is missing.");
  const storage = (participant.assets.storageLocations || []).find((entry) => (
    entry.storage_id === contract.target_storage_id
  ));
  if (!storage) throw gatheringError(500, "GATHER_CARGO_UNAVAILABLE", "Gathering cargo is unavailable.");
  return cargoFreeUnits(participant.assets, storage, contract.produces_item_id);
}

function cargoFreeUnits(assets, storage, itemId) {
  const capacity = Number(storage.capacity);
  if (!Number.isFinite(capacity)) return Number.MAX_SAFE_INTEGER;
  const unitMass = Math.max(0, Number(WORLD_TEMPLATE.economyConfig?.itemMasses?.[itemId]) || 0);
  if (!(unitMass > 0)) return Number.MAX_SAFE_INTEGER;
  let usedMass = 0;
  for (const item of assets.quantityItems || []) {
    if (item.storage_id !== storage.storage_id) continue;
    const mass = Math.max(0, Number(WORLD_TEMPLATE.economyConfig?.itemMasses?.[item.item_id]) || 0);
    usedMass += mass * Math.max(0, Number(item.quantity) || 0);
  }
  return Math.max(0, Math.floor((capacity - usedMass) / unitMass + 1e-9));
}

function creditCargo(state, contract, amount, now) {
  const participant = state.players.get(contract.actor_id);
  const items = participant.assets.quantityItems || (participant.assets.quantityItems = []);
  let item = items.find((entry) => (
    entry.storage_id === contract.target_storage_id
    && entry.item_id === contract.produces_item_id
  ));
  if (!item) {
    item = {
      entry_id: `qty-${contract.target_storage_id}-${contract.produces_item_id}`,
      storage_id: contract.target_storage_id,
      item_id: contract.produces_item_id,
      kind: WORLD_TEMPLATE.resourceLifecycle?.itemTypes?.[contract.produces_item_id] || "item",
      quantity: 0,
      created_at: now,
      updated_at: now
    };
    items.push(item);
  }
  item.quantity = Math.max(0, Number(item.quantity) || 0) + amount;
  item.updated_at = now;
  participant.changed = true;
}

function finishContract(contract, status, now) {
  contract.status = status;
  contract.planned_end_at = now;
  contract.planned_yield = Math.max(0, Number(contract.settled_yield) || 0);
  contract.updated_at = now;
  if (status === "completed") contract.completed_at = now;
  if (status === "cancelled") contract.cancelled_at = now;
}

function buildNextPlayerRows(state, now) {
  const result = new Map();
  for (const [characterId, participant] of state.players) {
    if (!participant.changed) continue;
    if (participant.assets.profile) participant.assets.profile.updated_at = now;
    result.set(characterId, {
      ...participant.row,
      assets_revision: Number(participant.row.assets_revision) + 1,
      assets_json: JSON.stringify(participant.assets),
      last_reason: "gathering",
      updated_at: now
    });
  }
  return result;
}

function playerState(row, assets) {
  return { row, assets, changed: false };
}

function contractFromRow(row) {
  const state = parseObject(row.state_json, "GATHER_STATE_CORRUPT");
  return {
    ...state,
    contract_id: row.contract_id,
    client_action_id: row.client_action_id,
    actor_id: row.owner_character_id,
    ship_uid: row.ship_uid,
    target_node_id: row.node_id,
    target_storage_id: row.target_storage_id,
    produces_item_id: row.produces_item_id,
    status: String(row.status).toLowerCase() === "canceled"
      ? "cancelled"
      : String(row.status).toLowerCase(),
    start_at: Number(row.start_at),
    _revision: Number(row.revision)
  };
}

function publicContract(contract) {
  return {
    contract_id: contract.contract_id,
    actor_id: contract.actor_id,
    ship_uid: contract.ship_uid,
    status: contract.status,
    target_node_id: contract.target_node_id,
    target_storage_id: contract.target_storage_id,
    produces_item_id: contract.produces_item_id,
    start_at: Number(contract.start_at),
    epoch_settled_anchor: Number(contract.epoch_settled_anchor) || Number(contract.start_at),
    planned_end_at: contract.planned_end_at == null ? null : Number(contract.planned_end_at),
    planned_yield: Math.max(0, Number(contract.planned_yield) || 0),
    settled_yield: Math.max(0, Number(contract.settled_yield) || 0),
    accumulated: Math.max(0, Number(contract.accumulated) || 0),
    effective_yield_per_sec: gatheringRate(contract)
  };
}

function databaseStatus(status) {
  if (status === "cancelled") return "CANCELED";
  if (status === "completed") return "COMPLETED";
  return ACTIVE;
}

function contractBusyUntil(contract, now) {
  return Math.max(now + 1, Number(contract.planned_end_at) || now + 30 * 24 * 60 * 60 * 1000);
}

function occupancyFor(contract, busyUntil, revision) {
  return {
    type: "GATHERING",
    contractId: contract.contract_id,
    worldObjectId: contract.target_node_id,
    startedAt: contract.start_at,
    busyUntil,
    revision
  };
}

function occupancyUpsertStatement(db, context, contract, busyUntil, now, receiptId) {
  const state = {
    contract_id: contract.contract_id,
    type: "GATHERING",
    node_id: contract.target_node_id,
    started_at: contract.start_at,
    busy_until: busyUntil
  };
  return db.prepare(`
    INSERT INTO economy_occupancies (
      ship_uid, owner_character_id, occupancy_type, contract_id,
      world_object_id, started_at, busy_until, state_json, revision, updated_at
    )
    SELECT ?, ?, 'GATHERING', ?, ?, ?, ?, ?, 1, ?
    WHERE EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
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
    contract.contract_id,
    contract.target_node_id,
    contract.start_at,
    busyUntil,
    JSON.stringify(state),
    now,
    receiptId
  );
}

function occupancyUpdateStatement(db, contract, now, receiptId) {
  const busyUntil = contractBusyUntil(contract, now);
  const state = {
    contract_id: contract.contract_id,
    type: "GATHERING",
    node_id: contract.target_node_id,
    started_at: contract.start_at,
    busy_until: busyUntil
  };
  return db.prepare(`
    UPDATE economy_occupancies
    SET busy_until = ?, state_json = ?, revision = revision + 1, updated_at = ?
    WHERE ship_uid = ? AND contract_id = ?
      AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
  `).bind(
    busyUntil,
    JSON.stringify(state),
    now,
    contract.ship_uid,
    contract.contract_id,
    receiptId
  );
}

function appendExistingPlanUpdates(statements, db, state, excludedContractId, now, receiptId) {
  for (const contract of state.contracts.values()) {
    if (contract.contract_id === excludedContractId) continue;
    statements.push(db.prepare(`
      UPDATE gathering_contracts
      SET state_json = ?, revision = revision + 1, updated_at = ?
      WHERE contract_id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
    `).bind(JSON.stringify(contract), now, contract.contract_id, contract._revision, receiptId));
    statements.push(occupancyUpdateStatement(db, contract, now, receiptId));
  }
}

function worldRevisionStatement(db, now, receiptId) {
  return db.prepare(`
    UPDATE world_instances
    SET revision = revision + 1, updated_at = ?
    WHERE world_id = ?
      AND EXISTS (SELECT 1 FROM economy_command_receipts WHERE client_action_id = ?)
  `).bind(now, PRIMARY_WORLD_ID, receiptId);
}

async function getActiveContractForOwner(db, characterId) {
  return db.prepare(`
    SELECT * FROM gathering_contracts
    WHERE owner_character_id = ? AND status = 'ACTIVE'
    ORDER BY start_at LIMIT 1
  `).bind(characterId).first();
}

function getCharacterRow(db, characterId) {
  return db.prepare("SELECT * FROM character_states WHERE character_id = ?")
    .bind(characterId)
    .first();
}

async function getReceipt(db, characterId, clientActionId) {
  const row = await db.prepare(`
    SELECT response_json FROM economy_command_receipts
    WHERE client_action_id = ? AND owner_character_id = ?
  `).bind(clientActionId, characterId).first();
  return row ? parseObject(row.response_json, "ECONOMY_RECEIPT_CORRUPT") : null;
}

function assertAssetsRevision(row, expected) {
  const revision = Number(expected);
  if (!Number.isInteger(revision) || revision < 1) {
    throw gatheringError(400, "PLAYER_REVISION_INVALID", "A valid assets revision is required.");
  }
  if (revision !== Number(row.assets_revision)) {
    throw gatheringError(409, "PLAYER_STATE_CONFLICT", "Player assets changed in another session.");
  }
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
    throw gatheringError(400, "ECONOMY_COMMAND_WINDOW_INVALID", "Economy command window is invalid.");
  }
  if (now > expiresAt) throw gatheringError(409, "ECONOMY_COMMAND_EXPIRED", "Economy command expired.");
}

function requiredId(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 180 || /[\u0000-\u001f]/.test(normalized)) {
    throw gatheringError(400, "ECONOMY_COMMAND_INVALID", `${label} is invalid.`);
  }
  return normalized;
}

function parseObject(value, code) {
  try {
    const result = typeof value === "string" ? JSON.parse(value) : value;
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("invalid");
    return result;
  } catch {
    throw gatheringError(500, code, "Stored gathering state is invalid.");
  }
}

function distance(a, b) {
  return Math.hypot(
    Number(a?.x) - Number(b?.x),
    Number(a?.y) - Number(b?.y),
    Number(a?.z) - Number(b?.z)
  );
}

function byContractId(a, b) {
  return a.contract_id.localeCompare(b.contract_id);
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function gatheringError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
