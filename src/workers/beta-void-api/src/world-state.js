import { WORLD_TEMPLATE } from "./generated/world-template.js";

const PRIMARY_WORLD_ID = "primary";
const TIMESTAMP_FLOOR = 1_000_000_000_000;

export async function getOrCreateWorldState(db) {
  const worldRow = await ensureWorldInitialized(db);

  const [entityResult, storageResult, metaResult] = await db.batch([
    db.prepare(`
      SELECT entity_type, state_json
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
  for (const row of entityResult?.results || []) {
    if (!entities[row.entity_type]) continue;
    entities[row.entity_type].push(parseState(row.state_json));
  }
  const meta = Object.fromEntries(
    (metaResult?.results || []).map((row) => [row.meta_key, parseState(row.state_json)])
  );

  return {
    world_id: worldRow.world_id,
    seed: worldRow.seed,
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

export async function getWorldAdminSummary(db) {
  const world = await getOrCreateWorldState(db);
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
      seed: world.seed,
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
} = {}) {
  await getOrCreateWorldState(db);
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
    entities: selected.map((row) => ({
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      sector_id: row.sector_id,
      chunk_id: row.chunk_id,
      revision: Number(row.revision),
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
      state: parseState(row.state_json)
    })),
    next_cursor: hasMore ? encodeEntityCursor(selected.at(-1)) : null
  };
}

export async function rebuildWorldState(db, { expectedRevision } = {}) {
  const current = await getOrCreateWorldState(db);
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected !== current.revision) {
    throw worldError(409, "WORLD_REVISION_CONFLICT", "World revision changed.");
  }
  await initializeWorld(db, Date.now(), {
    replace: true,
    revision: current.revision + 1
  });
  return getOrCreateWorldState(db);
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

function rebaseTimestamps(value, offset) {
  if (Array.isArray(value)) return value.map((entry) => rebaseTimestamps(entry, offset));
  if (!value || typeof value !== "object") {
    return typeof value === "number" && value >= TIMESTAMP_FLOOR ? value + offset : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, rebaseTimestamps(entry, offset)])
  );
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
