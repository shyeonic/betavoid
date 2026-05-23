import {
  BUILDING_DEFINITIONS,
  ITEM_DEFINITIONS,
  INITIAL_RESOURCE_TYPES,
  RESOURCE_DEFINITIONS,
  SECTOR_TEMPLATES,
  WORLD_CONFIG
} from "./worldDefinitions.js";

const STORE_NAMES = ["sectors", "chunks", "resourceNodes", "buildings", "meta", "settings"];

export class WorldDataManager {
  constructor({ config = WORLD_CONFIG } = {}) {
    this.config = config;
    this.db = null;
    this.snapshot = null;
  }

  async init() {
    this.db = await this.openDatabase();
    return this;
  }

  openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.dbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;
        this.ensureStore(db, "sectors", "sector_id");
        this.ensureStore(db, "chunks", "chunk_id");
        this.ensureStore(db, "resourceNodes", "resource_instance_id");
        this.ensureStore(db, "buildings", "building_instance_id");
        this.ensureStore(db, "meta", "key");
        this.ensureStore(db, "settings", "key");
        this.ensureStore(db, "navLogs", "id");
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
    });
  }

  ensureStore(db, name, keyPath) {
    if (!db.objectStoreNames.contains(name)) {
      db.createObjectStore(name, { keyPath });
    }
  }

  async loadOrCreateWorld() {
    const meta = await this.getStoreValue("meta", "world");
    if (!meta) return this.createNewWorld();

    await this.checkAndSpawnResources();
    this.snapshot = await this.getWorldSnapshot();
    return this.snapshot;
  }

  async createNewWorld({ seed = Date.now() } = {}) {
    const rng = createSeededRandom(seed);
    const now = Date.now();
    const chunks = this.createWorldChunks(now);
    const sectors = this.createSectors(now, rng, chunks);
    const placedObjects = [];
    const resourceNodes = this.createInitialResourceNodes({
      chunks,
      createdAt: now,
      placedObjects,
      rng,
      sectors,
      seed
    });
    const buildings = this.createInitialBuildings({
      createdAt: now,
      placedObjects,
      resourceNodes,
      rng,
      sectors,
      seed
    });
    const resourceManager = this.createResourceManager(now, resourceNodes, buildings);

    this.assignObjectCounts(chunks, [...resourceNodes, ...buildings]);
    const meta = {
      key: "world",
      seed,
      generated_at: now
    };
    const playerShip = this.createDefaultPlayerShipState(now, sectors);

    await this.replaceWorldData({ sectors, chunks, resourceNodes, buildings, meta, playerShip, resourceManager });
    this.snapshot = await this.getWorldSnapshot();
    return this.snapshot;
  }

  createWorldChunks(createdAt) {
    const chunks = [];
    const offsetX = Math.floor(this.config.chunkGrid.x / 2);
    const offsetY = Math.floor(this.config.chunkGrid.y / 2);
    const offsetZ = Math.floor(this.config.chunkGrid.z / 2);

    for (let zIndex = 0; zIndex < this.config.chunkGrid.z; zIndex += 1) {
      for (let yIndex = 0; yIndex < this.config.chunkGrid.y; yIndex += 1) {
        for (let xIndex = 0; xIndex < this.config.chunkGrid.x; xIndex += 1) {
          const position = {
            x: xIndex - offsetX,
            y: yIndex - offsetY,
            z: zIndex - offsetZ
          };
          chunks.push({
            chunk_id: this.getChunkId(position),
            position,
            global_bounds: this.getChunkBounds(position),
            sector_id: null,
            object_counts: {
              resources: 0,
              buildings: 0
            },
            created_at: createdAt
          });
        }
      }
    }

    return chunks;
  }

  createSectors(createdAt, rng, chunks) {
    const availableChunks = shuffle([...chunks], rng).slice(0, SECTOR_TEMPLATES.length);

    return SECTOR_TEMPLATES.map((template, index) => {
      const chunk = availableChunks[index];
      chunk.sector_id = template.sector_id;
      const min = { ...chunk.global_bounds.min };
      const max = { ...chunk.global_bounds.max };
      const chunkPosition = { ...chunk.position };

      return {
        sector_id: template.sector_id,
        name: template.name,
        theme: template.theme,
        theme_music_id: template.theme_music_id,
        stats: structuredCloneSafe(template.stats || {}),
        chunk_id: chunk.chunk_id,
        chunk: chunkPosition,
        resource_weights: { ...template.resource_weights },
        initial_buildings: structuredCloneSafe(template.initial_buildings || []),
        initial_resource_facilities: structuredCloneSafe(template.initial_resource_facilities || []),
        global_bounds: { min, max },
        chunk_bounds: {
          min: chunkPosition,
          max: chunkPosition
        },
        created_at: createdAt
      };
    });
  }

  createInitialResourceNodes({ chunks, createdAt, placedObjects, rng, sectors, seed }) {
    const resourceNodes = [];
    let nodeIndex = 0;

    for (const resourceId of INITIAL_RESOURCE_TYPES) {
      const definition = RESOURCE_DEFINITIONS[resourceId];
      if (!definition) continue;

      const totalCapacity = Math.max(0, Math.round(Number(definition.total_capacity) || 0));
      const result = this.createDistributedResourceNodes({
        chunks,
        createdAt,
        placedObjects,
        resourceId,
        rng,
        sectors,
        seed,
        startIndex: nodeIndex,
        totalCapacity
      });
      resourceNodes.push(...result.nodes);
      nodeIndex = result.nextIndex;
    }

    return resourceNodes;
  }

  createDistributedResourceNodes({
    chunks,
    createdAt,
    deferBelowMin = false,
    placedObjects,
    resourceId,
    rng,
    sectors,
    seed,
    startIndex,
    totalCapacity
  }) {
    const definition = RESOURCE_DEFINITIONS[resourceId];
    if (!definition) return { nodes: [], nextIndex: startIndex, remaining: totalCapacity };

    const nodes = [];
    let nextIndex = startIndex;
    let remaining = 0;
    const normalizedTotalCapacity = Math.max(0, Math.round(totalCapacity));
    const sectorCapacity = Math.floor(normalizedTotalCapacity * clamp01(definition.sector_ratio));
    const allocations = this.calculateSectorResourceAllocations(resourceId, sectorCapacity, sectors);

    for (const allocation of allocations) {
      const result = this.createResourceNodesForQuota({
        chunks,
        createdAt,
        deferBelowMin,
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

    const offSectorCapacity = Math.max(0, normalizedTotalCapacity - sectorCapacity);
    const result = this.createResourceNodesForQuota({
      chunks,
      createdAt,
      deferBelowMin,
      placedObjects,
      quota: offSectorCapacity,
      resourceId,
      rng,
      sector: null,
      seed,
      startIndex: nextIndex
    });
    nodes.push(...result.nodes);
    nextIndex = result.nextIndex;
    remaining += result.remaining;

    return { nodes, nextIndex, remaining };
  }

  calculateSectorResourceAllocations(resourceId, totalCapacity, sectors) {
    const weightedSectors = sectors
      .map((sector) => ({
        sector,
        weight: Math.max(0, Number(sector.resource_weights?.[resourceId]) || 0)
      }))
      .filter((entry) => entry.weight > 0);

    const totalWeight = weightedSectors.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0 || totalCapacity <= 0) return [];

    let assigned = 0;
    return weightedSectors.map((entry, index) => {
      const isLast = index === weightedSectors.length - 1;
      const capacity = isLast
        ? Math.max(0, totalCapacity - assigned)
        : Math.round(totalCapacity * (entry.weight / totalWeight));
      assigned += capacity;
      return { sector: entry.sector, capacity };
    }).filter((entry) => entry.capacity > 0);
  }

  createResourceNodesForQuota({
    chunks,
    createdAt,
    deferBelowMin = false,
    placedObjects,
    quota,
    resourceId,
    rng,
    sector,
    seed,
    startIndex
  }) {
    const definition = RESOURCE_DEFINITIONS[resourceId];
    const item = ITEM_DEFINITIONS[definition.produces_item_id] || null;
    const [minCapacity, maxCapacity] = definition.node_capacity_range || [quota, quota];
    const nodes = [];
    let nextIndex = startIndex;
    let remaining = Math.max(0, Math.round(quota));

    while (remaining > 0) {
      if (deferBelowMin && remaining < minCapacity) break;

      const upper = Math.max(1, Math.min(maxCapacity, remaining));
      const lower = Math.max(1, Math.min(minCapacity, upper));
      const capacity = remaining <= minCapacity
        ? remaining
        : Math.round(lerp(lower, upper, rng()));
      const position = sector
        ? this.pickPositionInSector(sector, rng, placedObjects, this.config.resourceMinDistance)
        : this.pickPositionOutsideSectors(chunks, rng, placedObjects, this.config.resourceMinDistance);
      const chunkData = this.getChunkDataAtPosition(position);
      const lifetime = this.pickResourceLifetime(definition, rng);
      const node = {
        resource_instance_id: this.createId("RES", resourceId, seed, nextIndex, rng),
        resource_id: resourceId,
        type: resourceId,
        category: definition.visual.category || item?.type || null,
        produces_item_id: definition.produces_item_id,
        item_type: item?.type || null,
        node_type: definition.node_type,
        model_id: definition.visual.model_id,
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

  pickResourceLifetime(definition, rng) {
    if (definition.node_type !== "DECAYING") return null;
    const [minLifetime, maxLifetime] = definition.lifetime_range || [0, 0];
    return Math.round(lerp(minLifetime, maxLifetime, rng()));
  }

  pickPositionOutsideSectors(chunks, rng, placedObjects, minDistance) {
    const candidateChunks = chunks.filter((chunk) => !chunk.sector_id);
    const availableChunks = candidateChunks.length > 0 ? candidateChunks : chunks;

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const chunk = availableChunks[Math.floor(rng() * availableChunks.length)];
      const position = this.pickPositionInBounds(chunk.global_bounds, rng);
      if (this.isFarEnough(position, placedObjects, minDistance)) return position;
    }

    const chunk = availableChunks[Math.floor(rng() * availableChunks.length)];
    return this.pickPositionInBounds(chunk.global_bounds, rng);
  }

  createInitialBuildings({ createdAt, placedObjects, resourceNodes, rng, sectors, seed }) {
    const buildings = [];
    const consumedResourceNodeIds = new Set();
    let buildingIndex = 0;

    for (const sector of sectors) {
      for (const entry of sector.initial_buildings || []) {
        for (let count = 0; count < entry.count; count += 1) {
          const building = this.createBuildingInstance({
            buildingId: entry.building_id,
            createdAt,
            index: buildingIndex,
            placedObjects,
            rng,
            sector,
            seed
          });
          if (!building) continue;
          buildings.push(building);
          placedObjects.push(building);
          buildingIndex += 1;
        }
      }

      for (const entry of sector.initial_resource_facilities || []) {
        const definition = BUILDING_DEFINITIONS[entry.building_id];
        const requiredCategory = definition?.placement_rule?.required_resource_type;
        if (!requiredCategory) continue;

        const candidates = shuffle(resourceNodes.filter((node) => (
          node.sector_id === sector.sector_id &&
          node.category === requiredCategory &&
          !consumedResourceNodeIds.has(node.resource_instance_id)
        )), rng);

        for (let count = 0; count < entry.count && candidates.length > 0; count += 1) {
          const resourceNode = candidates.pop();
          consumedResourceNodeIds.add(resourceNode.resource_instance_id);
          const building = this.createBuildingInstance({
            buildingId: entry.building_id,
            createdAt,
            index: buildingIndex,
            placedObjects,
            position: { ...resourceNode.position },
            resourceNode,
            rng,
            sector,
            seed
          });
          if (!building) continue;
          buildings.push(building);
          placedObjects.push(building);
          buildingIndex += 1;
        }
      }
    }

    removeConsumedResourceNodes(resourceNodes, consumedResourceNodeIds);
    return buildings;
  }

  createResourceManager(createdAt = Date.now(), resourceNodes = [], buildings = []) {
    const resourceManager = {
      key: "resourceManager",
      manager_id: "GLOBAL",
      last_check: createdAt,
      next_check: createdAt + this.getResourceCheckInterval(),
      check_interval: this.getResourceCheckInterval(),
      pools: {}
    };

    for (const resourceId of INITIAL_RESOURCE_TYPES) {
      this.ensureResourcePool(resourceManager, resourceId);
    }

    this.updateResourceManagerTotals(resourceManager, resourceNodes, buildings);
    return resourceManager;
  }

  ensureResourcePool(resourceManager, resourceId) {
    const definition = RESOURCE_DEFINITIONS[resourceId];
    if (!definition) return null;

    if (!resourceManager.pools) resourceManager.pools = {};
    if (!resourceManager.pools[resourceId]) {
      resourceManager.pools[resourceId] = {
        total_capacity: definition.total_capacity,
        current_total: 0,
        pending_buffer: 0
      };
    }

    const pool = resourceManager.pools[resourceId];
    pool.total_capacity = definition.total_capacity;
    pool.current_total = Math.max(0, Math.round(Number(pool.current_total) || 0));
    pool.pending_buffer = Math.max(0, Math.round(Number(pool.pending_buffer) || 0));
    return pool;
  }

  updateResourceManagerTotals(resourceManager, resourceNodes = [], buildings = []) {
    for (const resourceId of INITIAL_RESOURCE_TYPES) {
      const pool = this.ensureResourcePool(resourceManager, resourceId);
      if (!pool) continue;

      const nodeTotal = resourceNodes
        .filter((node) => (node.resource_id || node.type) === resourceId)
        .reduce((sum, node) => sum + Math.max(0, Number(node.current_amount) || 0), 0);
      const facilityTotal = buildings
        .filter((building) => building.resource_id === resourceId)
        .reduce((sum, building) => sum + Math.max(0, Number(building.current_amount) || 0), 0);

      pool.current_total = Math.round(nodeTotal + facilityTotal);
    }

    return resourceManager;
  }

  getResourceCheckInterval() {
    return Math.max(1, Number(this.config.resourceCheckInterval) || 86400000);
  }

  async checkAndSpawnResources({ force = false, now = Date.now() } = {}) {
    const [sectors, chunks, storedResourceNodes, buildings, worldMeta, storedResourceManager] = await Promise.all([
      this.getAll("sectors"),
      this.getAll("chunks"),
      this.getAll("resourceNodes"),
      this.getAll("buildings"),
      this.getStoreValue("meta", "world"),
      this.getStoreValue("meta", "resourceManager")
    ]);

    if (!worldMeta) return { checked: false, reason: "missing-world" };

    let resourceNodes = storedResourceNodes;
    const resourceManager = storedResourceManager || this.createResourceManager(now, resourceNodes, buildings);
    resourceManager.key = "resourceManager";
    resourceManager.manager_id = "GLOBAL";
    resourceManager.check_interval = this.getResourceCheckInterval();

    this.updateResourceManagerTotals(resourceManager, resourceNodes, buildings);

    if (!force && now < resourceManager.next_check) {
      await this.saveResourceManager(resourceManager);
      this.snapshot = await this.getWorldSnapshot();
      return { checked: false, reason: "not-due", resourceManager };
    }

    resourceNodes = storedResourceNodes.filter((node) => !this.shouldRemoveResourceNode(node, now));
    this.updateResourceManagerTotals(resourceManager, resourceNodes, buildings);

    const rng = createSeededRandom(`${worldMeta.seed}:${resourceManager.last_check}:${now}`);
    const placedObjects = [...resourceNodes, ...buildings];
    let nextIndex = resourceNodes.length;
    let spawnedCount = 0;

    for (const resourceId of INITIAL_RESOURCE_TYPES) {
      const definition = RESOURCE_DEFINITIONS[resourceId];
      const pool = this.ensureResourcePool(resourceManager, resourceId);
      if (!definition || !pool) continue;

      const pendingBuffer = Math.max(0, Math.round(Number(pool.pending_buffer) || 0));
      const totalBuffer = Math.max(0, definition.total_capacity - pool.current_total) + pendingBuffer;

      if (totalBuffer <= 0) {
        pool.pending_buffer = 0;
        continue;
      }

      const spawnAmount = Math.min(totalBuffer, definition.spawn_limit_per_cycle);
      const result = this.createDistributedResourceNodes({
        chunks,
        createdAt: now,
        deferBelowMin: true,
        placedObjects,
        resourceId,
        rng,
        sectors,
        seed: now,
        startIndex: nextIndex,
        totalCapacity: spawnAmount
      });

      resourceNodes.push(...result.nodes);
      nextIndex = result.nextIndex;
      spawnedCount += result.nodes.length;
      pool.pending_buffer = result.remaining;
    }

    resourceManager.last_check = now;
    resourceManager.next_check = now + resourceManager.check_interval;
    this.updateResourceManagerTotals(resourceManager, resourceNodes, buildings);
    this.resetObjectCounts(chunks);
    this.assignObjectCounts(chunks, [...resourceNodes, ...buildings]);

    await this.replaceResourceLifecycleData({ chunks, resourceNodes, resourceManager });
    this.snapshot = await this.getWorldSnapshot();

    return {
      checked: true,
      spawnedCount,
      resourceManager
    };
  }

  shouldRemoveResourceNode(node, now = Date.now()) {
    if ((Number(node.current_amount) || 0) <= 0) return true;
    return Boolean(node.expiry_time && node.expiry_time <= now);
  }

  createBuildingInstance({
    buildingId,
    createdAt,
    index,
    placedObjects,
    position = null,
    resourceNode = null,
    rng,
    sector,
    seed
  }) {
    const definition = BUILDING_DEFINITIONS[buildingId];
    if (!definition) return null;

    const resolvedPosition = position || this.pickBuildingPosition(sector, definition, rng, placedObjects);
    const chunkData = this.getChunkDataAtPosition(resolvedPosition);
    const resourceState = resourceNode
      ? {
          total_capacity: Math.max(0, Number(resourceNode.total_capacity) || 0),
          current_amount: Math.max(0, Number(resourceNode.current_amount) || 0),
          base_yield_per_sec: Number(resourceNode.base_yield_per_sec) || 0,
          resource_node_type: resourceNode.node_type || null,
          source_resource_spawn_time: resourceNode.spawn_time || null,
          source_resource_expiry_time: resourceNode.expiry_time || null
        }
      : {};

    return {
      building_instance_id: this.createId("BLD", buildingId, seed, index, rng),
      building_id: buildingId,
      model_id: definition.visual.model_id,
      sector_id: sector.sector_id,
      chunk_id: chunkData.chunk_id,
      chunk: chunkData.chunk,
      position: resolvedPosition,
      local_position: chunkData.local_position,
      hp: definition.hp,
      status: "active",
      source_resource_instance_id: resourceNode?.resource_instance_id || null,
      resource_id: resourceNode?.resource_id || null,
      resource_category: resourceNode?.category || null,
      produces_item_id: resourceNode?.produces_item_id || null,
      ...resourceState,
      created_at: createdAt
    };
  }

  pickBuildingPosition(sector, definition, rng, placedObjects) {
    const rule = definition.placement_rule || {};
    if (rule.type === "sector_anchor") {
      return this.pickPositionNearSectorCenter(sector, rng, rule.radius, placedObjects);
    }

    return this.pickPositionInSector(sector, rng, placedObjects, this.config.buildingMinDistance);
  }

  pickPositionNearSectorCenter(sector, rng, radius, placedObjects) {
    const center = this.getBoundsCenter(sector.global_bounds);
    const configuredRadius = Number.isFinite(Number(radius)) && Number(radius) > 0 ? Number(radius) : 0;
    const maxRadius = Math.max(configuredRadius, this.config.chunkSize.x * 0.08);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const offset = this.randomVectorInRadius(maxRadius, rng);
      const position = clampPositionToBounds({
        x: Math.round(center.x + offset.x),
        y: Math.round(center.y + offset.y),
        z: Math.round(center.z + offset.z)
      }, sector.global_bounds, this.config.placementMargin);
      if (this.isFarEnough(position, placedObjects, this.config.buildingMinDistance)) return position;
    }

    return clampPositionToBounds(center, sector.global_bounds, this.config.placementMargin);
  }

  randomVectorInRadius(radius, rng) {
    return {
      x: Math.round((rng() - 0.5) * radius * 2),
      y: Math.round((rng() - 0.5) * radius * 2),
      z: Math.round((rng() - 0.5) * radius * 2)
    };
  }

  pickPositionInSector(sector, rng, placedObjects, minDistance) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const position = this.pickPositionInBounds(sector.global_bounds, rng);
      if (this.isFarEnough(position, placedObjects, minDistance)) return position;
    }

    const min = sector.global_bounds.min;
    const max = sector.global_bounds.max;
    const jitter = () => Math.round((rng() - 0.5) * 1200);
    return {
      x: Math.round((min.x + max.x) / 2 + jitter()),
      y: Math.round((min.y + max.y) / 2 + jitter()),
      z: Math.round((min.z + max.z) / 2 + jitter())
    };
  }

  pickPositionInBounds(bounds, rng) {
    const margin = this.config.placementMargin;
    return {
      x: Math.round(lerp(bounds.min.x + margin, bounds.max.x - margin, rng())),
      y: Math.round(lerp(bounds.min.y + margin, bounds.max.y - margin, rng())),
      z: Math.round(lerp(bounds.min.z + margin, bounds.max.z - margin, rng()))
    };
  }

  isFarEnough(position, placedObjects, minDistance) {
    const minDistanceSq = minDistance * minDistance;
    return placedObjects.every((object) => distanceSq(position, object.position) >= minDistanceSq);
  }

  assignObjectCounts(chunks, objects) {
    const chunksById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
    for (const object of objects) {
      const chunk = chunksById.get(object.chunk_id);
      if (!chunk) continue;
      if ("resource_instance_id" in object) chunk.object_counts.resources += 1;
      if ("building_instance_id" in object) chunk.object_counts.buildings += 1;
    }
  }

  resetObjectCounts(chunks) {
    chunks.forEach((chunk) => {
      chunk.object_counts = {
        resources: 0,
        buildings: 0
      };
    });
  }

  createDefaultPlayerShipState(createdAt = Date.now(), sectors = this.snapshot?.sectors || []) {
    const position = { x: 0, y: 0, z: 0 };
    const chunkData = this.getChunkDataAtPosition(position);
    const sector = this.getSectorAtPosition(position.x, position.y, position.z, sectors);

    return {
      key: "playerShip",
      ship_id: "PLAYER-SHIP-001",
      player_id: "default",
      position,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      chunk_id: chunkData.chunk_id,
      chunk: chunkData.chunk,
      sector_id: sector?.sector_id || null,
      speed: 0,
      desiredSpeed: 0,
      created_at: createdAt,
      updated_at: createdAt
    };
  }

  async loadOrCreatePlayerShipState() {
    let state = await this.getStoreValue("meta", "playerShip");
    if (!state) {
      state = this.createDefaultPlayerShipState();
      await this.savePlayerShipState(state);
    }

    return state;
  }

  async savePlayerShipState(state) {
    const position = this.normalizeVector(state.position);
    const chunkData = this.getChunkDataAtPosition(position);
    const sector = this.getSectorAtPosition(position.x, position.y, position.z);
    const nextState = {
      ...state,
      key: "playerShip",
      position,
      rotation: this.normalizeQuaternion(state.rotation),
      chunk_id: chunkData.chunk_id,
      chunk: chunkData.chunk,
      sector_id: sector?.sector_id || null,
      speed: Number(state.speed) || 0,
      desiredSpeed: Number(state.desiredSpeed) || 0,
      updated_at: Date.now()
    };

    await this.putStoreValue("meta", nextState);
    return nextState;
  }

  async replaceWorldData({ sectors, chunks, resourceNodes, buildings, meta, playerShip, resourceManager }) {
    const transaction = this.db.transaction(STORE_NAMES, "readwrite");

    const stores = Object.fromEntries(STORE_NAMES.map((storeName) => [storeName, transaction.objectStore(storeName)]));
    STORE_NAMES.forEach((storeName) => stores[storeName].clear());
    sectors.forEach((sector) => stores.sectors.put(sector));
    chunks.forEach((chunk) => stores.chunks.put(chunk));
    resourceNodes.forEach((node) => stores.resourceNodes.put(node));
    buildings.forEach((building) => stores.buildings.put(building));
    stores.meta.put(meta);
    if (playerShip) stores.meta.put(playerShip);
    if (resourceManager) stores.meta.put(resourceManager);
    await transactionDone(transaction);
  }

  async saveResourceManager(resourceManager) {
    return this.putStoreValue("meta", {
      ...resourceManager,
      key: "resourceManager",
      manager_id: "GLOBAL"
    });
  }

  async replaceResourceLifecycleData({ chunks, resourceNodes, resourceManager }) {
    const transaction = this.db.transaction(["chunks", "resourceNodes", "meta"], "readwrite");
    const chunksStore = transaction.objectStore("chunks");
    const resourceNodesStore = transaction.objectStore("resourceNodes");
    const metaStore = transaction.objectStore("meta");

    resourceNodesStore.clear();
    chunks.forEach((chunk) => chunksStore.put(chunk));
    resourceNodes.forEach((node) => resourceNodesStore.put(node));
    metaStore.put({
      ...resourceManager,
      key: "resourceManager",
      manager_id: "GLOBAL"
    });

    await transactionDone(transaction);
  }

  async clearWorld() {
    const transaction = this.db.transaction(STORE_NAMES, "readwrite");
    STORE_NAMES.forEach((storeName) => transaction.objectStore(storeName).clear());
    await transactionDone(transaction);
    this.snapshot = await this.getWorldSnapshot();
    return this.snapshot;
  }

  async clearAllData() {
    const allStores = [...STORE_NAMES, "navLogs"];
    const transaction = this.db.transaction(allStores, "readwrite");
    allStores.forEach((storeName) => transaction.objectStore(storeName).clear());
    await transactionDone(transaction);
    this.snapshot = await this.getWorldSnapshot();
    return this.snapshot;
  }

  async deleteDatabase() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.snapshot = null;
    const names = await this.getGameDatabaseNames();
    await Promise.all(names.map((name) => deleteIndexedDbByName(name)));
  }

  async getGameDatabaseNames() {
    const prefix = "void-zero-";
    const names = new Set([this.config.dbName]);

    if (typeof indexedDB.databases === "function") {
      try {
        const databases = await indexedDB.databases();
        databases
          .map((database) => database.name)
          .filter((name) => typeof name === "string" && name.startsWith(prefix))
          .forEach((name) => names.add(name));
      } catch {
        // Some browsers expose indexedDB.databases but restrict it; fall back to the known DB.
      }
    }

    return Array.from(names);
  }

  async resetWorld() {
    return this.createNewWorld();
  }

  async getWorldSnapshot() {
    const [sectors, chunks, resourceNodes, buildings, meta, resourceManager] = await Promise.all([
      this.getAll("sectors"),
      this.getAll("chunks"),
      this.getAll("resourceNodes"),
      this.getAll("buildings"),
      this.getStoreValue("meta", "world"),
      this.getStoreValue("meta", "resourceManager")
    ]);

    this.snapshot = {
      sectors,
      chunks,
      resourceNodes,
      buildings,
      meta: meta || null,
      resourceManager: resourceManager || null
    };
    return this.snapshot;
  }

  async getSummary(position = null) {
    const snapshot = this.snapshot || await this.getWorldSnapshot();
    const currentSector = position
      ? this.getSectorAtPosition(position.x, position.y, position.z)
      : null;
    const currentChunk = position
      ? this.getChunkRecordAtPosition(position, snapshot.chunks)?.chunk_id || null
      : null;

    return {
      seed: snapshot.meta?.seed ?? "none",
      generatedAt: snapshot.meta?.generated_at ?? null,
      sectorCount: snapshot.sectors.length,
      chunkCount: snapshot.chunks.length,
      resourceCount: snapshot.resourceNodes.length,
      buildingCount: snapshot.buildings.length,
      currentSector,
      currentChunk,
      empty: snapshot.sectors.length === 0
    };
  }

  getSectorAtPosition(x, y, z, sectors = this.snapshot?.sectors || []) {
    return sectors.find((sector) => (
      x >= sector.global_bounds.min.x &&
      x <= sector.global_bounds.max.x &&
      y >= sector.global_bounds.min.y &&
      y <= sector.global_bounds.max.y &&
      z >= sector.global_bounds.min.z &&
      z <= sector.global_bounds.max.z
    )) || null;
  }

  getChunkAtPosition(x, y, z) {
    return {
      x: Math.floor(x / this.config.chunkSize.x),
      y: Math.floor(y / this.config.chunkSize.y),
      z: Math.floor(z / this.config.chunkSize.z)
    };
  }

  getChunkRecordAtPosition(position, chunks = this.snapshot?.chunks || []) {
    const chunkId = this.getChunkDataAtPosition(position).chunk_id;
    return chunks.find((chunk) => chunk.chunk_id === chunkId) || null;
  }

  getChunkDataAtPosition(position) {
    const chunk = this.getChunkAtPosition(position.x, position.y, position.z);
    return {
      chunk,
      chunk_id: this.getChunkId(chunk),
      local_position: {
        x: position.x - chunk.x * this.config.chunkSize.x,
        y: position.y - chunk.y * this.config.chunkSize.y,
        z: position.z - chunk.z * this.config.chunkSize.z
      }
    };
  }

  getChunkIdAtPosition(x, y, z) {
    return this.getChunkId(this.getChunkAtPosition(x, y, z));
  }

  getChunkId(chunk) {
    return `${chunk.x}:${chunk.y}:${chunk.z}`;
  }

  getChunkBounds(chunk) {
    return {
      min: {
        x: chunk.x * this.config.chunkSize.x,
        y: chunk.y * this.config.chunkSize.y,
        z: chunk.z * this.config.chunkSize.z
      },
      max: {
        x: (chunk.x + 1) * this.config.chunkSize.x,
        y: (chunk.y + 1) * this.config.chunkSize.y,
        z: (chunk.z + 1) * this.config.chunkSize.z
      }
    };
  }

  getBoundsCenter(bounds) {
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2
    };
  }

  async getAll(storeName) {
    return requestToPromise(this.db.transaction(storeName, "readonly").objectStore(storeName).getAll());
  }

  async getStoreValue(storeName, key) {
    return requestToPromise(this.db.transaction(storeName, "readonly").objectStore(storeName).get(key));
  }

  async putStoreValue(storeName, value) {
    return requestToPromise(this.db.transaction(storeName, "readwrite").objectStore(storeName).put(value));
  }

  createId(prefix, type, seed, index, rng) {
    const suffix = Math.floor(rng() * 0xffffff).toString(16).padStart(6, "0");
    return `${prefix}-${type.toUpperCase()}-${seed}-${index}-${suffix}`;
  }

  createNavLog({ target }) {
    const id = `NAV-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
    const log = {
      id,
      issued_at: Date.now(),
      from_position: null,
      target,
      flight_start_at: null,
      peak_speed: 0,
      flight_duration: 0,
      status: "active",
      completed_at: null,
      cancelled_at: null
    };
    this.putStoreValue("navLogs", log);
    return id;
  }

  async updateNavLog(id, updates) {
    const log = await this.getStoreValue("navLogs", id);
    if (!log) return;
    await this.putStoreValue("navLogs", { ...log, ...updates });
  }

  async getNavLogs(limit = 50) {
    const all = await this.getAll("navLogs");
    return all.sort((a, b) => b.issued_at - a.issued_at).slice(0, limit);
  }

  normalizeVector(vector = {}) {
    return {
      x: Number(vector.x) || 0,
      y: Number(vector.y) || 0,
      z: Number(vector.z) || 0
    };
  }

  normalizeQuaternion(rotation = {}) {
    const w = Number.isFinite(Number(rotation.w)) ? Number(rotation.w) : 1;
    return {
      x: Number(rotation.x) || 0,
      y: Number(rotation.y) || 0,
      z: Number(rotation.z) || 0,
      w
    };
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

function deleteIndexedDbByName(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error(`IndexedDB delete failed: ${name}`));
    request.onblocked = () => reject(new Error(`IndexedDB delete blocked: ${name}. Close other tabs and try again.`));
  });
}

function createSeededRandom(seed) {
  let value = hashSeed(String(seed));
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function lerp(min, max, t) {
  return min + (max - min) * t;
}

function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function clampPositionToBounds(position, bounds, margin = 0) {
  return {
    x: Math.round(clamp(position.x, bounds.min.x + margin, bounds.max.x - margin)),
    y: Math.round(clamp(position.y, bounds.min.y + margin, bounds.max.y - margin)),
    z: Math.round(clamp(position.z, bounds.min.z + margin, bounds.max.z - margin))
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function removeConsumedResourceNodes(resourceNodes, consumedResourceNodeIds) {
  if (consumedResourceNodeIds.size === 0) return;
  for (let index = resourceNodes.length - 1; index >= 0; index -= 1) {
    if (consumedResourceNodeIds.has(resourceNodes[index].resource_instance_id)) {
      resourceNodes.splice(index, 1);
    }
  }
}

function shuffle(items, rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}
