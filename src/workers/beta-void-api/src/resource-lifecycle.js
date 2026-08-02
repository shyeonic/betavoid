import { WORLD_TEMPLATE } from "./generated/world-template.js";
import { ensureWorldInitialized } from "./world-state.js";
import { createServerDeterministicRandom } from "./server-determinism.js";

const PRIMARY_WORLD_ID = "primary";

export async function reconcileResourceLifecycle(db, now = Date.now(), entropySecret) {
  const worldRow = await ensureWorldInitialized(db);
  const metaRow = await db.prepare(`
    SELECT state_json, revision
    FROM world_meta
    WHERE world_id = ? AND meta_key = 'resourceManager'
  `).bind(PRIMARY_WORLD_ID).first();
  if (!metaRow) throw resourceError(500, "RESOURCE_MANAGER_MISSING", "Resource manager is unavailable.");
  const manager = parseState(metaRow.state_json);
  const config = WORLD_TEMPLATE.resourceLifecycle;
  const interval = Math.max(1, Number(manager.check_interval || config.checkInterval) || 86_400_000);
  manager.check_interval = interval;
  manager.next_check = Number(manager.next_check) || Number(manager.last_check) + interval;
  if (manager.next_check > now) {
    return {
      changed: false,
      cycles: 0,
      spawned_count: 0,
      removed_count: 0,
      next_check: manager.next_check
    };
  }

  const entityResult = await db.prepare(`
    SELECT entity_type, entity_id, state_json, revision
    FROM world_entities
    WHERE world_id = ?
      AND entity_type IN ('sector', 'resource_node', 'building')
    ORDER BY entity_type, entity_id
  `).bind(PRIMARY_WORLD_ID).all();
  const records = entityResult?.results || [];
  const originalResourceRows = records.filter((entry) => entry.entity_type === "resource_node");
  const originalResourceIds = new Set(originalResourceRows.map((entry) => entry.entity_id));
  let resources = originalResourceRows.map((entry) => parseState(entry.state_json));
  const buildings = records
    .filter((entry) => entry.entity_type === "building")
    .map((entry) => parseState(entry.state_json));
  const sectors = records
    .filter((entry) => entry.entity_type === "sector")
    .map((entry) => parseState(entry.state_json));

  const chunks = createWorldChunks(config.enabledChunkRuns, WORLD_TEMPLATE.movementConfig.chunkSize);
  const sectorChunkIds = new Set(sectors.map((sector) => sector.chunk_id).filter(Boolean));
  const offSectorChunks = chunks.filter((chunk) => !sectorChunkIds.has(chunk.chunk_id));
  let cycles = 0;
  let spawnedCount = 0;

  while (manager.next_check <= now) {
    const cycleAt = manager.next_check;
    resources = resources.filter((node) => !shouldRemoveResourceNode(node, cycleAt));
    updateResourceManagerTotals(manager, resources, buildings, config);

    const rng = await createServerDeterministicRandom(
      entropySecret,
      `${worldRow.seed}:resource-cycle:${cycleAt}`
    );
    const placedObjects = [...resources, ...buildings];
    let nextIndex = resources.length;
    for (const resourceId of config.resourceIds || []) {
      const definition = config.definitions?.[resourceId];
      const pool = ensureResourcePool(manager, resourceId, definition);
      if (!definition || !pool) continue;

      const pending = Math.max(0, Math.round(Number(pool.pending_buffer) || 0));
      const deficit = Math.max(0, Number(definition.total_capacity) - pool.current_total) + pending;
      if (deficit <= 0) {
        pool.pending_buffer = 0;
        continue;
      }
      const result = createDistributedResourceNodes({
        config,
        createdAt: cycleAt,
        definition,
        offSectorChunks: offSectorChunks.length > 0 ? offSectorChunks : chunks,
        placedObjects,
        resourceId,
        rng,
        sectors,
        seed: cycleAt,
        startIndex: nextIndex,
        totalCapacity: Math.min(deficit, Number(definition.spawn_limit_per_cycle) || 0)
      });
      resources.push(...result.nodes);
      nextIndex = result.nextIndex;
      spawnedCount += result.nodes.length;
      pool.pending_buffer = result.remaining;
    }

    manager.last_check = cycleAt;
    manager.next_check = cycleAt + interval;
    updateResourceManagerTotals(manager, resources, buildings, config);
    cycles += 1;
  }

  const finalResourceIds = new Set(resources.map((entry) => entry.resource_instance_id));
  const removedIds = [...originalResourceIds].filter((id) => !finalResourceIds.has(id));
  const inserted = resources.filter((entry) => !originalResourceIds.has(entry.resource_instance_id));
  const nextMetaRevision = Number(metaRow.revision) + 1;
  const statements = [
    ...removedIds.map((id) => db.prepare(`
      DELETE FROM world_entities
      WHERE world_id = ? AND entity_type = 'resource_node' AND entity_id = ?
    `).bind(PRIMARY_WORLD_ID, id)),
    ...createResourceInserts(db, inserted, now),
    db.prepare(`
      UPDATE world_meta
      SET state_json = ?, revision = revision + 1, updated_at = ?
      WHERE world_id = ? AND meta_key = 'resourceManager' AND revision = ?
    `).bind(JSON.stringify(manager), now, PRIMARY_WORLD_ID, Number(metaRow.revision)),
    db.prepare(`
      UPDATE world_instances
      SET revision = revision + 1, updated_at = ?
      WHERE world_id = ?
        AND EXISTS (
          SELECT 1 FROM world_meta
          WHERE world_id = ? AND meta_key = 'resourceManager'
            AND revision = ? AND updated_at = ?
        )
    `).bind(now, PRIMARY_WORLD_ID, PRIMARY_WORLD_ID, nextMetaRevision, now)
  ];
  const results = await db.batch(statements);
  const metaResult = results[statements.length - 2];
  if (statementChanges(metaResult) !== 1) {
    throw resourceError(409, "RESOURCE_LIFECYCLE_CONFLICT", "Resource lifecycle changed concurrently.");
  }
  return {
    changed: true,
    cycles,
    spawned_count: spawnedCount,
    removed_count: removedIds.length,
    next_check: manager.next_check
  };
}

function createDistributedResourceNodes({
  config,
  createdAt,
  definition,
  offSectorChunks,
  placedObjects,
  resourceId,
  rng,
  sectors,
  seed,
  startIndex,
  totalCapacity
}) {
  const nodes = [];
  let nextIndex = startIndex;
  let remaining = 0;
  const normalizedTotal = Math.max(0, Math.round(totalCapacity));
  const sectorCapacity = Math.floor(normalizedTotal * clamp01(definition.sector_ratio));
  const allocations = calculateSectorResourceAllocations(resourceId, sectorCapacity, sectors);

  for (const allocation of allocations) {
    const result = createResourceNodesForQuota({
      config,
      createdAt,
      definition,
      offSectorChunks,
      placedObjects,
      quota: allocation.capacity,
      resourceId,
      rng,
      sector: allocation.sector,
      seed,
      startIndex: nextIndex
    });
    nodes.push(...result.nodes);
    nextIndex = result.nextIndex;
    remaining += result.remaining;
  }

  const result = createResourceNodesForQuota({
    config,
    createdAt,
    definition,
    offSectorChunks,
    placedObjects,
    quota: Math.max(0, normalizedTotal - sectorCapacity),
    resourceId,
    rng,
    sector: null,
    seed,
    startIndex: nextIndex
  });
  nodes.push(...result.nodes);
  return {
    nodes,
    nextIndex: result.nextIndex,
    remaining: remaining + result.remaining
  };
}

function createResourceNodesForQuota({
  config,
  createdAt,
  definition,
  offSectorChunks,
  placedObjects,
  quota,
  resourceId,
  rng,
  sector,
  seed,
  startIndex
}) {
  const [minimum, maximum] = definition.node_capacity_range || [quota, quota];
  const nodes = [];
  let nextIndex = startIndex;
  let remaining = Math.max(0, Math.round(quota));
  while (remaining >= minimum) {
    const upper = Math.max(1, Math.min(maximum, remaining));
    const lower = Math.max(1, Math.min(minimum, upper));
    const capacity = remaining <= minimum
      ? remaining
      : Math.round(lerp(lower, upper, rng()));
    const position = sector
      ? pickPositionInSector(sector, rng, placedObjects, config.minDistance, config.placementMargin)
      : pickPositionOutsideSectors(
          offSectorChunks,
          rng,
          placedObjects,
          config.minDistance,
          config.placementMargin
        );
    const chunkData = chunkDataAtPosition(position);
    const lifetime = pickResourceLifetime(definition, rng);
    const node = {
      resource_instance_id: createResourceId(resourceId, seed, nextIndex, rng),
      resource_id: resourceId,
      type: resourceId,
      category: definition.visual?.category || config.itemTypes?.[definition.produces_item_id] || null,
      produces_item_id: definition.produces_item_id,
      item_type: config.itemTypes?.[definition.produces_item_id] || null,
      node_type: definition.node_type,
      model_id: definition.visual?.model_id || definition.visual?.modelId || null,
      sector_id: sector?.sector_id || null,
      chunk_id: chunkData.chunk_id,
      chunk: chunkData.chunk,
      position,
      local_position: chunkData.local_position,
      total_capacity: capacity,
      current_amount: capacity,
      base_yield_per_sec: definition.base_yield_per_sec,
      spawn_time: createdAt,
      expiry_time: lifetime ? createdAt + lifetime : null,
      created_at: createdAt
    };
    nodes.push(node);
    placedObjects.push(node);
    remaining -= capacity;
    nextIndex += 1;
  }
  return { nodes, nextIndex, remaining };
}

function calculateSectorResourceAllocations(resourceId, totalCapacity, sectors) {
  const weighted = sectors
    .map((sector) => ({
      sector,
      weight: Math.max(0, Number(sector.resource_weights?.[resourceId]) || 0)
    }))
    .filter((entry) => entry.weight > 0);
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0 || totalCapacity <= 0) return [];
  let assigned = 0;
  return weighted.map((entry, index) => {
    const capacity = index === weighted.length - 1
      ? Math.max(0, totalCapacity - assigned)
      : Math.round(totalCapacity * (entry.weight / totalWeight));
    assigned += capacity;
    return { sector: entry.sector, capacity };
  }).filter((entry) => entry.capacity > 0);
}

function updateResourceManagerTotals(manager, resources, buildings, config) {
  for (const resourceId of config.resourceIds || []) {
    const definition = config.definitions?.[resourceId];
    const pool = ensureResourcePool(manager, resourceId, definition);
    if (!pool) continue;
    const nodeTotal = resources
      .filter((node) => (node.resource_id || node.type) === resourceId)
      .reduce((sum, node) => sum + Math.max(0, Number(node.current_amount) || 0), 0);
    const facilityTotal = buildings
      .filter((building) => building.resource_id === resourceId)
      .reduce((sum, building) => sum + Math.max(0, Number(building.current_amount) || 0), 0);
    pool.current_total = Math.round(nodeTotal + facilityTotal);
  }
}

function ensureResourcePool(manager, resourceId, definition) {
  if (!definition) return null;
  manager.pools ||= {};
  manager.pools[resourceId] ||= {
    total_capacity: definition.total_capacity,
    current_total: 0,
    pending_buffer: 0
  };
  const pool = manager.pools[resourceId];
  pool.total_capacity = definition.total_capacity;
  pool.current_total = Math.max(0, Math.round(Number(pool.current_total) || 0));
  pool.pending_buffer = Math.max(0, Math.round(Number(pool.pending_buffer) || 0));
  return pool;
}

function shouldRemoveResourceNode(node, now) {
  return Number(node.current_amount) <= 0
    || (Number.isFinite(Number(node.expiry_time)) && Number(node.expiry_time) <= now);
}

function createWorldChunks(encodedRuns, size) {
  const chunks = [];
  for (const encoded of String(encodedRuns || "").split(";")) {
    if (!encoded) continue;
    const [x, y, start, end] = encoded.split(",").map(Number);
    for (let z = start; z <= end; z += 1) {
      const chunk = { x, y, z };
      chunks.push({
        chunk_id: `${x}:${y}:${z}`,
        global_bounds: {
          min: { x: x * size.x, y: y * size.y, z: z * size.z },
          max: { x: (x + 1) * size.x, y: (y + 1) * size.y, z: (z + 1) * size.z }
        }
      });
    }
  }
  return chunks;
}

function pickPositionInSector(sector, rng, placedObjects, minDistance, margin) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const position = pickPositionInBounds(sector.global_bounds, rng, margin);
    if (isFarEnough(position, placedObjects, minDistance)) return position;
  }
  const { min, max } = sector.global_bounds;
  const jitter = () => Math.round((rng() - 0.5) * 1200);
  return {
    x: Math.round((min.x + max.x) / 2 + jitter()),
    y: Math.round((min.y + max.y) / 2 + jitter()),
    z: Math.round((min.z + max.z) / 2 + jitter())
  };
}

function pickPositionOutsideSectors(chunks, rng, placedObjects, minDistance, margin) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const chunk = chunks[Math.floor(rng() * chunks.length)];
    const position = pickPositionInBounds(chunk.global_bounds, rng, margin);
    if (isFarEnough(position, placedObjects, minDistance)) return position;
  }
  const chunk = chunks[Math.floor(rng() * chunks.length)];
  return pickPositionInBounds(chunk.global_bounds, rng, margin);
}

function pickPositionInBounds(bounds, rng, margin) {
  return {
    x: Math.round(lerp(bounds.min.x + margin, bounds.max.x - margin, rng())),
    y: Math.round(lerp(bounds.min.y + margin, bounds.max.y - margin, rng())),
    z: Math.round(lerp(bounds.min.z + margin, bounds.max.z - margin, rng()))
  };
}

function isFarEnough(position, placedObjects, minDistance) {
  const minimumSquared = minDistance * minDistance;
  return placedObjects.every((entry) => (
    !entry.position || distanceSquared(position, entry.position) >= minimumSquared
  ));
}

function pickResourceLifetime(definition, rng) {
  if (definition.node_type !== "DECAYING") return null;
  const [minimum, maximum] = definition.lifetime_range || [0, 0];
  return Math.round(lerp(minimum, maximum, rng()));
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

function createResourceId(resourceId, seed, index, rng) {
  const suffix = Math.floor(rng() * 0xffffff).toString(16).padStart(6, "0");
  return `RES-${resourceId.toUpperCase()}-${seed}-${index}-${suffix}`;
}

function createResourceInserts(db, records, now) {
  const statements = [];
  for (let index = 0; index < records.length; index += 10) {
    const chunk = records.slice(index, index + 10);
    const placeholders = chunk.map(() => "(?, 'resource_node', ?, ?, ?, ?, 1, ?, ?)").join(", ");
    const values = [];
    for (const record of chunk) {
      values.push(
        PRIMARY_WORLD_ID,
        record.resource_instance_id,
        record.sector_id || null,
        record.chunk_id || null,
        JSON.stringify(record),
        Number(record.created_at) || now,
        now
      );
    }
    statements.push(db.prepare(`
      INSERT INTO world_entities (
        world_id, entity_type, entity_id, sector_id, chunk_id,
        state_json, revision, created_at, updated_at
      ) VALUES ${placeholders}
    `).bind(...values));
  }
  return statements;
}

function parseState(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid state.");
    return parsed;
  } catch {
    throw resourceError(500, "RESOURCE_STATE_CORRUPT", "Stored resource state is invalid.");
  }
}

function statementChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function lerp(minimum, maximum, ratio) {
  return minimum + (maximum - minimum) * ratio;
}

function resourceError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
