import { WORLD_CONFIG } from "./worldDefinitions.js";

const WORLD_STORE_NAMES = ["sectors", "chunks", "resourceNodes", "buildings", "betaVoids", "meta", "settings"];
const PLAYER_STORE_NAMES = ["characterProfiles", "storageLocations", "quantityItems", "uniqueItems", "slotAssignments"];
const STORE_NAMES = [...WORLD_STORE_NAMES, ...PLAYER_STORE_NAMES];
const DEFAULT_CHARACTER_ID = "default";
const COMBAT_SLOT_TYPES = ["weapon", "shield", "equipment"];
const BETA_VOID_ENEMY_TYPES = ["pirate_squad", "raider_group", "hostile_fleet"];
const BETA_VOID_RISK_LEVELS = [1, 2, 3, 4, 5];
const BETA_VOID_REWARD_TABLE_IDS = ["loot_91", "loot_92", "loot_93"];

function requireDefinitionMap(gameData, key) {
  const definitions = gameData?.[key];
  if (!definitions || Object.keys(definitions).length === 0) {
    throw new Error(`Game data is missing ${key}.`);
  }
  return definitions;
}

function requireDefinitionList(gameData, key) {
  const definitions = gameData?.[key];
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new Error(`Game data is missing ${key}.`);
  }
  return definitions;
}

export class WorldDataManager {
  constructor({ config = null, gameData = null } = {}) {
    if (!gameData) throw new Error("WorldDataManager requires loaded gameData.");

    this.gameData = gameData;
    this.config = config || gameData.worldConfig || WORLD_CONFIG;
    this.buildingDefinitions = requireDefinitionMap(gameData, "buildingDefinitions");
    this.itemDefinitions = requireDefinitionMap(gameData, "itemDefinitions");
    this.resourceDefinitions = requireDefinitionMap(gameData, "resourceDefinitions");
    this.shipDefinitions = requireDefinitionMap(gameData, "shipDefinitions");
    this.weaponDefinitions = gameData.weaponDefinitions || {};
    this.shieldDefinitions = gameData.shieldDefinitions || {};
    this.equipmentDefinitions = gameData.equipmentDefinitions || {};
    this.defaultShipId = gameData.defaultShipId || Object.keys(this.shipDefinitions)[0] || "ship_01";
    this.sectorTemplates = requireDefinitionList(gameData, "sectorTemplates");
    this.initialResourceTypes = requireDefinitionList(gameData, "initialResourceTypes");
    this.chunkMap = gameData.chunkMap || null;
    this.chunkAnnotations = this.chunkMap?.chunks || {};
    this.enabledChunks = Array.isArray(gameData.enabledChunks) ? gameData.enabledChunks : null;
    this.dataSourceKey = gameData.dataSourceKey || "game-data:unknown";
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
        this.ensureStore(db, "betaVoids", "id");
        this.ensureStore(db, "meta", "key");
        this.ensureStore(db, "settings", "key");
        this.ensureStore(db, "navLogs", "id");
        this.ensureStore(db, "characterProfiles", "character_id");
        this.ensureStore(db, "storageLocations", "storage_id");
        this.ensureStore(db, "quantityItems", "entry_id");
        this.ensureStore(db, "uniqueItems", "item_uid");
        this.ensureStore(db, "slotAssignments", "assignment_id");
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
    if (meta.data_source_key !== this.dataSourceKey) return this.createNewWorld();

    await this.checkAndSpawnResources();
    await this.processBetaVoidLifecycle();
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
    const betaVoids = this.createInitialBetaVoids({
      buildings,
      chunks,
      createdAt: now,
      resourceNodes,
      rng,
      sectors
    });
    const resourceManager = this.createResourceManager(now, resourceNodes, buildings);

    this.assignObjectCounts(chunks, [...resourceNodes, ...buildings]);
    const meta = {
      key: "world",
      seed,
      data_source_key: this.dataSourceKey,
      data_source_name: this.gameData?.dataSetName || "static",
      generated_at: now
    };
    const playerShip = this.createDefaultPlayerShipState(now, sectors);
    const playerAssets = this.createDefaultPlayerAssets({ createdAt: now });

    await this.replaceWorldData({ sectors, chunks, resourceNodes, buildings, betaVoids, meta, playerShip, resourceManager, playerAssets });
    this.snapshot = await this.getWorldSnapshot();
    return this.snapshot;
  }

  createWorldChunks(createdAt) {
    if (this.enabledChunks?.length > 0) {
      return this.enabledChunks
        .map((position) => ({
          x: Number(position.x) || 0,
          y: Number(position.y) || 0,
          z: Number(position.z) || 0
        }))
        .sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
        .map((position) => ({
          chunk_id: this.getChunkId(position),
          position,
          global_bounds: this.getChunkBounds(position),
          sector_id: null,
          object_counts: {
            resources: 0,
            buildings: 0
          },
          created_at: createdAt
        }));
    }

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
    const chunkById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
    const usedChunkIds = new Set();
    const randomChunks = shuffle([...chunks], rng);

    return this.sectorTemplates.map((template) => {
      const annotatedChunkId = this.findAnnotatedChunkIdForSector(template.sector_id, chunkById, usedChunkIds);
      const chunk = annotatedChunkId
        ? chunkById.get(annotatedChunkId)
        : randomChunks.find((candidate) => !usedChunkIds.has(candidate.chunk_id));
      if (!chunk) return null;
      usedChunkIds.add(chunk.chunk_id);
      chunk.sector_id = template.sector_id;
      const min = { ...chunk.global_bounds.min };
      const max = { ...chunk.global_bounds.max };
      const chunkPosition = { ...chunk.position };

      return {
        sector_id: template.sector_id,
        label_key: template.label_key,
        name: template.name,
        theme: template.theme,
        theme_key: template.theme_key,
        theme_music_id: template.theme_music_id,
        stats: structuredCloneSafe(template.stats || {}),
        chunk_id: chunk.chunk_id,
        chunk: chunkPosition,
        resource_weights: { ...template.resource_weights },
        initial_buildings: structuredCloneSafe(template.initial_buildings || []),
        initial_resource_facilities: structuredCloneSafe(template.initial_resource_facilities || []),
        beta_void_count: this.normalizeBetaVoidCount(template.beta_void_count, null),
        global_bounds: { min, max },
        chunk_bounds: {
          min: chunkPosition,
          max: chunkPosition
        },
        created_at: createdAt
      };
    }).filter(Boolean);
  }

  findAnnotatedChunkIdForSector(sectorId, chunkById, usedChunkIds) {
    for (const [chunkId, annotation] of Object.entries(this.chunkAnnotations)) {
      if (annotation?.sectorId !== sectorId) continue;
      if (!chunkById.has(chunkId) || usedChunkIds.has(chunkId)) continue;
      return chunkId;
    }
    return null;
  }

  createInitialResourceNodes({ chunks, createdAt, placedObjects, rng, sectors, seed }) {
    if (this.hasChunkMapResourceAnnotations()) {
      return this.createChunkMapResourceNodes({
        chunks,
        createdAt,
        placedObjects,
        rng,
        sectors,
        seed
      });
    }

    const resourceNodes = [];
    let nodeIndex = 0;

    for (const resourceId of this.initialResourceTypes) {
      const definition = this.resourceDefinitions[resourceId];
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

  hasChunkMapResourceAnnotations() {
    return Object.values(this.chunkAnnotations).some((annotation) => (
      Object.values(annotation?.resourceAmounts || {}).some((amount) => Number(amount) > 0)
    ));
  }

  createChunkMapResourceNodes({ chunks, createdAt, placedObjects, rng, sectors, seed }) {
    const chunkById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
    const sectorsById = new Map(sectors.map((sector) => [sector.sector_id, sector]));
    const resourceNodes = [];
    let nodeIndex = 0;

    for (const [chunkId, annotation] of Object.entries(this.chunkAnnotations)) {
      const chunk = chunkById.get(chunkId);
      if (!chunk) continue;

      const sector = sectorsById.get(annotation.sectorId || chunk.sector_id) || null;
      for (const [resourceId, rawAmount] of Object.entries(annotation.resourceAmounts || {})) {
        const capacity = Math.max(0, Math.round(Number(rawAmount) || 0));
        const definition = this.resourceDefinitions[resourceId];
        if (!definition || capacity <= 0) continue;

        const item = this.itemDefinitions[definition.produces_item_id] || null;
        const position = this.findAvailablePositionInBounds({
          bounds: chunk.global_bounds,
          placedObjects,
          rng,
          minDistance: this.config.resourceMinDistance
        });
        const chunkData = this.getChunkDataAtPosition(position);
        const lifetime = this.pickResourceLifetime(definition, rng);
        const node = {
          resource_instance_id: this.createId("RES", resourceId, seed, nodeIndex, rng),
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

        resourceNodes.push(node);
        placedObjects.push(node);
        nodeIndex += 1;
      }
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
    const definition = this.resourceDefinitions[resourceId];
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
    const definition = this.resourceDefinitions[resourceId];
    const item = this.itemDefinitions[definition.produces_item_id] || null;
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

  findAvailablePositionInBounds({ bounds, placedObjects, rng, minDistance }) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const position = this.pickPositionInBounds(bounds, rng);
      if (this.isFarEnough(position, placedObjects, minDistance)) return position;
    }

    return this.getBoundsCenter(bounds);
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
        const definition = this.buildingDefinitions[entry.building_id];
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

  createInitialBetaVoids({ buildings, chunks = this.snapshot?.chunks || [], createdAt, resourceNodes, rng, sectors }) {
    if (this.hasChunkMapBetaVoidAnnotations()) {
      return this.createChunkMapBetaVoids({
        buildings,
        chunks,
        createdAt,
        resourceNodes,
        rng,
        sectors
      });
    }

    const betaVoids = [];
    const placedObjects = [...buildings, ...resourceNodes];
    const targetSectors = sectors
      .map((sector) => ({
        sector,
        count: this.getSectorBetaVoidCount(sector, 0)
      }))
      .filter((entry) => entry.count > 0);

    for (const { sector, count } of targetSectors) {
      let placedCount = 0;
      let attempts = 0;
      const maxAttempts = Math.max(100, count * 100);

      while (placedCount < count && attempts < maxAttempts) {
        attempts += 1;
        const position = this.findAvailableBetaVoidPositionInSector({
          sector,
          placedObjects,
          rng
        });
        if (!position) continue;

        const betaVoid = this.createBetaVoidRecord({
          createdAt,
          position,
          rng,
          sector,
          sectorIndex: placedCount + 1
        });
        betaVoids.push(betaVoid);
        placedObjects.push(betaVoid);
        placedCount += 1;
      }
    }

    return betaVoids;
  }

  hasChunkMapBetaVoidAnnotations() {
    return Object.values(this.chunkAnnotations).some((annotation) => annotation?.spawnFlags?.betaVoid === true);
  }

  createChunkMapBetaVoids({ buildings, chunks = [], createdAt, resourceNodes, rng, sectors }) {
    const betaVoids = [];
    const placedObjects = [...buildings, ...resourceNodes];
    const sectorsById = new Map(sectors.map((sector) => [sector.sector_id, sector]));
    const chunksById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
    const sectorCounters = new Map();

    for (const [chunkId, annotation] of Object.entries(this.chunkAnnotations)) {
      if (annotation?.spawnFlags?.betaVoid !== true) continue;

      const chunk = chunksById.get(chunkId);
      if (!chunk) continue;
      const sector = sectorsById.get(annotation.sectorId || chunk.sector_id) || null;
      const count = this.getSectorBetaVoidCount(sector, 1);
      for (let placedCount = 0; placedCount < count; placedCount += 1) {
        const position = this.findAvailableBetaVoidPositionInBounds({
          bounds: chunk.global_bounds,
          placedObjects,
          rng
        });
        const sectorIndex = this.nextBetaVoidSectorIndex(sectorCounters, sector, chunkId);
        const betaVoid = this.createBetaVoidRecord({
          createdAt,
          position,
          rng,
          sector,
          sectorIndex
        });
        betaVoids.push(betaVoid);
        placedObjects.push(betaVoid);
      }
    }

    return betaVoids;
  }

  nextBetaVoidSectorIndex(counters, sector, fallbackKey) {
    const key = sector?.sector_id || fallbackKey || "GLOBAL";
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    return next;
  }

  getSectorBetaVoidCount(sector, fallback = 0) {
    return this.normalizeBetaVoidCount(sector?.beta_void_count, fallback);
  }

  normalizeBetaVoidCount(value, fallback = 0) {
    if (value == null || value === "") return fallback;
    return Math.max(0, Math.round(Number(value) || 0));
  }

  createBetaVoidRecord({ createdAt, position, rng = null, sector, sectorIndex }) {
    const chunkData = this.getChunkDataAtPosition(position);
    const sectorId = sector?.sector_id || "GLOBAL";
    const activeRng = typeof rng === "function"
      ? rng
      : createSeededRandom(`${sectorId}:${sectorIndex}:${createdAt}:beta-void`);
    const lifecycleState = this.createBetaVoidActiveLifecycleState({
      generation: 1,
      now: createdAt,
      rng: activeRng
    });
    return {
      id: `BETA-VOID-${sectorId}-${sectorIndex}`,
      sector_id: sector?.sector_id || null,
      sector_index: sectorIndex,
      position,
      chunk_id: chunkData.chunk_id,
      chunk: chunkData.chunk,
      local_position: chunkData.local_position,
      status: "active",
      defeated_at: null,
      next_regeneration_checkpoint: null,
      ...lifecycleState,
      created_at: createdAt,
      last_updated: createdAt
    };
  }

  createBetaVoidActiveLifecycleState({ generation = 1, now = Date.now(), rng }) {
    return {
      ...this.createBetaVoidVariant({ generation, now, rng }),
      ...this.createBetaVoidActiveResetSchedule(now, rng)
    };
  }

  createBetaVoidVariant({ generation = 1, now = Date.now(), rng }) {
    const random = typeof rng === "function" ? rng : Math.random;
    const enemyType = pickRandom(BETA_VOID_ENEMY_TYPES, random) || BETA_VOID_ENEMY_TYPES[0];
    const riskLevel = pickRandom(BETA_VOID_RISK_LEVELS, random) || BETA_VOID_RISK_LEVELS[0];
    const rewardTableId = pickRandom(BETA_VOID_REWARD_TABLE_IDS, random) || BETA_VOID_REWARD_TABLE_IDS[0];
    const variantSuffix = Math.floor(random() * 0xffffffff).toString(36).padStart(7, "0");

    return {
      variant_id: `variant_${now}_${variantSuffix}`,
      variant_created_at: now,
      variant_generation: Math.max(1, Math.round(Number(generation) || 1)),
      enemy_type: enemyType,
      enemy_power: 500 + riskLevel * 250,
      risk_level: riskLevel,
      reward_table_id: rewardTableId
    };
  }

  createBetaVoidActiveResetSchedule(now = Date.now(), rng = Math.random) {
    const minMinutes = this.getBetaVoidActiveResetMinMinutes();
    const maxMinutes = this.getBetaVoidActiveResetMaxMinutes();
    const random = typeof rng === "function" ? rng : Math.random;
    const resetMinutes = Math.floor(random() * (maxMinutes - minMinutes + 1)) + minMinutes;

    return {
      active_reset_interval_minutes: resetMinutes,
      active_reset_at: now + resetMinutes * 60 * 1000
    };
  }

  getBetaVoidActiveResetMinMinutes() {
    return Math.max(1, Math.round(Number(this.config.betaVoidActiveResetMinMinutes) || 30));
  }

  getBetaVoidActiveResetMaxMinutes() {
    const minMinutes = this.getBetaVoidActiveResetMinMinutes();
    const configuredMax = Math.round(Number(this.config.betaVoidActiveResetMaxMinutes) || 240);
    return Math.max(minMinutes, configuredMax);
  }

  findAvailableBetaVoidPositionInSector({ sector, placedObjects, rng }) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const position = this.pickBetaVoidPositionInBounds(sector.global_bounds, rng);
      if (this.isFarEnough(position, placedObjects, this.getBetaVoidMinDistance())) return position;
    }

    return this.getBoundsCenter(sector.global_bounds);
  }

  findAvailableBetaVoidPositionInBounds({ bounds, placedObjects, rng }) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const position = this.pickBetaVoidPositionInBounds(bounds, rng);
      if (this.isFarEnough(position, placedObjects, this.getBetaVoidMinDistance())) return position;
    }

    return this.getBoundsCenter(bounds);
  }

  pickBetaVoidPositionInBounds(bounds, rng) {
    const margin = this.getBetaVoidPlacementMargin();
    return {
      x: Math.round(lerp(bounds.min.x + margin, bounds.max.x - margin, rng())),
      y: Math.round(lerp(bounds.min.y + margin, bounds.max.y - margin, rng())),
      z: Math.round(lerp(bounds.min.z + margin, bounds.max.z - margin, rng()))
    };
  }

  getBetaVoidMinDistance() {
    return Math.max(0, Number(this.config.betaVoidMinDistance) || 0);
  }

  getBetaVoidPlacementMargin() {
    return Math.max(0, Number(this.config.betaVoidPlacementMargin) || 0);
  }

  getNext6HourCheckpoint(timestamp) {
    const date = new Date(timestamp);
    const hour = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const milliseconds = date.getMilliseconds();
    const currentMs = hour * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;

    let nextHour;
    if (hour < 6) {
      nextHour = 6;
    } else if (hour < 12) {
      nextHour = 12;
    } else if (hour < 18) {
      nextHour = 18;
    } else {
      nextHour = 24;
    }

    const diffMs = nextHour * 3600000 - currentMs;
    if (diffMs <= 0) {
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
      return nextDay.getTime();
    }

    const nextCheckpoint = new Date(date);
    nextCheckpoint.setHours(nextHour, 0, 0, 0);
    return nextCheckpoint.getTime();
  }

  async processBetaVoid(betaVoidId, processedAt = Date.now()) {
    const betaVoid = await this.getStoreValue("betaVoids", betaVoidId);
    if (!betaVoid || betaVoid.status !== "active") return betaVoid || null;

    const updated = {
      ...betaVoid,
      status: "defeated",
      defeated_at: processedAt,
      next_regeneration_checkpoint: this.getNext6HourCheckpoint(processedAt),
      active_reset_at: null,
      active_reset_interval_minutes: null,
      last_updated: processedAt
    };
    await this.putStoreValue("betaVoids", updated);

    if (this.snapshot?.betaVoids) {
      const index = this.snapshot.betaVoids.findIndex((item) => item.id === betaVoidId);
      if (index >= 0) this.snapshot.betaVoids[index] = updated;
    }

    return updated;
  }

  async processBetaVoidLifecycle({ now = Date.now() } = {}) {
    const [sectors, chunks, resourceNodes, buildings, storedBetaVoids, worldMeta] = await Promise.all([
      this.getAll("sectors"),
      this.getAll("chunks"),
      this.getAll("resourceNodes"),
      this.getAll("buildings"),
      this.getAll("betaVoids"),
      this.getStoreValue("meta", "world")
    ]);

    if (!worldMeta || sectors.length === 0) return { checked: false, reason: "missing-world" };

    let betaVoids = storedBetaVoids;
    let changed = false;

    if (betaVoids.length === 0) {
      betaVoids = this.createInitialBetaVoids({
        buildings,
        chunks,
        createdAt: now,
        resourceNodes,
        rng: createSeededRandom(`${worldMeta.seed}:beta-void:${now}`),
        sectors
      });
      changed = betaVoids.length > 0;
    }

    const placedObjects = [
      ...resourceNodes,
      ...buildings,
      ...betaVoids
    ];

    for (const betaVoid of betaVoids) {
      if (betaVoid.status === "defeated") {
        if (!betaVoid.next_regeneration_checkpoint) continue;
        if (now < betaVoid.next_regeneration_checkpoint) continue;

        const rng = createSeededRandom(`${worldMeta.seed}:${betaVoid.id}:defeated:${betaVoid.next_regeneration_checkpoint}`);
        const position = this.findAvailableBetaVoidResetPosition({
          betaVoid,
          chunks,
          placedObjects,
          rng,
          sectors
        });
        if (!position) continue;

        this.resetBetaVoidToActive({
          betaVoid,
          now,
          position,
          rng
        });
        changed = true;
        continue;
      }

      if (betaVoid.status !== "active") continue;

      if (!betaVoid.active_reset_at) {
        const rng = createSeededRandom(`${worldMeta.seed}:${betaVoid.id}:active-backfill:${now}`);
        Object.assign(
          betaVoid,
          this.createBetaVoidActiveLifecycleState({
            generation: Math.max(1, Math.round(Number(betaVoid.variant_generation) || 1)),
            now,
            rng
          }),
          { last_updated: now }
        );
        changed = true;
        continue;
      }

      if (now < betaVoid.active_reset_at) continue;

      const rng = createSeededRandom(`${worldMeta.seed}:${betaVoid.id}:active:${betaVoid.active_reset_at}`);
      const position = this.findAvailableBetaVoidResetPosition({
        betaVoid,
        chunks,
        placedObjects,
        rng,
        sectors
      });
      if (!position) continue;

      this.resetBetaVoidToActive({
        betaVoid,
        now,
        position,
        rng
      });
      changed = true;
    }

    if (changed) {
      const transaction = this.db.transaction(["betaVoids"], "readwrite");
      const store = transaction.objectStore("betaVoids");
      betaVoids.forEach((betaVoid) => store.put(betaVoid));
      await transactionDone(transaction);
    }

    return {
      checked: true,
      changed,
      betaVoids
    };
  }

  findAvailableBetaVoidResetPosition({ betaVoid, chunks = [], placedObjects, rng, sectors = [] }) {
    const sector = sectors.find((item) => item.sector_id === betaVoid.sector_id);
    const otherObjects = placedObjects.filter((item) => item.id !== betaVoid.id);
    if (sector) {
      return this.findAvailableBetaVoidPositionInSector({
        sector,
        placedObjects: otherObjects,
        rng
      });
    }

    const chunk = chunks.find((item) => item.chunk_id === betaVoid.chunk_id);
    if (chunk) {
      return this.findAvailableBetaVoidPositionInBounds({
        bounds: chunk.global_bounds,
        placedObjects: otherObjects,
        rng
      });
    }

    return betaVoid.position ? { ...betaVoid.position } : null;
  }

  resetBetaVoidToActive({ betaVoid, now = Date.now(), position, rng }) {
    const chunkData = this.getChunkDataAtPosition(position);
    const nextGeneration = Math.max(1, Math.round(Number(betaVoid.variant_generation) || 1) + 1);
    const lifecycleState = this.createBetaVoidActiveLifecycleState({
      generation: nextGeneration,
      now,
      rng
    });

    Object.assign(betaVoid, {
      position,
      chunk_id: chunkData.chunk_id,
      chunk: chunkData.chunk,
      local_position: chunkData.local_position,
      status: "active",
      defeated_at: null,
      next_regeneration_checkpoint: null,
      ...lifecycleState,
      last_updated: now
    });

    return betaVoid;
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

    for (const resourceId of this.initialResourceTypes) {
      this.ensureResourcePool(resourceManager, resourceId);
    }

    this.updateResourceManagerTotals(resourceManager, resourceNodes, buildings);
    return resourceManager;
  }

  ensureResourcePool(resourceManager, resourceId) {
    const definition = this.resourceDefinitions[resourceId];
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
    for (const resourceId of this.initialResourceTypes) {
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

    for (const resourceId of this.initialResourceTypes) {
      const definition = this.resourceDefinitions[resourceId];
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
    const definition = this.buildingDefinitions[buildingId];
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
    const firstSector = sectors[0] || null;
    const position = firstSector
      ? this.getBoundsCenter(firstSector.global_bounds)
      : { x: 0, y: 0, z: 0 };
    const chunkData = this.getChunkDataAtPosition(position);
    const sector = firstSector || this.getSectorAtPosition(position.x, position.y, position.z, sectors);

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

  createDefaultPlayerAssets({ createdAt = Date.now(), characterId = DEFAULT_CHARACTER_ID } = {}) {
    const shipId = this.defaultShipId;
    const activeShipUid = `ship-${characterId}-${shipId}-001`;
    const activeShipStorageId = `storage-${activeShipUid}-active`;
    const cargoStorageId = `storage-${activeShipUid}-cargo`;
    const profile = {
      character_id: characterId,
      display_name: "Pilot",
      portrait_id: "portrait_01",
      sic: 0,
      playtime_sec: 0,
      skill_nodes: {},
      achievements: {},
      blueprint_ids: [],
      active_ship_uid: activeShipUid,
      selected_ship_id: shipId,
      created_at: createdAt,
      updated_at: createdAt
    };
    const storageLocations = [
      {
        storage_id: activeShipStorageId,
        storage_type: "active_ship",
        owner_character_id: characterId,
        world_object_id: null,
        parent_item_uid: null,
        capacity: null,
        created_at: createdAt,
        updated_at: createdAt
      },
      {
        storage_id: cargoStorageId,
        storage_type: "ship_cargo",
        owner_character_id: characterId,
        world_object_id: null,
        parent_item_uid: activeShipUid,
        capacity: this.getShipBaseCargoCapacity(shipId),
        created_at: createdAt,
        updated_at: createdAt
      }
    ];
    const quantityItems = [];
    const uniqueItems = [
      {
        item_uid: activeShipUid,
        item_id: shipId,
        kind: "ship",
        owner_character_id: characterId,
        storage_id: activeShipStorageId,
        seed: null,
        fixed_options: {},
        created_at: createdAt,
        updated_at: createdAt
      }
    ];
    const slotAssignments = [];

    const ship = this.shipDefinitions[shipId] || {};
    const slots = ship.combat?.slots || {};
    for (const type of COMBAT_SLOT_TYPES) {
      for (const slot of Array.isArray(slots[type]) ? slots[type] : []) {
        if (!slot.equipped_id || !this.getCombatDefinition(type, slot.equipped_id)) continue;
        slotAssignments.push(this.createSlotAssignment({
          ownerItemUid: activeShipUid,
          slotType: type,
          slotId: slot.id,
          itemId: slot.equipped_id,
          itemUid: null,
          createdAt
        }));
      }
    }

    return {
      profile,
      storageLocations,
      quantityItems,
      uniqueItems,
      slotAssignments
    };
  }

  createQuantityItemEntry({ storageId, itemId, quantity = 0, createdAt = Date.now() }) {
    const item = this.itemDefinitions[itemId] || {};
    return {
      entry_id: `qty-${storageId}-${itemId}`,
      storage_id: storageId,
      item_id: itemId,
      kind: item.kind || item.category || "item",
      quantity: Math.max(0, Number(quantity) || 0),
      created_at: createdAt,
      updated_at: createdAt
    };
  }

  createSlotAssignment({ ownerItemUid, slotType, slotId, itemId, itemUid = null, createdAt = Date.now() }) {
    const item = this.itemDefinitions[itemId] || {};
    return {
      assignment_id: `${ownerItemUid}:${slotType}:${slotId}`,
      owner_item_uid: ownerItemUid,
      slot_type: slotType,
      slot_id: slotId,
      item_id: itemId,
      item_uid: itemUid,
      kind: item.kind || item.category || slotType,
      item_identity: itemUid ? "unique" : "quantity",
      quantity: 1,
      location_type: "ship_slot",
      created_at: createdAt,
      updated_at: createdAt
    };
  }

  createUniqueEquipmentItem({ characterId, itemId, type, storageId, activeShipUid, createdAt, uidSuffix }) {
    return {
      item_uid: `item-${characterId}-${uidSuffix}`,
      item_id: itemId,
      kind: type,
      owner_character_id: characterId,
      storage_id: storageId,
      parent_item_uid: activeShipUid,
      seed: `${itemId}:${uidSuffix}`,
      fixed_options: {},
      created_at: createdAt,
      updated_at: createdAt
    };
  }

  getShipBaseCargoCapacity(shipId) {
    return Number(this.shipDefinitions[shipId]?.combat?.base_stats?.cargo_capacity) || 0;
  }

  getCombatDefinition(type, definitionId) {
    if (type === "weapon") return this.weaponDefinitions[definitionId] || null;
    if (type === "shield") return this.shieldDefinitions[definitionId] || null;
    if (type === "equipment") return this.equipmentDefinitions[definitionId] || null;
    return null;
  }

  async loadOrCreatePlayerAssets(characterId = DEFAULT_CHARACTER_ID) {
    const profile = await this.getStoreValue("characterProfiles", characterId);
    if (!profile) {
      const playerAssets = this.createDefaultPlayerAssets({ createdAt: Date.now(), characterId });
      await this.insertPlayerAssets(playerAssets);
    }
    return this.getPlayerAssetSnapshot(characterId);
  }

  async insertPlayerAssets(playerAssets) {
    const transaction = this.db.transaction(PLAYER_STORE_NAMES, "readwrite");
    const stores = Object.fromEntries(PLAYER_STORE_NAMES.map((storeName) => [storeName, transaction.objectStore(storeName)]));
    if (playerAssets.profile) stores.characterProfiles.put(playerAssets.profile);
    (playerAssets.storageLocations || []).forEach((storage) => stores.storageLocations.put(storage));
    (playerAssets.quantityItems || []).forEach((item) => stores.quantityItems.put(item));
    (playerAssets.uniqueItems || []).forEach((item) => stores.uniqueItems.put(item));
    (playerAssets.slotAssignments || []).forEach((assignment) => stores.slotAssignments.put(assignment));
    await transactionDone(transaction);
  }

  async putCharacterProfile(profile) {
    if (!profile?.character_id) return null;
    const nextProfile = {
      ...profile,
      updated_at: Date.now()
    };
    await this.putStoreValue("characterProfiles", nextProfile);
    return nextProfile;
  }

  async getPlayerAssetSnapshot(characterId = DEFAULT_CHARACTER_ID) {
    const [profile, storageLocations, quantityItems, uniqueItems, slotAssignments] = await Promise.all([
      this.getStoreValue("characterProfiles", characterId),
      this.getAll("storageLocations"),
      this.getAll("quantityItems"),
      this.getAll("uniqueItems"),
      this.getAll("slotAssignments")
    ]);
    const ownedStorageLocations = storageLocations.filter((storage) => storage.owner_character_id === characterId);
    const ownedStorageIds = new Set(ownedStorageLocations.map((storage) => storage.storage_id));
    const ownedItemIds = new Set(uniqueItems
      .filter((item) => item.owner_character_id === characterId || ownedStorageIds.has(item.storage_id))
      .map((item) => item.item_uid));
    return {
      character_id: characterId,
      profile: profile || null,
      storageLocations: ownedStorageLocations,
      quantityItems: quantityItems.filter((item) => ownedStorageIds.has(item.storage_id)),
      uniqueItems: uniqueItems.filter((item) => item.owner_character_id === characterId || ownedStorageIds.has(item.storage_id)),
      slotAssignments: slotAssignments.filter((assignment) => ownedItemIds.has(assignment.owner_item_uid))
    };
  }

  async putUniqueItems(items = []) {
    if (!items.length) return;
    const transaction = this.db.transaction("uniqueItems", "readwrite");
    const store = transaction.objectStore("uniqueItems");
    items.forEach((item) => store.put(item));
    await transactionDone(transaction);
  }

  // Single-transaction read-modify-write: reads the authoritative player-asset
  // state from IndexedDB and feeds it to a SYNCHRONOUS computeMutation(assets)
  // callback, then writes the returned mutation in the SAME transaction. Because
  // the decision is made from the freshly-read data (not an in-memory snapshot),
  // overlapping mutations — including from other tabs — are serialized by
  // IndexedDB and cannot lose updates. computeMutation must not perform async
  // work or issue its own IndexedDB requests, or the transaction will close.
  runPlayerAssetMutation(characterId = DEFAULT_CHARACTER_ID, computeMutation = () => null) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(PLAYER_STORE_NAMES, "readwrite");
      const stores = Object.fromEntries(PLAYER_STORE_NAMES.map((name) => [name, transaction.objectStore(name)]));
      const reads = {};
      let pending = 0;
      let settled = false;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        try { transaction.abort(); } catch { /* already inactive */ }
        reject(error instanceof Error ? error : new Error("Player asset mutation failed."));
      };

      const onAllRead = () => {
        const ownedStorageLocations = (reads.storageLocations || []).filter((storage) => storage.owner_character_id === characterId);
        const ownedStorageIds = new Set(ownedStorageLocations.map((storage) => storage.storage_id));
        const ownedUniqueItems = (reads.uniqueItems || []).filter((item) => item.owner_character_id === characterId || ownedStorageIds.has(item.storage_id));
        const ownedItemIds = new Set(ownedUniqueItems.map((item) => item.item_uid));
        const assets = {
          character_id: characterId,
          profile: reads.characterProfiles || null,
          storageLocations: ownedStorageLocations,
          quantityItems: (reads.quantityItems || []).filter((item) => ownedStorageIds.has(item.storage_id)),
          uniqueItems: ownedUniqueItems,
          slotAssignments: (reads.slotAssignments || []).filter((assignment) => ownedItemIds.has(assignment.owner_item_uid))
        };

        let mutation = null;
        try {
          mutation = computeMutation(assets);
        } catch (error) {
          fail(error);
          return;
        }

        if (mutation) {
          (mutation.storageLocationsToPut || []).forEach((storage) => stores.storageLocations.put(storage));
          (mutation.storageLocationIdsToDelete || []).forEach((id) => stores.storageLocations.delete(id));
          (mutation.quantityItemIdsToDelete || []).forEach((id) => stores.quantityItems.delete(id));
          (mutation.quantityItemsToPut || []).forEach((item) => stores.quantityItems.put(item));
          (mutation.uniqueItemsToPut || []).forEach((item) => stores.uniqueItems.put(item));
          (mutation.slotAssignmentIdsToDelete || []).forEach((id) => stores.slotAssignments.delete(id));
          (mutation.slotAssignmentsToPut || []).forEach((assignment) => stores.slotAssignments.put(assignment));
        }

        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve({ committed: Boolean(mutation), assets });
        };
      };

      const issueRead = (storeName, mode) => {
        pending += 1;
        const request = mode === "get" ? stores[storeName].get(characterId) : stores[storeName].getAll();
        request.onsuccess = () => {
          reads[storeName] = request.result;
          pending -= 1;
          if (pending === 0 && !settled) onAllRead();
        };
      };

      transaction.onerror = () => fail(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => fail(transaction.error || new Error("IndexedDB transaction aborted."));

      issueRead("characterProfiles", "get");
      issueRead("storageLocations", "getAll");
      issueRead("quantityItems", "getAll");
      issueRead("uniqueItems", "getAll");
      issueRead("slotAssignments", "getAll");
    });
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

  async replaceWorldData({ sectors, chunks, resourceNodes, buildings, betaVoids = [], meta, playerShip, resourceManager, playerAssets = null }) {
    const transaction = this.db.transaction(STORE_NAMES, "readwrite");

    const stores = Object.fromEntries(STORE_NAMES.map((storeName) => [storeName, transaction.objectStore(storeName)]));
    STORE_NAMES.forEach((storeName) => stores[storeName].clear());
    sectors.forEach((sector) => stores.sectors.put(sector));
    chunks.forEach((chunk) => stores.chunks.put(chunk));
    resourceNodes.forEach((node) => stores.resourceNodes.put(node));
    buildings.forEach((building) => stores.buildings.put(building));
    betaVoids.forEach((betaVoid) => stores.betaVoids.put(betaVoid));
    stores.meta.put(meta);
    if (playerShip) stores.meta.put(playerShip);
    if (resourceManager) stores.meta.put(resourceManager);
    if (playerAssets?.profile) stores.characterProfiles.put(playerAssets.profile);
    (playerAssets?.storageLocations || []).forEach((storage) => stores.storageLocations.put(storage));
    (playerAssets?.quantityItems || []).forEach((item) => stores.quantityItems.put(item));
    (playerAssets?.uniqueItems || []).forEach((item) => stores.uniqueItems.put(item));
    (playerAssets?.slotAssignments || []).forEach((assignment) => stores.slotAssignments.put(assignment));
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
    const [sectors, chunks, resourceNodes, buildings, betaVoids, meta, resourceManager] = await Promise.all([
      this.getAll("sectors"),
      this.getAll("chunks"),
      this.getAll("resourceNodes"),
      this.getAll("buildings"),
      this.getAll("betaVoids"),
      this.getStoreValue("meta", "world"),
      this.getStoreValue("meta", "resourceManager")
    ]);

    this.snapshot = {
      sectors,
      chunks,
      resourceNodes,
      buildings,
      betaVoids,
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

  createNavLog({ type = "standard", target, from_position = null, flight_start_at = null, peak_speed = 0, flight_duration = 0, desired_speed = null, coast_duration = null, heading = null, status = "active", completed_at = null, cancelled_at = null }) {
    const id = `NAV-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
    const log = {
      id,
      type,
      issued_at: Date.now(),
      from_position,
      target,
      flight_start_at,
      peak_speed,
      flight_duration,
      desired_speed,
      coast_duration,
      heading,
      status,
      completed_at,
      cancelled_at
    };
    this.putStoreValue("navLogs", log);
    return id;
  }

  createHyperdriveNavLog(log) {
    const id = `WARP-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
    const record = { ...log, id };
    this.putStoreValue("navLogs", record);
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

function pickRandom(items, rng = Math.random) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index];
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
