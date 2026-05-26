import * as THREE from "three";
import { ASSETS } from "./config.js";
import { BUILDING_DEFINITIONS, RESOURCE_DEFINITIONS, WORLD_CONFIG } from "./worldDefinitions.js";

const DEFAULT_WORLD_MAP_VISUALS = {
  bounds: {
    chunk: { color: 0xe7f2f9, opacity: 1 },
    sector: {
      opacity: 0.5,
      colors: {
        "SEC-001": 0xffbc66,
        "SEC-002": 0x63d2ff,
        "SEC-003": 0x82e3bd,
        "SEC-004": 0xa6ebff,
        "SEC-005": 0xb896ff,
        "SEC-006": 0xff6b6b,
        "SEC-007": 0xffd166,
        "SEC-008": 0x9ee7ff,
        "SEC-009": 0x7ee081,
        "SEC-010": 0xd9d9d9
      },
      fallbackColor: 0xffffff
    }
  }
};

export class WorldMapManager {
  constructor({
    scene,
    renderScale = WORLD_CONFIG.renderScale,
    environmentVisuals = DEFAULT_WORLD_MAP_VISUALS,
    onRenderMutation = null
  }) {
    this.scene = scene;
    this.renderScale = renderScale;
    this.environmentVisuals = environmentVisuals;
    this.onRenderMutation = onRenderMutation;
    this.root = new THREE.Group();
    this.root.name = "world-map";
    this.scene.add(this.root);
    this.sectorBoundsGroup = new THREE.Group();
    this.sectorBoundsGroup.name = "sector-bounds";
    this.chunkBoundsGroup = new THREE.Group();
    this.chunkBoundsGroup.name = "chunk-bounds";
    this.objectsGroup = new THREE.Group();
    this.objectsGroup.name = "world-objects";
    this.root.add(this.sectorBoundsGroup, this.chunkBoundsGroup, this.objectsGroup);
    this.modelCache = new Map();
    this.animatedObjects = [];
    this.snapshot = null;
    this.chunkBoundsMode = "all";
    this.currentSectorId = null;
    this.fixedObjectPositionCache = new Map();
    this.chunksById = new Map();
    this.visibleChunkIds = new Set();
    this.lastVisibleChunkId = null;
    this.lastVisibleChunkRadius = null;
    this.objectBuildQueue = [];
    this.pendingObjectKeys = new Set();
    this.objectBuildBatchSize = 8;
    this.objectBuildBudgetMs = 3;
  }

  async loadAssets(resourceManager) {
    const modelEntries = Object.entries(ASSETS.worldModels);
    const results = await Promise.allSettled(
      modelEntries.map(([id, source]) => resourceManager.loadObjModel(`world:${id}`, source, {
        label: `${id}.obj`,
        targetSize: 1
      }))
    );

    results.forEach((result, index) => {
      const id = modelEntries[index][0];
      if (result.status === "fulfilled") {
        this.modelCache.set(id, result.value.object);
      }
    });

    return results;
  }

  renderWorld(snapshot, playerDataPosition = null) {
    this.clearWorld();
    this.snapshot = snapshot;
    if (!snapshot) return;
    this.rebuildFixedObjectPositionCache(snapshot);
    this.rebuildChunkIndex(snapshot);
    this.updateVisibleChunksFromPosition(playerDataPosition || { x: 0, y: 0, z: 0 }, { force: true });
  }

  setChunkBoundsMode(mode) {
    this.chunkBoundsMode = ["all", "sector", "off"].includes(mode) ? mode : "all";
    this.renderChunkBounds();
  }

  setCurrentSectorId(sectorId) {
    if (this.currentSectorId === sectorId) return;
    this.currentSectorId = sectorId || null;
    if (this.chunkBoundsMode === "sector") this.renderChunkBounds();
  }

  setEnvironmentVisuals(environmentVisuals = DEFAULT_WORLD_MAP_VISUALS) {
    this.environmentVisuals = environmentVisuals;
    this.updateBoundsMaterials();
  }

  renderChunkBounds() {
    this.clearGroup(this.chunkBoundsGroup);
    this.onRenderMutation?.();
    if (!this.snapshot || this.chunkBoundsMode === "off") return;

    const chunks = this.chunkBoundsMode === "sector"
      ? this.currentSectorId
        ? this.snapshot.chunks.filter((chunk) => chunk.sector_id === this.currentSectorId)
        : []
      : this.snapshot.chunks;

    chunks
      .filter((chunk) => this.visibleChunkIds.has(chunk.chunk_id))
      .forEach((chunk) => this.chunkBoundsGroup.add(this.createChunkBounds(chunk)));
    this.onRenderMutation?.();
  }

  updateVisibleChunksFromPosition(dataPosition, { force = false } = {}) {
    if (!this.snapshot) return 0;

    const chunk = this.getChunkAtDataPosition(dataPosition);
    const chunkId = this.getChunkId(chunk);
    const radius = WORLD_CONFIG.renderChunkRadius ?? 1;
    if (!force && this.lastVisibleChunkId === chunkId && this.lastVisibleChunkRadius === radius) {
      return this.visibleChunkIds.size;
    }

    const nextVisibleChunkIds = new Set();
    for (let z = chunk.z - radius; z <= chunk.z + radius; z += 1) {
      for (let y = chunk.y - radius; y <= chunk.y + radius; y += 1) {
        for (let x = chunk.x - radius; x <= chunk.x + radius; x += 1) {
          const candidateId = this.getChunkId({ x, y, z });
          if (this.chunksById.has(candidateId)) nextVisibleChunkIds.add(candidateId);
        }
      }
    }

    if (force) this.resetVisibleWorldRenderState();

    const previousVisibleChunkIds = force ? new Set() : this.visibleChunkIds;
    this.visibleChunkIds = nextVisibleChunkIds;
    this.lastVisibleChunkId = chunkId;
    this.lastVisibleChunkRadius = radius;
    this.renderVisibleWorld(previousVisibleChunkIds);
    return this.visibleChunkIds.size;
  }

  renderVisibleWorld(previousVisibleChunkIds = new Set()) {
    if (!this.snapshot) return;

    const removedChunkIds = [...previousVisibleChunkIds]
      .filter((chunkId) => !this.visibleChunkIds.has(chunkId));
    const addedChunkIds = [...this.visibleChunkIds]
      .filter((chunkId) => !previousVisibleChunkIds.has(chunkId));
    const addedChunkIdSet = new Set(addedChunkIds);

    this.removeSectorBoundsForChunks(removedChunkIds);
    this.removeObjectsForChunks(removedChunkIds);
    this.pruneObjectBuildQueue();

    this.snapshot.sectors
      .filter((sector) => addedChunkIdSet.has(sector.chunk_id))
      .forEach((sector) => this.sectorBoundsGroup.add(this.createSectorBounds(sector)));

    this.renderChunkBounds();

    this.snapshot.resourceNodes
      .filter((resourceNode) => addedChunkIdSet.has(resourceNode.chunk_id))
      .forEach((resourceNode) => this.enqueueObjectBuild("resource", resourceNode));

    this.snapshot.buildings
      .filter((building) => addedChunkIdSet.has(building.chunk_id))
      .forEach((building) => this.enqueueObjectBuild("building", building));
    if (removedChunkIds.length > 0 || addedChunkIds.length > 0) this.onRenderMutation?.();
  }

  resetVisibleWorldRenderState() {
    this.animatedObjects = [];
    this.resetObjectBuildQueue();
    this.clearGroup(this.sectorBoundsGroup);
    this.clearGroup(this.objectsGroup);
  }

  removeSectorBoundsForChunks(chunkIds) {
    if (chunkIds.length === 0) return;
    const chunkIdSet = new Set(chunkIds);
    for (let index = this.sectorBoundsGroup.children.length - 1; index >= 0; index -= 1) {
      const child = this.sectorBoundsGroup.children[index];
      if (!chunkIdSet.has(child.userData?.chunk_id)) continue;
      this.sectorBoundsGroup.remove(child);
      this.disposeObject(child);
    }
  }

  removeObjectsForChunks(chunkIds) {
    if (chunkIds.length === 0) return;
    const chunkIdSet = new Set(chunkIds);
    for (let index = this.objectsGroup.children.length - 1; index >= 0; index -= 1) {
      const child = this.objectsGroup.children[index];
      if (!chunkIdSet.has(child.userData?.chunk_id)) continue;
      this.objectsGroup.remove(child);
      this.disposeObject(child);
    }
    this.animatedObjects = this.animatedObjects
      .filter((item) => !chunkIdSet.has(item.object.userData?.chunk_id));
  }

  enqueueObjectBuild(kind, data) {
    const key = this.getObjectBuildKey(kind, data);
    if (!key || this.pendingObjectKeys.has(key)) return;
    this.pendingObjectKeys.add(key);
    this.objectBuildQueue.push({
      kind,
      key,
      chunkId: data.chunk_id,
      data
    });
  }

  getObjectBuildKey(kind, data) {
    if (kind === "resource") return data.resource_instance_id ? `resource:${data.resource_instance_id}` : null;
    if (kind === "building") return data.building_instance_id ? `building:${data.building_instance_id}` : null;
    return null;
  }

  resetObjectBuildQueue() {
    this.objectBuildQueue = [];
    this.pendingObjectKeys.clear();
  }

  pruneObjectBuildQueue() {
    if (this.objectBuildQueue.length === 0) return;
    this.objectBuildQueue = this.objectBuildQueue.filter((task) => {
      const keep = this.visibleChunkIds.has(task.chunkId);
      if (!keep) this.pendingObjectKeys.delete(task.key);
      return keep;
    });
  }

  processObjectBuildQueue() {
    if (!this.snapshot || this.objectBuildQueue.length === 0) return;

    const startedAt = performance.now();
    let processed = 0;

    while (this.objectBuildQueue.length > 0 && processed < this.objectBuildBatchSize) {
      if (processed > 0 && performance.now() - startedAt >= this.objectBuildBudgetMs) break;

      const task = this.objectBuildQueue.shift();
      this.pendingObjectKeys.delete(task.key);
      if (!this.visibleChunkIds.has(task.chunkId)) continue;

      const mesh = task.kind === "resource"
        ? this.createResourceMesh(task.data)
        : this.createBuildingMesh(task.data);
      if (mesh) this.objectsGroup.add(mesh);
      processed += 1;
    }

    if (processed > 0) this.onRenderMutation?.();
  }

  createResourceMesh(resourceNode) {
    const definition = RESOURCE_DEFINITIONS[resourceNode.resource_id || resourceNode.type];
    if (!definition) return null;
    const object = this.createVisualObject(resourceNode.model_id, definition.visual);
    const cachedPosition = this.getFixedObjectPosition(resourceNode.resource_instance_id);
    object.position.copy(cachedPosition.renderPosition);
    object.userData = {
      kind: "resource",
      id: resourceNode.resource_instance_id,
      type: resourceNode.resource_id || resourceNode.type,
      model_id: resourceNode.model_id,
      sector_id: resourceNode.sector_id,
      chunk_id: resourceNode.chunk_id,
      absolute_position: cachedPosition.absolutePosition,
      chunk_center_position: cachedPosition.chunkCenterPosition,
      chunk_center_relative_position: cachedPosition.chunkCenterRelativePosition
    };
    this.animatedObjects.push({ object, spin: 0.08 + this.animatedObjects.length * 0.012 });
    return object;
  }

  createBuildingMesh(building) {
    const definition = BUILDING_DEFINITIONS[building.building_id];
    if (!definition) return null;
    const object = this.createVisualObject(building.model_id, definition.visual);
    const cachedPosition = this.getFixedObjectPosition(building.building_instance_id);
    object.position.copy(cachedPosition.renderPosition);
    object.userData = {
      kind: "building",
      id: building.building_instance_id,
      building_id: building.building_id,
      model_id: building.model_id,
      sector_id: building.sector_id,
      chunk_id: building.chunk_id,
      absolute_position: cachedPosition.absolutePosition,
      chunk_center_position: cachedPosition.chunkCenterPosition,
      chunk_center_relative_position: cachedPosition.chunkCenterRelativePosition
    };
    return object;
  }

  rebuildFixedObjectPositionCache(snapshot) {
    this.fixedObjectPositionCache.clear();
    const chunksById = new Map(snapshot.chunks.map((chunk) => [chunk.chunk_id, chunk]));
    snapshot.resourceNodes.forEach((resourceNode) => {
      this.fixedObjectPositionCache.set(
        resourceNode.resource_instance_id,
        this.createFixedObjectPositionCacheEntry(resourceNode, chunksById)
      );
      this.applyCachedPositionToObjectData(resourceNode, this.fixedObjectPositionCache.get(resourceNode.resource_instance_id));
    });
    snapshot.buildings.forEach((building) => {
      this.fixedObjectPositionCache.set(
        building.building_instance_id,
        this.createFixedObjectPositionCacheEntry(building, chunksById)
      );
      this.applyCachedPositionToObjectData(building, this.fixedObjectPositionCache.get(building.building_instance_id));
    });
  }

  rebuildChunkIndex(snapshot) {
    this.chunksById = new Map(snapshot.chunks.map((chunk) => [chunk.chunk_id, chunk]));
  }

  createFixedObjectPositionCacheEntry(objectData, chunksById) {
    const chunk = chunksById.get(objectData.chunk_id);
    const chunkCenterPosition = chunk
      ? this.getBoundsCenter(chunk.global_bounds)
      : this.getChunkCenterFromPosition(objectData.position, objectData.chunk);
    const absolutePosition = { ...objectData.position };
    const chunkCenterRelativePosition = {
      x: absolutePosition.x - chunkCenterPosition.x,
      y: absolutePosition.y - chunkCenterPosition.y,
      z: absolutePosition.z - chunkCenterPosition.z
    };

    return {
      id: objectData.resource_instance_id || objectData.building_instance_id,
      kind: objectData.resource_instance_id ? "resource" : "building",
      sector_id: objectData.sector_id,
      chunk_id: objectData.chunk_id,
      chunk: { ...objectData.chunk },
      absolutePosition,
      chunkCenterPosition,
      chunkCenterRelativePosition,
      renderPosition: this.toRenderVector(absolutePosition),
      renderChunkCenterRelativePosition: this.toRenderVector(chunkCenterRelativePosition)
    };
  }

  applyCachedPositionToObjectData(objectData, cachedPosition) {
    objectData.chunk_center_position = { ...cachedPosition.chunkCenterPosition };
    objectData.chunk_center_relative_position = { ...cachedPosition.chunkCenterRelativePosition };
  }

  getFixedObjectPosition(id) {
    const cached = this.fixedObjectPositionCache.get(id);
    if (!cached) throw new Error(`Missing fixed object position cache: ${id}`);
    return cached;
  }

  getBoundsCenter(bounds) {
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2
    };
  }

  getChunkCenterFromPosition(position, chunk) {
    const chunkPosition = chunk || {
      x: Math.floor(position.x / WORLD_CONFIG.chunkSize.x),
      y: Math.floor(position.y / WORLD_CONFIG.chunkSize.y),
      z: Math.floor(position.z / WORLD_CONFIG.chunkSize.z)
    };

    return {
      x: chunkPosition.x * WORLD_CONFIG.chunkSize.x + WORLD_CONFIG.chunkSize.x / 2,
      y: chunkPosition.y * WORLD_CONFIG.chunkSize.y + WORLD_CONFIG.chunkSize.y / 2,
      z: chunkPosition.z * WORLD_CONFIG.chunkSize.z + WORLD_CONFIG.chunkSize.z / 2
    };
  }

  getChunkAtDataPosition(position) {
    return {
      x: Math.floor(position.x / WORLD_CONFIG.chunkSize.x),
      y: Math.floor(position.y / WORLD_CONFIG.chunkSize.y),
      z: Math.floor(position.z / WORLD_CONFIG.chunkSize.z)
    };
  }

  getChunkId(chunk) {
    return `${chunk.x}:${chunk.y}:${chunk.z}`;
  }

  createVisualObject(modelId, visual) {
    const source = this.modelCache.get(modelId);
    const object = source ? source.clone(true) : this.createFallbackMesh(visual);
    object.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry = child.geometry.clone();
      if (child.isMesh && child.material) {
        child.material = Array.isArray(child.material)
          ? child.material.map((material) => material.clone())
          : child.material.clone();
      }
    });
    object.scale.setScalar(visual.scale);
    this.applyMaterial(object, visual);
    return object;
  }

  createFallbackMesh(visual) {
    return new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: visual.color })
    );
  }

  applyMaterial(object, visual) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        if (material.color) material.color.multiply(new THREE.Color(visual.color));
        if ("emissive" in material) material.emissive.setHex(visual.emissive ?? 0x000000);
        if ("emissiveIntensity" in material) material.emissiveIntensity = visual.emissiveIntensity ?? 0;
        material.needsUpdate = true;
      });
    });
  }

  createSectorBounds(sector) {
    const min = this.toRenderVector(sector.global_bounds.min);
    const max = this.toRenderVector(sector.global_bounds.max);
    const positions = new Float32Array([
      min.x, min.y, min.z, max.x, min.y, min.z,
      max.x, min.y, min.z, max.x, max.y, min.z,
      max.x, max.y, min.z, min.x, max.y, min.z,
      min.x, max.y, min.z, min.x, min.y, min.z,
      min.x, min.y, max.z, max.x, min.y, max.z,
      max.x, min.y, max.z, max.x, max.y, max.z,
      max.x, max.y, max.z, min.x, max.y, max.z,
      min.x, max.y, max.z, min.x, min.y, max.z,
      min.x, min.y, min.z, min.x, min.y, max.z,
      max.x, min.y, min.z, max.x, min.y, max.z,
      max.x, max.y, min.z, max.x, max.y, max.z,
      min.x, max.y, min.z, min.x, max.y, max.z
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: this.getSectorColor(sector.sector_id),
      transparent: true,
      opacity: this.getSectorBoundsOpacity(),
      fog: false
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.userData = {
      kind: "sector",
      sector_id: sector.sector_id,
      chunk_id: sector.chunk_id,
      name: sector.name
    };
    return lines;
  }

  createChunkBounds(chunk) {
    const chunkStyle = this.getChunkBoundsStyle();
    const lines = this.createBoxBounds(chunk.global_bounds, {
      color: chunkStyle.color,
      opacity: chunkStyle.opacity
    });
    lines.userData = {
      kind: "chunk",
      chunk_id: chunk.chunk_id,
      sector_id: chunk.sector_id
    };
    return lines;
  }

  createBoxBounds(bounds, { color, opacity }) {
    const min = this.toRenderVector(bounds.min);
    const max = this.toRenderVector(bounds.max);
    const positions = new Float32Array([
      min.x, min.y, min.z, max.x, min.y, min.z,
      max.x, min.y, min.z, max.x, max.y, min.z,
      max.x, max.y, min.z, min.x, max.y, min.z,
      min.x, max.y, min.z, min.x, min.y, min.z,
      min.x, min.y, max.z, max.x, min.y, max.z,
      max.x, min.y, max.z, max.x, max.y, max.z,
      max.x, max.y, max.z, min.x, max.y, max.z,
      min.x, max.y, max.z, min.x, min.y, max.z,
      min.x, min.y, min.z, min.x, min.y, max.z,
      max.x, min.y, min.z, max.x, min.y, max.z,
      max.x, max.y, min.z, max.x, max.y, max.z,
      min.x, max.y, min.z, min.x, max.y, max.z
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      fog: false,
      toneMapped: false
    });
    return new THREE.LineSegments(geometry, material);
  }

  getSectorColor(sectorId) {
    const sectorStyle = this.environmentVisuals?.bounds?.sector || DEFAULT_WORLD_MAP_VISUALS.bounds.sector;
    return sectorStyle.colors?.[sectorId] || sectorStyle.fallbackColor || 0xffffff;
  }

  getSectorBoundsOpacity() {
    return this.environmentVisuals?.bounds?.sector?.opacity ?? DEFAULT_WORLD_MAP_VISUALS.bounds.sector.opacity;
  }

  getChunkBoundsStyle() {
    return this.environmentVisuals?.bounds?.chunk || DEFAULT_WORLD_MAP_VISUALS.bounds.chunk;
  }

  updateBoundsMaterials() {
    this.sectorBoundsGroup.traverse((object) => {
      if (!object.isLineSegments || !object.material) return;
      object.material.color.setHex(this.getSectorColor(object.userData?.sector_id));
      object.material.opacity = this.getSectorBoundsOpacity();
      object.material.transparent = object.material.opacity < 1;
      object.material.needsUpdate = true;
    });

    const chunkStyle = this.getChunkBoundsStyle();
    this.chunkBoundsGroup.traverse((object) => {
      if (!object.isLineSegments || !object.material) return;
      object.material.color.setHex(chunkStyle.color);
      object.material.opacity = chunkStyle.opacity;
      object.material.transparent = chunkStyle.opacity < 1;
      object.material.needsUpdate = true;
    });
  }

  toRenderVector(position) {
    return new THREE.Vector3(
      position.x * this.renderScale,
      position.y * this.renderScale,
      position.z * this.renderScale
    );
  }

  toDataVector(position) {
    return new THREE.Vector3(
      position.x / this.renderScale,
      position.y / this.renderScale,
      position.z / this.renderScale
    );
  }

  update(dt) {
    this.processObjectBuildQueue();

    for (const item of this.animatedObjects) {
      item.object.rotation.y += dt * item.spin;
    }
  }

  clearWorld() {
    this.snapshot = null;
    this.animatedObjects = [];
    this.fixedObjectPositionCache.clear();
    this.chunksById.clear();
    this.visibleChunkIds.clear();
    this.lastVisibleChunkId = null;
    this.lastVisibleChunkRadius = null;
    this.resetObjectBuildQueue();
    this.clearGroup(this.sectorBoundsGroup);
    this.clearGroup(this.chunkBoundsGroup);
    this.clearGroup(this.objectsGroup);
    this.onRenderMutation?.();
  }

  clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children.pop();
      this.disposeObject(child);
    }
  }

  disposeObject(object) {
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  dispose() {
    this.clearWorld();
    this.scene.remove(this.root);
    this.disposeObject(this.root);
    this.modelCache.clear();
  }
}
