import {
  BUILDING_DEFINITIONS,
  INITIAL_BUILDING_TYPES,
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

    this.snapshot = await this.getWorldSnapshot();
    return this.snapshot;
  }

  async createNewWorld({ seed = Date.now() } = {}) {
    const rng = createSeededRandom(seed);
    const now = Date.now();
    const chunks = this.createWorldChunks(now);
    const sectors = this.createSectors(now, rng, chunks);
    const placedObjects = [];
    const resourceNodes = INITIAL_RESOURCE_TYPES.map((type, index) => {
      const sector = this.pickSectorForResource(type, sectors, index);
      const definition = RESOURCE_DEFINITIONS[type];
      const position = this.pickPositionInSector(sector, rng, placedObjects, this.config.resourceMinDistance);
      const chunkData = this.getChunkDataAtPosition(position);
      const totalCapacity = Math.round(lerp(definition.total_capacity_range[0], definition.total_capacity_range[1], rng()));
      const resourceNode = {
        resource_instance_id: this.createId("RES", type, seed, index, rng),
        type,
        model_id: definition.model_id,
        sector_id: sector.sector_id,
        chunk_id: chunkData.chunk_id,
        chunk: chunkData.chunk,
        position,
        local_position: chunkData.local_position,
        total_capacity: totalCapacity,
        current_amount: totalCapacity,
        base_yield_per_sec: definition.base_yield_per_sec,
        spawn_time: now,
        created_at: now
      };
      placedObjects.push(resourceNode);
      return resourceNode;
    });

    const buildings = INITIAL_BUILDING_TYPES.map((buildingId, index) => {
      const sector = sectors[(index + 1) % sectors.length];
      const definition = BUILDING_DEFINITIONS[buildingId];
      const position = this.pickPositionInSector(sector, rng, placedObjects, this.config.buildingResourceMinDistance);
      const chunkData = this.getChunkDataAtPosition(position);
      const building = {
        building_instance_id: this.createId("BLD", buildingId, seed, index, rng),
        building_id: buildingId,
        model_id: definition.model_id,
        sector_id: sector.sector_id,
        chunk_id: chunkData.chunk_id,
        chunk: chunkData.chunk,
        position,
        local_position: chunkData.local_position,
        hp: definition.hp,
        status: "active",
        created_at: now
      };
      placedObjects.push(building);
      return building;
    });

    this.assignObjectCounts(chunks, [...resourceNodes, ...buildings]);
    const meta = {
      key: "world",
      seed,
      generated_at: now
    };
    const playerShip = this.createDefaultPlayerShipState(now, sectors);

    await this.replaceWorldData({ sectors, chunks, resourceNodes, buildings, meta, playerShip });
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
        grid_size: { ...this.config.sectorSize },
        chunk_id: chunk.chunk_id,
        chunk: chunkPosition,
        resource_weights: { ...template.resource_weights },
        global_bounds: { min, max },
        chunk_bounds: {
          min: chunkPosition,
          max: chunkPosition
        },
        created_at: createdAt
      };
    });
  }

  pickSectorForResource(type, sectors, offset) {
    const sorted = [...sectors].sort((a, b) => {
      const delta = (b.resource_weights[type] || 0) - (a.resource_weights[type] || 0);
      if (delta !== 0) return delta;
      return a.sector_id.localeCompare(b.sector_id);
    });

    return sorted[offset % Math.min(2, sorted.length)] || sorted[0];
  }

  pickPositionInSector(sector, rng, placedObjects, minDistance) {
    const margin = this.config.placementMargin;
    const min = sector.global_bounds.min;
    const max = sector.global_bounds.max;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const position = {
        x: Math.round(lerp(min.x + margin, max.x - margin, rng())),
        y: Math.round(lerp(min.y + margin, max.y - margin, rng())),
        z: Math.round(lerp(min.z + margin, max.z - margin, rng()))
      };

      if (this.isFarEnough(position, placedObjects, minDistance)) return position;
    }

    const jitter = () => Math.round((rng() - 0.5) * 1200);
    return {
      x: Math.round((min.x + max.x) / 2 + jitter()),
      y: Math.round((min.y + max.y) / 2 + jitter()),
      z: Math.round((min.z + max.z) / 2 + jitter())
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

  async replaceWorldData({ sectors, chunks, resourceNodes, buildings, meta, playerShip }) {
    const transaction = this.db.transaction(STORE_NAMES, "readwrite");

    const stores = Object.fromEntries(STORE_NAMES.map((storeName) => [storeName, transaction.objectStore(storeName)]));
    STORE_NAMES.forEach((storeName) => stores[storeName].clear());
    sectors.forEach((sector) => stores.sectors.put(sector));
    chunks.forEach((chunk) => stores.chunks.put(chunk));
    resourceNodes.forEach((node) => stores.resourceNodes.put(node));
    buildings.forEach((building) => stores.buildings.put(building));
    stores.meta.put(meta);
    if (playerShip) stores.meta.put(playerShip);
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
    const [sectors, chunks, resourceNodes, buildings, meta] = await Promise.all([
      this.getAll("sectors"),
      this.getAll("chunks"),
      this.getAll("resourceNodes"),
      this.getAll("buildings"),
      this.getStoreValue("meta", "world")
    ]);

    this.snapshot = {
      sectors,
      chunks,
      resourceNodes,
      buildings,
      meta: meta || null
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

function shuffle(items, rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}
