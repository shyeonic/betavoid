import { WORLD_TEMPLATE } from "./generated/world-template.js";
import { createServerDeterministicRandom } from "./server-determinism.js";

const PRIMARY_WORLD_ID = "primary";
const TIMESTAMP_FLOOR = 1_000_000_000_000;
const BETA_VOID_ENEMY_TYPES = ["pirate_squad", "raider_group", "hostile_fleet"];
const BETA_VOID_RISK_LEVELS = [1, 2, 3, 4, 5];
const BETA_VOID_REWARD_TABLE_IDS = ["loot_91", "loot_92", "loot_93"];

export async function getOrCreateWorldState(db, now = Date.now(), entropySecret) {
  const worldRow = await ensureWorldInitialized(db);

  const [entityResult, storageResult, metaResult] = await db.batch([
    db.prepare(`
      SELECT entity_type, entity_id, state_json, revision
      FROM world_entities
      WHERE world_id = ?
      ORDER BY entity_type, entity_id
    `).bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT state_json
      FROM world_storages
      WHERE world_id = ?
      ORDER BY storage_id
    `).bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT meta_key, state_json
      FROM world_meta
      WHERE world_id = ?
      ORDER BY meta_key
    `).bind(PRIMARY_WORLD_ID)
  ]);
  const entities = {
    sector: [],
    resource_node: [],
    building: [],
    beta_void: []
  };
  const entityRows = entityResult?.results || [];
  const derivedBetaVoids = await deriveBetaVoidLifecycle({
    records: entityRows,
    worldSeed: worldRow.seed,
    entropySecret,
    now
  });
  for (const row of entityRows) {
    if (!entities[row.entity_type]) continue;
    entities[row.entity_type].push(
      row.entity_type === "beta_void"
        ? derivedBetaVoids.get(row.entity_id)
        : parseState(row.state_json)
    );
  }
  const meta = Object.fromEntries(
    (metaResult?.results || []).map((row) => [row.meta_key, parseState(row.state_json)])
  );

  return {
    world_id: worldRow.world_id,
    data_source_key: worldRow.data_source_key,
    schema_version: Number(worldRow.schema_version),
    revision: Number(worldRow.revision),
    generated_at: Number(worldRow.generated_at),
    created_at: Number(worldRow.created_at),
    updated_at: Number(worldRow.updated_at),
    snapshot: {
      sectors: entities.sector,
      resource_nodes: entities.resource_node,
      buildings: entities.building,
      beta_voids: entities.beta_void,
      resource_manager: meta.resourceManager || null,
      building_storages: (storageResult?.results || []).map((row) => parseState(row.state_json))
    }
  };
}

export async function ensureWorldInitialized(db) {
  if (!db) throw worldError(500, "WORLD_DB_UNAVAILABLE", "World database is unavailable.");

  let worldRow = await selectWorld(db, PRIMARY_WORLD_ID);
  if (!worldRow) {
    await initializeWorld(db, Date.now());
    worldRow = await selectWorld(db, PRIMARY_WORLD_ID);
  }
  if (!worldRow) throw worldError(500, "WORLD_BOOTSTRAP_UNAVAILABLE", "World bootstrap unavailable.");
  return worldRow;
}

export async function deriveBetaVoidLifecycle({ records, worldSeed, entropySecret, now = Date.now() }) {
  const normalizedRecords = records.map((row) => ({
    ...row,
    state: row.state || parseState(row.state_json)
  }));
  const sectors = normalizedRecords
    .filter((entry) => entry.entity_type === "sector")
    .map((entry) => entry.state);
  const betaEntries = normalizedRecords
    .filter((entry) => entry.entity_type === "beta_void")
    .map((entry) => ({ ...entry, state: structuredClone(entry.state) }));
  const placedObjects = normalizedRecords
    .filter((entry) => ["resource_node", "building", "beta_void"].includes(entry.entity_type))
    .map((entry) => (
      entry.entity_type === "beta_void"
        ? betaEntries.find((candidate) => candidate.entity_id === entry.entity_id).state
        : entry.state
    ));

  while (true) {
    const due = betaEntries
      .map((entry) => ({ entry, at: betaVoidLifecycleBoundary(entry.state) }))
      .filter((candidate) => candidate.at != null && candidate.at <= now)
      .sort((a, b) => a.at - b.at || a.entry.entity_id.localeCompare(b.entry.entity_id))[0];
    if (!due) break;

    const entry = due.entry;
    const betaVoid = entry.state;
    const lifecycleKey = betaVoid.status === "defeated"
      ? `defeated:${betaVoid.next_regeneration_checkpoint}`
      : `active:${betaVoid.active_reset_at}`;
    const rng = await createServerDeterministicRandom(
      entropySecret,
      `${worldSeed}:${betaVoid.id}:${lifecycleKey}`
    );
    const sector = sectors.find((candidate) => candidate.sector_id === betaVoid.sector_id);
    const position = findBetaVoidResetPosition({
      betaVoid,
      sector,
      placedObjects,
      rng
    });
    const generation = Math.max(1, Math.round(Number(betaVoid.variant_generation) || 1) + 1);
    const boundaryAt = due.at;
    const chunk = chunkDataAtPosition(position);
    Object.assign(betaVoid, {
      position,
      chunk_id: chunk.chunk_id,
      chunk: chunk.chunk,
      local_position: chunk.local_position,
      status: "active",
      defeated_at: null,
      next_regeneration_checkpoint: null,
      ...createBetaVoidLifecycleState({ generation, now: boundaryAt, rng }),
      last_updated: boundaryAt
    });
    const placedIndex = placedObjects.findIndex((candidate) => candidate.id === betaVoid.id);
    if (placedIndex >= 0) placedObjects[placedIndex] = betaVoid;
  }

  return new Map(betaEntries.map((entry) => [entry.entity_id, entry.state]));
}

export async function getWorldEntityState(db, entityType, entityId, now = Date.now(), entropySecret) {
  const normalizedType = normalizeEntityType(entityType);
  const normalizedId = optionalId(entityId);
  if (!normalizedType || !normalizedId) return null;
  const world = await getOrCreateWorldState(db, now, entropySecret);
  const collection = {
    sector: world.snapshot.sectors,
    resource_node: world.snapshot.resource_nodes,
    building: world.snapshot.buildings,
    beta_void: world.snapshot.beta_voids
  }[normalizedType];
  return collection.find((entry) => entityIdForState(normalizedType, entry) === normalizedId) || null;
}

export async function processBetaVoidEntity(db, {
  betaVoidId,
  expectedGeneration,
  clientActionId,
  actorCharacterId,
  actorShipUid,
  issuedAt,
  expiresAt
}, now = Date.now(), entropySecret) {
  const entityId = optionalId(betaVoidId);
  const actionId = optionalId(clientActionId);
  const characterId = optionalId(actorCharacterId);
  const shipUid = optionalId(actorShipUid);
  assertWorldCommandDeadline({ issuedAt, expiresAt }, now);
  if (!entityId || !actionId || !characterId || !shipUid) {
    throw worldError(400, "WORLD_COMMAND_INVALID", "Beta Void command identifiers are required.");
  }

  const existingReceipt = await getWorldCommandReceipt(db, actionId, characterId);
  if (existingReceipt) return existingReceipt;

  await ensureWorldInitialized(db);
  const row = await db.prepare(`
    SELECT entity_type, entity_id, state_json, revision
    FROM world_entities
    WHERE world_id = ? AND entity_type = 'beta_void' AND entity_id = ?
  `).bind(PRIMARY_WORLD_ID, entityId).first();
  if (!row) throw worldError(404, "BETA_VOID_NOT_FOUND", "Beta Void was not found.");

  const current = await getWorldEntityState(db, "beta_void", entityId, now, entropySecret);
  if (!current || current.status !== "active") {
    throw worldError(409, "BETA_VOID_UNAVAILABLE", "Beta Void is unavailable.");
  }
  const generation = Math.max(1, Math.round(Number(current.variant_generation) || 1));
  if (!Number.isInteger(Number(expectedGeneration)) || Number(expectedGeneration) !== generation) {
    throw worldError(409, "BETA_VOID_GENERATION_CHANGED", "Beta Void generation changed.");
  }
  const activeSession = await db.prepare(`
    SELECT session_id
    FROM beta_space_sessions
    WHERE ship_uid = ?
      AND owner_character_id = ?
      AND source_beta_void_id = ?
      AND source_generation = ?
      AND status = 'ACTIVE'
      AND expires_at > ?
  `).bind(shipUid, characterId, entityId, generation, now).first();
  if (!activeSession) {
    throw worldError(409, "BETA_VOID_SESSION_REQUIRED", "An active Beta Space session is required.");
  }

  const defeated = {
    ...current,
    status: "defeated",
    defeated_at: now,
    next_regeneration_checkpoint: nextSixHourCheckpoint(now),
    active_reset_at: null,
    active_reset_interval_minutes: null,
    last_updated: now
  };
  const response = {
    command_type: "PROCESS_BETA_VOID",
    client_action_id: actionId,
    entity: defeated,
    recorded_at: now
  };
  const nextEntityRevision = Number(row.revision) + 1;
  const results = await db.batch([
    db.prepare(`
      UPDATE world_entities
      SET state_json = ?, sector_id = ?, chunk_id = ?, revision = revision + 1, updated_at = ?
      WHERE world_id = ? AND entity_type = 'beta_void' AND entity_id = ? AND revision = ?
    `).bind(
      JSON.stringify(defeated),
      defeated.sector_id || null,
      defeated.chunk_id || null,
      now,
      PRIMARY_WORLD_ID,
      entityId,
      Number(row.revision)
    ),
    db.prepare(`
      UPDATE world_instances
      SET revision = revision + 1, updated_at = ?
      WHERE world_id = ?
        AND EXISTS (
          SELECT 1 FROM world_entities
          WHERE world_id = ? AND entity_type = 'beta_void' AND entity_id = ?
            AND revision = ? AND updated_at = ?
        )
    `).bind(now, PRIMARY_WORLD_ID, PRIMARY_WORLD_ID, entityId, nextEntityRevision, now),
    db.prepare(`
      INSERT OR IGNORE INTO world_command_receipts (
        client_action_id, owner_character_id, command_type, response_json, created_at
      )
      SELECT ?, ?, 'PROCESS_BETA_VOID', ?, ?
      FROM world_entities
      WHERE world_id = ? AND entity_type = 'beta_void' AND entity_id = ?
        AND revision = ? AND updated_at = ?
    `).bind(
      actionId,
      characterId,
      JSON.stringify(response),
      now,
      PRIMARY_WORLD_ID,
      entityId,
      nextEntityRevision,
      now
    )
  ]);
  if (statementChanges(results[0]) !== 1) {
    const receipt = await getWorldCommandReceipt(db, actionId, characterId);
    if (receipt) return receipt;
    throw worldError(409, "BETA_VOID_REVISION_CONFLICT", "Beta Void state changed.");
  }
  return response;
}

export async function getWorldAdminSummary(db, entropySecret) {
  const world = await getOrCreateWorldState(db, Date.now(), entropySecret);
  const [entityResult, storageResult, sectorResult] = await db.batch([
    db.prepare(`
      SELECT entity_type, COUNT(*) AS count
      FROM world_entities
      WHERE world_id = ?
      GROUP BY entity_type
      ORDER BY entity_type
    `).bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM world_storages
      WHERE world_id = ?
    `).bind(PRIMARY_WORLD_ID),
    db.prepare(`
      SELECT sector_id, entity_type, COUNT(*) AS count
      FROM world_entities
      WHERE world_id = ? AND sector_id IS NOT NULL
      GROUP BY sector_id, entity_type
      ORDER BY sector_id, entity_type
    `).bind(PRIMARY_WORLD_ID)
  ]);
  const entityCounts = Object.fromEntries(
    (entityResult?.results || []).map((row) => [row.entity_type, Number(row.count)])
  );
  const sectors = new Map(
    world.snapshot.sectors.map((sector) => [
      sector.sector_id,
      {
        sector_id: sector.sector_id,
        name: sector.name || sector.sector_id,
        counts: {}
      }
    ])
  );
  for (const row of sectorResult?.results || []) {
    const entry = sectors.get(row.sector_id) || {
      sector_id: row.sector_id,
      name: row.sector_id,
      counts: {}
    };
    entry.counts[row.entity_type] = Number(row.count);
    sectors.set(row.sector_id, entry);
  }
  return {
    world: {
      world_id: world.world_id,
      data_source_key: world.data_source_key,
      schema_version: world.schema_version,
      revision: world.revision,
      generated_at: world.generated_at,
      updated_at: world.updated_at
    },
    counts: {
      sectors: entityCounts.sector || 0,
      resource_nodes: entityCounts.resource_node || 0,
      buildings: entityCounts.building || 0,
      beta_voids: entityCounts.beta_void || 0,
      world_storages: Number(storageResult?.results?.[0]?.count) || 0
    },
    sectors: [...sectors.values()]
  };
}

export async function listWorldAdminEntities(db, {
  entityType = null,
  sectorId = null,
  cursor = null,
  limit = 50
} = {}, entropySecret) {
  const world = await getOrCreateWorldState(db, Date.now(), entropySecret);
  const betaVoids = new Map(
    world.snapshot.beta_voids.map((entry) => [entry.id, entry])
  );
  const normalizedType = normalizeEntityType(entityType);
  const normalizedSector = optionalId(sectorId);
  const normalizedCursor = decodeEntityCursor(cursor);
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  const conditions = ["world_id = ?"];
  const values = [PRIMARY_WORLD_ID];
  if (normalizedType) {
    conditions.push("entity_type = ?");
    values.push(normalizedType);
  }
  if (normalizedSector) {
    conditions.push("sector_id = ?");
    values.push(normalizedSector);
  }
  if (normalizedCursor) {
    conditions.push("(entity_type > ? OR (entity_type = ? AND entity_id > ?))");
    values.push(
      normalizedCursor.entityType,
      normalizedCursor.entityType,
      normalizedCursor.entityId
    );
  }
  values.push(normalizedLimit + 1);
  const result = await db.prepare(`
    SELECT
      entity_type,
      entity_id,
      sector_id,
      chunk_id,
      state_json,
      revision,
      created_at,
      updated_at
    FROM world_entities
    WHERE ${conditions.join(" AND ")}
    ORDER BY entity_type, entity_id
    LIMIT ?
  `).bind(...values).all();
  const rows = result?.results || [];
  const hasMore = rows.length > normalizedLimit;
  const selected = rows.slice(0, normalizedLimit);
  return {
    entities: selected.map((row) => {
      const state = row.entity_type === "beta_void"
        ? betaVoids.get(row.entity_id) || parseState(row.state_json)
        : parseState(row.state_json);
      return {
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      sector_id: state.sector_id || row.sector_id,
      chunk_id: state.chunk_id || row.chunk_id,
      revision: Number(row.revision),
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
      state
    };
    }),
    next_cursor: hasMore ? encodeEntityCursor(selected.at(-1)) : null
  };
}

export async function rebuildWorldState(db, { expectedRevision } = {}, entropySecret) {
  const current = await getOrCreateWorldState(db, Date.now(), entropySecret);
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected !== current.revision) {
    throw worldError(409, "WORLD_REVISION_CONFLICT", "World revision changed.");
  }
  await initializeWorld(db, Date.now(), {
    replace: true,
    revision: current.revision + 1
  });
  return getOrCreateWorldState(db, Date.now(), entropySecret);
}

async function initializeWorld(db, generatedAt, { replace = false, revision = 1 } = {}) {
  const offset = generatedAt - Number(WORLD_TEMPLATE.templateEpoch);
  const hydrate = (value) => rebaseTimestamps(structuredClone(value), offset);
  const sectors = hydrate(WORLD_TEMPLATE.sectors);
  const resourceNodes = hydrate(WORLD_TEMPLATE.resourceNodes);
  const buildings = hydrate(WORLD_TEMPLATE.buildings);
  const betaVoids = hydrate(WORLD_TEMPLATE.betaVoids);
  const resourceManager = hydrate(WORLD_TEMPLATE.resourceManager);
  const buildingStorages = hydrate(WORLD_TEMPLATE.buildingStorages);

  const statements = [];
  if (replace) {
    statements.push(
      db.prepare("DELETE FROM economy_command_receipts"),
      db.prepare("DELETE FROM gathering_contracts"),
      db.prepare("DELETE FROM economy_occupancies"),
      db.prepare("DELETE FROM world_meta WHERE world_id = ?").bind(PRIMARY_WORLD_ID),
      db.prepare("DELETE FROM world_storages WHERE world_id = ?").bind(PRIMARY_WORLD_ID),
      db.prepare("DELETE FROM world_entities WHERE world_id = ?").bind(PRIMARY_WORLD_ID),
      db.prepare("DELETE FROM world_instances WHERE world_id = ?").bind(PRIMARY_WORLD_ID)
    );
  }
  statements.push(
    db.prepare(`
      INSERT OR IGNORE INTO world_instances (
        world_id,
        seed,
        data_source_key,
        schema_version,
        revision,
        generated_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      PRIMARY_WORLD_ID,
      WORLD_TEMPLATE.seed,
      WORLD_TEMPLATE.dataSourceKey,
      WORLD_TEMPLATE.schemaVersion,
      revision,
      generatedAt,
      generatedAt,
      generatedAt
    ),
    ...createEntityInserts(db, "sector", sectors, generatedAt),
    ...createEntityInserts(db, "resource_node", resourceNodes, generatedAt),
    ...createEntityInserts(db, "building", buildings, generatedAt),
    ...createEntityInserts(db, "beta_void", betaVoids, generatedAt),
    ...createStorageInserts(db, buildingStorages, generatedAt),
    db.prepare(`
      INSERT OR IGNORE INTO world_meta (
        world_id,
        meta_key,
        state_json,
        revision,
        created_at,
        updated_at
      )
      VALUES (?, 'resourceManager', ?, 1, ?, ?)
    `).bind(PRIMARY_WORLD_ID, JSON.stringify(resourceManager), generatedAt, generatedAt)
  );
  await db.batch(statements);
}

function createEntityInserts(db, entityType, records, now) {
  return chunkRecords(records).map((chunk) => {
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, 1, ?, ?)").join(", ");
    const values = [];
    for (const record of chunk) {
      values.push(
        PRIMARY_WORLD_ID,
        entityType,
        entityId(entityType, record),
        record.sector_id || (entityType === "sector" ? record.sector_id : null),
        record.chunk_id || null,
        JSON.stringify(record),
        Number(record.created_at) || now,
        Number(record.updated_at) || Number(record.created_at) || now
      );
    }
    return db.prepare(`
      INSERT OR IGNORE INTO world_entities (
        world_id,
        entity_type,
        entity_id,
        sector_id,
        chunk_id,
        state_json,
        revision,
        created_at,
        updated_at
      )
      VALUES ${placeholders}
    `).bind(...values);
  });
}

function createStorageInserts(db, records, now) {
  return chunkRecords(records).map((chunk) => {
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, 1, ?, ?)").join(", ");
    const values = [];
    for (const record of chunk) {
      values.push(
        PRIMARY_WORLD_ID,
        record.storage_id,
        record.storage_type,
        record.world_object_id,
        JSON.stringify(record),
        Number(record.created_at) || now,
        Number(record.updated_at) || Number(record.created_at) || now
      );
    }
    return db.prepare(`
      INSERT OR IGNORE INTO world_storages (
        world_id,
        storage_id,
        storage_type,
        world_object_id,
        state_json,
        revision,
        created_at,
        updated_at
      )
      VALUES ${placeholders}
    `).bind(...values);
  });
}

function chunkRecords(records, size = 10) {
  const chunks = [];
  for (let index = 0; index < records.length; index += size) {
    chunks.push(records.slice(index, index + size));
  }
  return chunks;
}

function entityId(entityType, record) {
  if (entityType === "sector") return record.sector_id;
  if (entityType === "resource_node") return record.resource_instance_id;
  if (entityType === "building") return record.building_instance_id;
  if (entityType === "beta_void") return record.id;
  throw worldError(500, "WORLD_TEMPLATE_INVALID", "Unknown world entity type.");
}

function entityIdForState(entityType, record) {
  return entityId(entityType, record);
}

function betaVoidLifecycleBoundary(betaVoid) {
  const value = betaVoid.status === "active"
    ? betaVoid.active_reset_at
    : betaVoid.status === "defeated"
      ? betaVoid.next_regeneration_checkpoint
      : null;
  const boundary = Number(value);
  return Number.isFinite(boundary) && boundary > 0 ? boundary : null;
}

function nextSixHourCheckpoint(now) {
  const interval = 6 * 60 * 60 * 1000;
  return (Math.floor(now / interval) + 1) * interval;
}

function assertWorldCommandDeadline({ issuedAt, expiresAt }, now) {
  const issued = Number(issuedAt);
  const expires = Number(expiresAt);
  if (
    !Number.isInteger(issued)
    || !Number.isInteger(expires)
    || expires <= issued
    || expires - issued > 10_000
    || issued > now + 2_000
  ) {
    throw worldError(400, "WORLD_COMMAND_WINDOW_INVALID", "World command window is invalid.");
  }
  if (now > expires) {
    throw worldError(409, "WORLD_COMMAND_EXPIRED", "World command expired before it reached the server.");
  }
}

async function getWorldCommandReceipt(db, clientActionId, ownerCharacterId) {
  const row = await db.prepare(`
    SELECT owner_character_id, response_json
    FROM world_command_receipts
    WHERE client_action_id = ?
  `).bind(clientActionId).first();
  if (!row) return null;
  if (row.owner_character_id !== ownerCharacterId) {
    throw worldError(409, "WORLD_ACTION_CONFLICT", "World action belongs to another character.");
  }
  return parseState(row.response_json);
}

function statementChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function rebaseTimestamps(value, offset) {
  if (Array.isArray(value)) return value.map((entry) => rebaseTimestamps(entry, offset));
  if (!value || typeof value !== "object") {
    return typeof value === "number" && value >= TIMESTAMP_FLOOR ? value + offset : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, rebaseTimestamps(entry, offset)])
  );
}

function findBetaVoidResetPosition({ betaVoid, sector, placedObjects, rng }) {
  if (!sector?.global_bounds) return { ...betaVoid.position };
  const otherObjects = placedObjects.filter((entry) => entry.id !== betaVoid.id);
  const minDistance = Math.max(0, Number(WORLD_TEMPLATE.betaVoidLifecycle?.minDistance) || 0);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const position = pickPositionInBounds(sector.global_bounds, rng);
    if (otherObjects.every((entry) => (
      !entry.position || distanceSquared(position, entry.position) >= minDistance * minDistance
    ))) {
      return position;
    }
  }
  return boundsCenter(sector.global_bounds);
}

function pickPositionInBounds(bounds, rng) {
  const margin = Math.max(0, Number(WORLD_TEMPLATE.betaVoidLifecycle?.placementMargin) || 0);
  return {
    x: Math.round(lerp(bounds.min.x + margin, bounds.max.x - margin, rng())),
    y: Math.round(lerp(bounds.min.y + margin, bounds.max.y - margin, rng())),
    z: Math.round(lerp(bounds.min.z + margin, bounds.max.z - margin, rng()))
  };
}

function createBetaVoidLifecycleState({ generation, now, rng }) {
  const enemyType = pickRandom(BETA_VOID_ENEMY_TYPES, rng) || BETA_VOID_ENEMY_TYPES[0];
  const riskLevel = pickRandom(BETA_VOID_RISK_LEVELS, rng) || BETA_VOID_RISK_LEVELS[0];
  const rewardTableId = pickRandom(BETA_VOID_REWARD_TABLE_IDS, rng) || BETA_VOID_REWARD_TABLE_IDS[0];
  const variantSuffix = Math.floor(rng() * 0xffffffff).toString(36).padStart(7, "0");
  const minMinutes = Math.max(
    1,
    Math.round(Number(WORLD_TEMPLATE.betaVoidLifecycle?.activeResetMinMinutes) || 30)
  );
  const maxMinutes = Math.max(
    minMinutes,
    Math.round(Number(WORLD_TEMPLATE.betaVoidLifecycle?.activeResetMaxMinutes) || 240)
  );
  const resetMinutes = Math.floor(rng() * (maxMinutes - minMinutes + 1)) + minMinutes;
  return {
    variant_id: `variant_${now}_${variantSuffix}`,
    variant_created_at: now,
    variant_generation: generation,
    enemy_type: enemyType,
    enemy_power: 500 + riskLevel * 250,
    risk_level: riskLevel,
    reward_table_id: rewardTableId,
    active_reset_interval_minutes: resetMinutes,
    active_reset_at: now + resetMinutes * 60 * 1000
  };
}

function chunkDataAtPosition(position) {
  const size = WORLD_TEMPLATE.movementConfig.chunkSize;
  const chunk = {
    x: Math.floor(position.x / size.x),
    y: Math.floor(position.y / size.y),
    z: Math.floor(position.z / size.z)
  };
  return {
    chunk_id: `${chunk.x}:${chunk.y}:${chunk.z}`,
    chunk,
    local_position: {
      x: position.x - chunk.x * size.x,
      y: position.y - chunk.y * size.y,
      z: position.z - chunk.z * size.z
    }
  };
}

function pickRandom(items, rng) {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] || null;
}

function boundsCenter(bounds) {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2
  };
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function lerp(min, max, t) {
  return min + (max - min) * t;
}

function normalizeEntityType(value) {
  if (value == null || value === "") return null;
  const normalized = String(value);
  if (!["sector", "resource_node", "building", "beta_void"].includes(normalized)) {
    throw worldError(400, "WORLD_ENTITY_TYPE_INVALID", "Unknown world entity type.");
  }
  return normalized;
}

function optionalId(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f]/.test(normalized)) {
    throw worldError(400, "WORLD_QUERY_INVALID", "Invalid world query.");
  }
  return normalized;
}

function encodeEntityCursor(row) {
  if (!row) return null;
  const json = JSON.stringify([row.entity_type, row.entity_id]);
  return btoa(json)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeEntityCursor(value) {
  if (value == null || value === "") return null;
  try {
    const encoded = optionalId(value);
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const parsed = JSON.parse(atob(base64 + padding));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("Invalid cursor.");
    const entityType = normalizeEntityType(parsed[0]);
    const entityId = optionalId(parsed[1]);
    if (!entityType || !entityId) throw new Error("Invalid cursor.");
    return { entityType, entityId };
  } catch {
    throw worldError(400, "WORLD_QUERY_INVALID", "Invalid world cursor.");
  }
}

function selectWorld(db, worldId) {
  return db.prepare(`
    SELECT
      world_id,
      seed,
      data_source_key,
      schema_version,
      revision,
      generated_at,
      created_at,
      updated_at
    FROM world_instances
    WHERE world_id = ?
  `).bind(worldId).first();
}

function parseState(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid state.");
    return parsed;
  } catch {
    throw worldError(500, "WORLD_STATE_CORRUPT", "Stored world state is invalid.");
  }
}

function worldError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
