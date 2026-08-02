import {
  createDeactivationMovementPlan,
  createHyperdriveMovementPlan,
  createStandardMovementPlan,
  deriveMovementState,
  quaternionForward
} from "../../../js/navigationKinematics.js";
import { evaluateActionPositionObservation } from "./action-position-validation.js";
import { WORLD_TEMPLATE } from "./generated/world-template.js";
import { ensureWorldInitialized, getWorldEntityState } from "./world-state.js";

const PRIMARY_WORLD_ID = "primary";
const FIELD_MODE = "FIELD";
const MAX_COORDINATE = 1_000_000_000;
const MAX_ID_LENGTH = 180;
const MAX_COMMAND_LIFETIME_MS = 10_000;
const COMMAND_CLOCK_SKEW_MS = 2_000;
const DOCK_RANGE_RENDER_UNITS = 150;
const UNDOCK_OFFSET_DATA_UNITS = 10;
const BETA_SPACE_ID = "BETA-SPACE";
const BETA_SPACE_CHUNK_SPAN = 5;

export async function getPlayerNavigationState(db, context, now = Date.now()) {
  return publicNavigationState(await getPlayerNavigationStateInternal(
    db,
    context,
    now,
    { materializeTimedTransitions: false }
  ));
}

export async function prepareFieldEconomyAction(db, context, body, now = Date.now()) {
  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertCommandRevision(state, body?.expected_ship_revision);
  if (
    state.ship.spatial_mode !== FIELD_MODE
    || state.custody
    || state.betaSpaceSession
    || state.activeContract
  ) {
    throw navigationError(
      409,
      "SHIP_NOT_AVAILABLE_FOR_ECONOMY",
      "Ship must be stationary in the field for this economy action."
    );
  }
  const physics = getShipPhysics(state.ship.ship_definition_id);
  const anchor = resolveValidatedActionAnchor(state, body?.observed_ship, physics, now);
  return {
    state,
    anchor: {
      ...anchor,
      speed: 0,
      desiredSpeed: 0
    },
    zones: zoneFields(anchor.position, FIELD_MODE)
  };
}

async function getPlayerNavigationStateInternal(
  db,
  context,
  now = Date.now(),
  { materializeTimedTransitions = true } = {}
) {
  await ensureWorldInitialized(db);
  let ship = await getOrCreateShip(db, context, now);
  const beforeTimedTransition = ship;
  ship = materializeTimedTransitions
    ? await materializeExpiredBetaSpaceSession(db, ship, now)
    : await resolveExpiredBetaSpaceShipForRead(db, ship, now);
  const state = await resolvePlayerState(db, ship, now, {
    materializeArrival: materializeTimedTransitions
  });
  const attached = await attachPlacementState(db, state);
  if (
    materializeTimedTransitions
    && beforeTimedTransition.spatial_mode === "BETA_SPACE"
    && ship.spatial_mode === FIELD_MODE
    && ship.revision === beforeTimedTransition.revision + 1
  ) {
    attached.timedRevisionTransition = {
      fromRevision: beforeTimedTransition.revision,
      toRevision: ship.revision
    };
  }
  return attached;
}

export async function startPlayerNavigation(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getCommandReceipt(db, clientActionId, context.characterId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertShipCanNavigate(state);
  assertCommandRevision(state, body?.expected_revision);
  const physics = getShipPhysics(state.ship.ship_definition_id);
  const anchor = resolveValidatedActionAnchor(state, body?.observed_ship, physics, now);
  const routeType = normalizeRouteType(body?.route_type);
  const plan = routeType === "standard"
    ? createStandardMovementPlan({
        ...anchor,
        target: normalizePosition(body?.target),
        physics,
        issuedAt: now
      })
    : routeType === "hyperdrive"
      ? createHyperdriveMovementPlan({
          ...anchor,
          target: normalizePosition(body?.target),
          physics,
          issuedAt: now
        })
      : createDeactivationMovementPlan({
          ...anchor,
          desiredSpeed: anchor.desiredSpeed,
          physics,
          issuedAt: now
        });
  const contract = {
    ...plan,
    contractId: `route-${crypto.randomUUID()}`,
    clientActionId,
    worldId: state.ship.world_id,
    shipUid: state.ship.ship_uid,
    ownerCharacterId: state.ship.owner_character_id,
    shipDefinitionId: state.ship.ship_definition_id,
    status: "ACTIVE",
    revision: 1,
    issuedAt: now,
    createdAt: now,
    updatedAt: now
  };
  const nextRevision = state.ship.revision + 1;
  const nextShip = {
    ...state.ship,
    position: anchor.position,
    rotation: anchor.rotation,
    speed: anchor.speed,
    desired_speed: anchor.desiredSpeed,
    active_contract_id: contract.contractId,
    phase: deriveMovementState(contract, now).phase,
    revision: nextRevision,
    checkpoint_at: now,
    updated_at: now,
    ...zoneFields(anchor.position, state.ship.spatial_mode)
  };
  const response = publicNavigationState({
    ship: nextShip,
    activeContract: contract,
    custody: null,
    betaSpaceSession: state.betaSpaceSession,
    serverTime: now
  });
  const previousContractId = state.ship.active_contract_id;
  const statements = [];
  if (previousContractId) {
    statements.push(db.prepare(`
      UPDATE movement_contracts
      SET status = 'CANCELED', canceled_at = ?, revision = revision + 1, updated_at = ?
      WHERE contract_id = ?
        AND status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND revision = ? AND active_contract_id = ?
        )
    `).bind(
      now,
      now,
      previousContractId,
      state.ship.ship_uid,
      state.ship.revision,
      previousContractId
    ));
  }
  const contractInsertIndex = statements.length;
  statements.push(
    db.prepare(`
      INSERT INTO movement_contracts (
        contract_id,
        client_action_id,
        world_id,
        ship_uid,
        owner_character_id,
        route_type,
        status,
        flight_at,
        arrive_at,
        state_json,
        revision,
        issued_at,
        created_at,
        updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1, ?, ?, ?
      FROM ship_locations
      WHERE ship_uid = ? AND revision = ?
    `).bind(
      contract.contractId,
      clientActionId,
      contract.worldId,
      contract.shipUid,
      contract.ownerCharacterId,
      contract.routeType,
      contract.flightAt,
      contract.arriveAt,
      JSON.stringify(contract),
      now,
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision
    ),
    db.prepare(`
      UPDATE ship_locations
      SET
        position_x = ?,
        position_y = ?,
        position_z = ?,
        rotation_x = ?,
        rotation_y = ?,
        rotation_z = ?,
        rotation_w = ?,
        speed = ?,
        desired_speed = ?,
        sector_id = ?,
        chunk_id = ?,
        active_contract_id = ?,
        movement_phase = 'MOVING',
        revision = revision + 1,
        checkpoint_at = ?,
        updated_at = ?
      WHERE ship_uid = ? AND revision = ?
    `).bind(
      anchor.position.x,
      anchor.position.y,
      anchor.position.z,
      anchor.rotation.x,
      anchor.rotation.y,
      anchor.rotation.z,
      anchor.rotation.w,
      anchor.speed,
      anchor.desiredSpeed,
      nextShip.sector_id,
      nextShip.chunk_id,
      contract.contractId,
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision
    ),
    createReceiptInsert(db, {
      clientActionId,
      ownerCharacterId: context.characterId,
      commandType: "START_NAVIGATION",
      response,
      now,
      shipUid: state.ship.ship_uid,
      expectedRevision: nextRevision,
      expectedContractId: contract.contractId
    })
  );
  const results = await db.batch(statements);
  if (statementChanges(results[contractInsertIndex]) !== 1) {
    throw navigationError(409, "MOVEMENT_REVISION_CONFLICT", "Ship movement revision changed.");
  }
  return response;
}

export async function overridePlayerNavigation(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getCommandReceipt(db, clientActionId, context.characterId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertShipCanNavigate(state);
  assertCommandRevision(state, body?.expected_revision);
  const contract = state.activeContract;
  if (!contract || state.ship.active_contract_id !== contract.contractId) {
    throw navigationError(409, "MOVEMENT_NOT_ACTIVE", "No active movement contract.");
  }
  const expectedContractId = requiredId(body?.contract_id, "movement contract");
  if (expectedContractId !== contract.contractId) {
    throw navigationError(409, "MOVEMENT_CONTRACT_CONFLICT", "Movement contract changed.");
  }
  if (contract.routeType === "hyperdrive" && now >= contract.flightAt) {
    throw navigationError(409, "HYPERDRIVE_COMMITTED", "Hyperdrive cannot be canceled after jump.");
  }

  const derived = deriveMovementState(contract, now);
  const physics = getShipPhysics(state.ship.ship_definition_id);
  const desiredSpeed = body?.desired_speed == null
    ? derived.speed
    : boundedNumber(
        body.desired_speed,
        physics.minSpeed,
        physics.maxSpeed,
        "desired speed"
      );
  const rotation = rotationForMovement(contract, state.ship.rotation, derived.phase);
  const position = derived.position;
  const zones = zoneFields(position, state.ship.spatial_mode);
  const nextRevision = state.ship.revision + 1;
  const nextShip = {
    ...state.ship,
    position,
    rotation,
    speed: derived.speed,
    desired_speed: desiredSpeed,
    active_contract_id: null,
    phase: "manual",
    revision: nextRevision,
    checkpoint_at: now,
    updated_at: now,
    ...zones
  };
  const response = publicNavigationState({
    ship: nextShip,
    activeContract: null,
    custody: null,
    betaSpaceSession: state.betaSpaceSession,
    serverTime: now
  });
  const results = await db.batch([
    db.prepare(`
      UPDATE movement_contracts
      SET status = 'CANCELED', canceled_at = ?, revision = revision + 1, updated_at = ?
      WHERE contract_id = ? AND status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND revision = ? AND active_contract_id = ?
        )
    `).bind(
      now,
      now,
      contract.contractId,
      state.ship.ship_uid,
      state.ship.revision,
      contract.contractId
    ),
    db.prepare(`
      UPDATE ship_locations
      SET
        position_x = ?,
        position_y = ?,
        position_z = ?,
        rotation_x = ?,
        rotation_y = ?,
        rotation_z = ?,
        rotation_w = ?,
        speed = ?,
        desired_speed = ?,
        sector_id = ?,
        chunk_id = ?,
        active_contract_id = NULL,
        movement_phase = 'MANUAL',
        revision = revision + 1,
        checkpoint_at = ?,
        updated_at = ?
      WHERE ship_uid = ? AND revision = ? AND active_contract_id = ?
    `).bind(
      position.x,
      position.y,
      position.z,
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
      derived.speed,
      derived.speed,
      zones.sector_id,
      zones.chunk_id,
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision,
      contract.contractId
    ),
    createReceiptInsert(db, {
      clientActionId,
      ownerCharacterId: context.characterId,
      commandType: "MANUAL_OVERRIDE",
      response,
      now,
      shipUid: state.ship.ship_uid,
      expectedRevision: nextRevision,
      expectedContractId: null
    })
  ]);
  if (statementChanges(results[1]) !== 1) {
    throw navigationError(409, "MOVEMENT_REVISION_CONFLICT", "Ship movement revision changed.");
  }
  return response;
}

export async function resumePlayerManualNavigation(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getCommandReceipt(db, clientActionId, context.characterId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertRevision(state.ship.revision, body?.expected_revision);
  assertShipNotEconomyOccupied(state);
  if (
    state.ship.spatial_mode !== FIELD_MODE
    || state.custody
    || state.betaSpaceSession
    || state.activeContract
    || state.ship.active_contract_id
  ) {
    throw navigationError(
      409,
      "MANUAL_RESUME_CONTRACT_CONFLICT",
      "Manual flight cannot resume while the ship has an authoritative occupancy contract."
    );
  }

  const physics = getShipPhysics(state.ship.ship_definition_id);
  const anchor = resolveValidatedActionAnchor(state, body?.observed_ship, physics, now);
  const zones = zoneFields(anchor.position, FIELD_MODE);
  const nextRevision = state.ship.revision + 1;
  const nextShip = {
    ...state.ship,
    position: anchor.position,
    rotation: anchor.rotation,
    speed: anchor.speed,
    desired_speed: anchor.desiredSpeed,
    active_contract_id: null,
    phase: "manual",
    revision: nextRevision,
    checkpoint_at: now,
    updated_at: now,
    ...zones
  };
  const response = publicNavigationState({
    ship: nextShip,
    activeContract: null,
    custody: null,
    betaSpaceSession: null,
    serverTime: now
  });
  const results = await db.batch([
    db.prepare(`
      UPDATE ship_locations
      SET
        position_x = ?, position_y = ?, position_z = ?,
        rotation_x = ?, rotation_y = ?, rotation_z = ?, rotation_w = ?,
        speed = ?, desired_speed = ?, sector_id = ?, chunk_id = ?,
        active_contract_id = NULL, movement_phase = 'MANUAL',
        revision = revision + 1, checkpoint_at = ?, updated_at = ?
      WHERE ship_uid = ? AND revision = ?
        AND spatial_mode = 'FIELD' AND active_contract_id IS NULL
    `).bind(
      anchor.position.x,
      anchor.position.y,
      anchor.position.z,
      anchor.rotation.x,
      anchor.rotation.y,
      anchor.rotation.z,
      anchor.rotation.w,
      anchor.speed,
      anchor.desiredSpeed,
      zones.sector_id,
      zones.chunk_id,
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision
    ),
    createReceiptInsert(db, {
      clientActionId,
      ownerCharacterId: context.characterId,
      commandType: "MANUAL_RESUME",
      response,
      now,
      shipUid: state.ship.ship_uid,
      expectedRevision: nextRevision,
      expectedContractId: null
    })
  ]);
  if (statementChanges(results[0]) !== 1) {
    throw navigationError(409, "MOVEMENT_REVISION_CONFLICT", "Ship movement revision changed.");
  }
  return response;
}

export async function dockPlayerShip(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getCommandReceipt(db, clientActionId, context.characterId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertCommandRevision(state, body?.expected_revision);
  if (state.ship.spatial_mode !== FIELD_MODE || state.custody || state.betaSpaceSession) {
    throw navigationError(409, "DOCK_SHIP_NOT_IN_FIELD", "Only a field ship can dock.");
  }

  const physics = getShipPhysics(state.ship.ship_definition_id);
  const anchor = resolveValidatedActionAnchor(state, body?.observed_ship, physics, now);

  const buildingId = requiredId(body?.building_id, "building");
  const building = await getWorldEntity(db, "building", buildingId);
  if (!building) {
    throw navigationError(404, "DOCK_BUILDING_NOT_FOUND", "Docking building does not exist.");
  }
  const storage = await getBuildingStorage(db, buildingId);
  const capacity = Math.max(0, Math.floor(Number(storage?.docking_capacity) || 0));
  if (capacity <= 0) {
    throw navigationError(409, "DOCK_BUILDING_UNAVAILABLE", "Building has no available hangar.");
  }
  const buildingPosition = normalizePosition(building.position);
  const maximumDistance = DOCK_RANGE_RENDER_UNITS / WORLD_TEMPLATE.movementConfig.renderScale;
  if (distanceBetween(anchor.position, buildingPosition) > maximumDistance) {
    throw navigationError(409, "DOCK_OUT_OF_RANGE", "Ship is outside docking range.");
  }

  const occupied = await db.prepare(`
    SELECT slot
    FROM ship_custodies
    WHERE world_id = ? AND custodian_type = 'BUILDING' AND custodian_id = ?
    ORDER BY slot
  `).bind(state.ship.world_id, buildingId).all();
  const occupiedSlots = new Set((occupied?.results || []).map((row) => Number(row.slot)));
  let slot = -1;
  for (let candidate = 0; candidate < capacity; candidate += 1) {
    if (!occupiedSlots.has(candidate)) {
      slot = candidate;
      break;
    }
  }
  if (slot < 0) throw navigationError(409, "DOCK_HANGAR_FULL", "Building hangar is full.");

  const nextRevision = state.ship.revision + 1;
  const custody = {
    type: "BUILDING",
    id: buildingId,
    slot,
    sinceAt: now,
    revision: 1,
    resolvedPosition: buildingPosition
  };
  const dockPhase = state.ship.phase === "arrived" ? "arrived" : "manual";
  const nextShip = {
    ...state.ship,
    position: anchor.position,
    rotation: anchor.rotation,
    speed: 0,
    desired_speed: 0,
    spatial_mode: "DOCKED",
    sector_id: null,
    chunk_id: null,
    active_contract_id: null,
    phase: dockPhase,
    revision: nextRevision,
    checkpoint_at: now,
    updated_at: now
  };
  const response = publicNavigationState({
    ship: nextShip,
    activeContract: null,
    custody,
    betaSpaceSession: null,
    serverTime: now
  });
  const statements = [];
  if (state.activeContract) {
    statements.push(db.prepare(`
      UPDATE movement_contracts
      SET status = 'CANCELED', canceled_at = ?, revision = revision + 1, updated_at = ?
      WHERE contract_id = ? AND status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND revision = ? AND active_contract_id = ?
        )
    `).bind(
      now,
      now,
      state.activeContract.contractId,
      state.ship.ship_uid,
      state.ship.revision,
      state.activeContract.contractId
    ));
  }
  const custodyInsertIndex = statements.length;
  statements.push(
    db.prepare(`
      INSERT INTO ship_custodies (
        ship_uid, world_id, custodian_type, custodian_id, slot,
        since_at, revision, created_at, updated_at
      )
      SELECT ?, ?, 'BUILDING', ?, ?, ?, 1, ?, ?
      FROM ship_locations
      WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'FIELD'
    `).bind(
      state.ship.ship_uid,
      state.ship.world_id,
      buildingId,
      slot,
      now,
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision
    ),
    db.prepare(`
      UPDATE ship_locations
      SET
        spatial_mode = 'DOCKED',
        position_x = ?, position_y = ?, position_z = ?,
        rotation_x = ?, rotation_y = ?, rotation_z = ?, rotation_w = ?,
        speed = 0, desired_speed = 0,
        sector_id = NULL, chunk_id = NULL, active_contract_id = NULL,
        movement_phase = ?,
        revision = revision + 1, checkpoint_at = ?, updated_at = ?
      WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'FIELD'
    `).bind(
      anchor.position.x,
      anchor.position.y,
      anchor.position.z,
      anchor.rotation.x,
      anchor.rotation.y,
      anchor.rotation.z,
      anchor.rotation.w,
      dockPhase.toUpperCase(),
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision
    ),
    createReceiptInsert(db, {
      clientActionId,
      ownerCharacterId: context.characterId,
      commandType: "DOCK",
      response,
      now,
      shipUid: state.ship.ship_uid,
      expectedRevision: nextRevision,
      expectedContractId: null
    })
  );

  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (/unique|constraint/i.test(String(error?.message || error))) {
      throw navigationError(409, "DOCK_SLOT_CONFLICT", "Hangar availability changed.");
    }
    throw error;
  }
  if (statementChanges(results[custodyInsertIndex]) !== 1) {
    throw navigationError(409, "MOVEMENT_REVISION_CONFLICT", "Ship movement revision changed.");
  }
  return response;
}

export async function undockPlayerShip(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getCommandReceipt(db, clientActionId, context.characterId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertCommandRevision(state, body?.expected_revision);
  const custody = state.custody;
  if (state.ship.spatial_mode !== "DOCKED" || custody?.type !== "BUILDING") {
    throw navigationError(409, "UNDOCK_SHIP_NOT_DOCKED", "Ship is not docked at a building.");
  }
  const requestedBuildingId = body?.building_id == null
    ? custody.id
    : requiredId(body.building_id, "building");
  if (requestedBuildingId !== custody.id) {
    throw navigationError(409, "UNDOCK_CUSTODY_CONFLICT", "Ship custody changed.");
  }

  const building = await getWorldEntity(db, "building", custody.id);
  if (!building) {
    throw navigationError(409, "UNDOCK_BUILDING_UNAVAILABLE", "Custodian building is unavailable.");
  }
  const facing = getBuildingDockingFacing(building.building_id);
  const position = addScaled(normalizePosition(building.position), facing, UNDOCK_OFFSET_DATA_UNITS);
  const rotation = quaternionFromForward(facing);
  const zones = zoneFields(position, FIELD_MODE);
  const nextRevision = state.ship.revision + 1;
  const nextShip = {
    ...state.ship,
    spatial_mode: FIELD_MODE,
    position,
    rotation,
    speed: 0,
    desired_speed: 0,
    sector_id: zones.sector_id,
    chunk_id: zones.chunk_id,
    active_contract_id: null,
    phase: "manual",
    revision: nextRevision,
    checkpoint_at: now,
    updated_at: now
  };
  const response = publicNavigationState({
    ship: nextShip,
    activeContract: null,
    custody: null,
    betaSpaceSession: null,
    serverTime: now
  });
  const results = await db.batch([
    db.prepare(`
      DELETE FROM ship_custodies
      WHERE ship_uid = ? AND custodian_type = 'BUILDING' AND custodian_id = ?
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'DOCKED'
        )
    `).bind(
      state.ship.ship_uid,
      custody.id,
      state.ship.ship_uid,
      state.ship.revision
    ),
    db.prepare(`
      UPDATE ship_locations
      SET
        spatial_mode = 'FIELD',
        position_x = ?, position_y = ?, position_z = ?,
        rotation_x = ?, rotation_y = ?, rotation_z = ?, rotation_w = ?,
        speed = 0, desired_speed = 0,
        sector_id = ?, chunk_id = ?, active_contract_id = NULL,
        movement_phase = 'MANUAL',
        revision = revision + 1, checkpoint_at = ?, updated_at = ?
      WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'DOCKED'
    `).bind(
      position.x,
      position.y,
      position.z,
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
      zones.sector_id,
      zones.chunk_id,
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision
    ),
    createReceiptInsert(db, {
      clientActionId,
      ownerCharacterId: context.characterId,
      commandType: "UNDOCK",
      response,
      now,
      shipUid: state.ship.ship_uid,
      expectedRevision: nextRevision,
      expectedContractId: null
    })
  ]);
  if (statementChanges(results[0]) !== 1 || statementChanges(results[1]) !== 1) {
    throw navigationError(409, "MOVEMENT_REVISION_CONFLICT", "Ship movement revision changed.");
  }
  return response;
}

export async function enterPlayerBetaSpace(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getCommandReceipt(db, clientActionId, context.characterId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertCommandRevision(state, body?.expected_revision);
  if (state.ship.spatial_mode !== FIELD_MODE || state.custody || state.betaSpaceSession) {
    throw navigationError(409, "BETA_ENTRY_SHIP_NOT_IN_FIELD", "Only a field ship can enter Beta Space.");
  }
  const betaVoidId = requiredId(body?.beta_void_id, "Beta Void");
  const betaVoid = await getWorldEntityState(
    db,
    "beta_void",
    betaVoidId,
    now,
    context.worldEntropySecret
  );
  if (!betaVoid || betaVoid.status !== "active") {
    throw navigationError(409, "BETA_VOID_UNAVAILABLE", "Beta Void is unavailable.");
  }
  const generation = positiveInteger(betaVoid.variant_generation, "Beta Void generation");
  const expectedGeneration = positiveInteger(body?.expected_generation, "Beta Void generation");
  if (generation !== expectedGeneration) {
    throw navigationError(409, "BETA_VOID_GENERATION_CHANGED", "Beta Void generation changed.");
  }
  const expiresAt = Number(betaVoid.active_reset_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw navigationError(409, "BETA_VOID_EXPIRED", "Beta Void has expired.");
  }

  const physics = getShipPhysics(state.ship.ship_definition_id);
  const returnAnchor = resolveValidatedActionAnchor(
    state,
    body?.observed_ship,
    physics,
    now
  );
  const spawnPosition = betaSpaceSpawnPosition();
  const zones = zoneFields(spawnPosition, "BETA_SPACE");
  const sessionId = `beta-session-${crypto.randomUUID()}`;
  const session = {
    sessionId,
    sourceBetaVoidId: betaVoidId,
    sourceGeneration: generation,
    enteredAt: now,
    expiresAt,
    returnPosition: returnAnchor.position,
    returnRotation: returnAnchor.rotation,
    returnSpeed: returnAnchor.speed,
    returnDesiredSpeed: returnAnchor.desiredSpeed
  };
  const nextRevision = state.ship.revision + 1;
  const nextShip = {
    ...state.ship,
    spatial_mode: "BETA_SPACE",
    position: spawnPosition,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    speed: 0,
    desired_speed: 0,
    sector_id: zones.sector_id,
    chunk_id: zones.chunk_id,
    active_contract_id: null,
    phase: "manual",
    revision: nextRevision,
    checkpoint_at: now,
    updated_at: now
  };
  const response = publicNavigationState({
    ship: nextShip,
    activeContract: null,
    custody: null,
    betaSpaceSession: session,
    serverTime: now
  });
  const statements = [];
  if (state.activeContract) {
    statements.push(db.prepare(`
      UPDATE movement_contracts
      SET status = 'CANCELED', canceled_at = ?, revision = revision + 1, updated_at = ?
      WHERE contract_id = ? AND status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND revision = ? AND active_contract_id = ?
        )
    `).bind(
      now,
      now,
      state.activeContract.contractId,
      state.ship.ship_uid,
      state.ship.revision,
      state.activeContract.contractId
    ));
  }
  const sessionInsertIndex = statements.length;
  statements.push(
    db.prepare(`
      INSERT INTO beta_space_sessions (
        session_id, world_id, ship_uid, owner_character_id,
        source_beta_void_id, source_generation, status,
        entered_at, expires_at,
        return_position_x, return_position_y, return_position_z,
        return_rotation_x, return_rotation_y, return_rotation_z, return_rotation_w,
        return_speed, return_desired_speed,
        created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM ship_locations
      WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'FIELD'
    `).bind(
      sessionId,
      state.ship.world_id,
      state.ship.ship_uid,
      state.ship.owner_character_id,
      betaVoidId,
      generation,
      now,
      expiresAt,
      returnAnchor.position.x,
      returnAnchor.position.y,
      returnAnchor.position.z,
      returnAnchor.rotation.x,
      returnAnchor.rotation.y,
      returnAnchor.rotation.z,
      returnAnchor.rotation.w,
      returnAnchor.speed,
      returnAnchor.desiredSpeed,
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision
    ),
    db.prepare(`
      UPDATE ship_locations
      SET
        spatial_mode = 'BETA_SPACE',
        position_x = ?, position_y = ?, position_z = ?,
        rotation_x = 0, rotation_y = 0, rotation_z = 0, rotation_w = 1,
        speed = 0, desired_speed = 0,
        sector_id = ?, chunk_id = ?, active_contract_id = NULL,
        movement_phase = 'MANUAL',
        revision = revision + 1, checkpoint_at = ?, updated_at = ?
      WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'FIELD'
    `).bind(
      spawnPosition.x,
      spawnPosition.y,
      spawnPosition.z,
      zones.sector_id,
      zones.chunk_id,
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision
    ),
    createReceiptInsert(db, {
      clientActionId,
      ownerCharacterId: context.characterId,
      commandType: "ENTER_BETA_SPACE",
      response,
      now,
      shipUid: state.ship.ship_uid,
      expectedRevision: nextRevision,
      expectedContractId: null
    })
  );
  const results = await db.batch(statements);
  if (statementChanges(results[sessionInsertIndex]) !== 1) {
    throw navigationError(409, "MOVEMENT_REVISION_CONFLICT", "Ship movement revision changed.");
  }
  return response;
}

export async function exitPlayerBetaSpace(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getCommandReceipt(db, clientActionId, context.characterId);
  if (receipt) return receipt;
  assertCommandDeadline(body, now);

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertCommandRevision(state, body?.expected_revision);
  const session = state.betaSpaceSession;
  if (state.ship.spatial_mode !== "BETA_SPACE" || !session) {
    throw navigationError(409, "BETA_SESSION_NOT_ACTIVE", "Ship is not in Beta Space.");
  }
  const nextRevision = state.ship.revision + 1;
  const position = session.returnPosition;
  const rotation = session.returnRotation;
  const zones = zoneFields(position, FIELD_MODE);
  const nextShip = {
    ...state.ship,
    spatial_mode: FIELD_MODE,
    position,
    rotation,
    speed: session.returnSpeed,
    desired_speed: session.returnDesiredSpeed,
    sector_id: zones.sector_id,
    chunk_id: zones.chunk_id,
    active_contract_id: null,
    phase: "manual",
    revision: nextRevision,
    checkpoint_at: now,
    updated_at: now
  };
  const response = publicNavigationState({
    ship: nextShip,
    activeContract: null,
    custody: null,
    betaSpaceSession: null,
    serverTime: now
  });
  const statements = [];
  if (state.activeContract) {
    statements.push(db.prepare(`
      UPDATE movement_contracts
      SET status = 'CANCELED', canceled_at = ?, revision = revision + 1, updated_at = ?
      WHERE contract_id = ? AND status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND revision = ? AND active_contract_id = ?
        )
    `).bind(
      now,
      now,
      state.activeContract.contractId,
      state.ship.ship_uid,
      state.ship.revision,
      state.activeContract.contractId
    ));
  }
  const sessionUpdateIndex = statements.length;
  statements.push(
    db.prepare(`
      UPDATE beta_space_sessions
      SET status = 'EXITED', returned_at = ?, updated_at = ?
      WHERE session_id = ? AND ship_uid = ? AND status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'BETA_SPACE'
        )
    `).bind(
      now,
      now,
      session.sessionId,
      state.ship.ship_uid,
      state.ship.ship_uid,
      state.ship.revision
    ),
    db.prepare(`
      UPDATE ship_locations
      SET
        spatial_mode = 'FIELD',
        position_x = ?, position_y = ?, position_z = ?,
        rotation_x = ?, rotation_y = ?, rotation_z = ?, rotation_w = ?,
        speed = ?, desired_speed = ?,
        sector_id = ?, chunk_id = ?, active_contract_id = NULL,
        movement_phase = 'MANUAL',
        revision = revision + 1, checkpoint_at = ?, updated_at = ?
      WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'BETA_SPACE'
    `).bind(
      position.x,
      position.y,
      position.z,
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
      session.returnSpeed,
      session.returnDesiredSpeed,
      zones.sector_id,
      zones.chunk_id,
      now,
      now,
      state.ship.ship_uid,
      state.ship.revision
    ),
    createReceiptInsert(db, {
      clientActionId,
      ownerCharacterId: context.characterId,
      commandType: "EXIT_BETA_SPACE",
      response,
      now,
      shipUid: state.ship.ship_uid,
      expectedRevision: nextRevision,
      expectedContractId: null
    })
  );
  const results = await db.batch(statements);
  if (statementChanges(results[sessionUpdateIndex]) !== 1) {
    throw navigationError(409, "MOVEMENT_REVISION_CONFLICT", "Ship movement revision changed.");
  }
  return response;
}

export async function getPlayerCommandResult(db, context, clientActionId, now = Date.now()) {
  const actionId = requiredId(clientActionId, "client action");
  const receipt = await getCommandReceiptRecord(db, actionId, context.characterId);
  if (!receipt) return null;
  return {
    status: "ACCEPTED",
    client_action_id: actionId,
    command_type: receipt.commandType,
    navigation: receipt.response,
    recorded_at: receipt.createdAt,
    checked_at: now
  };
}

export async function listZoneShipPeers(
  db,
  zoneId,
  { excludedCharacterId = null, limit = 64, now = Date.now() } = {}
) {
  await ensureWorldInitialized(db);
  const normalizedZone = requiredId(zoneId, "zone");
  const normalizedLimit = normalizeObservationLimit(limit);
  const scanLimit = Math.min(1024, Math.max(128, normalizedLimit * 8));
  const spatialMode = normalizedZone === BETA_SPACE_ID ? "BETA_SPACE" : FIELD_MODE;
  const shipResult = await db.prepare(`
    SELECT *
    FROM ship_locations
    WHERE world_id = ?
      AND (
        (? = 'BETA_SPACE' AND spatial_mode = 'BETA_SPACE')
        OR (
          ? = 'FIELD'
          AND (
            spatial_mode = 'BETA_SPACE'
            OR (
              spatial_mode = 'FIELD'
              AND (
                sector_id = ?
                OR chunk_id = ?
                OR active_contract_id IS NOT NULL
              )
            )
          )
        )
      )
    ORDER BY
      CASE WHEN sector_id = ? OR chunk_id = ? THEN 0 ELSE 1 END,
      owner_character_id,
      ship_uid
    LIMIT ?
  `).bind(
    PRIMARY_WORLD_ID,
    spatialMode,
    spatialMode,
    normalizedZone,
    normalizedZone,
    normalizedZone,
    normalizedZone,
    scanLimit
  ).all();
  const shipRows = shipResult?.results || [];
  const { contracts, betaSessions } = await loadObservedShipDependencies(db, shipRows);
  const peers = [];
  for (const row of shipRows) {
    const storedShip = shipFromRow(row);
    const peer = observedShipPeer({
      storedShip,
      contract: storedShip.active_contract_id
        ? contracts.get(storedShip.active_contract_id) || null
        : null,
      betaSpaceSession: betaSessions.get(storedShip.ship_uid) || null,
      now
    });
    if (peer.spatial_mode !== spatialMode) continue;
    if (peer.character_id === excludedCharacterId) continue;
    if (peer.zone_id !== normalizedZone) continue;
    peers.push(peer);
    if (peers.length >= normalizedLimit) break;
  }
  return {
    scope: "zone",
    zone_id: normalizedZone,
    server_time: now,
    peers
  };
}

export async function observeSpaceShips(
  db,
  {
    zoneId = null,
    characterId = null,
    shipUid = null,
    excludedCharacterId = null,
    limit = 64,
    now = Date.now()
  } = {}
) {
  if (!characterId && !shipUid) {
    return listZoneShipPeers(db, zoneId, { excludedCharacterId, limit, now });
  }

  await ensureWorldInitialized(db);
  const normalizedCharacterId = characterId
    ? requiredId(characterId, "observed character")
    : null;
  const normalizedShipUid = shipUid ? requiredId(shipUid, "observed ship") : null;
  const normalizedLimit = normalizeObservationLimit(limit);
  const filters = ["world_id = ?"];
  const bindings = [PRIMARY_WORLD_ID];
  if (normalizedCharacterId) {
    filters.push("owner_character_id = ?");
    bindings.push(normalizedCharacterId);
  }
  if (normalizedShipUid) {
    filters.push("ship_uid = ?");
    bindings.push(normalizedShipUid);
  }
  bindings.push(normalizedLimit);
  const shipResult = await db.prepare(`
    SELECT *
    FROM ship_locations
    WHERE ${filters.join(" AND ")}
    ORDER BY ship_uid
    LIMIT ?
  `).bind(...bindings).all();
  const shipRows = shipResult?.results || [];
  const { contracts, betaSessions } = await loadObservedShipDependencies(db, shipRows);
  const peers = shipRows
    .map((row) => {
      const storedShip = shipFromRow(row);
      return observedShipPeer({
        storedShip,
        contract: storedShip.active_contract_id
          ? contracts.get(storedShip.active_contract_id) || null
          : null,
        betaSpaceSession: betaSessions.get(storedShip.ship_uid) || null,
        now
      });
    })
    .filter((peer) => peer.character_id !== excludedCharacterId);
  return {
    scope: "ship",
    zone_id: null,
    selector: {
      character_id: normalizedCharacterId,
      ship_uid: normalizedShipUid
    },
    server_time: now,
    peers
  };
}

async function loadObservedShipDependencies(db, shipRows) {
  const selectedShipUids = shipRows.map((row) => row.ship_uid);
  const selectedContractIds = shipRows
    .map((row) => row.active_contract_id)
    .filter(Boolean);
  const statements = [];
  const contractIndex = selectedContractIds.length > 0 ? statements.length : -1;
  if (contractIndex >= 0) {
    statements.push(db.prepare(`
      SELECT * FROM movement_contracts
      WHERE contract_id IN (${selectedContractIds.map(() => "?").join(", ")})
    `).bind(...selectedContractIds));
  }
  const betaSessionIndex = selectedShipUids.length > 0 ? statements.length : -1;
  if (betaSessionIndex >= 0) {
    statements.push(db.prepare(`
      SELECT * FROM beta_space_sessions
      WHERE ship_uid IN (${selectedShipUids.map(() => "?").join(", ")})
        AND status = 'ACTIVE'
    `).bind(...selectedShipUids));
  }
  const results = statements.length > 0 ? await db.batch(statements) : [];
  const contracts = new Map(
    (results[contractIndex]?.results || []).map((row) => [
      row.contract_id,
      contractFromRow(row)
    ])
  );
  const betaSessions = new Map(
    (results[betaSessionIndex]?.results || []).map((row) => [
      row.ship_uid,
      betaSpaceSessionFromRow(row)
    ])
  );
  return { contracts, betaSessions };
}

function observedShipPeer({ storedShip, contract, betaSpaceSession, now }) {
  const ship = deriveExpiredBetaSpaceShip(storedShip, betaSpaceSession, now);
  const common = {
    character_id: ship.owner_character_id,
    display_name: ship.display_name,
    ship_id: ship.ship_definition_id,
    ship_uid: ship.ship_uid,
    spatial_mode: ship.spatial_mode,
    updated_at: Math.max(ship.updated_at, contract?.updatedAt || 0),
    source: "authority"
  };
  if (ship.spatial_mode === "DOCKED") {
    return { ...common, zone_id: null, pose: null, route: null };
  }

  const derived = contract
    ? deriveMovementState(contract, now)
    : {
        position: ship.position,
        speed: ship.speed,
        desiredSpeed: ship.desired_speed,
        phase: ship.phase,
        logicalStatus: "ACTIVE"
      };
  const zones = zoneFields(derived.position, ship.spatial_mode);
  const rotation = contract
    ? rotationForMovement(contract, ship.rotation, derived.phase)
    : ship.rotation;
  const heading = contract?.heading || quaternionForward(rotation);
  return {
    ...common,
    zone_id: ship.spatial_mode === "BETA_SPACE"
      ? BETA_SPACE_ID
      : zones.sector_id || zones.chunk_id,
    pose: {
      seq: ship.revision,
      ship_id: ship.ship_definition_id,
      position: derived.position,
      rotation,
      velocity: {
        x: heading.x * derived.speed,
        y: heading.y * derived.speed,
        z: heading.z * derived.speed
      },
      speed: derived.speed,
      server_at: now
    },
    route: contract && derived.logicalStatus === "ACTIVE"
      ? realtimeContract(contract)
      : null
  };
}

function normalizeObservationLimit(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? clamp(number, 1, 64) : 64;
}

export async function getNavigationAdminSummary(db, now = Date.now()) {
  await ensureWorldInitialized(db);
  const [shipCount, fieldCount, activeCount] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM ship_locations WHERE world_id = ?")
      .bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM ship_locations AS ship
      WHERE ship.world_id = ?
        AND (
          ship.spatial_mode = 'FIELD'
          OR (
            ship.spatial_mode = 'BETA_SPACE'
            AND EXISTS (
              SELECT 1 FROM beta_space_sessions AS session
              WHERE session.ship_uid = ship.ship_uid
                AND session.status = 'ACTIVE'
                AND session.expires_at <= ?
            )
          )
        )
    `).bind(PRIMARY_WORLD_ID, now),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM movement_contracts
      WHERE world_id = ? AND status = 'ACTIVE' AND arrive_at > ?
    `).bind(PRIMARY_WORLD_ID, now)
  ]);
  return {
    ships: Number(shipCount?.results?.[0]?.count) || 0,
    field_ships: Number(fieldCount?.results?.[0]?.count) || 0,
    active_movements: Number(activeCount?.results?.[0]?.count) || 0
  };
}

export async function listNavigationAdminShips(db, now = Date.now()) {
  await ensureWorldInitialized(db);
  const [
    shipResult,
    contractResult,
    custodyResult,
    buildingResult,
    betaSessionResult
  ] = await db.batch([
    db.prepare(`
      SELECT *
      FROM ship_locations
      WHERE world_id = ?
      ORDER BY owner_character_id, ship_uid
      LIMIT 500
    `).bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT *
      FROM movement_contracts
      WHERE world_id = ? AND status = 'ACTIVE'
    `).bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT *
      FROM ship_custodies
      WHERE world_id = ?
    `).bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT entity_id, state_json
      FROM world_entities
      WHERE world_id = ? AND entity_type = 'building'
    `).bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT *
      FROM beta_space_sessions
      WHERE world_id = ? AND status = 'ACTIVE'
    `).bind(PRIMARY_WORLD_ID)
  ]);
  const contracts = new Map(
    (contractResult?.results || []).map((row) => [row.contract_id, contractFromRow(row)])
  );
  const custodies = new Map(
    (custodyResult?.results || []).map((row) => [row.ship_uid, row])
  );
  const buildings = new Map(
    (buildingResult?.results || []).map((row) => [row.entity_id, JSON.parse(row.state_json)])
  );
  const betaSessions = new Map(
    (betaSessionResult?.results || []).map((row) => [row.ship_uid, betaSpaceSessionFromRow(row)])
  );
  return (shipResult?.results || []).map((row) => {
    const storedShip = shipFromRow(row);
    const ship = deriveExpiredBetaSpaceShip(
      storedShip,
      betaSessions.get(storedShip.ship_uid) || null,
      now
    );
    const contract = ship.active_contract_id
      ? contracts.get(ship.active_contract_id) || null
      : null;
    const derived = contract ? deriveMovementState(contract, now) : null;
    const custodyRow = custodies.get(ship.ship_uid) || null;
    const custodyBuilding = custodyRow ? buildings.get(custodyRow.custodian_id) || null : null;
    const position = custodyRow ? null : derived?.position || ship.position;
    const resolvedPosition = custodyBuilding ? normalizePosition(custodyBuilding.position) : null;
    const rotation = contract
      ? rotationForMovement(contract, ship.rotation, derived.phase)
      : ship.rotation;
    const zones = custodyBuilding
      ? { sector_id: custodyBuilding.sector_id || null, chunk_id: custodyBuilding.chunk_id || null }
      : zoneFields(position, ship.spatial_mode);
    return {
      ship_uid: ship.ship_uid,
      owner_character_id: ship.owner_character_id,
      display_name: ship.display_name,
      ship_definition_id: ship.ship_definition_id,
      spatial_mode: ship.spatial_mode,
      sector_id: zones.sector_id,
      chunk_id: zones.chunk_id,
      phase: derived?.phase || ship.phase,
      route_type: contract?.routeType || null,
      contract_id: contract?.contractId || null,
      position,
      resolved_position: resolvedPosition,
      custody: custodyRow
        ? {
            type: custodyRow.custodian_type,
            id: custodyRow.custodian_id,
            slot: Number(custodyRow.slot),
            since_at: Number(custodyRow.since_at),
            revision: Number(custodyRow.revision)
          }
        : null,
      beta_space_session: ship.spatial_mode === "BETA_SPACE" && betaSessions.has(ship.ship_uid)
        ? publicBetaSpaceSession(betaSessions.get(ship.ship_uid))
        : null,
      rotation,
      speed: derived?.speed ?? ship.speed,
      desired_speed: derived?.desiredSpeed ?? ship.desired_speed,
      active_contract: contract ? publicContract(contract) : null,
      revision: ship.revision,
      checkpoint_at: ship.checkpoint_at,
      updated_at: ship.updated_at
    };
  });
}

export async function listNavigationAdminHistory(db, {
  shipUid = null,
  ownerCharacterId = null,
  routeType = null,
  status = null,
  limit = 100,
  now = Date.now()
} = {}) {
  await ensureWorldInitialized(db);
  const conditions = ["c.world_id = ?"];
  const values = [PRIMARY_WORLD_ID];
  const normalizedShipUid = optionalAdminId(shipUid, "ship");
  const normalizedOwner = optionalAdminId(ownerCharacterId, "character");
  const normalizedRouteType = optionalRouteType(routeType);
  const normalizedStatus = optionalMovementStatus(status);
  const normalizedLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));

  if (normalizedShipUid) {
    conditions.push("c.ship_uid = ?");
    values.push(normalizedShipUid);
  }
  if (normalizedOwner) {
    conditions.push("c.owner_character_id = ?");
    values.push(normalizedOwner);
  }
  if (normalizedRouteType) {
    conditions.push("c.route_type = ?");
    values.push(normalizedRouteType);
  }
  if (normalizedStatus) {
    conditions.push("c.status = ?");
    values.push(normalizedStatus);
  }
  values.push(normalizedLimit);

  const result = await db.prepare(`
    SELECT
      c.*,
      s.display_name AS ship_display_name,
      s.ship_definition_id AS current_ship_definition_id,
      s.spatial_mode AS current_spatial_mode
    FROM movement_contracts c
    LEFT JOIN ship_locations s ON s.ship_uid = c.ship_uid
    WHERE ${conditions.join(" AND ")}
    ORDER BY c.issued_at DESC, c.contract_id DESC
    LIMIT ?
  `).bind(...values).all();

  return (result?.results || []).map((row) => {
    const contract = contractFromRow(row);
    const resolvedAt = contract.status === "CANCELED"
      ? contract.canceledAt || contract.updatedAt
      : contract.status === "ARRIVED"
        ? contract.arriveAt
        : now;
    const derived = deriveMovementState(contract, resolvedAt);
    return {
      ...publicContract(contract),
      owner_character_id: contract.ownerCharacterId,
      ship_uid: contract.shipUid,
      display_name: row.ship_display_name || contract.ownerCharacterId,
      ship_definition_id: row.current_ship_definition_id || contract.shipDefinitionId,
      current_spatial_mode: row.current_spatial_mode || null,
      resolved_position: derived.position,
      resolved_speed: derived.speed,
      resolved_phase: derived.phase
    };
  });
}

async function getOrCreateShip(db, context, now) {
  const shipUid = requiredId(context.shipUid, "ship");
  const existing = await db.prepare(
    "SELECT * FROM ship_locations WHERE ship_uid = ?"
  ).bind(shipUid).first();
  if (existing) {
    if (existing.owner_character_id !== context.characterId) {
      throw navigationError(403, "SHIP_OWNERSHIP_INVALID", "Ship ownership mismatch.");
    }
    return shipFromRow({
      ...existing,
      display_name: normalizeDisplayName(context.displayName),
      ship_definition_id: normalizeShipDefinitionId(context.shipDefinitionId)
    });
  }

  const position = defaultSpawnPosition();
  const zones = zoneFields(position);
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  await db.prepare(`
    INSERT OR IGNORE INTO ship_locations (
      ship_uid,
      world_id,
      owner_character_id,
      display_name,
      ship_definition_id,
      spatial_mode,
      position_x,
      position_y,
      position_z,
      rotation_x,
      rotation_y,
      rotation_z,
      rotation_w,
      speed,
      desired_speed,
      sector_id,
      chunk_id,
      active_contract_id,
      revision,
      checkpoint_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL, 1, ?, ?, ?)
  `).bind(
    shipUid,
    PRIMARY_WORLD_ID,
    requiredId(context.characterId, "character"),
    normalizeDisplayName(context.displayName),
    normalizeShipDefinitionId(context.shipDefinitionId),
    FIELD_MODE,
    position.x,
    position.y,
    position.z,
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
    zones.sector_id,
    zones.chunk_id,
    now,
    now,
    now
  ).run();
  const row = await db.prepare(
    "SELECT * FROM ship_locations WHERE ship_uid = ?"
  ).bind(shipUid).first();
  if (!row) throw navigationError(500, "SHIP_STATE_UNAVAILABLE", "Ship state unavailable.");
  return shipFromRow(row);
}

async function resolvePlayerState(db, initialShip, now, { materializeArrival }) {
  let ship = initialShip;
  let contract = ship.active_contract_id
    ? await getContract(db, ship.active_contract_id)
    : null;
  if (!contract || contract.status !== "ACTIVE") {
    if (ship.active_contract_id) {
      await db.prepare(`
        UPDATE ship_locations
        SET active_contract_id = NULL, revision = revision + 1, updated_at = ?
        WHERE ship_uid = ? AND revision = ?
      `).bind(now, ship.ship_uid, ship.revision).run();
      ship = shipFromRow(await db.prepare(
        "SELECT * FROM ship_locations WHERE ship_uid = ?"
      ).bind(ship.ship_uid).first());
    }
    return {
      ship,
      activeContract: null,
      serverTime: now
    };
  }

  const derived = deriveMovementState(contract, now);
  if (derived.logicalStatus === "ARRIVED" && materializeArrival) {
    const arrivalFromRevision = ship.revision;
    const rotation = rotationForMovement(contract, ship.rotation, "arrived");
    const zones = zoneFields(contract.target, ship.spatial_mode);
    const results = await db.batch([
      db.prepare(`
        UPDATE movement_contracts
        SET status = 'ARRIVED', settled_at = ?, revision = revision + 1, updated_at = ?
        WHERE contract_id = ? AND status = 'ACTIVE'
      `).bind(now, now, contract.contractId),
      db.prepare(`
        UPDATE ship_locations
        SET
          position_x = ?,
          position_y = ?,
          position_z = ?,
          rotation_x = ?,
          rotation_y = ?,
          rotation_z = ?,
          rotation_w = ?,
          speed = 0,
          desired_speed = 0,
          sector_id = ?,
          chunk_id = ?,
          active_contract_id = NULL,
          movement_phase = 'ARRIVED',
          revision = revision + 1,
          checkpoint_at = ?,
          updated_at = ?
        WHERE ship_uid = ? AND revision = ? AND active_contract_id = ?
      `).bind(
        contract.target.x,
        contract.target.y,
        contract.target.z,
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
        zones.sector_id,
        zones.chunk_id,
        contract.arriveAt,
        now,
        ship.ship_uid,
        ship.revision,
        contract.contractId
      )
    ]);
    if (statementChanges(results[1]) === 1) {
      ship = shipFromRow(await db.prepare(
        "SELECT * FROM ship_locations WHERE ship_uid = ?"
      ).bind(ship.ship_uid).first());
      return {
        ship: { ...ship, phase: "arrived" },
        activeContract: null,
        serverTime: now,
        arrivalRevisionTransition: {
          fromRevision: arrivalFromRevision,
          toRevision: ship.revision
        }
      };
    }
    ship = shipFromRow(await db.prepare(
      "SELECT * FROM ship_locations WHERE ship_uid = ?"
    ).bind(ship.ship_uid).first());
    const resolved = await resolvePlayerState(db, ship, now, { materializeArrival });
    if (
      !resolved.arrivalRevisionTransition
      && resolved.ship.revision === arrivalFromRevision + 1
      && resolved.ship.phase === "arrived"
      && !resolved.activeContract
    ) {
      return {
        ...resolved,
        arrivalRevisionTransition: {
          fromRevision: arrivalFromRevision,
          toRevision: resolved.ship.revision
        }
      };
    }
    return resolved;
  }

  const rotation = rotationForMovement(contract, ship.rotation, derived.phase);
  return {
    ship: {
      ...ship,
      position: derived.position,
      rotation,
      speed: derived.speed,
      desired_speed: derived.desiredSpeed,
      phase: derived.phase,
      checkpoint_at: derived.logicalStatus === "ARRIVED"
        ? contract.arriveAt
        : ship.checkpoint_at,
      ...zoneFields(derived.position, ship.spatial_mode)
    },
    activeContract: derived.logicalStatus === "ACTIVE" ? contract : null,
    serverTime: now
  };
}

async function attachPlacementState(db, state) {
  const custody = state.ship.spatial_mode === "DOCKED"
    ? await getShipCustody(db, state.ship.ship_uid)
    : null;
  const betaSpaceSession = state.ship.spatial_mode === "BETA_SPACE"
    ? await getActiveBetaSpaceSession(db, state.ship.ship_uid)
    : null;
  const economyOccupancy = await getActiveEconomyOccupancy(
    db,
    state.ship.ship_uid,
    state.serverTime
  );
  if (state.ship.spatial_mode === "DOCKED" && !custody) {
    throw navigationError(500, "SHIP_CUSTODY_MISSING", "Docked ship custody is missing.");
  }
  if (state.ship.spatial_mode === "BETA_SPACE" && !betaSpaceSession) {
    throw navigationError(500, "BETA_SESSION_MISSING", "Beta Space session is missing.");
  }
  return { ...state, custody, betaSpaceSession, economyOccupancy };
}

async function getActiveEconomyOccupancy(db, shipUid, now) {
  const row = await db.prepare(`
    SELECT * FROM economy_occupancies
    WHERE ship_uid = ? AND busy_until > ?
  `).bind(shipUid, now).first();
  if (!row) return null;
  return {
    type: row.occupancy_type,
    contractId: row.contract_id,
    worldObjectId: row.world_object_id,
    startedAt: Number(row.started_at),
    busyUntil: Number(row.busy_until),
    revision: Number(row.revision)
  };
}

async function getShipCustody(db, shipUid) {
  const row = await db.prepare(`
    SELECT *
    FROM ship_custodies
    WHERE ship_uid = ?
  `).bind(shipUid).first();
  if (!row) return null;
  const building = row.custodian_type === "BUILDING"
    ? await getWorldEntity(db, "building", row.custodian_id)
    : null;
  if (!building) {
    throw navigationError(500, "SHIP_CUSTODIAN_MISSING", "Ship custodian is missing.");
  }
  return {
    type: row.custodian_type,
    id: row.custodian_id,
    slot: Number(row.slot),
    sinceAt: Number(row.since_at),
    revision: Number(row.revision),
    resolvedPosition: normalizePosition(building.position)
  };
}

async function getActiveBetaSpaceSession(db, shipUid) {
  const row = await db.prepare(`
    SELECT *
    FROM beta_space_sessions
    WHERE ship_uid = ? AND status = 'ACTIVE'
  `).bind(shipUid).first();
  return row ? betaSpaceSessionFromRow(row) : null;
}

async function resolveExpiredBetaSpaceShipForRead(db, ship, now) {
  if (ship.spatial_mode !== "BETA_SPACE") return ship;
  const session = await getActiveBetaSpaceSession(db, ship.ship_uid);
  if (!session) {
    throw navigationError(500, "BETA_SESSION_MISSING", "Beta Space session is missing.");
  }
  return deriveExpiredBetaSpaceShip(ship, session, now);
}

function deriveExpiredBetaSpaceShip(ship, session, now) {
  if (
    ship.spatial_mode !== "BETA_SPACE"
    || !session
    || now < session.expiresAt
  ) {
    return ship;
  }
  return {
    ...ship,
    spatial_mode: FIELD_MODE,
    position: session.returnPosition,
    rotation: session.returnRotation,
    speed: session.returnSpeed,
    desired_speed: session.returnDesiredSpeed,
    active_contract_id: null,
    phase: "manual",
    checkpoint_at: session.expiresAt,
    ...zoneFields(session.returnPosition, FIELD_MODE)
  };
}

async function materializeExpiredBetaSpaceSession(db, initialShip, now) {
  if (initialShip.spatial_mode !== "BETA_SPACE") return initialShip;
  const session = await getActiveBetaSpaceSession(db, initialShip.ship_uid);
  if (!session) {
    throw navigationError(500, "BETA_SESSION_MISSING", "Beta Space session is missing.");
  }
  if (now < session.expiresAt) return initialShip;

  const position = session.returnPosition;
  const rotation = session.returnRotation;
  const zones = zoneFields(position, FIELD_MODE);
  const statements = [];
  if (initialShip.active_contract_id) {
    statements.push(db.prepare(`
      UPDATE movement_contracts
      SET status = 'CANCELED', canceled_at = ?, revision = revision + 1, updated_at = ?
      WHERE contract_id = ? AND status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND revision = ? AND active_contract_id = ?
        )
    `).bind(
      session.expiresAt,
      now,
      initialShip.active_contract_id,
      initialShip.ship_uid,
      initialShip.revision,
      initialShip.active_contract_id
    ));
  }
  const sessionUpdateIndex = statements.length;
  statements.push(
    db.prepare(`
      UPDATE beta_space_sessions
      SET status = 'EXPIRED', returned_at = ?, updated_at = ?
      WHERE session_id = ? AND ship_uid = ? AND status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM ship_locations
          WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'BETA_SPACE'
        )
    `).bind(
      session.expiresAt,
      now,
      session.sessionId,
      initialShip.ship_uid,
      initialShip.ship_uid,
      initialShip.revision
    ),
    db.prepare(`
      UPDATE ship_locations
      SET
        spatial_mode = 'FIELD',
        position_x = ?, position_y = ?, position_z = ?,
        rotation_x = ?, rotation_y = ?, rotation_z = ?, rotation_w = ?,
        speed = ?, desired_speed = ?,
        sector_id = ?, chunk_id = ?, active_contract_id = NULL,
        movement_phase = 'MANUAL',
        revision = revision + 1, checkpoint_at = ?, updated_at = ?
      WHERE ship_uid = ? AND revision = ? AND spatial_mode = 'BETA_SPACE'
    `).bind(
      position.x,
      position.y,
      position.z,
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
      session.returnSpeed,
      session.returnDesiredSpeed,
      zones.sector_id,
      zones.chunk_id,
      session.expiresAt,
      now,
      initialShip.ship_uid,
      initialShip.revision
    )
  );
  const results = await db.batch(statements);
  if (statementChanges(results[sessionUpdateIndex]) !== 1) {
    const current = await db.prepare(
      "SELECT * FROM ship_locations WHERE ship_uid = ?"
    ).bind(initialShip.ship_uid).first();
    return shipFromRow(current);
  }
  const row = await db.prepare(
    "SELECT * FROM ship_locations WHERE ship_uid = ?"
  ).bind(initialShip.ship_uid).first();
  return shipFromRow(row);
}

async function materializeExpiredBetaSpaceSessions(db, now) {
  const result = await db.prepare(`
    SELECT ship.*
    FROM ship_locations AS ship
    INNER JOIN beta_space_sessions AS session
      ON session.ship_uid = ship.ship_uid
    WHERE ship.world_id = ?
      AND ship.spatial_mode = 'BETA_SPACE'
      AND session.status = 'ACTIVE'
      AND session.expires_at <= ?
    ORDER BY session.expires_at
    LIMIT 200
  `).bind(PRIMARY_WORLD_ID, now).all();

  for (const row of result?.results || []) {
    await materializeExpiredBetaSpaceSession(db, shipFromRow(row), now);
  }
}

async function materializeArrivedMovementContracts(db, now) {
  const result = await db.prepare(`
    SELECT ship.*
    FROM ship_locations AS ship
    INNER JOIN movement_contracts AS contract
      ON contract.contract_id = ship.active_contract_id
    WHERE ship.world_id = ?
      AND contract.status = 'ACTIVE'
      AND contract.arrive_at <= ?
    ORDER BY contract.arrive_at
    LIMIT 200
  `).bind(PRIMARY_WORLD_ID, now).all();

  for (const row of result?.results || []) {
    await resolvePlayerState(db, shipFromRow(row), now, { materializeArrival: true });
  }
}

function betaSpaceSessionFromRow(row) {
  return {
    sessionId: row.session_id,
    sourceBetaVoidId: row.source_beta_void_id,
    sourceGeneration: Number(row.source_generation),
    enteredAt: Number(row.entered_at),
    expiresAt: Number(row.expires_at),
    returnPosition: {
      x: Number(row.return_position_x),
      y: Number(row.return_position_y),
      z: Number(row.return_position_z)
    },
    returnRotation: normalizeQuaternion({
      x: row.return_rotation_x,
      y: row.return_rotation_y,
      z: row.return_rotation_z,
      w: row.return_rotation_w
    }),
    returnSpeed: Number(row.return_speed),
    returnDesiredSpeed: Number(row.return_desired_speed)
  };
}

function movementAnchor(ship, contract, now) {
  const derived = deriveMovementState(contract, now);
  return {
    position: derived.position,
    rotation: rotationForMovement(contract, ship.rotation, derived.phase),
    speed: derived.speed,
    desiredSpeed: derived.desiredSpeed
  };
}

function resolveValidatedActionAnchor(state, observedShip, physics, now) {
  if (state.activeContract) {
    return movementAnchor(state.ship, state.activeContract, now);
  }
  const anchor = observedAnchor(observedShip, state.ship, physics, now);
  assertActionPositionReachable(state.ship, anchor.position, physics, now);
  return anchor;
}

function observedAnchor(value, ship, physics, now) {
  const source = value && typeof value === "object" ? value : {};
  const elapsedSeconds = Math.max(0, now - Number(ship.checkpoint_at || now)) / 1000 + 2;
  const rotationElapsedSeconds = Math.max(0, now - Number(ship.checkpoint_at || now)) / 1000 + 0.25;
  const minimumReachableSpeed = Math.max(
    physics.minSpeed,
    ship.speed - physics.decelerationRate * elapsedSeconds
  );
  const maximumReachableSpeed = Math.min(
    physics.maxSpeed,
    ship.speed + physics.accelerationRate * elapsedSeconds
  );
  return {
    position: source.position ? normalizePosition(source.position) : ship.position,
    rotation: source.rotation
      ? clampObservedRotation(ship.rotation, normalizeQuaternion(source.rotation), physics, rotationElapsedSeconds)
      : ship.rotation,
    speed: clamp(
      finiteNumber(source.speed, ship.speed),
      minimumReachableSpeed,
      maximumReachableSpeed
    ),
    desiredSpeed: clamp(
      finiteNumber(source.desired_speed, ship.desired_speed),
      physics.minSpeed,
      physics.maxSpeed
    )
  };
}

function assertActionPositionReachable(ship, position, physics, now) {
  const forwardSpeed = Math.max(
    Math.abs(Number(physics.minSpeed) || 0),
    Math.abs(Number(physics.maxSpeed) || 0)
  );
  const maximumCombinedSpeed = Math.hypot(
    forwardSpeed,
    Math.abs(Number(physics.strafeRate) || 0),
    Math.abs(Number(physics.verticalRate) || 0)
  );
  const networkGraceSeconds = 2;
  const fixedBuffer = Math.max((Number(physics.arrivalRadius) || 0) * 2, 1);
  const validation = evaluateActionPositionObservation({
    authoritativePosition: ship.position,
    observedPosition: position,
    checkpointAt: ship.checkpoint_at,
    serverNow: now,
    maximumCombinedSpeed,
    networkGraceSeconds,
    fixedBuffer
  });
  if (!validation.valid) {
    throw navigationError(
      409,
      "MANUAL_POSITION_OUT_OF_RANGE",
      "Observed action position is outside the reachable movement range."
    );
  }
}

function getShipPhysics(shipDefinitionId) {
  const movement = WORLD_TEMPLATE.movementConfig;
  const shipId = movement.shipPhysics[shipDefinitionId]
    ? shipDefinitionId
    : movement.defaultShipId;
  const source = movement.shipPhysics[shipId];
  const unitsPerRender = 1 / movement.renderScale;
  return {
    maxSpeed: source.maxSpeed * unitsPerRender,
    minSpeed: source.minSpeed * unitsPerRender,
    accelerationRate: source.accelerationRate * unitsPerRender,
    decelerationRate: source.decelerationRate * unitsPerRender,
    arrivalRadius: source.arrivalRadius * unitsPerRender,
    deactivationCoastDuration: source.deactivationCoastDuration,
    pitchRate: source.pitchRate,
    yawRate: source.yawRate,
    rollRate: source.rollRate,
    strafeRate: source.strafeRate * unitsPerRender,
    verticalRate: source.verticalRate * unitsPerRender,
    hyperdrive: {
      cooldownDuration: source.hyperdriveSpecs.cooldownDuration,
      warpEntryDuration: source.hyperdriveSpecs.warpEntryDuration,
      warpExitDuration: source.hyperdriveSpecs.warpExitDuration,
      warpMinFlightDuration: source.hyperdriveSpecs.warpMinFlightDuration,
      warpFlightSpeed: source.hyperdriveSpecs.warpFlightSpeed * unitsPerRender
    }
  };
}

function clampObservedRotation(from, to, physics, elapsedSeconds) {
  const start = normalizeQuaternion(from);
  let target = normalizeQuaternion(to);
  let dot = start.x * target.x + start.y * target.y + start.z * target.z + start.w * target.w;
  if (dot < 0) {
    target = { x: -target.x, y: -target.y, z: -target.z, w: -target.w };
    dot = -dot;
  }
  dot = clamp(dot, -1, 1);
  const angle = 2 * Math.acos(dot);
  const maximumAngle = Math.max(
    Number(physics.pitchRate) || 0,
    Number(physics.yawRate) || 0,
    Number(physics.rollRate) || 0
  ) * Math.max(0, elapsedSeconds);
  if (angle <= maximumAngle || angle <= 1e-9) return target;
  return normalizedQuaternionLerp(start, target, maximumAngle / angle);
}

function normalizedQuaternionLerp(from, to, ratio) {
  const t = clamp(ratio, 0, 1);
  return normalizeQuaternionComponents({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
    w: from.w + (to.w - from.w) * t
  });
}

function shipFromRow(row) {
  return {
    ship_uid: row.ship_uid,
    world_id: row.world_id,
    owner_character_id: row.owner_character_id,
    display_name: row.display_name,
    ship_definition_id: row.ship_definition_id,
    spatial_mode: row.spatial_mode,
    position: {
      x: Number(row.position_x),
      y: Number(row.position_y),
      z: Number(row.position_z)
    },
    rotation: normalizeQuaternion({
      x: row.rotation_x,
      y: row.rotation_y,
      z: row.rotation_z,
      w: row.rotation_w
    }),
    speed: Number(row.speed),
    desired_speed: Number(row.desired_speed),
    sector_id: row.sector_id,
    chunk_id: row.chunk_id,
    active_contract_id: row.active_contract_id,
    phase: String(row.movement_phase || "MANUAL").toLowerCase(),
    revision: Number(row.revision),
    checkpoint_at: Number(row.checkpoint_at),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at)
  };
}

function contractFromRow(row) {
  try {
    const contract = JSON.parse(row.state_json);
    if (!contract || typeof contract !== "object") throw new Error("Invalid contract.");
    return {
      ...contract,
      status: row.status,
      revision: Number(row.revision),
      canceledAt: row.canceled_at == null ? null : Number(row.canceled_at),
      settledAt: row.settled_at == null ? null : Number(row.settled_at),
      updatedAt: Number(row.updated_at)
    };
  } catch {
    throw navigationError(500, "MOVEMENT_STATE_CORRUPT", "Movement contract is invalid.");
  }
}

async function getContract(db, contractId) {
  const row = await db.prepare(
    "SELECT * FROM movement_contracts WHERE contract_id = ?"
  ).bind(contractId).first();
  return row ? contractFromRow(row) : null;
}

export function publicNavigationState({
  ship,
  activeContract,
  custody = null,
  betaSpaceSession = null,
  economyOccupancy = null,
  serverTime
}) {
  return {
    character_id: ship.owner_character_id,
    ship: {
      ship_uid: ship.ship_uid,
      world_id: ship.world_id,
      owner_character_id: ship.owner_character_id,
      display_name: ship.display_name,
      ship_definition_id: ship.ship_definition_id,
      spatial_mode: ship.spatial_mode,
      // A docked ship has custody, not an independent coordinate. Consumers may
      // resolve its presentation position from the current custodian object.
      position: custody ? null : ship.position,
      resolved_position: custody?.resolvedPosition || null,
      rotation: ship.rotation,
      speed: ship.speed,
      desired_speed: ship.desired_speed,
      sector_id: ship.sector_id,
      chunk_id: ship.chunk_id,
      phase: ship.phase || "manual",
      revision: ship.revision,
      checkpoint_at: ship.checkpoint_at,
      updated_at: ship.updated_at
    },
    custody: custody
      ? {
          type: custody.type,
          id: custody.id,
          slot: custody.slot,
          since_at: custody.sinceAt,
          revision: custody.revision,
          resolved_position: custody.resolvedPosition
        }
      : null,
    beta_space_session: betaSpaceSession ? publicBetaSpaceSession(betaSpaceSession) : null,
    economy_occupancy: economyOccupancy
      ? {
          type: economyOccupancy.type,
          contract_id: economyOccupancy.contractId,
          world_object_id: economyOccupancy.worldObjectId,
          started_at: economyOccupancy.startedAt,
          busy_until: economyOccupancy.busyUntil,
          revision: economyOccupancy.revision
        }
      : null,
    active_contract: activeContract ? publicContract(activeContract) : null,
    server_time: serverTime
  };
}

function publicBetaSpaceSession(session) {
  return {
    session_id: session.sessionId,
    source_beta_void_id: session.sourceBetaVoidId,
    source_generation: session.sourceGeneration,
    entered_at: session.enteredAt,
    expires_at: session.expiresAt,
    return_anchor: {
      position: session.returnPosition,
      rotation: session.returnRotation,
      speed: session.returnSpeed,
      desired_speed: session.returnDesiredSpeed
    }
  };
}

function publicContract(contract) {
  return {
    contract_id: contract.contractId,
    client_action_id: contract.clientActionId,
    route_type: contract.routeType,
    status: contract.status,
    start_position: contract.startPosition,
    start_heading: contract.startHeading,
    start_speed: contract.startSpeed,
    from_position: contract.fromPosition,
    target: contract.target,
    heading: contract.heading,
    stop_start_at: contract.stopStartAt,
    align_start_at: contract.alignStartAt,
    cooldown_start_at: contract.cooldownStartAt ?? null,
    flight_at: contract.flightAt,
    arrive_at: contract.arriveAt,
    stop_duration: contract.stopDuration,
    align_duration: contract.alignDuration,
    cooldown_duration: contract.cooldownDuration ?? 0,
    flight_duration: contract.flightDuration,
    warp_entry_duration: contract.warpEntryDuration ?? 0,
    warp_cruise_duration: contract.warpCruiseDuration ?? 0,
    warp_exit_duration: contract.warpExitDuration ?? 0,
    peak_speed: contract.peakSpeed,
    desired_speed: contract.desiredSpeed,
    coast_duration: contract.coastDuration,
    physics: contract.physics,
    revision: contract.revision,
    issued_at: contract.issuedAt,
    canceled_at: contract.canceledAt ?? null,
    settled_at: contract.settledAt ?? null,
    updated_at: contract.updatedAt
  };
}

function realtimeContract(contract) {
  return {
    authority: true,
    contractVersion: 1,
    contractId: contract.contractId,
    routeType: contract.routeType,
    startPosition: contract.startPosition,
    startHeading: contract.startHeading,
    startSpeed: contract.startSpeed,
    fromPosition: contract.fromPosition,
    target: contract.target,
    heading: contract.heading,
    stopStartAt: contract.stopStartAt,
    alignStartAt: contract.alignStartAt,
    cooldownStartAt: contract.cooldownStartAt ?? null,
    flightAt: contract.flightAt,
    arriveAt: contract.arriveAt,
    stopDuration: contract.stopDuration,
    alignDuration: contract.alignDuration,
    cooldownDuration: contract.cooldownDuration ?? 0,
    flightDuration: contract.flightDuration,
    peakSpeed: contract.peakSpeed,
    desiredSpeed: contract.desiredSpeed,
    coastDuration: contract.coastDuration,
    physics: contract.physics
  };
}

function rotationForMovement(contract, fallback, phase) {
  if (phase === "stopping") return normalizeQuaternion(fallback);
  return quaternionFromForward(contract.heading);
}

function quaternionFromForward(direction) {
  const target = normalizeDirection(direction);
  const dot = clamp(target.z, -1, 1);
  if (dot < -0.999999) return { x: 0, y: 1, z: 0, w: 0 };
  const quaternion = {
    x: -target.y,
    y: target.x,
    z: 0,
    w: 1 + dot
  };
  return normalizeQuaternionComponents(quaternion);
}

async function getWorldEntity(db, entityType, entityId) {
  const row = await db.prepare(`
    SELECT state_json
    FROM world_entities
    WHERE world_id = ? AND entity_type = ? AND entity_id = ?
  `).bind(PRIMARY_WORLD_ID, entityType, entityId).first();
  if (!row) return null;
  try {
    const value = JSON.parse(row.state_json);
    if (!value || typeof value !== "object") throw new Error("Invalid entity state.");
    return value;
  } catch {
    throw navigationError(500, "WORLD_ENTITY_CORRUPT", "World entity state is invalid.");
  }
}

async function getBuildingStorage(db, buildingId) {
  const row = await db.prepare(`
    SELECT state_json
    FROM world_storages
    WHERE world_id = ? AND world_object_id = ?
    ORDER BY storage_id
    LIMIT 1
  `).bind(PRIMARY_WORLD_ID, buildingId).first();
  if (!row) return null;
  try {
    const value = JSON.parse(row.state_json);
    if (!value || typeof value !== "object") throw new Error("Invalid storage state.");
    return value;
  } catch {
    throw navigationError(500, "WORLD_STORAGE_CORRUPT", "World storage state is invalid.");
  }
}

function getBuildingDockingFacing(buildingDefinitionId) {
  const configured = WORLD_TEMPLATE.buildingDocking?.[buildingDefinitionId]?.facing;
  const source = Array.isArray(configured) && configured.length >= 3
    ? { x: configured[0], y: configured[1], z: configured[2] }
    : { x: 0, y: 0, z: 1 };
  return normalizeDirection(source);
}

function addScaled(position, direction, distance) {
  return {
    x: position.x + direction.x * distance,
    y: position.y + direction.y * distance,
    z: position.z + direction.z * distance
  };
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function betaSpaceSpawnPosition() {
  const chunkSize = WORLD_TEMPLATE.movementConfig.chunkSize;
  return {
    x: chunkSize.x * (BETA_SPACE_CHUNK_SPAN / 2),
    y: chunkSize.y * (BETA_SPACE_CHUNK_SPAN / 2),
    z: chunkSize.z * (BETA_SPACE_CHUNK_SPAN / 2)
  };
}

function defaultSpawnPosition() {
  const sector = WORLD_TEMPLATE.sectors[0];
  if (!sector?.global_bounds) return { x: 0, y: 0, z: 0 };
  return {
    x: (sector.global_bounds.min.x + sector.global_bounds.max.x) / 2,
    y: (sector.global_bounds.min.y + sector.global_bounds.max.y) / 2,
    z: (sector.global_bounds.min.z + sector.global_bounds.max.z) / 2
  };
}

function zoneFields(position, spatialMode = FIELD_MODE) {
  if (spatialMode === "BETA_SPACE") {
    const chunkSize = WORLD_TEMPLATE.movementConfig.chunkSize;
    return {
      sector_id: BETA_SPACE_ID,
      chunk_id: `${Math.floor(position.x / chunkSize.x)}:${Math.floor(position.y / chunkSize.y)}:${Math.floor(position.z / chunkSize.z)}`
    };
  }
  const sector = WORLD_TEMPLATE.sectors.find((entry) => (
    position.x >= entry.global_bounds.min.x
    && position.x <= entry.global_bounds.max.x
    && position.y >= entry.global_bounds.min.y
    && position.y <= entry.global_bounds.max.y
    && position.z >= entry.global_bounds.min.z
    && position.z <= entry.global_bounds.max.z
  ));
  const chunkSize = WORLD_TEMPLATE.movementConfig.chunkSize;
  const chunk = {
    x: Math.floor(position.x / chunkSize.x),
    y: Math.floor(position.y / chunkSize.y),
    z: Math.floor(position.z / chunkSize.z)
  };
  return {
    sector_id: sector?.sector_id || null,
    chunk_id: `${chunk.x}:${chunk.y}:${chunk.z}`
  };
}

function createReceiptInsert(db, {
  clientActionId,
  ownerCharacterId,
  commandType,
  response,
  now,
  shipUid,
  expectedRevision,
  expectedContractId
}) {
  const contractCondition = expectedContractId == null
    ? "active_contract_id IS NULL"
    : "active_contract_id = ?";
  const values = [
    clientActionId,
    ownerCharacterId,
    commandType,
    JSON.stringify(response),
    now,
    shipUid,
    expectedRevision
  ];
  if (expectedContractId != null) values.push(expectedContractId);
  return db.prepare(`
    INSERT INTO movement_command_receipts (
      client_action_id,
      owner_character_id,
      command_type,
      response_json,
      created_at
    )
    SELECT ?, ?, ?, ?, ?
    FROM ship_locations
    WHERE ship_uid = ? AND revision = ? AND ${contractCondition}
  `).bind(...values);
}

async function getCommandReceipt(db, clientActionId, ownerCharacterId) {
  const receipt = await getCommandReceiptRecord(db, clientActionId, ownerCharacterId);
  return receipt?.response || null;
}

async function getCommandReceiptRecord(db, clientActionId, ownerCharacterId) {
  const row = await db.prepare(`
    SELECT owner_character_id, command_type, response_json, created_at
    FROM movement_command_receipts
    WHERE client_action_id = ?
  `).bind(clientActionId).first();
  if (!row) return null;
  if (row.owner_character_id !== ownerCharacterId) {
    throw navigationError(409, "MOVEMENT_ACTION_CONFLICT", "Movement action belongs to another character.");
  }
  try {
    return {
      commandType: row.command_type,
      response: JSON.parse(row.response_json),
      createdAt: Number(row.created_at)
    };
  } catch {
    throw navigationError(500, "MOVEMENT_RECEIPT_CORRUPT", "Movement receipt is invalid.");
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
    throw navigationError(400, "MOVEMENT_COMMAND_WINDOW_INVALID", "Movement command window is invalid.");
  }
  if (now > expiresAt) {
    throw navigationError(409, "MOVEMENT_COMMAND_EXPIRED", "Movement command expired before it reached the server.");
  }
}

function assertShipCanNavigate(state) {
  assertShipNotEconomyOccupied(state);
  if (state.custody || ![FIELD_MODE, "BETA_SPACE"].includes(state.ship.spatial_mode)) {
    throw navigationError(409, "SHIP_NOT_SPATIALLY_DEPLOYED", "Ship is not deployed in navigable space.");
  }
}

function assertRevision(actual, expected) {
  const normalized = Number(expected);
  if (!Number.isInteger(normalized) || normalized !== actual) {
    throw navigationError(409, "MOVEMENT_REVISION_CONFLICT", "Ship movement revision changed.");
  }
}

function assertCommandRevision(state, expected) {
  const normalized = Number(expected);
  const transition = state.arrivalRevisionTransition || state.timedRevisionTransition;
  if (
    Number.isInteger(normalized)
    && transition
    && normalized === transition.fromRevision
    && state.ship.revision === transition.toRevision
  ) {
    assertShipNotEconomyOccupied(state);
    return;
  }
  assertRevision(state.ship.revision, expected);
  assertShipNotEconomyOccupied(state);
}

function assertShipNotEconomyOccupied(state) {
  if (state.economyOccupancy) {
    throw navigationError(409, "SHIP_OCCUPIED", "Ship is occupied by an economy action.");
  }
}

function normalizeRouteType(value) {
  const routeType = String(value || "");
  if (!["standard", "hyperdrive", "deactivation"].includes(routeType)) {
    throw navigationError(400, "MOVEMENT_ROUTE_INVALID", "Unknown movement route type.");
  }
  return routeType;
}

function optionalRouteType(value) {
  if (value == null || String(value).trim() === "") return null;
  return normalizeRouteType(value);
}

function optionalMovementStatus(value) {
  if (value == null || String(value).trim() === "") return null;
  const status = String(value).trim().toUpperCase();
  if (!["ACTIVE", "CANCELED", "ARRIVED"].includes(status)) {
    throw navigationError(400, "MOVEMENT_STATUS_INVALID", "Unknown movement status.");
  }
  return status;
}

function optionalAdminId(value, label) {
  if (value == null || String(value).trim() === "") return null;
  return requiredId(value, label);
}

function normalizeShipDefinitionId(value) {
  const requested = String(value || "");
  return WORLD_TEMPLATE.movementConfig.shipPhysics[requested]
    ? requested
    : WORLD_TEMPLATE.movementConfig.defaultShipId;
}

function normalizePosition(value) {
  return {
    x: boundedNumber(value?.x, -MAX_COORDINATE, MAX_COORDINATE, "position"),
    y: boundedNumber(value?.y, -MAX_COORDINATE, MAX_COORDINATE, "position"),
    z: boundedNumber(value?.z, -MAX_COORDINATE, MAX_COORDINATE, "position")
  };
}

function normalizeQuaternion(value) {
  const quaternion = {
    x: boundedNumber(value?.x, -1, 1, "rotation"),
    y: boundedNumber(value?.y, -1, 1, "rotation"),
    z: boundedNumber(value?.z, -1, 1, "rotation"),
    w: boundedNumber(value?.w ?? 1, -1, 1, "rotation")
  };
  return normalizeQuaternionComponents(quaternion);
}

function normalizeQuaternionComponents(quaternion) {
  const magnitude = Math.hypot(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w
  ) || 1;
  return {
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
    w: quaternion.w / magnitude
  };
}

function normalizeDirection(value) {
  const direction = normalizePosition(value);
  const magnitude = Math.hypot(direction.x, direction.y, direction.z) || 1;
  return {
    x: direction.x / magnitude,
    y: direction.y / magnitude,
    z: direction.z / magnitude
  };
}

function normalizeDisplayName(value) {
  return String(value || "Pilot").trim().replace(/\s+/g, " ").slice(0, 32) || "Pilot";
}

function requiredId(value, label) {
  const text = String(value || "").trim();
  if (
    !text
    || text.length > MAX_ID_LENGTH
    || !/^[A-Za-z0-9_.:-]+$/.test(text)
  ) {
    throw navigationError(400, "MOVEMENT_ID_INVALID", `Invalid ${label} id.`);
  }
  return text;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw navigationError(400, "MOVEMENT_VALUE_INVALID", `Invalid ${label} value.`);
  }
  return number;
}

function boundedNumber(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw navigationError(400, "MOVEMENT_VALUE_INVALID", `Invalid ${label} value.`);
  }
  return number;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number(fallback) || 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function statementChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes) || 0;
}

function navigationError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
