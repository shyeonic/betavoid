import {
  createDeactivationMovementPlan,
  createHyperdriveMovementPlan,
  createStandardMovementPlan,
  deriveMovementState,
  quaternionForward
} from "../../../js/navigationKinematics.js";
import { WORLD_TEMPLATE } from "./generated/world-template.js";
import { ensureWorldInitialized } from "./world-state.js";

const PRIMARY_WORLD_ID = "primary";
const FIELD_MODE = "FIELD";
const MAX_COORDINATE = 1_000_000_000;
const MAX_ID_LENGTH = 180;

export async function getPlayerNavigationState(db, context, now = Date.now()) {
  return publicNavigationState(await getPlayerNavigationStateInternal(db, context, now));
}

async function getPlayerNavigationStateInternal(db, context, now = Date.now()) {
  await ensureWorldInitialized(db);
  const ship = await getOrCreateShip(db, context, now);
  return resolvePlayerState(db, ship, now, { materializeArrival: true });
}

export async function startPlayerNavigation(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getCommandReceipt(db, clientActionId, context.characterId);
  if (receipt) return receipt;

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertRevision(state.ship.revision, body?.expected_revision);
  const physics = getShipPhysics(state.ship.ship_definition_id);
  const anchor = state.activeContract
    ? movementAnchor(state.ship, state.activeContract, now)
    : observedAnchor(body?.observed_ship, state.ship, physics);
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
    ...zoneFields(anchor.position)
  };
  const response = publicNavigationState({
    ship: nextShip,
    activeContract: contract,
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

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertRevision(state.ship.revision, body?.expected_revision);
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
  const rotation = rotationForMovement(contract, state.ship.rotation, derived.phase);
  const position = derived.position;
  const zones = zoneFields(position);
  const nextRevision = state.ship.revision + 1;
  const nextShip = {
    ...state.ship,
    position,
    rotation,
    speed: derived.speed,
    desired_speed: derived.speed,
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

export async function checkpointPlayerShip(db, context, body, now = Date.now()) {
  const clientActionId = requiredId(body?.client_action_id, "client action");
  const receipt = await getCommandReceipt(db, clientActionId, context.characterId);
  if (receipt) return receipt;

  const state = await getPlayerNavigationStateInternal(db, context, now);
  assertRevision(state.ship.revision, body?.expected_revision);
  if (state.activeContract) {
    throw navigationError(409, "MOVEMENT_ACTIVE", "Manual checkpoint is unavailable during navigation.");
  }
  const physics = getShipPhysics(state.ship.ship_definition_id);
  const anchor = observedAnchor(body?.ship, state.ship, physics);
  const zones = zoneFields(anchor.position);
  const nextRevision = state.ship.revision + 1;
  const nextShip = {
    ...state.ship,
    position: anchor.position,
    rotation: anchor.rotation,
    speed: anchor.speed,
    desired_speed: anchor.desiredSpeed,
    phase: "manual",
    revision: nextRevision,
    checkpoint_at: now,
    updated_at: now,
    ...zones
  };
  const response = publicNavigationState({
    ship: nextShip,
    activeContract: null,
    serverTime: now
  });
  const results = await db.batch([
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
        revision = revision + 1,
        checkpoint_at = ?,
        updated_at = ?
      WHERE ship_uid = ? AND revision = ? AND active_contract_id IS NULL
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
      commandType: "MOVE_CHECKPOINT",
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

export async function listZoneShipPeers(
  db,
  zoneId,
  { excludedCharacterId = null, now = Date.now() } = {}
) {
  await ensureWorldInitialized(db);
  const normalizedZone = requiredId(zoneId, "zone");
  const [shipResult, contractResult] = await db.batch([
    db.prepare(`
      SELECT *
      FROM ship_locations
      WHERE world_id = ?
        AND spatial_mode = 'FIELD'
        AND (
          sector_id = ?
          OR chunk_id = ?
          OR active_contract_id IS NOT NULL
        )
      ORDER BY owner_character_id, ship_uid
      LIMIT 2000
    `).bind(PRIMARY_WORLD_ID, normalizedZone, normalizedZone),
    db.prepare(`
      SELECT *
      FROM movement_contracts
      WHERE world_id = ? AND status = 'ACTIVE'
      ORDER BY issued_at
      LIMIT 2000
    `).bind(PRIMARY_WORLD_ID)
  ]);
  const contracts = new Map(
    (contractResult?.results || []).map((row) => [row.contract_id, contractFromRow(row)])
  );
  const peers = [];
  for (const row of shipResult?.results || []) {
    const ship = shipFromRow(row);
    if (ship.owner_character_id === excludedCharacterId) continue;
    const contract = ship.active_contract_id
      ? contracts.get(ship.active_contract_id) || null
      : null;
    const derived = contract
      ? deriveMovementState(contract, now)
      : {
          position: ship.position,
          speed: ship.speed,
          desiredSpeed: ship.desired_speed,
          phase: "manual",
          logicalStatus: "ACTIVE"
        };
    const zones = zoneFields(derived.position);
    if (zones.sector_id !== normalizedZone && zones.chunk_id !== normalizedZone) continue;
    const rotation = contract
      ? rotationForMovement(contract, ship.rotation, derived.phase)
      : ship.rotation;
    const heading = contract?.heading || quaternionForward(rotation);
    peers.push({
      character_id: ship.owner_character_id,
      display_name: ship.display_name,
      ship_id: ship.ship_definition_id,
      ship_uid: ship.ship_uid,
      zone_id: normalizedZone,
      updated_at: Math.max(ship.updated_at, contract?.updatedAt || 0),
      source: "authority",
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
    });
  }
  return {
    zone_id: normalizedZone,
    server_time: now,
    peers
  };
}

export async function getNavigationAdminSummary(db, now = Date.now()) {
  await ensureWorldInitialized(db);
  const [shipCount, fieldCount, activeCount] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM ship_locations WHERE world_id = ?")
      .bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM ship_locations
      WHERE world_id = ? AND spatial_mode = 'FIELD'
    `).bind(PRIMARY_WORLD_ID),
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
  const [shipResult, contractResult] = await db.batch([
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
    `).bind(PRIMARY_WORLD_ID)
  ]);
  const contracts = new Map(
    (contractResult?.results || []).map((row) => [row.contract_id, contractFromRow(row)])
  );
  return (shipResult?.results || []).map((row) => {
    const ship = shipFromRow(row);
    const contract = ship.active_contract_id
      ? contracts.get(ship.active_contract_id) || null
      : null;
    const derived = contract ? deriveMovementState(contract, now) : null;
    const position = derived?.position || ship.position;
    const zones = zoneFields(position);
    return {
      ship_uid: ship.ship_uid,
      owner_character_id: ship.owner_character_id,
      display_name: ship.display_name,
      ship_definition_id: ship.ship_definition_id,
      spatial_mode: ship.spatial_mode,
      sector_id: zones.sector_id,
      chunk_id: zones.chunk_id,
      phase: derived?.phase || "manual",
      route_type: contract?.routeType || null,
      contract_id: contract?.contractId || null,
      position,
      revision: ship.revision,
      updated_at: ship.updated_at
    };
  });
}

async function getOrCreateShip(db, context, now) {
  const shipUid = requiredId(context.shipUid, "ship");
  const spatialMode = context.spatialMode === "DOCKED" ? "DOCKED" : FIELD_MODE;
  const existing = await db.prepare(
    "SELECT * FROM ship_locations WHERE ship_uid = ?"
  ).bind(shipUid).first();
  if (existing) {
    if (existing.owner_character_id !== context.characterId) {
      throw navigationError(403, "SHIP_OWNERSHIP_INVALID", "Ship ownership mismatch.");
    }
    let current = existing;
    if (
      current.spatial_mode !== spatialMode
      || (spatialMode === "DOCKED" && current.active_contract_id)
    ) {
      const statements = [];
      if (spatialMode === "DOCKED" && current.active_contract_id) {
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
          current.active_contract_id,
          shipUid,
          Number(current.revision),
          current.active_contract_id
        ));
      }
      statements.push(db.prepare(`
        UPDATE ship_locations
        SET
          spatial_mode = ?,
          active_contract_id = CASE WHEN ? = 'DOCKED' THEN NULL ELSE active_contract_id END,
          speed = CASE WHEN ? = 'DOCKED' THEN 0 ELSE speed END,
          desired_speed = CASE WHEN ? = 'DOCKED' THEN 0 ELSE desired_speed END,
          revision = revision + 1,
          checkpoint_at = ?,
          updated_at = ?
        WHERE ship_uid = ? AND revision = ?
      `).bind(
        spatialMode,
        spatialMode,
        spatialMode,
        spatialMode,
        now,
        now,
        shipUid,
        Number(current.revision)
      ));
      await db.batch(statements);
      current = await db.prepare(
        "SELECT * FROM ship_locations WHERE ship_uid = ?"
      ).bind(shipUid).first();
    }
    await db.prepare(`
      UPDATE ship_locations
      SET display_name = ?, ship_definition_id = ?
      WHERE ship_uid = ?
    `).bind(
      normalizeDisplayName(context.displayName),
      normalizeShipDefinitionId(context.shipDefinitionId),
      shipUid
    ).run();
    return shipFromRow({
      ...current,
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
    spatialMode,
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
      ship: { ...ship, phase: "manual" },
      activeContract: null,
      serverTime: now
    };
  }

  const derived = deriveMovementState(contract, now);
  if (derived.logicalStatus === "ARRIVED" && materializeArrival) {
    const rotation = rotationForMovement(contract, ship.rotation, "arrived");
    const zones = zoneFields(contract.target);
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
        now,
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
        serverTime: now
      };
    }
    ship = shipFromRow(await db.prepare(
      "SELECT * FROM ship_locations WHERE ship_uid = ?"
    ).bind(ship.ship_uid).first());
    return resolvePlayerState(db, ship, now, { materializeArrival });
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
      ...zoneFields(derived.position)
    },
    activeContract: derived.logicalStatus === "ACTIVE" ? contract : null,
    serverTime: now
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

function observedAnchor(value, ship, physics) {
  const source = value && typeof value === "object" ? value : {};
  return {
    position: source.position ? normalizePosition(source.position) : ship.position,
    rotation: source.rotation ? normalizeQuaternion(source.rotation) : ship.rotation,
    speed: clamp(
      finiteNumber(source.speed, ship.speed),
      physics.minSpeed,
      physics.maxSpeed
    ),
    desiredSpeed: clamp(
      finiteNumber(source.desired_speed, ship.desired_speed),
      physics.minSpeed,
      physics.maxSpeed
    )
  };
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

function publicNavigationState({ ship, activeContract, serverTime }) {
  return {
    character_id: ship.owner_character_id,
    ship: {
      ship_uid: ship.ship_uid,
      world_id: ship.world_id,
      owner_character_id: ship.owner_character_id,
      display_name: ship.display_name,
      ship_definition_id: ship.ship_definition_id,
      spatial_mode: ship.spatial_mode,
      position: ship.position,
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
    active_contract: activeContract ? publicContract(activeContract) : null,
    server_time: serverTime
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

function defaultSpawnPosition() {
  const sector = WORLD_TEMPLATE.sectors[0];
  if (!sector?.global_bounds) return { x: 0, y: 0, z: 0 };
  return {
    x: (sector.global_bounds.min.x + sector.global_bounds.max.x) / 2,
    y: (sector.global_bounds.min.y + sector.global_bounds.max.y) / 2,
    z: (sector.global_bounds.min.z + sector.global_bounds.max.z) / 2
  };
}

function zoneFields(position) {
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
  const row = await db.prepare(`
    SELECT owner_character_id, response_json
    FROM movement_command_receipts
    WHERE client_action_id = ?
  `).bind(clientActionId).first();
  if (!row) return null;
  if (row.owner_character_id !== ownerCharacterId) {
    throw navigationError(409, "MOVEMENT_ACTION_CONFLICT", "Movement action belongs to another character.");
  }
  try {
    return JSON.parse(row.response_json);
  } catch {
    throw navigationError(500, "MOVEMENT_RECEIPT_CORRUPT", "Movement receipt is invalid.");
  }
}

function assertRevision(actual, expected) {
  const normalized = Number(expected);
  if (!Number.isInteger(normalized) || normalized !== actual) {
    throw navigationError(409, "MOVEMENT_REVISION_CONFLICT", "Ship movement revision changed.");
  }
}

function normalizeRouteType(value) {
  const routeType = String(value || "");
  if (!["standard", "hyperdrive", "deactivation"].includes(routeType)) {
    throw navigationError(400, "MOVEMENT_ROUTE_INVALID", "Unknown movement route type.");
  }
  return routeType;
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
