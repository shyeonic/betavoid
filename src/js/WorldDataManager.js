import { WORLD_CONFIG } from "./worldDefinitions.js";

// Single IndexedDB database `beta-void` (IndexedDB has no nested databases). Stores
// are grouped by name prefix into two clearly-separated namespaces:
//   worlds_*      — cached world snapshot plus temporary client-side world actions
//   playerPrefs_* — per-character client preferences and temporary player state
// One DB keeps cross-domain transactions (mining settle, dock migration) atomic.
// Code uses LOGICAL store names; storeName() translates to the physical prefixed name.
const WORLD_STORE_KEYPATHS = {
  sectors: "sector_id",
  chunks: "chunk_id",
  resourceNodes: "resource_instance_id",
  buildings: "building_instance_id",
  betaVoids: "id",
  meta: "key",
  navLogs: "id",
  gatheringLogs: "id",
  buildingStorages: "storage_id"
};
const PLAYER_STORE_KEYPATHS = {
  characterProfiles: "character_id",
  storageLocations: "storage_id",
  quantityItems: "entry_id",
  uniqueItems: "item_uid",
  slotAssignments: "assignment_id",
  settings: "key",
  playerShip: "key"
};
const WORLD_STORES = Object.keys(WORLD_STORE_KEYPATHS);
const PLAYER_STORES = Object.keys(PLAYER_STORE_KEYPATHS);
const WORLD_STORE_SET = new Set(WORLD_STORES);
const ALL_STORES = [...WORLD_STORES, ...PLAYER_STORES];
const WORLD_CACHE_STORES = [
  "sectors",
  "chunks",
  "resourceNodes",
  "buildings",
  "betaVoids",
  "meta",
  "buildingStorages"
];
// Narrow scope: player-asset stores touched by snapshot/mutation transactions.
const PLAYER_ASSET_STORES = ["characterProfiles", "storageLocations", "quantityItems", "uniqueItems", "slotAssignments"];
const PREVIOUS_PROJECT_NAMESPACE = ["void", "zero"].join("-");
// Legacy DB names cleaned up on reset (pre single-DB merge and project rename).
const LEGACY_DB_NAMES = [
  "beta-void-world",
  "beta-void-playerPrefs",
  PREVIOUS_PROJECT_NAMESPACE,
  `${PREVIOUS_PROJECT_NAMESPACE}-world`,
  `${PREVIOUS_PROJECT_NAMESPACE}-playerPrefs`,
  "playerPrefs"
];
// TEMP test tuning: flat gather rate of 1 resource per 10 seconds, overriding
// each node's design base_yield_per_sec. Set to null to restore design rates
// (effective = node.base_yield_per_sec × gather_rate_mult).
const GATHER_TEST_RATE_PER_SEC = 0.1;
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
  constructor({
    config = null,
    gameData = null,
    onlineApi = null,
    onNavigationCommandStatus = null,
    playerState = null,
    navigationState = null,
    worldBootstrap = null
  } = {}) {
    if (!gameData) throw new Error("WorldDataManager requires loaded gameData.");
    if (!onlineApi || !playerState) throw new Error("WorldDataManager requires server player state.");
    if (!navigationState) throw new Error("WorldDataManager requires server navigation state.");
    if (!worldBootstrap) throw new Error("WorldDataManager requires a server world bootstrap.");

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
    this.onlineApi = onlineApi;
    this.onNavigationCommandStatus = typeof onNavigationCommandStatus === "function"
      ? onNavigationCommandStatus
      : null;
    this.playerServerState = normalizePlayerServerState(playerState);
    this.navigationServerState = normalizeNavigationServerState(navigationState);
    this.navigationServerReceivedAt = Date.now();
    this.navigationServerClockOffsetMs = this.navigationServerState.serverTime > 0
      ? this.navigationServerState.serverTime - this.navigationServerReceivedAt
      : 0;
    this.worldBootstrap = normalizeWorldBootstrap(worldBootstrap);
    this.playerCacheHydrated = false;
    this.playerServerMutationChain = Promise.resolve();
    this.navigationServerMutationChain = Promise.resolve();
    this.db = null;
    this.snapshot = null;
  }

  async init() {
    this.db = await this.openDatabase();
    return this;
  }

  // Single `beta-void` database; stores are created with prefixed physical names.
  openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.dbVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const [logical, keyPath] of Object.entries(WORLD_STORE_KEYPATHS)) {
          this.ensureStore(db, `worlds_${logical}`, keyPath);
        }
        for (const [logical, keyPath] of Object.entries(PLAYER_STORE_KEYPATHS)) {
          this.ensureStore(db, `playerPrefs_${logical}`, keyPath);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed: beta-void."));
    });
  }

  ensureStore(db, name, keyPath) {
    if (!db.objectStoreNames.contains(name)) {
      db.createObjectStore(name, { keyPath });
    }
  }

  // Translate a LOGICAL store name to its physical (prefixed) name in the single DB.
  storeName(logical) {
    return WORLD_STORE_SET.has(logical) ? `worlds_${logical}` : `playerPrefs_${logical}`;
  }

  // Open a transaction over LOGICAL store names; returns the tx + stores keyed by
  // logical name (so call sites keep using stores.sectors, stores.quantityItems, …).
  openTx(logicalNames, mode = "readonly") {
    const transaction = this.db.transaction(logicalNames.map((n) => this.storeName(n)), mode);
    const stores = Object.fromEntries(logicalNames.map((n) => [n, transaction.objectStore(this.storeName(n))]));
    return { transaction, stores };
  }

  async loadOrCreateWorld() {
    // The authenticated server snapshot is the source. Rebuild the disposable
    // browser cache on each session so stale local world mutations cannot win.
    return this.createWorldCache();
  }

  async refreshWorldBootstrap() {
    this.worldBootstrap = normalizeWorldBootstrap(await this.onlineApi.getWorldBootstrap());
    return this.createWorldCache();
  }

  isWorldCacheCurrent(meta) {
    const bootstrap = this.worldBootstrap;
    return Boolean(meta)
      && meta.data_source_key === this.dataSourceKey
      && meta.server_world_id === bootstrap.worldId
      && meta.server_data_source_key === bootstrap.dataSourceKey
      && Number(meta.server_revision) === bootstrap.revision
      && String(meta.seed) === bootstrap.seed
      && Number(meta.generated_at) === bootstrap.generatedAt;
  }

  async createWorldCache() {
    const bootstrap = this.worldBootstrap;
    const source = bootstrap.snapshot;
    const now = bootstrap.generatedAt;
    const chunks = this.createWorldChunks(now);
    const sectors = structuredClone(source.sectors);
    const resourceNodes = structuredClone(source.resourceNodes);
    const buildings = structuredClone(source.buildings);
    const betaVoids = structuredClone(source.betaVoids);
    const resourceManager = structuredClone(source.resourceManager);
    const stationInventories = {
      buildingStorages: structuredClone(source.buildingStorages)
    };

    this.assignObjectCounts(chunks, [...resourceNodes, ...buildings]);
    const meta = {
      key: "world",
      seed: bootstrap.seed,
      data_source_key: this.dataSourceKey,
      data_source_name: this.gameData?.dataSetName || "static",
      server_world_id: bootstrap.worldId,
      server_data_source_key: bootstrap.dataSourceKey,
      server_revision: bootstrap.revision,
      generated_at: now
    };

    await this.replaceWorldCache({
      sectors,
      chunks,
      resourceNodes,
      buildings,
      betaVoids,
      meta,
      resourceManager,
      stationInventories
    });
    this.snapshot = await this.getWorldSnapshot();
    return this.snapshot;
  }

  createGeneratedWorld({
    seed = this.worldBootstrap.seed,
    generatedAt = this.worldBootstrap.generatedAt
  } = {}) {
    const rng = createSeededRandom(seed);
    const now = generatedAt;
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
    const stationInventories = this.createInitialStationInventories(buildings, now);
    return {
      sectors,
      chunks,
      resourceNodes,
      buildings,
      betaVoids,
      meta,
      resourceManager,
      stationInventories
    };
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
      const { transaction, stores } = this.openTx(["betaVoids"], "readwrite");
      betaVoids.forEach((betaVoid) => stores.betaVoids.put(betaVoid));
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

  createPlayerShipStateKey(characterId = DEFAULT_CHARACTER_ID) {
    return characterId === DEFAULT_CHARACTER_ID ? "playerShip" : `playerShip:${characterId}`;
  }

  createDefaultPlayerShipState(createdAt = Date.now(), sectors = this.snapshot?.sectors || [], characterId = DEFAULT_CHARACTER_ID) {
    const firstSector = sectors[0] || null;
    const position = firstSector
      ? this.getBoundsCenter(firstSector.global_bounds)
      : { x: 0, y: 0, z: 0 };
    const chunkData = this.getChunkDataAtPosition(position);
    const sector = firstSector || this.getSectorAtPosition(position.x, position.y, position.z, sectors);

    return {
      key: this.createPlayerShipStateKey(characterId),
      ship_id: "PLAYER-SHIP-001",
      player_id: characterId,
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

  // ── Station inventory (item storage foundation, F1) ─────────────────────────
  // A building's tradeable/produced stock lives in a location-anchored storage
  // (storage_type "station_inventory", world_object_id = building, owner = null:
  // shared world SSoT). It reuses storageLocations + quantityItems — no new store.
  // Membership is the anchor (storage_id -> world_object_id), never a building-side
  // list, so destruction resolves field-locally. See ItemStorageSystemPlan.

  stationInventoryStorageId(buildingInstanceId) {
    return `station-inventory-${buildingInstanceId}`;
  }

  // Every building has an inventory; capacity is its first-class `storage.capacity`
  // (normalized for all buildings in GameDataLoader, overridable per building_def).
  getStationInventoryCapacity(buildingId) {
    return Math.max(0, Number(this.buildingDefinitions[buildingId]?.storage?.capacity) || 0);
  }

  // A building's storage is ONE record (world SSoT, location-anchored) with TWO
  // independent zones:
  //   - public_inventory: the station's own tradeable stock ({ item_id: quantity }).
  //   - docked_ships:     private docked-ship assets, per owner (ship_uid keyed).
  // Both live server-side anchored to world_object_id; trade touches only the public
  // zone, destruction resolves both. The docked zone is filled by the dock migration.
  buildStationInventoryStorage({ buildingInstanceId, buildingId = null, capacity = null, publicInventory = null, createdAt = Date.now() }) {
    const resolvedCapacity = capacity != null ? capacity : this.getStationInventoryCapacity(buildingId);
    return {
      storage_id: this.stationInventoryStorageId(buildingInstanceId),
      storage_type: "station_inventory",
      world_object_id: buildingInstanceId,   // anchor = destruction-resolution index
      capacity: resolvedCapacity,            // ZONE 1 (public) mass capacity
      docking_capacity: this.getStationDockingCapacity(buildingId), // ZONE 2 (private) slot capacity
      public_inventory: publicInventory || this.buildInitialInventoryMap(buildingId), // ZONE 1
      docked_ships: {},                      // ZONE 2 — { [ship_uid]: { ship_id, owner_character_id, cargo, fittings, dock_slot, ... } }
      created_at: createdAt,
      updated_at: createdAt
    };
  }

  getStationDockingCapacity(buildingId) {
    const cap = Number(this.buildingDefinitions[buildingId]?.docking?.capacity);
    return Number.isFinite(cap) ? Math.max(0, cap) : 0;
  }

  buildInitialInventoryMap(buildingId) {
    const inventory = this.buildingDefinitions[buildingId]?.initial_inventory || {};
    const map = {};
    for (const [itemId, quantity] of Object.entries(inventory)) {
      const q = Math.max(0, Number(quantity) || 0);
      if (q > 0) map[itemId] = q;
    }
    return map;
  }

  // Convert a building inventory's { item_id: quantity } map to display rows.
  stationInventoryRows(itemsMap = {}) {
    return Object.entries(itemsMap)
      .filter(([, quantity]) => (Number(quantity) || 0) > 0)
      .map(([item_id, quantity]) => ({
        item_id,
        quantity: Number(quantity) || 0,
        kind: this.itemDefinitions[item_id]?.kind || "item"
      }));
  }

  itemUnitMass(itemId) {
    return Math.max(0, Number(this.itemDefinitions[itemId]?.mass) || 0);
  }

  storageUsedMass(items = []) {
    return items.reduce((total, entry) => total + this.itemUnitMass(entry.item_id) * (Number(entry.quantity) || 0), 0);
  }

  // Integer units of `itemId` that still fit under `capacity` by mass.
  maxAddableUnits(items, capacity, itemId) {
    const unit = this.itemUnitMass(itemId);
    if (unit <= 0) return Number.MAX_SAFE_INTEGER; // mass-free item: no mass limit
    const free = Math.max(0, (Number(capacity) || 0) - this.storageUsedMass(items));
    return Math.floor(free / unit + 1e-9);
  }

  currentItemQuantity(items = [], itemId) {
    const entry = items.find((candidate) => candidate.item_id === itemId);
    return entry ? Number(entry.quantity) || 0 : 0;
  }

  // Pure: clamp a signed quantity delta for one item in a mass-capacity storage.
  // Generic across any quantityItems storage (station inventory or ship cargo).
  // Add clamps to free capacity; remove clamps to current stock. Returns the
  // applicable change as a put/delete plan plus the actually-applied amount.
  planStorageQuantityDelta({ items = [], storageId, itemId, requestedDelta, capacity = Infinity, createdAt = Date.now() }) {
    const currentQty = this.currentItemQuantity(items, itemId);
    const requested = Number(requestedDelta) || 0;
    let applied;
    let reason = null;
    if (requested >= 0) {
      const addable = this.maxAddableUnits(items, capacity, itemId);
      applied = Math.min(requested, addable);
      if (applied < requested) reason = "capacity";
    } else {
      applied = -Math.min(-requested, currentQty);
      if (-applied < -requested) reason = "insufficient";
    }
    const newQuantity = currentQty + applied;
    const entryId = `qty-${storageId}-${itemId}`;
    if (newQuantity <= 0) {
      return { applied, newQuantity: 0, entryToPut: null, entryIdToDelete: entryId, reason };
    }
    const existing = items.find((candidate) => candidate.item_id === itemId);
    const entryToPut = {
      ...this.createQuantityItemEntry({ storageId, itemId, quantity: newQuantity, createdAt }),
      created_at: existing?.created_at ?? createdAt,
      updated_at: createdAt
    };
    return { applied, newQuantity, entryToPut, entryIdToDelete: null, reason };
  }

  // ── Dock / undock custody migration (data core) ─────────────────────────────
  // Docking moves the active flying ship's whole subtree (ship + cargo + fittings)
  // from the player namespace into the station's `docked_ships` zone (world side),
  // so a station blowing up resolves it field-locally. Undock reverses it. These
  // pure builders do the data transform; the transactional move applies it.

  // Player-asset subtree (ship + its cargo + fittings) → one docked_ships entry.
  buildDockedShipEntry(assets, shipUid, { dockSlot = 0, dockedAt = Date.now() } = {}) {
    const ship = (assets.uniqueItems || []).find((item) => item.item_uid === shipUid);
    if (!ship) return null;
    const cargoStorageId = (assets.storageLocations || [])
      .find((s) => s.storage_type === "ship_cargo" && s.parent_item_uid === shipUid)?.storage_id || null;
    const cargo = {};
    for (const entry of assets.quantityItems || []) {
      if (entry.storage_id !== cargoStorageId) continue;
      const q = Math.max(0, Number(entry.quantity) || 0);
      if (q > 0) cargo[entry.item_id] = (cargo[entry.item_id] || 0) + q;
    }
    const cargoUnique = (assets.uniqueItems || [])
      .filter((e) => e.storage_id === cargoStorageId)
      .map((e) => ({ item_uid: e.item_uid, item_id: e.item_id, kind: e.kind, seed: e.seed ?? null, fixed_options: e.fixed_options || {} }));
    const fittings = (assets.slotAssignments || [])
      .filter((a) => a.owner_item_uid === shipUid)
      .map((a) => ({ slot_type: a.slot_type, slot_id: a.slot_id, item_id: a.item_id, item_uid: a.item_uid, kind: a.kind, item_identity: a.item_identity, quantity: a.quantity }));
    return {
      ship_uid: shipUid,
      ship_id: ship.item_id,
      kind: "ship",
      owner_character_id: ship.owner_character_id,
      seed: ship.seed ?? null,
      fixed_options: ship.fixed_options || {},
      dock_slot: dockSlot,
      docked_at: dockedAt,
      cargo,                 // { item_id: quantity }
      cargo_unique: cargoUnique,
      fittings
    };
  }

  // One docked_ships entry → player-asset records (inverse of buildDockedShipEntry).
  restoreDockedShipRecords(entry, { activeShipStorageId, cargoStorageId, characterId, createdAt = Date.now() }) {
    const uniqueItemsToPut = [{
      item_uid: entry.ship_uid,
      item_id: entry.ship_id,
      kind: "ship",
      owner_character_id: characterId,
      storage_id: activeShipStorageId,
      seed: entry.seed ?? null,
      fixed_options: entry.fixed_options || {},
      created_at: createdAt,
      updated_at: createdAt
    }];
    const storageLocationsToPut = [{
      storage_id: cargoStorageId,
      storage_type: "ship_cargo",
      owner_character_id: characterId,
      world_object_id: null,
      parent_item_uid: entry.ship_uid,
      capacity: this.getShipBaseCargoCapacity(entry.ship_id),
      created_at: createdAt,
      updated_at: createdAt
    }];
    const quantityItemsToPut = Object.entries(entry.cargo || {})
      .filter(([, q]) => (Number(q) || 0) > 0)
      .map(([itemId, quantity]) => this.createQuantityItemEntry({ storageId: cargoStorageId, itemId, quantity, createdAt }));
    for (const u of entry.cargo_unique || []) {
      uniqueItemsToPut.push({
        item_uid: u.item_uid,
        item_id: u.item_id,
        kind: u.kind,
        owner_character_id: characterId,
        storage_id: cargoStorageId,
        seed: u.seed ?? null,
        fixed_options: u.fixed_options || {},
        created_at: createdAt,
        updated_at: createdAt
      });
    }
    const slotAssignmentsToPut = (entry.fittings || []).map((f) => ({
      assignment_id: `${entry.ship_uid}:${f.slot_type}:${f.slot_id}`,
      owner_item_uid: entry.ship_uid,
      slot_type: f.slot_type,
      slot_id: f.slot_id,
      item_id: f.item_id,
      item_uid: f.item_uid ?? null,
      kind: f.kind,
      item_identity: f.item_identity,
      quantity: f.quantity ?? 1,
      location_type: "ship_slot",
      created_at: createdAt,
      updated_at: createdAt
    }));
    return { uniqueItemsToPut, storageLocationsToPut, quantityItemsToPut, slotAssignmentsToPut };
  }

  // Transactional custody migration (single DB → one atomic transaction). Docking
  // is a one-moment data move; there is no "docked" state stored. "Docked" is
  // DERIVED from the ship's location (which docked_ships zone it lives in).
  // DOCK: move the active ship subtree out of the player namespace into the
  // station's docked_ships zone.
  dockActiveShipToStation(characterId, buildingInstanceId, { dockSlot = 0, nowMs = Date.now() } = {}) {
    return new Promise((resolve, reject) => {
      const { transaction, stores } = this.openTx(
        ["buildingStorages", "characterProfiles", "storageLocations", "quantityItems", "uniqueItems", "slotAssignments"],
        "readwrite"
      );
      const reads = {};
      let pending = 0;
      let settled = false;
      const fail = (e) => { if (settled) return; settled = true; try { transaction.abort(); } catch { /* noop */ } reject(e instanceof Error ? e : new Error("Dock migration failed.")); };
      const resolveAbort = (val) => { settled = true; try { transaction.abort(); } catch { /* noop */ } resolve(val); };

      const onAllRead = () => {
        const storageId = this.stationInventoryStorageId(buildingInstanceId);
        const storage = (reads.buildingStorages || []).find((s) => s.storage_id === storageId);
        const profile = reads.characterProfiles;
        if (!storage || !profile) return resolveAbort({ ok: false, reason: "missing-storage-or-profile" });
        const shipUid = profile.active_ship_uid;
        const assets = {
          uniqueItems: reads.uniqueItems || [],
          storageLocations: reads.storageLocations || [],
          quantityItems: reads.quantityItems || [],
          slotAssignments: reads.slotAssignments || []
        };
        const entry = this.buildDockedShipEntry(assets, shipUid, { dockSlot, dockedAt: nowMs });
        if (!entry) return resolveAbort({ ok: false, reason: "no-active-ship" });

        const cargoStorageId = assets.storageLocations.find((s) => s.storage_type === "ship_cargo" && s.parent_item_uid === shipUid)?.storage_id || null;
        const activeStorageId = assets.uniqueItems.find((u) => u.item_uid === shipUid)?.storage_id || null;

        // ZONE 2: park the ship subtree in the station (server custody).
        stores.buildingStorages.put({ ...storage, docked_ships: { ...(storage.docked_ships || {}), [shipUid]: entry }, updated_at: nowMs });
        // Remove the subtree from the player namespace.
        stores.uniqueItems.delete(shipUid);
        assets.uniqueItems.filter((u) => u.storage_id === cargoStorageId).forEach((u) => stores.uniqueItems.delete(u.item_uid));
        assets.quantityItems.filter((e) => e.storage_id === cargoStorageId).forEach((e) => stores.quantityItems.delete(e.entry_id));
        assets.slotAssignments.filter((a) => a.owner_item_uid === shipUid).forEach((a) => stores.slotAssignments.delete(a.assignment_id));
        if (cargoStorageId) stores.storageLocations.delete(cargoStorageId);
        if (activeStorageId) stores.storageLocations.delete(activeStorageId);
        // No "docked" flag: dock is a one-moment data move. "Docked" is DERIVED from
        // the ship's location (it now lives in this station's docked_ships zone).

        transaction.oncomplete = () => { if (settled) return; settled = true; resolve({ committed: true, station_id: buildingInstanceId, ship_uid: shipUid, dock_slot: dockSlot }); };
      };

      const issue = (key, request) => { pending += 1; request.onsuccess = () => { reads[key] = request.result; pending -= 1; if (pending === 0 && !settled) onAllRead(); }; };
      transaction.onerror = () => fail(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => { if (!settled) fail(transaction.error || new Error("IndexedDB transaction aborted.")); };
      issue("buildingStorages", stores.buildingStorages.getAll());
      issue("characterProfiles", stores.characterProfiles.get(characterId));
      issue("storageLocations", stores.storageLocations.getAll());
      issue("quantityItems", stores.quantityItems.getAll());
      issue("uniqueItems", stores.uniqueItems.getAll());
      issue("slotAssignments", stores.slotAssignments.getAll());
    });
  }

  // UNDOCK: move the ship subtree back from docked_ships into the player namespace.
  undockShipFromStation(characterId, buildingInstanceId, { nowMs = Date.now() } = {}) {
    return new Promise((resolve, reject) => {
      const { transaction, stores } = this.openTx(
        ["buildingStorages", "characterProfiles", "storageLocations", "quantityItems", "uniqueItems", "slotAssignments"],
        "readwrite"
      );
      const reads = {};
      let pending = 0;
      let settled = false;
      const fail = (e) => { if (settled) return; settled = true; try { transaction.abort(); } catch { /* noop */ } reject(e instanceof Error ? e : new Error("Undock migration failed.")); };
      const resolveAbort = (val) => { settled = true; try { transaction.abort(); } catch { /* noop */ } resolve(val); };

      const onAllRead = () => {
        const storageId = this.stationInventoryStorageId(buildingInstanceId);
        const storage = (reads.buildingStorages || []).find((s) => s.storage_id === storageId);
        const profile = reads.characterProfiles;
        if (!storage || !profile) return resolveAbort({ ok: false, reason: "missing-storage-or-profile" });
        const shipUid = profile.active_ship_uid;
        const entry = storage.docked_ships?.[shipUid];
        if (!entry) return resolveAbort({ ok: false, reason: "ship-not-docked" });

        const activeShipStorageId = `storage-${shipUid}-active`;
        const cargoStorageId = `storage-${shipUid}-cargo`;
        const restored = this.restoreDockedShipRecords(entry, { activeShipStorageId, cargoStorageId, characterId, createdAt: nowMs });

        // Re-create the active_ship storage + restored subtree in the player namespace.
        stores.storageLocations.put({
          storage_id: activeShipStorageId, storage_type: "active_ship", owner_character_id: characterId,
          world_object_id: null, parent_item_uid: null, capacity: null, created_at: nowMs, updated_at: nowMs
        });
        restored.storageLocationsToPut.forEach((s) => stores.storageLocations.put(s));
        restored.uniqueItemsToPut.forEach((u) => stores.uniqueItems.put(u));
        restored.quantityItemsToPut.forEach((e) => stores.quantityItems.put(e));
        restored.slotAssignmentsToPut.forEach((a) => stores.slotAssignments.put(a));

        // Remove from station docked zone. No flag to clear — the ship leaving the
        // docked_ships zone (back into the player namespace) IS the state change.
        const nextDocked = { ...(storage.docked_ships || {}) };
        delete nextDocked[shipUid];
        stores.buildingStorages.put({ ...storage, docked_ships: nextDocked, updated_at: nowMs });

        transaction.oncomplete = () => { if (settled) return; settled = true; resolve({ committed: true, ship_uid: shipUid }); };
      };

      const issue = (key, request) => { pending += 1; request.onsuccess = () => { reads[key] = request.result; pending -= 1; if (pending === 0 && !settled) onAllRead(); }; };
      transaction.onerror = () => fail(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => { if (!settled) fail(transaction.error || new Error("IndexedDB transaction aborted.")); };
      issue("buildingStorages", stores.buildingStorages.getAll());
      issue("characterProfiles", stores.characterProfiles.get(characterId));
    });
  }

  // Location truth: find which station's docked_ships zone holds a ship (or null).
  // This is how "docked" is determined — by where the ship is, not a stored flag.
  async findDockedShip(shipUid) {
    if (!shipUid) return null;
    const all = await this.getAll("buildingStorages");
    for (const storage of all) {
      const entry = storage.docked_ships?.[shipUid];
      if (entry) return { station_id: storage.world_object_id, entry };
    }
    return null;
  }

  // ── Production (timestamp-derived, global world data) ────────────────────────
  // A producing facility yields 1 output unit per interval. State = an anchor
  // (last_production_at) on the building INSTANCE; cadence = interval_ms on the
  // building DEFINITION (per-building). No per-tick storage — the produced amount
  // is derived from anchor + now and materialized at access boundaries (settle).
  // Pure: how many units accrued and the new anchor, capped by free mass capacity.
  // Caps at full and does NOT bank time while full (anchor jumps to now when capped).
  planProduction({ anchorMs, nowMs, intervalMs, amountPerInterval = 1, currentQty = 0, usedMass = 0, capacity = 0, unitMass = 0 }) {
    const interval = Number(intervalMs) || 0;
    if (interval <= 0) return { producedUnits: 0, applied: 0, newAnchorMs: anchorMs, newQty: currentQty };
    const cycles = Math.max(0, Math.floor((nowMs - anchorMs) / interval));
    const producedUnits = cycles * (Number(amountPerInterval) || 1);
    if (producedUnits <= 0) return { producedUnits: 0, applied: 0, newAnchorMs: anchorMs, newQty: currentQty };
    const freeUnits = unitMass > 0 ? Math.max(0, Math.floor((capacity - usedMass) / unitMass + 1e-9)) : producedUnits;
    const applied = Math.min(producedUnits, freeUnits);
    // Not capped → advance anchor by the consumed cycles (keep sub-interval remainder).
    // Capped (inventory full) → discard banked time so it doesn't burst later.
    const newAnchorMs = applied < producedUnits ? nowMs : anchorMs + cycles * interval;
    return { producedUnits, applied, newAnchorMs, newQty: currentQty + applied };
  }

  // Settle a facility's production to `nowMs` (single transaction: building anchor +
  // its station inventory). Producing = building has produces_item_id and its def
  // production_profile sinks to building_inventory. No-op when nothing is due.
  settleBuildingProduction(buildingInstanceId, nowMs = Date.now()) {
    return new Promise((resolve, reject) => {
      const { transaction, stores } = this.openTx(["buildings", "buildingStorages"], "readwrite");
      const storageId = this.stationInventoryStorageId(buildingInstanceId);
      const reads = {};
      let pending = 2;
      let settled = false;
      const fail = (e) => { if (settled) return; settled = true; try { transaction.abort(); } catch { /* noop */ } reject(e instanceof Error ? e : new Error("Production settle failed.")); };
      const done = (val) => { if (settled) return; settled = true; resolve(val); };

      const onAllRead = () => {
        const building = reads.building;
        if (!building) return done({ produced: 0 });
        const profile = this.buildingDefinitions[building.building_id]?.production_profile;
        const itemId = building.produces_item_id;
        if (!itemId || !profile || profile.output_sink !== "building_inventory" || !(profile.interval_ms > 0)) return done({ produced: 0 });
        const storage = reads.storage;
        if (!storage) return done({ produced: 0 });

        const anchor = Number.isFinite(Number(building.last_production_at)) ? Number(building.last_production_at) : (Number(building.created_at) || nowMs);
        const usedMass = this.storageUsedMass(this.stationInventoryRows(storage.public_inventory));
        const plan = this.planProduction({
          anchorMs: anchor,
          nowMs,
          intervalMs: profile.interval_ms,
          amountPerInterval: profile.amount_per_interval,
          currentQty: Number(storage.public_inventory?.[itemId]) || 0,
          usedMass,
          capacity: Number(storage.capacity) || 0,
          unitMass: this.itemUnitMass(itemId)
        });
        if (plan.producedUnits <= 0) return done({ produced: 0 });
        // Always advance the anchor (prevents banking time while full).
        stores.buildings.put({ ...building, last_production_at: plan.newAnchorMs });
        if (plan.applied > 0) {
          const nextInventory = { ...(storage.public_inventory || {}) };
          nextInventory[itemId] = (Number(nextInventory[itemId]) || 0) + plan.applied;
          stores.buildingStorages.put({ ...storage, public_inventory: nextInventory, updated_at: nowMs });
        }
        transaction.oncomplete = () => { if (settled) return; settled = true; resolve({ produced: plan.applied, item_id: itemId, full: plan.applied < plan.producedUnits }); };
      };

      const issue = (key, request) => { request.onsuccess = () => { reads[key] = request.result; pending -= 1; if (pending === 0 && !settled) onAllRead(); }; };
      transaction.onerror = () => fail(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => { if (!settled) fail(transaction.error || new Error("IndexedDB transaction aborted.")); };
      issue("building", stores.buildings.get(buildingInstanceId));
      issue("storage", stores.buildingStorages.get(storageId));
    });
  }

  // ── Trade: load/unload between a docked ship's cargo and the station's public stock ──
  // While docked, BOTH the ship's cargo (docked_ships[ship].cargo) and the station's
  // public_inventory live in the same buildingStorages record, so a transfer is one
  // record mutation (server-authoritative). Pure planner clamps by stock + mass capacity.
  //   direction "out" = station public stock → ship cargo (withdraw / load)
  //   direction "in"  = ship cargo → station public stock (deposit / unload)
  planStationTrade({ direction, itemId, amount, publicInventory = {}, cargo = {}, stationCapacity = 0, cargoCapacity = 0, unitMass = 0 }) {
    const want = Math.max(0, Math.floor(Number(amount) || 0));
    const pub = { ...publicInventory };
    const car = { ...cargo };
    const pubUsed = this.storageUsedMass(this.stationInventoryRows(pub));
    const carUsed = this.storageUsedMass(this.stationInventoryRows(car));
    const freeUnits = (capacity, used) => (unitMass > 0 ? Math.max(0, Math.floor((capacity - used) / unitMass + 1e-9)) : want);
    let applied = 0;
    let reason = null;
    if (direction === "out") {
      const stock = Number(pub[itemId]) || 0;
      applied = Math.min(want, stock, freeUnits(cargoCapacity, carUsed));
      if (applied < want) reason = stock <= applied ? "insufficient-stock" : "cargo-full";
      if (applied > 0) {
        pub[itemId] = stock - applied; if (pub[itemId] <= 0) delete pub[itemId];
        car[itemId] = (Number(car[itemId]) || 0) + applied;
      }
    } else if (direction === "in") {
      const stock = Number(car[itemId]) || 0;
      applied = Math.min(want, stock, freeUnits(stationCapacity, pubUsed));
      if (applied < want) reason = stock <= applied ? "insufficient-cargo" : "station-full";
      if (applied > 0) {
        car[itemId] = stock - applied; if (car[itemId] <= 0) delete car[itemId];
        pub[itemId] = (Number(pub[itemId]) || 0) + applied;
      }
    } else {
      return { applied: 0, reason: "bad-direction", nextPublic: publicInventory, nextCargo: cargo };
    }
    return { applied, reason, nextPublic: pub, nextCargo: car };
  }

  // Transactional load/unload at a docked station (one buildingStorages record).
  runStationTrade(buildingInstanceId, shipUid, { itemId, direction, amount, nowMs = Date.now() } = {}) {
    return new Promise((resolve, reject) => {
      const { transaction, stores } = this.openTx(["buildingStorages"], "readwrite");
      const storageId = this.stationInventoryStorageId(buildingInstanceId);
      let settled = false;
      const fail = (e) => { if (settled) return; settled = true; try { transaction.abort(); } catch { /* noop */ } reject(e instanceof Error ? e : new Error("Trade failed.")); };
      const resolveAbort = (val) => { if (settled) return; settled = true; try { transaction.abort(); } catch { /* noop */ } resolve(val); };
      transaction.onerror = () => fail(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => { if (!settled) fail(transaction.error || new Error("IndexedDB transaction aborted.")); };
      const request = stores.buildingStorages.get(storageId);
      request.onsuccess = () => {
        const storage = request.result;
        if (!storage) return resolveAbort({ ok: false, reason: "no-station-storage" });
        const entry = storage.docked_ships?.[shipUid];
        if (!entry) return resolveAbort({ ok: false, reason: "ship-not-docked" });
        const plan = this.planStationTrade({
          direction, itemId, amount,
          publicInventory: storage.public_inventory, cargo: entry.cargo,
          stationCapacity: Number(storage.capacity) || 0,
          cargoCapacity: this.getShipBaseCargoCapacity(entry.ship_id),
          unitMass: this.itemUnitMass(itemId)
        });
        if (plan.applied <= 0) return resolveAbort({ ok: false, applied: 0, reason: plan.reason });
        const nextEntry = { ...entry, cargo: plan.nextCargo };
        stores.buildingStorages.put({
          ...storage,
          public_inventory: plan.nextPublic,
          docked_ships: { ...storage.docked_ships, [shipUid]: nextEntry },
          updated_at: nowMs
        });
        transaction.oncomplete = () => { if (settled) return; settled = true; resolve({ committed: true, applied: plan.applied, direction, item_id: itemId, reason: plan.reason }); };
      };
    });
  }

  // Read-only, AUTHORITATIVE: a building's station inventory from the persisted
  // store. Canonical stock is seeded into the store at world generation
  // (createInitialStationInventories), so there is no definition-derived fallback —
  // empty result means the building genuinely holds nothing.
  async getStationInventorySnapshot(buildingInstanceId) {
    const building = await this.getStoreValue("buildings", buildingInstanceId);
    if (!building) return null;
    const storageId = this.stationInventoryStorageId(buildingInstanceId);
    const storage = await this.getStoreValue("buildingStorages", storageId);
    const capacity = storage
      ? Math.max(0, Number(storage.capacity) || 0)
      : this.getStationInventoryCapacity(building.building_id);
    const items = storage ? this.stationInventoryRows(storage.public_inventory) : [];
    const usedMass = this.storageUsedMass(items);
    return {
      building_instance_id: buildingInstanceId,
      building_id: building.building_id,
      storage_id: storageId,
      persisted: Boolean(storage),
      capacity,
      used_mass: usedMass,
      free_mass: Math.max(0, capacity - usedMass),
      items,                                                  // ZONE 1 (public) display rows
      docking_capacity: storage ? (Number(storage.docking_capacity) || 0) : this.getStationDockingCapacity(building.building_id),
      docked_ships: storage ? Object.values(storage.docked_ships || {}) : [] // ZONE 2 (private)
    };
  }

  // Lazy create + seed the station inventory storage (idempotent). Run before the
  // first mutation so initial_inventory is persisted exactly once.
  async ensureStationInventoryStorage(buildingInstanceId, { createdAt = Date.now() } = {}) {
    const storageId = this.stationInventoryStorageId(buildingInstanceId);
    const existing = await this.getStoreValue("buildingStorages", storageId);
    if (existing) return existing;
    const building = await this.getStoreValue("buildings", buildingInstanceId);
    if (!building) throw new Error(`Cannot create station inventory: no building instance ${buildingInstanceId}.`);
    const storage = this.buildStationInventoryStorage({ buildingInstanceId, buildingId: building.building_id, createdAt });
    await this.putStoreValue("buildingStorages", storage);
    return storage;
  }

  // World-generation seeding (pure): build a station_inventory storage for EVERY
  // building (universal structure) + seed quantityItems from initial_inventory
  // where present. Whether an inventory is filled/used (production/trade) is a
  // separate trigger, not a condition here. Returned arrays are written to the
  // world cache by replaceWorldCache.
  createInitialStationInventories(buildings = [], createdAt = Date.now()) {
    const buildingStorages = buildings.map((building) => {
      const publicInventory = this.buildInitialInventoryMap(building.building_id);
      // Producing facilities (mines etc.) start with 1 unit of their produced item.
      // The item is per-instance (inherited from the resource node), so seed it here.
      const profile = this.buildingDefinitions[building.building_id]?.production_profile;
      if (building.produces_item_id && profile?.output_sink === "building_inventory") {
        publicInventory[building.produces_item_id] = (Number(publicInventory[building.produces_item_id]) || 0) + 1;
      }
      return this.buildStationInventoryStorage({
        buildingInstanceId: building.building_instance_id,
        buildingId: building.building_id,
        capacity: this.getStationInventoryCapacity(building.building_id),
        publicInventory,
        createdAt
      });
    });
    return { buildingStorages };
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
    this.assertServerCharacter(characterId);
    if (!this.playerCacheHydrated) {
      await this.applyPlayerServerStateToCache(this.playerServerState);
    }
    return this.getPlayerAssetSnapshot(characterId);
  }

  async refreshPlayerState() {
    const state = normalizePlayerServerState(await this.onlineApi.getPlayerState());
    await this.applyPlayerServerStateToCache(state);
    return state;
  }

  async applyPlayerServerStateToCache(state) {
    const normalized = normalizePlayerServerState(state);
    await this.syncServerDockingToWorldCache(normalized);

    const { transaction, stores } = this.openTx([...PLAYER_ASSET_STORES, "playerShip"], "readwrite");
    PLAYER_ASSET_STORES.forEach((name) => stores[name].clear());
    stores.playerShip.clear();
    const assets = normalized.assets;
    if (assets.profile) stores.characterProfiles.put(assets.profile);
    (assets.storageLocations || []).forEach((storage) => stores.storageLocations.put(storage));
    (assets.quantityItems || []).forEach((item) => stores.quantityItems.put(item));
    (assets.uniqueItems || []).forEach((item) => stores.uniqueItems.put(item));
    (assets.slotAssignments || []).forEach((assignment) => stores.slotAssignments.put(assignment));
    if (normalized.shipState) stores.playerShip.put(normalized.shipState);
    await transactionDone(transaction);

    this.playerServerState = normalized;
    this.playerCacheHydrated = true;
    return normalized;
  }

  async syncServerDockingToWorldCache(state) {
    const shipUid = state.assets?.profile?.active_ship_uid;
    if (!shipUid) return;
    const docking = state.docking;
    const storages = await this.getAll("buildingStorages");
    const changed = [];

    for (const storage of storages) {
      const dockedShips = storage.docked_ships || {};
      const isTarget = docking?.station_id === storage.world_object_id;
      if (!dockedShips[shipUid] && !isTarget) continue;
      const nextDockedShips = { ...dockedShips };
      if (isTarget) nextDockedShips[shipUid] = docking.entry;
      else delete nextDockedShips[shipUid];
      changed.push({
        ...storage,
        docked_ships: nextDockedShips,
        updated_at: Math.max(Number(storage.updated_at) || 0, Number(state.updatedAt) || Date.now())
      });
    }

    if (!changed.length) return;
    const { transaction, stores: txStores } = this.openTx(["buildingStorages"], "readwrite");
    changed.forEach((storage) => txStores.buildingStorages.put(storage));
    await transactionDone(transaction);
  }

  async insertPlayerAssets(playerAssets) {
    const { transaction, stores } = this.openTx(PLAYER_ASSET_STORES, "readwrite");
    if (playerAssets.profile) stores.characterProfiles.put(playerAssets.profile);
    (playerAssets.storageLocations || []).forEach((storage) => stores.storageLocations.put(storage));
    (playerAssets.quantityItems || []).forEach((item) => stores.quantityItems.put(item));
    (playerAssets.uniqueItems || []).forEach((item) => stores.uniqueItems.put(item));
    (playerAssets.slotAssignments || []).forEach((assignment) => stores.slotAssignments.put(assignment));
    await transactionDone(transaction);
  }

  async putCharacterProfile(profile) {
    if (!profile?.character_id) return null;
    this.assertServerCharacter(profile.character_id);
    const serverProfile = await this.onlineApi.updateProfile(profile.display_name);
    const nextProfile = {
      ...profile,
      display_name: serverProfile?.display_name || profile.display_name,
      updated_at: Number(serverProfile?.updated_at) || Date.now()
    };
    await this.putStoreValue("characterProfiles", nextProfile);
    this.playerServerState = {
      ...this.playerServerState,
      assets: {
        ...this.playerServerState.assets,
        profile: nextProfile
      }
    };
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
    const { transaction, stores } = this.openTx(["uniqueItems"], "readwrite");
    items.forEach((item) => stores.uniqueItems.put(item));
    await transactionDone(transaction);
  }

  // Single-transaction read-modify-write: reads the authoritative player-asset
  // state from IndexedDB and feeds it to a SYNCHRONOUS computeMutation(assets)
  // callback, then writes the returned mutation in the SAME transaction. Because
  // the decision is made from the freshly-read data (not an in-memory snapshot),
  // overlapping mutations — including from other tabs — are serialized by
  // IndexedDB and cannot lose updates. computeMutation must not perform async
  // work or issue its own IndexedDB requests, or the transaction will close.
  async runPlayerAssetMutation(
    characterId = DEFAULT_CHARACTER_ID,
    computeMutation = () => null,
    { reason = "fitting" } = {}
  ) {
    const result = await this.runLocalPlayerAssetMutation(characterId, computeMutation);
    if (result.committed) await this.syncPlayerAssets(characterId, reason);
    return result;
  }

  runLocalPlayerAssetMutation(characterId = DEFAULT_CHARACTER_ID, computeMutation = () => null) {
    return new Promise((resolve, reject) => {
      const { transaction, stores } = this.openTx(PLAYER_ASSET_STORES, "readwrite");
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

  async syncPlayerAssets(characterId = DEFAULT_CHARACTER_ID, reason) {
    this.assertServerCharacter(characterId);
    return this.queuePlayerServerMutation(async () => {
      const assets = await this.getPlayerAssetSnapshot(characterId);
      const docking = await this.getPlayerDockingSnapshot(assets);
      try {
        const state = normalizePlayerServerState(await this.onlineApi.commitPlayerAssets({
          expectedRevision: this.playerServerState.assetsRevision,
          assets,
          docking,
          reason
        }));
        await this.applyPlayerServerStateToCache(state);
        return state;
      } catch (error) {
        if (error?.code === "PLAYER_STATE_CONFLICT") await this.refreshPlayerState();
        throw error;
      }
    });
  }

  async getPlayerDockingSnapshot(assets) {
    const shipUid = assets?.profile?.active_ship_uid;
    if (!shipUid) return null;
    if ((assets.uniqueItems || []).some((item) => item.item_uid === shipUid)) return null;
    const located = await this.findDockedShip(shipUid);
    return located ? { station_id: located.station_id, entry: located.entry } : null;
  }

  queuePlayerServerMutation(task) {
    const result = this.playerServerMutationChain.then(task);
    this.playerServerMutationChain = result.then(() => {}, () => {});
    return result;
  }

  queueNavigationServerMutation(task) {
    const result = this.navigationServerMutationChain.then(task);
    this.navigationServerMutationChain = result.then(() => {}, () => {});
    return result;
  }

  getNavigationState() {
    return this.navigationServerState;
  }

  async refreshNavigationState() {
    const requestStartedAt = Date.now();
    const state = normalizeNavigationServerState(await this.onlineApi.getNavigationState());
    const receivedAt = Date.now();
    this.recordNavigationClockSample(state.serverTime, requestStartedAt, receivedAt);
    this.navigationServerState = state;
    return state;
  }

  recordNavigationClockSample(serverTime, requestStartedAt, receivedAt = Date.now()) {
    const serverAt = Number(serverTime);
    const startedAt = Number(requestStartedAt);
    const completedAt = Number(receivedAt);
    if (serverAt <= 0 || ![serverAt, startedAt, completedAt].every(Number.isFinite)) return;
    const midpoint = startedAt + Math.max(0, completedAt - startedAt) / 2;
    this.navigationServerClockOffsetMs = serverAt - midpoint;
    this.navigationServerReceivedAt = completedAt;
  }

  getEstimatedNavigationServerNow() {
    return Math.round(Date.now() + this.navigationServerClockOffsetMs);
  }

  createNavigationActionId(prefix = "command") {
    return createClientActionId(prefix);
  }

  createNavigationCommandWindow(lifetimeMs = 5_000) {
    const estimatedServerNow = this.getEstimatedNavigationServerNow();
    const issuedAt = estimatedServerNow;
    return {
      issuedAt,
      expiresAt: issuedAt + lifetimeMs,
      localExpiresAt: Date.now() + lifetimeMs
    };
  }

  startNavigation({ clientActionId, routeType, target = null, observedShip }) {
    return this.queueNavigationServerMutation(async () => {
      const actionId = clientActionId || createClientActionId("nav");
      const commandWindow = this.createNavigationCommandWindow();
      const state = await this.runNavigationCommand(actionId, commandWindow, (current) => (
        this.onlineApi.startNavigation({
          clientActionId: actionId,
          expectedRevision: current.ship.revision,
          issuedAt: commandWindow.issuedAt,
          expiresAt: commandWindow.expiresAt,
          routeType,
          target,
          observedShip,
          keepalive: routeType === "deactivation"
        })
      ));
      this.navigationServerState = state;
      this.navigationServerReceivedAt = Date.now();
      return state;
    });
  }

  manualOverrideNavigation({ clientActionId = null, desiredSpeed = null } = {}) {
    return this.queueNavigationServerMutation(async () => {
      const current = this.navigationServerState;
      if (!current.activeContract) return current;
      const actionId = clientActionId || createClientActionId("override");
      const commandWindow = this.createNavigationCommandWindow();
      const state = await this.runNavigationCommand(actionId, commandWindow, (latest) => {
        if (!latest.activeContract) return latest;
        return this.onlineApi.manualOverride({
          clientActionId: actionId,
          expectedRevision: latest.ship.revision,
          issuedAt: commandWindow.issuedAt,
          expiresAt: commandWindow.expiresAt,
          contractId: latest.activeContract.contractId,
          desiredSpeed
        });
      });
      this.navigationServerState = state;
      this.navigationServerReceivedAt = Date.now();
      return state;
    });
  }

  dockShip({ buildingId, observedShip, clientActionId = null }) {
    return this.queueNavigationServerMutation(async () => {
      const actionId = clientActionId || createClientActionId("dock");
      const commandWindow = this.createNavigationCommandWindow();
      const state = await this.runNavigationCommand(actionId, commandWindow, (current) => (
        this.onlineApi.dockShip({
          clientActionId: actionId,
          expectedRevision: current.ship.revision,
          issuedAt: commandWindow.issuedAt,
          expiresAt: commandWindow.expiresAt,
          buildingId,
          observedShip
        })
      ));
      this.navigationServerState = state;
      this.navigationServerReceivedAt = Date.now();
      return state;
    });
  }

  undockShip({ buildingId, clientActionId = null } = {}) {
    return this.queueNavigationServerMutation(async () => {
      const actionId = clientActionId || createClientActionId("undock");
      const commandWindow = this.createNavigationCommandWindow();
      const state = await this.runNavigationCommand(actionId, commandWindow, (current) => (
        this.onlineApi.undockShip({
          clientActionId: actionId,
          expectedRevision: current.ship.revision,
          issuedAt: commandWindow.issuedAt,
          expiresAt: commandWindow.expiresAt,
          buildingId
        })
      ));
      this.navigationServerState = state;
      this.navigationServerReceivedAt = Date.now();
      return state;
    });
  }

  enterBetaSpace({ betaVoidId, expectedGeneration, observedShip, clientActionId = null }) {
    return this.queueNavigationServerMutation(async () => {
      const actionId = clientActionId || createClientActionId("beta-enter");
      const commandWindow = this.createNavigationCommandWindow();
      const state = await this.runNavigationCommand(actionId, commandWindow, (current) => (
        this.onlineApi.enterBetaSpace({
          clientActionId: actionId,
          expectedRevision: current.ship.revision,
          issuedAt: commandWindow.issuedAt,
          expiresAt: commandWindow.expiresAt,
          betaVoidId,
          expectedGeneration,
          observedShip
        })
      ));
      this.navigationServerState = state;
      this.navigationServerReceivedAt = Date.now();
      return state;
    });
  }

  exitBetaSpace({ clientActionId = null } = {}) {
    return this.queueNavigationServerMutation(async () => {
      const actionId = clientActionId || createClientActionId("beta-exit");
      const commandWindow = this.createNavigationCommandWindow();
      const state = await this.runNavigationCommand(actionId, commandWindow, (current) => (
        this.onlineApi.exitBetaSpace({
          clientActionId: actionId,
          expectedRevision: current.ship.revision,
          issuedAt: commandWindow.issuedAt,
          expiresAt: commandWindow.expiresAt
        })
      ));
      this.navigationServerState = state;
      this.navigationServerReceivedAt = Date.now();
      return state;
    });
  }

  async runNavigationCommand(clientActionId, commandWindow, operation) {
    this.reportNavigationCommandStatus("SENDING", clientActionId);
    const requestStartedAt = Date.now();
    try {
      const state = normalizeNavigationServerState(await operation(this.navigationServerState));
      this.recordNavigationClockSample(state.serverTime, requestStartedAt, Date.now());
      this.reportNavigationCommandStatus("ACCEPTED", clientActionId);
      return state;
    } catch (error) {
      if (Number(error?.status) > 0) {
        this.reportNavigationCommandStatus("REJECTED", clientActionId, error);
        throw error;
      }
      this.reportNavigationCommandStatus("DELIVERY_UNKNOWN", clientActionId, error);
      return this.resolveUnknownNavigationCommand(clientActionId, commandWindow, error);
    }
  }

  async resolveUnknownNavigationCommand(clientActionId, commandWindow, transportError) {
    const delays = [0, 250, 750];
    for (const delay of delays) {
      if (delay > 0) await wait(delay);
      const requestStartedAt = Date.now();
      try {
        const result = await this.onlineApi.getNavigationCommandResult(clientActionId);
        if (result.status === "ACCEPTED") {
          this.recordNavigationClockSample(result.checkedAt, requestStartedAt, Date.now());
          this.reportNavigationCommandStatus("ACCEPTED", clientActionId);
          return normalizeNavigationServerState(result.navigation);
        }
      } catch (error) {
        if (error?.code !== "MOVEMENT_COMMAND_NOT_FOUND" && Number(error?.status) > 0) {
          throw error;
        }
      }
      if (Date.now() >= commandWindow.localExpiresAt) break;
    }

    const remaining = commandWindow.localExpiresAt - Date.now();
    if (remaining > 0) await wait(remaining);
    const requestStartedAt = Date.now();
    try {
      const result = await this.onlineApi.getNavigationCommandResult(clientActionId);
      if (result.status === "ACCEPTED") {
        this.recordNavigationClockSample(result.checkedAt, requestStartedAt, Date.now());
        this.reportNavigationCommandStatus("ACCEPTED", clientActionId);
        return normalizeNavigationServerState(result.navigation);
      }
    } catch (error) {
      if (error?.code !== "MOVEMENT_COMMAND_NOT_FOUND") {
        throw error;
      }
    }

    try {
      const state = await this.refreshNavigationState();
      if (state.activeContract?.clientActionId === clientActionId) {
        this.reportNavigationCommandStatus("ACCEPTED", clientActionId);
        return state;
      }
    } catch {
      // Reconnection will rebase again; the expired command is never re-submitted.
    }
    const failure = new Error("The server did not confirm the command before it expired.");
    failure.code = "MOVEMENT_COMMAND_NOT_CONFIRMED";
    failure.status = 0;
    failure.cause = transportError;
    this.reportNavigationCommandStatus("EXPIRED", clientActionId, failure);
    throw failure;
  }

  reportNavigationCommandStatus(status, clientActionId, error = null) {
    this.onNavigationCommandStatus?.({ status, clientActionId, error });
  }

  assertServerCharacter(characterId) {
    if (characterId !== this.playerServerState.characterId) {
      throw new Error("Player state character does not match the authenticated character.");
    }
  }

  async loadOrCreatePlayerShipState(characterId = DEFAULT_CHARACTER_ID) {
    this.assertServerCharacter(characterId);
    if (!this.playerCacheHydrated) await this.applyPlayerServerStateToCache(this.playerServerState);
    const state = this.navigationStateToPlayerShipState(this.navigationServerState);
    await this.putStoreValue("playerShip", state);
    return state;
  }

  async savePlayerShipState(state, { checkpointKind = "SNAPSHOT" } = {}) {
    const characterId = state.player_id || DEFAULT_CHARACTER_ID;
    this.assertServerCharacter(characterId);
    const position = this.normalizeVector(state.position);
    const chunkData = this.getChunkDataAtPosition(position);
    const sector = this.getSectorAtPosition(position.x, position.y, position.z);
    const nextState = {
      ...state,
      key: this.createPlayerShipStateKey(characterId),
      player_id: characterId,
      position,
      rotation: this.normalizeQuaternion(state.rotation),
      chunk_id: chunkData.chunk_id,
      chunk: chunkData.chunk,
      sector_id: sector?.sector_id || null,
      speed: Number(state.speed) || 0,
      desiredSpeed: Number(state.desiredSpeed) || 0,
      updated_at: Date.now()
    };

    return this.queueNavigationServerMutation(async () => {
      const actionId = createClientActionId("checkpoint");
      const renderScale = Number(this.config.renderScale) || 0.01;
      const commandWindow = this.createNavigationCommandWindow();
      const serverState = await this.runNavigationCommand(actionId, commandWindow, (current) => (
        this.onlineApi.checkpointNavigation({
          clientActionId: actionId,
          expectedRevision: current.ship.revision,
          issuedAt: commandWindow.issuedAt,
          expiresAt: commandWindow.expiresAt,
          checkpointKind,
          ship: {
            position: nextState.position,
            rotation: nextState.rotation,
            speed: nextState.speed / renderScale,
            desired_speed: nextState.desiredSpeed / renderScale
          }
        })
      ));
      this.navigationServerState = serverState;
      this.navigationServerReceivedAt = Date.now();
      const savedState = this.navigationStateToPlayerShipState(serverState);
      await this.putStoreValue("playerShip", savedState);
      return savedState;
    });
  }

  navigationStateToPlayerShipState(state) {
    const navigation = normalizeNavigationServerState(state);
    const ship = navigation.ship;
    const position = ship.position || ship.resolvedPosition;
    if (!position) throw new Error("Server ship placement has no resolvable position.");
    const renderScale = Number(this.config.renderScale) || 0.01;
    return {
      key: this.createPlayerShipStateKey(navigation.characterId),
      ship_id: ship.shipUid,
      player_id: navigation.characterId,
      position: { ...position },
      rotation: { ...ship.rotation },
      chunk_id: ship.chunkId,
      chunk: this.getChunkDataAtPosition(position).chunk,
      sector_id: ship.sectorId,
      speed: ship.speed * renderScale,
      desiredSpeed: ship.desiredSpeed * renderScale,
      created_at: ship.checkpointAt || ship.updatedAt || navigation.serverTime,
      updated_at: navigation.serverTime
    };
  }

  async replaceWorldCache({ sectors, chunks, resourceNodes, buildings, betaVoids = [], meta, resourceManager, stationInventories = null }) {
    // Rebuild only the server-derived world cache. Player preferences survive revisions.
    const { transaction, stores } = this.openTx(WORLD_CACHE_STORES, "readwrite");
    WORLD_CACHE_STORES.forEach((name) => stores[name].clear());
    // worlds_*
    sectors.forEach((sector) => stores.sectors.put(sector));
    chunks.forEach((chunk) => stores.chunks.put(chunk));
    resourceNodes.forEach((node) => stores.resourceNodes.put(node));
    buildings.forEach((building) => stores.buildings.put(building));
    betaVoids.forEach((betaVoid) => stores.betaVoids.put(betaVoid));
    stores.meta.put(meta);
    if (resourceManager) stores.meta.put(resourceManager);
    (stationInventories?.buildingStorages || []).forEach((storage) => stores.buildingStorages.put(storage));
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
    const { transaction, stores } = this.openTx(["chunks", "resourceNodes", "meta"], "readwrite");
    stores.resourceNodes.clear();
    chunks.forEach((chunk) => stores.chunks.put(chunk));
    resourceNodes.forEach((node) => stores.resourceNodes.put(node));
    stores.meta.put({
      ...resourceManager,
      key: "resourceManager",
      manager_id: "GLOBAL"
    });
    await transactionDone(transaction);
  }

  async clearWorld() {
    await this.clearStores(WORLD_STORES);
    this.snapshot = await this.getWorldSnapshot();
    return this.snapshot;
  }

  async clearStores(logicalNames) {
    const { transaction, stores } = this.openTx(logicalNames, "readwrite");
    logicalNames.forEach((name) => stores[name].clear());
    await transactionDone(transaction);
  }

  async clearAllData() {
    await this.clearStores(ALL_STORES);
    this.snapshot = await this.getWorldSnapshot();
    return this.snapshot;
  }

  async deleteDatabase() {
    if (this.db) { this.db.close(); this.db = null; }
    this.snapshot = null;
    const names = await this.getGameDatabaseNames();
    await Promise.all(names.map((name) => deleteIndexedDbByName(name)));
  }

  async getGameDatabaseNames() {
    const prefix = "beta-void";
    const names = new Set([this.config.dbName, ...LEGACY_DB_NAMES]);

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
    return this.createWorldCache();
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

  async getAll(logical) {
    const name = this.storeName(logical);
    return requestToPromise(this.db.transaction(name, "readonly").objectStore(name).getAll());
  }

  async getStoreValue(logical, key) {
    const name = this.storeName(logical);
    return requestToPromise(this.db.transaction(name, "readonly").objectStore(name).get(key));
  }

  async putStoreValue(logical, value) {
    const name = this.storeName(logical);
    return requestToPromise(this.db.transaction(name, "readwrite").objectStore(name).put(value));
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

  // =========================================================================
  // Mining Action System (Phase 1 — settlement core)
  // See DesignDocuments/DefinitionCatalog/MiningActionSystemPlan.md
  //
  // Resource nodes are a shared SSoT. Mining yield is DERIVED from each
  // gatheringLog's start timestamp + frozen rate snapshot, and only COMMITTED
  // at deterministic boundaries (manual stop, cargo full, node exhaust, expiry,
  // or an explicit settle). settled_yield makes settlement idempotent, so
  // re-deriving the same `now` never double-counts. Node draining and inventory
  // crediting happen in ONE transaction so they can never desync.
  // =========================================================================

  _gatheringRate(log) {
    return Math.max(0, Number(log?.yield_snapshot?.effective_yield_per_sec) || 0);
  }

  _activeGatherLogs(state) {
    return [...state.logs.values()].filter((log) => log.status === "active");
  }

  // Remaining cargo room for `itemId` in `storageId`, expressed in item units
  // (mass-based capacity). Returns Infinity when the storage is uncapped or the
  // item is massless.
  _cargoFreeUnits(state, storageId, itemId) {
    const itemMass = Number(this.itemDefinitions[itemId]?.mass);
    if (!(itemMass > 0)) return Infinity;
    const storage = state.storageById.get(storageId);
    const capacity = storage ? storage.capacity : null;
    if (capacity == null) return Infinity;

    let usedMass = 0;
    for (const entry of state.qtyMap.values()) {
      if (entry.storage_id !== storageId) continue;
      const mass = Number(this.itemDefinitions[entry.item_id]?.mass) || 0;
      usedMass += (Number(entry.quantity) || 0) * mass;
    }
    return Math.max(0, Math.floor((capacity - usedMass) / itemMass));
  }

  _creditInventory(state, log, amount, nowMs) {
    if (!(amount > 0)) return;
    const key = `qty-${log.target_storage_id}-${log.produces_item_id}`;
    let entry = state.qtyMap.get(key);
    if (!entry) {
      entry = this.createQuantityItemEntry({
        storageId: log.target_storage_id,
        itemId: log.produces_item_id,
        quantity: 0,
        createdAt: nowMs
      });
      state.qtyMap.set(key, entry);
    }
    entry.quantity = (Number(entry.quantity) || 0) + amount;
    entry.updated_at = nowMs;
    state.qtyChanged.add(key);
  }

  _finishGatherLog(log, status, atMs) {
    log.status = status;
    log.planned_end_at = atMs;
    log.planned_yield = Number(log.settled_yield) || 0;
    if (status === "completed") log.completed_at = atMs;
    else if (status === "cancelled") log.cancelled_at = atMs;
  }

  // Advance the node deterministically from its current epoch anchor up to
  // targetMs, settling every active miner through each predictable sub-boundary
  // (cargo full / node exhaust / node expiry). Mutates state in place.
  _simulateGathering(state, targetMs) {
    const node = state.node;
    let active = this._activeGatherLogs(state);

    if (!active.length) {
      node.epoch_start_at = null;
      node.amount_at_epoch_start = Math.max(0, Number(node.current_amount) || 0);
      node.active_gather_ids = [];
      return;
    }

    // Resumed/legacy logs may lack the float accumulator; seed it from credited.
    for (const log of active) {
      if (!Number.isFinite(Number(log.accumulated))) log.accumulated = Number(log.settled_yield) || 0;
    }

    let cursor = Number.isFinite(node.epoch_start_at) ? node.epoch_start_at : targetMs;
    let remaining = Math.max(0, Number(node.current_amount) || 0);
    let guard = 0;

    while (cursor < targetMs && active.length && guard < 256) {
      guard += 1;
      const totalRate = active.reduce((sum, log) => sum + this._gatheringRate(log), 0);
      if (totalRate <= 0) break;

      let segEnd = targetMs;
      let cause = "target";
      let cargoLog = null;

      const exhaustMs = cursor + (remaining / totalRate) * 1000;
      if (exhaustMs < segEnd) { segEnd = exhaustMs; cause = "exhaust"; }
      if (Number.isFinite(node.expiry_time) && node.expiry_time < segEnd) { segEnd = node.expiry_time; cause = "expiry"; cargoLog = null; }
      for (const log of active) {
        const rate = this._gatheringRate(log);
        if (rate <= 0) continue;
        const freeUnits = this._cargoFreeUnits(state, log.target_storage_id, log.produces_item_id);
        if (!Number.isFinite(freeUnits)) continue;
        const fullMs = cursor + (freeUnits / rate) * 1000;
        if (fullMs < segEnd) { segEnd = fullMs; cause = "cargo"; cargoLog = log; }
      }

      const dtSec = Math.max(0, (segEnd - cursor) / 1000);
      // Resources are extracted in WHOLE UNITS only. Each miner accrues a
      // fractional "potential" (rate × time); only the floored integer part is
      // credited and removed from the node. Sub-unit progress stays un-mined in
      // the node — so stopping at 28s of a 30s/unit dig yields 0. Scarce final
      // units are allocated in a stable id order for deterministic conservation.
      const ordered = active.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const log of ordered) {
        const rate = this._gatheringRate(log);
        if (rate <= 0) continue;
        log.accumulated = (Number(log.accumulated) || 0) + rate * dtSec;
        const targetCredit = Math.floor((Number(log.accumulated) || 0) + 1e-9);
        let delta = targetCredit - (Number(log.settled_yield) || 0);
        if (delta > remaining) delta = remaining; // node cannot yield more than it holds
        if (delta > 0) {
          this._creditInventory(state, log, delta, targetMs);
          log.settled_yield = (Number(log.settled_yield) || 0) + delta;
          remaining -= delta;
        }
        log.epoch_settled_anchor = segEnd;
      }
      cursor = segEnd;

      // Completion fires on the ACTUAL integer emptying of the node, not merely
      // at the float exhaust estimate — flooring can leave a final sub-unit
      // segment that the next loop iteration resolves.
      if (remaining <= 0) {
        ordered.forEach((log) => this._finishGatherLog(log, "completed", cursor));
        active = [];
        remaining = 0;
        state.nodeDeleted = true; // depleted node is removed (removeEmptyResourceNodes parity)
        break;
      }
      if (cause === "expiry") {
        ordered.forEach((log) => this._finishGatherLog(log, "completed", cursor));
        active = [];
        remaining = 0;
        state.nodeDeleted = true;
        break;
      }
      if (cause === "cargo" && cargoLog) {
        this._finishGatherLog(cargoLog, "completed", cursor);
        active = active.filter((log) => log !== cargoLog);
      }
    }

    node.current_amount = remaining;
    const stillActive = this._activeGatherLogs(state);
    node.active_gather_ids = stillActive.map((log) => log.id);
    node.amount_at_epoch_start = remaining;
    node.epoch_start_at = stillActive.length ? cursor : null;
  }

  // Recompute provisional planned_end_at / planned_yield for the new epoch.
  _replanGathering(state) {
    const node = state.node;
    const active = this._activeGatherLogs(state);
    if (!active.length) return;

    const epochStart = Number.isFinite(node.epoch_start_at) ? node.epoch_start_at : Date.now();
    const remaining = Math.max(0, Number(node.amount_at_epoch_start) || 0);
    const totalRate = active.reduce((sum, log) => sum + this._gatheringRate(log), 0);
    const exhaustMs = totalRate > 0 ? epochStart + (remaining / totalRate) * 1000 : Infinity;

    for (const log of active) {
      const rate = this._gatheringRate(log);
      const freeUnits = this._cargoFreeUnits(state, log.target_storage_id, log.produces_item_id);
      const cargoMs = rate > 0 && Number.isFinite(freeUnits) ? epochStart + (freeUnits / rate) * 1000 : Infinity;
      let endMs = Math.min(exhaustMs, cargoMs);
      if (Number.isFinite(node.expiry_time)) endMs = Math.min(endMs, node.expiry_time);

      log.epoch_settled_anchor = epochStart;
      log.planned_end_at = Number.isFinite(endMs) ? Math.round(endMs) : null;
      const projected = (Number(log.accumulated) || 0)
        + (Number.isFinite(endMs) ? rate * (endMs - epochStart) / 1000 : 0);
      log.planned_yield = Math.floor(projected + 1e-9); // whole units only
    }
  }

  _buildNodeState(node, allLogs, allQuantityItems, allStorages, nodeId) {
    const logs = new Map();
    for (const log of allLogs) {
      if (log.target_node_id === nodeId && log.status === "active") logs.set(log.id, log);
    }
    const qtyMap = new Map();
    for (const entry of allQuantityItems) qtyMap.set(entry.entry_id, entry);
    const storageById = new Map();
    for (const storage of allStorages) storageById.set(storage.storage_id, storage);
    return { node, logs, qtyMap, qtyChanged: new Set(), storageById, nodeDeleted: false };
  }

  // Single read-modify-write transaction across node + logs + inventory (all in
  // the one `beta-void` DB, so this is atomic and serializes overlapping ops for
  // free). `mutate(state, nowMs)` runs AFTER settling existing miners to nowMs and
  // may add/remove a log; returning { ok: false } aborts without persisting.
  _commitNodeOp(nodeId, nowMs, mutate = null) {
    return new Promise((resolve, reject) => {
      const { transaction, stores } = this.openTx(["resourceNodes", "gatheringLogs", "quantityItems", "storageLocations"], "readwrite");
      const reads = {};
      let pending = 0;
      let settled = false;
      let result = { ok: true };

      const fail = (error) => {
        if (settled) return;
        settled = true;
        try { transaction.abort(); } catch { /* already inactive */ }
        reject(error instanceof Error ? error : new Error("Gathering settlement failed."));
      };

      const onAllRead = () => {
        const node = reads.node;
        if (!node) {
          settled = true;
          try { transaction.abort(); } catch { /* noop */ }
          resolve({ ok: false, reason: "missing-node" });
          return;
        }
        const state = this._buildNodeState(node, reads.gatheringLogs || [], reads.quantityItems || [], reads.storageLocations || [], nodeId);
        try {
          this._simulateGathering(state, nowMs);
          if (mutate) {
            result = mutate(state, nowMs) || { ok: true };
            if (result.ok === false) {
              settled = true;
              try { transaction.abort(); } catch { /* noop */ }
              resolve(result);
              return;
            }
          }
          this._replanGathering(state);
        } catch (error) {
          fail(error);
          return;
        }
        if (state.nodeDeleted) {
          stores.resourceNodes.delete(nodeId);
        } else {
          const { _settledAt, ...cleanNode } = state.node;
          stores.resourceNodes.put(cleanNode);
        }
        state.logs.forEach((log) => stores.gatheringLogs.put(log));
        state.qtyChanged.forEach((key) => stores.quantityItems.put(state.qtyMap.get(key)));
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve({ committed: true, node: state.nodeDeleted ? null : state.node, ...result });
        };
      };

      const issue = (key, request) => {
        pending += 1;
        request.onsuccess = () => { reads[key] = request.result; pending -= 1; if (pending === 0 && !settled) onAllRead(); };
      };

      transaction.onerror = () => fail(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => { if (!settled) fail(transaction.error || new Error("IndexedDB transaction aborted.")); };

      issue("node", stores.resourceNodes.get(nodeId));
      issue("gatheringLogs", stores.gatheringLogs.getAll());
      issue("quantityItems", stores.quantityItems.getAll());
      issue("storageLocations", stores.storageLocations.getAll());
    });
  }

  // Begin a mining action: settle existing miners to now, then add this actor's
  // log and re-plan the node's new contention epoch.
  async startGathering({ nodeId, storageId, actorId = DEFAULT_CHARACTER_ID, gatherRateMult = 1.0, nowMs = Date.now() } = {}) {
    return this._commitNodeOp(nodeId, nowMs, (state) => {
      const node = state.node;
      if (state.nodeDeleted) return { ok: false, reason: "node-depleted" };
      if (this._activeGatherLogs(state).some((log) => log.actor_id === actorId)) {
        return { ok: false, reason: "already-gathering" };
      }
      const baseYield = Number(node.base_yield_per_sec) || 0;
      const designRate = baseYield * (Number(gatherRateMult) || 0);
      // Test override takes precedence when set; otherwise use the design rate.
      const effectiveRate = GATHER_TEST_RATE_PER_SEC == null ? designRate : GATHER_TEST_RATE_PER_SEC;
      const effectiveMult = baseYield > 0 ? effectiveRate / baseYield : (Number(gatherRateMult) || 0);
      if (!(effectiveRate > 0)) return { ok: false, reason: "zero-yield" };

      const id = `GATHER-${nowMs}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
      const log = {
        id,
        actor_id: actorId,
        type: "gathering",
        status: "active",
        target_node_id: nodeId,
        produces_item_id: node.produces_item_id,
        target_storage_id: storageId,
        issued_at: nowMs,
        start_at: nowMs,
        epoch_settled_anchor: nowMs,
        yield_snapshot: {
          base_yield_per_sec: baseYield,
          gather_rate_mult: effectiveMult,
          effective_yield_per_sec: effectiveRate
        },
        accumulated: 0,        // float progress; settled_yield = floor(accumulated)
        settled_yield: 0,
        planned_yield: 0,
        planned_end_at: null,
        clientSeq: null,
        economyEpoch: "local-v1",
        index: 0,
        dependency_id: null,
        isCancellable: true
      };
      state.logs.set(id, log);

      // New miner resets the epoch to start at now for everyone.
      node.epoch_start_at = nowMs;
      node.amount_at_epoch_start = Math.max(0, Number(node.current_amount) || 0);
      node.active_gather_ids = this._activeGatherLogs(state).map((entry) => entry.id);
      return { ok: true, logId: id };
    });
  }

  // Stop a mining action at nowMs: the stopping actor is settled to exactly now,
  // remaining miners re-plan (their end times extend).
  async stopGathering({ nodeId, logId, nowMs = Date.now() } = {}) {
    return this._commitNodeOp(nodeId, nowMs, (state) => {
      const log = state.logs.get(logId);
      if (!log || log.status !== "active") return { ok: false, reason: "not-active" };
      this._finishGatherLog(log, "cancelled", nowMs);

      const stillActive = this._activeGatherLogs(state);
      state.node.active_gather_ids = stillActive.map((entry) => entry.id);
      state.node.epoch_start_at = stillActive.length ? nowMs : null;
      state.node.amount_at_epoch_start = Math.max(0, Number(state.node.current_amount) || 0);
      return { ok: true, gathered: Number(log.settled_yield) || 0 };
    });
  }

  // Heartbeat / lifecycle commit: settle the node to nowMs without changing the
  // miner set (also fires deterministic exhaust/expiry completion if reached).
  async settleNode({ nodeId, nowMs = Date.now() } = {}) {
    return this._commitNodeOp(nodeId, nowMs, null);
  }

  // Read-only projection for HUD/extrapolation — never writes. Returns each
  // active miner's projected gathered amount at nowMs.
  async deriveNodeState(nodeId, nowMs = Date.now()) {
    const [node, allLogs, allQuantityItems, allStorages] = await Promise.all([
      this.getStoreValue("resourceNodes", nodeId),
      this.getAll("gatheringLogs"),
      this.getAll("quantityItems"),
      this.getAll("storageLocations")
    ]);
    if (!node) return null;

    const state = this._buildNodeState(node, allLogs, allQuantityItems, allStorages, nodeId);
    this._simulateGathering(state, nowMs);
    this._replanGathering(state);
    return {
      node: state.nodeDeleted ? null : state.node,
      depleted: state.nodeDeleted,
      logs: [...state.logs.values()].map((log) => ({
        id: log.id,
        actor_id: log.actor_id,
        status: log.status,
        gathered: Number(log.settled_yield) || 0,
        planned_yield: Number(log.planned_yield) || 0,
        planned_end_at: log.planned_end_at
      }))
    };
  }

  async getGatheringLogs({ nodeId = null, actorId = null, activeOnly = false } = {}) {
    const all = await this.getAll("gatheringLogs");
    return all.filter((log) => (
      (nodeId == null || log.target_node_id === nodeId)
      && (actorId == null || log.actor_id === actorId)
      && (!activeOnly || log.status === "active")
    ));
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

function normalizePlayerServerState(value) {
  const assetsRevision = Number(value?.assetsRevision);
  const shipRevision = Number(value?.shipRevision);
  const characterId = String(value?.characterId || "");
  const assets = value?.assets;
  if (
    !characterId
    || !assets
    || typeof assets !== "object"
    || assets.character_id !== characterId
    || !Number.isInteger(assetsRevision)
    || assetsRevision < 1
    || !Number.isInteger(shipRevision)
    || shipRevision < 0
  ) {
    throw new Error("WorldDataManager received an invalid server player state.");
  }

  return {
    characterId,
    schemaVersion: Number(value.schemaVersion) || 1,
    assetsRevision,
    shipRevision,
    assets,
    shipState: value.shipState || null,
    docking: value.docking || null,
    updatedAt: Number(value.updatedAt) || 0,
    serverTime: Number(value.serverTime) || Date.now()
  };
}

function normalizeNavigationServerState(value) {
  const characterId = String(value?.characterId || "");
  const ship = value?.ship;
  const revision = Number(ship?.revision);
  if (
    !characterId
    || !ship
    || ship.ownerCharacterId !== characterId
    || !ship.shipUid
    || !Number.isInteger(revision)
    || revision < 1
  ) {
    throw new Error("WorldDataManager received an invalid server navigation state.");
  }
  return {
    characterId,
    ship: {
      ...ship,
      position: ship.position == null ? null : normalizePlainVector(ship.position),
      resolvedPosition: ship.resolvedPosition == null
        ? null
        : normalizePlainVector(ship.resolvedPosition),
      rotation: normalizePlainQuaternion(ship.rotation),
      speed: Number(ship.speed) || 0,
      desiredSpeed: Number(ship.desiredSpeed) || 0,
      revision
    },
    custody: value.custody
      ? {
          ...value.custody,
          resolvedPosition: normalizePlainVector(value.custody.resolvedPosition)
        }
      : null,
    betaSpaceSession: value.betaSpaceSession
      ? {
          ...value.betaSpaceSession,
          returnAnchor: {
            ...value.betaSpaceSession.returnAnchor,
            position: normalizePlainVector(value.betaSpaceSession.returnAnchor?.position),
            rotation: normalizePlainQuaternion(value.betaSpaceSession.returnAnchor?.rotation)
          }
        }
      : null,
    activeContract: value.activeContract
      ? {
          ...value.activeContract,
          startPosition: normalizePlainVector(value.activeContract.startPosition),
          startHeading: normalizePlainVector(value.activeContract.startHeading),
          fromPosition: normalizePlainVector(value.activeContract.fromPosition),
          target: normalizePlainVector(value.activeContract.target),
          heading: normalizePlainVector(value.activeContract.heading)
        }
      : null,
    serverTime: Number(value.serverTime) || Date.now()
  };
}

function normalizePlainVector(value) {
  return {
    x: Number(value?.x) || 0,
    y: Number(value?.y) || 0,
    z: Number(value?.z) || 0
  };
}

function normalizePlainQuaternion(value) {
  const quaternion = {
    x: Number(value?.x) || 0,
    y: Number(value?.y) || 0,
    z: Number(value?.z) || 0,
    w: Number.isFinite(Number(value?.w)) ? Number(value.w) : 1
  };
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

function normalizeWorldBootstrap(value) {
  const source = value?.snapshot;
  const snapshot = {
    sectors: Array.isArray(source?.sectors) ? source.sectors : [],
    resourceNodes: Array.isArray(source?.resourceNodes) ? source.resourceNodes : [],
    buildings: Array.isArray(source?.buildings) ? source.buildings : [],
    betaVoids: Array.isArray(source?.betaVoids) ? source.betaVoids : [],
    resourceManager: source?.resourceManager || null,
    buildingStorages: Array.isArray(source?.buildingStorages) ? source.buildingStorages : []
  };
  const normalized = {
    worldId: String(value?.worldId || ""),
    seed: String(value?.seed || ""),
    dataSourceKey: String(value?.dataSourceKey || ""),
    revision: Number(value?.revision),
    generatedAt: Number(value?.generatedAt),
    snapshot
  };

  if (
    !normalized.worldId
    || !normalized.seed
    || !normalized.dataSourceKey
    || !Number.isInteger(normalized.revision)
    || normalized.revision < 1
    || !Number.isFinite(normalized.generatedAt)
    || normalized.generatedAt <= 0
    || snapshot.sectors.length === 0
    || !snapshot.resourceManager
  ) {
    throw new Error("WorldDataManager received an invalid server world bootstrap.");
  }

  return Object.freeze(normalized);
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

function createClientActionId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
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
